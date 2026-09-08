import type { BilingualDoc } from "@/lib/legal/types";
import { company, legalName } from "@/lib/legal/company";

/**
 * rumahl Store Terms of Service — end-user terms for the app store.
 * Covers the intermediary role (DSA), consumer contracts for digital content
 * (BGB §§ 327 ff., §§ 312 ff.), withdrawal rights and refunds, and the
 * DSA notice-and-action mechanism.
 */
export const storeTerms: BilingualDoc = {
  de: {
    title: "Nutzungsbedingungen des rumahl Store",
    subtitle:
      "Diese Bedingungen gelten für die Nutzung des rumahl Store (https://store.rumahl.com) — inklusive Kauf digitaler Inhalte, Widerrufsrecht und Meldung rechtswidriger Inhalte (DSA).",
    effective: "2026-08-20",
    updated: "2026-08-20",
    version: "1.0",
    sections: [
      {
        id: "geltungsbereich",
        title: "Geltungsbereich und Parteien",
        blocks: [
          {
            type: "p",
            text: "Der rumahl Store („Store“) ist eine Online-Plattform, auf der Apps und Plugins für rumahl OS (zusammen „Apps“) von unabhängigen Entwicklern angeboten werden. Betreiber des Stores ist " + legalName + " („rumahl“, „wir“, „uns“). Diese Bedingungen regeln deine Nutzung des Stores. Der jeweilige Entwickler schließt mit dir den Vertrag über die einzelne App; rumahl stellt die Plattform bereit und ist insoweit als Hosting-Anbieter tätig.",
          },
        ],
      },
      {
        id: "konto",
        title: "Konto und Zugang",
        blocks: [
          {
            type: "p",
            text: "Für die Nutzung des Stores benötigst du ein Konto. Du bist für die Vertraulichkeit deiner Zugangsdaten verantwortlich. Wir können Konten sperren oder beenden, wenn diese Bedingungen oder geltendes Recht verletzt werden.",
          },
        ],
      },
      {
        id: "store-inhalte",
        title: "Inhalte des Stores",
        blocks: [
          {
            type: "p",
            text: "Der Store enthält Beschreibungen, Screenshots, Bewertungen und weitere Informationen zu Apps. Diese Angaben stammen von den Entwicklern. Wir prüfen Apps vor Veröffentlichung nach unseren Review-Richtlinien, übernehmen jedoch keine Gewähr für die Richtigkeit oder Vollständigkeit der Angaben der Entwickler.",
          },
          {
            type: "p",
            text: "Apps können kostenlos oder kostenpflichtig sein. [Platzhalter: Sobald kostenpflichtige Apps angeboten werden, werden hier Preise, Zahlungsarten, Steuern (inkl. MwSt.) und der Abrechnungszeitpunkt beschrieben.]",
          },
        ],
      },
      {
        id: "vertrag",
        title: "Vertragsschluss mit dem Entwickler",
        blocks: [
          {
            type: "p",
            text: "Der Vertrag über den Erwerb einer App (einschließlich digitaler Inhalte im Sinne der §§ 327 ff. BGB) kommt zwischen dir und dem jeweiligen Entwickler zustande. Deine Bestellung stellt ein Angebot dar; der Vertrag kommt zustande, wenn wir dir den Zugang zur App bereitstellen oder den Erwerb anderweitig bestätigen. Die AGB des Entwicklers gelten nur, soweit sie dir vor dem Vertragsschluss zugänglich gemacht wurden und nicht mit diesen Bedingungen oder zwingendem Recht kollidieren.",
          },
          {
            type: "note",
            text: "Verbraucher im Sinne des § 13 BGB sind durch die zwingenden Vorschriften des deutschen und europäischen Verbraucherrechts geschützt (z. B. §§ 312 ff., 327 ff., 355 ff. BGB, Richtlinien (EU) 2011/83 und (EU) 2019/770).",
          },
        ],
      },
      {
        id: "widerruf",
        title: "Widerrufsrecht und Ausnahme für digitale Inhalte",
        blocks: [
          {
            type: "p",
            text: "Verbrauchern steht grundsätzlich ein 14-tägiges Widerrufsrecht gemäß § 355 BGB zu. Für digitale Inhalte (z. B. Apps), die unmittelbar nach Vertragsschluss bereitgestellt werden, erlischt das Widerrufsrecht gemäß § 356 Abs. 5 BGB, wenn",
          },
          {
            type: "ul",
            items: [
              "du ausdrücklich eingewilligt hast, dass wir bzw. der Entwickler mit der Ausführung des Vertrags vor Ablauf der Widerrufsfrist beginnen, und",
              "du deine Kenntnis davon bestätigt hast, dass du durch die Einwilligung dein Widerrufsrecht verlierst.",
          ],
          },
          {
            type: "p",
            text: "Die Bestätigung erfolgt im Bestellvorgang. Ohne diese ausdrückliche Zustimmung kannst du den Vertrag innerhalb von 14 Tagen widerrufen; in diesem Fall muss die App gelöscht und nicht weiter genutzt werden.",
          },
        ],
      },
      {
        id: "erstattungen",
        title: "Erstattungen",
        blocks: [
          {
            type: "p",
            text: "Für kostenpflichtige Apps gewähren wir über den Store ein Erstattungsverfahren: [Platzhalter: Erstattungsfenster, z. B. 48 Stunden, Voraussetzungen und Verfahren]. Gesetzliche Gewährleistungsrechte (§§ 327 ff. BGB: Konformität, Aktualisierungen, 2-jährige Haftung) bleiben unberührt.",
          },
        ],
      },
      {
        id: "updates",
        title: "Updates und Verfügbarkeit",
        blocks: [
          {
            type: "p",
            text: "Entwickler sind verpflichtet, ihre Apps während eines angemessenen Zeitraums mit Aktualisierungen einschließlich Sicherheitsupdates zu versorgen (Art. 7 und 8 der Richtlinie (EU) 2019/770). Wir weisen in den App-Beschreibungen auf den Unterstützungszeitraum hin. Wir können Apps aus dem Store entfernen, wenn sie nicht mehr gepflegt werden, Sicherheitsrisiken darstellen oder gegen diese Bedingungen verstoßen.",
          },
        ],
      },
      {
        id: "nutzungsregeln",
        title: "Nutzungsregeln",
        blocks: [
          {
            type: "p",
            text: "Du darfst den Store nicht missbräuchlich nutzen. Untersagt sind insbesondere:",
          },
          {
            type: "ul",
            items: [
              "Umgehung technischer Schutzmaßnahmen oder Bezahlsysteme;",
              "automatisiertes Abrufen von Store-Daten (Scraping) ohne Zustimmung;",
              "falsche Angaben bei Bestellungen, Bewertungen oder Meldungen;",
              "Verbreitung schädlicher Software über den Store;",
              "jede Nutzung, die gegen geltendes Recht verstößt.",
            ],
          },
        ],
      },
      {
        id: "dsa",
        title: "Meldung rechtswidriger Inhalte (DSA)",
        blocks: [
          {
            type: "p",
            text: "Der Store ist eine Online-Plattform im Sinne der Verordnung (EU) 2022/2065 (Digital Services Act, „DSA“). Du kannst rechtswidrige Inhalte (z. B. Apps, die gegen Strafrecht, Urheberrecht oder diese Richtlinien verstoßen) über folgende Kanäle melden:",
          },
          {
            type: "ul",
            items: [
              "E-Mail: " + company.email + " (Kennzeichnung „DSA Notice“), oder",
              "über das Meldeformular im Store: [Platzhalter: URL].",
            ],
          },
          {
            type: "p",
            text: "Wirken wir trotz Kenntnis nicht unverzüglich gegen rechtswidrige Inhalte, können wir gemäß Art. 6 DSA nicht von der Haftungsbefreiung für Hosting-Anbieter profitieren. Wir treffen Maßnahmen gemäß Art. 16 DSA, informieren Melder und Betroffene über Entscheidungen (Art. 17 DSA) und stellen Beschwerdemöglichkeiten (interne Beschwerdeverfahren, Art. 20 DSA) sowie außergerichtliche Streitbeilegung (Art. 21 DSA) bereit. Melder und Betroffene können Entscheidungen über die in Art. 20 DSA genannten Kanäle anfechten.",
          },
        ],
      },
      {
        id: "haftung",
        title: "Haftung",
        blocks: [
          {
            type: "p",
            text: "Wir haften unbeschränkt für Vorsatz, grobe Fahrlässigkeit, Verletzung von Leben, Körper oder Gesundheit und nach dem Produkthaftungsgesetz. Für einfache Fahrlässigkeit haften wir nur bei Verletzung wesentlicher Vertragspflichten, begrenzt auf den vertragstypischen, vorhersehbaren Schaden. Für Apps Dritter haften wir nur im Rahmen der gesetzlichen Hosting-Haftung (Art. 6 DSA, §§ 7 ff. DDG). Verbraucherschützende Vorschriften bleiben unberührt.",
          },
          {
            type: "p",
            text: "Du trägst die Verantwortung für Backups deiner Daten. Schäden durch Ausfall, Fehlfunktion oder Entfernung von Apps sind nach Maßgabe des vorstehenden Absatzes ausgeschlossen.",
          },
        ],
      },
      {
        id: "aenderungen",
        title: "Änderungen dieser Bedingungen",
        blocks: [
          {
            type: "p",
            text: "Wir können diese Bedingungen mit Wirkung für die Zukunft ändern. Wesentliche Änderungen kündigen wir mindestens 30 Tage vor Inkrafttreten an, soweit nicht zwingende Gründe (z. B. gesetzliche Vorgaben) eine kürzere Frist erfordern. Wenn du nicht einverstanden bist, kannst du den Store bis zum Inkrafttreten nicht mehr nutzen und dein Konto kündigen.",
          },
        ],
      },
      {
        id: "recht",
        title: "Anwendbares Recht und Streitbeilegung",
        blocks: [
          {
            type: "p",
            text: "Auf diese Bedingungen findet das Recht der Bundesrepublik Deutschland Anwendung. Für Verbraucher gelten die zwingenden Schutzbestimmungen des Staates ihres gewöhnlichen Aufenthalts innerhalb der EU. Die Europäische Kommission stellt eine Online-Streitbeilegungsplattform bereit: https://ec.europa.eu/consumers/odr/. Wir sind nicht verpflichtet und nicht bereit, an Verbraucherschlichtungsverfahren teilzunehmen.",
          },
        ],
      },
      {
        id: "kontakt",
        title: "Kontakt",
        blocks: [
          {
            type: "p",
            text: "Fragen, Beschwerden und DSA-Meldungen: " + company.email + " — Support: " + company.supportEmail + ".",
          },
        ],
      },
    ],
  },
  en: {
    title: "rumahl Store Terms of Service",
    subtitle:
      "These terms govern your use of the rumahl Store (https://store.rumahl.com) — including purchases of digital content, withdrawal rights and reporting of illegal content (DSA).",
    effective: "2026-08-20",
    updated: "2026-08-20",
    version: "1.0",
    sections: [
      {
        id: "scope",
        title: "Scope and parties",
        blocks: [
          {
            type: "p",
            text: "The rumahl Store (the “Store”) is an online platform where apps and plugins for rumahl OS (together, “Apps”) are offered by independent developers. The Store is operated by " + legalName + " (“rumahl”, “we”, “us”). These terms govern your use of the Store. The respective developer concludes the contract with you for each individual App; rumahl provides the platform and acts as a hosting provider in this respect.",
          },
        ],
      },
      {
        id: "account",
        title: "Account and access",
        blocks: [
          {
            type: "p",
            text: "Using the Store requires an account. You are responsible for keeping your credentials confidential. We may suspend or terminate accounts that violate these terms or applicable law.",
          },
        ],
      },
      {
        id: "store-content",
        title: "Store content",
        blocks: [
          {
            type: "p",
            text: "The Store contains descriptions, screenshots, ratings and further information about Apps. This information is provided by the developers. We review Apps before publication in accordance with our Review Guidelines, but do not warrant the accuracy or completeness of developer information.",
          },
          {
            type: "p",
            text: "Apps may be free or paid. [Placeholder: Once paid Apps are offered, prices, payment methods, taxes (incl. VAT) and the billing point in time will be described here.]",
          },
        ],
      },
      {
        id: "contract",
        title: "Contract with the developer",
        blocks: [
          {
            type: "p",
            text: "The contract for the acquisition of an App (including digital content within the meaning of Sections 327 et seq. BGB) is concluded between you and the respective developer. Your order constitutes an offer; the contract is concluded when we provide you with access to the App or otherwise confirm the acquisition. Developer terms and conditions apply only if they were made available to you before the contract was concluded and do not conflict with these terms or mandatory law.",
          },
          {
            type: "note",
            text: "Consumers within the meaning of Section 13 BGB are protected by the mandatory provisions of German and European consumer law (e.g. Sections 312 et seq., 327 et seq., 355 et seq. BGB, Directives (EU) 2011/83 and (EU) 2019/770).",
          },
        ],
      },
      {
        id: "withdrawal",
        title: "Withdrawal right and the exception for digital content",
        blocks: [
          {
            type: "p",
            text: "Consumers generally have a 14-day right of withdrawal under Section 355 BGB. For digital content (e.g. Apps) supplied immediately after the contract is concluded, the withdrawal right expires pursuant to Section 356(5) BGB if",
          },
          {
            type: "ul",
            items: [
              "you expressly consented to the start of performance before the end of the withdrawal period, and",
              "you acknowledged that you lose your withdrawal right upon such consent.",
          ],
          },
          {
            type: "p",
            text: "The acknowledgement is obtained during the order process. Without this express consent, you may withdraw from the contract within 14 days; in this case, the App must be deleted and no longer used.",
          },
        ],
      },
      {
        id: "refunds",
        title: "Refunds",
        blocks: [
          {
            type: "p",
            text: "For paid Apps we provide a refund process through the Store: [Placeholder: refund window, e.g. 48 hours, conditions and procedure]. Statutory warranty rights (Sections 327 et seq. BGB: conformity, updates, 2-year liability) remain unaffected.",
          },
        ],
      },
      {
        id: "updates",
        title: "Updates and availability",
        blocks: [
          {
            type: "p",
            text: "Developers are required to provide their Apps with updates, including security updates, for a reasonable period (Arts. 7 and 8 of Directive (EU) 2019/770). We indicate the support period in the App descriptions. We may remove Apps from the Store if they are no longer maintained, pose security risks or violate these terms.",
          },
        ],
      },
      {
        id: "acceptable-use",
        title: "Acceptable use",
        blocks: [
          {
            type: "p",
            text: "You must not misuse the Store. In particular, you must not:",
          },
          {
            type: "ul",
            items: [
              "circumvent technical protection measures or payment systems;",
              "scrape Store data automatically without permission;",
              "provide false information in orders, ratings or notices;",
              "distribute harmful software through the Store;",
              "use the Store in any way that violates applicable law.",
            ],
          },
        ],
      },
      {
        id: "dsa",
        title: "Reporting illegal content (DSA)",
        blocks: [
          {
            type: "p",
            text: "The Store is an online platform within the meaning of Regulation (EU) 2022/2065 (Digital Services Act, “DSA”). You can report illegal content (e.g. Apps that violate criminal law, copyright or these policies) through the following channels:",
          },
          {
            type: "ul",
            items: [
              "Email: " + company.email + " (subject line “DSA Notice”), or",
              "the report form in the Store: [Placeholder: URL].",
          ],
          },
          {
            type: "p",
            text: "If we fail to act expeditiously against illegal content despite knowledge, we may not benefit from the hosting liability exemption under Art. 6 DSA. We take measures pursuant to Art. 16 DSA, inform reporters and affected parties about decisions (Art. 17 DSA), and provide internal complaint mechanisms (Art. 20 DSA) and out-of-court dispute settlement (Art. 21 DSA). Reporters and affected parties may challenge decisions through the channels set out in Art. 20 DSA.",
          },
        ],
      },
      {
        id: "liability",
        title: "Liability",
        blocks: [
          {
            type: "p",
            text: "We are liable without limitation for intent, gross negligence, injury to life, body or health, and under the German Product Liability Act. For slight negligence we are liable only for breach of material contractual obligations, limited to the typical, foreseeable damage. For third-party Apps we are liable only within the scope of statutory hosting liability (Art. 6 DSA, Sections 7 et seq. DDG). Consumer-protective provisions remain unaffected.",
          },
          {
            type: "p",
            text: "You are responsible for backing up your data. Damages resulting from the failure, malfunction or removal of Apps are excluded to the extent set out in the preceding paragraph.",
          },
        ],
      },
      {
        id: "changes",
        title: "Changes to these terms",
        blocks: [
          {
            type: "p",
            text: "We may amend these terms with effect for the future. We will announce material changes at least 30 days before they take effect, unless mandatory reasons (e.g. legal requirements) require a shorter period. If you do not agree, you must stop using the Store and may terminate your account before the changes take effect.",
          },
        ],
      },
      {
        id: "law",
        title: "Governing law and dispute resolution",
        blocks: [
          {
            type: "p",
            text: "These terms are governed by the laws of the Federal Republic of Germany. For consumers, the mandatory protective provisions of their state of habitual residence within the EU apply. The European Commission provides an online dispute resolution platform: https://ec.europa.eu/consumers/odr/. We are neither obliged nor willing to participate in consumer arbitration proceedings.",
          },
        ],
      },
      {
        id: "contact",
        title: "Contact",
        blocks: [
          {
            type: "p",
            text: "Questions, complaints and DSA notices: " + company.email + " — Support: " + company.supportEmail + ".",
          },
        ],
      },
    ],
  },
};
