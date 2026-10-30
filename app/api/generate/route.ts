import { NextResponse } from "next/server";
import { fetchEnglishTranscript } from "@/lib/supadata";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Streaming responses still count against the function time limit; streaming
// does NOT bypass it. Vercel limits: Hobby defaults to 10s, and up to 60s with
// Fluid compute enabled (this project targets 60s). Pro allows up to 300s.
// A ~70s generation (long transcript + reasoning) will therefore time out on
// Hobby — upgrade to Pro or shorten the pipeline in that case.
export const maxDuration = 60;

const DEEPSEEK_ENDPOINT = "https://api.deepseek.com/chat/completions";
const DEFAULT_MODEL = "deepseek-flash";
const DEEPSEEK_TIMEOUT_MS = 180_000;
const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;

// deepseek-flash emits reasoning_content, and reasoning tokens share the same
// max_tokens budget as content. With a real (long) transcript the model spends
// 4,000-7,000 tokens reasoning alone, so the budget must cover reasoning plus a
// ~1,300-token article.
const MAX_TOKENS_FIRST = 8_000;
const MAX_TOKENS_RETRY = 10_000;
const MIN_ACCEPTABLE_WORDS = 600;

// Transcript fetch + truncation live in lib/supadata.ts (Supadata API).

// No caching: every request fetches the real transcript and calls DeepSeek.
// In-flight de-duplication below is memory-only (no disk writes).

const LOG_PREFIX = "[deepseek]";
const LOG_PREFIX_STREAM = "[stream]";
const LOG_PREFIX_PERSONA = "[persona]";
const LOG_PREFIX_STYLE = "[style]";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type BlogSection = {
  heading: string;
  body: string;
};

type BlogPost = {
  videoId: string;
  title: string;
  slug: string;
  metaDescription: string;
  intro: string;
  sections: BlogSection[];
  conclusion: string;
  wordCount: number;
  readingMinutes: number;
  generatedAt: string;
};

type MetaFields = {
  title: string;
  slug: string;
  metaDescription: string;
};

type DeepSeekDelta = {
  content?: unknown;
  reasoning_content?: unknown;
};

class HttpError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "HttpError";
  }
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function fail(status: number, message: string) {
  return NextResponse.json({ message }, { status });
}

function parseYouTubeUrl(raw: string): {
  videoId: string | null;
  error: string | null;
} {
  const value = raw.trim();

  if (!value) {
    return { videoId: null, error: "Paste a YouTube link to get started." };
  }

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
    return VIDEO_ID_PATTERN.test(id)
      ? { videoId: id, error: null }
      : { videoId: null, error: "That youtu.be link is missing a valid video ID." };
  }

  const firstSegment = segments[0] ?? "";

  if (firstSegment === "watch") {
    const id = parsed.searchParams.get("v") ?? "";
    return VIDEO_ID_PATTERN.test(id)
      ? { videoId: id, error: null }
      : { videoId: null, error: "That watch link is missing a ?v= video ID." };
  }

  if (["shorts", "embed", "live", "v"].includes(firstSegment)) {
    const id = segments[1] ?? "";
    return VIDEO_ID_PATTERN.test(id)
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

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 64)
    .replace(/-$/, "");
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/* ------------------------------------------------------------------ */
/*  Prompts                                                            */
/* ------------------------------------------------------------------ */

