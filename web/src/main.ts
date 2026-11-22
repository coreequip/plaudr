import './style.css';
import RoomWS from 'roomws';
import { ROOMWS_CHANNEL, ROOMWS_URL, TURN_URL } from './config';
import { fetchIceServers } from './ice-servers';
import { openCapture, type Capture } from './audio/pipeline';
import type { CaptureActivity } from './audio/messages';
import { loadAudioSettings, saveAudioSettings, type AudioSettings } from './audio/settings';
import { Mesh, type PeerView } from './mesh/mesh';
import { loadOrCreateIdentity, type Identity } from './crypto/identity';
import { idbIdentityStore } from './crypto/identity-store';
import { deriveRoom } from './crypto/room-keys';
import { buildLink, createRoomSecret, secretFromHash } from './room/link';
import { autoJoinTarget } from './room/auto-join';
import { canJoin, needsBackup } from './room/join-rule';
import { activeShortcutLabel, loadPlatform, type AppActions, type AppState, type Platform } from './platform/platform';
import { loadRooms, noteJoin, notePeers, roomTitle, saveRooms } from './room/rooms';
import { noteContact, type Contacts } from './room/contacts';
import { acquireTabLock } from './room/tab-lock';
import { Signaling, type SignalingStats } from './signaling/signaling';
import { initBackupPanel, showBackupState } from './ui/backup-panel';
import { initCallHeader } from './ui/call-view';
import { initControls } from './ui/controls';
import { initDebug } from './ui/debug';
import { loadPrefs, savePrefs } from './ui/prefs';
import { initRoomsView } from './ui/rooms-view';
import { initSettings, type SettingsView } from './ui/settings-view';
import { applyTheme } from './ui/theme';
import * as view from './ui/view';

declare global {
  interface Window {
    plaudr?: {
      selfId: string;
      peers(): PeerView[];
      bytesReceived(): Promise<Record<string, number>>;
      signalingStats(): SignalingStats;
      dropSignaling(): void;
      audioLevels(): Record<string, number>;
      activity(): CaptureActivity;
      senderTrackId(): string | null;
      setSettings(s: Partial<AudioSettings>): Promise<void>;
      setPressed(b: boolean): void;
      remoteSdp(peerId: string): string | null;
    };
  }
}

const NAME_KEY = 'plaudr.name';
const CONTACTS_KEY = 'plaudr.contacts';
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const store = idbIdentityStore();
let identity: Identity | null = null;
let tabLocked = false;
/** Ein Beitritt hat in dieser Seite begonnen (höchstens einer je Seitenaufruf, auch während er noch lädt). */
let inCall = false;
let settingsView: SettingsView | null = null;
/** Identität, mit der das laufende Gespräch signiert; eine im Gespräch geladene Sicherung gilt erst beim nächsten Beitritt. */
let callIdentity: Identity | null = null;
/** Andere Teilnehmer des laufenden Gesprächs, für die Wörter in den Einstellungen. */
let callPeers: () => PeerView[] = () => [];
/** Aufnahme des laufenden Gesprächs für die Einstellungen; null außerhalb eines Gesprächs. */
let callAudio: {
  settings(): AudioSettings;
  set(p: Partial<AudioSettings>): Promise<void>;
  activity(): CaptureActivity | null;
  render(): void;
} | null = null;

// Plattform (Browser oder Desktop). Die Aktionen greifen auf das laufende Gespräch zu, sobald es eines gibt.
let callActions: Pick<AppActions, 'setMode' | 'setPressed'> | null = null;
let callLeave: (() => Promise<void>) | null = null;
const appActions: AppActions = {
  setMode: (m) => callActions?.setMode(m),
  setPressed: (b) => callActions?.setPressed(b),
  leave: async () => void (await callLeave?.()),
};
const platformReady: Promise<Platform> = loadPlatform(appActions);
let platform: Platform | null = null;
void platformReady.then((p) => {
  platform = p;
  if (lastState) p.update(lastState);
});
let lastState: AppState | null = null;
const sameState = (a: AppState, b: AppState) => (Object.keys(a) as (keyof AppState)[]).every((k) => a[k] === b[k]);
/** Meldet den Zustand an die Plattform; erst nach dem Laden der Plattform, dann mit dem letzten Stand. */
function pushState(s: AppState): void {
  if (lastState && sameState(lastState, s)) return;
  lastState = s;
  try {
    platform?.update(s);
  } catch (err) {
    console.warn('[plaudr] Plattform-Update fehlgeschlagen', err);
  }
}

