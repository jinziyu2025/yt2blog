/**
 * Canonical site origin used for metadata, sitemap and robots.
 * NEXT_PUBLIC_SITE_URL wins when present (set it on Render); otherwise the
 * deployed Render origin is used so sitemap/robots never point at a dead domain.
 */
export const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL?.trim() || "https://yt2blog-875m.onrender.com"
).replace(/\/$/, "");
