import { describe, expect, test } from 'vitest';
import { createRoomSecret } from '../room/link';
import { secretFromDeepLink } from './deep-link';

describe('secretFromDeepLink', () => {
  const s = createRoomSecret();

  test.each([
    `plaudr://raum#${s}`,
    `plaudr://${s}`,
    `plaudr://${s}/`,
    `https://plaudr.room.ws/#${s}`,
  ])('nimmt %j', (url) => {
    expect(secretFromDeepLink(url)).toBe(s);
  });

  test('verträgt Leerraum, großgeschriebenes Schema und den Schrägstrich vor dem Fragment', () => {
    expect(secretFromDeepLink(`  plaudr://raum#${s}\n`)).toBe(s);
    expect(secretFromDeepLink(`PLAUDR://raum#${s}`)).toBe(s);
    expect(secretFromDeepLink(`plaudr://raum/#${s}`)).toBe(s);
    expect(secretFromDeepLink(`https://plaudr.room.ws#${s}`)).toBe(s);
  });

  test.each([
    'plaudr://',
    'plaudr://raum',
    'plaudr://raum#',
    // Name des internen Beenden-Ereignisses: als Link von außen nur ein ungültiger Link, nie ein Beenden.
    'plaudr://quit',
    `plaudr://raum#${s.slice(1)}`,
    `plaudr://${s.slice(1)}`,
    `plaudr://${s}x`,
    `http://plaudr.room.ws/#${s}`,
    `https://evil.example/#${s}`,
    `https://plaudr.room.ws.evil.example/#${s}`,
    `ftp://${s}`,
    `plaudrx://raum#${s}`,
    `plaudr://raum/x#${s}`,
    `plaudr://${s}?a=1`,
    s,
    '',
  ])('verwirft %j', (url) => {
    expect(secretFromDeepLink(url)).toBeNull();
  });
});
