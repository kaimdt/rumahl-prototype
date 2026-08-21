import type { Metadata } from "next";
import { LegalDocument } from "@/components/legal/legal-document";
import { tos } from "@/lib/legal/content/tos";

export const metadata: Metadata = {
  title: "Terms of Service",
  description:
    "Terms of Service for the rumahl website — Nutzungsbedingungen für die rumahl-Website.",
};

export default function TosPage() {
  return (
    <LegalDocument
      de={tos.de}
      en={tos.en}
      defaultLang="en"
      categoryLabel="Website Policies · Website-Richtlinien"
    />
  );
}
