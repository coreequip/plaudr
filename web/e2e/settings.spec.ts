import { expect, test, type Browser, type Page } from '@playwright/test';
import { BACKUP_PW, backup, closeContexts, expectMesh, join, newContext, open, openIn, roomHash } from './helpers';

test.afterEach(closeContexts);

/** Leerer Startbildschirm in einem frischen Kontext, Einstellungen geöffnet. */
async function startSettings(browser: Browser, init?: () => void): Promise<Page> {
  const page = await (await newContext(browser)).newPage();
  if (init) await page.addInitScript(init);
  await page.goto('/');
  await expect(page.locator('#start')).toBeVisible();
  await page.click('#start-settings');
  await expect(page.locator('#settings')).toBeVisible();
  await expect(page.locator('#start')).toBeHidden();
  return page;
}

const accent = (p: Page) =>
  p.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim());

/** Wörter, die plaudr für die gespeicherte Identität berechnet (dieselben Module, die Vite ausliefert). */
const expectedWords = (p: Page) =>
  p.evaluate(async () => {
    const store = await import('/src/crypto/identity-store.ts' as string);
    const words = await import('/src/crypto/words.ts' as string);
    const stored = await store.idbIdentityStore().load();
    return ((await words.fingerprintWords(stored.pub)) as string[]).join(' · ');
  });

test('Farbton ändert --accent, Standardfarbe setzt zurück', async ({ browser }) => {
  const page = await startSettings(browser);
  await expect(page.locator('#hue-value')).toHaveText('Farbton 128°');
  const standard = await accent(page);
  expect(standard).toBe('#0f5c1a');
  await page.locator('#hue').fill('200');
  await expect(page.locator('#hue-value')).toHaveText('Farbton 200°');
  await expect.poll(() => accent(page)).not.toBe(standard);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('plaudr.ui')!).hue)).toBe(200);
  await page.click('#hue-reset');
  await expect.poll(() => accent(page)).toBe(standard);
  await expect(page.locator('#hue-value')).toHaveText('Farbton 128°');
});

