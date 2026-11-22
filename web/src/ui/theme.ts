import type { UiPrefs } from './prefs';

export interface Palette {
  accent: string;
  accentFg: string;
  soft: string;
}

// HSL (h in Grad, s und l in Prozent) nach #rrggbb.
function hsl(h: number, s: number, l: number): string {
  const sat = s / 100;
  const lig = l / 100;
  const a = sat * Math.min(lig, 1 - lig);
  const f = (n: number): string => {
    const k = (n + h / 30) % 12;
    const v = lig - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(v * 255).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

function luminance(hex: string): number {
  const ch = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

/** WCAG-Kontrastverhältnis zweier #rrggbb-Farben. */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const MIN = 4.5;

/** Akzentfarben zu einem Farbton; die Helligkeit wird so lange angepasst, bis der Kontrast hält. */
export function accentFor(hue: number): { light: Palette; dark: Palette } {
  const lightSoft = hsl(hue, 30, 90);
  let l = 21;
  let lightAccent = hsl(hue, 72, l);
  // hell: dunkler werden, bis Akzent auf Weiß, Hintergrund und Soft lesbar ist
  while (
    l > 0 &&
    (contrast(lightAccent, '#ffffff') < MIN || contrast(lightAccent, '#f6f5f2') < MIN || contrast(lightAccent, lightSoft) < MIN)
  ) {
    l -= 1;
    lightAccent = hsl(hue, 72, l);
  }

  let d = 49;
  let darkAccent = hsl(hue, 39, d);
  // dunkel: heller werden (höchstens 85 %), bis Akzent auf allen dunklen Flächen lesbar ist
  while (
    d < 85 &&
    (contrast(darkAccent, '#0d0d0c') < MIN || contrast(darkAccent, '#161615') < MIN || contrast(darkAccent, '#20201e') < MIN)
  ) {
    d += 1;
    darkAccent = hsl(hue, 39, d);
  }

  return {
    light: { accent: lightAccent, accentFg: '#ffffff', soft: lightSoft },
    dark: { accent: darkAccent, accentFg: '#0d0d0c', soft: hsl(hue, 24, 16) },
  };
}

function vars(p: Palette): string {
  return `--accent: ${p.accent}; --accent-fg: ${p.accentFg}; --accent-soft: ${p.soft};`;
}

/** CSS-Regeln für den gewählten Farbton; leer, wenn keiner gewählt ist. */
export function themeCss(hue: number | null): string {
  if (hue === null) return '';
  const { light, dark } = accentFor(hue);
  return [
    `:root { ${vars(light)} }`,
    `@media (prefers-color-scheme: dark) { :root:not([data-theme='light']) { ${vars(dark)} } }`,
    `:root[data-theme='dark'] { ${vars(dark)} }`,
  ].join('\n');
}

export function applyTheme(p: UiPrefs, doc: Document = document): void {
  const root = doc.documentElement;
  if (p.theme === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', p.theme);
  let el = doc.getElementById('theme');
  if (!el) {
    el = doc.createElement('style');
    el.id = 'theme';
    doc.head.appendChild(el);
  }
  el.textContent = themeCss(p.hue);
}
