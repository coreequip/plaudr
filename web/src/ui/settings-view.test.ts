import { describe, expect, it } from 'vitest';
import { accentFor, contrast } from './theme';
import { DEFAULT_HUE, previewColors, wordsLine } from './settings-view';

describe('Einstellungen', () => {
  it('setzt die vier Wörter mit Mittelpunkt zusammen', () => {
    expect(wordsLine(['tiger', 'anker', 'wolke', 'mond'])).toBe('tiger · anker · wolke · mond');
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
});
