import type { Metadata } from "next";
import { LegalDocument } from "@/components/legal/legal-document";
import { cookies } from "@/lib/legal/content/cookies";

export const metadata: Metadata = {
  title: "Cookie Policy",
  description:
    "Which cookies and local storage the rumahl website uses — Cookie-Richtlinie der rumahl-Website.",
};

export default function CookiePage() {
  return (
    <LegalDocument
      de={cookies.de}
      en={cookies.en}
      defaultLang="en"
      categoryLabel="Website Policies · Website-Richtlinien"
    />
  );
}
