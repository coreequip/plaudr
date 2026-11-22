export interface UiPrefs {
  theme: 'system' | 'light' | 'dark';
  hue: number | null;
  autoJoin: boolean;
}

export const DEFAULT_PREFS: UiPrefs = { theme: 'system', hue: null, autoJoin: true };

const KEY = 'plaudr.ui';
const THEMES: readonly UiPrefs['theme'][] = ['system', 'light', 'dark'];

// Farbton ganzzahlig 0 bis 359; 360 zählt als 0, alles andere ist "kein Farbton".
function normalizeHue(v: unknown): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  const h = Math.round(v);
  if (h === 360) return 0;
  return h >= 0 && h <= 359 ? h : null;
}

export function loadPrefs(storage?: Storage): UiPrefs {
  let raw: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse((storage ?? localStorage).getItem(KEY) ?? '{}');
    if (parsed && typeof parsed === 'object') raw = parsed as Record<string, unknown>;
  } catch {
    /* kaputt oder nicht lesbar: Standard */
  }
  const d = DEFAULT_PREFS;
  return {
    theme: THEMES.includes(raw.theme as UiPrefs['theme']) ? (raw.theme as UiPrefs['theme']) : d.theme,
    hue: normalizeHue(raw.hue),
    autoJoin: typeof raw.autoJoin === 'boolean' ? raw.autoJoin : d.autoJoin,
  };
}

export function savePrefs(p: UiPrefs, storage?: Storage): void {
  try {
    (storage ?? localStorage).setItem(KEY, JSON.stringify(p));
  } catch {
    /* privater Modus: Einstellungen werden nicht gemerkt */
  }
}
