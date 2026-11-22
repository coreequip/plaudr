import { listen } from '@tauri-apps/api/event';
import { CheckMenuItem, Menu, MenuItem, PredefinedMenuItem } from '@tauri-apps/api/menu';
import { TrayIcon } from '@tauri-apps/api/tray';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { register, unregister } from '@tauri-apps/plugin-global-shortcut';
import { exit } from '@tauri-apps/plugin-process';
import macIdlePng from '../../../desktop/src-tauri/icons/tray-mac@2x.png?inline';
import macSendingPng from '../../../desktop/src-tauri/icons/tray-mac-sending@2x.png?inline';
import winIdlePng from '../../../desktop/src-tauri/icons/tray-win.png?inline';
import winSendingPng from '../../../desktop/src-tauri/icons/tray-win-sending.png?inline';
import type { SpeakMode } from '../audio/gate';
import { createPttShortcut, loadDesktopPrefs, saveDesktopPrefs } from './desktop-prefs';
import { activeShortcutLabel, detectOs, type AppActions, type AppState, type Platform } from './platform';
import { GlobalPtt, type ShortcutApi } from './shortcut';
import { trayModel, type TrayItemId, type TrayModel } from './tray-model';
import { webPlatform } from './web';

/** Anbindung an tauri-plugin-global-shortcut. Nur dieser Chunk darf @tauri-apps laden. */
const shortcutApi: ShortcutApi = {
  async register(accel, cb) {
    // Nach einem Neuladen der Seite hält die App die Taste noch fest; ohne Abmelden scheitert die Registrierung.
    await unregister(accel).catch(() => {});
    await register(accel, (e) => cb(e.state));
  },
  unregister: (accel) => unregister(accel),
};

/** Ereignis aus lib.rs: Cmd+Q, Beenden über das Dock oder Abmelden des Systems. */
const QUIT_EVENT = 'plaudr://quit';
/** So lange darf das Verlassen des Raums das Beenden oder den Wechsel zu den Räumen höchstens aufhalten. */
const LEAVE_TIMEOUT_MS = 1000;
/** So lange bleibt das Fenster beim ersten Schließen mit dem Hinweis offen. */
const NOTICE_MS = 2000;
const TRAY_ID = 'plaudr';

const OUT_OF_CALL: AppState = { inCall: false, roomTitle: null, peerCount: 0, mode: 'ptt', sending: false, hasMic: false };

/** PNG aus einer data:-URL als Zahlenliste, wie sie JsImage::Bytes über die IPC erwartet. */
function pngBytes(dataUrl: string): number[] {
  const bin = atob(dataUrl.slice(dataUrl.indexOf(',') + 1));
  return Array.from(bin, (c) => c.charCodeAt(0));
}

