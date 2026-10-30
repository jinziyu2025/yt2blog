/*
 * YouTube captions are fetched through open-source YouTube frontend mirrors.
 *
 * YouTube / Cloudflare block direct caption requests from datacenter IPs
 * (consent pages and bot checks), so this module never talks to YouTube
 * itself. It asks an Invidious instance for the caption list of a video, then
 * downloads the caption track it points at (WebVTT) and turns it into plain
 * text. Invidious mirrors are asked first; when they are all down (they are
 * volatile), the Piped API mirrors are used as a second provider.
 *
 * Defaults can be overridden with INVIDIOUS_INSTANCES / PIPED_INSTANCES
 * (comma separated) when a mirror goes down.
 */

const LOG_PREFIX = "[mirror]";

// Fail fast: a dead mirror should cost a few seconds, not the whole request.
// Every request also stops starting new attempts once TOTAL_BUDGET_MS is used,
// so DeepSeek still has time to write the article.
const CAPTION_LIST_TIMEOUT_MS = 3_000;
const CAPTION_TEXT_TIMEOUT_MS = 3_000;
const STREAM_TIMEOUT_MS = 3_000;
const TOTAL_BUDGET_MS = 20_000;

const DEFAULT_INVIDIOUS_INSTANCES = [
  "https://inv.nadeko.net",
  "https://invidious.nerdvpn.de",
  "https://invidious.tiekoetter.com",
];

const DEFAULT_PIPED_INSTANCES = ["https://pipedapi.kavin.rocks"];

// Keep the transcript within a sane token budget before injecting it.
const MAX_TRANSCRIPT_CHARS = 14_000;
const TRANSCRIPT_HEAD_CHARS = 9_000;
const TRANSCRIPT_TAIL_CHARS = 4_000;

export type TranscriptResult =
  | {
      ok: true;
      text: string;
      lang: string;
      segments: number;
      originalChars: number;
      instance: string;
    }
  | { ok: false; status: number; message: string };

type CaptionTrack = {
  label: string;
  languageCode: string;
  url: string;
  auto: boolean;
};

/**
 * Internal per-provider outcome. "ok" carries the transcript; "unavailable",
 * "no-captions" and "no-english" are definitive answers from a live mirror;
 * "failed" means every mirror of that provider was unreachable or broken.
 */
type ProviderOutcome =
  | { kind: "ok"; result: Extract<TranscriptResult, { ok: true }> }
  | { kind: "unavailable"; provider: string }
  | { kind: "no-captions"; provider: string }
  | { kind: "no-english"; provider: string; available: string[] }
  | { kind: "failed"; provider: string; status: number; message: string };

class InstanceError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "InstanceError";
  }
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function envList(name: string, fallback: string[]): string[] {
  const configured = (process.env[name] ?? "")
    .split(",")
    .map((item) => item.trim().replace(/\/+$/, ""))
    .filter(Boolean);

  return configured.length > 0 ? configured : fallback;
}

function hostOf(base: string): string {
  try {
    return new URL(base).host;
  } catch {
    return base;
  }
}

async function fetchText(url: string, timeoutMs: number, accept: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      cache: "no-store",
      headers: {
        Accept: accept,
        "User-Agent": "yt2blog/0.1 (+https://github.com/jinziyu2025/yt2blog)",
      },
    });

    const body = await response.text();

    if (!response.ok) {
      throw new InstanceError(response.status, body.slice(0, 300));
    }

    return body;
  } finally {
    clearTimeout(timer);
  }
}

function decodeEntities(input: string): string {
  return input
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&lrm;/gi, "")
    .replace(/&rlm;/gi, "")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number.parseInt(code, 10)));
}

function normalizeInvidiousTracks(raw: unknown): CaptionTrack[] {
  if (!Array.isArray(raw)) return [];

  const tracks: CaptionTrack[] = [];

  for (const item of raw) {
    const record = (item ?? {}) as Record<string, unknown>;
    const url = asString(record.url);
    const languageCode = asString(record.language_code ?? record.languageCode);
    const label = asString(record.label) || languageCode;

    if (!url) continue;
    tracks.push({
      label,
      languageCode,
      url,
      auto: /auto[- ]?generated|asr|自动/i.test(label),
    });
  }

  return tracks;
}

