import type { Metadata } from "next";
import type { ReactNode } from "react";
import AffiliateTracker from "@/components/affiliate-tracker";
import SiteFooter from "@/components/site-footer";
import { SITE_URL } from "@/lib/site";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: "YT2Blog - Turn YouTube Videos into SEO-Friendly Blogs in Seconds.",
  description:
    "Tired of tools with 30-min limits? Use our AI to generate human-like, SEO-friendly blog posts from any YouTube video or podcast. Try 2 for free!",
  applicationName: "YT2Blog",
  verification: {
    google: "z5ojO7htlnCIzosrH3Au6UmsXbOqnQovaiP1p_MBjDQ",
  },
  // Relative canonical: Next resolves "./" against metadataBase using the
  // current route, so every page emits its own absolute canonical URL.
  alternates: {
    canonical: "./",
  },
  keywords: [
    "YouTube to blog",
    "video to article",
    "YouTube video to blog post",
    "AI blog generator",
    "SEO content generator",
    "podcast to blog",
    "creator tools",
  ],
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
  openGraph: {
    title: "YT2Blog - Turn YouTube Videos into SEO-Friendly Blogs in Seconds.",
    description:
      "Tired of tools with 30-min limits? Generate human-like, SEO-friendly blog posts from any YouTube video or podcast. Try 2 for free!",
    url: SITE_URL,
    siteName: "YT2Blog",
    type: "website",
    locale: "en_US",
  },
  twitter: {
    card: "summary",
    title: "YT2Blog - Turn YouTube Videos into SEO-Friendly Blogs in Seconds.",
    description:
      "Generate human-like, SEO-friendly blog posts from any YouTube video or podcast. Try 2 for free!",
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
      <body className="bg-canvas font-sans text-ink antialiased">
        <AffiliateTracker />
        <div className="flex min-h-screen flex-col">
          <div className="flex-1">{children}</div>
          <SiteFooter />
        </div>
      </body>
    </html>
  );
}
