import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  FileText,
  Globe,
  HardDrive,
  Store,
  ShieldCheck,
  Mail,
  Scale,
} from "lucide-react";
import { Reveal } from "@/components/reveal";
import { Badge } from "@/components/ui/badge";
import { company } from "@/lib/legal/company";

export const metadata: Metadata = {
  title: "Legal",
  description:
    "All rumahl policies and terms in one place — Website Policies, rumahlOS Policies and rumahl Store Policies. Alle Richtlinien und rechtlichen Informationen von rumahl.",
};

interface LegalCard {
  href: string;
  titleEn: string;
  titleDe: string;
  descriptionEn: string;
  descriptionDe: string;
}

const categories: {
  key: string;
  labelEn: string;
  labelDe: string;
  icon: typeof FileText;
  cards: LegalCard[];
}[] = [
  {
    key: "website",
    labelEn: "Website Policies",
    labelDe: "Website-Richtlinien",
    icon: Globe,
    cards: [
      {
        href: "/legal/impressum",
        titleEn: "Imprint (Impressum)",
        titleDe: "Impressum",
        descriptionEn:
          "Mandatory provider information in accordance with § 5 DDG — contact, legal form and liability notes.",
        descriptionDe:
          "Pflichtangaben gemäß § 5 DDG — Anbieter, Kontakt und Haftungshinweise.",
      },
      {
        href: "/legal/tos",
        titleEn: "Terms of Service",
        titleDe: "Nutzungsbedingungen",
        descriptionEn:
          "Your rights and responsibilities when using our website.",
        descriptionDe:
          "Deine Rechte und Pflichten bei der Nutzung unserer Website.",
      },
      {
        href: "/legal/privacy",
        titleEn: "Privacy Policy",
        titleDe: "Datenschutzerklärung",
        descriptionEn:
          "How we collect, use and protect your personal data — GDPR-compliant.",
        descriptionDe:
          "Wie wir deine personenbezogenen Daten verarbeiten — DSGVO-konform.",
      },
      {
        href: "/legal/cookies",
        titleEn: "Cookie Policy",
        titleDe: "Cookie-Richtlinie",
        descriptionEn:
          "Which cookies and local storage the website uses and how you control them.",
        descriptionDe:
          "Welche Cookies und lokalen Speicherungen die Website nutzt und wie du sie steuerst.",
      },
    ],
  },
  {
    key: "os",
    labelEn: "rumahlOS Policies",
    labelDe: "rumahlOS-Richtlinien",
    icon: HardDrive,
    cards: [
      {
        href: "/legal/rumahlos/tos",
        titleEn: "Software Terms Agreement",
        titleDe: "Software-Lizenzbedingungen",
        descriptionEn:
          "The legal terms governing your use of the rumahl OS operating system (MIT License).",
        descriptionDe:
          "Die rechtlichen Bedingungen für die Nutzung des Betriebssystems rumahl OS (MIT-Lizenz).",
      },
      {
        href: "/legal/rumahlos/privacy",
        titleEn: "Privacy Policy",
        titleDe: "Datenschutzerklärung",
        descriptionEn:
          "Local-first by design: what stays on your device and what is transmitted.",
        descriptionDe:
          "Local-First-Prinzip: Was auf deinem Gerät bleibt und was übertragen wird.",
      },
    ],
  },
  {
    key: "store",
    labelEn: "rumahl Store Policies",
    labelDe: "rumahl Store-Richtlinien",
    icon: Store,
    cards: [
      {
        href: "/legal/app-store/terms",
        titleEn: "Store Terms of Service",
        titleDe: "Store-Nutzungsbedingungen",
        descriptionEn:
          "Terms for using the rumahl Store — including digital content purchases, withdrawal rights and DSA reporting.",
        descriptionDe:
          "Bedingungen für den rumahl Store — inklusive Kauf digitaler Inhalte, Widerruf und DSA-Meldungen.",
      },
      {
        href: "/legal/app-store/developer-agreement",
        titleEn: "Developer Agreement",
        titleDe: "Entwicklervereinbarung",
        descriptionEn:
          "The agreement for developers publishing Apps in the rumahl Store.",
        descriptionDe:
          "Die Vereinbarung für Entwickler, die Apps im rumahl Store veröffentlichen.",
      },
      {
        href: "/legal/app-store/review-guidelines",
        titleEn: "App Review Guidelines",
        titleDe: "App-Review-Richtlinien",
        descriptionEn:
          "Safety, privacy, content and technical requirements every App must meet.",
        descriptionDe:
          "Sicherheits-, Datenschutz-, Inhalts- und Qualitätsanforderungen für jede App.",
      },
      {
        href: "/legal/app-store/content-policy",
        titleEn: "App Content Policy",
        titleDe: "App-Inhaltsrichtlinie",
        descriptionEn:
          "Prohibited content, reporting of violations and enforcement (DSA).",
        descriptionDe:
          "Verbotene Inhalte, Meldewege und Durchsetzung (DSA).",
      },
      {
        href: "/legal/app-store/privacy-requirements",
        titleEn: "App Privacy Requirements",
        titleDe: "App-Datenschutzanforderungen",
        descriptionEn:
          "Mandatory GDPR obligations for Apps and their developers.",
        descriptionDe:
          "Verbindliche DSGVO-Pflichten für Apps und ihre Entwickler.",
      },
    ],
  },
];

