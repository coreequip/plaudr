import { expect, test, type Page } from '@playwright/test';
import { closeContexts, join, newContext, roomHash } from './helpers';

test.afterEach(closeContexts);

declare global {
  interface Window {
    /** Nachgebautes tauri-plugin-global-shortcut, siehe fakeTauri. */
    fakeShortcut?: { registered: string[]; taken: string[]; fire(accel: string, state: 'Pressed' | 'Released'): void };
  }
}

/**
 * Spielt die Desktop-App im Browser: __TAURI_INTERNALS__ mit invoke und Callbacks, wie sie
 * @tauri-apps/api/core erwartet, und ein globales Kürzel, das der Test selbst „drückt“.
 * Im Browser ohne diese Attrappe bleibt alles beim Alten (Tests oben).
 */
function fakeTauri(): void {
  const callbacks = new Map<number, (m: unknown) => void>();
  const handlers = new Map<string, { id: number; index: number }>();
  let next = 1;
  const fake = {
    registered: [] as string[],
    taken: ['Alt+KeyB'],
    fire(accel: string, state: 'Pressed' | 'Released') {
      const h = handlers.get(accel);
      if (!h) return;
      callbacks.get(h.id)?.({ index: h.index++, message: { shortcut: accel, id: 1, state } });
    },
  };
  window.fakeShortcut = fake;
  (window as unknown as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {
    transformCallback(cb: (m: unknown) => void) {
      const id = next++;
      callbacks.set(id, cb);
      return id;
    },
    unregisterCallback(id: number) {
      callbacks.delete(id);
    },
    async invoke(cmd: string, args: { shortcuts: string[]; handler: { id: number } }) {
      const [a] = args.shortcuts ?? [];
      if (cmd === 'plugin:global-shortcut|register') {
        if (fake.taken.includes(a) || handlers.has(a)) throw `HotKey already registered: ${a}`;
        handlers.set(a, { id: args.handler.id, index: 0 });
        fake.registered = [...handlers.keys()];
        return null;
      }
      if (cmd === 'plugin:global-shortcut|unregister') {
        if (!handlers.delete(a)) throw `not registered: ${a}`;
        fake.registered = [...handlers.keys()];
        return null;
      }
      throw `unbekannter Befehl ${cmd}`;
    },
  };
}

async function desktopSettings(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.locator('#start')).toBeVisible();
  await page.click('#start-settings');
  await expect(page.locator('#ptt-desktop')).toBeVisible();
}

const stored = (p: Page) => p.evaluate(() => JSON.parse(localStorage.getItem('plaudr.desktop') ?? 'null')?.pttShortcut ?? null);

test('Browser: Leertaste als Hinweis, keine globale Taste', async ({ browser }) => {
  const page = await (await newContext(browser)).newPage();
  await page.goto('/');
  await page.click('#start-settings');
  await expect(page.locator('#ptt-info')).toHaveText('Leertaste, solange plaudr im Vordergrund ist.');
  await expect(page.locator('#ptt-desktop')).toBeHidden();
});

