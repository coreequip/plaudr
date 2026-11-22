import type { SpeakMode } from './gate';

export interface AudioSettings {
  mode: SpeakMode;
  threshold: number;
  denoise: boolean;
  preroll: boolean;
  /** Gemerktes Eingabegerät; null: Standardgerät. */
  deviceId: string | null;
}

export const DEFAULT_AUDIO: AudioSettings = { mode: 'vad', threshold: 0.85, denoise: true, preroll: true, deviceId: null };

const KEY = 'plaudr.audio';
const MODES: readonly SpeakMode[] = ['vad', 'ptt', 'muted'];

export function loadAudioSettings(storage?: Storage): AudioSettings {
  let raw: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse((storage ?? localStorage).getItem(KEY) ?? '{}');
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
    deviceId: typeof raw.deviceId === 'string' && raw.deviceId !== '' ? raw.deviceId : d.deviceId,
  };
}

export function saveAudioSettings(s: AudioSettings, storage?: Storage): void {
  try {
    (storage ?? localStorage).setItem(KEY, JSON.stringify(s));
  } catch {
    /* privater Modus: Einstellungen werden nicht gemerkt */
  }
}
