import { expect, test, type Page } from '@playwright/test';
import { BACKUP_PW, closeContexts, expectDirectCall, expectMesh, join, newContext, open, peerCount, roomHash } from './helpers';

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
      /** Autostart beim System; autostartFails lässt enable, disable und is_enabled scheitern. */
      autostart: boolean;
      autostartFails: boolean;
      /** Antwort des Speichern- bzw. Öffnen-Dialogs (null = abgebrochen) und die Optionen des letzten Aufrufs. */
      savePath: string | null;
      openPath: string | null;
      dialogOptions: Record<string, unknown> | null;
      /** Nachgebautes Dateisystem; written ist der zuletzt geschriebene Inhalt. */
      files: Record<string, string>;
      written: string | null;
      /** Wie tauri-plugin-deep-link: Ein Link landet in getCurrent (bleibt über ein Neuladen) und als Ereignis. */
      openUrl(urls: string[]): void;
      /** Version, die tauri-plugin-updater bei check meldet (null = kein Update), und die Zahl der Prüfungen. */
      update: string | null;
      checks: number;
    };
  }
}

/**
 * Spielt die Desktop-App im Browser: __TAURI_INTERNALS__ mit invoke und Callbacks, wie sie
 * @tauri-apps/api/core erwartet, ein globales Kürzel, das der Test selbst „drückt“, sowie Tray-Menü,
 * Fenster und Beenden, die der Test bedient.
 * Im Browser ohne diese Attrappe bleibt alles beim Alten (Tests oben).
 */
