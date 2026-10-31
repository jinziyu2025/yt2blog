/**
 * Canonical site origin used for metadata, sitemap and robots.
 * Set NEXT_PUBLIC_SITE_URL on the host (e.g. https://yt2blog.onrender.com)
 * to override the fallback.
 */
export const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL || "https://yt2blog.app"
).replace(/\/$/, "");
