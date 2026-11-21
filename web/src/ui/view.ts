import type { PeerView } from '../mesh/mesh';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const STATE_LABEL: Record<RTCPeerConnectionState, string> = {
  new: 'verbindet …', connecting: 'verbindet …', connected: 'verbunden',
  disconnected: 'unterbrochen', failed: 'fehlgeschlagen', closed: 'getrennt',
};

export type Screen = 'start' | 'lobby' | 'call';

export function show(screen: Screen): void {
  for (const s of ['start', 'lobby', 'call'] as const) $(s).hidden = s !== screen;
}

export function notice(text: string): void {
  const el = $('notice');
  el.textContent = text;
  el.hidden = false;
}

export function renderPeers(peers: PeerView[]): void {
  const list = $<HTMLUListElement>('peers');
  list.replaceChildren(
    ...peers.map((p) => {
      const li = document.createElement('li');
      li.dataset.peer = p.peerId;
      const name = document.createElement('span');
      name.textContent = p.name || 'Unbekannt';
      const state = document.createElement('span');
      state.className = 'state';
      state.textContent = STATE_LABEL[p.state];
      li.append(name, state);
      return li;
    }),
  );
  $('alone').hidden = peers.length > 0;
}

/** Wiedergabe bewusst über <audio>, damit die Echounterdrückung des Browsers sie als Referenz hat. */
export function attachAudio(peerId: string, stream: MediaStream): void {
  let el = document.querySelector<HTMLAudioElement>(`audio[data-peer="${CSS.escape(peerId)}"]`);
  if (!el) {
    el = document.createElement('audio');
    el.dataset.peer = peerId;
    el.autoplay = true;
    $('audio').append(el);
  }
  el.srcObject = stream;
  el.play().catch(() => ($('unmute-audio').hidden = false));
}

export function detachAudio(peerId: string): void {
  document.querySelector(`audio[data-peer="${CSS.escape(peerId)}"]`)?.remove();
}

export function resumeAllAudio(): void {
  for (const el of document.querySelectorAll<HTMLAudioElement>('#audio audio')) void el.play().catch(() => {});
  $('unmute-audio').hidden = true;
}
