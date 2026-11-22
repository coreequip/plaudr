import type { CaptureActivity } from '../audio/messages';
import { listMics, micChoices } from '../audio/devices';
import type { AudioSettings } from '../audio/settings';
import type { Identity } from '../crypto/identity';
import { fingerprintWords } from '../crypto/words';
import { mountBackupPanel, showBackupState } from './backup-panel';
import type { UiPrefs } from './prefs';
import { accentFor } from './theme';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export interface SettingsOptions {
  audio(): AudioSettings;
  setAudio(p: Partial<AudioSettings>): Promise<void>;
  /** null: kein Pegel verfügbar. */
  activity(): CaptureActivity | null;
  prefs(): UiPrefs;
  setPrefs(p: Partial<UiPrefs>): void;
  name(): string;
  setName(n: string): void;
  identity(): Identity | null;
  /** Im Gespräch gilt ein neuer Name erst beim nächsten Beitritt. */
  inCall(): boolean;
  back(): void;
}

export interface SettingsView {
  show(): void;
  hide(): void;
  /** Mikrofonliste neu laden, etwa sobald die Freigabe da ist und es Gerätenamen gibt. */
  refreshMics(): Promise<void>;
  /** Identität hat sich geändert (geladen, gesichert, aus einer Sicherung übernommen). */
  refreshIdentity(): void;
}

/** Farbton des Standardgrüns (#0f5c1a); steht auf dem Regler, solange keiner gewählt ist. */
export const DEFAULT_HUE = 128;

/** „tiger · anker · wolke · mond“ */
export const wordsLine = (words: string[]): string => words.join(' · ');

interface PreviewColors {
  bg: string;
  line: string;
  muted: string;
  accent: string;
  accentFg: string;
}

/** Farben der beiden Vorschaukacheln; Flächen wie die Tokens in style.css, Akzent nach Farbton. */
export function previewColors(hue: number | null): { light: PreviewColors; dark: PreviewColors } {
  const light = { bg: '#f6f5f2', line: '#dedcd6', muted: '#6b6a66', accent: '#0f5c1a', accentFg: '#ffffff' };
  const dark = { bg: '#161615', line: '#34332f', muted: '#9b9a95', accent: '#4caf5c', accentFg: '#0d0d0c' };
  if (hue === null) return { light, dark };
  const p = accentFor(hue);
  return {
    light: { ...light, accent: p.light.accent, accentFg: p.light.accentFg },
    dark: { ...dark, accent: p.dark.accent, accentFg: p.dark.accentFg },
  };
}

const pct = (t: number) => `${Math.round(t * 100)} %`;
const THEMES: UiPrefs['theme'][] = ['system', 'light', 'dark'];

