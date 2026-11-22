import { describe, expect, test } from 'vitest';
import { acceleratorFrom, GlobalPtt, isValidAccelerator, recordKey, shortcutLabel, type ShortcutApi } from './shortcut';

const taste = (code: string, key: string, mods: Partial<Record<'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey', boolean>> = {}) => ({
  code,
  key,
  altKey: false,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  ...mods,
});

describe('acceleratorFrom', () => {
  test('Alt+Leertaste', () => {
    expect(acceleratorFrom(taste('Space', ' ', { altKey: true }), 'mac')).toBe('Alt+Space');
  });
  test('Cmd+Shift+P auf dem Mac', () => {
    expect(acceleratorFrom(taste('KeyP', 'P', { metaKey: true, shiftKey: true }), 'mac')).toBe('CommandOrControl+Shift+KeyP');
  });
  test('Strg+Umschalt+P unter Windows', () => {
    expect(acceleratorFrom(taste('KeyP', 'P', { ctrlKey: true, shiftKey: true }), 'windows')).toBe('CommandOrControl+Shift+KeyP');
  });
  test('Ctrl auf dem Mac ist nicht Cmd, Windows-Taste ist Super', () => {
    expect(acceleratorFrom(taste('KeyP', 'p', { ctrlKey: true }), 'mac')).toBe('Control+KeyP');
    expect(acceleratorFrom(taste('KeyP', 'p', { metaKey: true }), 'windows')).toBe('Super+KeyP');
  });
  test('Wahltaste verändert key, zählt aber code', () => {
    expect(acceleratorFrom(taste('KeyP', 'π', { altKey: true }), 'mac')).toBe('Alt+KeyP');
  });
  test('F13 bis F24 gehen ohne Modifikator', () => {
    expect(acceleratorFrom(taste('F13', 'F13'), 'mac')).toBe('F13');
    expect(acceleratorFrom(taste('F24', 'F24'), 'windows')).toBe('F24');
  });
  test('F12 ohne Modifikator ist ungültig', () => {
    expect(acceleratorFrom(taste('F12', 'F12'), 'mac')).toBeNull();
  });
  test('nur P ist ungültig', () => {
    expect(acceleratorFrom(taste('KeyP', 'p'), 'mac')).toBeNull();
  });
  test('nur Umschalt ist ungültig', () => {
    expect(acceleratorFrom(taste('ShiftLeft', 'Shift', { shiftKey: true }), 'mac')).toBeNull();
  });
  test('reine Modifikatoren mit weiteren Modifikatoren sind ungültig', () => {
    expect(acceleratorFrom(taste('AltLeft', 'Alt', { altKey: true, metaKey: true }), 'mac')).toBeNull();
  });
  test('Escape ist ungültig, auch mit Modifikator', () => {
    expect(acceleratorFrom(taste('Escape', 'Escape'), 'mac')).toBeNull();
    expect(acceleratorFrom(taste('Escape', 'Escape', { altKey: true }), 'mac')).toBeNull();
  });
  test('unbekannte Taste ist ungültig', () => {
    expect(acceleratorFrom(taste('', 'Unidentified', { altKey: true }), 'mac')).toBeNull();
  });
});

describe('isValidAccelerator', () => {
  test('erkennt gültige Kürzel', () => {
    for (const a of ['Alt+Space', 'CommandOrControl+Shift+KeyP', 'F13', 'Control+Alt+Digit1']) expect(isValidAccelerator(a)).toBe(true);
  });
  test('lehnt ungültige ab', () => {
    for (const a of ['', 'KeyP', 'Shift', 'Alt+Shift', 'Alt+Escape', 'Alt+Space+KeyP', 'Hyper+KeyP', 'Alt+', 'F12', 'Alt+Alt+KeyP'])
      expect(isValidAccelerator(a), a).toBe(false);
  });
});

describe('shortcutLabel', () => {
  test('Mac mit Symbolen', () => {
    expect(shortcutLabel('Alt+Space', 'mac')).toBe('⌥ Leertaste');
    expect(shortcutLabel('CommandOrControl+Shift+KeyP', 'mac')).toBe('⌘ ⇧ P');
    expect(shortcutLabel('Control+Digit1', 'mac')).toBe('⌃ 1');
    expect(shortcutLabel('F13', 'mac')).toBe('F13');
  });
  test('Windows mit Namen', () => {
    expect(shortcutLabel('Alt+Space', 'windows')).toBe('Alt+Leertaste');
    expect(shortcutLabel('CommandOrControl+Shift+KeyP', 'windows')).toBe('Strg+Umschalt+P');
    expect(shortcutLabel('Super+KeyP', 'windows')).toBe('Win+P');
  });
});

describe('recordKey', () => {
  test('Escape bricht ab', () => {
    expect(recordKey(taste('Escape', 'Escape'), 'mac')).toEqual({ kind: 'cancel' });
  });
  test('reine Modifikatortaste wartet weiter', () => {
    expect(recordKey(taste('AltLeft', 'Alt', { altKey: true }), 'mac')).toEqual({ kind: 'wait' });
  });
  test('Taste ohne Modifikator ist ungültig', () => {
    expect(recordKey(taste('KeyP', 'p'), 'mac')).toEqual({ kind: 'invalid' });
  });
  test('gültige Taste liefert das Kürzel', () => {
    expect(recordKey(taste('Space', ' ', { altKey: true }), 'mac')).toEqual({ kind: 'key', accel: 'Alt+Space' });
  });
});

