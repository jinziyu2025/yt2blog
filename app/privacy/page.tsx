import type { Metadata } from "next";
import LegalPage from "@/components/legal-page";

export const metadata: Metadata = {
  title: "Privacy Policy — YT2Blog",
  description:
    "How YT2Blog collects, uses and protects personal data, including cookies, third-party processors and your privacy rights.",
};

export default function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy Policy"
      updated="October 30, 2026"
      intro="This Privacy Policy explains what information YT2Blog collects, why we collect it, how long we keep it and the rights you have over your data. We keep the Service deliberately simple and collect as little personal data as possible."
      sections={[
        {
          heading: "Information We Collect",
          paragraphs: [
            "Usage data: when you generate a draft we process the YouTube URL you submit and the resulting article text. We do not require an account to use the free tier.",
            "Local storage: your free-generation counter is stored in your browser’s localStorage under the key “yt2blog:generations-used”. If you arrive through an affiliate link containing a ref code, that code is stored for up to 30 days under “yt2blog:affiliate-ref” so the referring partner can be credited. Both values stay on your device.",
            "Payment data: if you subscribe, our payment provider Paddle collects your name, email address, billing address and payment details. We never see or store your full card number.",
            "Technical logs: our hosting provider records standard server logs such as IP address, user agent, timestamps and error codes for security and troubleshooting.",
          ],
        },
        {
          heading: "How We Use Information",
          paragraphs: [
            "We use the information above to deliver generated drafts, enforce free-tier limits, process subscriptions, prevent abuse, debug failures and comply with legal obligations.",
            "We do not sell personal data, and we do not use your submitted URLs or generated output to train our own models or for behavioural advertising.",
          ],
        },
        {
          heading: "Cookies and Local Storage",
          paragraphs: [
            "YT2Blog itself sets no advertising or tracking cookies. We use localStorage to remember how many free generations you have used and, when you arrive through a partner link, the affiliate ref code for up to 30 days. Both entries are strictly functional and necessary to operate the free tier and attribution.",
            "Paddle may set cookies during checkout to process payments, prevent fraud and remember your session. Their use of cookies is governed by Paddle’s own privacy and cookie notices.",
            "See our Cookie Policy for details and for instructions on how to clear or block cookies and local storage.",
          ],
        },
        {
          heading: "Third-Party Processors",
          paragraphs: [
            "Supadata — retrieves publicly available YouTube transcripts after you submit a video link.",
            "DeepSeek — generates the blog draft from the retrieved transcript.",
            "Paddle — acts as Merchant of Record for payments, invoicing, tax handling and refunds.",
            "Render — hosts the application and processes requests on our behalf.",
            "Each processor is bound by contractual obligations to use data only for the purposes we specify and to apply appropriate security measures.",
          ],
        },
        {
          heading: "Legal Bases for Processing",
          paragraphs: [
            "If you are located in the European Economic Area or the United Kingdom, we rely on the following legal bases: performance of a contract (providing the Service you request), legitimate interests (security, fraud prevention and service improvement), and legal obligation (tax and accounting records).",
            "Where consent is required, such as for optional communications, you may withdraw it at any time.",
          ],
        },
        {
          heading: "Data Retention",
          paragraphs: [
            "Generated drafts are streamed to your browser and are not permanently stored on our servers. Server logs are retained for a short period for security and debugging, after which they are deleted or anonymised.",
            "Payment and billing records are retained by Paddle for as long as required by tax and accounting laws. The localStorage counter remains on your device until you clear your browser storage.",
          ],
        },
        {
          heading: "Your Rights",
          paragraphs: [
            "Depending on your jurisdiction you may have the right to access, correct, delete, restrict or object to the processing of your personal data, and to request a portable copy of it.",
            "To exercise any of these rights, contact support@yt2blog.org. For payment data, you may also contact Paddle directly. You have the right to lodge a complaint with your local data protection authority.",
          ],
        },
        {
          heading: "International Data Transfers",
          paragraphs: [
            "Our processors may store or process data outside your country, including in the United States. Where required, transfers are protected by appropriate safeguards such as standard contractual clauses.",
          ],
        },
        {
          heading: "Security",
          paragraphs: [
            "We use encryption in transit, restrict access to production systems and avoid storing sensitive data where it is not needed. No method of transmission or storage is completely secure, so we cannot guarantee absolute security.",
          ],
        },
        {
          heading: "Children’s Privacy",
          paragraphs: [
            "The Service is not directed at children under 16. We do not knowingly collect personal data from children. If you believe a child has provided us with personal data, contact us and we will delete it.",
          ],
        },
        {
          heading: "Changes to This Policy",
          paragraphs: [
            "We may update this Privacy Policy to reflect changes in our practices or legal requirements. The revised version will be posted on this page with an updated date. Material changes will be highlighted in the application.",
          ],
        },
        {
          heading: "Contact",
          paragraphs: [
            "For privacy questions or data requests, email support@yt2blog.org. We respond within two business days and within the statutory deadlines where applicable.",
          ],
        },
      ]}
    />
  );
}
