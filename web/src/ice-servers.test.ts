import { afterEach, expect, test, vi } from 'vitest';
import { FALLBACK_STUN, fetchIceServers } from './ice-servers';

const X: RTCIceServer = { urls: ['turns:turn.example:443?transport=tcp'], username: 'u', credential: 'p' };
const ok = (body: unknown) => async () => new Response(JSON.stringify(body), { status: 200 });

afterEach(() => vi.useRealTimers());

test('übernimmt die TURN-Server und hängt STUN an', async () => {
  expect(await fetchIceServers('u', ok({ iceServers: [X], ttl: 7200 }))).toEqual([X, FALLBACK_STUN]);
});

test('404 liefert nur STUN', async () => {
  expect(await fetchIceServers('u', async () => new Response('', { status: 404 }))).toEqual([FALLBACK_STUN]);
});

test('Netzwerkfehler liefert nur STUN', async () => {
  expect(await fetchIceServers('u', async () => { throw new TypeError('offline'); })).toEqual([FALLBACK_STUN]);
});

test('kaputtes JSON liefert nur STUN', async () => {
  expect(await fetchIceServers('u', ok({ nope: 1 }))).toEqual([FALLBACK_STUN]);
});

test('nach 3 s ohne Antwort nur STUN', async () => {
  vi.useFakeTimers();
  const p = fetchIceServers('u', () => new Promise<Response>(() => {}));
  await vi.advanceTimersByTimeAsync(3000);
  expect(await p).toEqual([FALLBACK_STUN]);
});
