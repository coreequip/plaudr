import { describe, expect, test } from 'vitest';
import { WORDS, fingerprintWords } from './words';
import { toBase64url } from '../util/base64url';

const key = (b: number) => toBase64url(new Uint8Array(32).fill(b));

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