function normalizePipedTracks(raw: unknown): CaptionTrack[] {
  if (!Array.isArray(raw)) return [];

  const tracks: CaptionTrack[] = [];

  for (const item of raw) {
    const record = (item ?? {}) as Record<string, unknown>;
    const url = asString(record.url);
    const languageCode = asString(record.code);
    const label = asString(record.name) || languageCode;

    if (!url) continue;
    tracks.push({
      label,
      languageCode,
      url,
      auto: record.autoGenerated === true || /auto[- ]?generated|asr|自动/i.test(label),
    });
  }

  return tracks;
}

function trackScore(track: CaptionTrack): number {
  let score = 0;
  if (track.auto) score += 10;
  if (track.languageCode.toLowerCase().replace("_", "-") !== "en") score += 1;
  return score;
}

function pickEnglishTrack(tracks: CaptionTrack[]): CaptionTrack | null {
  const english = tracks.filter((track) => {
    const code = track.languageCode.toLowerCase().replace("_", "-");
    return code.startsWith("en") || /english/i.test(track.label);
  });

  if (english.length === 0) return null;

  return english.slice().sort((a, b) => trackScore(a) - trackScore(b))[0];
}

function resolveTrackUrl(base: string, path: string): string {
  try {
    return new URL(path, base).toString();
  } catch {
    return path;
  }
}

/**
 * WebVTT / SRT -> cue text lines. Timing lines, cue counters, headers and
 * inline tags are dropped; rolling auto-caption duplicates are collapsed.
 */
function parseVttOrSrt(raw: string): string[] {
  const lines = raw.replace(/\r\n?/g, "\n").replace(/^\uFEFF/, "").split("\n");
  const out: string[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    if (/^WEBVTT/i.test(line)) continue;
    if (/^(NOTE|STYLE|REGION)\b/.test(line)) continue;
    if (line.includes("-->")) continue;
    if (/^\d+$/.test(line)) continue;

    const text = line
      .replace(/<[^>]*>/g, "")
      .replace(/&lrm;/gi, "")
      .replace(/&rlm;/gi, "")
      .trim();

    if (!text) continue;
    if (out[out.length - 1] === text) continue;
    out.push(text);
  }

  return out;
}

/**
 * YouTube TTML (what Piped returns) -> cue text lines. Each <p> is one cue;
 * <br/> separates lines inside a cue, <span> wrappers are dropped.
 */
function parseTtml(raw: string): string[] {
  const cues = raw.match(/<p\b[^>]*>([\s\S]*?)<\/p>/gi) ?? [];
  const out: string[] = [];

  for (const cue of cues) {
    const text = cue
      .replace(/<br\s*\/?>/gi, " ")
      .replace(/<[^>]*>/g, "")
      .replace(/\s+/g, " ")
      .trim();

    if (text && out[out.length - 1] !== text) out.push(text);
  }

  return out;
}

function parseCaptionText(raw: string): string[] {
  const head = raw.slice(0, 300);
  if (/<tt\b/i.test(head)) return parseTtml(raw);
  if (/<p\b[^>]*\bt=/i.test(head)) return parseTtml(raw);
  return parseVttOrSrt(raw);
}

function cleanSegments(segments: string[]): string {
  const joined = segments
    .join(" ")
    .replace(/\[(?:music|applause|laughter|inaudible|silence)\]/gi, " ")
    .replace(/\s+([.,!?;:])/g, "$1");

  return decodeEntities(joined).replace(/\s+/g, " ").trim();
}

export function truncateTranscript(text: string): string {
  if (text.length <= MAX_TRANSCRIPT_CHARS) return text;

  const head = text.slice(0, TRANSCRIPT_HEAD_CHARS);
  const tail = text.slice(text.length - TRANSCRIPT_TAIL_CHARS);

  return `${head}\n\n[... middle of the transcript omitted for length ...]\n\n${tail}`;
}

function success(params: {
  provider: string;
  instance: string;
  videoId: string;
  track: CaptionTrack;
  segments: string[];
  startedAt: number;
}): Extract<ProviderOutcome, { kind: "ok" | "failed" }> {
  const text = cleanSegments(params.segments);
  if (!text) {
    return {
      kind: "failed",
      provider: params.provider,
      status: 502,
      message: `${params.provider} (${params.instance}) returned a caption track with no usable text.`,
    };
  }

  const truncated = truncateTranscript(text);

  console.log(
    `${LOG_PREFIX} ok provider=${params.provider} videoId=${params.videoId} instance=${params.instance} lang=${
      params.track.languageCode
    } track="${params.track.label}" auto=${params.track.auto} segments=${params.segments.length} chars=${
      text.length
    } injectedChars=${truncated.length} truncated=${truncated.length !== text.length} fetchMs=${
      Date.now() - params.startedAt
    }`
  );

  return {
    kind: "ok",
    result: {
      ok: true,
      text: truncated,
      lang: params.track.languageCode || "en",
      segments: params.segments.length,
      originalChars: text.length,
      instance: `${params.provider}:${params.instance}`,
    },
  };
}