function buildSystemPrompt(): string {
  return [
    "Stage 1 - pick the right writer before writing a single word.",
    "Read the transcript first (the first 500-800 words are enough) and decide what the video is really about.",
    "Output one persona tag at the very top, then keep that persona for the whole article.",
    "Format: <persona>Michelin-calibre food critic and recipe writer</persona>",
    "",
    "Persona examples (map by domain; do not copy verbatim if a better fit exists):",
    "- cooking / food / recipes -> a Michelin-calibre food critic and recipe writer. Talk heat, texture, seasoning, layers.",
    "- tech / AI / hardware -> a veteran tech columnist who actually lives with the gadgets. Talk about what changes in an ordinary person's day, not what it means for the industry.",
    "- gaming -> a hardcore game critic. Talk feel, pacing, replayability, mechanics.",
    "- business / startups / talks -> a curious business observer who explains companies like a friend over coffee. Talk people, decisions, and consequences in plain words - never like an equity analyst.",
    "- travel -> a writer who has spent years on the road. Talk logistics, costs, local texture.",
    "- fitness -> a strength and conditioning coach. Talk load, form, recovery, progression.",
    "- finance -> a markets columnist writing for ordinary readers. Talk risk, incentives, and what it means for a normal wallet.",
    "- education -> an education commentator. Talk systems, incentives, outcomes.",
    "- anything else -> an experienced columnist in that exact field.",
    "Never fall back to a generic \"content creator\". If the domain is unclear, choose the closest concrete one.",
    "The persona must change vocabulary and judgments. Relabelling alone is not enough.",
    "A persona is a point of view. It is never a report format; a tech video handled by a commercial persona must still sound like a person talking.",
    "",
    "Stage 2 - write like a human columnist, not a product manual. English.",
    "",
    "Absolute bans. A checker scans the finished draft and rewrites the whole piece when any of these appears:",
    "- Antithesis and balanced pairs: \"A, not B\" (\"solid hardware, not a revolution\"), \"It is not X, it is Y\", \"Not only ... but also ...\", \"No X, no Y, just Z\", \"less X, more Y\", \"more X than Y\". Say the thing once. If two ideas really matter, use two plain sentences.",
    "- Manufactured parallelism: three clauses cut from one template, matched pairs tuned for rhythm (\"fast on paper, slow in practice\"), lists built for cadence rather than information.",
    "- Anaphora runs: two sentences in a row opening with the same emphatic word (\"Nobody asked. Nobody cared.\"), or three in a row opening with the same word at all. Also banned: three consecutive sentences built on which / that / who clauses.",
    "- Definitional paragraph openers: never start a paragraph with a tidy summary sentence of the \"X is the oldest device\" / \"Y is the real problem\" shape. A paragraph may start mid-thought, with a dash, with an ellipsis, with half a sentence, with an action, or with a boring fact.",
    "- Paragraph punchlines. Never land a paragraph on a quotable one-liner or a mini-summary. A paragraph may end on a boring detail, a plain action, a half-finished complaint, or a shrug.",
    "- Imperative or motto endings. Never close a paragraph, especially the last one, with advice of the \"Be picky about who you accept.\" / \"Choose quality over noise.\" / \"Don't settle for less.\" shape. The article can end flat, mid-thought, or on one concrete action (\"He closes the laptop and reheats the coffee.\").",
    "- More than one metaphor in the whole article. One image, maximum, and only if it beats the plain wording. Elsewhere use everyday words and a precise verb.",
    "",
    "Voice target: someone dictating a long voice message in a group chat and letting it transcribe, not a columnist filing copy. Sentences may trail off. Some paragraphs are only two sentences. Filler words are part of the voice. Dashes (—) and ellipses (...) are welcome when a thought interrupts itself, so the text reads like someone typing while thinking.",
    "Imperfection is the point: lists can be uneven in length, a list can switch grammatical shape halfway (two nouns, then a whole clause with \"because ...\"), and a slightly clunky spoken aside is fine. Do not tidy every sentence into the same mould.",
    "",
    "Opening (this matters most):",
    "- Start inside the video: \"In a recent video, YouTuber [name] puts ... to the test.\"",
    "- The first two or three sentences must come from real transcript details: a number, a habit, a specific doubt.",
    "- Never open with a summary, a definition, or a scene-setting generalization.",
    "",
    "Voice rules:",
    "- Name the person if the transcript gives a name. Otherwise \"the YouTuber\", \"the host\", \"the chef\", \"the player\".",
    "- Use he, she, they, his feed, her setup - concrete people doing concrete things.",
    "- Let judgment show: \"a little suspicious\", \"what he had never done was ...\", \"that is the part that stuck with me\".",
    "- Mix sentence lengths on purpose: a long, winding sentence, then a short flat one. Roughly a third of sentences can be 12 words or fewer, but never write three ultra-short sentences (under 8 words) in a row. No sentence exceeds 35 words.",
    "- Hard cap: if a sentence passes 28 words, cut it in two with a full stop. Do not fix it with commas.",
    "- Vary sentence openings. Two consecutive sentences must not start the same way.",
    "- An occasional dash or short question is fine. Do not stack clauses.",
    "",
    "Tone law - this overrides the persona's instincts. Every persona obeys it:",
    "- Voice: an amateur blogger who had two beers at midnight and is typing fast. First person is fine: \"I tried it\", \"I still do not buy it\", \"honestly, this part annoyed me\".",
    "- Filler words belong in this voice: \"Honestly,\", \"Like,\", \"You know,\", \"I mean,\", \"To be fair,\", \"And yeah,\", \"kind of\", \"sort of\", \"Which, fair enough.\" Sentences may begin with And, But, or Like. Some can trail off unfinished.",
    "- Subjective opinions and light snark are required. Take a side, admit a bias, poke fun at a flaw. It should read like a friend teasing you, with none of the poet's polish.",
    "- Joke density: at most one smart line per two paragraphs, and only where the thought itself is funny. Do not sprinkle quips over plain information.",
    "- Metaphor budget: one image for the entire article. One. Elsewhere write plainly and let a precise verb work (smashed, gouged, drifted, stalled, melted). No decorative similes, no comparisons stacked in a paragraph.",
    "- Antithesis and parallelism are banned outright: \"A, not B\", \"It is not X, it is Y\", \"No X, no Y, just Z\", \"Not only ... but also\", \"less X, more Y\", matched pairs, three clauses cut from one template. The checker rewrites the draft when it finds them.",
    "- Anaphora is banned: no \"Nobody... Nobody...\", no \"X... X... X...\", no three consecutive which / that / who clauses. The checker also rewrites for these.",
    "- Paragraph openings must not define or summarise. No \"Looping is the oldest device.\" Start mid-thought instead: \"Loops, honestly, are the reason I stopped watching at 20 minutes...\" or \"He loops the same four bars for eleven minutes.\"",
    "- No paragraph punchlines. Do not land each paragraph on a quotable line or a mini-summary. Allowed endings: a boring detail, an unfinished action, a complaint that goes nowhere, a shrug.",
    "- No imperative or motto endings: no \"Be picky about who you accept.\", no \"Choose quality over noise.\", no closing advice at all. End flat, mid-thought, or on a concrete action.",
    "- Uneven is good: let list items differ in shape and length, let one clause break the rhythm, let a spoken aside sit there without being cleaned up.",
    "- Banned business-report vocabulary: \"a study in\", \"the moat\", \"logistics not magic\", \"unit economics\", \"value proposition\", \"market positioning\", \"best-in-class\", \"paradigm shift\", \"ecosystem play\", \"moat-building\", \"go-to-market\". Rewrite the idea in kitchen-table English instead.",
    "- Tech products: the angle is what it changes for an ordinary person - the commute, the kitchen counter, the wallet, the family group chat, the sleep. Do NOT write about supply chains, market share, competitive strategy, or corporate chess. Save the business-school framing for the business video and even then keep it conversational.",
    "- Never turn a persona into a report. If a sentence could appear in a pitch deck, a McKinsey slide, or a product press release, rewrite it.",
    "",
    "Paragraph openers (checked after generation; violations get the draft rewritten):",
    "- Three consecutive paragraphs must never open the same way. Same pronoun subject (He/She/They/It), same \"The + noun\" opener, or the same adverbial template all count as the same.",
    "- Rotate on purpose: time or place first (\"By the second week, ...\", \"On a hot pan, ...\"); straight action with no subject (\"The phone died at 4pm, mid-photo.\"); short verdict (\"That screen is genuinely great.\"); inversion or a short question (\"Why bother testing it again?\"); concrete detail first (\"Twenty minutes before cooking, the steaks come out of the fridge.\").",
    "- At least half of the section-opening sentences must start without a person as the subject.",
    "- Use 2-3 em dashes, ellipses (...) or parenthetical asides (\"— which is the whole problem —\") across the piece. An ellipsis mid-sentence is fine when the thought stalls. Fragments of 3-8 words are fine mid-thought; do not park a fragment alone as a punchline.",
    "- Assert, do not report: write \"The AI feature is not shipping.\" instead of \"It can be said that ...\" or \"The creator states that ...\". Do not follow an assertion with a summary line that explains it.",
    "- A judgment can carry an attitude word (sharp, sloppy, lazy, genuinely good, unfinished) as long as no fact is invented.",
    "",
    "Banned words and moves (never use them):",
    "- \"The creator\", \"the content creator\", \"the video\" used as a generic subject.",
    "- \"makes the video worth watching\" filler. Name the footage, the episode, or the shot he is looking at.",
    "- \"This article will ...\", \"In today's fast-paced world\", \"delve into\", \"tapestry\".",
    "- \"it's important to note\", \"In conclusion\", \"Overall,\" at the start of a paragraph.",
    "- \"Not only ... but also ...\" and any fill-in-the-blank template sentence.",
    "",
    "Stage 3 - structure (SEO skeleton stays):",
    "<persona>one line, the domain expert you are writing as</persona>",
    "<title>H1 title, 50-70 characters</title>",
    "<slug>kebab-case-slug-of-3-6-words</slug>",
    "<meta>Meta description, 140-160 characters, includes the main keyword</meta>",
    "# The same title",
    "",
    "<intro: 2-3 short paragraphs>",
    "",
    "## Section heading",
    "<section body of roughly 120-200 words>",
    "",
    "(4-5 sections; open each with a scene, a detail, or a judgment - never \"Firstly\" or \"Secondly\")",
    "",
    "## Conclusion",
    "<1-2 short paragraphs that simply stop somewhere honest - a last observation, an unresolved annoyance, a small concrete action. Never summarize the article, never write a final punchline, and never close with imperative advice (\"Be picky about who you accept.\")>",
    "",
    "Hard rules:",
    "- Use only facts that appear in the transcript.",
    "- Never invent names, numbers, prices, addresses, or quotes that are not in the transcript. If in doubt, leave it out.",
    "- You may infer opinions and implications from the transcript, but not new facts.",
    "- Total body (intro + sections + conclusion): 800-1,000 words.",
    "- Before finishing, read the first three words of every paragraph. No three in a row may share the same pattern; if they do, rewrite those openers.",
    "- No JSON, no code fences, no preamble, no commentary about your process.",
    "- Never refuse, never explain limitations, never return an empty article.",
    "- Start with <persona>.",
  ].join("\n");
}

