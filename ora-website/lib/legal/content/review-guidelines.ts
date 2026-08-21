import type { BilingualDoc } from "@/lib/legal/types";
import { company } from "@/lib/legal/company";

/**
 * App Review Guidelines — requirements every App must meet before it is
 * published in the rumahl Store (safety, privacy, content, technical quality).
 */
export const reviewGuidelines: BilingualDoc = {
  de: {
    title: "App-Review-Richtlinien (rumahl Store)",
    subtitle:
      "Die Anforderungen, die jede App erfüllen muss, bevor sie im rumahl Store veröffentlicht wird — für Sicherheit, Datenschutz, Inhalte und technische Qualität.",
    effective: "2026-08-20",
    updated: "2026-08-20",
    version: "1.0",
    sections: [
      {
        id: "grundsaetze",
        title: "Überblick und Grundsätze",
        blocks: [
          {
            type: "p",
            text: "Der rumahl Store verfolgt drei Grundsätze: Sicherheit, Datenschutz und Qualität. Jede App wird vor der Veröffentlichung geprüft. Diese Richtlinien gelten für alle Apps, Updates und In-App-Inhalte. Sie ergänzen die App-Inhaltsrichtlinie und die App-Datenschutzanforderungen.",
          },
          {
            type: "ul",
            items: [
              "Sicherheit: Apps dürfen Nutzer, Geräte oder das System nicht gefährden.",
              "Datenschutz: Apps müssen die DSGVO und die Datenschutzanforderungen des Stores einhalten.",
              "Qualität: Apps müssen stabil, performant und sinnvoll dokumentiert sein.",
            ],
          },
        ],
      },
      {
        id: "sicherheit",
        title: "Sicherheit und Schutz",
        blocks: [
          {
            type: "ul",
            items: [
              "Keine Malware, Viren, Trojaner, Spyware oder sonstige schädliche Funktionalität;",
              "Keine Hintertüren, Remote-Control-Funktionen ohne ausdrückliche und transparente Offenlegung;",
              "Keine Umgehung von Sicherheitsmechanismen von rumahl OS oder des Stores;",
              "Einhaltung der Sandbox- und Ressourcenlimits von rumahl OS (CPU, RAM, Speicher, Netzwerk);",
              "Sichere Speicherung von Zugangsdaten und Schlüsseln (keine Klartext-Geheimnisse in der App oder in Logs);",
              "Kommunikation über sichere Protokolle (TLS) bei der Übertragung sensibler Daten;",
              "Keine versteckten oder nicht dokumentierten Funktionen, die dem Nutzer Nachteile bringen.",
            ],
          },
        ],
      },
      {
        id: "datenschutz",
        title: "Datenschutz",
        blocks: [
          {
            type: "ul",
            items: [
              "Einholung aller erforderlichen Einwilligungen vor der Erhebung personenbezogener Daten;",
              "Datenminimierung: Erhebe nur Daten, die für die Funktion der App erforderlich sind;",
              "Berechtigungen nur im notwendigen Umfang und mit verständlicher Begründung anfordern;",
              "Offenlegung aller Datenverarbeitungen in einer Datenschutzerklärung und im Store (Datenangaben);",
              "Keine Weitergabe von Daten an Dritte ohne Rechtsgrundlage;",
              "Bereitstellung von Funktionen zum Löschen von Konten und Daten, soweit die App Konten nutzt;",
              "Einhaltung der App-Datenschutzanforderungen des Stores.",
            ],
          },
        ],
      },
      {
        id: "inhalte",
        title: "Inhalte",
        blocks: [
          {
            type: "ul",
            items: [
              "Apps müssen der App-Inhaltsrichtlinie und allen geltenden Gesetzen entsprechen;",
              "Alterskennzeichnung: Apps mit jugendgefährdenden Inhalten müssen eine Altersbeschränkung angeben;",
              "Werbung muss klar als solche erkennbar und von App-Inhalten unterscheidbar sein;",
              "Keine irreführenden Beschreibungen, Screenshots oder Preise;",
              "Open-Source-Komponenten müssen lizenzkonform eingebunden werden.",
            ],
          },
        ],
      },
      {
        id: "technik",
        title: "Technische Qualität",
        blocks: [
          {
            type: "ul",
            items: [
              "Die App muss auf den unterstützten rumahl-OS-Versionen stabil laufen;",
              "Keine Abstürze, Hänger oder übermäßigen Ressourcenverbrauch;",
              "Sauberes Starten, Stoppen und Neustarten; kein Datenverlust bei Updates;",
              "Updates und Sicherheitspatches müssen zeitnah bereitgestellt werden;",
              "Die App muss in der Lage sein, Konfigurationen zu exportieren/importieren, soweit dies für die Funktion sinnvoll ist;",
              "Backup-Kompatibilität mit den Backup-Mechanismen von rumahl OS, soweit die App lokale Daten speichert.",
            ],
          },
        ],
      },
      {
        id: "design",
        title: "Design und Nutzererfahrung",
        blocks: [
          {
            type: "ul",
            items: [
              "Konsistente Nutzung der rumahl-OS-Designsprache und des Widget-Systems;",
              "Verständliche, fehlerfreie Texte in der eingestellten Sprache;",
              "Barrierefreiheit: Bedienbarkeit per Tastatur, ausreichende Kontraste, Screenreader-Unterstützung;",
              "Sinnvolle Fehlermeldungen und Hilfetexte.",
            ],
          },
        ],
      },
      {
        id: "prozess",
        title: "Review-Prozess",
        blocks: [
          {
            type: "p",
            text: "Einreichungen werden in der Reihenfolge ihres Eingangs geprüft. Die reguläre Bearbeitungszeit beträgt [X] Werktage; Sicherheitskritische Änderungen können priorisiert werden. Ablehnungen werden mit Begründung mitgeteilt. Gegen eine Ablehnung kannst du innerhalb von 14 Tagen Einspruch über das Entwickler-Dashboard einlegen.",
          },
          {
            type: "p",
            text: "Updates werden erneut geprüft, wenn sie wesentliche Funktionalität, Berechtigungen oder Datenverarbeitungen ändern. Kleinere Fehlerbehebungen können beschleunigt freigegeben werden.",
          },
        ],
      },
      {
        id: "kontakt",
        title: "Kontakt",
        blocks: [
          {
            type: "p",
            text: "Fragen zu den Review-Richtlinien: " + company.email + ".",
          },
        ],
      },
    ],
  },
  en: {
    title: "App Review Guidelines (rumahl Store)",
    subtitle:
      "The requirements every App must meet before it is published in the rumahl Store — covering safety, privacy, content and technical quality.",
    effective: "2026-08-20",
    updated: "2026-08-20",
    version: "1.0",
    sections: [
      {
        id: "principles",
        title: "Overview and principles",
        blocks: [
          {
            type: "p",
            text: "The rumahl Store follows three principles: safety, privacy and quality. Every App is reviewed before publication. These guidelines apply to all Apps, updates and in-app content. They complement the App Content Policy and the App Privacy Requirements.",
          },
          {
            type: "ul",
            items: [
              "Safety: Apps must not endanger users, devices or the system.",
              "Privacy: Apps must comply with the GDPR and the Store's Privacy Requirements.",
              "Quality: Apps must be stable, performant and properly documented.",
            ],
          },
        ],
      },
      {
        id: "safety",
        title: "Safety and security",
        blocks: [
          {
            type: "ul",
            items: [
              "No malware, viruses, trojans, spyware or other harmful functionality;",
              "No backdoors or remote-control features without explicit and transparent disclosure;",
              "No circumvention of security mechanisms of rumahl OS or the Store;",
              "Compliance with the sandbox and resource limits of rumahl OS (CPU, RAM, storage, network);",
              "Secure storage of credentials and keys (no plaintext secrets in the App or in logs);",
              "Secure communication protocols (TLS) when transmitting sensitive data;",
              "No hidden or undocumented features that disadvantage the user.",
            ],
          },
        ],
      },
      {
        id: "privacy",
        title: "Privacy",
        blocks: [
          {
            type: "ul",
            items: [
              "Obtain all required consents before collecting personal data;",
              "Data minimization: collect only data required for the App's functionality;",
              "Request permissions only to the necessary extent and with an understandable explanation;",
              "Disclose all data processing in a privacy policy and in the Store (data disclosures);",
              "No sharing of data with third parties without a legal basis;",
              "Provide account and data deletion functionality where the App uses accounts;",
              "Comply with the App Privacy Requirements of the Store.",
            ],
          },
        ],
      },
      {
        id: "content",
        title: "Content",
        blocks: [
          {
            type: "ul",
            items: [
              "Apps must comply with the App Content Policy and all applicable laws;",
              "Age rating: Apps with content harmful to minors must state an age restriction;",
              "Advertising must be clearly identifiable as such and distinguishable from App content;",
              "No misleading descriptions, screenshots or prices;",
              "Open-source components must be incorporated in a license-compliant manner.",
            ],
          },
        ],
      },
      {
        id: "technical",
        title: "Technical quality",
        blocks: [
          {
            type: "ul",
            items: [
              "The App must run stably on the supported rumahl OS versions;",
              "No crashes, freezes or excessive resource consumption;",
              "Clean start, stop and restart; no data loss on updates;",
              "Updates and security patches must be provided in a timely manner;",
              "The App must be able to export/import configuration where this makes sense for its functionality;",
              "Backup compatibility with the backup mechanisms of rumahl OS where the App stores local data.",
            ],
          },
        ],
      },
      {
        id: "design",
        title: "Design and user experience",
        blocks: [
          {
            type: "ul",
            items: [
              "Consistent use of the rumahl OS design language and widget system;",
              "Understandable, error-free texts in the configured language;",
              "Accessibility: keyboard operability, sufficient contrast, screen reader support;",
              "Meaningful error messages and help texts.",
            ],
          },
        ],
      },
      {
        id: "process",
        title: "Review process",
        blocks: [
          {
            type: "p",
            text: "Submissions are reviewed in the order they are received. The regular processing time is [X] business days; security-critical changes may be prioritized. Rejections are communicated with reasons. You may appeal a rejection within 14 days through the developer dashboard.",
          },
          {
            type: "p",
            text: "Updates are re-reviewed when they change essential functionality, permissions or data processing. Minor bug fixes may be released through an expedited process.",
          },
        ],
      },
      {
        id: "contact",
        title: "Contact",
        blocks: [
          {
            type: "p",
            text: "Questions about the Review Guidelines: " + company.email + ".",
          },
        ],
      },
    ],
  },
};
