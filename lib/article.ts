export type BlogSection = {
  heading: string;
  body: string;
};

export type BlogPost = {
  videoId: string;
  title: string;
  slug: string;
  metaDescription: string;
  intro: string;
  sections: BlogSection[];
  conclusion: string;
  wordCount: number;
  readingMinutes: number;
  generatedAt: string;
};

export function buildArticleText(post: BlogPost): string {
  const lines: string[] = [
    post.title,
    "",
    `Suggested slug: /blog/${post.slug}`,
    `Meta description: ${post.metaDescription}`,
    "",
    post.intro,
    "",
  ];

  post.sections.forEach((section) => {
    lines.push(section.heading, "", section.body, "");
  });

  lines.push("Final thought", "", post.conclusion, "");
  lines.push(`Source: https://youtube.com/watch?v=${post.videoId}`);

  return lines.join("\n");
}

/**
 * Markdown body stored in Supabase: intro first, then one `## heading`
 * section per article section, with the conclusion kept as its own section.
 */
export function buildMarkdown(post: BlogPost): string {
  const parts: string[] = [post.intro.trim()];

  post.sections.forEach((section) => {
    parts.push(`## ${section.heading.trim()}\n\n${section.body.trim()}`);
  });

  parts.push(`## Final thought\n\n${post.conclusion.trim()}`);

  return parts.join("\n\n");
}

export function parseArticleMarkdown(content: string): {
  intro: string;
  sections: BlogSection[];
} {
  const normalized = content.replace(/\r\n/g, "\n").trim();
  const blocks = normalized.split("\n## ");

  const intro = blocks[0].replace(/^## /, "").trim();

  const sections = blocks.slice(1).map((block) => {
    const breakIndex = block.indexOf("\n");
    if (breakIndex === -1) {
      return { heading: block.trim(), body: "" };
    }
    return {
      heading: block.slice(0, breakIndex).trim(),
      body: block.slice(breakIndex + 1).trim(),
    };
  });

  return { intro, sections };
}

/**
 * The generated draft is handed from the homepage to /article/[id] through
 * localStorage (there is no server-side store). Keyed by videoId so the same
 * video can be revisited; a refreshed page still finds its article.
 */
const KEY_PREFIX = "yt2blog:article:";

export function saveArticle(post: BlogPost): void {
  try {
    window.localStorage.setItem(KEY_PREFIX + post.videoId, JSON.stringify(post));
  } catch {
    // Private mode / quota: the article page will simply ask for a new run.
  }
}

export function loadArticle(id: string): BlogPost | null {
  try {
    const raw = window.localStorage.getItem(KEY_PREFIX + id);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as Partial<BlogPost>;
    if (
      typeof parsed?.title !== "string" ||
      typeof parsed?.intro !== "string" ||
      !Array.isArray(parsed.sections)
    ) {
      return null;
    }

    return parsed as BlogPost;
  } catch {
    return null;
  }
}