function buildUserPrompt(options: {
  url: string;
  videoId: string;
  transcript: string;
  retry: boolean;
  reviseNote?: string;
}): string {
  const lines = [
    `Source video: ${options.url}`,
    `Video ID: ${options.videoId}`,
    "",
    "VIDEO TRANSCRIPT (source material):",
    '"""',
    options.transcript,
    '"""',
    "",
    "Write the full 800-1,000 word English SEO article based on this transcript now.",
  ];

  if (options.reviseNote) {
    lines.push(
      "STYLE FIX REQUIRED: the previous draft broke the tone rules listed below.",
      options.reviseNote,
      "Output the <persona>, <title>, <slug> and <meta> tag lines first, then the markdown body. Use only facts from the transcript above."
    );
  } else if (options.retry) {
    lines.push(
      "Output the <persona>, <title>, <slug> and <meta> tag lines first, then the markdown body. Never return empty output."
    );
  } else {
    lines.push(
      "Use concrete details from the transcript, and do not add facts that are not in it.",
      "Output the <persona> tag first, then <title>, <slug>, <meta>, then the markdown body."
    );
  }

  return lines.join("\n");
}

/* ------------------------------------------------------------------ */
/*  Markdown parsing                                                   */
/* ------------------------------------------------------------------ */

function personaLabel(text: string): string {
  const match = /<persona>([\s\S]*?)<\/persona>/i.exec(text);
  return match ? match[1].replace(/\s+/g, " ").trim() : "";
}

function personaEndIndex(text: string): number {
  const match = /<\/persona>/i.exec(text);
  return match ? match.index + match[0].length : 0;
}

/** Map the persona label to a coarse domain for logging only. */
function detectDomain(persona: string): string {
  const label = persona.toLowerCase();
  const mappings: Array<[RegExp, string]> = [
    [/food|cook|chef|recipe|cuisine|culinary|restaurant|kitchen/, "food"],
    [/gaming|game|esport|player|gameplay/, "gaming"],
    [/fitness|strength|conditioning|training|workout|coach|athlet/, "fitness"],
    [/travel|traveller|traveler|destination|road/, "travel"],
    [/finance|market|invest|econom|valuation/, "finance"],
    [/business|startup|entrepreneur|analyst|strategy/, "business"],
    [/education|teacher|school|learning|pedagog/, "education"],
    [/tech|technology|software|hardware|silicon|gadget|engineer|ai/, "tech"],
  ];

  for (const [pattern, domain] of mappings) {
    if (pattern.test(label)) return domain;
  }

  return "general";
}

function deriveMetaDescription(intro: string, title: string): string {
  const base = intro.replace(/\s+/g, " ").trim();
  if (base.length >= 140) {
    const clipped = base.slice(0, 160);
    const lastSpace = clipped.lastIndexOf(" ");
    return (lastSpace > 140 ? clipped.slice(0, lastSpace) : clipped).trim();
  }

  const filler = `${base} Read the key takeaways from this video and what they mean for you.`
    .replace(/\s+/g, " ")
    .trim();

  return filler.slice(0, 160).trim() || title.slice(0, 160);
}

function parseArticle(
  full: string,
  videoId: string,
  tags: { title?: string; slug?: string; meta?: string }
): BlogPost {
  // Strip the metadata tag block(s); keep only the markdown body.
  const body = full
    .replace(/<persona>[\s\S]*?<\/persona>/gi, "")
    .replace(/<title>[\s\S]*?<\/title>/gi, "")
    .replace(/<slug>[\s\S]*?<\/slug>/gi, "")
    .replace(/<meta>[\s\S]*?<\/meta>/gi, "")
    .replace(/\r\n/g, "\n")
    .trim();

  const lines = body.split("\n");

  let h1 = "";
  const introLines: string[] = [];
  const blocks: Array<{ heading: string; body: string[] }> = [];
  let current: { heading: string; body: string[] } | null = null;

  for (const line of lines) {
    const sectionMatch = /^##\s+(.+)$/.exec(line);
    if (sectionMatch) {
      if (current) blocks.push(current);
      current = { heading: sectionMatch[1].trim(), body: [] };
      continue;
    }

    const h1Match = /^#\s+(.+)$/.exec(line);
    if (h1Match) {
      if (!h1) h1 = h1Match[1].trim();
      continue;
    }

    if (current) {
      current.body.push(line);
    } else {
      introLines.push(line);
    }
  }

  if (current) blocks.push(current);

  const title = h1 || asString(tags.title);
  if (!title) {
    throw new Error("The model output is missing a title.");
  }

  const slug = slugify(asString(tags.slug) || title);

  let intro = introLines.join("\n").trim();
  if (!intro && blocks.length > 0) {
    // The model skipped the intro; keep the article usable by promoting the
    // first block's body instead of failing the whole request.
    intro = blocks[0].body.join("\n").trim();
    blocks.shift();
  }

  if (!intro) {
    throw new Error("The model output is missing an intro.");
  }

  const conclusionIndex = blocks.findIndex((block) =>
    /^(conclusion|final thought|final thoughts|takeaway|bottom line)/i.test(block.heading)
  );

  let conclusion = "";
  let sections = blocks;

  if (conclusionIndex !== -1) {
    conclusion = blocks[conclusionIndex].body.join("\n").trim();
    sections = blocks.filter((_, index) => index !== conclusionIndex);
  } else if (blocks.length > 3) {
    conclusion = blocks[blocks.length - 1].body.join("\n").trim();
    sections = blocks.slice(0, -1);
  }

  if (!conclusion && sections.length > 0) {
    conclusion = sections[sections.length - 1].body.join("\n").trim();
  }

  const normalizedSections: BlogSection[] = sections
    .map((block) => ({
      heading: block.heading.trim(),
      body: block.body.join("\n").trim(),
    }))
    .filter((section) => section.heading && section.body);

  if (normalizedSections.length === 0) {
    throw new Error("The model output is missing sections.");
  }

  if (!conclusion) {
    throw new Error("The model output is missing a conclusion.");
  }

  const tagMeta = asString(tags.meta);
  const metaDescription =
    tagMeta.includes(" ") ? tagMeta : deriveMetaDescription(intro, title);

  const allText = [
    title,
    intro,
    ...normalizedSections.map((s) => `${s.heading} ${s.body}`),
    conclusion,
  ].join(" ");
  const wordCount = allText.split(/\s+/).filter(Boolean).length;

  return {
    videoId,
    title,
    slug,
    metaDescription,
    intro,
    sections: normalizedSections,
    conclusion,
    wordCount,
    readingMinutes: Math.max(1, Math.ceil(wordCount / 220)),
    generatedAt: new Date().toISOString(),
  };
}

