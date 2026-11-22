import { expect, test } from '@playwright/test';
import { backup, bytes, closeContexts, connected, expectAudioFlowing, expectMesh, join, open, peerCount, roomHash } from './helpers';

test.afterEach(closeContexts);

test('drei Teilnehmer hören sich', async ({ browser }) => {
  const h = roomHash('drei');
  const pages = [await open(browser, h), await open(browser, h), await open(browser, h)];
  for (const [i, p] of pages.entries()) await join(p, `P${i}`);
  await expectMesh(pages, 2);
  await expect.poll(() => bytes(pages[0]).then((b) => Math.min(...Object.values(b)))).toBeGreaterThan(0);
  await expectAudioFlowing(pages);
  await expect(pages[0].locator('#peers li')).toHaveCount(2);
  await expect(pages[0].locator('#peers')).toContainText('P1');
  await expect(pages[0].locator('#peers')).toContainText('P2');
});

test('gleichzeitiger Beitritt', async ({ browser }) => {
  const h = roomHash('gleichzeitig');
  const pages = await Promise.all([open(browser, h), open(browser, h), open(browser, h)]);
  for (const [i, p] of pages.entries()) {
    await backup(p);
    await p.fill('#name', `G${i}`);
  }
  await Promise.all(pages.map((p) => p.click('#join')));
  await expectMesh(pages, 2);
  await expect.poll(() => bytes(pages[2]).then((b) => Math.min(...Object.values(b)))).toBeGreaterThan(0);
  await expectAudioFlowing(pages);
});

test('Verlassen und Schließen', async ({ browser }) => {
  const h = roomHash('verlassen');
  const [a, b, c] = [await open(browser, h), await open(browser, h), await open(browser, h)];
  for (const [i, p] of [a, b, c].entries()) await join(p, `V${i}`);
  await expectMesh([a, b, c], 2);
  await c.click('#leave');
  await expect.poll(() => peerCount(a), { timeout: 5_000 }).toBe(1);
  await expect.poll(() => peerCount(b), { timeout: 5_000 }).toBe(1);
  await b.close();
  await expect.poll(() => peerCount(a), { timeout: 10_000 }).toBe(0);
});

test('Reconnect des Signalings', async ({ browser }) => {
  const h = roomHash('reconnect');
  const pages = [await open(browser, h), await open(browser, h), await open(browser, h)];
  for (const [i, p] of pages.entries()) await join(p, `R${i}`);
  await expectMesh(pages, 2);
  const aId = await pages[1].evaluate(() => window.plaudr!.peers().find((p) => p.name === 'R0')!.peerId);
  const fromA = () => bytes(pages[1]).then((b) => b[aId]);
  let last = await fromA();
  expect(last).toBeGreaterThan(0);
  await pages[0].evaluate(() => window.plaudr!.dropSignaling());
  // Audio von A bei B darf über den Abbruch hinweg nie zurückgesetzt werden (neue PC hieße: Zähler fängt bei 0 an).
  for (let i = 0; i < 20; i++) {
    await pages[1].waitForTimeout(250);
    const now = await fromA();
    expect(now).toBeGreaterThanOrEqual(last);
    last = now;
  }
  for (const p of pages) {
    expect(await peerCount(p)).toBe(2);
    expect(await connected(p)).toBe(2);
  }
  await expectAudioFlowing(pages);
  // Beweis, dass A wieder am Signaling hängt: ein Neuer erreicht alle drei.
  const late = await open(browser, h);
  await join(late, 'R3');
  await expectMesh([...pages, late], 3);
});

test('ohne Mikrofon', async ({ browser }) => {
  const h = roomHash('ohnemikro');
  const a = await open(browser, h);
  await join(a, 'Anna');
  const d = await open(browser, h, { noMic: true });
  await join(d, 'Dora');
  await expect(d.locator('#notice')).toHaveText('Kein Mikrofon: du hörst nur zu.');
  await expect(d.locator('#mute')).toBeDisabled();
  await expectMesh([a, d], 1);
  await expect.poll(() => bytes(d).then((b) => Object.values(b)[0] ?? 0)).toBeGreaterThan(0);
});
