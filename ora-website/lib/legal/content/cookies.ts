import type { BilingualDoc } from "@/lib/legal/types";
import { company } from "@/lib/legal/company";

/**
 * Cookie Policy — transparent list of all cookies and local storage used on
 * the rumahl website, compliant with § 25 TTDSG (ePrivacy implementation).
 */
export const cookies: BilingualDoc = {
  de: {
    title: "Cookie-Richtlinie",
    subtitle:
      "Welche Cookies und lokalen Speicherungen die rumahl-Website verwendet und wie du sie steuerst (§ 25 TTDSG).",
    effective: "2026-08-20",
    updated: "2026-08-20",
    version: "1.0",
    sections: [
      {
        id: "was-sind-cookies",
        title: "Was sind Cookies?",
        blocks: [
          {
            type: "p",
            text: "Cookies sind kleine Textdateien, die beim Besuch einer Website in deinem Browser gespeichert werden. Neben Cookies nutzt die rumahl-Website auch den lokalen Browserspeicher (localStorage), der denselben Zweck erfüllt. Beides erlaubt es einer Website, Informationen über deinen Besuch zu speichern.",
          },
        ],
      },
      {
        id: "welche-cookies",
        title: "Welche Speicherungen wir verwenden",
        blocks: [
          {
            type: "p",
            text: "Die rumahl-Website ist bewusst sparsam: Standardmäßig werden ausschließlich technisch notwendige Speicherungen vorgenommen. Eine Einwilligung ist hierfür nicht erforderlich (§ 25 Abs. 2 Nr. 2 TTDSG).",
          },
          {
            type: "table",
            headers: ["Name", "Typ", "Zweck", "Dauer"],
            rows: [
              [
                "rumahl-theme",
                "localStorage",
                "Speichert deine Theme-Einstellung (hell/dunkel)",
                "Bis du sie löschst",
              ],
              [
                "rumahl-legal-lang",
                "localStorage",
                "Speichert deine Sprachwahl auf den Rechtsseiten (DE/EN)",
                "Bis du sie löschst",
              ],
              [
                "[Weitere technische Cookies]",
                "Cookie/localStorage",
                "[Platzhalter für zukünftige notwendige Cookies]",
                "—",
              ],
            ],
          },
          {
            type: "note",
            text: "Optionaler Platzhalter: Sobald nicht notwendige Dienste (z. B. Analysewerkzeuge oder eingebettete externe Medien) eingesetzt werden, müssen diese hier mit Zweck, Anbieter, Speicherdauer und Einwilligungsmechanismus aufgeführt werden.",
          },
        ],
      },
      {
        id: "einwilligung",
        title: "Einwilligung und Rechtsgrundlage",
        blocks: [
          {
            type: "p",
            text: "Technisch notwendige Speicherungen erfolgen auf Grundlage von § 25 Abs. 2 Nr. 2 TTDSG. Für nicht notwendige Speicherungen und die damit verbundene Datenverarbeitung holen wir deine Einwilligung ein (§ 25 Abs. 1 TTDSG, Art. 6 Abs. 1 lit. a DSGVO). Eine erteilte Einwilligung kannst du jederzeit mit Wirkung für die Zukunft widerrufen.",
          },
        ],
      },
      {
        id: "verwalten",
        title: "Cookies verwalten und löschen",
        blocks: [
          {
            type: "p",
            text: "Du kannst Speicherungen jederzeit über die Einstellungen deines Browsers einsehen, löschen oder blockieren. Bitte beachte: Das Blockieren aller Cookies kann die Funktionalität der Website einschränken (z. B. bleiben Theme- oder Spracheinstellungen dann nicht über Seitenwechsel hinweg erhalten).",
          },
          {
            type: "ul",
            items: [
              "Chrome: Einstellungen → Datenschutz und Sicherheit → Drittanbieter-Cookies",
              "Firefox: Einstellungen → Datenschutz & Sicherheit → Cookies und Website-Daten",
              "Safari: Einstellungen → Datenschutz → Websites verwalten",
              "Edge: Einstellungen → Cookies und Websiteberechtigungen",
            ],
          },
        ],
      },
      {
        id: "aenderungen",
        title: "Änderungen und Kontakt",
        blocks: [
          {
            type: "p",
            text: "Wir aktualisieren diese Richtlinie, wenn sich unser Cookie-Einsatz ändert. Bei Fragen wende dich an " + company.email + ".",
          },
        ],
      },
    ],
  },
  en: {
    title: "Cookie Policy",
    subtitle:
      "Which cookies and local storage the rumahl website uses and how you can control them (Section 25 TTDSG).",
    effective: "2026-08-20",
    updated: "2026-08-20",
    version: "1.0",
    sections: [
      {
        id: "what-are-cookies",
        title: "What are cookies?",
        blocks: [
          {
            type: "p",
            text: "Cookies are small text files stored in your browser when you visit a website. In addition to cookies, the rumahl website uses local browser storage (localStorage), which serves the same purpose. Both allow a website to store information about your visit.",
          },
        ],
      },
      {
        id: "which-cookies",
        title: "Which storage we use",
        blocks: [
          {
            type: "p",
            text: "The rumahl website is deliberately frugal: by default, only technically necessary storage operations are performed. No consent is required for these (Section 25(2) No. 2 TTDSG).",
          },
          {
            type: "table",
            headers: ["Name", "Type", "Purpose", "Duration"],
            rows: [
              [
                "rumahl-theme",
                "localStorage",
                "Stores your theme preference (light/dark)",
                "Until you delete it",
              ],
              [
                "rumahl-legal-lang",
                "localStorage",
                "Stores your language choice on the legal pages (DE/EN)",
                "Until you delete it",
              ],
              [
                "[Further technical cookies]",
                "Cookie/localStorage",
                "[Placeholder for future necessary cookies]",
                "—",
              ],
            ],
          },
          {
            type: "note",
            text: "Optional placeholder: Once non-essential services (e.g. analytics tools or embedded external media) are used, they must be listed here with purpose, provider, storage duration and consent mechanism.",
          },
        ],
      },
      {
        id: "consent",
        title: "Consent and legal basis",
        blocks: [
          {
            type: "p",
            text: "Technically necessary storage is based on Section 25(2) No. 2 TTDSG. For non-essential storage and the associated data processing, we obtain your consent (Section 25(1) TTDSG, Art. 6(1)(a) GDPR). You may withdraw consent at any time with effect for the future.",
          },
        ],
      },
      {
        id: "manage",
        title: "Managing and deleting cookies",
        blocks: [
          {
            type: "p",
            text: "You can view, delete or block storage at any time via your browser settings. Please note: blocking all cookies may impair website functionality (e.g. theme or language preferences will then not persist across page visits).",
          },
          {
            type: "ul",
            items: [
              "Chrome: Settings → Privacy and security → Third-party cookies",
              "Firefox: Settings → Privacy & Security → Cookies and Site Data",
              "Safari: Settings → Privacy → Manage Website Data",
              "Edge: Settings → Cookies and site permissions",
            ],
          },
        ],
      },
      {
        id: "changes",
        title: "Changes and contact",
        blocks: [
          {
            type: "p",
            text: "We update this policy whenever our use of cookies changes. For questions, contact " + company.email + ".",
          },
        ],
      },
    ],
  },
};
