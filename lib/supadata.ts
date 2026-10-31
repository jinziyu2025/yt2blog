/*
 * YouTube captions come from Supadata (https://supadata.ai), a managed
 * transcript API. Open-source mirrors (Invidious / Piped) are unreliable:
 * Cloudflare returns 403/525 and datacenter IPs get consent/bot walls, so the
 * app no longer scrapes YouTube itself.
 *
 * Flow: videoId -> GET /v1/transcript (plain text, English preferred) ->
 * Supadata answers synchronously, or hands back a jobId that is polled until
 * completed. The full transcript is returned untruncated: long videos are
 * chunked and map-reduced in /api/generate.
 *
 * Requires SUPADATA_API_KEY (see .env.example).
 */

const LOG_PREFIX = "[supadata]";

const ENDPOINT = "https://api.supadata.ai/v1/transcript";
const REQUEST_TIMEOUT_MS = 25_000;
const JOB_POLL_INTERVAL_MS = 2_000;
const JOB_MAX_WAIT_MS = 20_000;

export type TranscriptResult =
  | {
      ok: true;
      text: string;
      lang: string;
      segments: number;
      originalChars: number;
    }
  | { ok: false; status: number; message: string };

type TranscriptPayload = {
  content?: unknown;
  transcript?: unknown;
  lang?: unknown;
  availableLangs?: unknown;
  jobId?: unknown;
  status?: unknown;
  error?: unknown;
};

type ErrorShape = {
  error?: unknown;
  message?: unknown;
  details?: unknown;
};

const ERROR_MESSAGES: Record<string, { status: number; message: string }> = {
  unauthorized: {
    status: 500,
    message: "Supadata rejected the API key (401). Check SUPADATA_API_KEY on the server.",
  },
  forbidden: {
    status: 502,
    message: "Supadata refused the request (403). Check the key's plan and permissions.",
  },
  "upgrade-required": {
    status: 502,
    message: "This Supadata plan does not cover YouTube transcripts (402). Upgrade the plan or use another key.",
  },
  "limit-exceeded": {
    status: 429,
    message: "Supadata rate limit reached. Wait a minute, then try again.",
  },
  "transcript-unavailable": {
    status: 422,
    message:
      "This video has no transcript available. Try a video with English captions enabled.",
  },
  "invalid-request": {
    status: 400,
    message: "Supadata rejected the request as invalid. Check that the YouTube link is correct.",
  },
  "not-found": {
    status: 404,
    message:
      "This YouTube video is unavailable (private, removed, or region-locked). Try a different link.",
  },
  "internal-error": {
    status: 502,
    message: "Supadata had an internal error while building the transcript. Try again.",
  },
};

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function describeFailure(input: unknown, fallback: string): {
  status: number;
  message: string;
} {
  // Error payloads are flat ({error: "code", message, details}), while a failed
  // job nests them under `error`. Unwrap one level so both shapes work.
  let shape = (input ?? {}) as ErrorShape;
  if (typeof shape.error === "object" && shape.error !== null) {
    shape = shape.error as ErrorShape;
  }

  const code = asString(shape.error);
  const known = code ? ERROR_MESSAGES[code] : undefined;

  if (known) return known;

  const details = asString(shape.details) || asString(shape.message) || fallback;
  return {
    status: 502,
    message: `Supadata request failed: ${details.slice(0, 200)}`,
  };
}

async function requestJson(
  url: string,
  apiKey: string
): Promise<{ status: number; payload: TranscriptPayload }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      cache: "no-store",
      headers: {
        "x-api-key": apiKey,
        Accept: "application/json",
      },
    });

    const body = await response.text();

    let payload: TranscriptPayload = {};
    try {
      payload = body ? (JSON.parse(body) as TranscriptPayload) : {};
    } catch {
      throw new Error(`Supadata returned non-JSON (HTTP ${response.status}): ${body.slice(0, 120)}`);
    }

    return { status: response.status, payload };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Supadata returns the text under `content` (current API). Some docs and SDKs
 * also show `transcript`, so accept both, and accept either a plain string
 * (text=true) or an array of timed chunks.
 */
function extractText(content: unknown): { text: string; segments: number } {
  if (typeof content === "string") {
    return { text: content.trim(), segments: content ? 1 : 0 };
  }

  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const item of content) {
      if (typeof item === "string") {
        if (item.trim()) parts.push(item.trim());
        continue;
      }
      const chunk = (item ?? {}) as Record<string, unknown>;
      const text = asString(chunk.text);
      if (text) parts.push(text);
    }
    return { text: parts.join(" ").replace(/\s+/g, " ").trim(), segments: parts.length };
  }

  return { text: "", segments: 0 };
}

