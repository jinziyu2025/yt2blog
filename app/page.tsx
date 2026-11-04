"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { FormEvent } from "react";
import { useEffect, useRef, useState } from "react";
import { getAffiliateRef } from "@/lib/affiliate";
import { FeedbackWidget } from "@/components/feedback-widget";
import { startPaddleCheckout } from "@/lib/paddle";
import { saveArticle } from "@/lib/article";
import { publishArticle } from "@/lib/articles-db";
import { getSupabaseBrowserClient } from "@/lib/supabase";
import { streamBlogPost } from "@/lib/generate-client";
import { incrementGenerationsUsed, readGenerationsUsed } from "@/lib/usage-db";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type Status = "idle" | "loading" | "streaming" | "error";

/* ------------------------------------------------------------------ */
/*  URL validation (client-side, for instant inline feedback)          */
/* ------------------------------------------------------------------ */

function parseYouTubeUrl(raw: string): {
  videoId: string | null;
  error: string | null;
} {
  const value = raw.trim();

  if (!value) {
    return { videoId: null, error: "Paste a YouTube link to get started." };
  }

  // Allow people to paste "youtube.com/watch?v=..." without the scheme.
  const candidate = /^https?:\/\//i.test(value) ? value : `https://${value}`;

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return {
      videoId: null,
      error: "That does not look like a valid URL. Try youtube.com/watch?v=...",
    };
  }

  const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
  const segments = parsed.pathname.split("/").filter(Boolean);
  const idPattern = /^[A-Za-z0-9_-]{11}$/;

  const isYouTubeHost =
    host === "youtu.be" ||
    host === "youtube.com" ||
    host === "m.youtube.com" ||
    host === "youtube-nocookie.com";

  if (!isYouTubeHost) {
    return {
      videoId: null,
      error: "Only YouTube links are supported. Paste a youtube.com or youtu.be URL.",
    };
  }

  if (host === "youtu.be") {
    const id = segments[0] ?? parsed.searchParams.get("v") ?? "";
    return idPattern.test(id)
      ? { videoId: id, error: null }
      : { videoId: null, error: "That youtu.be link is missing a valid video ID." };
  }

  const firstSegment = segments[0] ?? "";

  if (firstSegment === "watch") {
    const id = parsed.searchParams.get("v") ?? "";
    return idPattern.test(id)
      ? { videoId: id, error: null }
      : {
          videoId: null,
          error: "That watch link is missing a ?v= video ID.",
        };
  }

  if (["shorts", "embed", "live", "v"].includes(firstSegment)) {
    const id = segments[1] ?? "";
    return idPattern.test(id)
      ? { videoId: id, error: null }
      : {
          videoId: null,
          error: `That ${firstSegment} link is missing a valid video ID.`,
        };
  }

  return {
    videoId: null,
    error: "Unsupported YouTube URL. Use watch?v=, youtu.be, or /shorts/ links.",
  };
}

/*  Inline icons (kept in-file so the page stays a single component)   */
/* ------------------------------------------------------------------ */

function PlayMark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-3.5 w-3.5">
      <path d="M8 5.5v13l10-6.5-10-6.5z" fill="currentColor" />
    </svg>
  );
}

function ArrowIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}

function Spinner() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className="h-4 w-4 animate-spin"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
    >
      <path d="M12 3a9 9 0 1 0 9 9" />
    </svg>
  );
}

function RefreshIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className="h-3.5 w-3.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21 2v6h-6" />
      <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
      <path d="M3 22v-6h6" />
      <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
    </svg>
  );
}

function AlertIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className="mt-0.5 h-4 w-4 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v4" />
      <path d="M12 16h.01" />
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

const GHOST_BUTTON =
  "inline-flex items-center gap-1.5 rounded-lg border border-line bg-white/[0.02] px-3 py-1.5 text-xs text-muted transition hover:bg-white/[0.06] hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40";

// Waiting copy is derived from monotonic progress, never from a looping step
// index, so the bar can only move forward and the label always matches the
// percentage.
const FALLBACK_ESTIMATE_SECONDS = 45;

