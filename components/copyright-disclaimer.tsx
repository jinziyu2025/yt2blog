const DISCLAIMER_TEXT =
  "Disclaimer: YT2Blog is an AI-powered content transformation tool. We do not host, store, or claim ownership of any videos or transcripts. Users are solely responsible for ensuring they have the legal right or permission to process any YouTube videos. Any copyright disputes arising from the generated content are the sole responsibility of the user.";

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
