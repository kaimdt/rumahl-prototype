import type { Metadata } from "next";
import { LegalDocument } from "@/components/legal/legal-document";
import { contentPolicy } from "@/lib/legal/content/content-policy";

export const metadata: Metadata = {
  title: "App Content Policy",
  description:
    "Prohibited and regulated content in the rumahl Store, reporting of violations and enforcement (DSA).",
};

export default function ContentPolicyPage() {
  return (
    <LegalDocument
      de={contentPolicy.de}
      en={contentPolicy.en}
      defaultLang="en"
      categoryLabel="rumahl Store Policies"
    />
  );
}