// Asymptotic easing: progress creeps toward 99% instead of racing to it. At
// the estimated time it is only ~90%, and it needs roughly 2.5x the estimate
// to touch 99% — so a normal run never parks at 99 waiting for the server.
const PROGRESS_EASING = 2.4;

function stageLabel(progress: number, finalizing: boolean): string {
  if (finalizing) return "Almost there, finalizing SEO details...";
  if (progress >= 99) return "Almost there, finalizing...";
  if (progress >= 80) return "Polishing and removing AI tone...";
  if (progress >= 50) return "Generating SEO-optimized article...";
  if (progress >= 20) return "Analyzing video content...";
  return "Fetching video transcript...";
}

function extractVideoId(input: string): string | null {
  const match = input.match(
    /(?:v=|youtu\.be\/|shorts\/|embed\/|live\/)([A-Za-z0-9_-]{11})/
  );
  return match ? match[1] : null;
}

/**
 * Best-effort duration lookup from the browser (no backend involved). If the
 * request fails or the id is unknown we fall back to a fixed estimate, so the
 * progress never depends on this succeeding.
 */
async function probeVideoDurationSeconds(videoId: string): Promise<number | null> {
  try {
    const response = await fetch(
      `https://yt.lemnoslife.com/noKey/videos?part=contentDetails&id=${videoId}`,
      { signal: AbortSignal.timeout(2500) }
    );

    if (!response.ok) return null;

    const payload = (await response.json()) as {
      items?: Array<{ contentDetails?: { duration?: string } }>;
    };

    const iso = payload.items?.[0]?.contentDetails?.duration;
    const match = iso?.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
    if (!match) return null;

    const hours = Number(match[1] ?? 0);
    const minutes = Number(match[2] ?? 0);
    const seconds = Number(match[3] ?? 0);
    const total = hours * 3600 + minutes * 60 + seconds;

    return total > 0 ? total : null;
  } catch {
    return null;
  }
}

// 1 hour -> 60s, 15 min -> 15s, clamped so short clips still get some room.
function estimateSecondsFor(durationSeconds: number | null): number {
  if (!durationSeconds) return FALLBACK_ESTIMATE_SECONDS;
  return Math.max(15, Math.min(90, Math.round(durationSeconds / 60)));
}

// Free plan: two generations per browser, counter kept in IndexedDB so that
// clearing the HTTP cache does not reset it.
const FREE_LIMIT = 2;

const PLAN_FEATURES = [
  "Unlimited AI Blog Posts",
  "Real YouTube Transcript Fetching",
  "No Watermark",
];

function CheckIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className="h-4 w-4 shrink-0 text-accent"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M5 13l4 4L19 7" />
    </svg>
  );
}

function PaywallModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [redirecting, setRedirecting] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setRedirecting(false);
    setAgreed(false);
    setPayError(null);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  async function handlePay() {
    setRedirecting(true);
    setPayError(null);

    try {
      // Opens the real Paddle overlay when the env vars are configured; the
      // affiliate ref travels inside Paddle's customData.
      const status = await startPaddleCheckout(getAffiliateRef());

      if (status === "opened") {
        onClose();
        return;
      }

      if (status === "invalid-price-id") {
        setRedirecting(false);
        setPayError("Checkout is temporarily unavailable. Please try again later.");
      }
      // status === "placeholder": keep the review placeholder visible.
    } catch {
      setRedirecting(false);
      setPayError("Could not open checkout. Check your connection and try again.");
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-black/70 backdrop-blur-sm"
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="paywall-title"
        className="relative w-full max-w-md animate-fade-up overflow-hidden rounded-2xl border border-line bg-surface p-6 text-center shadow-2xl sm:p-8"
      >
        <div
          aria-hidden="true"
          className="pointer-events-none absolute left-1/2 top-[-90px] h-40 w-64 -translate-x-1/2 rounded-full bg-accent/10 blur-[70px]"
        />

        <span className="relative inline-flex items-center gap-1.5 rounded-full border border-line bg-white/[0.03] px-2.5 py-1 text-[10px] uppercase tracking-[0.14em] text-muted">
          <span className="h-1.5 w-1.5 rounded-full bg-accent" />
          Free limit reached · {FREE_LIMIT}/{FREE_LIMIT} used
        </span>

        <h2
          id="paywall-title"
          className="relative mt-4 text-[22px] font-semibold leading-tight tracking-[-0.02em] text-ink sm:text-[26px]"
        >
          Unlock Unlimited Power
          <span className="text-accent">*</span>
        </h2>

        <p className="relative mt-2 text-[12.5px] leading-5 text-muted">
          Free limit reached. Please upgrade.
        </p>

        <p className="relative mt-3 text-[12.5px] font-semibold leading-6 text-red-400">
          🔥 Only 10 Early Bird spots left at $9.9/month!
        </p>

        <ul className="relative mt-5 space-y-2.5 text-left">
          {PLAN_FEATURES.map((feature) => (
            <li
              key={feature}
              className="flex items-center gap-2.5 text-[13px] text-[#C8C8D0]"
            >
              <CheckIcon />
              {feature}
            </li>
          ))}
        </ul>

        {/* Consent gate: the pay button stays disabled until this is checked. */}
        <div className="relative mt-5 flex items-start gap-2.5 rounded-lg border border-line bg-white/[0.02] p-3 text-left">
          <input
            id="paywall-agree"
            type="checkbox"
            checked={agreed}
            onChange={(event) => setAgreed(event.target.checked)}
            className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer accent-[#D7FF3E]"
          />
          <div className="text-[11.5px] leading-5 text-muted">
            <label htmlFor="paywall-agree" className="cursor-pointer">
              I agree to the
            </label>{" "}
            <Link
              href="/terms"
              className="text-ink underline decoration-line underline-offset-2 hover:text-accent"
            >
              Terms of Service
            </Link>{" "}
            and{" "}
            <Link
              href="/privacy"
              className="text-ink underline decoration-line underline-offset-2 hover:text-accent"
            >
              Privacy Policy
            </Link>
          </div>
        </div>

        <div className="relative mt-4">
          {redirecting ? (
            <div
              role="status"
              className="flex items-center justify-center gap-2 rounded-xl border border-accent/30 bg-accent/[0.06] px-4 py-3 text-[13px] text-accent"
            >
              <Spinner />
              Redirecting to Paddle Checkout...
            </div>
          ) : (
            <button
              type="button"
              disabled={!agreed}
              onClick={() => void handlePay()}
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-accent px-5 py-3 text-[13.5px] font-semibold text-[#0B0B0C] transition hover:bg-[#E7FF70] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:ring-offset-2 focus-visible:ring-offset-surface disabled:cursor-not-allowed disabled:bg-[#2A2A31] disabled:text-muted/60 disabled:hover:bg-[#2A2A31]"
            >
              Pay with Credit Card
            </button>
          )}
        </div>

        {payError ? (
          <p
            role="alert"
            className="relative mt-2 text-center text-[11px] leading-5 text-red-400"
          >
            {payError}
          </p>
        ) : null}

        <p className="relative mt-3 text-[10.5px] text-muted/70">
          $9.9/month · cancel anytime · 7-day money-back guarantee
        </p>

        <p className="relative mt-2 text-[10.5px] text-muted/50">
          <Link href="/refund" className="underline decoration-line underline-offset-2 hover:text-muted">
            Refund Policy
          </Link>
          <span className="text-muted/40"> · </span>
          <Link href="/cookies" className="underline decoration-line underline-offset-2 hover:text-muted">
            Cookie Policy
          </Link>
        </p>

        <button
          type="button"
          onClick={onClose}
          className="relative mt-4 text-[11px] text-muted/60 transition hover:text-ink"
        >
          Maybe later
        </button>
      </div>
    </div>
  );
}

export default function HomePage() {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [activeUrl, setActiveUrl] = useState("");

  // The generator page never renders the draft: it only waits, then hands the
  // user over to /blog/<slug> where the stream is displayed.
  const [progress, setProgress] = useState(0);
  const [finalizing, setFinalizing] = useState(false);
  const [usage, setUsage] = useState(0);
  const [isAdmin, setIsAdmin] = useState(false);
  const [paywallOpen, setPaywallOpen] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const estimateRef = useRef(FALLBACK_ESTIMATE_SECONDS);

  const isGenerating = status === "loading" || status === "streaming";

  /* ------------ actions ------------ */

  async function runGenerate(sourceUrl: string, refresh = false) {
    abortRef.current?.abort();

    const controller = new AbortController();
    abortRef.current = controller;

    setProgress(0);
    setFinalizing(false);
    estimateRef.current = FALLBACK_ESTIMATE_SECONDS;

    const videoId = extractVideoId(sourceUrl);
    if (videoId) {
      void probeVideoDurationSeconds(videoId).then((duration) => {
        estimateRef.current = estimateSecondsFor(duration);
        console.log("[progress] estimate", {
          videoId,
          durationSeconds: duration,
          estimateSeconds: estimateRef.current,
        });
      });
    }

    setStatus("loading");
    setErrorMessage("");

    try {
      const result = await streamBlogPost(sourceUrl, {
        refresh,
        signal: controller.signal,
        onMeta: () => {
          setStatus("streaming");
        },
        onDelta: () => {
          setStatus("streaming");
        },
      });

      // Persist the draft so it gets a real, shareable /blog/<slug> URL.
      // localStorage stays as a fallback when Supabase is not configured.
      try {
        saveArticle(result);
      } catch (storageError) {
        console.error("[publish] localStorage draft skipped", storageError);
      }

      let publishedSlug: string | null = null;
      const supabase = getSupabaseBrowserClient();

      if (supabase) {
        publishedSlug = await publishArticle(supabase, result);
      } else {
        console.warn(
          "[publish] Supabase is not configured (NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY); falling back to the localStorage article page."
        );
      }

      const destination = publishedSlug
        ? `/blog/${publishedSlug}`
        : `/article/${result.videoId}`;

      console.log("[publish] navigate", {
        slug: publishedSlug ?? result.slug,
        videoId: result.videoId,
        destination,
      });

      setProgress(100);
      setStatus("idle");
      router.push(destination);

      // Safety net: if the soft navigation does not land (route missing from
      // the client build, stale router state, blocked push), reload straight
      // into the destination instead of leaving the user on the generator.
      window.setTimeout(() => {
        const current = window.location.pathname;

        if (current !== destination) {
          console.warn("[publish] soft navigation missed, forcing location change", {
            destination,
            current,
          });
          window.location.assign(destination);
        }
      }, 500);
    } catch (caught) {
      if (controller.signal.aborted) {
        // User pressed Cancel: go back to idle.
        setStatus("idle");
        return;
      }

      setStatus("error");
      setErrorMessage(
        caught instanceof Error
          ? caught.message
          : "Generation failed for an unknown reason. Please try again."
      );
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
      }
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const parsed = parseYouTubeUrl(url);

    if (!parsed.videoId) {
      setFieldError(parsed.error ?? "Invalid YouTube URL.");
      return;
    }

    if (isAdmin) {
      setFieldError(null);
      setActiveUrl(url.trim());
      void runGenerate(url.trim());
      return;
    }

    const used = await readGenerationsUsed();

    // Free tier exhausted: block the request and show the paywall instead.
    if (used >= FREE_LIMIT) {
      setFieldError(null);
      setUsage(used);
      setPaywallOpen(true);
      return;
    }

    const next = await incrementGenerationsUsed();
    setUsage(next);

    setFieldError(null);
    setActiveUrl(url.trim());
    void runGenerate(url.trim());
  }

  function handleCancel() {
    abortRef.current?.abort();
  }

  function handleRetry() {
    if (!activeUrl) return;
    void runGenerate(activeUrl);
  }

  // Monotonic progress: driven by elapsed time against the duration estimate.
  // It only ever moves forward, stalls at 99% if the server is slow, and never
  // restarts mid-run.
  useEffect(() => {
    if (!isGenerating) return;

    const startedAt = performance.now();
    const timer = window.setInterval(() => {
      const elapsed = (performance.now() - startedAt) / 1000;
      const ratio = elapsed / estimateRef.current;
      const eased = 99 * (1 - Math.exp(-PROGRESS_EASING * ratio));
      const pct = Math.min(99, Math.floor(eased));
      setProgress((previous) => (pct > previous ? pct : previous));
    }, 500);

    return () => window.clearInterval(timer);
  }, [isGenerating]);

  // Parked at 99% for more than 3s: soften the wait with a reassuring line.
  useEffect(() => {
    if (!isGenerating || progress < 99) {
      setFinalizing(false);
      return;
    }

    const timer = window.setTimeout(() => setFinalizing(true), 3000);
    return () => window.clearTimeout(timer);
  }, [isGenerating, progress]);

  // Restore the free-tier counter from IndexedDB on first paint, and ask the
  // server whether this browser already holds a valid admin cookie. A URL that
  // carries ?admin=<passcode> redeems the passcode server-side; the passcode
  // itself is never stored in the browser.
  useEffect(() => {
    void readGenerationsUsed().then(setUsage);

    let active = true;

    const checkAdmin = async () => {
      try {
        const passcode = new URLSearchParams(window.location.search).get("admin");

        if (passcode) {
          const unlock = await fetch("/api/admin/unlock", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ passcode }),
          });

          const result = (await unlock.json()) as { admin?: boolean };
          if (active) setIsAdmin(Boolean(result.admin));
          return;
        }

        const status = await fetch("/api/admin/unlock", { cache: "no-store" });
        const result = (await status.json()) as { admin?: boolean };
        if (active) setIsAdmin(Boolean(result.admin));
      } catch {
        if (active) setIsAdmin(false);
      }
    };

    void checkAdmin();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  /* ------------ render ------------ */

  return (
    <main className="relative min-h-screen overflow-hidden">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute left-1/2 top-[-260px] h-[520px] w-[880px] -translate-x-1/2 rounded-full bg-accent/5 blur-[130px]"
      />

      <div className="relative mx-auto w-full max-w-3xl px-5 pb-20 pt-8 sm:px-8">
        {/* Header */}
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <span className="grid h-8 w-8 place-items-center rounded-lg border border-line bg-surface text-accent">
              <PlayMark />
            </span>
            <span className="text-sm font-semibold tracking-tight text-ink">
              YT2Blog
            </span>
          </div>

          <div className="hidden items-center gap-2 text-[11px] text-muted sm:flex">
            <span className="h-1.5 w-1.5 rounded-full bg-accent" />
            Live API · DeepSeek
          </div>
        </header>

        {/* Hero */}
        <section className="mt-12 sm:mt-16">
          <p className="inline-flex items-center gap-2 rounded-full border border-line bg-surface/70 px-3 py-1 text-[10.5px] uppercase tracking-[0.16em] text-muted">
            YouTube to blog · in seconds
          </p>

          <h1 className="mt-6 text-balance text-3xl font-semibold leading-[1.12] tracking-[-0.03em] text-ink sm:text-[44px]">
            Turn Any YouTube Video into a{" "}
            <span className="text-accent">Human-Like</span> Blog Post
          </h1>

          <p className="mt-5 max-w-xl text-[14.5px] leading-7 text-muted">
            Paste a link and get a structured draft — title, slug, meta
            description, and readable sections, generated server-side by DeepSeek.
          </p>
        </section>

        {/* Input */}
        <form onSubmit={handleSubmit} className="mt-9">
          <div
            className={`rounded-2xl border bg-surface/70 p-2 backdrop-blur-sm transition focus-within:ring-1 focus-within:ring-accent/25 ${
              fieldError
                ? "border-red-400/40"
                : "border-line focus-within:border-accent/40"
            }`}
          >
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <div className="flex-1">
                <label htmlFor="youtube-url" className="sr-only">
                  YouTube video URL
                </label>
                <input
                  id="youtube-url"
                  name="youtube-url"
                  type="text"
                  inputMode="url"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="Paste a YouTube link — youtube.com/watch?v=..."
                  value={url}
                  onChange={(event) => {
                    setUrl(event.target.value);
                    if (fieldError) setFieldError(null);
                  }}
                  aria-invalid={Boolean(fieldError)}
                  aria-describedby={fieldError ? "url-error" : "url-hint"}
                  className="h-14 w-full rounded-xl bg-transparent px-4 text-[14.5px] text-ink placeholder:text-muted/60 focus:outline-none"
                />
              </div>

              <button
                type="submit"
                disabled={isGenerating}
                className="group inline-flex h-14 w-full items-center justify-center gap-2 rounded-xl bg-accent px-6 text-[14.5px] font-semibold text-[#0B0B0C] transition hover:bg-[#E7FF70] active:bg-[#CFF036] disabled:cursor-not-allowed disabled:bg-[#2A2A31] disabled:text-muted/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas sm:w-auto sm:min-w-[150px]"
              >
                {isGenerating ? (
                  <>
                    <Spinner />
                    Generating…
                  </>
                ) : (
                  <>
                    Generate
                    <ArrowIcon />
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Inline validation / helpers */}
          {fieldError ? (
            <p
              id="url-error"
              role="alert"
              className="mt-3 flex items-start gap-2 text-[12.5px] text-red-300"
            >
              <AlertIcon />
              <span>{fieldError}</span>
            </p>
          ) : (
            <div
              id="url-hint"
              className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-muted/75"
            >
              <span>Works with</span>
              <code className="rounded-md border border-line bg-surface px-1.5 py-0.5 font-mono text-[10.5px] text-muted">
                youtube.com/watch?v=…
              </code>
              <code className="rounded-md border border-line bg-surface px-1.5 py-0.5 font-mono text-[10.5px] text-muted">
                youtu.be/…
              </code>
              <code className="rounded-md border border-line bg-surface px-1.5 py-0.5 font-mono text-[10.5px] text-muted">
                youtube.com/shorts/…
              </code>
              <span className="text-muted/40">·</span>
              <span>
                {Math.max(FREE_LIMIT - usage, 0)} of {FREE_LIMIT} free
                generations left
              </span>
            </div>
          )}
        </form>

        {/* Idle steps */}
        {status === "idle" && (
          <div className="mt-16 grid gap-3 sm:grid-cols-3">
            {[
              {
                step: "01",
                title: "Paste a link",
                detail: "Any watch, youtu.be, or shorts URL.",
              },
              {
                step: "02",
                title: "Generate",
                detail: "DeepSeek drafts the article server-side.",
              },
              {
                step: "03",
                title: "Copy & publish",
                detail: "Edit it, paste into your CMS, ship.",
              },
            ].map((item) => (
              <div
                key={item.step}
                className="rounded-xl border border-line bg-surface/40 p-4"
              >
                <p className="font-mono text-[10.5px] tracking-[0.12em] text-muted/50">
                  {item.step}
                </p>
                <p className="mt-2 text-[13px] font-medium text-ink">
                  {item.title}
                </p>
                <p className="mt-1 text-[12px] leading-5 text-muted/75">
                  {item.detail}
                </p>
              </div>
            ))}
          </div>
        )}

        {/* Loading / streaming: the generator page never renders the draft */}
        {(status === "loading" || status === "streaming") && (
          <section
            aria-busy="true"
            aria-live="polite"
            className="mt-12 animate-fade-up rounded-2xl border border-line bg-surface p-6 sm:p-8"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="inline-flex items-center gap-2 text-[11px] uppercase tracking-[0.14em] text-muted">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
                {progress}% complete
              </p>

              <div className="flex items-center gap-2">
                <p className="font-mono text-[10.5px] text-muted/60">
                  long videos take longer
                </p>
                <button type="button" onClick={handleCancel} className={GHOST_BUTTON}>
                  Cancel
                </button>
              </div>
            </div>

            <div className="mt-6 flex min-h-[190px] flex-col items-center justify-center gap-4 text-center">
              <span className="grid h-10 w-10 place-items-center rounded-full border border-accent/30 bg-accent/5 text-accent">
                <Spinner />
              </span>

              <p
                key={stageLabel(progress, finalizing)}
                className="animate-fade-up text-[16px] font-semibold tracking-tight text-ink"
              >
                {stageLabel(progress, finalizing)}
              </p>

              <div className="mt-1 h-1.5 w-60 overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full rounded-full bg-accent transition-[width] duration-500 ease-linear"
                  style={{ width: `${progress}%` }}
                />
              </div>

              <div className="mt-2 w-full max-w-sm space-y-2" aria-hidden="true">
                <div className="h-2.5 w-full animate-pulse rounded bg-white/[0.06]" />
                <div className="h-2.5 w-11/12 animate-pulse rounded bg-white/[0.05]" />
                <div className="h-2.5 w-9/12 animate-pulse rounded bg-white/[0.04]" />
              </div>

              <p className="font-mono text-[10.5px] text-muted/60">
                we&apos;ll open your article page automatically when it&apos;s done
              </p>
            </div>
          </section>
        )}

        {/* Error */}
        {status === "error" && (
          <section
            role="alert"
            className="mt-12 animate-fade-up rounded-2xl border border-red-400/25 bg-red-500/5 p-6"
          >
            <p className="flex items-center gap-2 text-[13.5px] font-medium text-red-200">
              <AlertIcon />
              Generation failed
            </p>
            <p className="mt-2 whitespace-pre-wrap break-words text-[13px] leading-6 text-muted">
              {errorMessage}
            </p>
            <div className="mt-4">
              <button type="button" onClick={handleRetry} className={GHOST_BUTTON}>
                <RefreshIcon />
                Try again
              </button>
            </div>
          </section>
        )}

        {/* Pricing */}
        <section id="pricing" className="mt-20">
          <div className="flex flex-col items-center text-center">
            <p className="inline-flex items-center gap-2 rounded-full border border-line bg-surface/70 px-3 py-1 text-[10.5px] uppercase tracking-[0.16em] text-muted">
              Pricing
            </p>
            <h2 className="mt-5 text-[26px] font-semibold leading-tight tracking-[-0.02em] text-ink sm:text-[32px]">
              Simple Pricing
            </h2>
            <p className="mt-3 max-w-md text-[13px] leading-6 text-muted">
              One plan. Everything unlocked. No credits, no tiers, no surprises.
            </p>
          </div>

          <div className="relative mx-auto mt-8 max-w-md overflow-hidden rounded-2xl border border-accent/25 bg-surface p-6 sm:p-8">
            <div
              aria-hidden="true"
              className="pointer-events-none absolute left-1/2 top-[-110px] h-44 w-72 -translate-x-1/2 rounded-full bg-accent/10 blur-[80px]"
            />

            <div className="relative flex items-center justify-between">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-red-400/30 bg-red-500/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-red-400">
                <span className="h-1.5 w-1.5 rounded-full bg-red-400" />
                Early bird · 10 spots left
              </span>
              <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted/60">
                monthly
              </span>
            </div>

            <div className="relative mt-6 flex items-baseline gap-1">
              <span className="text-[40px] font-semibold tracking-[-0.03em] text-ink">
                $9.9
              </span>
              <span className="text-[13px] text-muted">/month</span>
              <span className="ml-2 text-[12px] text-muted/50 line-through">
                $19.9
              </span>
            </div>

            <ul className="relative mt-6 space-y-3">
              {PLAN_FEATURES.map((feature) => (
                <li
                  key={feature}
                  className="flex items-center gap-2.5 text-[13.5px] text-[#C8C8D0]"
                >
                  <CheckIcon />
                  {feature}
                </li>
              ))}
            </ul>

            <button
              type="button"
              onClick={() => setPaywallOpen(true)}
              className="relative mt-7 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-accent px-5 py-3 text-[13.5px] font-semibold text-[#0B0B0C] transition hover:bg-[#E7FF70] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
            >
              Get unlimited access
            </button>

            <p className="relative mt-3 text-center text-[10.5px] leading-5 text-muted/60">
              7-day money-back guarantee ·{" "}
              <Link
                href="/refund"
                className="underline decoration-line underline-offset-2 hover:text-muted"
              >
                Refund Policy
              </Link>
            </p>
          </div>
        </section>

        <FeedbackWidget />

        {/* Paywall */}
        <PaywallModal open={paywallOpen} onClose={() => setPaywallOpen(false)} />
      </div>
    </main>
  );
}