/* ------------------------------------------------------------------ */
/*  Style guard: repeated paragraph openers + rhythm stats             */
/* ------------------------------------------------------------------ */

type StyleStats = {
  paragraphs: number;
  repeatedOpeners: number;
  windows: string[];
  antithesis: string[];
  anaphora: string[];
  definitional: string[];
  motto: string[];
  dashes: number;
  asides: number;
  shortSentences: number;
  assertions: number;
  avgSentenceWords: number;
  maxSentenceWords: number;
  openers: Record<string, number>;
};

const PRONOUN_OPENERS = new Set([
  "he", "she", "they", "it", "we", "you", "i", "his", "her", "their", "its", "him", "them",
]);

const DETERMINER_OPENERS = new Set([
  "the", "a", "an", "this", "that", "these", "those", "another", "every", "some", "most",
  "many", "few", "both", "one",
]);

const ADVERBIAL_OPENERS = new Set([
  "by", "on", "at", "in", "after", "before", "during", "for", "with", "without", "when",
  "once", "inside", "outside", "later", "then", "now", "still", "even", "under", "over",
  "across", "within", "around", "between", "today", "tonight", "yesterday", "tomorrow",
  "twenty", "thirty", "forty", "fifty", "ten", "five", "three", "two", "four", "six",
  "seven", "eight", "nine",
]);

// Base-form verbs are the only reliable way to spot a subjectless opener without
// a POS tagger. Anything else (a noun phrase like "Performance gets ...") is
// treated as "other" so ordinary noun subjects are not counted as fragments.
const VERB_OPENERS = new Set([
  "sear", "salt", "season", "heat", "buy", "get", "put", "take", "turn", "rest", "slice",
  "attach", "fuse", "build", "run", "jump", "look", "start", "try", "keep", "add", "press",
  "cook", "cut", "use", "play", "watch", "avoid", "skip", "stop", "ignore", "walk", "spend",
  "hold", "preheat", "pat", "rub", "baste", "render", "taste", "test", "check", "compare",
  "call", "name", "forget", "remember", "grab", "cover", "leave", "drop", "sit", "expect",
  "notice", "read", "ask", "pick", "treat", "measure", "dial", "flip", "plate", "serve",
]);

const ATTITUDE_WORDS = new Set([
  "sharp", "sloppy", "lazy", "genuinely", "obvious", "wrong", "better", "worse", "boring",
  "brilliant", "ugly", "bold", "dull", "fine", "solid", "missing", "unfinished", "strange",
  "weird", "honest", "brutal", "smart", "dumb", "cheap", "expensive", "clean", "messy",
  "awkward", "terrible", "bad", "good", "impressive", "underwhelming", "overpriced", "fussy",
]);

const DASH_PATTERN = /\u2014|\u2013/;

function wordsIn(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

function splitSentences(text: string): string[] {
  return text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s && /[A-Za-z]/.test(s));
}

