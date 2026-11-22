import { fromBase64url, toBase64url } from '../util/base64url';
import type { StoredIdentity } from './identity';

export const BACKUP_ITERATIONS = 600_000;
export const MIN_PASSWORD_LENGTH = 8;
const MIN_ITERATIONS = 100_000;
const MAX_ITERATIONS = 10_000_000;
const FORMAT = 'plaudr-identity';

export class BackupError extends Error {
  constructor(readonly reason: 'password' | 'format' | 'decrypt') {
    super(reason);
  }
}

interface BackupFile {
  format: typeof FORMAT;
  v: 1;
  pub: string;
  kdf: { name: 'PBKDF2'; hash: 'SHA-256'; iterations: number; salt: string };
  iv: string;
  ct: string;
}

const enc = new TextEncoder();
/** Bindet das Chiffrat an den öffentlichen Schlüssel in der Datei. */
const aad = (pub: string) => enc.encode(`${FORMAT}/v1:${pub}`);

async function wrappingKey(password: string, salt: Uint8Array<ArrayBuffer>, iterations: number, use: KeyUsage): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, base, { name: 'AES-GCM', length: 256 }, false, [use]);
}

/** Sicherungsdatei (JSON) mit dem privaten Schlüssel, verschlüsselt mit einem aus dem Passwort abgeleiteten Schlüssel. */
export async function createBackup(stored: StoredIdentity, password: string, iterations = BACKUP_ITERATIONS): Promise<string> {
  if (password.length < MIN_PASSWORD_LENGTH) throw new BackupError('password');
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const pkcs8 = await crypto.subtle.exportKey('pkcs8', stored.privateKey);
  const key = await wrappingKey(password, salt, iterations, 'encrypt');
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad(stored.pub) }, key, pkcs8);
  const file: BackupFile = {
    format: FORMAT, v: 1, pub: stored.pub,
    kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations, salt: toBase64url(salt) },
    iv: toBase64url(iv), ct: toBase64url(new Uint8Array(ct)),
  };
  return JSON.stringify(file, null, 2);
}

/** Liest eine Sicherungsdatei. Wirft BackupError('format') bei unbrauchbarer Datei, ('decrypt') bei falschem Passwort. */
export async function restoreBackup(text: string, password: string): Promise<StoredIdentity> {
  const f = parse(text);
  let salt: Uint8Array<ArrayBuffer>, iv: Uint8Array<ArrayBuffer>, ct: Uint8Array<ArrayBuffer>;
  try {
    [salt, iv, ct] = [fromBase64url(f.kdf.salt), fromBase64url(f.iv), fromBase64url(f.ct)];
  } catch {
    throw new BackupError('format');
  }
  let pkcs8: ArrayBuffer;
  try {
    const key = await wrappingKey(password, salt, f.kdf.iterations, 'decrypt');
    pkcs8 = await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: aad(f.pub) }, key, ct);
  } catch {
    throw new BackupError('decrypt');
  }
  try {
    const privateKey = await crypto.subtle.importKey('pkcs8', pkcs8, 'Ed25519', true, ['sign']);
    // Gegenprobe: Der öffentliche Teil des privaten Schlüssels muss zum pub der Datei passen.
    const jwk = await crypto.subtle.exportKey('jwk', privateKey);
    if (jwk.x !== f.pub) throw 0;
    return { privateKey, pub: f.pub, backedUp: true };
  } catch {
    throw new BackupError('format');
  }
}

function parse(text: string): BackupFile {
  let f: any;
  try {
    f = JSON.parse(text);
  } catch {
    throw new BackupError('format');
  }
  const ok =
    f && f.format === FORMAT && f.v === 1 && typeof f.pub === 'string' && typeof f.iv === 'string' && typeof f.ct === 'string' &&
    f.kdf && f.kdf.name === 'PBKDF2' && f.kdf.hash === 'SHA-256' && typeof f.kdf.salt === 'string' &&
    Number.isInteger(f.kdf.iterations) && f.kdf.iterations >= MIN_ITERATIONS && f.kdf.iterations <= MAX_ITERATIONS;
  if (!ok) throw new BackupError('format');
  return f as BackupFile;
}