function fakeTauri(opts?: { startLinks?: string[]; update?: string }): void {
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
    autostart: false,
    autostartFails: false,
    savePath: '/Users/anna/plaudr-Anna.plaudr-key',
    openPath: null,
    dialogOptions: null,
    files: {},
    written: null,
    openUrl(urls) {
      sessionStorage.setItem('fake.deepLink', JSON.stringify(urls));
      app.emit('deep-link://new-url', urls);
    },
    update: opts?.update ?? null,
    checks: 0,
  };
  window.fakeApp = app;
  // getCurrent: der Startlink, nach einem weiteren Link dieser (das Plugin merkt sich den letzten im Prozess).
  const currentLinks = () => JSON.parse(sessionStorage.getItem('fake.deepLink') ?? 'null') ?? opts?.startLinks ?? null;
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
    async invoke(cmd: string, args: Args, options?: { headers?: Record<string, string> }) {
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
        case 'plugin:deep-link|get_current':
          return currentLinks();
        case 'plugin:autostart|is_enabled':
        case 'plugin:autostart|enable':
        case 'plugin:autostart|disable':
          app.calls.push(cmd.slice('plugin:'.length));
          if (app.autostartFails) throw 'Autostart nicht möglich';
          if (cmd !== 'plugin:autostart|is_enabled') app.autostart = cmd === 'plugin:autostart|enable';
          return app.autostart;
        case 'plugin:dialog|save':
        case 'plugin:dialog|open':
          app.calls.push(cmd.slice('plugin:'.length));
          app.dialogOptions = args.options as Record<string, unknown>;
          return cmd === 'plugin:dialog|save' ? app.savePath : app.openPath;
        case 'plugin:fs|write_text_file': {
          // Inhalt als Bytes im Rumpf, der Pfad im Kopf (wie @tauri-apps/plugin-fs ihn schickt).
          const path = decodeURIComponent(options!.headers!.path);
          app.files[path] = app.written = new TextDecoder().decode(args as unknown as Uint8Array);
          app.calls.push('fs|write_text_file');
          return null;
        }
        case 'plugin:fs|read_text_file': {
          const text = app.files[args.path as string];
          if (text === undefined) throw `Datei fehlt: ${args.path}`;
          app.calls.push('fs|read_text_file');
          return Array.from(new TextEncoder().encode(text));
        }
        case 'plugin:process|exit':
          app.exitCode = args.code as number;
          app.calls.push('exit');
          return null;
        case 'plugin:process|restart':
          app.calls.push('restart');
          return null;
        case 'plugin:updater|check':
          app.checks++;
          return app.update && { rid: next++, currentVersion: '0.1.0', version: app.update, date: null, body: null, rawJson: {} };
        case 'plugin:updater|download_and_install':
          app.calls.push('updater|download_and_install');
          return null;
        case 'plugin:resources|close':
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
  await expect(page.locator('#autostart-row')).toBeHidden();
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

const hashOf = (p: Page) => p.evaluate(() => location.hash);
const menuOf = (p: Page) => p.evaluate(() => window.fakeApp!.menu());

test('Desktop: Startlink geht dem Auto-Beitritt vor, nach dem Verlassen kein zweites Mal', async ({ browser }) => {
  const ctx = await newContext(browser);
  // Erst ein Raum, damit der Auto-Beitritt ein Ziel hätte, mit Name und Sicherung.
  const first = await ctx.newPage();
  await first.addInitScript(fakeTauri);
  await first.goto('/' + roomHash('desktopalt'));
  await join(first, 'Anna');
  await first.close();

  const link = roomHash('desktopstartlink');
  const page = await ctx.newPage();
  await page.addInitScript(fakeTauri, { startLinks: [`plaudr://raum${link}`] });
  await page.goto('/');
  await expectDirectCall(page);
  expect(await hashOf(page)).toBe(link);
  await expect.poll(() => page.evaluate(() => window.fakeApp!.calls)).toContain('show');

  // getCurrent liefert den Startlink nach jedem Neuladen wieder; „Raum verlassen“ führt trotzdem zu den Räumen.
  await page.evaluate(() => window.fakeApp!.click('Raum verlassen'));
  await expect(page.locator('#start')).toBeVisible();
  await page.waitForTimeout(1500);
  await expect(page.locator('#start')).toBeVisible();
  expect(await hashOf(page)).toBe('');
});

test('Desktop: Link im Gespräch verlässt den Raum sauber, betritt den neuen, kein zweites Tray', async ({ browser }) => {
  const page = await (await newContext(browser)).newPage();
  await page.addInitScript(fakeTauri);
  const hash = roomHash('desktoplinkalt');
  await page.goto('/' + hash);
  await join(page, 'Anna');
  const ben = await open(browser, hash);
  await join(ben, 'Ben');
  await expectMesh([page, ben], 1);
  const selfId = await page.evaluate(() => window.plaudr!.selfId);

  const next = roomHash('desktoplinkneu');
  await page.evaluate((u) => window.fakeApp!.openUrl([u]), `plaudr://${next.slice(1)}/`);
  // Ben sieht Anna sofort gehen (Verlassen vor dem Neuladen), nicht erst nach der Gnadenfrist.
  await expect.poll(() => peerCount(ben), { timeout: 3000 }).toBe(0);
  await expectDirectCall(page);
  expect(await hashOf(page)).toBe(next);
  // Dieselbe Identität im neuen Raum, ein einziges Tray-Symbol, dessen Menü dem neuen Gespräch folgt.
  expect(await page.evaluate(() => window.plaudr!.selfId)).toBe(selfId);
  await expect.poll(() => page.evaluate(() => window.fakeApp!.trays)).toBe(1);
  const title = await page.locator('#room-title').textContent();
  await expect.poll(() => menuOf(page)).toContain(`(${title} · 1 im Raum)`);

  // Derselbe Link noch einmal: Fenster nach vorn, das Gespräch bleibt.
  await page.evaluate((u) => window.fakeApp!.openUrl([u]), `plaudr://raum${next}`);
  await expect.poll(() => page.evaluate(() => window.fakeApp!.calls.filter((c) => c === 'show').length)).toBe(1);
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => window.plaudr!.selfId)).toBe(selfId);
  await expect(page.locator('#call')).toBeVisible();

  // Beenden aus dem Tray wirkt auch nach dem Neuladen.
  await page.evaluate(() => window.fakeApp!.click('plaudr beenden'));
  await expect.poll(() => page.evaluate(() => window.fakeApp!.exitCode)).toBe(0);
});