/* ------------------------------------------------------------------ */
/*  Invidious provider                                                 */
/* ------------------------------------------------------------------ */

async function fetchFromInvidious(
  videoId: string,
  startedAt: number
): Promise<ProviderOutcome> {
  const instances = envList("INVIDIOUS_INSTANCES", DEFAULT_INVIDIOUS_INSTANCES);

  let lastFailure: { status: number; message: string } | null = null;
  let sawEmptyList = false;
  let sawNoEnglish: string[] | null = null;
  let attempts = 0;

  for (const base of instances) {
    if (Date.now() - startedAt > TOTAL_BUDGET_MS) {
      console.log(`${LOG_PREFIX} budget-exhausted provider=invidious videoId=${videoId}`);
      break;
    }

    const instance = hostOf(base);
    attempts += 1;

    try {
      const listUrl = `${base}/api/v1/captions/${videoId}`;
      const listRaw = await fetchText(listUrl, CAPTION_LIST_TIMEOUT_MS, "application/json");

      let parsed: unknown;
      try {
        parsed = JSON.parse(listRaw);
      } catch {
        lastFailure = {
          status: 502,
          message: `Invidious (${instance}) returned invalid JSON for the caption list.`,
        };
        console.log(`${LOG_PREFIX} bad-json provider=invidious instance=${instance} videoId=${videoId}`);
        continue;
      }

      const tracks = normalizeInvidiousTracks(parsed);

      if (tracks.length === 0) {
        sawEmptyList = true;
        console.log(`${LOG_PREFIX} empty-list provider=invidious instance=${instance} videoId=${videoId}`);
        continue;
      }

      const track = pickEnglishTrack(tracks);

      if (!track) {
        sawNoEnglish = tracks.map((item) => item.languageCode || item.label);
        console.log(
          `${LOG_PREFIX} no-english provider=invidious instance=${instance} videoId=${videoId} available=${sawNoEnglish.join(",")}`
        );
        continue;
      }

      const captionUrl = resolveTrackUrl(base, track.url);
      const raw = await fetchText(
        captionUrl,
        CAPTION_TEXT_TIMEOUT_MS,
        "text/vtt, text/plain;q=0.9, */*;q=0.5"
      );
      const segments = parseCaptionText(raw);

      if (segments.length === 0) {
        lastFailure = {
          status: 502,
          message: `Invidious (${instance}) returned an empty caption track.`,
        };
        console.log(`${LOG_PREFIX} empty-track provider=invidious instance=${instance} videoId=${videoId}`);
        continue;
      }

      const outcome = success({
        provider: "invidious",
        instance,
        videoId,
        track,
        segments,
        startedAt,
      });

      if (outcome.kind === "ok") return outcome;
      lastFailure = { status: outcome.status, message: outcome.message };
      continue;
    } catch (caught) {
      if (caught instanceof InstanceError) {
        const raw = caught.message;

        if (
          caught.status === 404 &&
          /unavailable|private|does not exist|not found|removed|no captions/i.test(raw)
        ) {
          console.log(
            `${LOG_PREFIX} unavailable provider=invidious instance=${instance} videoId=${videoId} status=404 message=${raw.slice(0, 120)}`
          );
          return { kind: "unavailable", provider: "invidious" };
        }

        if (caught.status === 429) {
          lastFailure = {
            status: 429,
            message: `Invidious (${instance}) is rate-limiting caption requests.`,
          };
        } else {
          lastFailure = {
            status: 502,
            message: `Invidious (${instance}) failed with HTTP ${caught.status}: ${raw || "no details"}`,
          };
        }

        console.log(
          `${LOG_PREFIX} http-error provider=invidious instance=${instance} videoId=${videoId} status=${caught.status} message=${raw.slice(0, 120)}`
        );
        continue;
      }

      const aborted =
        caught instanceof Error && (caught.name === "AbortError" || caught.name === "TimeoutError");
      const raw = caught instanceof Error ? caught.message : String(caught);

      lastFailure = aborted
        ? { status: 504, message: `Invidious (${instance}) timed out while returning captions.` }
        : {
            status: 502,
            message: `Could not reach Invidious (${instance}): ${raw.slice(0, 160)}`,
          };

      console.log(
        `${LOG_PREFIX} ${aborted ? "timeout" : "network-error"} provider=invidious instance=${instance} videoId=${videoId} message=${raw.slice(0, 120)}`
      );
      continue;
    }
  }

  if (sawNoEnglish && sawNoEnglish.length > 0) {
    return { kind: "no-english", provider: "invidious", available: sawNoEnglish };
  }

  if (lastFailure) {
    console.log(
      `${LOG_PREFIX} exhausted provider=invidious videoId=${videoId} attempts=${attempts} status=${
        lastFailure.status
      } elapsedMs=${Date.now() - startedAt}`
    );
    return {
      kind: "failed",
      provider: "invidious",
      status: lastFailure.status,
      message: `${lastFailure.message} (tried ${attempts} Invidious instance${
        attempts === 1 ? "" : "s"
      }).`,
    };
  }

  if (sawEmptyList) {
    return { kind: "no-captions", provider: "invidious" };
  }

  return {
    kind: "failed",
    provider: "invidious",
    status: 502,
    message: "Every Invidious instance failed to respond.",
  };
}

