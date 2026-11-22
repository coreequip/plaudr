import './style.css';
import RoomWS from 'roomws';
import { ROOMWS_CHANNEL, ROOMWS_URL, TURN_URL } from './config';
import { fetchIceServers } from './ice-servers';
import { openCapture } from './audio/pipeline';
import type { CaptureActivity } from './audio/messages';
import { loadAudioSettings, saveAudioSettings, type AudioSettings } from './audio/settings';
import { Mesh, type PeerView } from './mesh/mesh';
import { loadOrCreateIdentity, type Identity } from './crypto/identity';
import { idbIdentityStore } from './crypto/identity-store';
import { deriveRoom } from './crypto/room-keys';
import { buildLink, createRoomSecret, secretFromHash } from './room/link';
import { autoJoinTarget } from './room/auto-join';
import { canJoin } from './room/join-rule';
import { loadRooms, noteJoin, notePeers, saveRooms } from './room/rooms';
import { noteContact, type Contacts } from './room/contacts';
import { acquireTabLock } from './room/tab-lock';
import { Signaling, type SignalingStats } from './signaling/signaling';
import { initBackupPanel, showBackupState } from './ui/backup-panel';
import { initCallHeader } from './ui/call-view';
import { initControls } from './ui/controls';
import { initDebug } from './ui/debug';
import { loadPrefs } from './ui/prefs';
import { initRoomsView } from './ui/rooms-view';
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
/** Ein Gespräch läuft in dieser Seite (es gibt höchstens eins je Seitenaufruf). */
let inCall = false;

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
  $('join-hint').hidden = !(tabLocked && identity !== null && !identity.backedUp && identity.persistent);
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
    identity = await loadOrCreateIdentity(store);
    if (!identity.persistent) {
      const n = $('lobby-notice');
      n.textContent = 'Deine Identität wird in diesem Browser nicht gespeichert.';
      n.hidden = false;
    }
    initBackupPanel({
      store,
      identity: () => identity!,
      setIdentity: (id) => {
        identity = id;
        updateJoinButton();
      },
      name: nameValue,
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
  if (!name || !me) return;
  saveName(name);
  $<HTMLButtonElement>('join').disabled = true;

  let settings = loadAudioSettings();
  const [capture, iceServers, { roomId, roomKey }] = await Promise.all([
    openCapture(settings),
    fetchIceServers(TURN_URL),
    deriveRoom(secret),
  ]);
  saveRooms(noteJoin(loadRooms(), secret, Date.now()));
  if (!me.persistent) view.notice('Deine Identität wird in diesem Browser nicht gespeichert.');
  if (!capture) view.notice('Kein Mikrofon: du hörst nur zu.');
  else if (!capture.processed) view.notice('Rauschunterdrückung und Sprachaktivierung sind in diesem Browser nicht verfügbar.');
  capture?.onFallback(() => view.notice('Rauschunterdrückung und Sprachaktivierung sind ausgefallen, dein Mikrofon geht ungefiltert raus.'));
  const localStream = capture?.stream ?? null;
  // Namen aller, die in dieser Sitzung da waren, für die Raumliste (auch wer schon wieder gegangen ist).
  const seen = new Set<string>();
  const onChange = (peers: PeerView[]) => {
    view.renderPeers(peers);
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
  };
  syncMuted();
  mesh.start();

  initCallHeader({
    secret,
    link: buildLink(location.origin, secret),
    rooms: () => loadRooms(),
    setRooms: (r) => saveRooms(r),
    notice: view.notice,
  });
  view.renderPeers([]);
  view.show('call');
  inCall = true;
  if (capture?.needsGesture()) $('unmute-audio').hidden = false;
  $('unmute-audio').onclick = () => {
    view.resumeAllAudio();
    void capture?.resume();
  };

  initControls({ capture, settings: () => settings, setSettings });
  const speakingTimer = setInterval(() => view.markSpeaking(mesh.audioLevels()), 100);
  const stopDebug = initDebug({
    peers: () => mesh.peers(),
    stats: () => mesh.peerStats(),
    activity: () => capture?.activity() ?? { open: false, vad: 0 },
    settings: () => settings,
    setSettings,
  });

  // „‹“ und „Verlassen“ tun dasselbe: raus aus dem Raum, zurück zu den Räumen (ohne Fragment, also kein Auto-Beitritt).
  const leave = async () => {
    clearInterval(speakingTimer);
    stopDebug();
    capture?.close();
    await mesh.leave();
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
    settings: () => view.show('settings'),
  });
  $('lobby-back').onclick = () => {
    location.hash = '';
  };
  // Einstellungen aus dem Gespräch: das Gespräch läuft weiter, Zurück führt wieder hinein.
  $('call-settings').onclick = () => view.show('settings');
  $('settings-back').onclick = () => (inCall ? view.show('call') : route());
  $('unmute-audio').onclick = view.resumeAllAudio;

  let first = true;
  const route = () => {
    // Anderer Raum im Fragment während eines Gesprächs: neu laden, pagehide verlässt das alte sauber.
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
