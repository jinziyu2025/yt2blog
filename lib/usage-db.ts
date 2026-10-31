/*
 * Free-tier counter, persisted in two places that survive different kinds of
 * cleanup: IndexedDB (survives clearing the HTTP cache) and a 24-hour cookie
 * (survives closing the tab, and is shared by normal + incognito sessions on
 * the same browser profile while it lives). We always gate on the higher of
 * the two. Client-only: imported exclusively from the homepage component.
 */

const DB_NAME = "yt2blog";
const DB_VERSION = 1;
const STORE_NAME = "usage";
const COUNT_KEY = "generations-used";

// Second line of defence when IndexedDB is blocked.
const FALLBACK_KEY = "yt2blog:generations-used";

// Cookie layer: visible to document.cookie, expires after 24 hours.
const COOKIE_NAME = "yt2blog_usage";
const COOKIE_MAX_AGE_SECONDS = 24 * 60 * 60;

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
    // Private mode with storage disabled: the cookie layer still gates this session.
  }
}

function readCookie(): number {
  try {
    const entry = document.cookie
      .split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${COOKIE_NAME}=`));

    if (!entry) return 0;

    const value = Number.parseInt(entry.slice(COOKIE_NAME.length + 1), 10);
    return Number.isFinite(value) && value > 0 ? value : 0;
  } catch {
    return 0;
  }
}

function writeCookie(value: number) {
  try {
    document.cookie = `${COOKIE_NAME}=${value}; Max-Age=${COOKIE_MAX_AGE_SECONDS}; Path=/; SameSite=Lax`;
  } catch {
    // Cookies blocked: IndexedDB still holds the count.
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

async function readStored(): Promise<number> {
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

async function writeStored(value: number): Promise<void> {
  writeFallback(value);

  const db = await openDatabase();
  if (!db) return;

  await new Promise<void>((resolve) => {
    let settled = false;

    const finish = () => {
      if (settled) return;
      settled = true;
      try {
        db.close();
      } catch {
        // already closed
      }
      resolve();
    };

    try {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).put(value, COUNT_KEY);
      tx.oncomplete = finish;
      tx.onerror = finish;
      tx.onabort = finish;
    } catch {
      finish();
    }
  });
}

/** Serialises read-modify-write cycles so a double click cannot double-count. */
let queue: Promise<unknown> = Promise.resolve();

function serialize<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task);
  queue = run.catch(() => undefined);
  return run;
}

export async function readGenerationsUsed(): Promise<number> {
  const stored = await readStored();
  const cookie = readCookie();
  const value = Math.max(stored, cookie, readFallback());

  // Keep both layers in sync with the highest value we have seen.
  if (cookie !== value) writeCookie(value);
  if (stored !== value) void writeStored(value);

  return value;
}

export function incrementGenerationsUsed(): Promise<number> {
  return serialize(async () => {
    const current = await readGenerationsUsed();
    const next = current + 1;

    await writeStored(next);
    writeCookie(next);

    return next;
  });
}