test('Dunkel setzt data-theme=dark, bleibt nach Neuladen', async ({ browser }) => {
  const page = await startSettings(browser);
  await expect(page.locator('#theme-system')).toHaveAttribute('aria-pressed', 'true');
  await page.click('#theme-dark');
  await expect(page.locator('#theme-dark')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#theme-system')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.reload();
  await expect(page.locator('#start')).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.click('#start-settings');
  await expect(page.locator('#theme-dark')).toHaveAttribute('aria-pressed', 'true');
  await page.click('#theme-system');
  await expect(page.locator('html')).not.toHaveAttribute('data-theme');
});

test('Test-Aufnahme zeigt Pegel und gibt das Mikrofon beim Zurück frei', async ({ browser }) => {
  const page = await startSettings(browser, () => {
    const md = navigator.mediaDevices;
    const orig = md.getUserMedia.bind(md);
    const w = window as unknown as { tracks: MediaStreamTrack[] };
    w.tracks = [];
    md.getUserMedia = async (c) => {
      const s = await orig(c);
      w.tracks.push(...s.getTracks());
      return s;
    };
  });
  const live = () =>
    page.evaluate(() => (window as unknown as { tracks: MediaStreamTrack[] }).tracks.filter((t) => t.readyState === 'live').length);
  await expect.poll(live).toBeGreaterThan(0);
  await expect.poll(() => page.locator('#settings-level').evaluate((e) => parseFloat((e as HTMLElement).style.width) || 0), { timeout: 10_000 }).toBeGreaterThan(0);
  await expect(page.locator('#mic-select option').first()).toHaveText('Standardgerät');
  await page.click('#settings-back');
  await expect(page.locator('#start')).toBeVisible();
  await expect.poll(live).toBe(0);
});

test('Schwelle 70 % erscheint im Gespräch als „Schwelle 70 %“', async ({ browser }) => {
  const a = await open(browser, roomHash('schwelle'));
  await join(a, 'Anna');
  await expect(a.locator('#call #vad-threshold')).toHaveCount(0);
  await a.click('#call-settings');
  await expect(a.locator('#vad-threshold-value')).toHaveText('85 %');
  await a.locator('#vad-threshold').fill('70');
  await expect(a.locator('#vad-threshold-value')).toHaveText('70 %');
  await a.click('#settings-back');
  await expect(a.locator('#call')).toBeVisible();
  await expect(a.locator('#vad-threshold-label')).toHaveText('Schwelle 70 %');
  expect(await a.evaluate(() => JSON.parse(localStorage.getItem('plaudr.audio')!).threshold)).toBeCloseTo(0.7);
});

test('Einstellungen aus dem Gespräch und zurück: Mesh bleibt verbunden', async ({ browser }) => {
  const h = roomHash('einstmesh');
  const [a, b] = [await open(browser, h), await open(browser, h)];
  await join(a, 'Anna');
  await join(b, 'Bert');
  await expectMesh([a, b], 1);
  await a.click('#call-settings');
  await expect(a.locator('#settings')).toBeVisible();
  await expect(a.locator('#call')).toBeHidden();
  await expect(a.locator('#settings-name')).toHaveValue('Anna');
  await expect(a.locator('#settings-name-hint')).toHaveText('Gilt ab dem nächsten Beitritt.');
  // Im Gespräch kommt der Pegel aus der Gesprächs-Aufnahme.
  await expect.poll(() => a.locator('#settings-level').evaluate((e) => parseFloat((e as HTMLElement).style.width) || 0), { timeout: 10_000 }).toBeGreaterThan(0);
  await a.locator('#settings-denoise').uncheck();
  await a.waitForTimeout(1000);
  await expectMesh([a, b], 1);
  await a.click('#settings-back');
  await expect(a.locator('#call')).toBeVisible();
  await expect(a.locator('#denoise')).not.toBeChecked();
  await expectMesh([a, b], 1);
});

test('Sicherung aus den Einstellungen lädt eine Datei herunter', async ({ browser }, info) => {
  const a = await open(browser, roomHash('einstsicher'));
  await join(a, 'Anna');
  await a.click('#call-settings');
  await a.click('#settings-backup');
  await expect(a.locator('#backup-slot #backup')).toBeVisible();
  const file = await backup(a);
  expect(JSON.parse(file)).toMatchObject({ format: 'plaudr-identity', v: 1 });
  await expect(a.locator('#settings-identity-done')).toHaveText('Schlüssel gesichert.');
  const words = (await a.locator('#my-words').textContent())!;
  expect(words.split(' · ')).toHaveLength(4);

  // Und in einem anderen Browser über die Einstellungen laden.
  const path = info.outputPath('anna.plaudr-key');
  await import('node:fs/promises').then((fs) => fs.writeFile(path, file));
  const b = await startSettings(browser);
  await expect(b.locator('#my-words')).toHaveText(/^\w+ · \w+ · \w+ · \w+$/);
  await expect(b.locator('#my-words')).not.toHaveText(words);
  await b.click('#settings-restore');
  await b.setInputFiles('#restore-file', path);
  await b.fill('#restore-pw', BACKUP_PW);
  await b.click('#restore-load');
  await expect(b.locator('#settings-identity-done')).toHaveText('Sicherung geladen.');
  await expect(b.locator('#my-words')).toHaveText(words);
  await b.click('#settings-back');
  await expect(b.locator('#lobby #backup')).toBeAttached();
});

test('Auto-Beitritt aus: neuer Tab zeigt die Liste', async ({ browser }) => {
  const ctx = await newContext(browser);
  const a = await openIn(ctx, roomHash('autoaus'));
  await join(a, 'Anna');
  await a.click('#leave');
  await expect(a.locator('#start')).toBeVisible();
  await a.click('#start-settings');
  await expect(a.locator('#auto-join')).toBeChecked();
  await a.locator('#auto-join').uncheck();
  await a.click('#settings-back');
  await expect(a.locator('#start')).toBeVisible();
  await a.close();

  const b = await ctx.newPage();
  await b.goto('/');
  await expect(b.locator('#start')).toBeVisible();
  await expect(b.locator('#rooms-list li')).toHaveCount(1);
  await b.waitForTimeout(500);
  await expect(b.locator('#call')).toBeHidden();
  expect(b.url()).not.toContain('#');
});

test('vier Wörter stehen da und passen zu fingerprintWords', async ({ browser }) => {
  const a = await open(browser, roomHash('woerter'));
  await join(a, 'Anna');
  await a.click('#call-settings');
  await expect(a.locator('#my-words')).toHaveText(/^\w+ · \w+ · \w+ · \w+$/);
  await expect(a.locator('#my-words')).toHaveText(await expectedWords(a));
});
