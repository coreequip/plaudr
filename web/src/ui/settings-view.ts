import type { CaptureActivity } from '../audio/messages';
import { listMics, micChoices } from '../audio/devices';
import type { AudioSettings } from '../audio/settings';
import type { Identity } from '../crypto/identity';
import type { PeerView } from '../mesh/mesh';
import { fingerprintWords } from '../crypto/words';
import { mountBackupPanel, showBackupState } from './backup-panel';
import type { UiPrefs } from './prefs';
import { accentFor } from './theme';
import { wordsOf } from './view';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export interface SettingsOptions {
  audio(): AudioSettings;
  setAudio(p: Partial<AudioSettings>): Promise<void>;
  /** null: kein Pegel verfügbar. */
  activity(): CaptureActivity | null;
  prefs(): UiPrefs;
  /** Vollständige Einstellungen; die Ansicht hält sie selbst, falls der Speicher nichts behält. */
  setPrefs(p: UiPrefs): void;
  name(): string;
  setName(n: string): void;
  identity(): Identity | null;
  /** Die Identität, mit der das laufende Gespräch signiert; außerhalb eines Gesprächs dieselbe wie identity(). */
  identityInUse(): Identity | null;
  /** Andere Teilnehmer des laufenden Gesprächs; leer außerhalb. */
  peers(): PeerView[];
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
  /** Teilnehmer haben sich geändert (Liste „Im Raum“ mit ihren Wörtern). */
  refreshPeers(): void;
}

/** Farbton des Standardgrüns (#0f5c1a); steht auf dem Regler, solange keiner gewählt ist. */
export const DEFAULT_HUE = 128;

/** „tiger · anker · blume · regen“ */
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
  // Einstellungen im Speicher der Ansicht: Wirft localStorage, springen Regler und Knöpfe nicht auf Standard zurück.
  let prefs: UiPrefs = o.prefs();
  const setPrefs = (p: Partial<UiPrefs>) => {
    prefs = { ...prefs, ...p };
    o.setPrefs(prefs);
  };

  const showThreshold = (t: number) => {
    $('vad-threshold-value').textContent = pct(t);
    mark.style.left = `${t * 100}%`;
  };

  // Beim Ziehen am Farbton schreibt die Ansicht den Regler nicht zurück, sonst springt der Griff.
  const renderPrefs = (fromHue = false) => {
    const p = prefs;
    for (const t of THEMES) $(`theme-${t}`).setAttribute('aria-pressed', String(p.theme === t));
    const h = p.hue ?? DEFAULT_HUE;
    if (!fromHue) hue.value = String(h);
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
    const stored = o.identity();
    const id = o.identityInUse();
    const words = $('my-words');
    for (const b of ['settings-backup', 'settings-restore']) $<HTMLButtonElement>(b).disabled = !stored;
    // Im Gespräch geladene Sicherung: Das Gespräch signiert weiter mit dem alten Schlüssel, dessen Wörter bleiben stehen.
    $('settings-restore-hint').hidden = !(o.inCall() && stored && id && stored.pub !== id.pub);
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

  // Zum Vergleichen am Telefon: Name und vier Wörter jedes anderen im Gespräch (Spec §4, §7).
  let peersToken = 0;
  const renderPeerWords = () => {
    const peers = o.inCall() ? o.peers().filter((p) => p.pub) : [];
    $('room-words').hidden = peers.length === 0;
    const token = ++peersToken;
    void Promise.all(peers.map((p) => wordsOf(p.pub))).then((all) => {
      if (token !== peersToken) return;
      $('room-words-list').replaceChildren(
        ...peers.map((p, i) => {
          const li = document.createElement('li');
          li.dataset.peer = p.peerId;
          const name = document.createElement('span');
          name.className = 'name';
          name.textContent = p.name || 'Unbekannt';
          const words = document.createElement('span');
          words.className = 'words';
          words.textContent = all[i];
          li.append(name, words);
          return li;
        }),
      );
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
      setPrefs({ theme: t });
      renderPrefs();
    };
  }
  hue.oninput = () => {
    setPrefs({ hue: Number(hue.value) });
    renderPrefs(true);
  };
  $('hue-reset').onclick = () => {
    setPrefs({ hue: null });
    renderPrefs();
  };
  $<HTMLInputElement>('auto-join').onchange = (e) => setPrefs({ autoJoin: (e.target as HTMLInputElement).checked });

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
      renderPeerWords();
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
    refreshPeers() {
      if (!$('settings').hidden) renderPeerWords();
    },
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
