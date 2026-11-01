import type { SupabaseClient } from "@supabase/supabase-js";

/*
 * Site-wide feedback votes. Only a vote_type is stored; the count shown in the
 * UI is the real number of `like` rows, so a brand-new deployment starts at 0.
 */

export const FEEDBACK_TABLE = "feedbacks";

export type VoteType = "like" | "dislike";

export async function countLikes(client: SupabaseClient): Promise<number> {
  try {
    const { count, error } = await client
      .from(FEEDBACK_TABLE)
      .select("*", { count: "exact", head: true })
      .eq("vote_type", "like");

    if (error) {
      console.error(
        `[feedback] count failed code=${error.code} message=${error.message}`
      );
      return 0;
    }

    return count ?? 0;
  } catch (caught) {
    console.error(`[feedback] count threw message=${String(caught).slice(0, 120)}`);
    return 0;
  }
}

export async function submitVote(
  client: SupabaseClient,
  voteType: VoteType
): Promise<boolean> {
  try {
    const { error } = await client
      .from(FEEDBACK_TABLE)
      .insert({ vote_type: voteType });

    if (error) {
      console.error(
        `[feedback] insert failed code=${error.code} message=${error.message} details=${
          error.details ?? "n/a"
        }`
      );
      return false;
    }

    return true;
  } catch (caught) {
    console.error(`[feedback] insert threw message=${String(caught).slice(0, 120)}`);
    return false;
  }
}