function CategoryCard({
  category,
  index,
}: {
  category: (typeof categories)[number];
  index: number;
}) {
  return (
    <Reveal delay={index * 100}>
      <div className="rounded-2xl border border-border/60 bg-card/60 p-6 sm:p-8">
        <div className="flex items-center gap-3 mb-6">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-primary/15 to-primary/5 text-primary">
            <category.icon className="h-5 w-5" strokeWidth={1.8} />
          </div>
          <div>
            <h2 className="text-lg font-bold text-foreground leading-tight">
              {category.labelEn}
            </h2>
            <p className="text-xs text-muted-foreground">{category.labelDe}</p>
          </div>
        </div>

        <div className="grid sm:grid-cols-2 gap-3">
          {category.cards.map((card) => (
            <Link
              key={card.href}
              href={card.href}
              className="surface-card-interactive group p-4 flex flex-col"
            >
              <div className="flex items-start justify-between gap-2 mb-2">
                <h3 className="text-sm font-semibold text-foreground leading-snug">
                  {card.titleEn}
                  <span className="block text-[11px] font-medium text-muted-foreground mt-0.5">
                    {card.titleDe}
                  </span>
                </h3>
                <ArrowRight className="h-3.5 w-3.5 text-primary shrink-0 mt-1 opacity-0 group-hover:opacity-100 group-hover:translate-x-0.5 transition-all" />
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">
                {card.descriptionEn}
              </p>
              <p className="text-[11px] text-muted-foreground/70 leading-relaxed mt-1.5">
                {card.descriptionDe}
              </p>
            </Link>
          ))}
        </div>
      </div>
    </Reveal>
  );
}

export default function LegalPage() {
  return (
    <>
      {/* ─────────── Hero ─────────── */}
      <section className="relative overflow-hidden pt-24 pb-16 lg:pt-32 lg:pb-20">
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              "radial-gradient(ellipse 55% 45% at 50% -10%, hsl(var(--primary) / 0.08), transparent 65%)",
          }}
        />
        <div className="mx-auto max-w-6xl px-6 lg:px-10 relative text-center">
          <Reveal>
            <Badge variant="accent" className="mb-5">
              <Scale className="h-3 w-3 mr-1.5" />
              Legal · Rechtliches
            </Badge>
            <h1 className="text-4xl sm:text-5xl font-bold tracking-tight text-foreground mb-4">
              Legal <span className="gradient-text">Policies</span>
            </h1>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto leading-relaxed">
              Find all the information you need about our policies and terms in
              one convenient location.
              <span className="block mt-1 text-sm text-muted-foreground/70">
                Alle Richtlinien und rechtlichen Informationen von rumahl an
                einem Ort.
              </span>
            </p>
          </Reveal>
        </div>
      </section>

      {/* ─────────── Categories ─────────── */}
      <section className="pb-16 lg:pb-20">
        <div className="mx-auto max-w-6xl px-6 lg:px-10 space-y-6">
          {categories.map((category, i) => (
            <CategoryCard key={category.key} category={category} index={i} />
          ))}
        </div>
      </section>

      {/* ─────────── Compliance note ─────────── */}
      <section className="pb-16">
        <div className="mx-auto max-w-6xl px-6 lg:px-10">
          <Reveal>
            <div className="rounded-2xl border border-primary/20 bg-primary/5 p-6 sm:p-8 flex flex-col sm:flex-row gap-5 items-start sm:items-center">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <ShieldCheck className="h-5 w-5" strokeWidth={1.8} />
              </div>
              <div className="flex-1">
                <h2 className="text-base font-bold text-foreground mb-1">
                  EU & German law compliance
                </h2>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  Our policies follow the General Data Protection Regulation
                  (GDPR), the Digital Services Act (DSA), the German Digital
                  Services Act (DDG) and German civil law (BGB). Every document
                  is available in English and German.
                  <span className="block mt-1 text-xs text-muted-foreground/70">
                    Unsere Richtlinien folgen der DSGVO, dem Digital Services
                    Act, dem DDG und dem BGB. Jedes Dokument ist auf Deutsch
                    und Englisch verfügbar.
                  </span>
                </p>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ─────────── Contact ─────────── */}
      <section className="pb-24 lg:pb-32">
        <div className="mx-auto max-w-2xl px-6 lg:px-10 text-center">
          <Reveal>
            <FileText className="mx-auto h-8 w-8 text-primary" strokeWidth={1.8} />
            <h2 className="mt-5 text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
              Questions?
            </h2>
            <p className="mt-3 text-sm text-muted-foreground leading-relaxed">
              If you have any questions or concerns, please don&apos;t hesitate
              to contact us.
              <span className="block mt-1 text-xs text-muted-foreground/70">
                Bei Fragen oder Anliegen kontaktiere uns gerne.
              </span>
            </p>
            <div className="mt-6 inline-flex items-center gap-2 rounded-full border border-border/60 bg-card px-5 py-2.5">
              <Mail className="h-4 w-4 text-primary" />
              <a
                href={`mailto:${company.email}`}
                className="text-sm font-medium text-foreground hover:text-primary transition-colors"
              >
                {company.email}
              </a>
            </div>
          </Reveal>
        </div>
      </section>
    </>
  );
}
