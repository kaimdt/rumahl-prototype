import type { BilingualDoc } from "@/lib/legal/types";
import { company } from "@/lib/legal/company";

/**
 * App Content Policy — prohibited and regulated content in the rumahl Store,
 * including the DSA notice-and-action mechanism and enforcement.
 */
export const contentPolicy: BilingualDoc = {
  de: {
    title: "App-Inhaltsrichtlinie (rumahl Store)",
    subtitle:
      "Welche Inhalte im rumahl Store unzulässig sind, wie du Verstöße meldest und welche Maßnahmen wir ergreifen (DSA-konform).",
    effective: "2026-08-20",
    updated: "2026-08-20",
    version: "1.0",
    sections: [
      {
        id: "geltungsbereich",
        title: "Geltungsbereich",
        blocks: [
          {
            type: "p",
            text: "Diese Richtlinie gilt für alle Inhalte im rumahl Store: Apps, App-Beschreibungen, Screenshots, Namen, Metadaten, In-App-Inhalte, Updates und Nutzerbeiträge (z. B. Bewertungen). Sie gilt für Entwickler und Nutzer gleichermaßen.",
          },
        ],
      },
      {
        id: "verboten",
        title: "Verbotene Inhalte",
        blocks: [
          {
            type: "p",
            text: "Folgende Inhalte sind im rumahl Store ausnahmslos verboten:",
          },
          {
            type: "ul",
            items: [
              "Rechtswidrige Inhalte im Sinne des Art. 3 lit. h DSA, also Inhalte, die gegen das Recht der EU oder der Mitgliedstaaten verstoßen (z. B. Strafrecht, Hasskriminalität, Aufrufe zu Gewalt);",
              "Inhalte, die Kinder oder Minderjährige sexuell darstellen oder ausbeuten (CSAM) — diese werden umgehend entfernt und bei den zuständigen Behörden gemeldet;",
              "Hassrede: Inhalte, die Personen oder Gruppen aufgrund von Rasse, Ethnie, Religion, Geschlecht, sexueller Orientierung, Behinderung oder anderer geschützter Merkmale angreifen;",
              "Belästigung, Mobbing, Drohungen, Stalking oder die Verbreitung intimer Bilder ohne Einwilligung;",
              "Malware, Exploits, Phishing, Betrug, Identitätsdiebstahl und betrügerische Schemata (z. B. gefälschte Krypto- oder Investmentangebote);",
              "Täuschende oder irreführende Inhalte, einschließlich gefälschter Bewertungen, irreführender Funktionen oder Deepfakes ohne Kennzeichnung;",
              "Inhalte, die Urheber-, Marken-, Patent- oder Geschäftsgeheimnisrechte Dritter verletzen (einschließlich unlizenzierter Streaming- oder Torrent-Apps);",
              "Unaufgeforderte Massenkommunikation (Spam), Scraping-Tools für illegale Zwecke und Handel mit gestohlenen Daten;",
              "Inhalte zur Unterstützung von Terrorismus oder organisierter Kriminalität.",
            ],
          },
        ],
      },
      {
        id: "reguliert",
        title: "Regulierte Inhalte",
        blocks: [
          {
            type: "p",
            text: "Inhalte, die nicht verboten, aber reguliert sind, dürfen nur veröffentlicht werden, wenn die App eine Altersbeschränkung angibt und geltende Rechtsvorschriften einhält:",
          },
          {
            type: "ul",
            items: [
              "sexuell explizite oder pornografische Inhalte (nur für Erwachsene);",
              "Gewaltdarstellungen und Horrorinhalte;",
              "Gambling, Glücksspiel und Wetten — nur mit gültiger Lizenz und Altersverifikation, wo gesetzlich erforderlich;",
              "Gesundheits-, Medizin- und Finanzinhalte — nur ohne irreführende Versprechen und unter Beachtung der Werberegeln.",
            ],
          },
        ],
      },
      {
        id: "ugc",
        title: "Nutzerinhalte in Apps",
        blocks: [
          {
            type: "p",
            text: "Apps, die Nutzerinhalte (User-Generated Content) ermöglichen, müssen wirksame Moderationsmechanismen bereitstellen: Meldefunktion, Prüfung gemeldeter Inhalte und die Möglichkeit, rechtswidrige Inhalte zu entfernen. Entwickler sind für die Einhaltung des DSA in Bezug auf ihre eigenen Inhalte-Dienste verantwortlich.",
          },
        ],
      },
      {
        id: "meldung",
        title: "Meldung von Verstößen (DSA)",
        blocks: [
          {
            type: "p",
            text: "Du kannst mutmaßlich rechtswidrige oder richtlinienwidrige Inhalte melden:",
          },
          {
            type: "ul",
            items: [
              "E-Mail: " + company.email + " (Betreff „DSA Notice“), oder",
              "Meldeformular im Store: [Platzhalter: URL].",
            ],
          },
          {
            type: "p",
            text: "Meldungen sollten enthalten: eine präzise Angabe des Inhalts (App-Name, URL, Fundstelle), eine Begründung der Rechtswidrigkeit bzw. des Richtlinienverstoßes, deine Kontaktdaten sowie — bei Urheberrechtsverletzungen — eine Erklärung über deine Rechte. Anonyme Meldungen sind möglich; sie können die Bearbeitung erschweren.",
          },
        ],
      },
      {
        id: "massnahmen",
        title: "Maßnahmen",
        blocks: [
          {
            type: "p",
            text: "Bei Verstößen ergreifen wir angemessene und verhältnismäßige Maßnahmen (Art. 16 DSA):",
          },
          {
            type: "ul",
            items: [
              "Entfernung oder Sperrung des Zugangs zu den betroffenen Inhalten;",
              "Verwarnung des Entwicklers mit Aufforderung zur Nachbesserung;",
              "zeitweise oder dauerhafte Sperrung von Konten bei schwerwiegenden oder wiederholten Verstößen;",
              "Meldung an Strafverfolgungsbehörden bei Straftaten (z. B. CSAM, Terrorismus).",
            ],
          },
        ],
      },
      {
        id: "rechtsmittel",
        title: "Rechtsmittel",
        blocks: [
          {
            type: "p",
            text: "Betroffene (Entwickler oder Nutzer) können Entscheidungen innerhalb von 6 Monaten über das interne Beschwerdeverfahren (Art. 20 DSA) anfechten: [Platzhalter: URL des Beschwerdeverfahrens]. Darüber hinaus besteht Zugang zu außergerichtlicher Streitbeilegung gemäß Art. 21 DSA sowie der Rechtsweg zu den zuständigen Gerichten.",
          },
        ],
      },
      {
        id: "kontakt",
        title: "Kontakt",
        blocks: [
          {
            type: "p",
            text: "Fragen zu dieser Richtlinie: " + company.email + ".",
          },
        ],
      },
    ],
  },
  en: {
    title: "App Content Policy (rumahl Store)",
    subtitle:
      "What content is not permitted in the rumahl Store, how to report violations and which measures we take (DSA-compliant).",
    effective: "2026-08-20",
    updated: "2026-08-20",
    version: "1.0",
    sections: [
      {
        id: "scope",
        title: "Scope",
        blocks: [
          {
            type: "p",
            text: "This policy applies to all content in the rumahl Store: Apps, App descriptions, screenshots, names, metadata, in-app content, updates and user contributions (e.g. ratings). It applies to developers and users alike.",
          },
        ],
      },
      {
        id: "prohibited",
        title: "Prohibited content",
        blocks: [
          {
            type: "p",
            text: "The following content is strictly prohibited in the rumahl Store:",
          },
          {
            type: "ul",
            items: [
              "Illegal content within the meaning of Art. 3(h) DSA, i.e. content that violates EU law or the law of the Member States (e.g. criminal law, hate crime, incitement to violence);",
              "Content that sexually depicts or exploits children or minors (CSAM) — such content is removed immediately and reported to the competent authorities;",
              "Hate speech: content that attacks persons or groups on the basis of race, ethnicity, religion, gender, sexual orientation, disability or other protected characteristics;",
              "Harassment, bullying, threats, stalking or the distribution of intimate images without consent;",
              "Malware, exploits, phishing, fraud, identity theft and fraudulent schemes (e.g. fake crypto or investment offers);",
              "Deceptive or misleading content, including fake ratings, misleading functionality or unlabelled deepfakes;",
              "Content that infringes the copyright, trademark, patent or trade secret rights of third parties (including unlicensed streaming or torrent Apps);",
              "Unsolicited mass communication (spam), scraping tools for illegal purposes and trade in stolen data;",
              "Content supporting terrorism or organized crime.",
            ],
          },
        ],
      },
      {
        id: "regulated",
        title: "Regulated content",
        blocks: [
          {
            type: "p",
            text: "Content that is not prohibited but regulated may only be published if the App states an age restriction and complies with applicable law:",
          },
          {
            type: "ul",
            items: [
              "sexually explicit or pornographic content (adults only);",
              "depictions of violence and horror content;",
              "gambling and betting — only with a valid license and age verification where required by law;",
              "health, medical and financial content — only without misleading promises and in compliance with advertising rules.",
            ],
          },
        ],
      },
      {
        id: "ugc",
        title: "User-generated content in Apps",
        blocks: [
          {
            type: "p",
            text: "Apps that enable user-generated content must provide effective moderation mechanisms: a reporting function, review of reported content and the ability to remove illegal content. Developers are responsible for complying with the DSA with regard to their own content services.",
          },
        ],
      },
      {
        id: "reporting",
        title: "Reporting violations (DSA)",
        blocks: [
          {
            type: "p",
            text: "You can report allegedly illegal or policy-violating content:",
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
            text: "Notices should include: a precise indication of the content (App name, URL, location), a statement of reasons for the alleged illegality or policy violation, your contact details and — for copyright infringements — a declaration of your rights. Anonymous notices are possible; they may make processing more difficult.",
          },
        ],
      },
      {
        id: "measures",
        title: "Measures",
        blocks: [
          {
            type: "p",
            text: "In case of violations, we take appropriate and proportionate measures (Art. 16 DSA):",
          },
          {
            type: "ul",
            items: [
              "removal of or blocking access to the content concerned;",
              "warning the developer with a request to remedy the issue;",
              "temporary or permanent suspension of accounts for serious or repeated violations;",
              "reporting criminal offences (e.g. CSAM, terrorism) to law enforcement authorities.",
            ],
          },
        ],
      },
      {
        id: "appeals",
        title: "Appeals",
        blocks: [
          {
            type: "p",
            text: "Affected parties (developers or users) may challenge decisions within 6 months through the internal complaint mechanism (Art. 20 DSA): [Placeholder: URL of the complaint procedure]. In addition, access to out-of-court dispute settlement under Art. 21 DSA and to the competent courts is available.",
          },
        ],
      },
      {
        id: "contact",
        title: "Contact",
        blocks: [
          {
            type: "p",
            text: "Questions about this policy: " + company.email + ".",
          },
        ],
      },
    ],
  },
};