/** Desktop-Client: globale Push-to-Talk-Taste, Tray, Fenster schließen in den Tray; Dateien vorerst wie im Browser (Task 5). */
export function desktopPlatform(actions: AppActions): Platform {
  const web = webPlatform();
  const os = detectOs();
  let state: AppState | null = null;
  const ptt = new GlobalPtt(shortcutApi, (b) => actions.setPressed(b), () => !!state?.inCall && state.mode === 'ptt');
  const pttShortcut = createPttShortcut(ptt, os);
  const win = getCurrentWindow();
  const hide = () => void win.hide().catch((err) => console.warn('[plaudr] Fenster verstecken fehlgeschlagen', err));

  // Fenster schließen = in den Tray. Beim ersten Mal bleibt es kurz mit einem Hinweis offen.
  let hideTimer: ReturnType<typeof setTimeout> | null = null;
  const dropNotice = () => {
    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = null;
    document.querySelector('.tray-notice')?.remove();
  };
  const hideToTray = () => {
    if (loadDesktopPrefs().trayNoticeShown) return hide();
    saveDesktopPrefs({ trayNoticeShown: true });
    const n = document.createElement('div');
    n.className = 'tray-notice';
    n.setAttribute('role', 'status');
    n.textContent = 'plaudr läuft im Tray weiter.';
    document.body.append(n);
    hideTimer = setTimeout(() => {
      dropNotice();
      hide();
    }, NOTICE_MS);
  };
  void win
    .onCloseRequested((e) => {
      e.preventDefault();
      // Ein zweites Schließen während des Hinweises versteckt sofort.
      if (hideTimer) {
        dropNotice();
        return hide();
      }
      hideToTray();
    })
    .catch((err) => console.warn('[plaudr] Schließen in den Tray nicht verfügbar', err));

  const showWindow = () => {
    dropNotice();
    void (async () => {
      await win.show();
      await win.unminimize();
      await win.setFocus();
    })().catch((err) => console.warn('[plaudr] Fenster zeigen fehlgeschlagen', err));
  };

  /** Verlässt den Raum, wartet darauf aber höchstens LEAVE_TIMEOUT_MS; lehnt nie ab. */
  const leaveAtMost = () =>
    Promise.race([
      actions.leave().catch((err) => console.warn('[plaudr] Verlassen fehlgeschlagen', err)),
      new Promise<void>((r) => setTimeout(r, LEAVE_TIMEOUT_MS)),
    ]);

  // Beenden: erst den Raum verlassen, damit die anderen dich sofort gehen sehen (keine Gnadenfrist), höchstens 1 s.
  let quitting: Promise<void> | null = null;
  const quit = () =>
    (quitting ??= (async () => {
      await leaveAtMost();
      await exit(0);
    })().catch((err) => {
      // Ohne Beenden bliebe jeder weitere Klick wirkungslos: beim nächsten Mal neu versuchen.
      console.warn('[plaudr] Beenden fehlgeschlagen', err);
      quitting = null;
    }));

  // Raum verlassen aus dem Tray endet wie „Verlassen“ im Fenster bei den Räumen, auch wenn das Verlassen hängt.
  const leaveRoom = async () => {
    await leaveAtMost();
    location.assign(location.pathname);
  };

  void listen(QUIT_EVENT, () => void quit()).catch((err) => console.warn('[plaudr] Beenden-Ereignis nicht verfügbar', err));

  const tray = createTray(os, () => activeShortcutLabel({ pttShortcut }), {
    mute: () => {
      const s = state ?? OUT_OF_CALL;
      actions.setMode(s.mode === 'muted' ? tray.lastVoice() : 'muted');
    },
    auto: () => actions.setMode((state ?? OUT_OF_CALL).mode === 'vad' ? 'ptt' : 'vad'),
    show: showWindow,
    leave: () => void leaveRoom(),
    quit: () => void quit(),
  });
  pttShortcut.onChange(() => tray.refresh());

  return {
    ...web,
    kind: 'desktop',
    os,
    pttShortcut,
    update(s) {
      state = s;
      // Moduswechsel oder Gespräch verlassen: Die Taste darf nicht „gedrückt“ hängen bleiben.
      if (!s.inCall || s.mode !== 'ptt') ptt.release();
      tray.update(s);
    },
  };
}

interface TrayUi {
  tray: TrayIcon;
  menu: Menu;
  header: MenuItem;
  status: MenuItem;
  statusShown: boolean;
  items: Record<TrayItemId, MenuItem | CheckMenuItem>;
  /** Häkchen an „Automatisch sprechen“ zuletzt gesetzt; null erzwingt das nächste Setzen. */
  autoChecked: boolean | null;
}

/**
 * Tray-Symbol mit Menü. Änderungen laufen nacheinander und setzen nur, was sich gegenüber dem
 * zuletzt angezeigten Stand geändert hat. Fehler (etwa ohne Tray) bleiben Warnungen.
 */
