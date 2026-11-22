import { beforeAll, expect, test } from 'vitest';
import { toBase64url } from '../util/base64url';
import { BackupError, createBackup, restoreBackup } from './backup';
import { loadOrCreateIdentity, verifySignature, type StoredIdentity } from './identity';

const PW = 'korrekt pferd batterie';
const ITER = 100_000;
let stored: StoredIdentity;

beforeAll(async () => {
  const store = { v: undefined as StoredIdentity | undefined, load: async () => store.v, save: async (x: StoredIdentity) => void (store.v = x) };
  await loadOrCreateIdentity(store);
  stored = store.v!;
});

async function reason(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return 'kein Fehler';
  } catch (e) {
    return e instanceof BackupError ? e.reason : String(e);
  }
}

test('Sicherung und Wiederherstellung ergeben dieselbe, funktionierende Identität', async () => {
  const restored = await restoreBackup(await createBackup(stored, PW, ITER), PW);
  expect(restored.pub).toBe(stored.pub);
  expect(restored.backedUp).toBe(true);
  expect(restored.privateKey.extractable).toBe(true);
  const sig = new Uint8Array(await crypto.subtle.sign('Ed25519', restored.privateKey, new TextEncoder().encode('x')));
  expect(await verifySignature(stored.pub, toBase64url(sig), 'x')).toBe(true);
});

test('die Datei enthält den privaten Schlüssel nicht im Klartext', async () => {
  const text = await createBackup(stored, PW, ITER);
  const pkcs8 = toBase64url(new Uint8Array(await crypto.subtle.exportKey('pkcs8', stored.privateKey)));
  const file = JSON.parse(text);
  expect(file).toMatchObject({ format: 'plaudr-identity', v: 1, pub: stored.pub, kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: ITER } });
  expect(text).not.toContain(pkcs8);
  expect(text).not.toContain(pkcs8.slice(-43));
});

test('Standard sind 600 000 PBKDF2-Runden', async () => {
  expect(JSON.parse(await createBackup(stored, PW)).kdf.iterations).toBe(600_000);
});

test('falsches Passwort', async () => {
  expect(await reason(restoreBackup(await createBackup(stored, PW, ITER), 'falsch falsch'))).toBe('decrypt');
});

test('ausgetauschter öffentlicher Schlüssel in der Datei fällt auf', async () => {
  const file = JSON.parse(await createBackup(stored, PW, ITER));
  file.pub = 'A' + file.pub.slice(1);
  expect(await reason(restoreBackup(JSON.stringify(file), PW))).toBe('decrypt');
});

test.each<[string, (f: any) => unknown]>([
  ['kein JSON', () => 'nicht json'],
  ['falsches Format', (f) => ({ ...f, format: 'anderes' })],
  ['andere Version', (f) => ({ ...f, v: 2 })],
  ['zu wenige Runden', (f) => ({ ...f, kdf: { ...f.kdf, iterations: 1000 } })],
  ['fehlendes ct', ({ ct: _ct, ...rest }) => rest],
])('unbrauchbare Datei: %s', async (_l, mutate) => {
  const f = JSON.parse(await createBackup(stored, PW, ITER));
  const m = mutate(f);
  expect(await reason(restoreBackup(typeof m === 'string' ? m : JSON.stringify(m), PW))).toBe('format');
});

test('zu kurzes Passwort wird beim Sichern abgelehnt', async () => {
  expect(await reason(createBackup(stored, '1234567', ITER))).toBe('password');
});