/** Bildschirm „Einstellungen“ (Spec §7): Push-to-Talk-Hinweis, Mikrofon, Darstellung, Identität, Start. */
export function initSettings(o: SettingsOptions): SettingsView {
  const mic = $<HTMLSelectElement>('mic-select');
  const threshold = $<HTMLInputElement>('vad-threshold');
  const level = $('settings-level');
  const mark = $('settings-mark');
  const denoise = $<HTMLInputElement>('settings-denoise');
  const hue = $<HTMLInputElement>('hue');
  const nameInput = $<HTMLInputElement>('settings-name');
  const done = $('settings-identity-done');
  const backup = $('backup');
  const restore = $<HTMLDetailsElement>('restore');
  let timer: ReturnType<typeof setInterval> | null = null;
  // Verhindert, dass eine ältere Wortberechnung eine neuere Identität überschreibt.
  let wordsFor: Identity | null = null;
  // Was zuletzt angestoßen wurde, damit die Bestätigung passt.
  let pending: 'backup' | 'restore' | null = null;

  const showThreshold = (t: number) => {
    $('vad-threshold-value').textContent = pct(t);
    mark.style.left = `${t * 100}%`;
  };

  const renderPrefs = () => {
    const p = o.prefs();
    for (const t of THEMES) $(`theme-${t}`).setAttribute('aria-pressed', String(p.theme === t));
    const h = p.hue ?? DEFAULT_HUE;
    hue.value = String(h);
    $('hue-value').textContent = `Farbton ${h}°`;
    const colors = previewColors(p.hue);
    for (const [id, c] of [['preview-light', colors.light], ['preview-dark', colors.dark]] as const) {
      const s = $(id).style;
      s.setProperty('--p-bg', c.bg);
      s.setProperty('--p-line', c.line);
      s.setProperty('--p-muted', c.muted);
      s.setProperty('--p-accent', c.accent);
      s.setProperty('--p-accent-fg', c.accentFg);
    }
    $<HTMLInputElement>('auto-join').checked = p.autoJoin;
  };

  const renderAudio = () => {
    const s = o.audio();
    threshold.value = String(Math.round(s.threshold * 100));
    showThreshold(s.threshold);
    denoise.checked = s.denoise;
  };

  const renderIdentity = () => {
    const id = o.identity();
    const words = $('my-words');
    for (const b of ['settings-backup', 'settings-restore']) $<HTMLButtonElement>(b).disabled = !id;
    if (!id) {
      wordsFor = null;
      words.textContent = '';
      return;
    }
    if (wordsFor === id) return;
    wordsFor = id;
    void fingerprintWords(id.pub).then((w) => {
      if (wordsFor === id) words.textContent = wordsLine(w);
    });
  };

  const refreshMics = async () => {
    const choices = micChoices(await listMics(), o.audio().deviceId);
    mic.replaceChildren(
      ...choices.map((c) => {
        const opt = document.createElement('option');
        opt.value = c.value;
        opt.textContent = c.label;
        opt.selected = c.selected;
        return opt;
      }),
    );
  };

  mic.onchange = () => void o.setAudio({ deviceId: mic.value || null });
  threshold.oninput = () => {
    const t = Number(threshold.value) / 100;
    showThreshold(t);
    void o.setAudio({ threshold: t });
  };
  denoise.onchange = () => void o.setAudio({ denoise: denoise.checked });

  for (const t of THEMES) {
    $(`theme-${t}`).onclick = () => {
      o.setPrefs({ theme: t });
      renderPrefs();
    };
  }
  hue.oninput = () => {
    o.setPrefs({ hue: Number(hue.value) });
    renderPrefs();
  };
  $('hue-reset').onclick = () => {
    o.setPrefs({ hue: null });
    renderPrefs();
  };
  $<HTMLInputElement>('auto-join').onchange = (e) => o.setPrefs({ autoJoin: (e.target as HTMLInputElement).checked });

  // Leer wird nicht übernommen: dann steht wieder der gespeicherte Name da.
  nameInput.onchange = () => {
    const n = nameInput.value.trim();
    if (n) o.setName(n);
    nameInput.value = o.name();
  };

  const openPanel = (what: 'backup' | 'restore') => {
    mountBackupPanel($('backup-slot'));
    pending = what;
    done.hidden = true;
    backup.hidden = false;
    restore.open = what === 'restore';
    $<HTMLInputElement>(what === 'backup' ? 'backup-pw' : 'restore-file').focus();
  };
  $('settings-backup').onclick = () => openPanel('backup');
  $('settings-restore').onclick = () => openPanel('restore');

  $('settings-back').onclick = () => o.back();

  return {
    show() {
      renderAudio();
      renderPrefs();
      renderIdentity();
      nameInput.value = o.name();
      $('settings-name-hint').hidden = !o.inCall();
      done.hidden = true;
      void refreshMics();
      if (timer) clearInterval(timer);
      timer = setInterval(() => {
        const a = o.activity();
        level.style.width = `${Math.min(1, Math.max(0, a?.vad ?? 0)) * 100}%`;
        level.classList.toggle('open', !!a?.open);
      }, 100);
    },
    hide() {
      if (timer) clearInterval(timer);
      timer = null;
      pending = null;
      // Zurück in die Lobby, mit dem Zustand, den sie dort braucht (Pflicht oder Angebot).
      $('lobby-notice').after(backup);
      restore.open = false;
      const id = o.identity();
      if (id) showBackupState(id);
      else backup.hidden = true;
    },
    refreshMics,
    refreshIdentity() {
      renderIdentity();
      // Die Karte versteckt sich nach Erfolg selbst (gleich nach diesem Aufruf, daher Microtask);
      // statt einer leeren Stelle steht dann eine kurze Bestätigung da.
      queueMicrotask(() => {
        if (!pending || !backup.hidden || backup.parentElement !== $('backup-slot')) return;
        done.textContent = pending === 'backup' ? 'Schlüssel gesichert.' : 'Sicherung geladen.';
        done.hidden = false;
        pending = null;
      });
    },
  };
}
