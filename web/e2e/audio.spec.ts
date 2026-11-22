import { expect, test, type Page } from '@playwright/test';
import { closeContexts, connected, expectMesh, join, open, roomHash } from './helpers';

test.afterEach(closeContexts);

const selfId = (p: Page) => p.evaluate(() => window.plaudr!.selfId);

/** Höchster Pegel, den `listener` von `speakerId` im Zeitraum empfängt (alle 100 ms abgetastet). */
async function maxLevel(listener: Page, speakerId: string, ms: number): Promise<number> {
  let max = 0;
  for (let t = 0; t < ms; t += 100) {
    max = Math.max(max, await listener.evaluate((id) => window.plaudr!.audioLevels()[id] ?? 0, speakerId));
    await listener.waitForTimeout(100);
  }
  return max;
}

async function pair(browser: import('@playwright/test').Browser, label: string) {
  const h = roomHash(label);
  const [a, b] = [await open(browser, h), await open(browser, h)];
  await join(a, 'Anna');
  await join(b, 'Bert');
  await expectMesh([a, b], 1);
  return { a, b, aId: await selfId(a) };
}

test('Sprachaktivierung öffnet und schließt, B hört A', async ({ browser }) => {
  const { a, b, aId } = await pair(browser, 'vad');
  const seen = new Set<boolean>();
  for (let t = 0; t < 10_000 && seen.size < 2; t += 100) {
    seen.add(await a.evaluate(() => window.plaudr!.activity().open));
    await a.waitForTimeout(100);
  }
  expect([...seen].sort()).toEqual([false, true]);
  expect(await maxLevel(b, aId, 5000)).toBeGreaterThan(0.01);
});

test('Push-to-Talk: still, bis gedrückt wird', async ({ browser }) => {
  const { a, b, aId } = await pair(browser, 'ptt');
  await a.evaluate(() => window.plaudr!.setSettings({ mode: 'ptt' }));
  await b.waitForTimeout(700);
  expect(await maxLevel(b, aId, 3000)).toBeLessThan(0.005);
  await a.evaluate(() => window.plaudr!.setPressed(true));
  expect(await maxLevel(b, aId, 3000)).toBeGreaterThan(0.01);
  await a.evaluate(() => window.plaudr!.setPressed(false));
  await b.waitForTimeout(1000);
  expect(await maxLevel(b, aId, 2000)).toBeLessThan(0.005);
});

test('Stumm: nichts kommt an', async ({ browser }) => {
  const { a, b, aId } = await pair(browser, 'stumm');
  await a.evaluate(() => window.plaudr!.setSettings({ mode: 'muted' }));
  await b.waitForTimeout(700);
  expect(await maxLevel(b, aId, 3000)).toBeLessThan(0.005);
});

test('Umschalten der Rauschunterdrückung behält den gesendeten Track', async ({ browser }) => {
  const { a, b, aId } = await pair(browser, 'denoise');
  const before = await a.evaluate(() => window.plaudr!.senderTrackId());
  expect(before).toBeTruthy();
  await a.evaluate(() => window.plaudr!.setSettings({ denoise: false }));
  expect(await a.evaluate(() => window.plaudr!.senderTrackId())).toBe(before);
  expect(await connected(a)).toBe(1);
  expect(await maxLevel(b, aId, 5000)).toBeGreaterThan(0.01);
});
