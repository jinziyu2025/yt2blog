/**
 * Affiliate reference tracking.
 *
 * A partner link looks like `https://yt2blog.app/?ref=friend_a`. The value is
 * persisted in localStorage for 30 days and overwritten on every new ref
 * ("last click wins"), so a partner keeps credit even if the visitor comes
 * back weeks later without the query string.
 */

const STORAGE_KEY = "yt2blog:affiliate-ref";
const REF_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const REF_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/;

type StoredRef = {
  ref: string;
  savedAt: number;
};

function readStored(): StoredRef | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as Partial<StoredRef>;
    if (
      typeof parsed.ref !== "string" ||
      typeof parsed.savedAt !== "number" ||
      !REF_PATTERN.test(parsed.ref)
    ) {
      return null;
    }

    return { ref: parsed.ref, savedAt: parsed.savedAt };
  } catch {
    return null;
  }
}

/** Persist a ref discovered in the URL. Returns the ref now in storage. */
export function captureAffiliateRef(search: string): string | null {
  try {
    const raw = new URLSearchParams(search).get("ref");
    if (raw === null) return getAffiliateRef();

    const ref = raw.trim();
    if (!REF_PATTERN.test(ref)) return getAffiliateRef();

    // Last click wins: always overwrite, which also restarts the 30-day clock.
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ ref, savedAt: Date.now() } satisfies StoredRef)
    );
    return ref;
  } catch {
    return null;
  }
}

/** Current valid affiliate ref, or null if absent / expired. */
export function getAffiliateRef(): string | null {
  const stored = readStored();
  if (!stored) return null;

  if (Date.now() - stored.savedAt > REF_TTL_MS) {
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Ignore storage errors; the stale value is simply not returned.
    }
    return null;
  }

  return stored.ref;
}
