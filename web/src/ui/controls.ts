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

/** Sprechmodus, PTT (Knopf und Leertaste), Schwelle, Rauschunterdrückung, eigene Sprechanzeige. */
export function initControls(o: ControlsOptions): () => void {
  const { capture } = o;
  const render = () => {
    const s = o.settings();
    for (const m of MODES) $(`mode-${m}`).setAttribute('aria-pressed', String(s.mode === m));
    $('ptt').hidden = s.mode !== 'ptt';
    $('vad-threshold-row').hidden = s.mode !== 'vad';
    $<HTMLInputElement>('vad-threshold').value = String(s.threshold);
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
  $<HTMLInputElement>('vad-threshold').oninput = (e) =>
    void o.setSettings({ threshold: Number((e.target as HTMLInputElement).value) });
  $<HTMLInputElement>('denoise').disabled = !capture;
  $<HTMLInputElement>('denoise').onchange = (e) => void o.setSettings({ denoise: (e.target as HTMLInputElement).checked });

  const setPressed = (p: boolean) => {
    if (o.settings().mode === 'ptt') capture?.setPressed(p);
  };
  const ptt = $<HTMLButtonElement>('ptt');
  ptt.onpointerdown = (e) => {
    ptt.setPointerCapture(e.pointerId);
    setPressed(true);
  };
  ptt.onpointerup = ptt.onpointercancel = () => setPressed(false);
  const unbindKeys = bindPttKeys(window, setPressed, isTyping);

  const me = $('me-speaking');
  capture?.onActivity((a) => (me.hidden = !a.open));

  render();
  return unbindKeys;
}
