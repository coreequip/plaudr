import { secretFromHash, secretFromLink } from '../room/link';

/** plaudr://raum#<s> (auch mit „/“ vor dem Fragment). */
const RAUM = /^plaudr:\/\/raum\/?#([^#]*)$/i;
/** plaudr://<s> und plaudr://<s>/: Das Geheimnis steht als Host. */
const HOST = /^plaudr:\/\/([^/?#]+)\/?$/i;
/** Der Einladungslink der Web-App. */
const WEB = /^https:\/\/plaudr\.room\.ws\/?#[^#]*$/i;

/**
 * Raumgeheimnis aus einem Deep-Link (Spec §8, Link-Übernahme), sonst null. Alles andere, auch der Name des
 * internen Ereignisses plaudr://quit, ist kein Raum und löst nichts aus.
 */
export function secretFromDeepLink(url: string): string | null {
  const u = url.trim();
  const raum = RAUM.exec(u);
  if (raum) return secretFromHash(raum[1]);
  const host = HOST.exec(u);
  if (host) return secretFromHash(host[1]);
  return WEB.test(u) ? secretFromLink(u) : null;
}
