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


/** Geheimnis aus eingefügtem Text: ganzer Link, Link ohne Schema oder nacktes Geheimnis. */
export function secretFromLink(text: string): string | null {
  const t = text.trim();
  return secretFromHash(t.slice(t.lastIndexOf('#') + 1));
}
