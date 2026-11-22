import './style.css';
import RoomWS from 'roomws';
import { ROOMWS_CHANNEL, ROOMWS_URL, TURN_URL } from './config';
import { fetchIceServers } from './ice-servers';
import { Mesh, type PeerView } from './mesh/mesh';
import { deriveRoom } from './crypto/room-keys';
import { buildLink, createRoomSecret, secretFromHash } from './room/link';
import { Signaling } from './signaling/signaling';
import * as view from './ui/view';

declare global {
  interface Window {
    plaudr?: { peers(): PeerView[]; bytesReceived(): Promise<Record<string, number>>; dropSignaling(): void };
  }
}

const NAME_KEY = 'plaudr.name';
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
  $<HTMLButtonElement>('join').disabled = true;

  const [localStream, iceServers] = await Promise.all([openMicrophone(), fetchIceServers(TURN_URL)]);
  const drone = new RoomWS(ROOMWS_CHANNEL, { url: ROOMWS_URL });
  const selfId = crypto.randomUUID();
  const { roomId } = await deriveRoom(secret);
  const signaling = new Signaling({ drone, roomId, selfId });
  const mesh = new Mesh({
    signaling, selfId, name, localStream, iceServers,
    onTrack: view.attachAudio,
    onPeerGone: view.detachAudio,
    onChange: view.renderPeers,
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
  $('leave').onclick = () => {
    mesh.leave();
    localStream?.getTracks().forEach((t) => t.stop());
    location.reload();
  };
  addEventListener('pagehide', () => mesh.leave(), { once: true });

  window.plaudr = {
    peers: () => mesh.peers(),
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
