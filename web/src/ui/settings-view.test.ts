import { describe, expect, it } from 'vitest';
import { accentFor, contrast } from './theme';
import { acceleratorFrom } from '../platform/shortcut';
import { DEFAULT_HUE, previewColors, pttInvalid, wordsLine } from './settings-view';

describe('Einstellungen', () => {
  it('setzt die vier Wörter mit Mittelpunkt zusammen', () => {
    expect(wordsLine(['tiger', 'anker', 'blume', 'regen'])).toBe('tiger · anker · blume · regen');
  });
  it('Vorschau ohne Farbton zeigt das Standardgrün beider Helligkeiten', () => {
    const p = previewColors(null);
    expect(p.light.accent).toBe('#0f5c1a');
    expect(p.dark.accent).toBe('#4caf5c');
  });
  it('Vorschau mit Farbton nimmt die Akzente aus dem Farbthema, lesbar auf der Kachel', () => {
    const p = previewColors(200);
    expect(p.light.accent).toBe(accentFor(200).light.accent);
    expect(p.dark.accent).toBe(accentFor(200).dark.accent);
    expect(contrast(p.light.accent, p.light.bg)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(p.dark.accent, p.dark.bg)).toBeGreaterThanOrEqual(4.5);
  });
  it('Standardfarbton liegt beim Standardgrün', () => {
    expect(DEFAULT_HUE).toBe(128);
  });
  it('Hinweis bei ungültiger Taste nennt die Modifikatoren des Systems', () => {
    expect(pttInvalid('mac')).toBe('Nimm eine Taste mit ⌥, ⌘, Strg oder Umschalt, oder F13 bis F24.');
    expect(pttInvalid('windows')).toBe('Nimm eine Taste mit Strg, Alt, Umschalt oder Win, oder F13 bis F24.');
    expect(pttInvalid('other')).toBe(pttInvalid('windows'));
  });
  it('unter Windows nimmt acceleratorFrom genau Strg, Alt, Umschalt und Win an', () => {
    const k = { key: 'p', code: 'KeyP', altKey: false, ctrlKey: false, metaKey: false, shiftKey: false };
    expect(acceleratorFrom({ ...k, ctrlKey: true }, 'windows')).toBe('CommandOrControl+KeyP');
    expect(acceleratorFrom({ ...k, altKey: true }, 'windows')).toBe('Alt+KeyP');
    expect(acceleratorFrom({ ...k, shiftKey: true }, 'windows')).toBe('Shift+KeyP');
    expect(acceleratorFrom({ ...k, metaKey: true }, 'windows')).toBe('Super+KeyP');
    expect(acceleratorFrom(k, 'windows')).toBeNull();
    expect(acceleratorFrom({ ...k, code: 'F13', key: 'F13' }, 'windows')).toBe('F13');
  });
});
