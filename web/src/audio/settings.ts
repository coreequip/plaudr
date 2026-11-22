import type { SpeakMode } from './gate';

export interface AudioSettings {
  mode: SpeakMode;
  threshold: number;
  denoise: boolean;
  preroll: boolean;
}

export const DEFAULT_AUDIO: AudioSettings = { mode: 'vad', threshold: 0.85, denoise: true, preroll: true };

const KEY = 'plaudr.audio';
const MODES: readonly SpeakMode[] = ['vad', 'ptt', 'muted'];

export function loadAudioSettings(storage: Storage = localStorage): AudioSettings {
  let raw: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(storage.getItem(KEY) ?? '{}');
    if (parsed && typeof parsed === 'object') raw = parsed as Record<string, unknown>;
  } catch {
    /* kaputt oder nicht lesbar: Standard */
  }
  const d = DEFAULT_AUDIO;
  return {
    mode: MODES.includes(raw.mode as SpeakMode) ? (raw.mode as SpeakMode) : d.mode,
    threshold: typeof raw.threshold === 'number' && Number.isFinite(raw.threshold) ? Math.min(0.99, Math.max(0.5, raw.threshold)) : d.threshold,
    denoise: typeof raw.denoise === 'boolean' ? raw.denoise : d.denoise,
    preroll: typeof raw.preroll === 'boolean' ? raw.preroll : d.preroll,
  };
}

export function saveAudioSettings(s: AudioSettings, storage: Storage = localStorage): void {
  try {
    storage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* privater Modus: Einstellungen werden nicht gemerkt */
  }
}
