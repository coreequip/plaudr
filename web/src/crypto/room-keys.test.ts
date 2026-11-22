import { expect, test } from 'vitest';
import { deriveRoom } from './room-keys';

// Bytes 0x00..0x1f; erwartete Werte unabhängig mit node:crypto.hkdfSync berechnet.
const SECRET = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8';
const ROOM_ID = 'b70b330295b904f7a3970129f87c4f17c6a72f315b1934dee70499209c9823cc';
const ROOM_KEY_HEX = 'd83254d33e0d5646c3ee163f3bfc07402f09ceef61b30d2fe091b0ee1d1bb520';

const hex = (h: string) => Uint8Array.from(h.match(/../g)!.map((b) => parseInt(b, 16)));

test('roomId entspricht dem HKDF-Testvektor', async () => {
  expect((await deriveRoom(SECRET)).roomId).toBe(ROOM_ID);
});

test('roomKey entspricht dem HKDF-Testvektor', async () => {
  const ref = await crypto.subtle.importKey('raw', hex(ROOM_KEY_HEX), 'AES-GCM', false, ['encrypt']);
  const iv = new Uint8Array(12);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, ref, new TextEncoder().encode('x'));
  const { roomKey } = await deriveRoom(SECRET);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, roomKey, ct);
  expect(new TextDecoder().decode(pt)).toBe('x');
});

test('roomKey ist nicht exportierbar', async () => {
  expect((await deriveRoom(SECRET)).roomKey.extractable).toBe(false);
});

test('verschiedene Geheimnisse ergeben verschiedene roomIds', async () => {
  const other = 'B' + SECRET.slice(1);
  expect((await deriveRoom(other)).roomId).not.toBe(ROOM_ID);
});
