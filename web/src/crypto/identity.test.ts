import { expect, test, vi } from 'vitest';
import { fromBase64url } from '../util/base64url';
import { loadOrCreateIdentity, peerIdFor, verifySignature, type IdentityStore, type StoredIdentity } from './identity';

function memoryStore(): IdentityStore & { v?: StoredIdentity; saves: number } {
  const s = {
    v: undefined as StoredIdentity | undefined,
    saves: 0,
    async load() {
      return s.v;
    },
    async save(x: StoredIdentity) {
      s.saves++;
      s.v = x;
    },
  };
  return s;
}

test('peerId entspricht dem Testvektor (RFC-8032-Testschlüssel 1)', async () => {
  const pub = fromBase64url('11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo');
  expect(await peerIdFor(pub)).toBe('eh7ddx5bksrgcytl7bkai36se4');
});

test('neue Identität wird gespeichert und beim nächsten Laden wiederverwendet', async () => {
  const store = memoryStore();
  const a = await loadOrCreateIdentity(store);
  const b = await loadOrCreateIdentity(store);
  expect(b.peerId).toBe(a.peerId);
  expect(store.saves).toBe(1);
  expect(a.persistent).toBe(true);
  expect(b.persistent).toBe(true);
});

test('privater Schlüssel ist nicht exportierbar', async () => {
  const store = memoryStore();
  await loadOrCreateIdentity(store);
  expect(store.v!.privateKey.extractable).toBe(false);
});

test('peerId passt zum pub', async () => {
  const id = await loadOrCreateIdentity(memoryStore());
  expect(await peerIdFor(fromBase64url(id.pub))).toBe(id.peerId);
  expect(id.peerId).toMatch(/^[a-z2-7]{26}$/);
});

test('Signatur ist mit dem pub prüfbar, aber nur für den signierten Text und Schlüssel', async () => {
  const id = await loadOrCreateIdentity(memoryStore());
  const other = await loadOrCreateIdentity(memoryStore());
  const sig = await id.sign('abc');
  expect(await verifySignature(id.pub, sig, 'abc')).toBe(true);
  expect(await verifySignature(id.pub, sig, 'abd')).toBe(false);
  expect(await verifySignature(other.pub, sig, 'abc')).toBe(false);
});

test('verifySignature wirft nie', async () => {
  const id = await loadOrCreateIdentity(memoryStore());
  expect(await verifySignature('!!', 'x', 'abc')).toBe(false);
  expect(await verifySignature(id.pub, '', 'abc')).toBe(false);
  expect(await verifySignature('AAAA', await id.sign('abc'), 'abc')).toBe(false);
});

test('Speicher schlägt fehl: flüchtige, aber funktionierende Identität', async () => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  const broken: IdentityStore = {
    load: () => Promise.reject(new Error('blockiert')),
    save: () => Promise.reject(new Error('blockiert')),
  };
  const id = await loadOrCreateIdentity(broken);
  expect(id.persistent).toBe(false);
  expect(await verifySignature(id.pub, await id.sign('x'), 'x')).toBe(true);
});
