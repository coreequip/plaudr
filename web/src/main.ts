import './style.css';
import RoomWS from 'roomws';
import { ROOMWS_CHANNEL, ROOMWS_URL, TURN_URL } from './config';
import { fetchIceServers } from './ice-servers';
import { Mesh, type PeerView } from './mesh/mesh';
import { loadOrCreateIdentity } from './crypto/identity';
import { idbIdentityStore } from './crypto/identity-store';
import { deriveRoom } from './crypto/room-keys';
import { buildLink, createRoomSecret, secretFromHash } from './room/link';
import { noteContact, type Contacts } from './room/contacts';
import { acquireTabLock } from './room/tab-lock';
import { Signaling, type SignalingStats } from './signaling/signaling';
import * as view from './ui/view';

declare global {
  interface Window {
    plaudr?: {
      selfId: string;
      peers(): PeerView[];
      bytesReceived(): Promise<Record<string, number>>;
      signalingStats(): SignalingStats;
      dropSignaling(): void;
    };
  }
}

const NAME_KEY = 'plaudr.name';
const CONTACTS_KEY = 'plaudr.contacts';
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

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

async function openMicrophone(): Promise<MediaStream | null> {
  try {
    return await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    view.notice('Kein Mikrofon: du hörst nur zu.');
    return null;
  }
}

async function join(secret: string): Promise<void> {
  const name = $<HTMLInputElement>('name').value.trim() || 'Gast';
  saveName(name);
  const joinButton = $<HTMLButtonElement>('join');
  joinButton.disabled = true;

  // Zwei Tabs teilen sich die Identität und damit die peerId; das Mesh kann das nicht auseinanderhalten.
  if (!(await acquireTabLock())) {
    const n = $('lobby-notice');
    n.textContent = 'plaudr ist in diesem Browser schon in einem anderen Tab offen.';
    n.hidden = false;
    joinButton.disabled = false;
    return;
  }

  const [localStream, iceServers, { roomId, roomKey }, identity] = await Promise.all([
    openMicrophone(),
    fetchIceServers(TURN_URL),
    deriveRoom(secret),
    loadOrCreateIdentity(idbIdentityStore()),
  ]);
  if (!identity.persistent) view.notice('Deine Identität wird in diesem Browser nicht gespeichert.');
  const drone = new RoomWS(ROOMWS_CHANNEL, { url: ROOMWS_URL });
  const selfId = identity.peerId;
  const signaling = new Signaling({ drone, roomId, roomKey, identity });
  const mesh = new Mesh({
    signaling, selfId, selfPub: identity.pub, name, localStream, iceServers,
    onTrack: view.attachAudio,
    onPeerGone: view.detachAudio,
    onChange: view.renderPeers,
    onHello,
  });
  mesh.start();

  $<HTMLInputElement>('link').value = buildLink(location.origin, secret);
  view.renderPeers([]);
  view.show('call');

  const mute = $<HTMLButtonElement>('mute');
  mute.disabled = !localStream;
  mute.onclick = () => {
    const track = localStream?.getAudioTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    mute.textContent = track.enabled ? 'Stumm' : 'Mikro an';
  };
  $('leave').onclick = async () => {
    localStream?.getTracks().forEach((t) => t.stop());
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
    $('join').onclick = () => void join(secret);
    view.show('lobby');
  };
  addEventListener('hashchange', route);
  route();
}

boot();
