import type { Metadata } from "next";
import { LegalDocument } from "@/components/legal/legal-document";
import { storeTerms } from "@/lib/legal/content/store-terms";

export const metadata: Metadata = {
  title: "Store Terms of Service",
  description:
    "Terms of Service for the rumahl Store — purchases of digital content, withdrawal rights and DSA reporting.",
};

export default function StoreTermsPage() {
  return (
    <LegalDocument
      de={storeTerms.de}
      en={storeTerms.en}
      defaultLang="en"
      categoryLabel="rumahl Store Policies"
    />
  );
}
