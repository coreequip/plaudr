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
import { noteContact, type Contacts } from './room/contacts';
import { acquireTabLock } from './room/tab-lock';
import { Signaling, type SignalingStats } from './signaling/signaling';
import { initBackupPanel, showBackupState } from './ui/backup-panel';
import { initControls } from './ui/controls';
import { initDebug } from './ui/debug';
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

/** Beitreten erst mit Namen, eigener Tab-Sperre und gesicherter (oder bewusst flüchtiger) Identität. */
function updateJoinButton(): void {
  const ok = tabLocked && identity !== null && (identity.backedUp || !identity.persistent) && nameValue() !== '';
  $<HTMLButtonElement>('join').disabled = !ok;
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
  if (!me.persistent) view.notice('Deine Identität wird in diesem Browser nicht gespeichert.');
  if (!capture) view.notice('Kein Mikrofon: du hörst nur zu.');
  else if (!capture.processed) view.notice('Rauschunterdrückung und Sprachaktivierung sind in diesem Browser nicht verfügbar.');
  const localStream = capture?.stream ?? null;
  const setSettings = async (p: Partial<AudioSettings>) => {
    settings = { ...settings, ...p };
    saveAudioSettings(settings);
    await capture?.update(p);
  };
  const drone = new RoomWS(ROOMWS_CHANNEL, { url: ROOMWS_URL });
  const selfId = me.peerId;
  const signaling = new Signaling({ drone, roomId, roomKey, identity: me });
  const mesh = new Mesh({
    signaling, selfId, selfPub: me.pub, name, localStream, iceServers,
    onTrack: view.attachAudio,
    onPeerGone: view.detachAudio,
    onChange: view.renderPeers,
    onHello,
  });
  mesh.start();

  $<HTMLInputElement>('link').value = buildLink(location.origin, secret);
  view.renderPeers([]);
  view.show('call');

  initControls({ capture, settings: () => settings, setSettings });
  const speakingTimer = setInterval(() => view.markSpeaking(mesh.audioLevels()), 100);
  const stopDebug = initDebug({
    peers: () => mesh.peers(),
    stats: () => mesh.peerStats(),
    activity: () => capture?.activity() ?? { open: false, vad: 0 },
    settings: () => settings,
    setSettings,
  });

  $('leave').onclick = async () => {
    clearInterval(speakingTimer);
    stopDebug();
    capture?.close();
    await mesh.leave();
    location.reload();
  };
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

function boot(): void {
  $('create').onclick = () => {
    location.hash = createRoomSecret();
  };
  $('copy').onclick = () => void navigator.clipboard?.writeText($<HTMLInputElement>('link').value);
  $('unmute-audio').onclick = view.resumeAllAudio;

  const route = () => {
    const secret = secretFromHash(location.hash);
    if (!secret) return view.show('start');
    $<HTMLInputElement>('name').value = loadName();
    $('name').oninput = updateJoinButton;
    $('join').onclick = () => void join(secret);
    view.show('lobby');
    void prepareLobby();
  };
  addEventListener('hashchange', route);
  route();
}

boot();
