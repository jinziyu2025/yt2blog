import { NextResponse, type NextRequest } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";

/*
 * Admin whitelist unlock.
 *
 * The passcode is read from the server-only environment variable
 * ADMIN_PASSCODE (no NEXT_PUBLIC_ prefix, so it is never inlined into the
 * client bundle). A matching passcode only buys an HttpOnly, signed cookie;
 * nothing about the passcode itself reaches the browser.
 *
 *   POST /api/admin/unlock  { passcode } -> sets the cookie, { admin: true }
 *   GET  /api/admin/unlock               -> { admin: true | false } (cookie check)
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COOKIE_NAME = "yt2blog_admin";
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days
const MAX_FAILED_ATTEMPTS = 10;
const ATTEMPT_WINDOW_MS = 10 * 60 * 1000;

// In-memory throttle for the unlock endpoint only. Render runs a single
// instance for this app, so a module-level map is enough.
const failures = new Map<string, { count: number; firstAt: number }>();

function clientKey(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for") ?? "";
  return forwarded.split(",")[0].trim() || "unknown";
}

function isThrottled(key: string): boolean {
  const entry = failures.get(key);
  if (!entry) return false;

  if (Date.now() - entry.firstAt > ATTEMPT_WINDOW_MS) {
    failures.delete(key);
    return false;
  }

  return entry.count >= MAX_FAILED_ATTEMPTS;
}

function recordFailure(key: string) {
  const entry = failures.get(key);
  const now = Date.now();

  if (!entry || now - entry.firstAt > ATTEMPT_WINDOW_MS) {
    failures.set(key, { count: 1, firstAt: now });
    return;
  }

  entry.count += 1;
}

function adminPasscode(): string {
  // Server-side only. Configure this in Render -> Environment.
  return (process.env.ADMIN_PASSCODE ?? "").trim();
}

function sign(issuedAt: string, secret: string): string {
  return createHmac("sha256", secret).update(issuedAt).digest("hex");
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function isCookieValid(token: string | undefined): boolean {
  const secret = adminPasscode();
  if (!secret || !token) return false;

  const [issuedAt, signature] = token.split(".");
  if (!issuedAt || !signature) return false;

  const timestamp = Number(issuedAt);
  if (!Number.isFinite(timestamp)) return false;
  if (Date.now() - timestamp > COOKIE_MAX_AGE_SECONDS * 1000) return false;

  return safeEqual(signature, sign(issuedAt, secret));
}

export async function GET(request: NextRequest) {
  const token = request.cookies.get(COOKIE_NAME)?.value;
  return NextResponse.json({ admin: isCookieValid(token) });
}

export async function POST(request: NextRequest) {
  const expected = adminPasscode();

  if (!expected) {
    console.log("[admin] ADMIN_PASSCODE is not configured on the server");
    return NextResponse.json(
      { admin: false, message: "Admin unlock is not configured on this deployment." },
      { status: 500 }
    );
  }

  const key = clientKey(request);

  if (isThrottled(key)) {
    return NextResponse.json(
      { admin: false, message: "Too many attempts. Try again later." },
      { status: 429 }
    );
  }

  let passcode = "";

  try {
    const body = (await request.json()) as { passcode?: unknown };
    passcode = typeof body.passcode === "string" ? body.passcode.trim() : "";
  } catch {
    passcode = "";
  }

  if (!passcode || !safeEqual(passcode, expected)) {
    recordFailure(key);
    console.log(`[admin] unlock rejected from=${key.slice(0, 40)}`);
    return NextResponse.json({ admin: false }, { status: 401 });
  }

  failures.delete(key);

  const issuedAt = String(Date.now());
  const token = `${issuedAt}.${sign(issuedAt, expected)}`;

  const response = NextResponse.json({ admin: true });
  response.cookies.set({
    name: COOKIE_NAME,
    value: token,
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: COOKIE_MAX_AGE_SECONDS,
  });

  console.log(`[admin] unlock granted from=${key.slice(0, 40)}`);
  return response;
}
