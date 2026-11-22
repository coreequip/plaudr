import { describe, expect, it } from 'vitest';
import { accentFor, contrast, themeCss } from './theme';

const hues = Array.from({ length: 360 }, (_, i) => i);

describe('Farbthema', () => {
  it('berechnet den Kontrast nach WCAG', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrast('#ffffff', '#ffffff')).toBeCloseTo(1, 5);
  });
  it('für jeden Farbton hält hell die Kontraste mindestens 4,5', () => {
    for (const h of hues) {
      const { accent, soft } = accentFor(h).light;
      expect(contrast(accent, '#ffffff'), `hell ${h} weiß`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(accent, '#f6f5f2'), `hell ${h} bg`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(accent, soft), `hell ${h} soft`).toBeGreaterThanOrEqual(4.5);
    }
  });
  it('für jeden Farbton hält dunkel die Kontraste mindestens 4,5', () => {
    for (const h of hues) {
      const { accent } = accentFor(h).dark;
      expect(contrast(accent, '#0d0d0c'), `dunkel ${h} fg`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(accent, '#161615'), `dunkel ${h} bg`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(accent, '#20201e'), `dunkel ${h} card`).toBeGreaterThanOrEqual(4.5);
    }
  });
  it('accentFg ist hell #ffffff, dunkel #0d0d0c', () => {
    const p = accentFor(120);
    expect(p.light.accentFg).toBe('#ffffff');
    expect(p.dark.accentFg).toBe('#0d0d0c');
  });
  it('liefert nur gültige Hex-Farben', () => {
    const p = accentFor(77);
    for (const c of [p.light, p.dark]) for (const v of Object.values(c)) expect(v).toMatch(/^#[0-9a-f]{6}$/);
  });
  it('themeCss(null) ist leer', () => {
    expect(themeCss(null)).toBe('');
  });
  it('themeCss(200) enthält alle drei Selektoren', () => {
    const css = themeCss(200);
    expect(css).toContain(':root {');
    expect(css).toContain("@media (prefers-color-scheme: dark) { :root:not([data-theme='light'])");
    expect(css).toContain(":root[data-theme='dark']");
    expect(css).toContain('--accent-soft');
  });
});
