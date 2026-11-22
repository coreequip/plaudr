import { expect, test } from '@playwright/test';
import { bytes, closeContexts, connected, expectMesh, join, newContext, open, openIn, peerCount, roomHash } from './helpers';
import { openIntruder } from './intruder';

const selfId = (p: import('@playwright/test').Page) => p.evaluate(() => window.plaudr!.selfId);
const rejected = (p: import('@playwright/test').Page, reason: string) =>
  p.evaluate((r) => (window.plaudr!.signalingStats().rejected as Record<string, number>)[r], reason);

test.afterEach(closeContexts);

const FAKE_FINGERPRINT = 'a=fingerprint:sha-256 ' + Array(32).fill('AA').join(':');

test('room_ws sieht nur Umschläge', async ({ browser }) => {
  const h = roomHash('umschlag');
  const spy = await openIntruder(browser, h);
  const [a, b] = [await open(browser, h), await open(browser, h)];
  await join(a, 'Anna');
  await join(b, 'Bert');
  await expectMesh([a, b], 1);
  const seen = await spy.seen();
  expect(seen.length).toBeGreaterThan(3);
  for (const m of seen) {
    expect(Object.keys(m as object).sort()).toEqual(['ct', 'iv', 'v']);
    expect((m as { v: number }).v).toBe(1);
  }
  expect(JSON.stringify(seen)).not.toMatch(/Anna|Bert|fingerprint|candidate/);
});

test('gefälschtes offer mit fremdem Fingerprint wird abgewiesen', async ({ browser }) => {
  const h = roomHash('faelschung');
  const [a, b] = [await open(browser, h), await open(browser, h)];
  await join(a, 'Anna');
  await join(b, 'Bert');
  await expectMesh([a, b], 1);
  const [aId, bId] = [await selfId(a), await selfId(b)];
  const before = await rejected(b, 'signature');
  const evil = await openIntruder(browser, h);
  const sdp = `v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\n${FAKE_FINGERPRINT}\r\n`;
  await evil.forge({ kind: 'offer', from: aId, to: bId, body: { sdp } });
  await expect.poll(() => rejected(b, 'signature')).toBe(before + 1);
  expect(await peerCount(b)).toBe(1);
  expect(await connected(b)).toBe(1);
  const fromA = await bytes(b).then((x) => x[aId]);
  await expect.poll(() => bytes(b).then((x) => x[aId])).toBeGreaterThan(fromA);
});

test('hello mit fremder peerId wird abgewiesen', async ({ browser }) => {
  const h = roomHash('fremdeid');
  const [a, b] = [await open(browser, h), await open(browser, h)];
  await join(a, 'Anna');
  await join(b, 'Bert');
  await expectMesh([a, b], 1);
  const aId = await selfId(a);
  const evil = await openIntruder(browser, h);
  await evil.forge({ kind: 'hello', from: aId, to: '*', body: { pub: evil.pub, sid: 'S', name: 'Anna', caps: [] } });
  await expect.poll(() => rejected(b, 'identity')).toBe(1);
  await expect(b.locator('#peers li')).toHaveCount(1);
  expect(await connected(b)).toBe(1);
});

test('Identität bleibt über Neuladen erhalten', async ({ browser }) => {
  const h = roomHash('neuladen');
  const a = await open(browser, h);
  await join(a, 'Anna');
  const id = await selfId(a);
  expect(id).toMatch(/^[a-z2-7]{26}$/);
  await a.reload();
  await join(a, 'Anna');
  expect(await selfId(a)).toBe(id);
});

test('zweiter Tab im selben Browser tritt nicht bei', async ({ browser }) => {
  const h = roomHash('zweitertab');
  const ctx = await newContext(browser);
  const first = await openIn(ctx, h);
  await join(first, 'Anna');
  const second = await openIn(ctx, h);
  await second.fill('#name', 'Anna');
  await second.click('#join');
  await expect(second.locator('#lobby-notice')).toHaveText('plaudr ist in diesem Browser schon in einem anderen Tab offen.');
  await expect(second.locator('#call')).toBeHidden();
  await expect(second.locator('#join')).toBeEnabled();
});

test('Neuladen ohne bye (wie ein Absturz): beide finden sofort wieder zusammen', async ({ browser }) => {
  const h = roomHash('ohnebye');
  const [a, b] = [await open(browser, h), await open(browser, h)];
  await join(a, 'Anna');
  await join(b, 'Bert');
  await expectMesh([a, b], 1);
  await b.evaluate(() => {
    WebSocket.prototype.send = function () {};
  });
  await b.reload();
  await join(b, 'Bert');
  await expectMesh([a, b], 1);
  await expect.poll(() => bytes(a).then((x) => Object.values(x)[0] ?? 0)).toBeGreaterThan(0);
  await expect.poll(() => bytes(b).then((x) => Object.values(x)[0] ?? 0)).toBeGreaterThan(0);
});
