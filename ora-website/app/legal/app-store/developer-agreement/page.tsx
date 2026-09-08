import type { Metadata } from "next";
import { LegalDocument } from "@/components/legal/legal-document";
import { developerAgreement } from "@/lib/legal/content/developer-agreement";

export const metadata: Metadata = {
  title: "Developer Agreement",
  description:
    "The agreement between developers and rumahl for publishing Apps in the rumahl Store.",
};

export default function DeveloperAgreementPage() {
  return (
    <LegalDocument
      de={developerAgreement.de}
      en={developerAgreement.en}
      defaultLang="en"
      categoryLabel="rumahl Store Policies"
    />
  );
}
