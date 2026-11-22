import { expect, test } from 'vitest';
import { DEFAULT_AUDIO, loadAudioSettings, saveAudioSettings } from './settings';

function memoryStorage(init: Record<string, string> = {}): Storage {
  const m = new Map(Object.entries(init));
  return {
    get length() { return m.size; },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => void m.delete(k),
    setItem: (k, v) => void m.set(k, v),
  };
}

test('Standardwerte', () => {
  expect(DEFAULT_AUDIO).toEqual({ mode: 'vad', threshold: 0.85, denoise: true, preroll: true });
  expect(loadAudioSettings(memoryStorage())).toEqual(DEFAULT_AUDIO);
});

test('gespeicherte Werte kommen zurück', () => {
  const st = memoryStorage();
  saveAudioSettings({ mode: 'ptt', threshold: 0.7, denoise: false, preroll: false }, st);
  expect(loadAudioSettings(st)).toEqual({ mode: 'ptt', threshold: 0.7, denoise: false, preroll: false });
});

test('kaputtes JSON ergibt Standard', () => {
  expect(loadAudioSettings(memoryStorage({ 'plaudr.audio': '{kaputt' }))).toEqual(DEFAULT_AUDIO);
});

test('ungültige Felder fallen einzeln auf den Standard zurück, Schwelle wird begrenzt', () => {
  const st = memoryStorage({ 'plaudr.audio': JSON.stringify({ mode: 'laut', threshold: 2, denoise: 'ja', preroll: false }) });
  expect(loadAudioSettings(st)).toEqual({ mode: 'vad', threshold: 0.99, denoise: true, preroll: false });
  const low = memoryStorage({ 'plaudr.audio': JSON.stringify({ threshold: 0.1 }) });
  expect(loadAudioSettings(low).threshold).toBe(0.5);
});

test('ohne nutzbaren Speicher: Standard, Speichern wirft nicht', () => {
  const broken = { getItem: () => { throw new Error('x'); }, setItem: () => { throw new Error('x'); } } as unknown as Storage;
  expect(loadAudioSettings(broken)).toEqual(DEFAULT_AUDIO);
  expect(() => saveAudioSettings(DEFAULT_AUDIO, broken)).not.toThrow();
});

// localStorage-Zugriff wirft (gesperrte Websitedaten): ohne übergebenen Speicher müssen Standardwerte kommen.
function ohneLesbaresLocalStorage(f: () => void): void {
  const alt = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('SecurityError'); } });
  try {
    f();
  } finally {
    if (alt) Object.defineProperty(globalThis, 'localStorage', alt);
    else delete (globalThis as { localStorage?: unknown }).localStorage;
  }
}

test('gesperrtes localStorage: Standardwerte, kein Wurf', () => {
  ohneLesbaresLocalStorage(() => {
    expect(loadAudioSettings()).toEqual(DEFAULT_AUDIO);
    expect(() => saveAudioSettings(DEFAULT_AUDIO)).not.toThrow();
  });
});
