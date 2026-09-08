import type { Metadata } from "next";
import { LegalDocument } from "@/components/legal/legal-document";
import { reviewGuidelines } from "@/lib/legal/content/review-guidelines";

export const metadata: Metadata = {
  title: "App Review Guidelines",
  description:
    "Requirements every App must meet before publication in the rumahl Store — safety, privacy, content and technical quality.",
};

export default function ReviewGuidelinesPage() {
  return (
    <LegalDocument
      de={reviewGuidelines.de}
      en={reviewGuidelines.en}
      defaultLang="en"
      categoryLabel="rumahl Store Policies"
    />
  );
}