// Test-Aufnahme für den Pegel in den Einstellungen außerhalb eines Gesprächs. Der Zähler verwirft eine
// Aufnahme, die erst nach dem Schließen fertig wird, damit das Mikrofon nicht an bleibt.
let testCapture: Capture | null = null;
let testToken = 0;
async function openTestCapture(): Promise<void> {
  const token = ++testToken;
  const c = await openCapture({ ...loadAudioSettings(), mode: 'vad' });
  if (token !== testToken) return c?.close();
  testCapture = c;
  // Gerätenamen gibt es erst nach der Freigabe.
  await settingsView?.refreshMics();
}
function closeTestCapture(): void {
  testToken++;
  testCapture?.close();
  testCapture = null;
}

function loadName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? '';
  } catch {
    return '';
  }
}

function saveName(name: string): void {
  try {
    localStorage.setItem(NAME_KEY, name);
  } catch {
    /* privater Modus: Name wird nicht gemerkt */
  }
}

function onHello(peerId: string, name: string): void {
  let contacts: Contacts = {};
  try {
    contacts = JSON.parse(localStorage.getItem(CONTACTS_KEY) ?? '{}') as Contacts;
  } catch {
    /* kaputt oder nicht lesbar: neu anfangen */
  }
  const r = noteContact(contacts, peerId, name, Date.now());
  if (r.keyChanged) view.notice(`${name} hat einen neuen Schlüssel.`);
  try {
    localStorage.setItem(CONTACTS_KEY, JSON.stringify(r.contacts));
  } catch {
    /* privater Modus: Kontakte werden nicht gemerkt */
  }
}

const nameValue = () => $<HTMLInputElement>('name').value.trim();

const joinState = () => ({ name: nameValue(), tabLocked, identity });

function updateJoinButton(): void {
  $<HTMLButtonElement>('join').disabled = !canJoin(joinState());
  // Der Hinweis gilt nur, solange die Pflichtsicherung fehlt.
  $('join-hint').hidden = !(tabLocked && needsBackup(identity));
}

/** Einmal je Seitenaufruf: Tab sperren, Identität laden, Sicherung anbieten oder verlangen. */
let lobbyReady: Promise<void> | null = null;
function prepareLobby(): Promise<void> {
  lobbyReady ??= (async () => {
    // Zwei Tabs teilen sich die Identität und damit die peerId; das Mesh kann das nicht auseinanderhalten.
    // Die Sperre kommt vor dem Laden, damit beim ersten Start nicht zwei Tabs je einen Schlüssel anlegen.
    tabLocked = await acquireTabLock();
    if (!tabLocked) {
      const n = $('lobby-notice');
      n.textContent = 'plaudr ist in diesem Browser schon in einem anderen Tab offen.';
      n.hidden = false;
      return;
    }
    try {
      identity = await loadOrCreateIdentity(store);
    } catch (err) {
      // Etwa kein Ed25519 in WebCrypto: Lobby mit Hinweis, Beitreten bleibt aus.
      console.warn('[plaudr] Identität nicht anlegbar', err);
      const n = $('lobby-notice');
      n.textContent = 'Dein Browser kann keinen Schlüssel anlegen. Probier einen aktuellen Browser.';
      n.hidden = false;
      updateJoinButton();
      document.body.dataset.identity = 'failed';
      return;
    }
    if (!identity.persistent) {
      const n = $('lobby-notice');
      n.textContent = 'Deine Identität wird in diesem Browser nicht gespeichert.';
      n.hidden = false;
    }
    initBackupPanel({
      platform: await platformReady,
      store,
      identity: () => identity!,
      setIdentity: (id) => {
        identity = id;
        updateJoinButton();
        settingsView?.refreshIdentity();
      },
      name: () => nameValue() || loadName(),
    });
    showBackupState(identity);
    updateJoinButton();
    document.body.dataset.identity = 'ready';
  })();
  return lobbyReady;
}

