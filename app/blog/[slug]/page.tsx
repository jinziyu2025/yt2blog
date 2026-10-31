import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import CopyrightDisclaimer from "@/components/copyright-disclaimer";
import FullArticleGenerator from "@/components/full-article-generator";
import { getArticleBySlug } from "@/lib/articles-db";
import { getSupabaseServerClient } from "@/lib/supabase";
import { SITE_URL } from "@/lib/site";

// Only metadata is stored, so this page is rendered per request straight from
// Supabase and the full text is rebuilt in the visitor's browser on demand.
export const dynamic = "force-dynamic";

type PageProps = { params: { slug: string } };

async function loadArticle(slug: string) {
  const client = getSupabaseServerClient();
  if (!client) return null;
  return getArticleBySlug(client, slug);
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const article = await loadArticle(params.slug);

  if (!article) {
    return {
      title: "Article not found — YT2Blog",
      robots: { index: false, follow: false },
    };
  }

  const canonical = `${SITE_URL}/blog/${article.slug}`;

  return {
    title: article.title,
    description: article.meta_description,
    alternates: { canonical },
    openGraph: {
      title: article.title,
      description: article.meta_description,
      url: canonical,
      siteName: "YT2Blog",
      type: "article",
      publishedTime: article.created_at,
    },
    twitter: {
      card: "summary",
      title: article.title,
      description: article.meta_description,
    },
    robots: { index: true, follow: true },
  };
}

export default async function BlogArticlePage({ params }: PageProps) {
  const article = await loadArticle(params.slug);

  if (!article) {
    notFound();
  }

  const publishedAt = article.created_at.slice(0, 10);

  return (
    <main className="relative min-h-screen overflow-hidden">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute left-1/2 top-[-260px] h-[520px] w-[880px] -translate-x-1/2 rounded-full bg-accent/5 blur-[130px]"
      />

      <div className="relative mx-auto w-full max-w-3xl px-5 pb-20 pt-8 sm:px-8">
        <header className="flex items-center justify-between">
          <Link
            href="/"
            className="flex items-center gap-2.5 text-sm font-semibold tracking-tight text-ink transition hover:text-accent"
          >
            <span className="grid h-8 w-8 place-items-center rounded-lg border border-line bg-surface text-accent">
              <svg viewBox="0 0 20 20" className="h-4 w-4" aria-hidden="true">
                <path d="M7 4.5v11l9-5.5-9-5.5Z" fill="currentColor" />
              </svg>
            </span>
            YT2Blog
          </Link>

          <Link href="/" className="text-[11px] text-muted transition hover:text-ink">
            ← Turn a video into a blog
          </Link>
        </header>

        <article className="mt-10 animate-fade-up overflow-hidden rounded-2xl border border-line bg-surface">
          <div className="border-b border-line px-5 py-3.5 sm:px-8">
            <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-white/[0.03] px-2 py-1 text-[10.5px] uppercase tracking-[0.12em]">
                <span className="h-1.5 w-1.5 rounded-full bg-accent" />
                AI summary
              </span>
              <span className="text-muted/40">·</span>
              <span>Published {publishedAt}</span>
            </div>
          </div>

          <div className="px-5 py-8 sm:px-10 sm:py-10">
            <div className="flex flex-wrap items-center gap-2 font-mono text-[11px] text-muted/70">
              <span className="rounded-md border border-line bg-black/30 px-2 py-1 text-ink/70">
                /blog/{article.slug}
              </span>
            </div>

            <h1 className="mt-5 text-[28px] font-semibold leading-[1.2] tracking-[-0.025em] text-ink sm:text-[38px]">
              {article.title}
            </h1>

            <p className="mt-6 whitespace-pre-wrap text-[15.5px] leading-[1.85] text-[#D6D6DC]">
              {article.meta_description}
            </p>

            <FullArticleGenerator videoId={article.video_id} />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-5 py-3.5 sm:px-8">
            <a
              href={`https://youtube.com/watch?v=${article.video_id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="font-mono text-[10.5px] text-muted/60 transition hover:text-ink"
            >
              source · youtube.com/watch?v={article.video_id}
            </a>
            <p className="text-[10.5px] text-muted/60">
              AI summary · verify before republishing
            </p>
          </div>
        </article>

        <CopyrightDisclaimer className="mt-4 px-1" />

        <div className="mt-10 flex justify-center">
          <Link
            href="/"
            className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-[#0B0B0C] transition hover:bg-[#E7FF70] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
          >
            Turn another YouTube video into a blog post →
          </Link>
        </div>
      </div>
    </main>
  );
}
