const DB_NAME = 'cipher-keys';
const STORE = 'keys';
const PREFIX = 'keyPair';

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

const dbPromise = openDb();

function tx(mode, fn) {
  return dbPromise.then((db) =>
    new Promise((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const store = t.objectStore(STORE);
      const req = fn(store);
      t.oncomplete = () => resolve(req.result);
      t.onerror = () => reject(t.error);
    })
  );
}

export async function getUserKey(userId) {
  const slot = `${PREFIX}:${userId}`;
  return tx('readonly', (s) => s.get(slot));
}

export async function setUserKey(userId, keys) {
  const slot = `${PREFIX}:${userId}`;
  await tx('readwrite', (s) => s.put(keys, slot));
}

export async function deleteUserKey(userId) {
  const slot = `${PREFIX}:${userId}`;
  await tx('readwrite', (s) => s.delete(slot));
}

export async function hasUserKey(userId) {
  const existing = await getUserKey(userId);
  return Boolean(existing);
}