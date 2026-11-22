import type { Capture } from '../audio/pipeline';
import { bindPttKeys } from '../audio/ptt-keys';
import type { AudioSettings } from '../audio/settings';
import type { SpeakMode } from '../audio/gate';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const MODES: SpeakMode[] = ['vad', 'ptt', 'muted'];
const TEXT_INPUT = /^(text|password|search|email|url|number|tel)$/;

/** Tippen in Textfeldern soll nicht senden; Schieberegler und Knöpfe zählen nicht als Tippen. */
function isTyping(e: Event): boolean {
  const el = e.target as HTMLElement | null;
  if (!el || !('tagName' in el)) return false;
  if (el.isContentEditable || el.tagName === 'TEXTAREA') return true;
  return el.tagName === 'INPUT' && TEXT_INPUT.test((el as HTMLInputElement).type);
}

export interface ControlsOptions {
  capture: Capture | null;
  settings: () => AudioSettings;
  setSettings: (p: Partial<AudioSettings>) => Promise<void>;
}

const pct = (v: number) => `${Math.round(v * 100)} %`;

/** Sprechmodus, Pegel mit Schwelle, PTT (Knopf und Leertaste), Rauschunterdrückung, eigene Sprechanzeige. */
export function initControls(o: ControlsOptions): () => void {
  const { capture } = o;
  const showThreshold = (t: number) => {
    $('vad-threshold-label').textContent = `Schwelle ${pct(t)}`;
    $('vad-mark').style.left = `${t * 100}%`;
  };
  const render = () => {
    const s = o.settings();
    for (const m of MODES) $(`mode-${m}`).setAttribute('aria-pressed', String(s.mode === m));
    // Ohne Mikrofon gibt es weder Pegel noch etwas zum Halten.
    $('ptt').hidden = !capture || s.mode !== 'ptt';
    $('vad-meter').hidden = !capture || s.mode !== 'vad';
    $<HTMLInputElement>('vad-threshold').value = String(s.threshold);
    showThreshold(s.threshold);
    $<HTMLInputElement>('denoise').checked = s.denoise;
  };

  for (const m of MODES) {
    const b = $<HTMLButtonElement>(`mode-${m}`);
    b.disabled = !capture;
    b.onclick = async () => {
      await o.setSettings({ mode: m });
      render();
    };
  }
  $<HTMLInputElement>('vad-threshold').disabled = !capture;
  $<HTMLInputElement>('vad-threshold').oninput = (e) => {
    const t = Number((e.target as HTMLInputElement).value);
    showThreshold(t);
    void o.setSettings({ threshold: t });
  };
  $<HTMLInputElement>('denoise').disabled = !capture;
  $<HTMLInputElement>('denoise').onchange = (e) => void o.setSettings({ denoise: (e.target as HTMLInputElement).checked });

  const isPtt = () => o.settings().mode === 'ptt';
  // Loslassen immer durchreichen, auch wenn der Modus inzwischen gewechselt hat.
  const ptt = $<HTMLButtonElement>('ptt');
  const setPressed = (p: boolean) => {
    if (p && !isPtt()) return;
    capture?.setPressed(p);
    ptt.classList.toggle('active', p);
  };
  ptt.onpointerdown = (e) => {
    ptt.setPointerCapture(e.pointerId);
    setPressed(true);
  };
  ptt.onpointerup = ptt.onpointercancel = () => setPressed(false);
  const unbindKeys = bindPttKeys(window, setPressed, isTyping, isPtt);

  const me = $('me-speaking');
  const level = $('vad-level');
  capture?.onActivity((a) => {
    me.hidden = !a.open;
    level.style.width = `${Math.min(1, Math.max(0, a.vad)) * 100}%`;
    level.classList.toggle('open', a.open);
  });

  render();
  return unbindKeys;
}
