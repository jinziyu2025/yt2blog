import Link from "next/link";
import AffiliateBadge from "@/components/affiliate-badge";
import CopyrightDisclaimer from "@/components/copyright-disclaimer";

const LEGAL_LINKS = [
  { href: "/terms", label: "Terms of Service" },
  { href: "/privacy", label: "Privacy Policy" },
  { href: "/refund", label: "Refund Policy" },
  { href: "/cookies", label: "Cookie Policy" },
];

export default function SiteFooter() {
  return (
    <footer className="border-t border-line bg-[#060608]">
      <div className="mx-auto w-full max-w-3xl px-5 py-10 sm:px-8">
        <div className="flex flex-col gap-8 sm:flex-row sm:items-start sm:justify-between">
          <div className="max-w-xs">
            <Link
              href="/"
              className="inline-flex items-center gap-2.5 text-sm font-semibold tracking-tight text-ink"
            >
              <span className="grid h-7 w-7 place-items-center rounded-lg border border-line bg-surface text-accent">
                <svg viewBox="0 0 24 24" aria-hidden="true" className="h-3 w-3">
                  <path d="M8 5.5v13l10-6.5-10-6.5z" fill="currentColor" />
                </svg>
              </span>
              YT2Blog
            </Link>
            <p className="mt-3 text-[11.5px] leading-6 text-muted/70">
              Turn any YouTube video into an SEO-friendly blog draft in seconds.
              Built for creators, marketers and small teams.
            </p>
          </div>

          <div className="grid gap-8 sm:grid-cols-2">
            <div>
              <p className="text-[10px] uppercase tracking-[0.14em] text-muted/50">
                Legal
              </p>
              <ul className="mt-3 space-y-2">
                {LEGAL_LINKS.map((link) => (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      className="text-[12px] text-muted/80 transition hover:text-ink"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <p className="text-[10px] uppercase tracking-[0.14em] text-muted/50">
                Support
              </p>
              <ul className="mt-3 space-y-2 text-[12px] text-muted/80">
                <li>
                  <Link
                    href="/#pricing"
                    className="transition hover:text-ink"
                  >
                    Pricing
                  </Link>
                </li>
                <li>
                  <a
                    href="mailto:support@yt2blog.org"
                    className="transition hover:text-ink"
                  >
                    support@yt2blog.org
                  </a>
                </li>
              </ul>
            </div>
          </div>
        </div>

        <div className="mt-8 border-t border-line pt-6">
          <div className="flex flex-col gap-2 text-[10.5px] text-muted/50 sm:flex-row sm:items-center sm:justify-between">
            <p>© 2026 YT2Blog. All rights reserved.</p>
            <p className="font-mono">Payments processed by Paddle</p>
          </div>
          <div className="mt-1.5">
            <AffiliateBadge />
          </div>
          <CopyrightDisclaimer className="mt-3 max-w-2xl" />
        </div>
      </div>
    </footer>
  );
}