async function join(secret: string): Promise<void> {
  const name = nameValue();
  const me = identity;
  // Vor dem ersten await: ein zweiter Aufruf (Doppelklick, anderer Raum per Fragment) startet kein zweites Mesh.
  if (inCall || !name || !me) return;
  inCall = true;
  callIdentity = me;
  closeTestCapture();
  saveName(name);
  $<HTMLButtonElement>('join').disabled = true;

  // Gespräch sofort zeigen: Mikrofonfreigabe, Worklet und TURN können dauern.
  saveRooms(noteJoin(loadRooms(), secret, Date.now()));
  initCallHeader({
    secret,
    link: buildLink(location.origin, secret),
    rooms: () => loadRooms(),
    setRooms: (r) => saveRooms(r),
    notice: view.notice,
  });
  view.renderPeers([]);
  view.show('call');
  // Bis das Mesh steht, gibt es nichts zu verlassen außer dem Bildschirm.
  $('leave').onclick = $('back').onclick = () => location.assign(location.pathname);

  let settings = loadAudioSettings();
  let peerCount = 0;
  let sending = false;
  const title = () => {
    const e = loadRooms().find((r) => r.secret === secret);
    return e ? roomTitle(e, Date.now()) : 'Raum';
  };
  const report = (inCallNow = true) =>
    pushState({ inCall: inCallNow, roomTitle: inCallNow ? title() : null, peerCount: inCallNow ? peerCount : 0, mode: settings.mode, sending, hasMic: !!capture });
  const [capture, iceServers, { roomId, roomKey }] = await Promise.all([
    openCapture(settings),
    fetchIceServers(TURN_URL),
    deriveRoom(secret),
  ]);
  if (!me.persistent) view.notice('Deine Identität wird in diesem Browser nicht gespeichert.');
  if (!capture) view.notice('Kein Mikrofon: du hörst nur zu.');
  else if (!capture.processed) view.notice('Rauschunterdrückung und Sprachaktivierung sind in diesem Browser nicht verfügbar.');
  capture?.onFallback(() => view.notice('Rauschunterdrückung und Sprachaktivierung sind ausgefallen, dein Mikrofon geht ungefiltert raus.'));
  const localStream = capture?.stream ?? null;
  // Namen aller, die in dieser Sitzung da waren, für die Raumliste (auch wer schon wieder gegangen ist).
  const seen = new Set<string>();
  const onChange = (peers: PeerView[]) => {
    peerCount = peers.length;
    report();
    view.renderPeers(peers);
    settingsView?.refreshPeers();
    const before = seen.size;
    for (const p of peers) if (p.name) seen.add(p.name);
    if (seen.size !== before) saveRooms(notePeers(loadRooms(), secret, [...seen]));
  };
  const drone = new RoomWS(ROOMWS_CHANNEL, { url: ROOMWS_URL });
  const selfId = me.peerId;
  const signaling = new Signaling({ drone, roomId, roomKey, identity: me });
  const mesh = new Mesh({
    signaling, selfId, selfPub: me.pub, name, localStream, iceServers,
    onTrack: view.attachAudio,
    onPeerGone: view.detachAudio,
    onChange,
    onHello,
  });
  // Ohne Mikrofon oder im Modus Stumm sehen die anderen „stumm geschaltet“ (Kontrollkanal, Spec §6).
  const syncMuted = () => mesh.setMuted(!capture || settings.mode === 'muted');
  const setSettings = async (p: Partial<AudioSettings>) => {
    settings = { ...settings, ...p };
    saveAudioSettings(settings);
    if (p.mode !== undefined) syncMuted();
    await capture?.update(p);
    if (p.mode !== undefined) report();
  };
  // Nach Auto-Beitritt ohne Geste: jede Berührung, jeder Klick, jede Taste versucht es, nicht nur „Ton aktivieren“.
  // pointerdown per Touch und manche Tasten (Escape) geben keine Nutzeraktivierung; deshalb pointerup und click,
  // und Knopf wie Listener bleiben, bis Wiedergabe und Aufnahme wirklich laufen.
  const GESTURES = ['pointerup', 'click', 'keydown'] as const;
  let armed = false;
  let trying = false;
  const tryResume = async () => {
    if (trying) return;
    trying = true;
    try {
      const playing = await view.resumeAllAudio();
      // Ohne Aktivierung löst resume() nie auf: kurz warten, dann am Zustand ablesen.
      if (capture) await Promise.race([capture.resume().catch(() => {}), new Promise((r) => setTimeout(r, 300))]);
      if (!playing || capture?.needsGesture()) return;
      $('unmute-audio').hidden = true;
      armed = false;
      for (const g of GESTURES) removeEventListener(g, onGesture, true);
    } finally {
      trying = false;
    }
  };
  const onGesture = () => void tryResume();
  const arm = () => {
    $('unmute-audio').hidden = false;
    if (armed) return;
    armed = true;
    for (const g of GESTURES) addEventListener(g, onGesture, true);
  };
  $('unmute-audio').onclick = onGesture;
  view.onPlaybackBlocked(arm);
  if (capture?.needsGesture()) arm();

  syncMuted();
  callPeers = () => mesh.peers();
  mesh.start();

  const controls = initControls({ capture, settings: () => settings, setSettings, globalKey: () => activeShortcutLabel(platform) });
  const actions = (callActions = {
    setMode: (m) => void setSettings({ mode: m }).then(controls.render),
    setPressed: controls.setPressed,
  });
  // Die globale Taste wird beim Start der App erst nach und nach belegt: Hinweis am PTT-Knopf nachziehen.
  void platformReady.then((p) =>
    p.pttShortcut?.onChange(() => {
      if (callActions === actions) controls.render();
    }),
  );
  capture?.onActivity((a) => {
    if (a.open === sending) return;
    sending = a.open;
    report();
  });
  report();
  callAudio = { settings: () => settings, set: setSettings, activity: () => capture?.activity() ?? null, render: controls.render };
  const speakingTimer = setInterval(() => view.markSpeaking(mesh.audioLevels()), 100);
  const stopDebug = initDebug({
    peers: () => mesh.peers(),
    stats: () => mesh.peerStats(),
    activity: () => capture?.activity() ?? { open: false, vad: 0 },
    settings: () => settings,
    setSettings,
  });

  // „‹“ und „Verlassen“ tun dasselbe: raus aus dem Raum, zurück zu den Räumen (ohne Fragment, also kein Auto-Beitritt).
  let left: Promise<void> | null = null;
  const leaveCall = () =>
    (left ??= (async () => {
      clearInterval(speakingTimer);
      stopDebug();
      capture?.close();
      sending = false;
      report(false);
      callActions = null;
      callLeave = null;
      await mesh.leave();
    })());
  callLeave = leaveCall;
  const leave = async () => {
    await leaveCall();
    location.assign(location.pathname);
  };
  $('leave').onclick = $('back').onclick = () => void leave();
  // Beim Schließen des Tabs reicht die Zeit meist nicht mehr fürs Signieren: Dann greift die Gnadenfrist nach member_leave.
  addEventListener('pagehide', () => void mesh.leave(), { once: true });

  window.plaudr = {
    selfId,
    peers: () => mesh.peers(),
    signalingStats: () => signaling.stats(),
    bytesReceived: () => mesh.bytesReceived(),
    dropSignaling: () => drone.socket.close(),
    audioLevels: () => mesh.audioLevels(),
    activity: () => capture?.activity() ?? { open: false, vad: 0 },
    senderTrackId: () => mesh.senderTrackId(),
    setSettings,
    setPressed: (b) => capture?.setPressed(b),
    remoteSdp: (id) => mesh.remoteSdp(id),
  };
}

