"use client";

import { useEffect, useRef, useState } from "react";
import ArticleView from "@/components/article-view";
import { loadArticle, type BlogPost } from "@/lib/article";
import { streamBlogPost } from "@/lib/generate-client";

type Phase = "idle" | "working" | "done" | "error";

/**
 * The blog page only stores metadata, so the full draft is rebuilt in this
 * browser. The generator already produced and cached it during the loading
 * screen, so this component reuses that draft instead of generating a second
 * time. Only when no cached draft exists (e.g. another device opened the link)
 * does it stream a single time, automatically on mount.
 */
export default function FullArticleGenerator({ videoId }: { videoId: string }) {
  const [phase, setPhase] = useState<Phase>("working");
  const [streamText, setStreamText] = useState("");
  const [post, setPost] = useState<BlogPost | null>(null);
  const [errorMessage, setErrorMessage] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    // Single source of truth: reuse the draft from the generator run.
    const cached = loadArticle(videoId);
    if (cached) {
      setPost(cached);
      setPhase("done");
      return;
    }

    void run();

    return () => abortRef.current?.abort();
  }, [videoId]);

  async function run() {
    abortRef.current?.abort();

    const controller = new AbortController();
    abortRef.current = controller;

    setPhase("working");
    setStreamText("");
    setPost(null);
    setErrorMessage("");

    try {
      const result = await streamBlogPost(
        `https://www.youtube.com/watch?v=${videoId}`,
        {
          refresh: false,
          signal: controller.signal,
          onMeta: () => setStreamText(""),
          onDelta: (chunk) => {
            setStreamText((previous) => previous + chunk);
          },
        }
      );

      setPost(result);
      setPhase("done");
    } catch (caught) {
      if (controller.signal.aborted) {
        setPhase("idle");
        return;
      }

      setPhase("error");
      setErrorMessage(
        caught instanceof Error
          ? caught.message
          : "Generation failed for an unknown reason. Please try again."
      );
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
      }
    }
  }

  if (phase === "done" && post) {
    return (
      <div className="mt-8">
        <ArticleView post={post} withDisclaimer={false} />
        <p className="mt-3 px-1 text-[10px] leading-4 text-muted/50">
          Generated in your browser just now. This full text was not sent to or
          stored on our servers.
        </p>
      </div>
    );
  }

  return (
    <div className="mt-8 rounded-xl border border-line bg-black/25 p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[13px] font-semibold text-ink">
            {phase === "error" ? "Generation failed" : "Writing your full article…"}
          </p>
          <p className="mt-1 max-w-md text-[11.5px] leading-5 text-muted">
            The full draft is generated in your browser from the original video.
            It is never stored on our servers.
          </p>
        </div>

        {phase !== "error" && (
          <span className="inline-flex items-center gap-2 text-[10.5px] uppercase tracking-[0.14em] text-muted">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
            streaming
          </span>
        )}
      </div>

      {streamText ? (
        <div className="mt-5 max-h-[65vh] overflow-y-auto rounded-lg border border-line bg-surface/60 p-4">
          <p className="whitespace-pre-wrap text-[13px] leading-7 text-[#C8C8D0]">
            {streamText}
          </p>
          <span className="mt-1 inline-block h-4 w-1.5 animate-pulse bg-accent align-middle" />
        </div>
      ) : (
        <div className="mt-5 flex items-center gap-3 text-[11.5px] text-muted">
          <span className="h-3.5 w-3.5 animate-spin rounded-full border border-muted/40 border-t-accent" />
          Fetching the transcript and drafting the article…
        </div>
      )}

      {phase === "error" && (
        <div className="mt-4">
          <p className="text-[11.5px] leading-5 text-red-400">{errorMessage}</p>
          <button
            type="button"
            onClick={run}
            className="mt-3 inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2.5 text-xs font-semibold text-[#0B0B0C] transition hover:bg-[#E7FF70] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
          >
            Try again
          </button>
        </div>
      )}
    </div>
  );
}
