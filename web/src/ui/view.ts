import type { PeerView } from '../mesh/mesh';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const STATE_LABEL: Record<RTCPeerConnectionState, string> = {
  new: 'verbindet …', connecting: 'verbindet …', connected: 'verbunden',
  disconnected: 'unterbrochen', failed: 'fehlgeschlagen', closed: 'getrennt',
};
const VOLUMES_KEY = 'plaudr.volumes';
const SPEAKING_LEVEL = 0.01;

export type Screen = 'start' | 'lobby' | 'call' | 'settings';

export function show(screen: Screen): void {
  for (const s of ['start', 'lobby', 'call', 'settings'] as const) $(s).hidden = s !== screen;
}

export function notice(text: string): void {
  const el = $('notice');
  el.textContent = text;
  el.hidden = false;
}

function loadVolumes(): Record<string, number> {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(VOLUMES_KEY) ?? '{}');
    return v && typeof v === 'object' ? (v as Record<string, number>) : {};
  } catch {
    return {};
  }
}

function volumeOf(peerId: string): number {
  const v = loadVolumes()[peerId];
  return typeof v === 'number' && v >= 0 && v <= 1 ? v : 1;
}

function setVolume(peerId: string, v: number): void {
  const el = audioFor(peerId);
  if (el) el.volume = v;
  try {
    localStorage.setItem(VOLUMES_KEY, JSON.stringify({ ...loadVolumes(), [peerId]: v }));
  } catch {
    /* privater Modus: Lautstärke wird nicht gemerkt */
  }
}

const audioFor = (peerId: string) => document.querySelector<HTMLAudioElement>(`audio[data-peer="${CSS.escape(peerId)}"]`);

export function renderPeers(peers: PeerView[]): void {
  const list = $<HTMLUListElement>('peers');
  list.replaceChildren(
    ...peers.map((p) => {
      const li = document.createElement('li');
      li.dataset.peer = p.peerId;
      const dot = document.createElement('span');
      dot.className = 'dot';
      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = p.name || 'Unbekannt';
      const state = document.createElement('span');
      state.className = 'state';
      state.textContent = STATE_LABEL[p.state];
      const vol = document.createElement('input');
      vol.type = 'range';
      vol.min = '0';
      vol.max = '1';
      vol.step = '0.05';
      vol.value = String(volumeOf(p.peerId));
      vol.dataset.volume = '';
      vol.setAttribute('aria-label', `Lautstärke ${p.name || 'Unbekannt'}`);
      vol.oninput = () => setVolume(p.peerId, Number(vol.value));
      li.append(dot, name, state, vol);
      return li;
    }),
  );
  $('alone').hidden = peers.length > 0;
}

/** Markiert Teilnehmer, deren empfangener Pegel gerade über der Sprechschwelle liegt. */
export function markSpeaking(levels: Record<string, number>): void {
  for (const li of document.querySelectorAll<HTMLLIElement>('#peers li')) {
    li.classList.toggle('speaking', (levels[li.dataset.peer ?? ''] ?? 0) > SPEAKING_LEVEL);
  }
}

/** Wiedergabe bewusst über <audio>, damit die Echounterdrückung des Browsers sie als Referenz hat. */
export function attachAudio(peerId: string, stream: MediaStream): void {
  let el = audioFor(peerId);
  if (!el) {
    el = document.createElement('audio');
    el.dataset.peer = peerId;
    el.autoplay = true;
    $('audio').append(el);
  }
  el.volume = volumeOf(peerId);
  el.srcObject = stream;
  el.play().catch(() => ($('unmute-audio').hidden = false));
}

export function detachAudio(peerId: string): void {
  audioFor(peerId)?.remove();
}

export function resumeAllAudio(): void {
  for (const el of document.querySelectorAll<HTMLAudioElement>('#audio audio')) void el.play().catch(() => {});
  $('unmute-audio').hidden = true;
}
