"use client";

import { useState } from "react";
import type { ReactNode } from "react";
import CopyrightDisclaimer from "@/components/copyright-disclaimer";
import { buildArticleText, type BlogPost } from "@/lib/article";

type CopyFeedback = "article" | "meta" | "error" | null;

const SOLID_BUTTON =
  "inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-[#0B0B0C] transition hover:bg-[#E7FF70] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:ring-offset-2 focus-visible:ring-offset-surface";

function CopyIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      className="h-3.5 w-3.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" />
      <path d="M10.5 5.5V3.5a1 1 0 0 0-1-1H3.5a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2" />
    </svg>
  );
}

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through to the legacy path below.
  }

  try {
    const helper = document.createElement("textarea");
    helper.value = text;
    helper.setAttribute("readonly", "");
    helper.style.position = "fixed";
    helper.style.opacity = "0";
    document.body.appendChild(helper);
    helper.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(helper);
    return ok;
  } catch {
    return false;
  }
}

/**
 * Full rendered draft. Used by /article/[id]; the homepage itself never
 * renders an article any more.
 */
export default function ArticleView({
  post,
  children,
}: {
  post: BlogPost;
  children?: ReactNode;
}) {
  const [copyFeedback, setCopyFeedback] = useState<CopyFeedback>(null);

  function flashCopy(feedback: Exclude<CopyFeedback, null>) {
    setCopyFeedback(feedback);
    window.setTimeout(() => setCopyFeedback(null), 1800);
  }

  async function handleCopyArticle() {
    const ok = await copyToClipboard(buildArticleText(post));
    flashCopy(ok ? "article" : "error");
  }

  async function handleCopyMeta() {
    const ok = await copyToClipboard(post.metaDescription);
    flashCopy(ok ? "meta" : "error");
  }

  return (
    <>
      <article className="animate-fade-up overflow-hidden rounded-2xl border border-line bg-surface">
        {/* Toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3.5 sm:px-8">
          <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-white/[0.03] px-2 py-1 text-[10.5px] uppercase tracking-[0.12em]">
              <span className="h-1.5 w-1.5 rounded-full bg-accent" />
              Draft ready
            </span>
            <span className="text-muted/40">·</span>
            <span>{post.wordCount} words</span>
            <span className="text-muted/40">·</span>
            <span>{post.readingMinutes} min read</span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleCopyArticle}
              className={SOLID_BUTTON}
            >
              <CopyIcon />
              {copyFeedback === "article"
                ? "Copied"
                : copyFeedback === "error"
                  ? "Copy failed"
                  : "Copy article"}
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="px-5 py-8 sm:px-10 sm:py-10">
          <div className="flex flex-wrap items-center gap-2 font-mono text-[11px] text-muted/70">
            <span className="rounded-md border border-line bg-black/30 px-2 py-1 text-ink/70">
              /blog/{post.slug}
            </span>
            <span className="text-muted/50">suggested permalink</span>
          </div>

          <h2 className="mt-5 text-[26px] font-semibold leading-[1.2] tracking-[-0.02em] text-ink sm:text-[34px]">
            {post.title}
          </h2>

          {/* Meta description */}
          <div className="mt-6 rounded-xl border border-line bg-black/25 p-4">
            <div className="flex items-center justify-between gap-3">
              <p className="text-[10.5px] uppercase tracking-[0.14em] text-muted">
                Meta description
              </p>
              <button
                type="button"
                onClick={handleCopyMeta}
                className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10.5px] text-muted transition hover:bg-white/[0.06] hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
              >
                <CopyIcon />
                {copyFeedback === "meta"
                  ? "Copied"
                  : copyFeedback === "error"
                    ? "Failed"
                    : "Copy"}
              </button>
            </div>
            <p className="mt-2 text-[13px] leading-6 text-[#C8C8D0]">
              {post.metaDescription}
            </p>
            <p className="mt-2 font-mono text-[10px] text-muted/60">
              {post.metaDescription.length} chars · target ≤ 160
            </p>
          </div>

          <div className="mt-8">
            <p className="whitespace-pre-wrap text-[15.5px] leading-[1.85] text-[#D6D6DC]">
              {post.intro}
            </p>

            {post.sections.map((section) => (
              <section key={section.heading} className="mt-9">
                <h3 className="text-[18px] font-semibold tracking-[-0.01em] text-ink">
                  {section.heading}
                </h3>
                <p className="mt-3 whitespace-pre-wrap text-[14.5px] leading-[1.85] text-[#B6B6C0]">
                  {section.body}
                </p>
              </section>
            ))}

            <div className="mt-10 rounded-xl border-l-2 border-accent/60 bg-white/[0.025] px-5 py-4">
              <p className="text-[10.5px] uppercase tracking-[0.14em] text-muted">
                Final thought
              </p>
              <p className="mt-2 whitespace-pre-wrap text-[14.5px] leading-[1.8] text-[#D6D6DC]">
                {post.conclusion}
              </p>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-5 py-3.5 sm:px-8">
          <p className="font-mono text-[10.5px] text-muted/60">
            source · youtube.com/watch?v={post.videoId}
          </p>
          <p className="text-[10.5px] text-muted/60">
            AI draft · edit before publishing
          </p>
        </div>
      </article>

      <CopyrightDisclaimer className="mt-4 px-1" />

      {children}
    </>
  );
}
