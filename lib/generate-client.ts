import type { BlogPost } from "@/lib/article";

export type StreamMeta = {
  title: string;
  slug: string;
  metaDescription: string;
  cached?: boolean;
};

/**
 * Streaming generation request.
 *
 * The browser only talks to our own `/api/generate` route. The DeepSeek
 * key lives in the server env (DEEPSEEK_API_KEY) and never reaches the
 * client. The route responds with text/event-stream; we parse it by hand
 * (no extra dependency) and surface every event as it arrives:
 *   meta -> title/slug/meta ready, delta -> body text, done -> final article.
 */
export async function streamBlogPost(
  url: string,
  options: {
    refresh: boolean;
    signal: AbortSignal;
    onMeta: (meta: StreamMeta) => void;
    onDelta: (text: string) => void;
    onRevise?: (info: { reason: string }) => void;
  }
): Promise<BlogPost> {
  const response = await fetch("/api/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify({ url, refresh: options.refresh }),
    signal: options.signal,
  });

  const contentType = response.headers.get("content-type") ?? "";

  // Validation and transcript failures arrive as plain JSON with a real status.
  if (!response.ok || !contentType.includes("text/event-stream")) {
    let payload: unknown = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }

    const message =
      payload &&
      typeof payload === "object" &&
      typeof (payload as { message?: unknown }).message === "string" &&
      (payload as { message: string }).message
        ? (payload as { message: string }).message
        : `Generation failed (HTTP ${response.status}).`;

    throw new Error(message);
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("The server returned an empty stream. Try again.");
  }

  const decoder = new TextDecoder();
  let buffer = "";
  let finalPost: BlogPost | null = null;
  let streamError: Error | null = null;

  const handleFrame = (raw: string) => {
    let event = "message";
    const dataLines: string[] = [];

    raw.split("\n").forEach((line) => {
      if (line.startsWith("event:")) {
        event = line.slice(6).trim();
      } else if (line.startsWith("data:")) {
        dataLines.push(line.slice(5).trimStart());
      }
    });

    if (dataLines.length === 0) return;

    let data: unknown;
    try {
      data = JSON.parse(dataLines.join("\n"));
    } catch {
      return;
    }

    if (event === "meta") {
      options.onMeta(data as StreamMeta);
    } else if (
      event === "delta" &&
      typeof (data as { text?: unknown }).text === "string"
    ) {
      options.onDelta((data as { text: string }).text);
    } else if (event === "done") {
      finalPost = data as BlogPost;
    } else if (event === "revise") {
      options.onRevise?.({
        reason:
          typeof (data as { reason?: unknown }).reason === "string"
            ? (data as { reason: string }).reason
            : "style revision",
      });
    } else if (event === "error") {
      const message = (data as { message?: unknown }).message;
      streamError = new Error(
        typeof message === "string" && message
          ? message
          : "Generation failed on the server."
      );
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    let boundary = buffer.indexOf("\n\n");
    while (boundary !== -1) {
      handleFrame(buffer.slice(0, boundary));
      buffer = buffer.slice(boundary + 2);
      if (streamError) break;
      boundary = buffer.indexOf("\n\n");
    }

    if (streamError) break;
  }

  if (streamError) throw streamError;
  if (!finalPost) {
    throw new Error("The stream ended before the article was ready. Try again.");
  }

  return finalPost;
}