for (const url of ['plaudr://quit', 'plaudr://raum', 'https://example.com/#' + 'A'.repeat(43)]) {
  test(`Desktop: ungültiger Link ${url} zeigt nur einen Hinweis`, async ({ browser }) => {
    const page = await (await newContext(browser)).newPage();
    await page.addInitScript(fakeTauri);
    await page.goto('/');
    await expect(page.locator('#start')).toBeVisible();
    await expect.poll(() => page.evaluate(() => window.fakeApp!.trays)).toBe(1);
    await page.evaluate((u) => window.fakeApp!.openUrl([u]), url);
    await expect(page.locator('.link-notice')).toHaveText('Das ist kein plaudr-Link.');
    await expect.poll(() => page.evaluate(() => window.fakeApp!.calls)).toContain('show');
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => window.fakeApp!.exitCode)).toBeNull();
    await expect(page.locator('#start')).toBeVisible();
    expect(await hashOf(page)).toBe('');
  });
}

test('Desktop: Beim Anmelden starten folgt dem System, Fehler als Hinweis', async ({ browser }) => {
  const page = await (await newContext(browser)).newPage();
  await page.addInitScript(fakeTauri);
  await desktopSettings(page);
  const box = page.locator('#autostart');
  await expect(page.locator('#autostart-row')).toHaveText('Beim Anmelden starten (im Tray)');
  await expect(box).toBeEnabled();
  await expect(box).not.toBeChecked();

  await box.check();
  await expect.poll(() => page.evaluate(() => window.fakeApp!.autostart)).toBe(true);
  await expect(page.locator('#autostart-error')).toBeHidden();

  // Der Zustand kommt vom System, nicht aus dem eigenen Speicher.
  await page.click('#settings-back');
  await page.evaluate(() => (window.fakeApp!.autostart = false));
  await page.click('#start-settings');
  await expect(box).not.toBeChecked();
  await page.evaluate(() => (window.fakeApp!.autostart = true));
  await page.click('#settings-back');
  await page.click('#start-settings');
  await expect(box).toBeChecked();

  // Scheitert das Ausschalten, bleibt der Haken und ein Hinweis erscheint.
  await page.evaluate(() => (window.fakeApp!.autostartFails = true));
  await box.click();
  await expect(page.locator('#autostart-error')).toHaveText('Das System hat den Start beim Anmelden nicht übernommen.');
  await expect(box).toBeChecked();
  expect(await page.evaluate(() => window.fakeApp!.autostart)).toBe(true);

  await page.click('#settings-back');
  await page.click('#start-settings');
  await expect(page.locator('#autostart-error')).toHaveText('Ob plaudr beim Anmelden startet, ließ sich nicht abfragen.');
});

test('Desktop: Sicherung über native Dialoge speichern und laden', async ({ browser }) => {
  const h = roomHash('desktopsicherung');
  const a = await (await newContext(browser)).newPage();
  await a.addInitScript(fakeTauri);
  await a.goto('/' + h);
  await expect(a.locator('#backup')).toBeVisible();
  await a.fill('#backup-pw', BACKUP_PW);
  await a.fill('#backup-pw2', BACKUP_PW);

  // Abgebrochener Dialog: nichts geschrieben, Sicherung weiter ausstehend.
  await a.evaluate(() => (window.fakeApp!.savePath = null));
  await a.click('#backup-save');
  await expect.poll(() => a.evaluate(() => window.fakeApp!.calls)).toContain('dialog|save');
  await expect(a.locator('#backup-save')).toBeEnabled();
  await expect(a.locator('#backup')).toBeVisible();
  expect(await a.evaluate(() => window.fakeApp!.written)).toBeNull();

  await a.evaluate(() => (window.fakeApp!.savePath = '/Users/anna/Sicherungen/anna.plaudr-key'));
  await a.click('#backup-save');
  await expect(a.locator('#backup')).toBeHidden();
  const opts = await a.evaluate(() => window.fakeApp!.dialogOptions);
  expect(opts).toEqual({ defaultPath: expect.stringMatching(/^plaudr-.+\.plaudr-key$/), filters: [{ name: 'plaudr-Sicherung', extensions: ['plaudr-key'] }] });
  const file = await a.evaluate(() => window.fakeApp!.files['/Users/anna/Sicherungen/anna.plaudr-key']);
  expect(JSON.parse(file)).toBeTruthy();
  await join(a, 'Anna');
  const id = await a.evaluate(() => window.plaudr!.selfId);
  await a.click('#leave');
  await expect(a.locator('#start')).toBeVisible();

  // Zweiter Rechner: Dateifeld versteckt, „Datei wählen“ mit Dateiname daneben.
  const b = await (await newContext(browser)).newPage();
  await b.addInitScript(fakeTauri);
  await b.goto('/' + h);
  await expect(b.locator('#backup')).toBeVisible();
  await b.locator('#restore summary').click();
  await expect(b.locator('#restore-file')).toBeHidden();
  await expect(b.locator('#restore-pick')).toHaveText('Datei wählen');
  await expect(b.locator('#restore-file-name')).toHaveText('Keine Datei gewählt');
  await b.fill('#restore-pw', BACKUP_PW);
  await b.click('#restore-load');
  await expect(b.locator('#restore-error')).toHaveText('Wähle zuerst die Sicherungsdatei.');

  // Abgebrochen: keine Datei; dann die Sicherung von a.
  await b.click('#restore-pick');
  await expect.poll(() => b.evaluate(() => window.fakeApp!.calls)).toContain('dialog|open');
  await expect(b.locator('#restore-file-name')).toHaveText('Keine Datei gewählt');
  await b.evaluate((text) => {
    window.fakeApp!.files['C:\\Users\\anna\\anna.plaudr-key'] = text;
    window.fakeApp!.openPath = 'C:\\Users\\anna\\anna.plaudr-key';
  }, file);
  await b.click('#restore-pick');
  await expect(b.locator('#restore-file-name')).toHaveText('anna.plaudr-key');
  expect(await b.evaluate(() => window.fakeApp!.dialogOptions)).toEqual({
    multiple: false,
    directory: false,
    filters: [{ name: 'plaudr-Sicherung', extensions: ['plaudr-key'] }],
  });
  await b.click('#restore-load');
  await expect(b.locator('#backup')).toBeHidden();
  await join(b, 'Anna');
  expect(await b.evaluate(() => window.plaudr!.selfId)).toBe(id);
});