const BOOTED_KEY = 'plaudr.booted';

/** Liest und setzt die Sitzungsmarke: true, wenn diese Browsersitzung schon einmal geroutet hat. */
function takeBooted(): boolean {
  try {
    const was = sessionStorage.getItem(BOOTED_KEY) !== null;
    sessionStorage.setItem(BOOTED_KEY, '1');
    return was;
  } catch {
    return false;
  }
}

function boot(): void {
  applyTheme(loadPrefs());
  const rooms = initRoomsView({
    rooms: () => loadRooms(),
    setRooms: (r) => saveRooms(r),
    autoJoin: () => loadPrefs().autoJoin,
    open: (secret) => {
      location.hash = secret;
    },
    create: () => {
      location.hash = createRoomSecret();
    },
    settings: () => openSettings('start'),
  });
  $('lobby-back').onclick = () => {
    location.hash = '';
  };

  // Einstellungen aus den Räumen oder dem Gespräch (das läuft weiter); Zurück führt dorthin, woher man kam.
  let returnTo: 'start' | 'call' = 'start';
  const settings = initSettings({
    audio: () => callAudio?.settings() ?? loadAudioSettings(),
    setAudio: async (p) => {
      if (callAudio) return callAudio.set(p);
      saveAudioSettings({ ...loadAudioSettings(), ...p });
      await testCapture?.update(p);
    },
    activity: () => (callAudio ? callAudio.activity() : (testCapture?.activity() ?? null)),
    prefs: loadPrefs,
    setPrefs: (p) => {
      savePrefs(p);
      applyTheme(p);
    },
    name: loadName,
    setName: (n) => {
      saveName(n);
      if (!inCall) $<HTMLInputElement>('name').value = n;
    },
    identity: () => identity,
    identityInUse: () => callIdentity ?? identity,
    peers: () => callPeers(),
    inCall: () => inCall,
    pttShortcut: () => platform?.pttShortcut ?? null,
    back: () => {
      closeSettings();
      if (returnTo === 'call') {
        callAudio?.render();
        view.show('call');
      } else {
        rooms.render();
        view.show('start');
      }
    },
  });
  settingsView = settings;
  const closeSettings = () => {
    settings.hide();
    closeTestCapture();
  };
  const openSettings = (from: 'start' | 'call') => {
    returnTo = from;
    settings.show();
    view.show('settings');
    if (inCall) return;
    // Außerhalb eines Gesprächs: Mikrofon für den Pegel, Identität für Wörter und Sicherung.
    void openTestCapture();
    void prepareLobby().then(() => settings.refreshIdentity());
  };
  $('call-settings').onclick = () => openSettings('call');
  $('unmute-audio').onclick = () => void view.resumeAllAudio();
  addEventListener('pagehide', closeTestCapture);

  let first = true;
  const route = () => {
    // Fragment ändert sich bei offenen Einstellungen: Mikrofon freigeben, Sicherungskarte zurück in die Lobby.
    if (!$('settings').hidden) closeSettings();
    // Anderer Raum im Fragment während eines Gesprächs oder Beitritts: neu laden, pagehide verlässt das alte sauber.
    if (inCall) return location.reload();
    const booted = first ? takeBooted() : true;
    first = false;
    const target = autoJoinTarget({ hash: location.hash, booted, autoJoin: loadPrefs().autoJoin, rooms: loadRooms() });
    if (target) {
      location.hash = target;
      return;
    }
    const secret = secretFromHash(location.hash);
    if (!secret) {
      rooms.render();
      return view.show('start');
    }
    $<HTMLInputElement>('name').value = loadName();
    $('name').oninput = updateJoinButton;
    $('join').onclick = () => void join(secret);
    // Fehlt nichts (Name, Sicherung, eigener Tab), geht es ohne Lobby direkt ins Gespräch.
    void prepareLobby().then(() => {
      if (secretFromHash(location.hash) !== secret) return;
      if (canJoin(joinState())) void join(secret);
      else view.show('lobby');
    });
  };
  addEventListener('hashchange', route);
  route();
}

boot();
