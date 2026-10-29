import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "YT2Blog — Turn YouTube videos into SEO-friendly blog posts",
  description:
    "Paste a YouTube link and get a structured, SEO-friendly blog draft in seconds: title, slug, meta description, headings and body copy, ready to edit.",
  applicationName: "YT2Blog",
  keywords: [
    "YouTube to blog",
    "video to article",
    "SEO content generator",
    "creator tools",
  ],
  openGraph: {
    title: "YT2Blog — Turn YouTube videos into SEO-friendly blog posts",
    description:
      "Paste a YouTube link and get a structured, SEO-friendly blog draft in seconds.",
    type: "website",
  },
  icons: {
    icon: [
      {
        url:
          "data:image/svg+xml," +
          encodeURIComponent(
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#0F0F12"/><path d="M12 9v14l11-7-11-7z" fill="#D7FF3E"/></svg>'
          ),
        type: "image/svg+xml",
      },
    ],
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-canvas font-sans text-ink antialiased">{children}</body>
    </html>
  );
}
