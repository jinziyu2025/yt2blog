"use client";

import { useEffect, useState } from "react";
import { countLikes, submitVote, type VoteType } from "@/lib/feedback";
import { getSupabaseBrowserClient } from "@/lib/supabase";

const VOTE_STORAGE_KEY = "yt2blog:feedback-vote";

function readStoredVote(): VoteType | null {
  try {
    const raw = window.localStorage.getItem(VOTE_STORAGE_KEY);
    return raw === "like" || raw === "dislike" ? raw : null;
  } catch {
    return null;
  }
}

function storeVote(vote: VoteType) {
  try {
    window.localStorage.setItem(VOTE_STORAGE_KEY, vote);
  } catch {
    // Storage disabled: the vote still counts for this page view.
  }
}

export function FeedbackWidget() {
  const [likes, setLikes] = useState(0);
  const [vote, setVote] = useState<VoteType | null>(null);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    setVote(readStoredVote());

    const client = getSupabaseBrowserClient();
    if (!client) {
      setNotice("Feedback is temporarily unavailable.");
      return;
    }

    let active = true;

    void countLikes(client).then((count) => {
      if (active) setLikes(count);
    });

    return () => {
      active = false;
    };
  }, []);

  async function handleVote(next: VoteType) {
    if (vote || pending) return;

    const client = getSupabaseBrowserClient();

    if (!client) {
      setNotice("Feedback is temporarily unavailable.");
      return;
    }

    setPending(true);
    setNotice("");
    setVote(next);
    storeVote(next);

    // Optimistic +1 on the visible counter, rolled back if the insert fails.
    if (next === "like") setLikes((current) => current + 1);

    const saved = await submitVote(client, next);

    if (!saved) {
      if (next === "like") setLikes((current) => Math.max(0, current - 1));
      setVote(null);
      try {
        window.localStorage.removeItem(VOTE_STORAGE_KEY);
      } catch {
        // ignore
      }
      setNotice("Could not save your vote. Try again.");
    }

    setPending(false);
  }

  const baseButton =
    "inline-flex items-center gap-2 rounded-full border px-4 py-2 text-[13px] font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 disabled:cursor-not-allowed disabled:opacity-60";

  return (
    <section className="mx-auto mt-16 w-full max-w-2xl rounded-2xl border border-line/70 bg-surface/40 px-5 py-5 text-center">
      <p className="text-[13px] font-medium text-ink">Was this helpful?</p>

      <div className="mt-3 flex flex-wrap items-center justify-center gap-2.5">
        <button
          type="button"
          onClick={() => void handleVote("like")}
          disabled={pending || vote !== null}
          className={`${baseButton} ${
            vote === "like"
              ? "border-accent/60 bg-accent/15 text-accent"
              : "border-line text-muted hover:border-line/80 hover:text-ink"
          }`}
        >
          <span aria-hidden="true">👍</span>
          Yes
          <span className="font-mono text-[11.5px] text-muted/80">{likes}</span>
        </button>

        <button
          type="button"
          onClick={() => void handleVote("dislike")}
          disabled={pending || vote !== null}
          className={`${baseButton} ${
            vote === "dislike"
              ? "border-accent/60 bg-accent/15 text-accent"
              : "border-line text-muted hover:border-line/80 hover:text-ink"
          }`}
        >
          <span aria-hidden="true">👎</span>
          No
        </button>
      </div>

      {notice ? (
        <p className="mt-3 text-[11px] text-muted/70">{notice}</p>
      ) : null}
    </section>
  );
}
