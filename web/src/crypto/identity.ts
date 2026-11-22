import { fromBase64url, toBase64url } from '../util/base64url';

export interface Identity {
  readonly peerId: string;
  /** Öffentlicher Ed25519-Schlüssel, roh, base64url. */
  readonly pub: string;
  /** false, wenn die Identität nicht gespeichert werden konnte und mit dem Tab verschwindet. */
  readonly persistent: boolean;
  sign(data: string): Promise<string>;
}

export interface StoredIdentity {
  privateKey: CryptoKey;
  pub: string;
}

export interface IdentityStore {
  load(): Promise<StoredIdentity | undefined>;
  save(s: StoredIdentity): Promise<void>;
}

const BASE32 = 'abcdefghijklmnopqrstuvwxyz234567';
const PEER_ID_LENGTH = 26;
const enc = new TextEncoder();

/** peerId = base32(SHA-256(pubRaw))[0..26], RFC 4648 in Kleinbuchstaben (Spec §4). */
export async function peerIdFor(pubRaw: Uint8Array<ArrayBuffer>): Promise<string> {
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', pubRaw));
  let out = '';
  let bits = 0;
  let acc = 0;
  for (const b of hash) {
    acc = ((acc << 8) | b) & 0xffff;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(acc >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(acc << (5 - bits)) & 31];
  return out.slice(0, PEER_ID_LENGTH);
}

export async function loadOrCreateIdentity(store: IdentityStore): Promise<Identity> {
  let persistent = true;
  let stored: StoredIdentity | undefined;
  try {
    stored = await store.load();
  } catch (err) {
    console.warn('[plaudr] Identität nicht ladbar', err);
    persistent = false;
  }
  if (!stored) {
    stored = await createKeys();
    if (persistent) {
      try {
        await store.save(stored);
      } catch (err) {
        console.warn('[plaudr] Identität nicht speicherbar', err);
        persistent = false;
      }
    }
  }
  const { privateKey, pub } = stored;
  return {
    peerId: await peerIdFor(fromBase64url(pub)),
    pub,
    persistent,
    sign: async (data) => toBase64url(new Uint8Array(await crypto.subtle.sign('Ed25519', privateKey, enc.encode(data)))),
  };
}

/** Prüft eine Ed25519-Signatur; false bei jedem Fehler, wirft nie. */
export async function verifySignature(pub: string, sig: string, data: string): Promise<boolean> {
  try {
    const key = await crypto.subtle.importKey('raw', fromBase64url(pub), 'Ed25519', false, ['verify']);
    return await crypto.subtle.verify('Ed25519', key, fromBase64url(sig), enc.encode(data));
  } catch {
    return false;
  }
}

async function createKeys(): Promise<StoredIdentity> {
  const pair = (await crypto.subtle.generateKey('Ed25519', false, ['sign', 'verify'])) as CryptoKeyPair;
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  return { privateKey: pair.privateKey, pub: toBase64url(raw) };
}
