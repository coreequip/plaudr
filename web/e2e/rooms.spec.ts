import { expect, test, type Page } from '@playwright/test';
import { closeContexts, join, newContext, open, roomHash } from './helpers';

test.afterEach(closeContexts);

const secretOf = (hash: string) => hash.slice(1);

/** Tritt bei und kehrt ohne Verlassen-Knopf zur Startseite zurück (gleicher Kontext, gleiche Sitzung). */
async function joinAndGoHome(page: Page, name: string): Promise<void> {
  await join(page, name);
  await page.goto('/');
  await expect(page.locator('#start')).toBeVisible();
}

test('leerer Start zeigt den Hinweis', async ({ browser }) => {
  const page = await (await newContext(browser)).newPage();
  await page.goto('/');
  await expect(page.locator('#start')).toBeVisible();
  await expect(page.locator('#rooms-empty')).toHaveText('Noch keine Räume. Erstell einen oder füg einen Einladungslink ein.');
  await expect(page.locator('#rooms-list li')).toHaveCount(0);
});

test('nach Beitritt und Verlassen steht der Raum als „Raum vom <heute>“ in der Liste und es gibt keinen Auto-Beitritt', async ({ browser }) => {
  const hash = roomHash('liste');
  const page = await open(browser, hash);
  await joinAndGoHome(page, 'Anna');
  // Neuladen in derselben Sitzung betritt nicht erneut.
  await expect(page.locator('#lobby')).toBeHidden();
  const card = page.locator('#rooms-list li');
  await expect(card).toHaveCount(1);
  await expect(card).toHaveAttribute('data-room', secretOf(hash));
  const heute = new Intl.DateTimeFormat('de-DE', { day: 'numeric', month: 'long' }).format(new Date());
  await expect(card.locator('.room-title')).toHaveText(`Raum vom ${heute}`);
  await expect(card).toContainText('heute');
  await expect(card).toContainText('zuletzt genutzt, wird beim Start betreten');
  expect(page.url()).not.toContain('#');
});

test('Umbenennen und Entfernen', async ({ browser }) => {
  const page = await open(browser, roomHash('umbenennen'));
  await joinAndGoHome(page, 'Anna');
  const card = page.locator('#rooms-list li');

  await card.locator('.room-rename').click();
  await card.locator('.room-name-input').fill('Spieleabend');
  await card.locator('.room-name-input').press('Escape');
  await expect(card.locator('.room-title')).toContainText('Raum vom');

  await card.locator('.room-rename').click();
  await card.locator('.room-name-input').fill('Spieleabend');
  await card.locator('.room-name-input').press('Enter');
  await expect(card.locator('.room-title')).toHaveText('Spieleabend');
  await page.reload();
  await expect(page.locator('#rooms-list li .room-title')).toHaveText('Spieleabend');

  await card.locator('.room-rename').click();
  await card.locator('.room-name-input').fill('Familie');
  await card.locator('.room-name-save').click();
  await expect(card.locator('.room-title')).toHaveText('Familie');

  await card.locator('.room-rename').click();
  await card.locator('.room-remove').click();
  await expect(page.locator('#rooms-list li')).toHaveCount(0);
  await expect(page.locator('#rooms-empty')).toBeVisible();
});

test('eingefügter Link öffnet die Lobby, Unsinn zeigt den Fehler', async ({ browser }) => {
  const page = await (await newContext(browser)).newPage();
  await page.goto('/');
  await page.fill('#paste-link', 'das ist kein link');
  await page.click('#paste-open');
  await expect(page.locator('#paste-error')).toHaveText('Das ist kein plaudr-Link.');
  await expect(page.locator('#start')).toBeVisible();

  const hash = roomHash('einfuegen');
  await page.fill('#paste-link', `http://localhost:5174/${hash}`);
  await page.click('#paste-open');
  await expect(page.locator('#lobby')).toBeVisible();
  expect(page.url()).toContain(hash);
});

test('neue Seite im selben Kontext mit leerem sessionStorage landet im letzten Raum (Fragment gesetzt)', async ({ browser }) => {
  const hash = roomHash('auto');
  const ctx = await newContext(browser);
  const first = await ctx.newPage();
  await first.goto('/' + hash);
  await join(first, 'Anna');
  await first.close(); // sonst greift die Tab-Sperre
  const second = await ctx.newPage();
  await second.goto('/');
  await expect(second.locator('#lobby')).toBeVisible();
  expect(new URL(second.url()).hash).toBe(hash);
});

test('ein gewählter Farbton ändert --accent', async ({ browser }) => {
  const ctx = await newContext(browser);
  const page = await ctx.newPage();
  await page.addInitScript(() => localStorage.setItem('plaudr.ui', JSON.stringify({ theme: 'light', hue: 200, autoJoin: true })));
  await page.goto('/');
  const accent = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim());
  expect(accent).not.toBe('#0f5c1a');
  expect(accent).toMatch(/^#[0-9a-f]{6}$/);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});
