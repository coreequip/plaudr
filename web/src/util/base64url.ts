export function toBase64url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function randomBase64url(byteCount: number): string {
  return toBase64url(crypto.getRandomValues(new Uint8Array(byteCount)));
}
