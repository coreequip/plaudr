import { expect, test } from 'vitest';
import { fromBase64url, toBase64url } from './base64url';

test.each([0, 1, 31, 32, 33])('fromBase64url kehrt toBase64url um (%i Bytes)', (n) => {
  const bytes = crypto.getRandomValues(new Uint8Array(n));
  expect(fromBase64url(toBase64url(bytes))).toEqual(bytes);
});

test.each(['!!', 'a', 'ab=c', 'a+b/'])('fromBase64url wirft bei %j', (s) => {
  expect(() => fromBase64url(s)).toThrow();
});
