import type { SpeakMode } from '../audio/gate';
import { webPlatform } from './web';

export interface AppState {
  inCall: boolean;
  roomTitle: string | null;
  peerCount: number;
  mode: SpeakMode;
  sending: boolean;
  hasMic: boolean;
}

export interface AppActions {
  setMode(m: SpeakMode): void;
  setPressed(b: boolean): void;
  /** Verlässt den Raum und löst danach auf, ohne die Seite zu wechseln. */
  leave(): Promise<void>;
  showWindow?(): void;
}

/** Globale Push-to-Talk-Taste (nur Desktop). */
export interface PttShortcut {
  /** Gespeicherte Taste im Tauri-Format, auch wenn sie sich nicht belegen ließ. */
  current(): string | null;
  /** false: Die gespeicherte Taste ist von einem anderen Programm vergeben und wirkt nicht. */
  registered(): boolean;
  label(accel: string): string;
  /** Belegt und speichert die Taste (null entfernt). ok: false heißt vergeben; die bisherige bleibt. */
  set(accel: string | null): Promise<{ ok: boolean }>;
  /** Wird nach jeder Änderung aufgerufen, auch wenn die Registrierung beim Start erst später fertig wird. */
  onChange(cb: () => void): void;
  /** Erfüllt, sobald die gespeicherte Taste beim Start belegt (oder als vergeben erkannt) ist. */
  readonly ready: Promise<void>;
}

export interface Platform {
  readonly kind: 'web' | 'desktop';
  readonly os: 'mac' | 'windows' | 'other';
  /** false = abgebrochen. */
  saveText(fileName: string, text: string): Promise<boolean>;
  openText(accept: string[]): Promise<{ name: string; text: string } | null>;
  /** Wird bei jedem Wechsel des App-Zustands aufgerufen (Tray, globale Taste). Im Browser leer. */
  update(s: AppState): void;
  /** Nur im Desktop-Client. */
  readonly pttShortcut?: PttShortcut;
}

/** Bezeichnung der wirksamen globalen Taste für den Hinweis am PTT-Knopf; null ohne (oder ohne wirksame) Taste. */
export function activeShortcutLabel(p: Pick<Platform, 'pttShortcut'> | null): string | null {
  const k = p?.pttShortcut;
  const a = k?.current();
  return k && a && k.registered() ? k.label(a) : null;
}

export function isDesktop(w: Window = window): boolean {
  return '__TAURI_INTERNALS__' in w;
}

export function detectOs(userAgent: string = navigator.userAgent): Platform['os'] {
  if (/Mac OS X/.test(userAgent)) return 'mac';
  if (/Windows/.test(userAgent)) return 'windows';
  return 'other';
}

/**
 * Der Desktop-Zweig ist ein eigener Chunk: Das Web-Bündel enthält keinen Tauri-Code. Schlägt das Laden fehl
 * (veralteter Chunk nach einem Deploy, Netz), bleibt es bei der Browser-Plattform; loadPlatform lehnt nie ab.
 */
export async function loadPlatform(actions: AppActions, w: Window = window): Promise<Platform> {
  if (isDesktop(w)) {
    try {
      return (await import('./desktop')).desktopPlatform(actions);
    } catch (err) {
      console.warn('[plaudr] Desktop-Anbindung nicht ladbar, Browser-Verhalten', err);
    }
  }
  return webPlatform();
}
