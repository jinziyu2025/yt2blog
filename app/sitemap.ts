import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";
import { listArticleSummaries } from "@/lib/articles-db";
import { getSupabaseServerClient } from "@/lib/supabase";

// Published articles change at runtime, so the sitemap must not be cached at
// build time: revalidate = 0 regenerates it on every request.
export const revalidate = 0;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();

  const client = getSupabaseServerClient();
  const articles = client ? await listArticleSummaries(client) : [];

  const articleEntries: MetadataRoute.Sitemap = articles.map((article) => ({
    url: `${SITE_URL}/blog/${article.slug}`,
    lastModified: article.created_at ? new Date(article.created_at) : now,
    changeFrequency: "monthly",
    priority: 0.8,
  }));

  return [
    { url: SITE_URL, lastModified: now, changeFrequency: "weekly", priority: 1 },
    ...articleEntries,
    {
      url: `${SITE_URL}/terms`,
      lastModified: now,
      changeFrequency: "monthly",
      priority: 0.5,
    },
    {
      url: `${SITE_URL}/privacy`,
      lastModified: now,
      changeFrequency: "monthly",
      priority: 0.5,
    },
    {
      url: `${SITE_URL}/refund`,
      lastModified: now,
      changeFrequency: "monthly",
      priority: 0.4,
    },
    {
      url: `${SITE_URL}/cookies`,
      lastModified: now,
      changeFrequency: "monthly",
      priority: 0.3,
    },
  ];
}
