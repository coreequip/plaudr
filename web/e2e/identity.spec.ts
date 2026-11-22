import { expect, test } from '@playwright/test';
import { BACKUP_PW, backup, closeContexts, join, open, roomHash } from './helpers';

test.afterEach(closeContexts);

const selfId = (p: import('@playwright/test').Page) => p.evaluate(() => window.plaudr!.selfId);
const ready = (p: import('@playwright/test').Page) =>
  expect.poll(() => p.evaluate(() => document.body.dataset.identity)).toBe('ready');

test('ohne Namen kein Beitritt', async ({ browser }) => {
  const a = await open(browser, roomHash('name'));
  await ready(a);
  await backup(a);
  await a.fill('#name', '');
  await expect(a.locator('#join')).toBeDisabled();
  await a.fill('#name', '   ');
  await expect(a.locator('#join')).toBeDisabled();
  await a.fill('#name', 'Anna');
  await expect(a.locator('#join')).toBeEnabled();
});

test('neuer Schlüssel muss vor dem Beitritt gesichert werden', async ({ browser }) => {
  const a = await open(browser, roomHash('pflicht'));
  await ready(a);
  await a.fill('#name', 'Anna');
  await expect(a.locator('#backup')).toBeVisible();
  await expect(a.locator('#join')).toBeDisabled();

  await a.fill('#backup-pw', 'kurz');
  await a.fill('#backup-pw2', 'kurz');
  await a.click('#backup-save');
  await expect(a.locator('#backup-error')).toHaveText('Das Passwort braucht mindestens 8 Zeichen.');

  await a.fill('#backup-pw', BACKUP_PW);
  await a.fill('#backup-pw2', BACKUP_PW + 'x');
  await a.click('#backup-save');
  await expect(a.locator('#backup-error')).toHaveText('Die Passwörter stimmen nicht überein.');

  const file = JSON.parse(await backup(a));
  expect(file).toMatchObject({ format: 'plaudr-identity', v: 1 });
  await expect(a.locator('#join')).toBeEnabled();
});

test('nach Neuladen ist keine erneute Sicherung nötig, sie bleibt aber möglich', async ({ browser }) => {
  const a = await open(browser, roomHash('neuladen2'));
  await ready(a);
  await backup(a);
  await a.reload();
  await ready(a);
  await expect(a.locator('#backup')).toBeHidden();
  await a.fill('#name', 'Anna');
  await expect(a.locator('#join')).toBeEnabled();
  await a.click('#backup-again');
  await expect(a.locator('#backup')).toBeVisible();
  JSON.parse(await backup(a));
});

test('Identität per Sicherungsdatei in einen anderen Browser mitnehmen', async ({ browser }, info) => {
  const h = roomHash('mitnehmen');
  const a = await open(browser, h);
  await ready(a);
  const file = await backup(a);
  await join(a, 'Anna');
  const id = await selfId(a);
  await a.click('#leave');

  const b = await open(browser, h);
  await ready(b);
  const path = info.outputPath('anna.plaudr-key');
  await import('node:fs/promises').then((fs) => fs.writeFile(path, file));
  await b.locator('#restore summary').click();
  await b.setInputFiles('#restore-file', path);
  await b.fill('#restore-pw', BACKUP_PW);
  await b.click('#restore-load');
  await expect(b.locator('#backup')).toBeHidden();
  await join(b, 'Anna');
  expect(await selfId(b)).toBe(id);
});

test('Laden mit falschem Passwort oder fremder Datei', async ({ browser }, info) => {
  const a = await open(browser, roomHash('falsch'));
  await ready(a);
  const fs = await import('node:fs/promises');
  const good = info.outputPath('gut.plaudr-key');
  const bad = info.outputPath('fremd.json');
  await fs.writeFile(good, await (async () => {
    const other = await open(browser, roomHash('falsch2'));
    await ready(other);
    return backup(other);
  })());
  await fs.writeFile(bad, '{"hallo": 1}');
  await a.locator('#restore summary').click();

  await a.setInputFiles('#restore-file', good);
  await a.fill('#restore-pw', 'daneben-123');
  await a.click('#restore-load');
  await expect(a.locator('#backup-error')).toHaveText('Passwort falsch oder Datei beschädigt.');

  await a.setInputFiles('#restore-file', bad);
  await a.fill('#restore-pw', BACKUP_PW);
  await a.click('#restore-load');
  await expect(a.locator('#backup-error')).toHaveText('Das ist keine plaudr-Sicherung.');
  await expect(a.locator('#backup')).toBeVisible();
});
