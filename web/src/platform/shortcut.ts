import { detectOs, type Platform } from './platform';

/** Was acceleratorFrom von einem keydown braucht. */
export interface KeyLike {
  key: string;
  code: string;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}

type Os = Platform['os'];

/** Modifikatoren im Tauri-Format, in dieser Reihenfolge geschrieben. */
const MODIFIERS = ['Control', 'CommandOrControl', 'Alt', 'Shift', 'Super'] as const;
type Modifier = (typeof MODIFIERS)[number];

/** Gehen auch ohne Modifikator: Sie liegen auf keiner normalen Taste, blockieren also nichts beim Tippen. */
const BARE = /^F(1[3-9]|2[0-4])$/;

/**
 * Haupttasten, die tauri-plugin-global-shortcut (global-hotkey 0.8) als KeyboardEvent.code versteht. Bewusst ohne
 * Escape (bricht die Aufnahme ab), Feststelltasten und Medientasten.
 */
const KEYS = new Set([
  ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map((c) => `Key${c}`),
  ...'0123456789'.split('').map((d) => `Digit${d}`),
  ...'0123456789'.split('').map((d) => `Numpad${d}`),
  ...Array.from({ length: 24 }, (_, i) => `F${i + 1}`),
  'Backquote', 'Backslash', 'BracketLeft', 'BracketRight', 'Comma', 'Equal', 'Minus', 'Period', 'Quote', 'Semicolon', 'Slash',
  'Backspace', 'Enter', 'Space', 'Tab', 'Delete', 'End', 'Home', 'Insert', 'PageDown', 'PageUp', 'Pause', 'PrintScreen',
  'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowUp',
  'NumpadAdd', 'NumpadDecimal', 'NumpadDivide', 'NumpadEnter', 'NumpadEqual', 'NumpadMultiply', 'NumpadSubtract',
]);

const MODIFIER_CODE = /^(Shift|Control|Alt|Meta|OS)(Left|Right)?$/;
const MODIFIER_KEY = new Set(['Shift', 'Control', 'Alt', 'AltGraph', 'Meta', 'OS', 'Super', 'Hyper', 'Fn', 'CapsLock']);

/** Eine reine Modifikatortaste (Umschalt, Wahl, Befehl, Strg) ist noch kein Kürzel; die Aufnahme wartet weiter. */
export function isModifierKey(e: Pick<KeyLike, 'key' | 'code'>): boolean {
  return MODIFIER_CODE.test(e.code) || MODIFIER_KEY.has(e.key);
}

/**
 * Kürzel im Format von Tauri aus einem keydown, etwa `Alt+Space`, `CommandOrControl+Shift+KeyP`, `F13`. Zählt
 * die physische Taste (code), weil die Wahltaste auf dem Mac den Buchstaben ändert (⌥P = π). null ohne
 * Modifikator (außer F13 bis F24), bei reinen Modifikatortasten, Escape und unbekannten Tasten.
 * Auf dem Mac ist ⌘ CommandOrControl und ⌃ Control; sonst ist Strg CommandOrControl und die Windows-Taste Super.
 */
export function acceleratorFrom(e: KeyLike, os: Os = detectOs()): string | null {
  if (isModifierKey(e) || !KEYS.has(e.code)) return null;
  const mac = os === 'mac';
  const mods: Modifier[] = [];
  if (mac && e.ctrlKey) mods.push('Control');
  if (mac ? e.metaKey : e.ctrlKey) mods.push('CommandOrControl');
  if (e.altKey) mods.push('Alt');
  if (e.shiftKey) mods.push('Shift');
  if (!mac && e.metaKey) mods.push('Super');
  if (mods.length === 0 && !BARE.test(e.code)) return null;
  return [...mods, e.code].join('+');
}

/** Gilt dieselbe Regel wie bei acceleratorFrom: etwa für gespeicherte Werte. */
export function isValidAccelerator(accel: string): boolean {
  const parts = accel.split('+');
  const key = parts.pop()!;
  if (!KEYS.has(key)) return false;
  if (new Set(parts).size !== parts.length) return false;
  if (!parts.every((p) => (MODIFIERS as readonly string[]).includes(p))) return false;
  return parts.length > 0 || BARE.test(key);
}

