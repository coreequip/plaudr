import type { Platform, PttShortcut } from './platform';
import { isValidAccelerator, shortcutLabel, type GlobalPtt } from './shortcut';

/** Einstellungen, die es nur im Desktop-Client gibt. */
export interface DesktopPrefs {
  /** Globale Push-to-Talk-Taste im Tauri-Format; ohne Vorgabe (Spec §7). */
  pttShortcut: string | null;
}

const KEY = 'plaudr.desktop';

export function loadDesktopPrefs(storage?: Storage): DesktopPrefs {
  try {
    const raw: unknown = JSON.parse((storage ?? localStorage).getItem(KEY) ?? '{}');
    const s = raw && typeof raw === 'object' ? (raw as Record<string, unknown>).pttShortcut : null;
    return { pttShortcut: typeof s === 'string' && isValidAccelerator(s) ? s : null };
  } catch {
    // Kaputt oder nicht lesbar: keine Taste.
    return { pttShortcut: null };
  }
}

export function saveDesktopPrefs(p: DesktopPrefs, storage?: Storage): void {
  const pttShortcut = p.pttShortcut && isValidAccelerator(p.pttShortcut) ? p.pttShortcut : null;
  try {
    (storage ?? localStorage).setItem(KEY, JSON.stringify({ pttShortcut }));
  } catch {
    /* privater Modus: wird nicht gemerkt */
  }
}

/**
 * Verbindet die gespeicherte Taste mit GlobalPtt: belegt sie beim Start und speichert nur, was sich belegen ließ.
 * Ist eine Taste vergeben, bleibt die gespeicherte erhalten (registered() sagt, ob sie wirkt).
 */
export function createPttShortcut(
  ptt: GlobalPtt,
  os: Platform['os'],
  storage?: Storage,
): PttShortcut & { ready: Promise<void> } {
  let wanted = loadDesktopPrefs(storage).pttShortcut;
  const listeners: (() => void)[] = [];
  const changed = () => {
    for (const l of listeners) l();
  };
  const ready = (wanted ? ptt.set(wanted) : Promise.resolve({ ok: true })).then(changed);
  return {
    ready,
    current: () => wanted,
    registered: () => ptt.current === wanted,
    label: (a) => shortcutLabel(a, os),
    async set(accel) {
      await ready;
      if (accel !== null && !isValidAccelerator(accel)) return { ok: false };
      const r = await ptt.set(accel);
      if (r.ok) {
        wanted = accel;
        saveDesktopPrefs({ pttShortcut: accel }, storage);
      }
      changed();
      return r;
    },
    onChange: (cb) => void listeners.push(cb),
  };
}
