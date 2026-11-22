import { fromBase64url, toBase64url } from '../util/base64url';

export interface SealedEnvelope {
  v: 1;
  iv: string;
  ct: string;
}

export async function seal(key: CryptoKey, plaintext: string): Promise<SealedEnvelope> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plaintext));
  return { v: 1, iv: toBase64url(iv), ct: toBase64url(new Uint8Array(ct)) };
}

/** Öffnet einen Umschlag; null bei falscher Form, falschem Schlüssel oder Manipulation. Wirft nie. */
export async function openEnvelope(key: CryptoKey, msg: unknown): Promise<string | null> {
  if (typeof msg !== 'object' || msg === null) return null;
  const { v, iv, ct } = msg as Record<string, unknown>;
  if (v !== 1 || typeof iv !== 'string' || typeof ct !== 'string') return null;
  try {
    const ivBytes = fromBase64url(iv);
    if (ivBytes.length !== 12) return null;
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: ivBytes }, key, fromBase64url(ct));
    return new TextDecoder('utf-8', { fatal: true }).decode(pt);
  } catch {
    return null;
  }
}
