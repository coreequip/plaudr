import { detectOs, type AppActions, type Platform } from './platform';
import { webPlatform } from './web';

/** Vorläufig: Rückfälle des Browsers; Task 3 bis 5 ersetzen sie durch die native Anbindung. */
export function desktopPlatform(_actions: AppActions): Platform {
  const web = webPlatform();
  return { ...web, kind: 'desktop', os: detectOs(), update() {} };
}