/* ------------------------------------------------------------------ */
/*  Piped provider (second choice, same idea, other mirror software)   */
/* ------------------------------------------------------------------ */

async function fetchFromPiped(videoId: string, startedAt: number): Promise<ProviderOutcome> {
  const instances = envList("PIPED_INSTANCES", DEFAULT_PIPED_INSTANCES);

  let lastFailure: { status: number; message: string } | null = null;
  let sawEmptyList = false;
  let sawNoEnglish: string[] | null = null;
  let attempts = 0;

  for (const base of instances) {
    if (Date.now() - startedAt > TOTAL_BUDGET_MS) {
      console.log(`${LOG_PREFIX} budget-exhausted provider=piped videoId=${videoId}`);
      break;
    }

    const instance = hostOf(base);
    attempts += 1;

    try {
      const raw = await fetchText(`${base}/streams/${videoId}`, STREAM_TIMEOUT_MS, "application/json");

      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        lastFailure = {
          status: 502,
          message: `Piped (${instance}) returned invalid JSON.`,
        };
        console.log(`${LOG_PREFIX} bad-json provider=piped instance=${instance} videoId=${videoId}`);
        continue;
      }

      const error = asString(parsed.error);
      if (error) {
        if (/unavailable|private|does not exist|not found|removed/i.test(error)) {
          console.log(`${LOG_PREFIX} unavailable provider=piped instance=${instance} videoId=${videoId}`);
          return { kind: "unavailable", provider: "piped" };
        }
        lastFailure = { status: 502, message: `Piped (${instance}): ${error.slice(0, 160)}` };
        console.log(`${LOG_PREFIX} api-error provider=piped instance=${instance} videoId=${videoId} message=${error.slice(0, 120)}`);
        continue;
      }

      const tracks = normalizePipedTracks(parsed.subtitles);

      if (tracks.length === 0) {
        sawEmptyList = true;
        console.log(`${LOG_PREFIX} empty-list provider=piped instance=${instance} videoId=${videoId}`);
        continue;
      }

      const track = pickEnglishTrack(tracks);

      if (!track) {
        sawNoEnglish = tracks.map((item) => item.languageCode || item.label);
        console.log(
          `${LOG_PREFIX} no-english provider=piped instance=${instance} videoId=${videoId} available=${sawNoEnglish.join(",")}`
        );
        continue;
      }

      const captionRaw = await fetchText(
        resolveTrackUrl(base, track.url),
        CAPTION_TEXT_TIMEOUT_MS,
        "text/plain, */*;q=0.5"
      );
      const segments = parseCaptionText(captionRaw);

      if (segments.length === 0) {
        lastFailure = {
          status: 502,
          message: `Piped (${instance}) returned an empty caption track.`,
        };
        console.log(`${LOG_PREFIX} empty-track provider=piped instance=${instance} videoId=${videoId}`);
        continue;
      }

      const outcome = success({
        provider: "piped",
        instance,
        videoId,
        track,
        segments,
        startedAt,
      });

      if (outcome.kind === "ok") return outcome;
      lastFailure = { status: outcome.status, message: outcome.message };
      continue;
    } catch (caught) {
      if (caught instanceof InstanceError) {
        const raw = caught.message;

        if (
          caught.status === 404 &&
          /unavailable|private|does not exist|not found|removed|no captions/i.test(raw)
        ) {
          console.log(`${LOG_PREFIX} unavailable provider=piped instance=${instance} videoId=${videoId}`);
          return { kind: "unavailable", provider: "piped" };
        }

        lastFailure =
          caught.status === 429
            ? { status: 429, message: `Piped (${instance}) is rate-limiting caption requests.` }
            : {
                status: 502,
                message: `Piped (${instance}) failed with HTTP ${caught.status}: ${raw || "no details"}`,
              };

        console.log(
          `${LOG_PREFIX} http-error provider=piped instance=${instance} videoId=${videoId} status=${caught.status} message=${raw.slice(0, 120)}`
        );
        continue;
      }

      const aborted =
        caught instanceof Error && (caught.name === "AbortError" || caught.name === "TimeoutError");
      const raw = caught instanceof Error ? caught.message : String(caught);

      lastFailure = aborted
        ? { status: 504, message: `Piped (${instance}) timed out while returning captions.` }
        : { status: 502, message: `Could not reach Piped (${instance}): ${raw.slice(0, 160)}` };

      console.log(
        `${LOG_PREFIX} ${aborted ? "timeout" : "network-error"} provider=piped instance=${instance} videoId=${videoId} message=${raw.slice(0, 120)}`
      );
      continue;
    }
  }

  if (sawNoEnglish && sawNoEnglish.length > 0) {
    return { kind: "no-english", provider: "piped", available: sawNoEnglish };
  }

  if (lastFailure) {
    console.log(
      `${LOG_PREFIX} exhausted provider=piped videoId=${videoId} attempts=${attempts} status=${
        lastFailure.status
      } elapsedMs=${Date.now() - startedAt}`
    );
    return {
      kind: "failed",
      provider: "piped",
      status: lastFailure.status,
      message: `${lastFailure.message} (tried ${attempts} Piped instance${
        attempts === 1 ? "" : "s"
      }).`,
    };
  }

  if (sawEmptyList) {
    return { kind: "no-captions", provider: "piped" };
  }

  return {
    kind: "failed",
    provider: "piped",
    status: 502,
    message: "Every Piped instance failed to respond.",
  };
}

