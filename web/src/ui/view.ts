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

const SPEAKER =
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5 6 9H2v6h4l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/></svg>';

/** Erster Buchstabe des Namens, groß (ganze Zeichen, nicht nur UTF-16-Hälften). */
export function initial(name: string): string {
  const first = [...name.trim()][0];
  return first ? first.toLocaleUpperCase('de-DE') : '?';
}

/** Zustand einer Karte: stumm geschaltet vor spricht vor Verbindungszustand. */
function stateText(li: HTMLElement): string {
  if (li.classList.contains('muted')) return 'stumm geschaltet';
  if (li.classList.contains('speaking')) return 'spricht';
  return STATE_LABEL[li.dataset.state as RTCPeerConnectionState] ?? '';
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

export function renderPeers(peers: PeerView[]): void {
  const list = $<HTMLUListElement>('peers');
  // Sprechanzeige über das Neuzeichnen retten, sonst flackert der Rahmen bis zum nächsten Pegeltakt.
  const speaking = new Set([...list.querySelectorAll<HTMLLIElement>('li.speaking')].map((li) => li.dataset.peer));
  list.replaceChildren(
    ...peers.map((p) => {
      const label = p.name || 'Unbekannt';
      const li = document.createElement('li');
      li.dataset.peer = p.peerId;
      li.dataset.state = p.state;
      li.classList.toggle('muted', p.muted);
      li.classList.toggle('speaking', !p.muted && speaking.has(p.peerId));
      const avatar = el('span', 'avatar', initial(label));
      avatar.setAttribute('aria-hidden', 'true');
      const text = el('span', 'peer-text');
      const state = el('span', 'state');
      text.append(el('span', 'name', label), state);
      const volLabel = el('label', 'vol');
      volLabel.innerHTML = SPEAKER;
      const vol = document.createElement('input');
      vol.type = 'range';
      vol.min = '0';
      vol.max = '1';
      vol.step = '0.05';
      vol.value = String(volumeOf(p.peerId));
      vol.dataset.volume = '';
      vol.setAttribute('aria-label', `Lautstärke ${label}`);
      vol.oninput = () => setVolume(p.peerId, Number(vol.value));
      volLabel.append(vol);
      li.append(avatar, text, volLabel);
      state.textContent = stateText(li);
      return li;
    }),
  );
  $('peer-count').textContent = `IM RAUM (${peers.length})`;
  $('alone').hidden = peers.length > 0;
}

/** Markiert Teilnehmer, deren empfangener Pegel gerade über der Sprechschwelle liegt; Stumme sprechen nie. */
export function markSpeaking(levels: Record<string, number>): void {
  for (const li of document.querySelectorAll<HTMLLIElement>('#peers li')) {
    const on = !li.classList.contains('muted') && (levels[li.dataset.peer ?? ''] ?? 0) > SPEAKING_LEVEL;
    li.classList.toggle('speaking', on);
    const state = li.querySelector('.state');
    const text = stateText(li);
    if (state && state.textContent !== text) state.textContent = text;
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
