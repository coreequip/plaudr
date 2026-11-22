import type { Capture } from '../audio/pipeline';
import { bindPttKeys } from '../audio/ptt-keys';
import { PttButton } from './ptt-button';
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

export interface Controls {
  /** Neu zeichnen, etwa nach Änderungen in den Einstellungen (Schwelle, Rauschunterdrückung). */
  render(): void;
  /** Wie die Leertaste: Taste gedrückt oder losgelassen (globale Taste im Desktop). */
  setPressed(p: boolean): void;
  unbind(): void;
}

const HOLD_LABEL = 'Zum Sprechen halten oder antippen';

/** Sprechmodus, Pegel mit Schwelle (nur Anzeige, der Regler steht in den Einstellungen), PTT, Rauschunterdrückung. */
export function initControls(o: ControlsOptions): Controls {
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
    if (s.mode !== 'ptt') cancel();
    $('vad-meter').hidden = !capture || s.mode !== 'vad';
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
  $<HTMLInputElement>('denoise').disabled = !capture;
  $<HTMLInputElement>('denoise').onchange = (e) => void o.setSettings({ denoise: (e.target as HTMLInputElement).checked });

  const isPtt = () => o.settings().mode === 'ptt';
  const ptt = $<HTMLButtonElement>('ptt');
  const label = ptt.querySelector<HTMLElement>('.ptt-label')!;
  // Loslassen immer durchreichen, auch wenn der Modus inzwischen gewechselt hat.
  const apply = (p: boolean) => {
    if (p && !isPtt()) return;
    capture?.setPressed(p);
    ptt.classList.toggle('active', p);
  };
  const button = new PttButton(apply);
  // Einrasten ist kein Wechsel von gedrückt/losgelassen, darum die Anzeige nach jeder Bedienung nachziehen.
  const showLatch = () => {
    ptt.setAttribute('aria-pressed', String(button.latched));
    label.textContent = button.latched ? 'Du sprichst. Antippen zum Beenden.' : HOLD_LABEL;
  };
  const cancel = () => {
    button.cancel();
    showLatch();
  };
  ptt.onpointerdown = (e) => {
    ptt.setPointerCapture(e.pointerId);
    if (isPtt()) button.down();
    showLatch();
  };
  ptt.onpointerup = () => {
    button.up();
    showLatch();
  };
  ptt.onpointercancel = cancel;
  // Langes Drücken auf dem Telefon soll kein Kontextmenü und keine Textauswahl öffnen.
  ptt.oncontextmenu = (e) => e.preventDefault();
  // Die Leertaste bleibt reines Halten; ihr Loslassen löst auch eine eingerastete Taste.
  const press = (p: boolean) => (p ? apply(true) : (cancel(), apply(false)));
  const unbindKeys = bindPttKeys(window, press, isTyping, isPtt);
  // Ohne echte Tastatur und Maus (Telefon, Tablet) gibt es keine Leertaste zu erwähnen.
  ptt.querySelector<HTMLElement>('.ptt-hint')!.hidden = !matchMedia('(hover: hover) and (pointer: fine)').matches;

  const me = $('me-speaking');
  const level = $('vad-level');
  capture?.onActivity((a) => {
    me.hidden = !a.open;
    level.style.width = `${Math.min(1, Math.max(0, a.vad)) * 100}%`;
    level.classList.toggle('open', a.open);
  });

  render();
  return { render, setPressed: press, unbind: unbindKeys };
}
