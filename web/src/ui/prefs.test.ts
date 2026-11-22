import { describe, expect, it } from 'vitest';
import { DEFAULT_PREFS, loadPrefs, savePrefs } from './prefs';

function fake(inhalt?: string): Storage {
  const m = new Map<string, string>();
  if (inhalt !== undefined) m.set('plaudr.ui', inhalt);
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
  } as unknown as Storage;
}

describe('Oberflächen-Einstellungen', () => {
  it('liefert Standardwerte bei leerem Speicher', () => {
    expect(loadPrefs(fake())).toEqual(DEFAULT_PREFS);
  });
  it('liefert Standardwerte bei kaputtem JSON', () => {
    expect(loadPrefs(fake('{kaputt'))).toEqual(DEFAULT_PREFS);
  });
  it('liefert Standardwerte bei fremdem Inhalt', () => {
    expect(loadPrefs(fake('{"hue":"abc","theme":"blau","autoJoin":"ja"}'))).toEqual(DEFAULT_PREFS);
  });
  it('liefert Standardwerte, wenn der Speicher wirft', () => {
    const wirft = { getItem: () => { throw new Error('gesperrt'); } } as unknown as Storage;
    expect(loadPrefs(wirft)).toEqual(DEFAULT_PREFS);
  });
  it('rundet hue auf ganze Zahlen und bildet 360 auf 0 ab', () => {
    expect(loadPrefs(fake('{"hue":360}')).hue).toBe(0);
    expect(loadPrefs(fake('{"hue":12.7}')).hue).toBe(13);
    expect(loadPrefs(fake('{"hue":-5}')).hue).toBeNull();
    expect(loadPrefs(fake('{"hue":400}')).hue).toBeNull();
  });
  it('speichert und lädt einen Rundlauf', () => {
    const s = fake();
    savePrefs({ theme: 'dark', hue: 200, autoJoin: false }, s);
    expect(loadPrefs(s)).toEqual({ theme: 'dark', hue: 200, autoJoin: false });
  });
  it('schluckt Fehler beim Speichern', () => {
    const wirft = { setItem: () => { throw new Error('voll'); } } as unknown as Storage;
    expect(() => savePrefs(DEFAULT_PREFS, wirft)).not.toThrow();
  });
});