test('Desktop: Update auf dem Startbildschirm, Knopf installiert und startet neu', async ({ browser }) => {
  const page = await (await newContext(browser)).newPage();
  await page.addInitScript(fakeTauri, { update: '0.2.0' });
  await page.goto('/');
  await expect(page.locator('#start')).toBeVisible();
  await expect(page.locator('#update-text')).toHaveText('Neue Version 0.2.0 verfügbar.');
  const button = page.locator('#update-install');
  await expect(button).toHaveText('Jetzt aktualisieren');
  // Bis zum Klick wird nichts geladen.
  expect(await page.evaluate(() => window.fakeApp!.calls)).not.toContain('updater|download_and_install');

  await button.click();
  await expect.poll(() => page.evaluate(() => window.fakeApp!.calls)).toEqual(['updater|download_and_install', 'restart']);
  await expect(button).toBeDisabled();
});

test('Desktop: ohne Update kein Hinweis', async ({ browser }) => {
  const page = await (await newContext(browser)).newPage();
  await page.addInitScript(fakeTauri);
  await page.goto('/');
  await expect(page.locator('#start')).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.fakeApp!.checks)).toBe(1);
  await expect(page.locator('#update')).toHaveCount(0);
});

test('Desktop: im Gespräch kein Hinweis und keine Installation, nach dem Verlassen wieder', async ({ browser }) => {
  const page = await (await newContext(browser)).newPage();
  await page.clock.install();
  await page.addInitScript(fakeTauri, { update: '0.2.0' });
  await page.goto('/' + roomHash('desktopupdate'));
  await expect.poll(() => page.evaluate(() => window.fakeApp!.checks)).toBe(1);
  await join(page, 'Anna');
  await expect(page.locator('#update')).toHaveCount(0);

  // Die Prüfung nach 6 h fällt ins Gespräch: keine Prüfung, kein Hinweis.
  await page.clock.fastForward('06:00:01');
  await expect(page.locator('#call')).toBeVisible();
  expect(await page.evaluate(() => window.fakeApp!.checks)).toBe(1);
  await expect(page.locator('#update')).toHaveCount(0);
  expect(await page.evaluate(() => window.fakeApp!.calls)).not.toContain('updater|download_and_install');

  await page.click('#leave');
  await expect(page.locator('#start')).toBeVisible();
  await expect(page.locator('#update-text')).toHaveText('Neue Version 0.2.0 verfügbar.');
  expect(await page.evaluate(() => window.fakeApp!.calls)).not.toContain('updater|download_and_install');
});
