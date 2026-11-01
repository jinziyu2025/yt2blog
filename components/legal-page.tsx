import Link from "next/link";

export type LegalSection = {
  heading: string;
  paragraphs: string[];
};

type LegalPageProps = {
  title: string;
  intro: string;
  updated: string;
  sections: LegalSection[];
};

export default function LegalPage({
  title,
  intro,
  updated,
  sections,
}: LegalPageProps) {
  return (
    <main className="relative min-h-screen">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute left-1/2 top-[-260px] h-[420px] w-[760px] -translate-x-1/2 rounded-full bg-accent/5 blur-[130px]"
      />

      <div className="relative mx-auto w-full max-w-3xl px-5 pb-16 pt-8 sm:px-8">
        <header className="flex items-center justify-between">
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-[11.5px] text-muted transition hover:text-ink"
          >
            <svg
              viewBox="0 0 24 24"
              aria-hidden="true"
              className="h-3.5 w-3.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M19 12H5M11 18l-6-6 6-6" />
            </svg>
            Back to YT2Blog
          </Link>

          <span className="inline-flex items-center gap-2 rounded-full border border-line bg-surface/70 px-3 py-1 text-[10px] uppercase tracking-[0.16em] text-muted">
            Legal
          </span>
        </header>

        <section className="mt-12">
          <h1 className="text-balance text-3xl font-semibold leading-tight tracking-[-0.03em] text-ink sm:text-[38px]">
            {title}
          </h1>
          <p className="mt-3 font-mono text-[11px] text-muted/60">
            Last updated: {updated}
          </p>
          <p className="mt-6 max-w-2xl text-[14px] leading-7 text-muted">
            {intro}
          </p>
        </section>

        <div className="mt-10 space-y-9">
          {sections.map((section, index) => (
            <section key={section.heading}>
              <h2 className="flex items-baseline gap-3 text-[17px] font-semibold tracking-[-0.01em] text-ink">
                <span className="font-mono text-[10.5px] text-accent/70">
                  {String(index + 1).padStart(2, "0")}
                </span>
                {section.heading}
              </h2>
              <div className="mt-3 space-y-3 pl-0 sm:pl-7">
                {section.paragraphs.map((paragraph) => (
                  <p
                    key={paragraph}
                    className="text-[13.5px] leading-[1.85] text-[#B6B6C0]"
                  >
                    {paragraph}
                  </p>
                ))}
              </div>
            </section>
          ))}
        </div>

        <div className="mt-12 rounded-xl border border-line bg-surface/60 p-5">
          <p className="text-[10.5px] uppercase tracking-[0.14em] text-muted">
            Questions?
          </p>
          <p className="mt-2 text-[13px] leading-6 text-[#C8C8D0]">
            Contact us at{" "}
            <a
              href="mailto:support@yt2blog.org"
              className="text-ink underline decoration-line underline-offset-2 hover:text-accent"
            >
              support@yt2blog.org
            </a>{" "}
            and we will reply within two business days.
          </p>
        </div>
      </div>
    </main>
  );
}
