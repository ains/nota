/**
 * IndexedDB cache for downloaded Demucs model weights (~84 MB for htdemucs),
 * so the model is fetched from Hugging Face only once per machine. Keys are
 * model IDs. Adapted from the demucs-rs web app's model cache.
 */

const DB_NAME = "nota-demucs-models";
const STORE = "weights";
const DB_VERSION = 1;

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => {
        dbPromise = null; // allow retry on failure
        reject(req.error);
      };
    });
  }
  return dbPromise;
}

/** Store model weights. */
export async function cacheModel(
  modelId: string,
  data: ArrayBuffer,
): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const req = tx.objectStore(STORE).put(data, modelId);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

/** Load cached model weights (null if not cached). */
export async function loadCachedModel(
  modelId: string,
): Promise<ArrayBuffer | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(modelId);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => reject(req.error);
  });
}

/** Drop cached weights (e.g. after they fail to load, forcing a re-download). */
export async function evictModel(modelId: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const req = tx.objectStore(STORE).delete(modelId);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}
