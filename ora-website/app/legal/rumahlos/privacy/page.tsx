import type { Metadata } from "next";
import { LegalDocument } from "@/components/legal/legal-document";
import { osPrivacy } from "@/lib/legal/content/os-privacy";

export const metadata: Metadata = {
  title: "rumahl OS Privacy Policy",
  description:
    "How rumahl OS handles your data — local-first, GDPR-compliant. Datenschutzerklärung für rumahl OS.",
};

export default function OsPrivacyPage() {
  return (
    <LegalDocument
      de={osPrivacy.de}
      en={osPrivacy.en}
      defaultLang="en"
      categoryLabel="rumahlOS Policies · rumahlOS-Richtlinien"
    />
  );
}
