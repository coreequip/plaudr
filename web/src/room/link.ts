import { randomBase64url } from '../util/base64url';

const SECRET_RE = /^[A-Za-z0-9_-]{43}$/;

/** 32 Zufallsbytes als base64url ohne Padding (43 Zeichen). */
export function createRoomSecret(): string {
  return randomBase64url(32);
}

export function secretFromHash(hash: string): string | null {
  const s = hash.startsWith('#') ? hash.slice(1) : hash;
  return SECRET_RE.test(s) ? s : null;
}

export function buildLink(origin: string, secret: string): string {
  return `${origin}/#${secret}`;
}

/** M1: Klartext-Raumname. M2 ersetzt das durch HKDF(secret, "plaudr/v1/room-id"). */
export function roomIdFor(secret: string): string {
  return 'plaudr-m1-' + secret;
}
