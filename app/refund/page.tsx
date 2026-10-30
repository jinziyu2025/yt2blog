import type { Metadata } from "next";
import LegalPage from "@/components/legal-page";

export const metadata: Metadata = {
  title: "Refund Policy — YT2Blog",
  description:
    "YT2Blog offers a 7-day money-back guarantee. Learn how to request a refund and how long it takes to process.",
};

export default function RefundPage() {
  return (
    <LegalPage
      title="Refund Policy"
      updated="October 30, 2026"
      intro="We want you to subscribe only if YT2Blog genuinely helps your workflow. That is why every new subscription is covered by a 7-day money-back guarantee, no questions asked."
      sections={[
        {
          heading: "7-Day Money-Back Guarantee",
          paragraphs: [
            "You may request a full refund within seven (7) calendar days of your initial purchase for any reason. No justification is required — if the Service is not what you expected, simply ask for your money back.",
            "The guarantee applies to the first payment of a new subscription. Renewal payments are refundable only where required by applicable law or where the Service was unavailable for a significant part of the billing period through our fault.",
          ],
        },
        {
          heading: "Eligibility",
          paragraphs: [
            "To qualify, your request must be submitted within the 7-day window from the date of purchase, using the email address used at checkout or another verifiable method of identifying the transaction.",
            "Refunds cover the amount actually charged for the subscription, including any taxes collected. Bank or currency conversion fees charged by your card issuer are outside our control and cannot be reimbursed.",
          ],
        },
        {
          heading: "How to Request a Refund",
          paragraphs: [
            "Email support@yt2blog.app with the subject line “Refund request”, and include the email address used at checkout and the approximate purchase date.",
            "Alternatively, you can contact Paddle, our Merchant of Record, directly through the link in your purchase receipt. Paddle processes refunds on our behalf.",
            "We do not request passwords or sensitive payment details. Never send full card numbers by email.",
          ],
        },
        {
          heading: "Processing Time",
          paragraphs: [
            "Approved refunds are issued to the original payment method within 5–10 business days. Depending on your bank, the funds may take additional days to appear on your statement.",
            "You will receive a confirmation email from Paddle once the refund has been issued.",
          ],
        },
        {
          heading: "Cancellation",
          paragraphs: [
            "You may cancel your subscription at any time from the billing portal linked in your receipt, or by emailing support. Cancellation stops future renewal charges.",
            "After cancellation your access remains active until the end of the current billing period, unless a refund has been approved and access is revoked earlier.",
          ],
        },
        {
          heading: "Exceptions",
          paragraphs: [
            "We may decline a refund where we have reasonable evidence of abuse, such as repeated refund requests across multiple accounts, fraudulent payment methods, or deliberate resale of the Service.",
            "Nothing in this policy limits rights you may have under mandatory consumer protection laws in your country of residence.",
          ],
        },
        {
          heading: "Chargebacks",
          paragraphs: [
            "Please contact us before filing a chargeback with your card issuer. Most issues can be resolved quickly by email, and a chargeback may result in suspension of your access while the dispute is investigated.",
          ],
        },
        {
          heading: "Contact",
          paragraphs: [
            "Refund questions can be sent to support@yt2blog.app. We reply within two business days, and refund requests inside the 7-day window are prioritised.",
          ],
        },
      ]}
    />
  );
}
