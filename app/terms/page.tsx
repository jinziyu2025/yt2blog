import type { Metadata } from "next";
import LegalPage from "@/components/legal-page";

export const metadata: Metadata = {
  title: "Terms of Service — YT2Blog",
  description:
    "The terms that govern your use of YT2Blog, including free usage limits, subscriptions and acceptable use.",
};

export default function TermsPage() {
  return (
    <LegalPage
      title="Terms of Service"
      updated="October 30, 2026"
      intro="These Terms of Service (“Terms”) govern your access to and use of YT2Blog (“the Service”, “we”, “us”). By using the Service you agree to be bound by these Terms. If you do not agree, please do not use the Service."
      sections={[
        {
          heading: "Acceptance of Terms",
          paragraphs: [
            "By accessing or using YT2Blog you confirm that you have read, understood and accepted these Terms. If you are using the Service on behalf of a company or other legal entity, you represent that you have authority to bind that entity to these Terms.",
            "We may update these Terms from time to time. Material changes will be announced on this page with a new “Last updated” date. Continued use of the Service after changes take effect constitutes acceptance of the revised Terms.",
          ],
        },
        {
          heading: "Description of the Service",
          paragraphs: [
            "YT2Blog converts publicly available YouTube videos into structured, SEO-friendly blog drafts. You provide a YouTube URL, we retrieve the video transcript and use third-party AI models to generate a title, slug, meta description, headings and body copy.",
            "The Service produces AI-assisted drafts for editorial use. Output is not guaranteed to be accurate, complete or suitable for any particular purpose, and you are responsible for reviewing and editing it before publishing.",
          ],
        },
        {
          heading: "Eligibility and Accounts",
          paragraphs: [
            "You must be at least 16 years old, or the age of digital consent in your jurisdiction, to use the Service. You are responsible for keeping your credentials confidential and for all activity that occurs under your account.",
            "We reserve the right to refuse service, suspend accounts or cancel subscriptions where we reasonably believe these Terms have been violated.",
          ],
        },
        {
          heading: "Free Tier and Paid Subscription",
          paragraphs: [
            "New users may generate up to two (2) blog drafts free of charge. This allowance is tracked in the browser and may not be circumvented through automated, scripted or repeated account creation.",
            "The paid plan is offered at USD $9.9 per month (the “Subscription”). The Subscription renews automatically every month until cancelled. Local taxes may apply and are calculated at checkout by our payment provider.",
            "Payments are processed by Paddle as our Merchant of Record. Paddle handles payment collection, invoicing, tax compliance and refunds on our behalf. By subscribing you also agree to Paddle’s buyer terms.",
            "You may cancel at any time from the billing portal or by contacting support. Cancellation stops future renewals; access continues until the end of the current billing period unless a refund is granted under our Refund Policy.",
          ],
        },
        {
          heading: "Acceptable Use",
          paragraphs: [
            "You agree not to use the Service to infringe copyright, to generate spam, hateful, misleading or unlawful content, to reverse engineer the Service, to exceed reasonable rate limits, or to resell the Service without written permission.",
            "We may suspend access immediately if your use threatens the security, stability or integrity of the Service or the rights of third parties.",
          ],
        },
        {
          heading: "User Content and Generated Output",
          paragraphs: [
            "You retain all rights you hold in the material you submit, such as the YouTube URL and any instructions you provide. You grant us a limited licence to process that material solely to operate and improve the Service.",
            "Subject to payment of applicable fees and compliance with these Terms, you own the generated drafts and may use them for commercial purposes. Because AI output may resemble content generated for other users, we cannot guarantee that outputs are unique.",
          ],
        },
        {
          heading: "Intellectual Property",
          paragraphs: [
            "The Service itself, including its software, design, branding and documentation, remains our property or that of our licensors. These Terms do not transfer any ownership rights in the Service to you.",
            "You may not copy, modify, distribute or create derivative works of the Service except as expressly permitted in writing.",
          ],
        },
        {
          heading: "Third-Party Services",
          paragraphs: [
            "The Service relies on third parties including YouTube, transcript providers, AI model providers, cloud hosting and Paddle for payments. Availability and behaviour of these services are outside our control.",
            "Your use of YouTube content must comply with YouTube’s Terms of Service. You are responsible for ensuring you have the rights needed to reproduce or republish any material you process.",
          ],
        },
        {
          heading: "Disclaimers",
          paragraphs: [
            "The Service is provided on an “as is” and “as available” basis without warranties of any kind, whether express or implied, including fitness for a particular purpose, accuracy or non-infringement. We do not warrant uninterrupted or error-free operation.",
          ],
        },
        {
          heading: "Limitation of Liability",
          paragraphs: [
            "To the maximum extent permitted by law, we shall not be liable for any indirect, incidental, special, consequential or punitive damages, or for lost profits, revenue, data or goodwill arising from your use of the Service.",
            "Our total aggregate liability for any claim relating to the Service shall not exceed the greater of the amount you paid us in the three months preceding the claim or USD $20.",
          ],
        },
        {
          heading: "Indemnification",
          paragraphs: [
            "You agree to indemnify and hold harmless YT2Blog, its officers, employees and partners from any claim or demand arising out of your content, your use of the Service, or your breach of these Terms.",
          ],
        },
        {
          heading: "Termination",
          paragraphs: [
            "Either party may terminate this agreement at any time. We may suspend or terminate your access immediately for material breach, non-payment, fraud or abuse. On termination, your right to use the Service ceases, while obligations that by nature survive termination remain in effect.",
          ],
        },
        {
          heading: "Governing Law",
          paragraphs: [
            "These Terms are governed by the laws of the jurisdiction in which YT2Blog is established, without regard to conflict-of-law rules. Mandatory consumer protections in your country of residence remain unaffected.",
          ],
        },
        {
          heading: "Contact",
          paragraphs: [
            "Questions about these Terms can be sent to support@yt2blog.org. We aim to respond within two business days.",
          ],
        },
      ]}
    />
  );
}