const MAC_MODS: Record<Modifier, string> = { Control: '⌃', CommandOrControl: '⌘', Alt: '⌥', Shift: '⇧', Super: '⌘' };
const WIN_MODS: Record<Modifier, string> = { Control: 'Strg', CommandOrControl: 'Strg', Alt: 'Alt', Shift: 'Umschalt', Super: 'Win' };
const KEY_NAMES: Record<string, string> = {
  Space: 'Leertaste',
  Enter: 'Eingabe',
  Backspace: 'Rücktaste',
  Delete: 'Entf',
  Insert: 'Einfg',
  Home: 'Pos1',
  End: 'Ende',
  PageUp: 'Bild auf',
  PageDown: 'Bild ab',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  Backquote: '`',
  Backslash: '\\',
  BracketLeft: '[',
  BracketRight: ']',
  Comma: ',',
  Equal: '=',
  Minus: '-',
  Period: '.',
  Quote: "'",
  Semicolon: ';',
  Slash: '/',
};

function keyName(code: string): string {
  if (KEY_NAMES[code]) return KEY_NAMES[code];
  const m = /^(?:Key|Digit)(.)$/.exec(code);
  if (m) return m[1];
  if (code.startsWith('Numpad')) return `Num ${code.slice(6)}`;
  return code;
}

/** Anzeige eines Kürzels: Mac `⌥ Leertaste`, `⌘ ⇧ P`; Windows `Alt+Leertaste`, `Strg+Umschalt+P`. */
export function shortcutLabel(accel: string, os: Os): string {
  const parts = accel.split('+');
  const key = keyName(parts.pop()!);
  const mac = os === 'mac';
  const names = mac ? MAC_MODS : WIN_MODS;
  const mods = parts.map((p) => names[p as Modifier] ?? p);
  return [...mods, key].join(mac ? ' ' : '+');
}

export type RecordStep = { kind: 'cancel' } | { kind: 'wait' } | { kind: 'invalid' } | { kind: 'key'; accel: string };

/** Ein keydown während „Neue Taste aufnehmen“: Escape bricht ab, Modifikatoren allein warten weiter. */
export function recordKey(e: KeyLike, os: Os = detectOs()): RecordStep {
  if (e.code === 'Escape' || e.key === 'Escape') return { kind: 'cancel' };
  if (isModifierKey(e)) return { kind: 'wait' };
  const accel = acceleratorFrom(e, os);
  return accel ? { kind: 'key', accel } : { kind: 'invalid' };
}

/** Das Nötigste aus @tauri-apps/plugin-global-shortcut, damit sich GlobalPtt ohne Tauri testen lässt. */
export interface ShortcutApi {
  register(accel: string, cb: (state: 'Pressed' | 'Released') => void): Promise<void>;
  unregister(accel: string): Promise<void>;
}

/**
 * Globale Push-to-Talk-Taste: Halten sendet, Loslassen beendet, wie die Leertaste (kein Einrasten).
 * Meldet nur Wechsel. Darf nie „gedrückt“ hängen bleiben: Kürzelwechsel, Entfernen und release() lösen immer.
 * Pressed außerhalb von Push-to-Talk wird ignoriert, Released kommt immer durch.
 */
export class GlobalPtt {
  /** Die registrierte Taste; null, wenn keine registriert ist. */
  current: string | null = null;
  private pressed = false;

  constructor(
    private readonly api: ShortcutApi,
    private readonly onPressed: (b: boolean) => void,
    private readonly isActive: () => boolean,
  ) {}

  /**
   * Belegt eine neue Taste (null entfernt). Die neue wird registriert, bevor die alte abgemeldet wird: Ist sie
   * vergeben, liefert set ok: false und die alte bleibt registriert.
   */
  async set(accel: string | null): Promise<{ ok: boolean }> {
    this.release();
    if (accel === this.current) return { ok: true };
    const old = this.current;
    if (accel) {
      try {
        await this.api.register(accel, (s) => this.handle(accel, s));
      } catch (err) {
        console.warn('[plaudr] Taste nicht belegbar', accel, err);
        return { ok: false };
      }
    }
    this.current = accel;
    // Zwischen den Aufrufen könnte die alte Taste noch gedrückt worden sein.
    this.release();
    if (old) {
      try {
        await this.api.unregister(old);
      } catch (err) {
        console.warn('[plaudr] Taste nicht abmeldbar', old, err);
      }
    }
    return { ok: true };
  }

  /** Moduswechsel, Gespräch verlassen: gilt als losgelassen. */
  release(): void {
    this.change(false);
  }

  private handle(accel: string, state: 'Pressed' | 'Released'): void {
    // Späte Ereignisse einer abgelösten Taste zählen nicht mehr.
    if (accel !== this.current) return;
    if (state === 'Released') return this.change(false);
    if (this.isActive()) this.change(true);
  }

  private change(p: boolean): void {
    if (p === this.pressed) return;
    this.pressed = p;
    this.onPressed(p);
  }
}