function createTray(
  os: Platform['os'],
  pttLabel: () => string | null,
  on: Record<TrayItemId, () => void>,
) {
  let state: AppState = OUT_OF_CALL;
  let lastVoice: Exclude<SpeakMode, 'muted'> = 'ptt';
  let ui: TrayUi | null = null;
  let shown: TrayModel | null = null;
  let busy = false;
  let dirty = false;

  const icons =
    os === 'mac'
      ? { idle: pngBytes(macIdlePng), sending: pngBytes(macSendingPng) }
      : { idle: pngBytes(winIdlePng), sending: pngBytes(winSendingPng) };

  async function build(): Promise<TrayUi> {
    const m = trayModel(state, pttLabel());
    const header = await MenuItem.new({ id: 'tray-header', text: m.header, enabled: false });
    const status = await MenuItem.new({ id: 'tray-status', text: m.status || ' ', enabled: false });
    const items = {} as TrayUi['items'];
    for (const it of m.items) {
      const opts = { id: `tray-${it.id}`, text: it.label, enabled: it.enabled, action: () => clicked(it.id) };
      items[it.id] = it.id === 'auto' ? await CheckMenuItem.new({ ...opts, checked: state.mode === 'vad' }) : await MenuItem.new(opts);
    }
    const sep = () => PredefinedMenuItem.new({ item: 'Separator' });
    const menu = await Menu.new({
      items: [
        header,
        ...(m.status ? [status] : []),
        await sep(),
        items.mute,
        items.auto,
        items.show,
        await sep(),
        items.leave,
        items.quit,
      ],
    });
    // Nach einem Neuladen der Seite steht das Symbol der vorigen noch da; seine Menü-Rückrufe sind tot.
    await TrayIcon.removeById(TRAY_ID).catch(() => {});
    const tray = await TrayIcon.new({
      id: TRAY_ID,
      menu,
      icon: icons[m.icon],
      iconAsTemplate: os === 'mac' && m.icon === 'idle',
      tooltip: m.tooltip,
      // Unter Windows zeigt der Linksklick das Fenster, das Menü kommt mit Rechtsklick.
      showMenuOnLeftClick: os !== 'windows',
      action: (e) => {
        if (os === 'windows' && e.type === 'Click' && e.button === 'Left' && e.buttonState === 'Up') on.show();
      },
    });
    shown = m;
    return { tray, menu, header, status, statusShown: !!m.status, items, autoChecked: state.mode === 'vad' };
  }

  function clicked(id: TrayItemId): void {
    // Ein Häkchen setzt das System beim Klick selbst; der Zustand entscheidet beim nächsten Abgleich.
    if (ui) ui.autoChecked = null;
    on[id]();
    void sync();
  }

  async function apply(u: TrayUi, m: TrayModel, autoChecked: boolean): Promise<void> {
    const p = shown;
    if (!p || p.header !== m.header) await u.header.setText(m.header);
    if (!p || p.status !== m.status) {
      if (m.status) {
        await u.status.setText(m.status);
        if (!u.statusShown) {
          await u.menu.insert(u.status, 1);
          u.statusShown = true;
        }
      } else if (u.statusShown) {
        await u.menu.remove(u.status);
        u.statusShown = false;
      }
    }
    for (const it of m.items) {
      const old = p?.items.find((o) => o.id === it.id);
      if (!old || old.label !== it.label) await u.items[it.id].setText(it.label);
      if (!old || old.enabled !== it.enabled) await u.items[it.id].setEnabled(it.enabled);
    }
    if (u.autoChecked !== autoChecked) {
      await (u.items.auto as CheckMenuItem).setChecked(autoChecked);
      u.autoChecked = autoChecked;
    }
    if (!p || p.tooltip !== m.tooltip) await u.tray.setTooltip(m.tooltip);
    if (!p || p.icon !== m.icon) {
      // macOS: Ruhe als Template (das System färbt), Senden in Farbe; beides in einem Aufruf ohne Flackern.
      if (os === 'mac') await u.tray.setIconWithAsTemplate(icons[m.icon], m.icon === 'idle');
      else await u.tray.setIcon(icons[m.icon]);
    }
    shown = m;
  }

  async function sync(): Promise<void> {
    if (!ui) return;
    if (busy) return void (dirty = true);
    busy = true;
    try {
      do {
        dirty = false;
        await apply(ui, trayModel(state, pttLabel()), state.mode === 'vad');
      } while (dirty);
    } catch (err) {
      console.warn('[plaudr] Tray-Abgleich fehlgeschlagen', err);
    } finally {
      busy = false;
    }
  }

  void build()
    .then((u) => {
      ui = u;
      return sync();
    })
    .catch((err) => console.warn('[plaudr] Tray nicht verfügbar', err));

  return {
    update(s: AppState) {
      state = s;
      if (s.mode !== 'muted') lastVoice = s.mode;
      void sync();
    },
    refresh: () => void sync(),
    /** Modus vor dem Stummschalten, für „Stummschaltung aufheben“. */
    lastVoice: () => lastVoice,
  };
}