test('Desktop: Taste aufnehmen, ungültig, vergeben, entfernen', async ({ browser }) => {
  const page = await (await newContext(browser)).newPage();
  await page.addInitScript(fakeTauri);
  await desktopSettings(page);
  await expect(page.locator('#ptt-info')).toBeHidden();
  await expect(page.locator('#ptt-desktop')).toContainText('Globale Taste');
  await expect(page.locator('#ptt-desktop')).toContainText('wirkt auch, wenn plaudr im Hintergrund ist');
  await expect(page.locator('#ptt-desktop')).toContainText('Nachlauf nach dem Loslassen150 ms');
  await expect(page.locator('#ptt-key')).toHaveText('keine Taste');
  await expect(page.locator('#ptt-remove')).toBeDisabled();

  // Ohne Modifikator ungültig, die Aufnahme läuft weiter; Escape bricht ab.
  await page.click('#ptt-record');
  await page.keyboard.press('p');
  await expect(page.locator('#ptt-key-error')).toHaveText('Nimm eine Taste mit ⌥, ⌘, Strg oder Umschalt, oder F13 bis F24.');
  await page.keyboard.press('Escape');
  await expect(page.locator('#ptt-key')).toHaveText('keine Taste');
  await expect(page.locator('#ptt-key-error')).toBeHidden();

  // „Desktop Chrome“ meldet sich als Windows: Alt+Leertaste.
  await page.click('#ptt-record');
  await page.keyboard.press('Alt+Space');
  await expect(page.locator('#ptt-key')).toHaveText('Alt+Leertaste');
  expect(await stored(page)).toBe('Alt+Space');
  expect(await page.evaluate(() => window.fakeShortcut!.registered)).toEqual(['Alt+Space']);

  // Vergeben: Hinweis, die bisherige Taste bleibt gespeichert und registriert.
  await page.click('#ptt-record');
  await page.keyboard.press('Alt+KeyB');
  await expect(page.locator('#ptt-key-error')).toHaveText('Diese Taste ist schon vergeben. Nimm eine andere.');
  await expect(page.locator('#ptt-key')).toHaveText('Alt+Leertaste');
  expect(await stored(page)).toBe('Alt+Space');
  expect(await page.evaluate(() => window.fakeShortcut!.registered)).toEqual(['Alt+Space']);

  await page.click('#ptt-record');
  await page.keyboard.press('Control+Shift+KeyP');
  await expect(page.locator('#ptt-key')).toHaveText('Strg+Umschalt+P');
  await expect(page.locator('#ptt-key-error')).toBeHidden();
  expect(await page.evaluate(() => window.fakeShortcut!.registered)).toEqual(['CommandOrControl+Shift+KeyP']);

  await page.click('#ptt-remove');
  await expect(page.locator('#ptt-key')).toHaveText('keine Taste');
  expect(await stored(page)).toBeNull();
  expect(await page.evaluate(() => window.fakeShortcut!.registered)).toEqual([]);

  // Nach dem Neuladen bleibt die Taste und wird wieder registriert.
  await page.click('#ptt-record');
  await page.keyboard.press('Alt+Space');
  await expect(page.locator('#ptt-key')).toHaveText('Alt+Leertaste');
  await page.reload();
  await page.click('#start-settings');
  await expect(page.locator('#ptt-key')).toHaveText('Alt+Leertaste');
  await expect.poll(() => page.evaluate(() => window.fakeShortcut!.registered)).toEqual(['Alt+Space']);
});

test('Desktop: globale Taste sendet nur im Push-to-Talk, Moduswechsel löst', async ({ browser }) => {
  const ctx = await newContext(browser);
  const page = await ctx.newPage();
  await page.addInitScript(fakeTauri);
  await page.addInitScript(() => localStorage.setItem('plaudr.desktop', JSON.stringify({ pttShortcut: 'Alt+Space' })));
  await page.goto('/' + roomHash('desktopptt'));
  await join(page, 'Anna');
  await expect.poll(() => page.evaluate(() => window.fakeShortcut!.registered)).toEqual(['Alt+Space']);
  const fire = (s: 'Pressed' | 'Released') => page.evaluate((st) => window.fakeShortcut!.fire('Alt+Space', st), s);
  const ptt = page.locator('#ptt');

  // Im Modus Automatisch zählt das Drücken nicht.
  await fire('Pressed');
  await fire('Released');
  await page.click('#mode-ptt');
  await expect(ptt).toBeVisible();
  await expect(ptt).not.toHaveClass(/active/);
  await expect(page.locator('#ptt .ptt-hint')).toHaveText('oder Alt+Leertaste überall, auch im Hintergrund');

  await fire('Pressed');
  await expect(ptt).toHaveClass(/active/);
  await expect.poll(() => page.evaluate(() => window.plaudr!.activity().open)).toBe(true);
  await fire('Released');
  await expect(ptt).not.toHaveClass(/active/);
  await expect.poll(() => page.evaluate(() => window.plaudr!.activity().open)).toBe(false);

  // Gehalten und Modus gewechselt: sofort Schluss, das späte Loslassen ist harmlos.
  await fire('Pressed');
  await expect(ptt).toHaveClass(/active/);
  await page.click('#mode-vad');
  await page.click('#mode-ptt');
  await expect(ptt).not.toHaveClass(/active/);
  await fire('Released');
  await expect(ptt).not.toHaveClass(/active/);

  // Ein eingerasteter Knopf wird vom Loslassen der globalen Taste gelöst, wie bei der Leertaste.
  await ptt.click();
  await expect(ptt).toHaveAttribute('aria-pressed', 'true');
  await fire('Pressed');
  await fire('Released');
  await expect(ptt).toHaveAttribute('aria-pressed', 'false');
  await expect(ptt).not.toHaveClass(/active/);
});

test('Desktop ohne Taste: Hinweis bleibt bei der Leertaste', async ({ browser }) => {
  const page = await (await newContext(browser)).newPage();
  await page.addInitScript(fakeTauri);
  await page.goto('/' + roomHash('desktopohne'));
  await join(page, 'Anna');
  await page.click('#mode-ptt');
  await expect(page.locator('#ptt .ptt-hint')).toHaveText('oder Leertaste');
});
