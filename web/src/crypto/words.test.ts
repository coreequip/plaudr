import { describe, expect, test } from 'vitest';
import { WORDS, fingerprintWords } from './words';
import { toBase64url } from '../util/base64url';

const key = (b: number) => toBase64url(new Uint8Array(32).fill(b));

/** Editierabstand (Einfügen, Löschen, Ersetzen je ein Schritt). */
function levenshtein(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}

/** Grobe Lautform: was am Telefon gleich klingt, wird gleich geschrieben. */
const sound = (w: string) =>
  w.replace(/ck/g, 'k').replace(/ph/g, 'f').replace(/ie/g, 'i').replace(/ai/g, 'ei').replace(/([aeiou])h/g, '$1')
    .replace(/tz/g, 'z').replace(/d/g, 't').replace(/b/g, 'p').replace(/g/g, 'k').replace(/[vw]/g, 'f').replace(/(.)\1/g, '$1');

describe('WORDS', () => {
  test('hat genau 256 Einträge, alle verschieden', () => {
    expect(WORDS).toHaveLength(256);
    expect(new Set(WORDS).size).toBe(256);
  });
  test('nur kleine Buchstaben a-z, 3 bis 7 Zeichen', () => {
    for (const w of WORDS) expect(w).toMatch(/^[a-z]{3,7}$/);
  });
  test('kein Wort ist Anfang eines anderen', () => {
    for (const a of WORDS) for (const b of WORDS) if (a !== b) expect(b.startsWith(a), `${a} / ${b}`).toBe(false);
  });
  test('keine Umschriften von Umlauten', () => {
    for (const w of WORDS) if (w !== 'feuer') expect(w, w).not.toMatch(/ae|oe|[^q]ue/);
  });
  test('kein Wortpaar unterscheidet sich nur in einem Buchstaben, auch nicht dem Klang nach', () => {
    const near: string[] = [];
    for (let i = 0; i < WORDS.length; i++)
      for (let j = i + 1; j < WORDS.length; j++) {
        const [a, b] = [WORDS[i], WORDS[j]];
        if (levenshtein(a, b) <= 1 || levenshtein(sound(a), sound(b)) <= 1) near.push(`${a} / ${b}`);
      }
    expect(near).toEqual([]);
  });
  test('Abstandsprüfung erkennt die bekannten Fallen', () => {
    expect(levenshtein('huhn', 'hahn')).toBe(1);
    expect(levenshtein('bach', 'buch')).toBe(1);
    expect(levenshtein(sound('hund'), sound('huhn'))).toBe(1);
    expect(levenshtein(sound('rad'), sound('rat'))).toBe(0);
  });
});

describe('fingerprintWords', () => {
  test('liefert vier Wörter aus der Liste', async () => {
    const w = await fingerprintWords(key(1));
    expect(w).toHaveLength(4);
    for (const x of w) expect(WORDS).toContain(x);
  });
  test('ist deterministisch', async () => {
    expect(await fingerprintWords(key(1))).toEqual(await fingerprintWords(key(1)));
  });
  test('verschiedene Schlüssel ergeben verschiedene Wörter', async () => {
    expect(await fingerprintWords(key(1))).not.toEqual(await fingerprintWords(key(2)));
  });
  test('Wort i ist WORDS[Hashbyte i]', async () => {
    const raw = new Uint8Array(32).fill(7);
    const h = new Uint8Array(await crypto.subtle.digest('SHA-256', raw));
    expect(await fingerprintWords(toBase64url(raw))).toEqual([0, 1, 2, 3].map((i) => WORDS[h[i]]));
  });
});
