import type { PeerView } from '../mesh/mesh';
import { fingerprintWords } from '../crypto/words';

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

/**
 * Zustandszeile einer Karte: Verbindungsprobleme zuerst (sonst sähe ein abgerissener, stummer Peer nur „stumm“),
 * dann stumm geschaltet, dann spricht, sonst verbunden.
 */
export function peerStateText(s: { state: RTCPeerConnectionState; muted: boolean; speaking: boolean }): string {
  if (s.state !== 'connected') return STATE_LABEL[s.state] ?? '';
  if (s.muted) return 'stumm geschaltet';
  if (s.speaking) return 'spricht';
  return STATE_LABEL.connected;
}

function stateText(li: HTMLElement): string {
  return peerStateText({
    state: (li.dataset.state as RTCPeerConnectionState) ?? 'new',
    muted: li.classList.contains('muted'),
    speaking: li.classList.contains('speaking'),
  });
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** Vier Wörter je Schlüssel, einmal berechnet (Tooltip am Namen und Liste in den Einstellungen). */
const wordsCache = new Map<string, Promise<string>>();
export function wordsOf(pub: string): Promise<string> {
  let w = wordsCache.get(pub);
  if (!w) {
    w = fingerprintWords(pub).then((x) => x.join(' · '));
    wordsCache.set(pub, w);
  }
  return w;
}

/** Neue Karte; Inhalt setzt updateCard. */
function createCard(peerId: string): HTMLLIElement {
  const li = document.createElement('li');
  li.dataset.peer = peerId;
  const avatar = el('span', 'avatar');
  avatar.setAttribute('aria-hidden', 'true');
  const text = el('span', 'peer-text');
  text.append(el('span', 'name'), el('span', 'state'));
  const volLabel = el('label', 'vol');
  volLabel.innerHTML = SPEAKER;
  const vol = document.createElement('input');
  vol.type = 'range';
  vol.min = '0';
  vol.max = '1';
  vol.step = '0.05';
  vol.value = String(volumeOf(peerId));
  vol.dataset.volume = '';
  vol.oninput = () => setVolume(peerId, Number(vol.value));
  volLabel.append(vol);
  li.append(avatar, text, volLabel);
  return li;
}

/** Aktualisiert eine Karte an Ort und Stelle; der Lautstärkeregler bleibt dasselbe Element, ein Ziehen läuft weiter. */
function updateCard(li: HTMLLIElement, p: PeerView): void {
  const label = p.name || 'Unbekannt';
  li.dataset.state = p.state;
  li.classList.toggle('muted', p.muted);
  if (p.muted) li.classList.remove('speaking');
  const setText = (sel: string, t: string) => {
    const e = li.querySelector(sel)!;
    if (e.textContent !== t) e.textContent = t;
  };
  setText('.avatar', initial(label));
  setText('.name', label);
  setText('.state', stateText(li));
  li.querySelector('input[data-volume]')!.setAttribute('aria-label', `Lautstärke ${label}`);
  const name = li.querySelector<HTMLElement>('.name')!;
  if (!p.pub) return name.removeAttribute('title');
  if (li.dataset.pub === p.pub) return;
  li.dataset.pub = p.pub;
  void wordsOf(p.pub).then((w) => {
    if (li.dataset.pub === p.pub) name.title = w;
  });
}

export function renderPeers(peers: PeerView[]): void {
  const list = $<HTMLUListElement>('peers');
  const old = new Map([...list.querySelectorAll<HTMLLIElement>(':scope > li')].map((li) => [li.dataset.peer ?? '', li]));
  const cards = peers.map((p) => {
    const li = old.get(p.peerId) ?? createCard(p.peerId);
    updateCard(li, p);
    return li;
  });
  // Nur umhängen, wenn sich Menge oder Reihenfolge geändert hat; sonst bleiben alle Elemente, wo sie sind.
  const same = cards.length === list.children.length && cards.every((li, i) => list.children[i] === li);
  if (!same) list.replaceChildren(...cards);
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
  el.play().catch(() => {
    $('unmute-audio').hidden = false;
    playbackBlocked();
  });
}

export function detachAudio(peerId: string): void {
  audioFor(peerId)?.remove();
}

let playbackBlocked: () => void = () => {};
/** Wird gerufen, wenn der Browser die Wiedergabe ohne Nutzergeste verweigert. */
export function onPlaybackBlocked(f: () => void): void {
  playbackBlocked = f;
}

/** Startet alle Wiedergaben; true, wenn jede wirklich läuft (ohne Nutzergeste lehnt play() ab). */
export async function resumeAllAudio(): Promise<boolean> {
  const all = [...document.querySelectorAll<HTMLAudioElement>('#audio audio')];
  const results = await Promise.all(all.map((el) => el.play().then(() => true, () => false)));
  return results.every(Boolean);
}
