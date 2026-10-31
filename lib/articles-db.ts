import type { SupabaseClient } from "@supabase/supabase-js";
import type { BlogPost } from "@/lib/article";
import { ARTICLES_TABLE } from "@/lib/supabase";

export type DbArticle = {
  id: string;
  slug: string;
  video_id: string;
  title: string;
  meta_description: string;
  created_at: string;
};

export type DbArticleSummary = {
  slug: string;
  created_at: string;
};

const UNIQUE_VIOLATION = "23505";

export function titleToSlug(title: string): string {
  const base = title
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/-$/, "")
    .slice(0, 70)
    .replace(/-$/, "");

  return base || "blog-post";
}

/**
 * Writes only metadata to Supabase (no article body): slug, video_id, title
 * and the first 200 characters of the generated text as meta_description.
 * The base slug comes from the English title; on a unique collision we retry
 * with the video id appended, then a timestamp.
 */
export async function publishArticle(
  client: SupabaseClient,
  post: BlogPost
): Promise<string | null> {
  const base = titleToSlug(post.title);
  const candidates = [
    base,
    `${base}-${post.videoId}`,
    `${base}-${post.videoId}-${Date.now().toString(36)}`,
  ];

  const row = {
    video_id: post.videoId,
    title: post.title,
    meta_description: post.intro.replace(/\s+/g, " ").trim().slice(0, 200),
  };

  for (const slug of candidates) {
    const { error } = await client
      .from(ARTICLES_TABLE)
      .insert({ ...row, slug })
      .select("slug")
      .single();

    if (!error) return slug;

    if (error.code !== UNIQUE_VIOLATION) {
      console.error(`[supabase] insert failed slug=${slug} code=${error.code} message=${error.message}`);
      return null;
    }
  }

  return null;
}

export async function getArticleBySlug(
  client: SupabaseClient,
  slug: string
): Promise<DbArticle | null> {
  try {
    const { data, error } = await client
      .from(ARTICLES_TABLE)
      .select("id,slug,title,meta_description,created_at,video_id")
      .eq("slug", slug)
      .maybeSingle();

    if (error) {
      console.error(`[supabase] select failed slug=${slug} code=${error.code} message=${error.message}`);
      return null;
    }

    return (data as DbArticle | null) ?? null;
  } catch (caught) {
    console.error(`[supabase] select threw slug=${slug} message=${String(caught).slice(0, 120)}`);
    return null;
  }
}

export async function listArticleSummaries(
  client: SupabaseClient
): Promise<DbArticleSummary[]> {
  try {
    const { data, error } = await client
      .from(ARTICLES_TABLE)
      .select("slug,created_at")
      .order("created_at", { ascending: false })
      .limit(1000);

    if (error) {
      console.error(`[supabase] list failed code=${error.code} message=${error.message}`);
      return [];
    }

    return (data as DbArticleSummary[] | null) ?? [];
  } catch (caught) {
    console.error(`[supabase] list threw message=${String(caught).slice(0, 120)}`);
    return [];
  }
}
