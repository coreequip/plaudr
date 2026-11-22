import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test';

/** Eigener Raum je Test: 43 Zeichen base64url. */
export function roomHash(label: string): string {
  return '#' + (label.replace(/[^A-Za-z0-9]/g, '') + 'A'.repeat(43)).slice(0, 43);
}

const contexts: BrowserContext[] = [];

/** Neuer, isolierter Browser-Kontext, der nach dem Test wieder geschlossen wird (siehe closeContexts). */
export async function newContext(browser: Browser): Promise<BrowserContext> {
  const ctx = await browser.newContext();
  contexts.push(ctx);
  return ctx;
}

/** Offene Kontexte aus früheren Tests halten Mikrofon und PeerConnections und bremsen spätere Tests aus. */
export async function closeContexts(): Promise<void> {
  await Promise.all(contexts.splice(0).map((c) => c.close()));
}

export async function open(browser: Browser, hash: string, opts: { noMic?: boolean } = {}): Promise<Page> {
  return openIn(await newContext(browser), hash, opts);
}

export async function openIn(ctx: BrowserContext, hash: string, opts: { noMic?: boolean } = {}): Promise<Page> {
  const page = await ctx.newPage();
  if (opts.noMic) {
    await page.addInitScript(() => {
      navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('', 'NotAllowedError'));
    });
  }
  page.on('console', (m) => m.type() === 'warning' && console.log(`[${hash.slice(1, 6)}] ${m.text()}`));
  await page.goto('/' + hash);
  await expect(page.locator('#lobby')).toBeVisible();
  await expect(page.locator('#start')).toBeHidden();
  await expect(page.locator('#call')).toBeHidden();
  return page;
}

export const BACKUP_PW = 'geheim-123';

/** Sichert den Schlüssel über die Oberfläche und liefert den Inhalt der heruntergeladenen Datei. */
export async function backup(page: Page, pw = BACKUP_PW): Promise<string> {
  await page.fill('#backup-pw', pw);
  await page.fill('#backup-pw2', pw);
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('#backup-save')]);
  await expect(page.locator('#backup')).toBeHidden();
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

/** Tritt bei; sichert vorher den Schlüssel, falls die Lobby das verlangt. */
export async function join(page: Page, name: string): Promise<void> {
  await expect(page.locator('#join')).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.body.dataset.identity)).toBe('ready');
  if (await page.locator('#backup').isVisible()) await backup(page);
  await page.fill('#name', name);
  await page.click('#join');
  await expect(page.locator('#call')).toBeVisible();
  await expect(page.locator('#lobby')).toBeHidden();
}

/** Name gemerkt, Schlüssel gesichert, Tab frei: ohne Lobby direkt im Gespräch. */
export async function expectDirectCall(page: Page): Promise<void> {
  await expect(page.locator('#call')).toBeVisible();
  await expect(page.locator('#lobby')).toBeHidden();
}

export const connected = (page: Page) =>
  page.evaluate(() => (window.plaudr?.peers() ?? []).filter((p) => p.state === 'connected').length);
export const peerCount = (page: Page) => page.evaluate(() => window.plaudr?.peers().length ?? 0);
export const bytes = (page: Page) => page.evaluate(() => window.plaudr!.bytesReceived());

export async function expectMesh(pages: Page[], n: number): Promise<void> {
  for (const p of pages) {
    await expect.poll(() => connected(p), { timeout: 15_000 }).toBe(n);
    await expect.poll(() => peerCount(p)).toBe(n);
  }
}

export async function expectAudioFlowing(pages: Page[]): Promise<void> {
  const before = await Promise.all(pages.map(bytes));
  for (const b of before) for (const v of Object.values(b)) expect(v).toBeGreaterThan(0);
  await pages[0].waitForTimeout(2000);
  const after = await Promise.all(pages.map(bytes));
  pages.forEach((_, i) => {
    for (const [peer, v] of Object.entries(before[i])) expect(after[i][peer]).toBeGreaterThan(v);
  });
}

