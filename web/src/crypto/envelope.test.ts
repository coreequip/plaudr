import { beforeAll, expect, test } from 'vitest';
import { fromBase64url, toBase64url } from '../util/base64url';
import { openEnvelope, seal } from './envelope';

let key: CryptoKey;
let other: CryptoKey;
const gen = () => crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);

beforeAll(async () => {
  key = await gen();
  other = await gen();
});

test('seal und openEnvelope ergeben den Klartext, auch mit Umlauten', async () => {
  const text = '{"name":"Jürgen Größe"}';
  expect(await openEnvelope(key, await seal(key, text))).toBe(text);
});

test('seal liefert nur v, iv, ct mit 12-Byte-IV', async () => {
  const env = await seal(key, 'x');
  expect(Object.keys(env).sort()).toEqual(['ct', 'iv', 'v']);
  expect(env.v).toBe(1);
  expect(fromBase64url(env.iv).length).toBe(12);
});

test('jeder Aufruf hat einen frischen IV', async () => {
  expect((await seal(key, 'x')).iv).not.toBe((await seal(key, 'x')).iv);
});

test('falscher Schlüssel ergibt null', async () => {
  expect(await openEnvelope(other, await seal(key, 'x'))).toBeNull();
});

test('gekipptes Byte im ct ergibt null', async () => {
  const env = await seal(key, 'hallo');
  const ct = fromBase64url(env.ct);
  ct[0] ^= 1;
  expect(await openEnvelope(key, { ...env, ct: toBase64url(ct) })).toBeNull();
});

test.each<[string, (e: Record<string, unknown>) => unknown]>([
  ['v: 0', (e) => ({ ...e, v: 0 })],
  ['fehlendes iv', ({ iv: _iv, ...rest }) => rest],
  ['ungültiges base64url im iv', (e) => ({ ...e, iv: '!!!' })],
  ['null', () => null],
  ['String', () => 'x'],
])('openEnvelope gibt null für %s', async (_label, mutate) => {
  const env = (await seal(key, 'x')) as unknown as Record<string, unknown>;
  expect(await openEnvelope(key, mutate(env))).toBeNull();
});
