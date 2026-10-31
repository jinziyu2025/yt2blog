/*
 * Free-tier counter, persisted in IndexedDB (survives "clear cache" in a
 * normal browsing session, unlike a localStorage-only counter). Client-only:
 * this module is imported exclusively from the homepage component.
 */

const DB_NAME = "yt2blog";
const DB_VERSION = 1;
const STORE_NAME = "usage";
const COUNT_KEY = "generations-used";

// Fallback for browsers/environments where IndexedDB is blocked.
const FALLBACK_KEY = "yt2blog:generations-used";

function readFallback(): number {
  try {
    const value = Number.parseInt(window.localStorage.getItem(FALLBACK_KEY) ?? "0", 10);
    return Number.isFinite(value) && value > 0 ? value : 0;
  } catch {
    return 0;
  }
}

function writeFallback(value: number) {
  try {
    window.localStorage.setItem(FALLBACK_KEY, String(value));
  } catch {
    // Private mode with storage disabled: the in-memory state still gates this session.
  }
}

function openDatabase(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (typeof indexedDB === "undefined") {
      resolve(null);
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
}

export async function readGenerationsUsed(): Promise<number> {
  const db = await openDatabase();
  if (!db) return readFallback();

  return new Promise<number>((resolve) => {
    let settled = false;

    const finish = (value: number) => {
      if (settled) return;
      settled = true;
      try {
        db.close();
      } catch {
        // already closed
      }
      resolve(value);
    };

    try {
      const tx = db.transaction(STORE_NAME, "readonly");
      const request = tx.objectStore(STORE_NAME).get(COUNT_KEY);

      request.onsuccess = () => {
        const value = typeof request.result === "number" ? request.result : readFallback();
        finish(value);
      };
      request.onerror = () => finish(readFallback());
      tx.onerror = () => finish(readFallback());
    } catch {
      finish(readFallback());
    }
  });
}

export async function incrementGenerationsUsed(): Promise<number> {
  const db = await openDatabase();
  if (!db) {
    const next = readFallback() + 1;
    writeFallback(next);
    return next;
  }

  return new Promise<number>((resolve) => {
    let settled = false;

    const finish = (value: number) => {
      if (settled) return;
      settled = true;
      try {
        db.close();
      } catch {
        // already closed
      }
      writeFallback(value);
      resolve(value);
    };

    try {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const read = store.get(COUNT_KEY);

      let next = 0;

      read.onsuccess = () => {
        const current = typeof read.result === "number" ? read.result : readFallback();
        next = current + 1;
        store.put(next, COUNT_KEY);
      };

      read.onerror = () => {
        next = readFallback() + 1;
      };

      tx.oncomplete = () => finish(next);
      tx.onerror = () => finish(next || readFallback() + 1);
      tx.onabort = () => finish(next || readFallback() + 1);
    } catch {
      finish(readFallback() + 1);
    }
  });
}
