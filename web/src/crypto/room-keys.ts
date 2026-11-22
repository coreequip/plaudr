import { fromBase64url } from '../util/base64url';

const enc = new TextEncoder();

/** Leitet aus dem Raumgeheimnis den room_ws-Raumnamen und den AES-GCM-Schlüssel ab (Spec §3). */
export async function deriveRoom(secret: string): Promise<{ roomId: string; roomKey: CryptoKey }> {
  const ikm = await crypto.subtle.importKey('raw', fromBase64url(secret), 'HKDF', false, ['deriveBits', 'deriveKey']);
  const params = (info: string): HkdfParams => ({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: enc.encode(info) });
  const idBits = new Uint8Array(await crypto.subtle.deriveBits(params('plaudr/v1/room-id'), ikm, 256));
  const roomKey = await crypto.subtle.deriveKey(params('plaudr/v1/room-key'), ikm, { name: 'AES-GCM', length: 256 }, false, [
    'encrypt',
    'decrypt',
  ]);
  return { roomId: [...idBits].map((b) => b.toString(16).padStart(2, '0')).join(''), roomKey };
}
