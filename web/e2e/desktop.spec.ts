import { expect, test, type Page } from '@playwright/test';
import { closeContexts, expectMesh, join, newContext, open, peerCount, roomHash } from './helpers';

test.afterEach(closeContexts);

declare global {
  interface Window {
    /** Nachgebautes tauri-plugin-global-shortcut, siehe fakeTauri. */
    fakeShortcut?: { registered: string[]; taken: string[]; fire(accel: string, state: 'Pressed' | 'Released'): void };
    /** Nachgebautes Tray, Fenster und Beenden, siehe fakeTauri. */
    fakeApp?: {
      /** Sichtbare Menüzeilen von oben nach unten; „---“ ist ein Trenner, gesperrte Einträge in Klammern. */
      menu(): string[];
      tooltip: string | null;
      /** Das Symbol beim Anlegen (außerhalb eines Gesprächs) gilt als Ruhe-Symbol. */
      icon: { sending: boolean; template: boolean } | null;
      trays: number;
      click(text: string): void;
      emit(event: string, payload?: unknown): void;
      calls: string[];
      exitCode: number | null;
    };
  }
}

/**
 * Spielt die Desktop-App im Browser: __TAURI_INTERNALS__ mit invoke und Callbacks, wie sie
 * @tauri-apps/api/core erwartet, ein globales Kürzel, das der Test selbst „drückt“, sowie Tray-Menü,
 * Fenster und Beenden, die der Test bedient.
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

  type Item = { id: string; text: string; enabled: boolean; checked?: boolean; sep: boolean; channel?: { id: number }; index: number };
  const items = new Map<number, Item>();
  let menuRid = 0;
  let menuRids: number[] = [];
  const listeners: { event: string; cb: number }[] = [];
  let idleBytes = 0;
  const app: NonNullable<Window['fakeApp']> = {
    menu: () =>
      menuRids.map((r) => {
        const i = items.get(r)!;
        if (i.sep) return '---';
        const t = i.checked ? `✓ ${i.text}` : i.text;
        return i.enabled ? t : `(${t})`;
      }),
    tooltip: null,
    icon: null,
    trays: 0,
    click(text) {
      const i = menuRids.map((r) => items.get(r)!).find((x) => x.text === text);
      if (!i || !i.enabled || !i.channel) throw new Error(`kein aktiver Eintrag ${text}`);
      if (i.checked !== undefined) i.checked = !i.checked; // Das System setzt das Häkchen beim Klick selbst.
      callbacks.get(i.channel.id)?.({ index: i.index++, message: i.id });
    },
    emit(event, payload = null) {
      for (const l of listeners.filter((x) => x.event === event)) callbacks.get(l.cb)?.({ event, id: 1, payload });
    },
    calls: [],
    exitCode: null,
  };
  window.fakeApp = app;
  type Args = Record<string, unknown> & { shortcuts?: string[]; handler?: { id: number } };
  (window as unknown as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: 'main' }, currentWebview: { windowLabel: 'main', label: 'main' } },
    transformCallback(cb: (m: unknown) => void) {
      const id = next++;
      callbacks.set(id, cb);
      return id;
    },
    unregisterCallback(id: number) {
      callbacks.delete(id);
    },
    async invoke(cmd: string, args: Args) {
      const [a] = args.shortcuts ?? [];
      if (cmd === 'plugin:global-shortcut|register') {
        if (fake.taken.includes(a) || handlers.has(a)) throw `HotKey already registered: ${a}`;
        handlers.set(a, { id: args.handler!.id, index: 0 });
        fake.registered = [...handlers.keys()];
        return null;
      }
      if (cmd === 'plugin:global-shortcut|unregister') {
        if (!handlers.delete(a)) throw `not registered: ${a}`;
        fake.registered = [...handlers.keys()];
        return null;
      }
      const rid = args.rid as number;
      const o = (args.options ?? {}) as Record<string, unknown>;
      switch (cmd) {
        case 'plugin:menu|new': {
          const r = next++;
          if (args.kind === 'Menu') {
            menuRid = r;
            menuRids = (o.items as [number, string][]).map(([ir]) => ir);
          } else {
            items.set(r, {
              id: (o.id as string) ?? String(r),
              text: (o.text as string) ?? '',
              enabled: o.enabled !== false,
              checked: args.kind === 'Check' ? !!o.checked : undefined,
              sep: o.item === 'Separator',
              channel: args.handler as { id: number },
              index: 0,
            });
          }
          return [r, (o.id as string) ?? String(r)];
        }
        case 'plugin:menu|set_text':
          items.get(rid)!.text = args.text as string;
          return null;
        case 'plugin:menu|set_enabled':
          items.get(rid)!.enabled = args.enabled as boolean;
          return null;
        case 'plugin:menu|set_checked':
          items.get(rid)!.checked = args.checked as boolean;
          return null;
        case 'plugin:menu|insert':
          if (rid === menuRid) menuRids.splice(args.position as number, 0, ...(args.items as [number, string][]).map(([r]) => r));
          return null;
        case 'plugin:menu|remove':
          if (rid === menuRid) menuRids = menuRids.filter((r) => r !== (args.item as [number, string])[0]);
          return null;
        case 'plugin:tray|remove_by_id':
          if (app.trays) app.trays--;
          return null;
        case 'plugin:tray|new':
          app.trays++;
          app.tooltip = (o.tooltip as string) ?? null;
          idleBytes = (o.icon as number[]).length;
          app.icon = { sending: false, template: !!o.iconAsTemplate };
          return [next++, o.id];
        case 'plugin:tray|set_tooltip':
          app.tooltip = args.tooltip as string;
          return null;
        case 'plugin:tray|set_icon_with_as_template':
        case 'plugin:tray|set_icon':
          app.icon = { sending: (args.icon as number[]).length !== idleBytes, template: !!args.asTemplate };
          return null;
        case 'plugin:event|listen':
          listeners.push({ event: args.event as string, cb: args.handler as unknown as number });
          return next++;
        case 'plugin:window|hide':
        case 'plugin:window|show':
        case 'plugin:window|unminimize':
        case 'plugin:window|set_focus':
        case 'plugin:window|destroy':
          app.calls.push(cmd.slice('plugin:window|'.length));
          return null;
        case 'plugin:process|exit':
          app.exitCode = args.code as number;
          app.calls.push('exit');
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

test('Desktop: gespeicherte Taste beim Start vergeben, Hinweis in den Einstellungen', async ({ browser }) => {
  const page = await (await newContext(browser)).newPage();
  await page.addInitScript(fakeTauri);
  await page.addInitScript(() => localStorage.setItem('plaudr.desktop', JSON.stringify({ pttShortcut: 'Alt+KeyB' })));
  await desktopSettings(page);
  await expect(page.locator('#ptt-key')).toHaveText('Alt+B');
  await expect(page.locator('#ptt-key-error')).toHaveText('Diese Taste ist schon vergeben. Nimm eine andere.');
  expect(await page.evaluate(() => window.fakeShortcut!.registered)).toEqual([]);
  expect(await stored(page)).toBe('Alt+KeyB');
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

test('Desktop: Tray-Menü folgt dem Gespräch, Raum verlassen führt zu den Räumen', async ({ browser }) => {
  const page = await (await newContext(browser)).newPage();
  await page.addInitScript(fakeTauri);
  await page.addInitScript(() => localStorage.setItem('plaudr.desktop', JSON.stringify({ pttShortcut: 'Alt+Space' })));
  const hash = roomHash('desktoptray');
  await page.goto('/' + hash);
  const menu = () => page.evaluate(() => window.fakeApp!.menu());
  const click = (t: string) => page.evaluate((x) => window.fakeApp!.click(x), t);
  await expect.poll(menu).toEqual([
    '(Kein Gespräch)',
    '---',
    '(Stumm schalten)',
    '(Automatisch sprechen)',
    'Fenster zeigen',
    '---',
    '(Raum verlassen)',
    'plaudr beenden',
  ]);
  expect(await page.evaluate(() => window.fakeApp!.icon)).toEqual({ sending: false, template: false });

  await join(page, 'Anna');
  const ben = await open(browser, hash);
  await join(ben, 'Ben');
  await expectMesh([page, ben], 1);
  const title = await page.locator('#room-title').textContent();
  await expect.poll(menu).toEqual([
    `(${title} · 2 im Raum)`,
    '(Automatisch)',
    '---',
    'Stumm schalten',
    '✓ Automatisch sprechen',
    'Fenster zeigen',
    '---',
    'Raum verlassen',
    'plaudr beenden',
  ]);
  expect(await page.evaluate(() => window.fakeApp!.tooltip)).toBe(`plaudr · ${title} · Automatisch`);

  // Häkchen weg: zurück zu Push-to-Talk, mit der globalen Taste im Status.
  await click('Automatisch sprechen');
  await expect(page.locator('#mode-ptt')).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(menu).toContain('(Push-to-Talk (Alt+Leertaste))');
  expect(await menu()).toContain('Automatisch sprechen');

  // Senden färbt das Symbol (anderes Bild), Loslassen wieder zurück.
  const sending = () => page.evaluate(() => window.fakeApp!.icon!.sending);
  await expect.poll(sending).toBe(false);
  await page.evaluate(() => window.fakeShortcut!.fire('Alt+Space', 'Pressed'));
  await expect.poll(sending).toBe(true);
  await page.evaluate(() => window.fakeShortcut!.fire('Alt+Space', 'Released'));
  await expect.poll(sending).toBe(false);

  await click('Stumm schalten');
  await expect(page.locator('#mode-muted')).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(menu).toContain('Stummschaltung aufheben');
  expect(await menu()).toContain('(Stumm)');
  await click('Stummschaltung aufheben');
  await expect(page.locator('#mode-ptt')).toHaveAttribute('aria-pressed', 'true');

  await click('Raum verlassen');
  await expect(page.locator('#start')).toBeVisible();
  await expect(page.locator('#call')).toBeHidden();
  // Ben sieht Anna sofort gehen, nicht erst nach der Gnadenfrist.
  await expect.poll(() => peerCount(ben), { timeout: 3000 }).toBe(0);
  await expect.poll(menu).toContain('(Kein Gespräch)');
  expect(await page.evaluate(() => window.fakeApp!.trays)).toBe(1);
});

test('Desktop: Fenster schließen geht in den Tray, Hinweis nur beim ersten Mal', async ({ browser }) => {
  const page = await (await newContext(browser)).newPage();
  await page.addInitScript(fakeTauri);
  await page.goto('/');
  await expect(page.locator('#start')).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.fakeApp!.trays)).toBe(1);
  const calls = () => page.evaluate(() => window.fakeApp!.calls);
  const close = () => page.evaluate(() => window.fakeApp!.emit('tauri://close-requested'));

  await close();
  await expect(page.locator('.tray-notice')).toHaveText('plaudr läuft im Tray weiter.');
  await expect.poll(calls).toEqual(['hide']);
  await expect(page.locator('.tray-notice')).toHaveCount(0);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('plaudr.desktop')!).trayNoticeShown)).toBe(true);

  await page.evaluate(() => window.fakeApp!.click('Fenster zeigen'));
  await expect.poll(calls).toEqual(['hide', 'show', 'unminimize', 'set_focus']);

  // Nach dem Neuladen gemerkt: kein Hinweis mehr, sofort versteckt, nie zerstört.
  await page.reload();
  await expect.poll(() => page.evaluate(() => window.fakeApp!.trays)).toBe(1);
  await close();
  await expect.poll(calls).toEqual(['hide']);
  await expect(page.locator('.tray-notice')).toHaveCount(0);
});

for (const [wie, ausloesen] of [
  ['Tray „plaudr beenden“', (p: Page) => p.evaluate(() => window.fakeApp!.click('plaudr beenden'))],
  ['Cmd+Q (Ereignis aus Rust)', (p: Page) => p.evaluate(() => window.fakeApp!.emit('plaudr://quit'))],
] as const) {
  test(`Desktop: ${wie} verlässt erst den Raum, dann exit(0)`, async ({ browser }) => {
    const page = await (await newContext(browser)).newPage();
    await page.addInitScript(fakeTauri);
    const hash = roomHash('desktopquit' + wie.length);
    await page.goto('/' + hash);
    await join(page, 'Anna');
    const ben = await open(browser, hash);
    await join(ben, 'Ben');
    await expectMesh([page, ben], 1);

    await ausloesen(page);
    await expect.poll(() => page.evaluate(() => window.fakeApp!.exitCode)).toBe(0);
    await expect.poll(() => peerCount(ben), { timeout: 3000 }).toBe(0);
  });
}
