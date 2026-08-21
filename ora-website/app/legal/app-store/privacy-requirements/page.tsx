import type { Metadata } from "next";
import { LegalDocument } from "@/components/legal/legal-document";
import { storePrivacy } from "@/lib/legal/content/store-privacy";

export const metadata: Metadata = {
  title: "App Privacy Requirements",
  description:
    "Mandatory privacy and GDPR obligations for developers publishing Apps in the rumahl Store.",
};

export default function StorePrivacyPage() {
  return (
    <LegalDocument
      de={storePrivacy.de}
      en={storePrivacy.en}
      defaultLang="en"
      categoryLabel="rumahl Store Policies"
    />
  );
}
