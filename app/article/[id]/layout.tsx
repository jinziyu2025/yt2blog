import type { Metadata } from "next";
import type { ReactNode } from "react";

// Generated drafts are per-visitor content stored in the browser, so the route
// is kept out of the index to avoid thin/duplicate pages.
export const metadata: Metadata = {
  title: "Your generated article — YT2Blog",
  robots: { index: false, follow: false },
};

export default function ArticleLayout({ children }: { children: ReactNode }) {
  return children;
}
