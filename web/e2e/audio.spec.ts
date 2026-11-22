import { expect, test, type Page } from '@playwright/test';
import { closeContexts, connected, expectMesh, join, newContext, open, openIn, roomHash } from './helpers';

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

test('B erhält von A ein für Opus abgestimmtes SDP', async ({ browser }) => {
  const { b, aId } = await pair(browser, 'opus');
  const sdp = await b.evaluate((id) => window.plaudr!.remoteSdp(id), aId);
  expect(sdp).toContain('usedtx=1');
  expect(sdp).toContain('maxaveragebitrate=32000');
  expect(sdp).toContain('stereo=0');
});

test.describe('Bedienung', () => {
  test('Push-to-Talk über Modusknopf, Halteknopf und Leertaste', async ({ browser }) => {
    const { a, b, aId } = await pair(browser, 'bedienungptt');
    await expect(a.locator('#mode-vad')).toHaveAttribute('aria-pressed', 'true');
    await a.click('#mode-ptt');
    await expect(a.locator('#mode-ptt')).toHaveAttribute('aria-pressed', 'true');
    await expect(a.locator('#mode-vad')).toHaveAttribute('aria-pressed', 'false');
    await expect(a.locator('#ptt')).toBeVisible();
    await expect(a.locator('#vad-threshold')).toBeHidden();
    await b.waitForTimeout(700);
    expect(await maxLevel(b, aId, 2000)).toBeLessThan(0.005);

    await a.locator('#ptt').hover();
    await a.mouse.down();
    expect(await maxLevel(b, aId, 2500)).toBeGreaterThan(0.01);
    await a.mouse.up();
    await b.waitForTimeout(1000);
    expect(await maxLevel(b, aId, 1500)).toBeLessThan(0.005);

    await a.keyboard.down('Space');
    expect(await maxLevel(b, aId, 2500)).toBeGreaterThan(0.01);
    await a.keyboard.up('Space');
    await b.waitForTimeout(1000);
    expect(await maxLevel(b, aId, 1500)).toBeLessThan(0.005);
  });

  test('Modus bleibt über Neuladen erhalten', async ({ browser }) => {
    const { a } = await pair(browser, 'bedienungmodus');
    await a.click('#mode-muted');
    await expect(a.locator('#mode-muted')).toHaveAttribute('aria-pressed', 'true');
    await a.reload();
    await join(a, 'Anna');
    await expect(a.locator('#mode-muted')).toHaveAttribute('aria-pressed', 'true');
  });

  test('Lautstärke je Teilnehmer und eigene Sprechanzeige', async ({ browser }) => {
    const { a, b, aId } = await pair(browser, 'bedienunglaut');
    await expect(b.locator('#vad-threshold')).toBeVisible();
    await b.locator(`#peers li[data-peer="${aId}"] input[data-volume]`).fill('0.3');
    await expect.poll(() => b.evaluate((id) => document.querySelector<HTMLAudioElement>(`audio[data-peer="${id}"]`)!.volume, aId)).toBeCloseTo(0.3);
    await expect(a.locator('#me-speaking')).toBeVisible({ timeout: 10_000 });
    await expect(b.locator(`#peers li[data-peer="${aId}"].speaking`)).toBeAttached({ timeout: 10_000 });
  });
});

test('Debug-Panel zeigt RTT und Verbindungsart je Teilnehmer', async ({ browser }) => {
  const { a } = await pair(browser, 'debug');
  await a.locator('#debug summary').click();
  const row = a.locator('#debug-table tbody tr').first();
  await expect(row).toContainText('Bert', { timeout: 5000 });
  await expect(row).toContainText('host', { timeout: 5000 });
  await expect(row.locator('td[data-k="rttMs"]')).toHaveText(/^\d+(,\d)? ms$/, { timeout: 5000 });
  await expect(row.locator('td[data-k="estimateMs"]')).toHaveText(/^\d+(,\d)? ms$/, { timeout: 5000 });
  await expect(a.locator('#debug-preroll')).toBeChecked();
  await a.locator('#debug-preroll').uncheck();
  expect(await a.evaluate(() => JSON.parse(localStorage.getItem('plaudr.audio')!).preroll)).toBe(false);
});

test('stürzt das Worklet ab, geht das Rohmikrofon raus, mit Hinweis, und Stumm wirkt weiter', async ({ browser }) => {
  const h = roomHash('absturz');
  const ctx = await newContext(browser);
  // AudioWorkletNodes einsammeln, um einen Absturz im Audio-Thread nachzustellen.
  await ctx.addInitScript(() => {
    const Orig = window.AudioWorkletNode;
    (window as any).__nodes = [];
    window.AudioWorkletNode = class extends Orig {
      constructor(...args: ConstructorParameters<typeof Orig>) {
        super(...args);
        (window as any).__nodes.push(this);
      }
    } as typeof Orig;
  });
  const a = await openIn(ctx, h);
  const b = await open(browser, h);
  await join(a, 'Anna');
  await join(b, 'Bert');
  await expectMesh([a, b], 1);
  const aId = await selfId(a);
  await a.evaluate(() => (window as any).__nodes[0].dispatchEvent(new Event('processorerror')));
  await expect(a.locator('#notice')).toHaveText('Rauschunterdrückung und Sprachaktivierung sind ausgefallen, dein Mikrofon geht ungefiltert raus.');
  expect(await maxLevel(b, aId, 4000)).toBeGreaterThan(0.01);
  await a.click('#mode-muted');
  await b.waitForTimeout(700);
  expect(await maxLevel(b, aId, 2000)).toBeLessThan(0.005);
});
