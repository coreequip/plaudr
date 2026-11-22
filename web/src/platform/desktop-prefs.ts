import type { Platform, PttShortcut } from './platform';
import { isValidAccelerator, shortcutLabel, type GlobalPtt } from './shortcut';

/** Einstellungen, die es nur im Desktop-Client gibt. */
export interface DesktopPrefs {
  /** Globale Push-to-Talk-Taste im Tauri-Format; ohne Vorgabe (Spec §7). */
  pttShortcut: string | null;
  /** Der einmalige Hinweis „plaudr läuft im Tray weiter.“ wurde gezeigt. */
  trayNoticeShown: boolean;
}

const KEY = 'plaudr.desktop';

export function loadDesktopPrefs(storage?: Storage): DesktopPrefs {
  try {
    const raw: unknown = JSON.parse((storage ?? localStorage).getItem(KEY) ?? '{}');
    const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
    const s = o.pttShortcut;
    return {
      pttShortcut: typeof s === 'string' && isValidAccelerator(s) ? s : null,
      trayNoticeShown: o.trayNoticeShown === true,
    };
  } catch {
    // Kaputt oder nicht lesbar: keine Taste, Hinweis noch nicht gezeigt.
    return { pttShortcut: null, trayNoticeShown: false };
  }
}

/** Schreibt die genannten Felder; die übrigen bleiben, wie sie gespeichert sind. */
export function saveDesktopPrefs(p: Partial<DesktopPrefs>, storage?: Storage): void {
  const next = { ...loadDesktopPrefs(storage), ...p };
  if (next.pttShortcut && !isValidAccelerator(next.pttShortcut)) next.pttShortcut = null;
  try {
    (storage ?? localStorage).setItem(KEY, JSON.stringify(next));
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
): PttShortcut {
  let wanted = loadDesktopPrefs(storage).pttShortcut;
  const listeners: (() => void)[] = [];
  const changed = () => {
    for (const l of listeners) l();
  };
  // Bis die Startregistrierung fertig ist, ist „vergeben“ noch nicht bekannt; solange gilt die Taste als wirksam.
  let settled = false;
  const ready = (wanted ? ptt.set(wanted) : Promise.resolve({ ok: true })).then(() => {
    settled = true;
    changed();
  });
  return {
    ready,
    current: () => wanted,
    registered: () => !settled || ptt.current === wanted,
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
