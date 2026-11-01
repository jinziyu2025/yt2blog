const DISCLAIMER_TEXT =
  "AI-generated summaries. Full text is processed locally in your browser and not stored on our servers. We only retain metadata for SEO. If you are a copyright owner and believe your rights have been infringed, please contact us at support@yt2blog.org and we will remove the metadata immediately under DMCA guidelines.";

export default function CopyrightDisclaimer({
  className = "",
}: {
  className?: string;
}) {
  return (
    <p className={`text-[10px] leading-4 text-muted/50 ${className}`.trim()}>
      {DISCLAIMER_TEXT}
    </p>
  );
}
