import type { IdentityStore, StoredIdentity } from './identity';

const DB = 'plaudr';
const STORE = 'identity';
const KEY = 'self';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function run<T>(mode: IDBTransactionMode, op: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const req = op(tx.objectStore(STORE));
        tx.oncomplete = () => {
          db.close();
          resolve(req.result as T);
        };
        tx.onerror = tx.onabort = () => {
          db.close();
          reject(tx.error ?? req.error);
        };
      }),
  );
}

/** Ablage der Identität in IndexedDB; CryptoKey ist strukturiert klonbar und bleibt dabei nicht exportierbar. */
export function idbIdentityStore(): IdentityStore {
  return {
    load: () => run<StoredIdentity | undefined>('readonly', (s) => s.get(KEY)),
    async save(v) {
      await run('readwrite', (s) => s.put(v, KEY));
      // Ohne Zusage kann der Browser die Daten bei Speicherdruck löschen; eine Absage ist kein Fehler.
      await navigator.storage?.persist?.().catch(() => false);
    },
  };
}