type Cb = (s: 'Pressed' | 'Released') => void;

function fakeApi(belegt: string[] = []) {
  const registered = new Map<string, Cb>();
  const api: ShortcutApi = {
    async register(a, cb) {
      if (belegt.includes(a) || registered.has(a)) throw new Error(`${a} belegt`);
      registered.set(a, cb);
    },
    async unregister(a) {
      registered.delete(a);
    },
  };
  return { api, registered, fire: (a: string, s: 'Pressed' | 'Released') => registered.get(a)?.(s) };
}

function setup(opts: { belegt?: string[]; active?: () => boolean } = {}) {
  const f = fakeApi(opts.belegt);
  const calls: boolean[] = [];
  const ptt = new GlobalPtt(f.api, (b) => calls.push(b), opts.active ?? (() => true));
  return { ...f, calls, ptt };
}

describe('GlobalPtt', () => {
  test('Pressed dann Released', async () => {
    const t = setup();
    expect(await t.ptt.set('Alt+Space')).toEqual({ ok: true });
    t.fire('Alt+Space', 'Pressed');
    t.fire('Alt+Space', 'Released');
    expect(t.calls).toEqual([true, false]);
  });
  test('zweimal Pressed meldet einmal', async () => {
    const t = setup();
    await t.ptt.set('Alt+Space');
    t.fire('Alt+Space', 'Pressed');
    t.fire('Alt+Space', 'Pressed');
    t.fire('Alt+Space', 'Released');
    t.fire('Alt+Space', 'Released');
    expect(t.calls).toEqual([true, false]);
  });
  test('set auf neue Taste löst gedrückte Taste', async () => {
    const t = setup();
    await t.ptt.set('Alt+Space');
    t.fire('Alt+Space', 'Pressed');
    await t.ptt.set('F13');
    expect(t.calls).toEqual([true, false]);
    expect([...t.registered.keys()]).toEqual(['F13']);
    // Ein spätes Ereignis der alten Taste darf nichts mehr auslösen.
    t.fire('Alt+Space', 'Pressed');
    expect(t.calls).toEqual([true, false]);
  });
  test('Entfernen löst gedrückte Taste und meldet ab', async () => {
    const t = setup();
    await t.ptt.set('Alt+Space');
    t.fire('Alt+Space', 'Pressed');
    expect(await t.ptt.set(null)).toEqual({ ok: true });
    expect(t.calls).toEqual([true, false]);
    expect(t.registered.size).toBe(0);
  });
  test('release löst', async () => {
    const t = setup();
    await t.ptt.set('Alt+Space');
    t.fire('Alt+Space', 'Pressed');
    t.ptt.release();
    t.ptt.release();
    expect(t.calls).toEqual([true, false]);
    // Das Loslassen danach ist harmlos.
    t.fire('Alt+Space', 'Released');
    expect(t.calls).toEqual([true, false]);
  });
  test('Registrierung wirft → ok: false, alte Taste bleibt registriert', async () => {
    const t = setup({ belegt: ['F13'] });
    await t.ptt.set('Alt+Space');
    t.fire('Alt+Space', 'Pressed');
    expect(await t.ptt.set('F13')).toEqual({ ok: false });
    expect(t.calls).toEqual([true, false]);
    expect([...t.registered.keys()]).toEqual(['Alt+Space']);
    expect(t.ptt.current).toBe('Alt+Space');
    t.fire('Alt+Space', 'Pressed');
    t.fire('Alt+Space', 'Released');
    expect(t.calls).toEqual([true, false, true, false]);
  });
  test('Pressed im Modus Automatisch wird ignoriert', async () => {
    let ptt = false;
    const t = setup({ active: () => ptt });
    await t.ptt.set('Alt+Space');
    t.fire('Alt+Space', 'Pressed');
    t.fire('Alt+Space', 'Released');
    expect(t.calls).toEqual([]);
    ptt = true;
    t.fire('Alt+Space', 'Pressed');
    // Das Loslassen kommt durch, auch wenn der Modus inzwischen gewechselt hat.
    ptt = false;
    t.fire('Alt+Space', 'Released');
    expect(t.calls).toEqual([true, false]);
  });
  test('dieselbe Taste erneut setzen registriert nicht doppelt', async () => {
    const t = setup();
    await t.ptt.set('Alt+Space');
    expect(await t.ptt.set('Alt+Space')).toEqual({ ok: true });
    expect([...t.registered.keys()]).toEqual(['Alt+Space']);
  });
  test('scheitert das Abmelden, gilt die Taste trotzdem als entfernt', async () => {
    const t = setup();
    await t.ptt.set('Alt+Space');
    t.api.unregister = async () => {
      throw new Error('weg');
    };
    t.fire('Alt+Space', 'Pressed');
    expect(await t.ptt.set(null)).toEqual({ ok: true });
    expect(t.ptt.current).toBeNull();
    t.fire('Alt+Space', 'Pressed');
    expect(t.calls).toEqual([true, false]);
  });
});
