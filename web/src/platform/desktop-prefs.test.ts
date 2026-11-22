import { describe, expect, test } from 'vitest';
import { createPttShortcut, loadDesktopPrefs, saveDesktopPrefs } from './desktop-prefs';
import { GlobalPtt, type ShortcutApi } from './shortcut';

function fake(inhalt?: string) {
  const m = new Map<string, string>();
  if (inhalt !== undefined) m.set('plaudr.desktop', inhalt);
  const storage = {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
  } as unknown as Storage;
  return { storage, m };
}

describe('Desktop-Einstellungen', () => {
  test('leer → keine Taste', () => {
    expect(loadDesktopPrefs(fake().storage)).toEqual({ pttShortcut: null });
  });
  test('kaputt → null', () => {
    expect(loadDesktopPrefs(fake('{kaputt').storage)).toEqual({ pttShortcut: null });
    expect(loadDesktopPrefs(fake('null').storage)).toEqual({ pttShortcut: null });
    expect(loadDesktopPrefs(fake('{"pttShortcut":7}').storage)).toEqual({ pttShortcut: null });
  });
  test('ungültiges Kürzel → null', () => {
    expect(loadDesktopPrefs(fake('{"pttShortcut":"KeyP"}').storage)).toEqual({ pttShortcut: null });
  });
  test('gültiges Kürzel bleibt', () => {
    expect(loadDesktopPrefs(fake('{"pttShortcut":"Alt+Space"}').storage)).toEqual({ pttShortcut: 'Alt+Space' });
  });
  test('Speicher wirft → null, Schreiben wirft nicht', () => {
    const wirft = {
      getItem: () => {
        throw new Error('gesperrt');
      },
      setItem: () => {
        throw new Error('gesperrt');
      },
    } as unknown as Storage;
    expect(loadDesktopPrefs(wirft)).toEqual({ pttShortcut: null });
    expect(() => saveDesktopPrefs({ pttShortcut: 'Alt+Space' }, wirft)).not.toThrow();
  });
  test('speichert und liest zurück, ungültig wird null', () => {
    const f = fake();
    saveDesktopPrefs({ pttShortcut: 'F13' }, f.storage);
    expect(JSON.parse(f.m.get('plaudr.desktop')!)).toEqual({ pttShortcut: 'F13' });
    expect(loadDesktopPrefs(f.storage)).toEqual({ pttShortcut: 'F13' });
    saveDesktopPrefs({ pttShortcut: 'Shift' }, f.storage);
    expect(loadDesktopPrefs(f.storage)).toEqual({ pttShortcut: null });
  });
});

function tasten(belegt: string[] = []) {
  const registered = new Set<string>();
  const api: ShortcutApi = {
    async register(a) {
      if (belegt.includes(a)) throw new Error('belegt');
      registered.add(a);
    },
    async unregister(a) {
      registered.delete(a);
    },
  };
  return { api, registered };
}

describe('Globale Taste im Desktop', () => {
  test('lädt die gespeicherte Taste beim Start und meldet die Änderung', async () => {
    const f = fake('{"pttShortcut":"Alt+Space"}');
    const t = tasten();
    const k = createPttShortcut(new GlobalPtt(t.api, () => {}, () => true), 'mac', f.storage);
    let changes = 0;
    k.onChange(() => changes++);
    expect(k.current()).toBe('Alt+Space');
    await k.ready;
    expect(t.registered.has('Alt+Space')).toBe(true);
    expect(k.registered()).toBe(true);
    expect(changes).toBe(1);
    expect(k.label('Alt+Space')).toBe('⌥ Leertaste');
  });
  test('beim Start vergeben: Taste bleibt gespeichert, gilt aber nicht als wirksam', async () => {
    const f = fake('{"pttShortcut":"Alt+Space"}');
    const k = createPttShortcut(new GlobalPtt(tasten(['Alt+Space']).api, () => {}, () => true), 'mac', f.storage);
    await k.ready;
    expect(k.current()).toBe('Alt+Space');
    expect(k.registered()).toBe(false);
    expect(loadDesktopPrefs(f.storage).pttShortcut).toBe('Alt+Space');
  });
  test('neue Taste vergeben: gespeicherte bleibt erhalten und wirksam', async () => {
    const f = fake('{"pttShortcut":"Alt+Space"}');
    const t = tasten(['F13']);
    const k = createPttShortcut(new GlobalPtt(t.api, () => {}, () => true), 'mac', f.storage);
    await k.ready;
    expect(await k.set('F13')).toEqual({ ok: false });
    expect(k.current()).toBe('Alt+Space');
    expect(k.registered()).toBe(true);
    expect(loadDesktopPrefs(f.storage).pttShortcut).toBe('Alt+Space');
  });
  test('neue Taste frei: wird gespeichert', async () => {
    const f = fake();
    const t = tasten();
    const k = createPttShortcut(new GlobalPtt(t.api, () => {}, () => true), 'windows', f.storage);
    await k.ready;
    expect(k.current()).toBeNull();
    expect(await k.set('CommandOrControl+Shift+KeyP')).toEqual({ ok: true });
    expect(loadDesktopPrefs(f.storage).pttShortcut).toBe('CommandOrControl+Shift+KeyP');
    expect(k.label(k.current()!)).toBe('Strg+Umschalt+P');
  });
  test('Entfernen löst, meldet ab und speichert null', async () => {
    const f = fake('{"pttShortcut":"Alt+Space"}');
    const t = tasten();
    const calls: boolean[] = [];
    const ptt = new GlobalPtt(t.api, (b) => calls.push(b), () => true);
    const k = createPttShortcut(ptt, 'mac', f.storage);
    await k.ready;
    expect(await k.set(null)).toEqual({ ok: true });
    expect(t.registered.size).toBe(0);
    expect(k.current()).toBeNull();
    expect(loadDesktopPrefs(f.storage).pttShortcut).toBeNull();
  });
  test('ungültige Taste wird gar nicht erst registriert', async () => {
    const f = fake();
    const t = tasten();
    const k = createPttShortcut(new GlobalPtt(t.api, () => {}, () => true), 'mac', f.storage);
    expect(await k.set('KeyP')).toEqual({ ok: false });
    expect(t.registered.size).toBe(0);
  });
});
