import { describe, expect, test } from 'vitest';
import { buildLink, createRoomSecret, secretFromHash, secretFromLink } from './link';

describe('createRoomSecret', () => {
  test('liefert 43 Zeichen base64url', () => {
    expect(createRoomSecret()).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });
  test('ist bei jedem Aufruf anders', () => {
    expect(createRoomSecret()).not.toBe(createRoomSecret());
  });
});

describe('secretFromHash', () => {
  const s = createRoomSecret();
  test('liest mit und ohne #', () => {
    expect(secretFromHash('#' + s)).toBe(s);
    expect(secretFromHash(s)).toBe(s);
  });
  test.each(['', '#', '#abc', '#' + 'a'.repeat(44), '#' + 'a'.repeat(42), '#' + '+'.repeat(43)])(
    'verwirft %j',
    (h) => expect(secretFromHash(h)).toBeNull(),
  );
});

test('buildLink setzt das Geheimnis ins Fragment', () => {
  const s = createRoomSecret();
  expect(buildLink('https://plaudr.room.ws', s)).toBe('https://plaudr.room.ws/#' + s);
});


describe('secretFromLink', () => {
  const s = createRoomSecret();
  test.each([`https://plaudr.room.ws/#${s}`, `plaudr.room.ws/#${s}`, `  ${s}  `, `\n${s}\n`])('nimmt %j', (t) => {
    expect(secretFromLink(t)).toBe(s);
  });
  test.each(['https://plaudr.room.ws/', '#abc', '', '   '])('verwirft %j', (t) => {
    expect(secretFromLink(t)).toBeNull();
  });
});
