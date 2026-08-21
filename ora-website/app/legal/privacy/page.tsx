import type { Metadata } from "next";
import { LegalDocument } from "@/components/legal/legal-document";
import { privacy } from "@/lib/legal/content/privacy";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description:
    "How rumahl collects, uses and protects your personal data in accordance with the GDPR — Datenschutzerklärung gemäß DSGVO.",
};

export default function PrivacyPage() {
  return (
    <LegalDocument
      de={privacy.de}
      en={privacy.en}
      defaultLang="en"
      categoryLabel="Website Policies · Website-Richtlinien"
    />
  );
}
