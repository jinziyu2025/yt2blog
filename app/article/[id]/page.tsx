"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import ArticleView from "@/components/article-view";
import { loadArticle, type BlogPost } from "@/lib/article";

const BACK_BUTTON =
  "inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-[#0B0B0C] transition hover:bg-[#E7FF70] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas";

export default function ArticlePage() {
  const params = useParams<{ id: string | string[] }>();
  const id = Array.isArray(params?.id) ? params.id[0] : params?.id;

  const [post, setPost] = useState<BlogPost | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!id) {
      setLoaded(true);
      return;
    }
    setPost(loadArticle(id));
    setLoaded(true);
  }, [id]);

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

          <Link
            href="/"
            className="text-[11px] text-muted transition hover:text-ink"
          >
            ← Back to generator
          </Link>
        </header>

        {!loaded ? (
          <div className="mt-16 h-40 animate-pulse rounded-2xl border border-line bg-surface/60" />
        ) : post ? (
          <div className="mt-10">
            <ArticleView post={post}>
              <div className="mt-8 flex justify-center">
                <Link href="/" className={BACK_BUTTON}>
                  Generate another video →
                </Link>
              </div>
            </ArticleView>
          </div>
        ) : (
          <div className="mt-16 rounded-2xl border border-line bg-surface p-8 text-center">
            <h1 className="text-lg font-semibold text-ink">Article not found</h1>
            <p className="mx-auto mt-3 max-w-sm text-sm leading-6 text-muted">
              This draft only lives in the browser that generated it. If you
              cleared storage or opened the link elsewhere, generate the article
              again from the homepage.
            </p>
            <div className="mt-6 flex justify-center">
              <Link href="/" className={BACK_BUTTON}>
                Back to the generator
              </Link>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
