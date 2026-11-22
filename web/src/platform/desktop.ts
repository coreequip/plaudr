import { register, unregister } from '@tauri-apps/plugin-global-shortcut';
import { createPttShortcut } from './desktop-prefs';
import { detectOs, type AppActions, type AppState, type Platform } from './platform';
import { GlobalPtt, type ShortcutApi } from './shortcut';
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

/** Desktop-Client: globale Push-to-Talk-Taste; Dateien vorerst wie im Browser (Task 5). */
export function desktopPlatform(actions: AppActions): Platform {
  const web = webPlatform();
  const os = detectOs();
  let state: AppState | null = null;
  const ptt = new GlobalPtt(shortcutApi, (b) => actions.setPressed(b), () => !!state?.inCall && state.mode === 'ptt');
  const pttShortcut = createPttShortcut(ptt, os);
  return {
    ...web,
    kind: 'desktop',
    os,
    pttShortcut,
    update(s) {
      state = s;
      // Moduswechsel oder Gespräch verlassen: Die Taste darf nicht „gedrückt“ hängen bleiben.
      if (!s.inCall || s.mode !== 'ptt') ptt.release();
    },
  };
}
