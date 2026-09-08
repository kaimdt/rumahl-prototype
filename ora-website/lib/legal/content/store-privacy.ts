import type { BilingualDoc } from "@/lib/legal/types";
import { company } from "@/lib/legal/company";

/**
 * App Privacy Requirements — mandatory privacy and GDPR obligations for
 * developers publishing Apps in the rumahl Store.
 */
export const storePrivacy: BilingualDoc = {
  de: {
    title: "App-Datenschutzanforderungen (rumahl Store)",
    subtitle:
      "Verbindliche Datenschutz- und DSGVO-Pflichten für Entwickler, die Apps im rumahl Store veröffentlichen.",
    effective: "2026-08-20",
    updated: "2026-08-20",
    version: "1.0",
    sections: [
      {
        id: "anwendbarkeit",
        title: "Anwendbarkeit",
        blocks: [
          {
            type: "p",
            text: "Diese Anforderungen gelten für alle Apps im rumahl Store, die personenbezogene Daten verarbeiten — unabhängig davon, ob die Verarbeitung lokal auf dem Gerät, auf Servern des Entwicklers oder bei Dritten stattfindet. Sie ergänzen die Entwicklervereinbarung und die App-Review-Richtlinien.",
          },
        ],
      },
      {
        id: "verantwortlicher",
        title: "Der Entwickler als Verantwortlicher",
        blocks: [
          {
            type: "p",
            text: "Der Entwickler ist für die Datenverarbeitung durch seine App eigenständig Verantwortlicher im Sinne des Art. 4 Nr. 7 DSGVO, sofern nicht die Verarbeitung ausnahmsweise rumahl zuzurechnen ist (z. B. wenn wir Daten im Auftrag des Entwicklers verarbeiten). Diese Verantwortung kann nicht auf den Store übertragen werden.",
          },
        ],
      },
      {
        id: "minimierung",
        title: "Datenminimierung und Transparenz",
        blocks: [
          {
            type: "ul",
            items: [
              "Erhebe nur personenbezogene Daten, die für die Funktion der App zwingend erforderlich sind (Art. 5 Abs. 1 lit. c DSGVO);",
              "Verarbeite Daten nur für festgelegte, eindeutige und legitime Zwecke (Art. 5 Abs. 1 lit. b DSGVO);",
              "Lege für jede Verarbeitung eine Rechtsgrundlage nach Art. 6 DSGVO fest (bei Einwilligung: Art. 7 DSGVO, jederzeit widerrufbar);",
              "Informiere Nutzer vor der Erhebung gemäß Art. 13/14 DSGVO über Verantwortlichen, Zwecke, Rechtsgrundlagen, Empfänger, Speicherdauer und Rechte;",
              "Veröffentliche eine Datenschutzerklärung und hinterlege sie im Store zusammen mit den Datenangaben deiner App.",
            ],
          },
        ],
      },
      {
        id: "pflichten",
        title: "Konkrete DSGVO-Pflichten",
        blocks: [
          {
            type: "ul",
            items: [
              "Rechte betroffener Personen: Auskunft, Berichtigung, Löschung, Einschränkung, Datenübertragbarkeit, Widerspruch (Art. 15–21 DSGVO) — inklusive klarer Kontaktmöglichkeit und Verfahren zur Löschung von Konten und Daten;",
              "Auftragsverarbeiter: Verträge gemäß Art. 28 DSGVO, wenn Dritte Daten für dich verarbeiten;",
              "Datenpannen: Meldung an die Aufsichtsbehörde binnen 72 Stunden und Information der Betroffenen (Art. 33/34 DSGVO);",
              "Verzeichnis von Verarbeitungstätigkeiten (Art. 30 DSGVO), soweit du nicht als Unternehmen von der Ausnahme erfasst bist;",
              "Datenschutz durch Technikgestaltung und durch datenschutzfreundliche Voreinstellungen (Art. 25 DSGVO);",
              "Sicherheit der Verarbeitung (Art. 32 DSGVO): Verschlüsselung, Zugriffskontrollen, sichere Entwicklung.",
            ],
          },
        ],
      },
      {
        id: "sensibel",
        title: "Besondere Kategorien von Daten",
        blocks: [
          {
            type: "p",
            text: "Die Verarbeitung besonderer Kategorien personenbezogener Daten (Art. 9 DSGVO: z. B. Gesundheit, Religion, politische Meinung, biometrische Daten) erfordert eine ausdrückliche Rechtsgrundlage nach Art. 9 Abs. 2 DSGVO. Apps, die solche Daten verarbeiten, müssen dies im Review-Prozess offenlegen und begründen. Videoüberwachung in der Wohnung (z. B. Kamera-Apps) unterliegt zusätzlich den nationalen Vorschriften (z. B. § 4 BDSG).",
          },
        ],
      },
      {
        id: "sdks",
        title: "Dritte SDKs und Dienste",
        blocks: [
          {
            type: "p",
            text: "Bindet deine App SDKs oder Dienste Dritter ein (z. B. Analyse-, Crash-Reporting-, Werbe- oder KI-Dienste), musst du:",
          },
          {
            type: "ul",
            items: [
              "diese im Review-Prozess und in der Datenschutzerklärung offenlegen;",
              "sicherstellen, dass die Einbindung datenschutzkonform erfolgt (insbesondere keine unzulässige Übermittlung in Drittländer ohne Garantien nach Art. 44 ff. DSGVO);",
              "Datenübermittlungen in Drittländer nur mit geeigneten Garantien (z. B. Angemessenheitsbeschluss oder Standardvertragsklauseln) vornehmen;",
              "Nutzern eine datenschutzfreundliche Alternative anbieten, soweit das SDK für die Kernfunktion nicht erforderlich ist.",
            ],
          },
        ],
      },
      {
        id: "store-angaben",
        title: "Angaben im Store",
        blocks: [
          {
            type: "p",
            text: "Jede App muss im Store folgende Angaben machen („Datenangaben“):",
          },
          {
            type: "ul",
            items: [
              "ob die App personenbezogene Daten erhebt, verarbeitet oder teilt;",
              "welche Datenkategorien betroffen sind;",
              "Zwecke der Verarbeitung;",
              "ob Daten an Dritte oder in Drittländer übermittelt werden;",
              "Kontaktmöglichkeit für Datenschutzanfragen.",
            ],
          },
          {
            type: "p",
            text: "Unrichtige oder unvollständige Datenangaben gelten als Verstoß gegen die Entwicklervereinbarung und können zur Ablehnung oder Entfernung der App führen.",
          },
        ],
      },
      {
        id: "kinder",
        title: "Apps für Kinder",
        blocks: [
          {
            type: "p",
            text: "Apps, die sich an Kinder richten, müssen die Vorschriften des Art. 8 DSGVO einhalten (Einwilligung durch den Träger der elterlichen Verantwortung, Altersgrenzen nach nationalem Recht) sowie die Richtlinie (EU) 2018/1808 bzw. die nationalen Jugendschutzvorschriften beachten. Apps für Kinder dürfen keine Werbung mit Verhaltens- oder Profilbildung enthalten, die auf Kinder abzielt, und keine unangemessenen Daten erheben.",
          },
        ],
      },
      {
        id: "durchsetzung",
        title: "Durchsetzung",
        blocks: [
          {
            type: "p",
            text: "Verstöße gegen diese Anforderungen können zur Ablehnung oder Entfernung der App, zur Sperrung des Entwicklerkontos und — bei rechtswidriger Datenverarbeitung — zur Meldung an die zuständige Datenschutz-Aufsichtsbehörde führen. Fragen: " + company.email + ".",
          },
        ],
      },
    ],
  },
  en: {
    title: "App Privacy Requirements (rumahl Store)",
    subtitle:
      "Mandatory privacy and GDPR obligations for developers publishing Apps in the rumahl Store.",
    effective: "2026-08-20",
    updated: "2026-08-20",
    version: "1.0",
    sections: [
      {
        id: "applicability",
        title: "Applicability",
        blocks: [
          {
            type: "p",
            text: "These requirements apply to all Apps in the rumahl Store that process personal data — regardless of whether the processing takes place locally on the device, on the developer's servers or with third parties. They complement the Developer Agreement and the App Review Guidelines.",
          },
        ],
      },
      {
        id: "controller",
        title: "The developer as controller",
        blocks: [
          {
            type: "p",
            text: "The developer is an independent controller within the meaning of Art. 4(7) GDPR for the data processing performed by their App, unless the processing is exceptionally attributable to rumahl (e.g. where we process data on behalf of the developer). This responsibility cannot be transferred to the Store.",
          },
        ],
      },
      {
        id: "minimization",
        title: "Data minimization and transparency",
        blocks: [
          {
            type: "ul",
            items: [
              "Collect only personal data strictly required for the App's functionality (Art. 5(1)(c) GDPR);",
              "Process data only for specified, explicit and legitimate purposes (Art. 5(1)(b) GDPR);",
              "Establish a legal basis for each processing operation under Art. 6 GDPR (for consent: Art. 7 GDPR, revocable at any time);",
              "Inform users before collection in accordance with Arts. 13/14 GDPR about the controller, purposes, legal bases, recipients, retention period and rights;",
              "Publish a privacy policy and provide it in the Store together with your App's data disclosures.",
            ],
          },
        ],
      },
      {
        id: "obligations",
        title: "Specific GDPR obligations",
        blocks: [
          {
            type: "ul",
            items: [
              "Data subject rights: access, rectification, erasure, restriction, data portability, objection (Arts. 15–21 GDPR) — including a clear contact channel and procedures for deleting accounts and data;",
              "Processors: contracts under Art. 28 GDPR where third parties process data on your behalf;",
              "Data breaches: notification to the supervisory authority within 72 hours and information of data subjects (Arts. 33/34 GDPR);",
              "Records of processing activities (Art. 30 GDPR), unless you are covered by the exemption for small enterprises;",
              "Data protection by design and by default (Art. 25 GDPR);",
              "Security of processing (Art. 32 GDPR): encryption, access controls, secure development.",
            ],
          },
        ],
      },
      {
        id: "sensitive",
        title: "Special categories of data",
        blocks: [
          {
            type: "p",
            text: "Processing special categories of personal data (Art. 9 GDPR: e.g. health, religion, political opinion, biometric data) requires an explicit legal basis under Art. 9(2) GDPR. Apps processing such data must disclose and justify this in the review process. Video surveillance in the home (e.g. camera Apps) is additionally subject to national provisions (e.g. Section 4 BDSG).",
          },
        ],
      },
      {
        id: "sdks",
        title: "Third-party SDKs and services",
        blocks: [
          {
            type: "p",
            text: "If your App integrates third-party SDKs or services (e.g. analytics, crash reporting, advertising or AI services), you must:",
          },
          {
            type: "ul",
            items: [
              "disclose them in the review process and in the privacy policy;",
              "ensure that the integration is data-protection-compliant (in particular no unlawful transfers to third countries without safeguards under Arts. 44 et seq. GDPR);",
              "carry out transfers to third countries only with appropriate safeguards (e.g. adequacy decision or standard contractual clauses);",
              "offer users a privacy-friendly alternative where the SDK is not required for the core functionality.",
            ],
          },
        ],
      },
      {
        id: "disclosures",
        title: "Store disclosures",
        blocks: [
          {
            type: "p",
            text: "Every App must provide the following information in the Store (“data disclosures”):",
          },
          {
            type: "ul",
            items: [
              "whether the App collects, processes or shares personal data;",
              "which data categories are affected;",
              "the purposes of the processing;",
              "whether data is transferred to third parties or third countries;",
              "a contact channel for privacy inquiries.",
            ],
          },
          {
            type: "p",
            text: "Incorrect or incomplete data disclosures constitute a breach of the Developer Agreement and may lead to the rejection or removal of the App.",
          },
        ],
      },
      {
        id: "children",
        title: "Apps for children",
        blocks: [
          {
            type: "p",
            text: "Apps directed at children must comply with Art. 8 GDPR (consent by the holder of parental responsibility, age thresholds under national law) as well as Directive (EU) 2018/1808 and national youth protection rules. Apps for children must not contain behavioural or profiling-based advertising targeting children and must not collect inappropriate data.",
          },
        ],
      },
      {
        id: "enforcement",
        title: "Enforcement",
        blocks: [
          {
            type: "p",
            text: "Violations of these requirements may lead to the rejection or removal of the App, suspension of the developer account and — in the case of unlawful data processing — a report to the competent data protection supervisory authority. Questions: " + company.email + ".",
          },
        ],
      },
    ],
  },
};
