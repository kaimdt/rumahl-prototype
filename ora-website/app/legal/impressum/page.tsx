import type { Metadata } from "next";
import { LegalDocument } from "@/components/legal/legal-document";
import { impressum } from "@/lib/legal/content/impressum";

export const metadata: Metadata = {
  title: "Impressum",
  description:
    "Mandatory provider information for rumahl in accordance with § 5 DDG (German Digital Services Act) — Pflichtangaben gemäß § 5 DDG.",
};

export default function ImpressumPage() {
  return (
    <LegalDocument
      de={impressum.de}
      en={impressum.en}
      defaultLang="de"
      categoryLabel="Website Policies · Website-Richtlinien"
    />
  );
}
