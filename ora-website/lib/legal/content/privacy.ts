import type { BilingualDoc } from "@/lib/legal/types";
import { company, legalName } from "@/lib/legal/company";

/**
 * Privacy Policy — GDPR-compliant (Verordnung (EU) 2016/679, DSGVO).
 * The website is deliberately low-tracking: theme + language preferences are
 * stored locally, and only server logs are processed by default.
 */
export const privacy: BilingualDoc = {
  de: {
    title: "Datenschutzerklärung",
    subtitle:
      "Informationen über die Verarbeitung personenbezogener Daten auf der rumahl-Website gemäß Datenschutz-Grundverordnung (DSGVO).",
    effective: "2026-08-20",
    updated: "2026-08-20",
    version: "1.0",
    sections: [
      {
        id: "verantwortlicher",
        title: "Verantwortlicher",
        blocks: [
          {
            type: "p",
            text: `Verantwortlicher im Sinne der Datenschutz-Grundverordnung (DSGVO) und anderer datenschutzrechtlicher Bestimmungen ist:`,
          },
          {
            type: "p",
            text: `${legalName}, ${company.addressLine1}, ${company.addressLine2}, ${company.country} — E-Mail: ${company.email}.`,
          },
        ],
      },
      {
        id: "ueberblick",
        title: "Überblick über die Verarbeitungen",
        blocks: [
          {
            type: "p",
            text: "Wir verfolgen das Prinzip der Datenminimierung (Art. 5 Abs. 1 lit. c DSGVO). Die rumahl-Website verarbeitet personenbezogene Daten grundsätzlich nur, soweit dies für den Betrieb der Website erforderlich ist. Im Einzelnen verarbeiten wir:",
          },
          {
            type: "ul",
            items: [
              "Server-Log-Daten (z. B. IP-Adresse, Datum/Uhrzeit, aufgerufene Seite, User-Agent) beim Aufruf der Website;",
              "Angaben, die du uns freiwillig mitteilst (z. B. über Kontaktformulare oder E-Mail);",
              "lokal gespeicherte Einstellungen (z. B. Theme- und Spracheinstellungen) in deinem Browser.",
            ],
          },
        ],
      },
      {
        id: "rechtsgrundlagen",
        title: "Rechtsgrundlagen",
        blocks: [
          {
            type: "table",
            headers: ["Verarbeitung", "Rechtsgrundlage"],
            rows: [
              [
                "Bereitstellung der Website und Server-Logs",
                "Art. 6 Abs. 1 lit. f DSGVO (berechtigtes Interesse: sicherer und stabiler Betrieb der Website)",
              ],
              [
                "Kontaktanfragen per E-Mail/Formular",
                "Art. 6 Abs. 1 lit. b DSGVO (vorvertragliche Maßnahmen) bzw. lit. f DSGVO (Bearbeitung von Anfragen)",
              ],
              [
                "Einwilligungen (z. B. für optionale Analysedienste)",
                "Art. 6 Abs. 1 lit. a DSGVO",
              ],
            ],
          },
        ],
      },
      {
        id: "server-logs",
        title: "Server-Log-Dateien",
        blocks: [
          {
            type: "p",
            text: "Beim Aufruf der Website erhebt der Hosting-Anbieter automatisch Informationen, die dein Browser übermittelt: IP-Adresse, Datum und Uhrzeit des Zugriffs, aufgerufene Seite, Referrer-URL, Browser-Typ und -Version sowie Betriebssystem. Diese Daten werden ausschließlich zur Sicherstellung eines störungsfreien Betriebs, der Sicherheit und der Fehleranalyse verarbeitet (Art. 6 Abs. 1 lit. f DSGVO).",
          },
          {
            type: "p",
            text: "Log-Daten werden grundsätzlich nach spätestens 14 Tagen automatisch gelöscht oder anonymisiert, es sei denn, es besteht eine gesetzliche Aufbewahrungspflicht oder ein konkreter Sicherheitsvorfall erfordert eine längere Speicherung.",
          },
        ],
      },
      {
        id: "cookies",
        title: "Cookies und lokale Speicherung",
        blocks: [
          {
            type: "p",
            text: "Die Website verwendet technisch notwendige Cookies und lokale Browserspeicher (localStorage), um deine Einstellungen (z. B. dunkles/helles Theme, Sprache) zu merken. Diese Speicherungen sind für den Betrieb der Website erforderlich und bedürfen keiner Einwilligung (§ 25 Abs. 2 Nr. 2 TTDSG).",
          },
          {
            type: "p",
            text: "Optionale, nicht notwendige Dienste (z. B. Analysedienste, externe Videos) setzen wir nur mit deiner Einwilligung ein (§ 25 Abs. 1 TTDSG, Art. 6 Abs. 1 lit. a DSGVO). Details findest du in unserer Cookie-Richtlinie.",
          },
          {
            type: "note",
            text: "Du kannst gespeicherte Einstellungen jederzeit über die Einstellungen deines Browsers löschen. Die Website funktioniert auch ohne lokale Speicherung, lediglich deine Theme- und Sprachpräferenzen werden dann nicht über Seitenwechsel hinweg gemerkt.",
          },
        ],
      },
      {
        id: "kontakt",
        title: "Kontaktaufnahme",
        blocks: [
          {
            type: "p",
            text: `Wenn du uns per E-Mail (${company.email} oder ${company.supportEmail}) kontaktierst, verarbeiten wir deine übermittelten Daten (E-Mail-Adresse, Inhalt der Nachricht, ggf. weitere freiwillige Angaben) ausschließlich zur Bearbeitung deiner Anfrage (Art. 6 Abs. 1 lit. b bzw. lit. f DSGVO). Die Daten werden gelöscht, sobald die Anfrage abschließend bearbeitet wurde und keine gesetzlichen Aufbewahrungspflichten entgegenstehen.`,
          },
        ],
      },
      {
        id: "analytics",
        title: "Analyse- und Newsletter-Dienste",
        blocks: [
          {
            type: "p",
            text: "[Optionale Angabe: Falls wir datenschutzfreundliche Analysewerkzeuge (z. B. selbst gehostetes Matomo oder Plausible) einsetzen, beschreiben wir hier Dienst, Zweck und Rechtsgrundlage.]",
          },
          {
            type: "p",
            text: "[Optionale Angabe: Falls wir einen Newsletter anbieten, beschreiben wir hier das Double-Opt-in-Verfahren, die Rechtsgrundlage (Art. 6 Abs. 1 lit. a DSGVO) und das Widerrufsrecht gemäß Art. 7 Abs. 3 DSGVO.]",
          },
          {
            type: "note",
            text: "Hinweis: Diese Abschnitte sind Platzhalter für noch nicht eingesetzte Dienste. Bevor Analyse- oder Newsletter-Dienste aktiviert werden, müssen diese Abschnitte ausgefüllt werden.",
          },
        ],
      },
      {
        id: "empfaenger",
        title: "Empfänger und Auftragsverarbeiter",
        blocks: [
          {
            type: "p",
            text: "Deine Daten werden an Dienstleister weitergegeben, soweit dies für den Betrieb der Website erforderlich ist (insbesondere Hosting-Anbieter). Diese verarbeiten Daten ausschließlich auf unsere Weisung als Auftragsverarbeiter (Art. 28 DSGVO) auf Grundlage eines Auftragsverarbeitungsvertrags.",
          },
          {
            type: "p",
            text: "Eine Weitergabe an Dritte zu Werbezwecken oder ein Verkauf deiner Daten findet nicht statt.",
          },
        ],
      },
      {
        id: "international",
        title: "Übermittlung in Drittländer",
        blocks: [
          {
            type: "p",
            text: "Eine Übermittlung personenbezogener Daten in Länder außerhalb der EU/des EWR findet derzeit nicht statt. Sollte sich dies ändern, erfolgt eine Übermittlung nur, wenn geeignete Garantien gemäß Art. 44 ff. DSGVO bestehen (z. B. Angemessenheitsbeschluss oder Standardvertragsklauseln).",
          },
        ],
      },
      {
        id: "speicherdauer",
        title: "Speicherdauer",
        blocks: [
          {
            type: "p",
            text: "Personenbezogene Daten werden nur so lange gespeichert, wie es für die jeweiligen Zwecke erforderlich ist oder gesetzliche Aufbewahrungspflichten (z. B. handels- und steuerrechtliche Aufbewahrungsfristen von bis zu 10 Jahren) eine längere Speicherung verlangen. Danach werden die Daten gelöscht.",
          },
        ],
      },
      {
        id: "rechte",
        title: "Deine Rechte als betroffene Person",
        blocks: [
          {
            type: "p",
            text: "Dir stehen gegenüber uns folgende Rechte zu:",
          },
          {
            type: "ul",
            items: [
              "Recht auf Auskunft (Art. 15 DSGVO)",
              "Recht auf Berichtigung (Art. 16 DSGVO)",
              "Recht auf Löschung („Recht auf Vergessenwerden“, Art. 17 DSGVO)",
              "Recht auf Einschränkung der Verarbeitung (Art. 18 DSGVO)",
              "Recht auf Datenübertragbarkeit (Art. 20 DSGVO)",
              "Widerspruchsrecht gegen Verarbeitungen auf Basis von Art. 6 Abs. 1 lit. f DSGVO (Art. 21 DSGVO)",
              "Recht auf Widerruf erteilter Einwilligungen mit Wirkung für die Zukunft (Art. 7 Abs. 3 DSGVO)",
              "Beschwerderecht bei einer Datenschutz-Aufsichtsbehörde (Art. 77 DSGVO), insbesondere bei der für unseren Sitz zuständigen Behörde",
            ],
          },
          {
            type: "p",
            text: `Zur Ausübung deiner Rechte genügt eine formlose Mitteilung an ${company.email}.`,
          },
        ],
      },
      {
        id: "automatisierte",
        title: "Automatisierte Entscheidungsfindung",
        blocks: [
          {
            type: "p",
            text: "Eine automatisierte Entscheidungsfindung einschließlich Profiling im Sinne des Art. 22 DSGVO findet nicht statt.",
          },
        ],
      },
      {
        id: "sicherheit",
        title: "Sicherheit der Verarbeitung (Art. 32 DSGVO)",
        blocks: [
          {
            type: "p",
            text: "Wir setzen geeignete technische und organisatorische Maßnahmen ein, um deine Daten gegen unbefugten Zugriff, Verlust oder Manipulation zu schützen, darunter TLS-Verschlüsselung, Zugriffskontrollen und regelmäßige Sicherheitsupdates.",
          },
        ],
      },
      {
        id: "aenderungen",
        title: "Änderungen dieser Datenschutzerklärung",
        blocks: [
          {
            type: "p",
            text: "Wir aktualisieren diese Datenschutzerklärung, wenn sich die Verarbeitungstätigkeiten oder die Rechtslage ändern. Die jeweils aktuelle Fassung findest du auf dieser Seite.",
          },
        ],
      },
    ],
  },
  en: {
    title: "Privacy Policy",
    subtitle:
      "Information about the processing of personal data on the rumahl website in accordance with the General Data Protection Regulation (GDPR).",
    effective: "2026-08-20",
    updated: "2026-08-20",
    version: "1.0",
    sections: [
      {
        id: "controller",
        title: "Controller",
        blocks: [
          {
            type: "p",
            text: `The controller within the meaning of the General Data Protection Regulation (GDPR) and other data protection legislation is:`,
          },
          {
            type: "p",
            text: `${legalName}, ${company.addressLine1}, ${company.addressLine2}, ${company.country} — Email: ${company.email}.`,
          },
        ],
      },
      {
        id: "overview",
        title: "Overview of processing activities",
        blocks: [
          {
            type: "p",
            text: "We follow the principle of data minimization (Art. 5(1)(c) GDPR). The rumahl website processes personal data only to the extent necessary for its operation. In detail, we process:",
          },
          {
            type: "ul",
            items: [
              "server log data (e.g. IP address, date/time, page requested, user agent) when you visit the website;",
              "information you voluntarily provide to us (e.g. via contact forms or email);",
              "preferences stored locally in your browser (e.g. theme and language settings).",
            ],
          },
        ],
      },
      {
        id: "legal-bases",
        title: "Legal bases",
        blocks: [
          {
            type: "table",
            headers: ["Processing", "Legal basis"],
            rows: [
              [
                "Providing the website and server logs",
                "Art. 6(1)(f) GDPR (legitimate interest: secure and stable operation of the website)",
              ],
              [
                "Contact requests by email/form",
                "Art. 6(1)(b) GDPR (pre-contractual measures) or Art. 6(1)(f) GDPR (handling inquiries)",
              ],
              [
                "Consents (e.g. for optional analytics services)",
                "Art. 6(1)(a) GDPR",
              ],
            ],
          },
        ],
      },
      {
        id: "server-logs",
        title: "Server log files",
        blocks: [
          {
            type: "p",
            text: "When you visit the website, the hosting provider automatically collects information transmitted by your browser: IP address, date and time of access, page requested, referrer URL, browser type and version, and operating system. This data is processed exclusively to ensure uninterrupted operation, security and error analysis (Art. 6(1)(f) GDPR).",
          },
          {
            type: "p",
            text: "Log data is automatically deleted or anonymized after no more than 14 days, unless statutory retention obligations apply or a concrete security incident requires longer storage.",
          },
        ],
      },
      {
        id: "cookies",
        title: "Cookies and local storage",
        blocks: [
          {
            type: "p",
            text: "The website uses technically necessary cookies and local browser storage (localStorage) to remember your preferences (e.g. dark/light theme, language). These storage operations are required for the operation of the website and do not require consent (Section 25(2) No. 2 TTDSG).",
          },
          {
            type: "p",
            text: "Optional, non-essential services (e.g. analytics services, external videos) are only used with your consent (Section 25(1) TTDSG, Art. 6(1)(a) GDPR). Details are set out in our Cookie Policy.",
          },
          {
            type: "note",
            text: "You can delete stored preferences at any time via your browser settings. The website works without local storage — only your theme and language preferences will then not persist across page visits.",
          },
        ],
      },
      {
        id: "contact",
        title: "Contacting us",
        blocks: [
          {
            type: "p",
            text: `If you contact us by email (${company.email} or ${company.supportEmail}), we process the data you transmit (email address, content of the message, any further voluntary information) exclusively to handle your inquiry (Art. 6(1)(b) or (f) GDPR). The data is deleted as soon as the inquiry has been fully processed and no statutory retention obligations apply.`,
          },
        ],
      },
      {
        id: "analytics",
        title: "Analytics and newsletter services",
        blocks: [
          {
            type: "p",
            text: "[Optional: If we use privacy-friendly analytics tools (e.g. self-hosted Matomo or Plausible), we describe service, purpose and legal basis here.]",
          },
          {
            type: "p",
            text: "[Optional: If we offer a newsletter, we describe the double opt-in process, the legal basis (Art. 6(1)(a) GDPR) and the right to withdraw consent under Art. 7(3) GDPR here.]",
          },
          {
            type: "note",
            text: "Note: These sections are placeholders for services not yet in use. Before analytics or newsletter services are activated, these sections must be completed.",
          },
        ],
      },
      {
        id: "recipients",
        title: "Recipients and processors",
        blocks: [
          {
            type: "p",
            text: "Your data is shared with service providers to the extent necessary for the operation of the website (in particular hosting providers). These process data exclusively on our instructions as processors (Art. 28 GDPR) on the basis of a data processing agreement.",
          },
          {
            type: "p",
            text: "We do not share your data with third parties for advertising purposes and do not sell your data.",
          },
        ],
      },
      {
        id: "international",
        title: "International transfers",
        blocks: [
          {
            type: "p",
            text: "Personal data is currently not transferred to countries outside the EU/EEA. Should this change, transfers will only take place where appropriate safeguards within the meaning of Art. 44 et seq. GDPR exist (e.g. adequacy decision or standard contractual clauses).",
          },
        ],
      },
      {
        id: "retention",
        title: "Retention period",
        blocks: [
          {
            type: "p",
            text: "Personal data is stored only as long as necessary for the respective purposes or as required by statutory retention obligations (e.g. commercial and tax retention periods of up to 10 years). Afterwards, the data is deleted.",
          },
        ],
      },
      {
        id: "rights",
        title: "Your rights as a data subject",
        blocks: [
          {
            type: "p",
            text: "You have the following rights vis-à-vis us:",
          },
          {
            type: "ul",
            items: [
              "right of access (Art. 15 GDPR)",
              "right to rectification (Art. 16 GDPR)",
              "right to erasure (“right to be forgotten”, Art. 17 GDPR)",
              "right to restriction of processing (Art. 18 GDPR)",
              "right to data portability (Art. 20 GDPR)",
              "right to object to processing based on Art. 6(1)(f) GDPR (Art. 21 GDPR)",
              "right to withdraw consent at any time with effect for the future (Art. 7(3) GDPR)",
              "right to lodge a complaint with a data protection supervisory authority (Art. 77 GDPR), in particular the authority responsible for our registered office",
            ],
          },
          {
            type: "p",
            text: `To exercise your rights, an informal message to ${company.email} is sufficient.`,
          },
        ],
      },
      {
        id: "automated",
        title: "Automated decision-making",
        blocks: [
          {
            type: "p",
            text: "Automated decision-making including profiling within the meaning of Art. 22 GDPR does not take place.",
          },
        ],
      },
      {
        id: "security",
        title: "Security of processing (Art. 32 GDPR)",
        blocks: [
          {
            type: "p",
            text: "We implement appropriate technical and organizational measures to protect your data against unauthorized access, loss or manipulation, including TLS encryption, access controls and regular security updates.",
          },
        ],
      },
      {
        id: "changes",
        title: "Changes to this Privacy Policy",
        blocks: [
          {
            type: "p",
            text: "We update this Privacy Policy whenever our processing activities or the legal situation change. The current version is always available on this page.",
          },
        ],
      },
    ],
  },
};