function buildUrl(videoId: string, mode: "native" | "auto"): string {
  const params = new URLSearchParams({
    url: `https://www.youtube.com/watch?v=${videoId}`,
    lang: "en",
    text: "true",
    mode,
  });

  return `${ENDPOINT}?${params.toString()}`;
}

async function pollJob(jobId: string, apiKey: string, startedAt: number): Promise<
  | { kind: "ok"; text: string; segments: number; lang: string }
  | { kind: "failed"; status: number; message: string }
> {
  while (Date.now() - startedAt < JOB_MAX_WAIT_MS) {
    await new Promise((resolve) => setTimeout(resolve, JOB_POLL_INTERVAL_MS));

    const { status, payload } = await requestJson(
      `${ENDPOINT}/${encodeURIComponent(jobId)}`,
      apiKey
    );

    if (status < 200 || status >= 300) {
      return { kind: "failed", ...describeFailure(payload.error ?? payload, `HTTP ${status}`) };
    }

    const state = asString(payload.status);

    if (state === "completed") {
      const { text, segments } = extractText(payload.content ?? payload.transcript);
      if (!text) {
        return {
          kind: "failed",
          status: 422,
          message: "Supadata finished the job but returned an empty transcript.",
        };
      }
      return { kind: "ok", text, segments, lang: asString(payload.lang) || "en" };
    }

    if (state === "failed") {
      return {
        kind: "failed",
        ...describeFailure(payload.error ?? null, "Supadata could not build a transcript for this video."),
      };
    }

    console.log(`${LOG_PREFIX} job-pending jobId=${jobId.slice(0, 8)}… state=${state || "unknown"}`);
  }

  return {
    kind: "failed",
    status: 504,
    message: "Supadata took too long to build the transcript. Try again in a moment.",
  };
}

export async function fetchEnglishTranscript(videoId: string): Promise<TranscriptResult> {
  const apiKey = (process.env.SUPADATA_API_KEY ?? "").trim();

  if (!apiKey) {
    console.log(`${LOG_PREFIX} missing-key`);
    return {
      ok: false,
      status: 500,
      message:
        "Supadata API key is not configured. Set SUPADATA_API_KEY in the server environment, then redeploy.",
    };
  }

  const startedAt = Date.now();

  try {
    const { status, payload } = await requestJson(buildUrl(videoId, "native"), apiKey);

    if (status === 200 || status === 202) {
      const jobId = asString(payload.jobId);

      if (jobId) {
        const job = await pollJob(jobId, apiKey, startedAt);

        if (job.kind === "failed") {
          console.log(`${LOG_PREFIX} job-failed videoId=${videoId} status=${job.status}`);
          return { ok: false, status: job.status, message: job.message };
        }

        const full = job.text;
        console.log(
          `${LOG_PREFIX} ok videoId=${videoId} via=job lang=${job.lang} segments=${job.segments} chars=${
            full.length
          } truncated=false fetchMs=${Date.now() - startedAt}`
        );

        return {
          ok: true,
          text: full,
          lang: job.lang,
          segments: job.segments,
          originalChars: full.length,
        };
      }

      const { text, segments } = extractText(payload.content ?? payload.transcript);

      if (!text) {
        console.log(`${LOG_PREFIX} empty-content videoId=${videoId} status=${status}`);
        return {
          ok: false,
          status: 422,
          message: "Supadata returned an empty transcript for this video.",
        };
      }

      const lang = asString(payload.lang) || "en";
      const available = Array.isArray(payload.availableLangs)
        ? payload.availableLangs.map((item) => asString(item)).filter(Boolean)
        : [];

      console.log(
        `${LOG_PREFIX} ok videoId=${videoId} via=sync lang=${lang} available=${available.join(",") || "n/a"} segments=${segments} chars=${
          text.length
        } truncated=false fetchMs=${Date.now() - startedAt}`
      );

      return {
        ok: true,
        text,
        lang,
        segments,
        originalChars: text.length,
      };
    }

    const failure = describeFailure(payload, `HTTP ${status}`);
    console.log(
      `${LOG_PREFIX} error videoId=${videoId} http=${status} code=${asString(payload.error) || "unknown"} message=${failure.message.slice(0, 120)}`
    );

    return { ok: false, status: failure.status, message: failure.message };
  } catch (caught) {
    const aborted =
      caught instanceof Error && (caught.name === "AbortError" || caught.name === "TimeoutError");
    const raw = caught instanceof Error ? caught.message : String(caught);

    console.log(
      `${LOG_PREFIX} ${aborted ? "timeout" : "network-error"} videoId=${videoId} message=${raw.slice(0, 120)}`
    );

    return aborted
      ? {
          ok: false,
          status: 504,
          message: "Timed out while waiting for Supadata to return the transcript. Try again.",
        }
      : { ok: false, status: 502, message: `Could not reach Supadata: ${raw.slice(0, 160)}` };
  }
}