/* ------------------------------------------------------------------ */
/*  Public entry                                                       */
/* ------------------------------------------------------------------ */

export async function fetchEnglishTranscript(videoId: string): Promise<TranscriptResult> {
  const startedAt = Date.now();

  const invidious = await fetchFromInvidious(videoId, startedAt);
  if (invidious.kind === "ok") return invidious.result;

  // A live mirror that knows the video has no captions is a definitive answer:
  // Piped would report the same thing, so do not spend the budget on it.
  if (invidious.kind === "unavailable") {
    return {
      ok: false,
      status: 404,
      message:
        "This YouTube video is unavailable (private, removed, or region-locked). Try a different link.",
    };
  }

  if (invidious.kind === "no-captions") {
    return {
      ok: false,
      status: 422,
      message:
        "No captions were found for this video on the mirrors. Try a video that has captions enabled.",
    };
  }

  if (invidious.kind === "no-english") {
    return {
      ok: false,
      status: 422,
      message: `This video has no English captions available (available: ${
        invidious.available.join(", ") || "none"
      }). Try a video with English subtitles.`,
    };
  }

  console.log(
    `${LOG_PREFIX} invidious-failed-falling-back-to-piped videoId=${videoId} reason=${invidious.message.slice(0, 120)}`
  );

  const piped = await fetchFromPiped(videoId, startedAt);
  if (piped.kind === "ok") return piped.result;

  if (piped.kind === "unavailable") {
    return {
      ok: false,
      status: 404,
      message:
        "This YouTube video is unavailable (private, removed, or region-locked). Try a different link.",
    };
  }

  if (piped.kind === "no-captions") {
    return {
      ok: false,
      status: 422,
      message:
        "No captions were found for this video on the mirrors. Try a video that has captions enabled.",
    };
  }

  if (piped.kind === "no-english") {
    return {
      ok: false,
      status: 422,
      message: `This video has no English captions available (available: ${
        piped.available.join(", ") || "none"
      }). Try a video with English subtitles.`,
    };
  }

  console.log(
    `${LOG_PREFIX} exhausted-both videoId=${videoId} invidious=${invidious.status} piped=${piped.status} elapsedMs=${
      Date.now() - startedAt
    }`
  );

  return {
    ok: false,
    status: piped.status === 429 || invidious.status === 429 ? 429 : 502,
    message: `${invidious.message} ${piped.message}`,
  };
}
