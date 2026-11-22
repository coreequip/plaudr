export function toBase64url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function randomBase64url(byteCount: number): string {
  return toBase64url(crypto.getRandomValues(new Uint8Array(byteCount)));
}

const B64URL_RE = /^[A-Za-z0-9_-]*$/;

/** Gegenstück zu toBase64url; wirft bei Zeichen außerhalb von base64url oder unmöglicher Länge. */
export function fromBase64url(s: string): Uint8Array<ArrayBuffer> {
  if (!B64URL_RE.test(s) || s.length % 4 === 1) throw new TypeError('kein base64url');
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}
