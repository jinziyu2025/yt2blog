import type { Metadata } from "next";
import LegalPage from "@/components/legal-page";

export const metadata: Metadata = {
  title: "Cookie Policy — YT2Blog",
  description:
    "Which cookies and local storage YT2Blog uses, what they are for, and how you can control them.",
};

export default function CookiesPage() {
  return (
    <LegalPage
      title="Cookie Policy"
      updated="October 30, 2026"
      intro="This Cookie Policy explains how YT2Blog uses cookies and similar technologies such as localStorage. We keep our footprint minimal: no advertising cookies, no cross-site tracking."
      sections={[
        {
          heading: "What Are Cookies",
          paragraphs: [
            "Cookies are small text files stored on your device by a website. Similar technologies, such as localStorage, allow a website to remember information between visits. Both are used to keep features working correctly.",
          ],
        },
        {
          heading: "Cookies and Storage We Use",
          paragraphs: [
            "Functional storage — we use a single localStorage entry, “yt2blog:generations-used”, to count how many free blog drafts you have generated. It contains a number only, no personal identifiers, and is required for the free tier to work.",
            "Paddle checkout cookies — when you click “Pay with Credit Card”, our payment provider Paddle may set cookies on the checkout page. These are used to process your payment securely, prevent fraud and maintain your session. They are only set once you enter the checkout flow.",
            "We do not set analytics, advertising or social media cookies.",
          ],
        },
        {
          heading: "Third-Party Cookies",
          paragraphs: [
            "Paddle, acting as our Merchant of Record, is the only third party that may set cookies in connection with YT2Blog. Paddle’s own cookie and privacy notices govern those cookies and describe the retention periods it applies.",
          ],
        },
        {
          heading: "Managing Cookies and Local Storage",
          paragraphs: [
            "You can clear or block cookies and local storage through your browser settings. On most browsers this is found under Settings → Privacy and Security → Cookies and Site Data.",
            "If you clear the free-generation counter, the free allowance is restored on your device. We may treat repeated clearing combined with automated behaviour as abuse under our Terms of Service.",
            "Blocking cookies may prevent the Paddle checkout from completing, since the checkout requires a session cookie to process payments securely.",
          ],
        },
        {
          heading: "Do Not Track",
          paragraphs: [
            "We do not track users across third-party websites and therefore do not respond to browser “Do Not Track” signals. No personal data is sold or shared for advertising purposes.",
          ],
        },
        {
          heading: "Changes to This Policy",
          paragraphs: [
            "If we introduce new cookies or storage technologies we will update this page and, where required by law, request your consent before using them.",
          ],
        },
        {
          heading: "Contact",
          paragraphs: [
            "Questions about cookies can be sent to support@yt2blog.app. For details about Paddle’s cookies, see Paddle’s own cookie notice.",
          ],
        },
      ]}
    />
  );
}
