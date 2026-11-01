/**
 * Canonical site origin used for metadata, sitemap and robots.
 * NEXT_PUBLIC_SITE_URL wins when present (set it on Render); otherwise the
 * production domain yt2blog.org is used so sitemap/robots never point at a
 * dead domain. Legacy origins from earlier deployments are ignored on purpose.
 */
const DEFAULT_SITE_URL = "https://yt2blog.org";

const LEGACY_SITE_URLS = new Set([
  "https://yt2blog.app",
  "https://yt2blog-875m.onrender.com",
]);

function normalize(origin: string): string {
  const trimmed = origin.trim().replace(/\/$/, "");
  return LEGACY_SITE_URLS.has(trimmed) ? DEFAULT_SITE_URL : trimmed;
}

const CONFIGURED_SITE_URL = normalize(process.env.NEXT_PUBLIC_SITE_URL ?? "");

export const SITE_URL = CONFIGURED_SITE_URL || DEFAULT_SITE_URL;