function paragraphsOf(post: BlogPost): string[] {
  return [post.intro, ...post.sections.map((section) => section.body), post.conclusion]
    .flatMap((part) => part.split(/\n+/))
    .map((part) => part.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

/**
 * Coarse opener family of a paragraph's first sentence. No POS tagger: the
 * first token plus the sentence shape is enough to catch the "He ... He ...
 * He ..." / "The phone ... The phone ... The phone ..." pattern.
 */
function openerFamily(paragraph: string): string {
  const sentence = splitSentences(paragraph)[0] ?? paragraph;
  const cleaned = sentence.replace(/^[\s"'“”‘’()[\]*]+/, "").trim();
  if (!cleaned) return "unknown";
  if (cleaned.endsWith("?")) return "question";

  const first = (/^[A-Za-z][A-Za-z'-]*/.exec(cleaned)?.[0] ?? "").toLowerCase();
  if (!first) return "action";
  if (PRONOUN_OPENERS.has(first)) return "person";
  if (DETERMINER_OPENERS.has(first)) return "determiner";
  if (ADVERBIAL_OPENERS.has(first) || /ly$/.test(first)) return "adverbial";
  if (VERB_OPENERS.has(first)) return "action";
  return "other";
}

const COUNTED_FAMILIES = new Set(["person", "determiner", "adverbial", "question", "action"]);

// AI-signature antithesis / parallelism. These are the shapes a polished model
// reaches for by default, so a single hit is enough to send the draft back.
const ANTITHESIS_RULES: { label: string; pattern: RegExp }[] = [
  { label: "not-only-but-also", pattern: /\bnot only\b[^.!?]{0,90}\bbut\s+also\b/i },
  { label: "not-x-but-y", pattern: /\bnot\b[^.!?]{0,70},\s*but\b/i },
  { label: "sentence-starts-not", pattern: /(?:^|[.!?]\s+)not\s+[^.!?]{0,70},/i },
  { label: "no-x-no-y", pattern: /\bno\s+[A-Za-z][^.!?]{0,45},\s*(?:and\s+)?no\s+[A-Za-z]/i },
  { label: "no-x-just-y", pattern: /\bno\s+[A-Za-z][^.!?]{0,45},\s*just\b/i },
  {
    label: "a-not-b",
    pattern:
      /,\s*not\s+(?!(?:sure|really|bad|much|even|yet|only|quite|very|that|so|too|enough|anymore)\b)[A-Za-z]/i,
  },
  {
    label: "is-not-x-it-is-y",
    pattern:
      /\b(?:is|was|are|were)\s+not\b[^.!?]{0,60}[,.;]\s*(?:it|this|that|they)\s+(?:is|was|are|were)\b/i,
  },
  { label: "less-more", pattern: /\b(?:less|more)\s+[a-z][^.!?]{0,45},\s*(?:less|more)\s+[a-z]/i },
];

function findAntithesis(paragraphs: string[]): string[] {
  const hits: string[] = [];

  for (const paragraph of paragraphs) {
    for (const { label, pattern } of ANTITHESIS_RULES) {
      if (hits.length >= 5) return hits;
      const match = pattern.exec(paragraph);
      if (!match) continue;
      hits.push(`${label}: "${match[0].replace(/\s+/g, " ").trim().slice(0, 90)}"`);
    }
  }

  return hits;
}

function firstWordOf(sentence: string): string {
  return (/^[A-Za-z'’]+/.exec(sentence.replace(/^[\s"'“”‘’()[\]*—-]+/, ""))?.[0] ?? "").toLowerCase();
}

// Emphatic openers that read like a slogan when repeated back to back.
const ANAPHORA_WORDS = new Set([
  "nobody", "nothing", "never", "no", "none", "everyone", "everything", "everybody",
  "someone", "something", "somebody", "always", "every", "each", "all", "only", "which",
]);

// Words too common to count as a deliberate anaphora when repeated three times.
const ANAPHORA_SKIP = new Set(["i", "you", "and", "but", "so", "then", "if", "when", "it"]);

const RELATIVE_CLAUSE = /,\s*(?:which|who|whom|where)\b/i;

function findAnaphora(paragraphs: string[]): string[] {
  const hits: string[] = [];

  for (const paragraph of paragraphs) {
    const sentences = splitSentences(paragraph);
    const firsts = sentences.map(firstWordOf);

    for (let i = 0; i < firsts.length; i += 1) {
      if (hits.length >= 5) return hits;
      const word = firsts[i];

      if (word && word === firsts[i + 1] && ANAPHORA_WORDS.has(word)) {
        hits.push(`anaphora: "${word} ... ${word}"`);
        continue;
      }

      if (
        i + 2 < firsts.length &&
        word === firsts[i + 1] &&
        word === firsts[i + 2] &&
        !ANAPHORA_SKIP.has(word)
      ) {
        hits.push(`anaphora: "${word}" three times in a row`);
        continue;
      }

      if (
        i + 2 < firsts.length &&
        RELATIVE_CLAUSE.test(sentences[i]) &&
        RELATIVE_CLAUSE.test(sentences[i + 1]) &&
        RELATIVE_CLAUSE.test(sentences[i + 2])
      ) {
        hits.push("anaphora: three consecutive which/who clauses");
      }
    }
  }

  return hits;
}

// "Looping is the oldest device." - a tidy definition where a thought should
// start. Numbers and measurements are exempt so factual descriptions survive.
function findDefinitionalOpeners(paragraphs: string[]): string[] {
  const hits: string[] = [];

  for (const paragraph of paragraphs) {
    const first = splitSentences(paragraph)[0] ?? "";
    if (!first || wordsIn(first) > 12 || /\d/.test(first)) continue;
    if (!/^(?:the|a|an|this|that)?\s*[A-Za-z][A-Za-z'’\s-]{0,34}\s+(?:is|was|are|were)\s+(?:the|a|an|what)\b/i.test(first)) {
      continue;
    }
    hits.push(`definitional opener: "${first.slice(0, 70)}"`);
  }

  return hits;
}

// A paragraph that closes on bare advice reads like a slogan. Concrete actions
// keep a subject ("He closes the laptop"), so a subjectless imperative at the
// end of a paragraph is the signal.
const MOTTO_VERBS = new Set([
  "be", "don't", "do", "never", "always", "remember", "choose", "avoid", "stop",
  "keep", "try", "think", "ask", "judge", "pick", "let", "make", "buy",
]);

const MOTTO_PHRASES =
  /\b(?:all about|the lesson is|the takeaway|moral of (?:the|this) story|what matters is|that is the whole point)\b/i;

function findMottoEndings(paragraphs: string[]): string[] {
  const hits: string[] = [];

  for (const paragraph of paragraphs) {
    const sentences = splitSentences(paragraph);
    const last = sentences[sentences.length - 1];
    if (!last || wordsIn(last) > 14) continue;
    // A question that happens to start with "Do" is not imperative advice.
    if (last.includes("?")) continue;
    if (!MOTTO_VERBS.has(firstWordOf(last)) && !MOTTO_PHRASES.test(last)) continue;

    hits.push(`motto ending: "${last.slice(0, 70)}"`);
    if (hits.length >= 4) break;
  }

  return hits;
}

function analyzeStyle(post: BlogPost): StyleStats {
  const paragraphs = paragraphsOf(post);
  const openers = paragraphs.map(openerFamily);

  const windows: string[] = [];
  for (let i = 0; i + 2 < openers.length; i += 1) {
    const family = openers[i];
    if (!COUNTED_FAMILIES.has(family)) continue;
    if (family === openers[i + 1] && family === openers[i + 2]) {
      windows.push(`${i + 1}-${i + 3}:${family}`);
    }
  }

  const body = paragraphs.join(" ");
  const sentences = [
    post.intro,
    ...post.sections.map((section) => section.body),
    post.conclusion,
  ].flatMap(splitSentences);

  const lens = sentences.map(wordsIn);
  const avg = lens.reduce((sum, n) => sum + n, 0) / Math.max(1, lens.length);

  const dashMatches = body.match(new RegExp(DASH_PATTERN.source, "g")) ?? [];
  const asides =
    (body.match(/,\s?(?:which|and that|and this)\b/gi) ?? []).length +
    (body.match(/\u2014\s?which\b/gi) ?? []).length +
    (body.match(/\([^()]{3,80}\)/g) ?? []).length;

  const assertionCount = sentences.filter((sentence) => {
    if (wordsIn(sentence) > 14) return false;
    return sentence
      .toLowerCase()
      .split(/[^a-z]+/)
      .some((token) => ATTITUDE_WORDS.has(token));
  }).length;

  const openersByFamily: Record<string, number> = {};
  for (const family of openers) {
    openersByFamily[family] = (openersByFamily[family] ?? 0) + 1;
  }

  return {
    paragraphs: paragraphs.length,
    repeatedOpeners: windows.length,
    windows,
    antithesis: findAntithesis(paragraphs),
    anaphora: findAnaphora(paragraphs),
    definitional: findDefinitionalOpeners(paragraphs),
    motto: findMottoEndings(paragraphs),
    dashes: dashMatches.length,
    asides,
    shortSentences: lens.filter((n) => n <= 8).length,
    assertions: assertionCount,
    avgSentenceWords: Number(avg.toFixed(1)),
    maxSentenceWords: lens.length ? Math.max(...lens) : 0,
    openers: openersByFamily,
  };
}

/* ------------------------------------------------------------------ */
/*  DeepSeek streaming call                                            */
/* ------------------------------------------------------------------ */

function upstreamErrorMessage(status: number, raw: string, model: string): string {
  let detail = "";

  try {
    const parsed = JSON.parse(raw) as {
      error?: { message?: unknown };
      message?: unknown;
    };
    detail = asString(parsed.error?.message) || asString(parsed.message);
  } catch {
    detail = raw.slice(0, 300);
  }

  const hint =
    status === 401
      ? " (check DEEPSEEK_API_KEY)"
      : status === 402
        ? " (DeepSeek account balance is insufficient)"
        : status === 404
          ? ` (model "${model}" may not exist)`
          : status === 429
            ? " (rate limit reached, try again shortly)"
            : "";

  return `DeepSeek API error (HTTP ${status})${hint}: ${detail || "no details returned"}`;
}

type StreamCallResult = {
  finishReason: string;
  contentChars: number;
  reasoningChars: number;
  elapsedMs: number;
};

async function streamDeepSeek(options: {
  apiKey: string;
  model: string;
  maxTokens: number;
  systemPrompt: string;
  userPrompt: string;
  attempt: number;
  signal: AbortSignal;
  onContent: (text: string) => void;
}): Promise<StreamCallResult> {
  const startedAt = Date.now();

  console.log(
    `${LOG_PREFIX} request attempt=${options.attempt} model=${options.model} max_tokens=${options.maxTokens} stream=true`
  );

  const response = await fetch(DEEPSEEK_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${options.apiKey}`,
    },
    body: JSON.stringify({
      model: options.model,
      messages: [
        { role: "system", content: options.systemPrompt },
        { role: "user", content: options.userPrompt },
      ],
      temperature: 0.7,
      max_tokens: options.maxTokens,
      stream: true,
    }),
    signal: options.signal,
  });

  if (!response.ok) {
    const raw = await response.text();
    console.log(
      `${LOG_PREFIX} stream attempt=${options.attempt} status=${response.status} body=${raw.slice(0, 500).replace(/\s+/g, " ")}`
    );
    throw new HttpError(
      response.status >= 400 && response.status <= 599 ? response.status : 502,
      upstreamErrorMessage(response.status, raw, options.model)
    );
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("DeepSeek returned an empty stream body.");
  }

  const decoder = new TextDecoder();
  let buffer = "";
  let finishReason = "";
  let contentChars = 0;
  let reasoningChars = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    let newlineIndex = buffer.indexOf("\n");
    while (newlineIndex !== -1) {
      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);
      newlineIndex = buffer.indexOf("\n");

      if (!line.startsWith("data:")) continue;

      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;

      let parsed: {
        choices?: Array<{ finish_reason?: unknown; delta?: DeepSeekDelta }>;
        usage?: unknown;
      };

      try {
        parsed = JSON.parse(payload);
      } catch {
        continue;
      }

      const choice = parsed.choices?.[0];
      const reason = asString(choice?.finish_reason);
      if (reason) finishReason = reason;

      const reasoning =
        typeof choice?.delta?.reasoning_content === "string"
          ? choice.delta.reasoning_content
          : "";
      if (reasoning) reasoningChars += reasoning.length;

      // Do NOT trim: leading spaces are part of the token stream and are
      // required to keep words separated in the assembled text.
      const content =
        typeof choice?.delta?.content === "string" ? choice.delta.content : "";
      if (content) {
        contentChars += content.length;
        options.onContent(content);
      }
    }
  }

  const elapsedMs = Date.now() - startedAt;

  console.log(
    `${LOG_PREFIX} stream done attempt=${options.attempt} elapsed=${elapsedMs}ms finish_reason=${
      finishReason || "none"
    } contentChars=${contentChars} reasoningChars=${reasoningChars}`
  );

  return { finishReason, contentChars, reasoningChars, elapsedMs };
}

/* ------------------------------------------------------------------ */
/*  Article generation (streaming with one retry)                      */
/* ------------------------------------------------------------------ */

type GenCallbacks = {
  onMeta: (meta: MetaFields) => void;
  onDelta: (text: string) => void;
  onRevise?: (info: { reason: string }) => void;
};

type GenOptions = {
  url: string;
  videoId: string;
  transcript: string;
  apiKey: string;
  model: string;
  signal: AbortSignal;
  callbacks: GenCallbacks;
};

async function generateArticle(options: GenOptions): Promise<BlogPost> {
  const systemPrompt = buildSystemPrompt();
  let lastFailure = "";
  let reviseNote: string | undefined;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const retry = attempt > 0;
    const maxTokens = retry ? MAX_TOKENS_RETRY : MAX_TOKENS_FIRST;
    const userPrompt = buildUserPrompt({
      url: options.url,
      videoId: options.videoId,
      transcript: options.transcript,
      retry,
      reviseNote,
    });

    const full = { text: "" };
    const state = {
      metaSent: false,
      bodyStart: 0,
      emitted: 0,
      anythingStreamed: false,
      tags: { title: "", slug: "", meta: "" },
    };

    const flushBody = () => {
      if (!state.metaSent) return;
      const start = Math.max(state.emitted, state.bodyStart);
      if (full.text.length <= start) return;

      // Readers must never see the internal persona label, even if the model
      // puts it somewhere unexpected.
      const piece = full.text
        .slice(start, full.text.length)
        .replace(/<persona>[\s\S]*?<\/persona>/gi, "");
      state.emitted = full.text.length;
      if (!piece) return;

      state.anythingStreamed = true;
      options.callbacks.onDelta(piece);
    };

    const sendMeta = (meta: MetaFields) => {
      state.metaSent = true;
      state.tags = {
        title: meta.title,
        slug: meta.slug,
        meta: meta.metaDescription,
      };

      const persona = personaLabel(full.text);
      console.log(
        `${LOG_PREFIX_PERSONA} videoId=${options.videoId} domain=${detectDomain(
          persona
        )} persona=${persona || "none"}`
      );

      console.log(
        `${LOG_PREFIX_STREAM} meta videoId=${options.videoId} attempt=${attempt} titleLen=${meta.title.length} metaLen=${meta.metaDescription.length}`
      );

      options.callbacks.onMeta(meta);
    };

    const handleContent = (chunk: string) => {
      full.text += chunk;

      if (!state.metaSent) {
        const metaMatch = /<meta>([\s\S]*?)<\/meta>/i.exec(full.text);
        if (metaMatch) {
          state.bodyStart = metaMatch.index + metaMatch[0].length;

          const titleMatch = /<title>([\s\S]*?)<\/title>/i.exec(full.text);
          const slugMatch = /<slug>([\s\S]*?)<\/slug>/i.exec(full.text);
          const tagTitle = titleMatch ? titleMatch[1].trim() : "";
          const tagMeta = metaMatch[1].trim();

          // The model sometimes emits the tag lines without spaces; the H1 in
          // the markdown body is reliable, so wait for it before sending meta.
          const bodySoFar = full.text.slice(state.bodyStart);
          // Require the newline so we never send a half-streamed H1 as the title.
          const h1Match = /^\s*#[ \t]*([^\n#][^\n]*)\n/.exec(bodySoFar);

          if (!h1Match && bodySoFar.length < 400) {
            return;
          }

          const title = h1Match ? h1Match[1].trim() : tagTitle;

          sendMeta({
            title,
            slug: slugMatch ? slugMatch[1].trim() : "",
            // Drop a tag meta that lost its spaces; it gets derived at parse time.
            metaDescription: tagMeta.includes(" ") ? tagMeta : "",
          });

          // Skip the H1 line in the streamed body (the title is shown above it).
          if (h1Match) {
            state.emitted = state.bodyStart + h1Match[0].length;
          }

          flushBody();
          return;
        }

        // Fallback: the model ignored the tag format. After enough text, stop
        // waiting and stream the raw body so the user still sees content early.
        if (full.text.length > 600) {
          sendMeta({ title: "", slug: "", metaDescription: "" });
          // Skip any persona line so readers never see the internal label.
          state.bodyStart = personaEndIndex(full.text);
          flushBody();
        }
        return;
      }

      flushBody();
    };

    let upstreamStart = 0;

    try {
      const result = await Promise.race([
        streamDeepSeek({
          apiKey: options.apiKey,
          model: options.model,
          maxTokens,
          systemPrompt,
          userPrompt,
          attempt,
          signal: options.signal,
          onContent: (chunk) => {
            if (!upstreamStart) {
              upstreamStart = Date.now();
            }
            handleContent(chunk);
          },
        }),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error("DEEPSEEK_TIMEOUT")),
            DEEPSEEK_TIMEOUT_MS
          )
        ),
      ]);

      if (!full.text.trim()) {
        lastFailure = `DeepSeek returned an empty completion (finish_reason=${
          result.finishReason || "unknown"
        }).`;
        console.log(
          `${LOG_PREFIX} empty stream attempt=${attempt} finish_reason=${result.finishReason || "none"}`
        );

        if (attempt === 0 && !state.anythingStreamed) continue;
        throw new Error(lastFailure);
      }

      const post = parseArticle(full.text, options.videoId, state.tags);

      if (post.wordCount < MIN_ACCEPTABLE_WORDS) {
        console.log(
          `${LOG_PREFIX} short article attempt=${attempt} words=${post.wordCount}`
        );

        if (attempt === 0 && !state.anythingStreamed) {
          lastFailure = `DeepSeek returned a short article (${post.wordCount} words).`;
          continue;
        }
      }

      const style = analyzeStyle(post);
      console.log(
        `${LOG_PREFIX_STYLE} videoId=${options.videoId} attempt=${attempt} revised=${Boolean(
          reviseNote
        )} paragraphs=${style.paragraphs} repeated=${style.repeatedOpeners} antithesis=${
          style.antithesis.length
        } anaphora=${style.anaphora.length} definitional=${style.definitional.length} motto=${
          style.motto.length
        } hits=${
          [...style.antithesis, ...style.anaphora, ...style.motto, ...(style.definitional.length >= 2 ? style.definitional : [])].join(" | ") || "none"
        } windows=${
          style.windows.join(",") || "none"
        } dashes=${style.dashes} asides=${style.asides} short8=${style.shortSentences} assertions=${
          style.assertions
        } avg=${style.avgSentenceWords} max=${style.maxSentenceWords} openers=${Object.entries(
          style.openers
        )
          .map(([family, count]) => `${family}:${count}`)
          .join("/")}`
      );

      const violations = [
        ...style.antithesis,
        ...style.anaphora,
        ...style.motto,
        ...(style.definitional.length >= 2 ? style.definitional : []),
      ];

      if (attempt === 0 && violations.length > 0) {
        reviseNote = `The draft broke these hard rules: ${violations.join(
          " | "
        )}. Rewrite the whole piece. Replace every listed sentence with one plain statement: no "A, not B", no "Nobody... Nobody...", no three consecutive which / who clauses, no three sentences starting with the same word. Do not open a paragraph with a definitional summary sentence ("X is the oldest device"); start mid-thought, with a dash, with an ellipsis, or with an action. Do not close any paragraph, especially the last one, with imperative advice ("Be picky about who you accept.") - end flat, mid-thought, or on a concrete action. Use dashes (—) and ellipses (...) where the thought breaks, let list items be uneven in shape, and allow one clunky spoken aside. Keep at most one metaphor, every sentence under 28 words, and every fact from the transcript unchanged.`;
        console.log(
          `${LOG_PREFIX_STYLE} violation-retry videoId=${options.videoId} hits=${violations.length}`
        );
        options.callbacks.onRevise?.({ reason: "banned parallelism" });
        continue;
      }

      if (attempt === 0 && style.repeatedOpeners > 0) {
        const family = style.windows[0]?.split(":")[1] ?? "same";
        reviseNote = `Paragraphs ${style.windows.join(
          ", "
        )} opened in the same "${family}" pattern. Rewrite the whole piece so no three consecutive paragraphs share an opener type. Break every run of three with at least two of these: a time or place lead, a short question, a one-line verdict, a concrete detail first. Keep every fact from the transcript unchanged, and keep every sentence under 28 words.`;
        console.log(
          `${LOG_PREFIX_STYLE} repeated-opener retry videoId=${options.videoId} windows=${style.windows.join(",")}`
        );
        options.callbacks.onRevise?.({ reason: "repeated paragraph openers" });
        continue;
      }

      if (style.repeatedOpeners > 0) {
        console.log(
          `${LOG_PREFIX_STYLE} repeated-opener kept=${style.repeatedOpeners} videoId=${options.videoId} windows=${style.windows.join(",")}`
        );
      }

      // Make sure the meta event was delivered even if tags were missing.
      if (!state.metaSent) {
        sendMeta({
          title: post.title,
          slug: post.slug,
          metaDescription: post.metaDescription,
        });
      }

      return post;
    } catch (caught) {
      if (options.signal.aborted) {
        throw caught;
      }

      const message = caught instanceof Error ? caught.message : String(caught);

      if (message === "DEEPSEEK_TIMEOUT") {
        throw new HttpError(
          504,
          `DeepSeek streaming timed out after ${DEEPSEEK_TIMEOUT_MS / 1000} seconds. Try again.`
        );
      }

      if (caught instanceof HttpError) {
        throw caught;
      }

      if (caught instanceof TypeError) {
        throw new HttpError(
          502,
          `Could not reach the DeepSeek API: ${message || "network error"}`
        );
      }

      if (attempt === 0 && !state.anythingStreamed) {
        lastFailure = message;
        console.log(`${LOG_PREFIX} attempt=0 failed before streaming: ${message}`);
        continue;
      }

      throw caught;
    }
  }

  throw new HttpError(502, lastFailure || "DeepSeek returned no usable content.");
}

/* ------------------------------------------------------------------ */
/*  In-flight de-duplication (memory only, no disk)                    */
/* ------------------------------------------------------------------ */

const inFlight = new Map<string, Promise<BlogPost>>();

/* ------------------------------------------------------------------ */
/*  SSE helpers                                                        */
/* ------------------------------------------------------------------ */
/*  Protocol:                                                          */
/*    event: meta   data: { title, slug, metaDescription, cached }      */
/*    event: delta  data: { text }                                      */
/*    event: done   data: BlogPost + { cached }                         */
/*    event: error  data: { message, code }                             */
/* ------------------------------------------------------------------ */

const encoder = new TextEncoder();

function sseFrame(event: string, data: unknown): Uint8Array {
  return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

const SSE_HEADERS = {
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-cache, no-transform",
  "X-Accel-Buffering": "no",
  Connection: "keep-alive",
};

/* ------------------------------------------------------------------ */
/*  POST /api/generate                                                 */
/* ------------------------------------------------------------------ */

export async function POST(request: Request) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return fail(400, "Request body must be valid JSON.");
  }

  const body = (payload ?? {}) as Record<string, unknown>;
  const url = typeof body.url === "string" ? body.url : "";

  if (!url.trim()) {
    return fail(400, "Missing `url` in the request body.");
  }

  const { videoId, error } = parseYouTubeUrl(url);
  if (!videoId) {
    return fail(400, error ?? "Invalid YouTube URL.");
  }

  const apiKey = process.env.DEEPSEEK_API_KEY?.trim() ?? "";
  if (!apiKey) {
    return fail(
      500,
      "DEEPSEEK_API_KEY is not configured on the server. Add it to d:\\yt2blog\\.env.local and restart the dev server."
    );
  }

  // The .env.local placeholder is non-ASCII, and fetch refuses non-ASCII header
  // values. Catch it here so the user sees an actionable message instead of a
  // ByteString conversion error.
  if (/[^\x20-\x7E]/.test(apiKey)) {
    return fail(
      500,
      "DEEPSEEK_API_KEY still contains the placeholder value in .env.local. Replace it with your real DeepSeek key, then restart the dev server."
    );
  }

  const transcript = await fetchEnglishTranscript(videoId);
  if (!transcript.ok) {
    return fail(transcript.status, transcript.message);
  }

  const model = process.env.DEEPSEEK_MODEL?.trim() || DEFAULT_MODEL;
  const key = `${videoId}|${model}`;
  const startedAt = Date.now();

  const upstream = new AbortController();
  const onClientAbort = () => upstream.abort();
  request.signal.addEventListener("abort", onClientAbort);

  let firstDeltaMs: number | null = null;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;

      const send = (event: string, data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(sseFrame(event, data));
        } catch {
          closed = true;
        }
      };

      const close = () => {
        if (closed) return;
        closed = true;
        try {
          controller.close();
        } catch {
          // Already closed.
        }
      };

      const sendDone = (post: BlogPost, cachedFlag: boolean) => {
        send("done", {
          ...post,
          cached: cachedFlag,
        });

        const elapsed = Date.now() - startedAt;
        console.log(
          `${LOG_PREFIX_STREAM} done videoId=${videoId} cached=${cachedFlag} ttft=${
            firstDeltaMs ?? "n/a"
          }ms total=${elapsed}ms words=${post.wordCount} sections=${post.sections.length}`
        );
      };

      try {
        const existing = inFlight.get(key);
        if (existing) {
          // Same video + model already generating: reuse that run instead of
          // paying for a second transcript + DeepSeek call. Memory only.
          console.log(`${LOG_PREFIX_STREAM} dedupe videoId=${videoId} model=${model}`);
          const post = await existing;

          send("meta", {
            title: post.title,
            slug: post.slug,
            metaDescription: post.metaDescription,
            cached: true,
          });
          sendDone(post, true);
          close();
          return;
        }

        console.log(
          `${LOG_PREFIX_STREAM} start videoId=${videoId} model=${model} lang=${transcript.lang} chars=${transcript.originalChars}`
        );

        const task = generateArticle({
          url,
          videoId,
          transcript: transcript.text,
          apiKey,
          model,
          signal: upstream.signal,
          callbacks: {
            onMeta: (meta) => {
              send("meta", { ...meta, cached: false });
            },
            onDelta: (text) => {
              if (firstDeltaMs === null) {
                firstDeltaMs = Date.now() - startedAt;
              }
              send("delta", { text });
            },
            onRevise: (info) => {
              // The first draft was already streamed; tell the client to clear
              // it before the rewritten version arrives.
              send("revise", { reason: info.reason });
            },
          },
        });

        inFlight.set(key, task);

        try {
          const post = await task;
          sendDone(post, false);
        } finally {
          inFlight.delete(key);
        }

        close();
      } catch (caught) {
        if (upstream.signal.aborted) {
          console.log(
            `${LOG_PREFIX_STREAM} aborted videoId=${videoId} after=${Date.now() - startedAt}ms`
          );
          close();
          return;
        }

        const message =
          caught instanceof Error ? caught.message : "Generation failed unexpectedly.";
        const code = caught instanceof HttpError ? caught.status : 502;

        console.log(
          `${LOG_PREFIX_STREAM} error videoId=${videoId} code=${code} message=${message.slice(0, 160)}`
        );

        send("error", { message, code });
        close();
      } finally {
        request.signal.removeEventListener("abort", onClientAbort);
      }
    },
    cancel() {
      console.log(`${LOG_PREFIX_STREAM} client cancelled videoId=${videoId}`);
      upstream.abort();
    },
  });

  return new Response(stream, { status: 200, headers: SSE_HEADERS });
}
