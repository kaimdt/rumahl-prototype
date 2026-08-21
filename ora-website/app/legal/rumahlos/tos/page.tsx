import type { Metadata } from "next";
import { LegalDocument } from "@/components/legal/legal-document";
import { osTos } from "@/lib/legal/content/os-tos";

export const metadata: Metadata = {
  title: "Software Terms Agreement",
  description:
    "Legal terms governing the use of rumahl OS, provided under the MIT License — Software-Lizenzbedingungen für rumahl OS.",
};

export default function OsTosPage() {
  return (
    <LegalDocument
      de={osTos.de}
      en={osTos.en}
      defaultLang="en"
      categoryLabel="rumahlOS Policies · rumahlOS-Richtlinien"
    />
  );
}
