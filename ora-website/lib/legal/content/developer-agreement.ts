import type { BilingualDoc } from "@/lib/legal/types";
import { company, legalName } from "@/lib/legal/company";

/**
 * rumahl Store Developer Agreement — agreement between rumahl and app
 * developers, covering review, data protection (GDPR), licensing, takedowns
 * (DSA) and termination.
 */
export const developerAgreement: BilingualDoc = {
  de: {
    title: "Entwicklervereinbarung (rumahl Store)",
    subtitle:
      "Die Vereinbarung zwischen Entwicklern und rumahl für die Veröffentlichung von Apps im rumahl Store — inklusive Review-Prozess, Datenschutzpflichten und DSA-Compliance.",
    effective: "2026-08-20",
    updated: "2026-08-20",
    version: "1.0",
    sections: [
      {
        id: "parteien",
        title: "Parteien und Zweck",
        blocks: [
          {
            type: "p",
            text: "Diese Entwicklervereinbarung („Vereinbarung“) regelt das Verhältnis zwischen dir („Entwickler“) und " + legalName + " („rumahl“) für die Veröffentlichung und den Vertrieb von Apps und Plugins für rumahl OS über den rumahl Store. Durch die Registrierung als Entwickler und die Einreichung einer App akzeptierst du diese Vereinbarung.",
          },
        ],
      },
      {
        id: "berechtigung",
        title: "Berechtigung und Registrierung",
        blocks: [
          {
            type: "p",
            text: "Du musst mindestens 18 Jahre alt sein und über die volle Rechtsfähigkeit verfügen, um Entwickler zu werden. Juristische Personen handeln durch ihre vertretungsberechtigten Organe. Du verpflichtest dich, bei der Registrierung wahrheitsgemäße und vollständige Angaben zu machen (Name, Anschrift, E-Mail, ggf. Umsatzsteuer-Identifikationsnummer) und diese aktuell zu halten. Wir können die Registrierung ablehnen, insbesondere bei Vorstrafen im Zusammenhang mit Betrug, Malware oder Verstößen gegen Datenschutzrecht.",
          },
        ],
      },
      {
        id: "einreichung",
        title: "Einreichung und Review",
        blocks: [
          {
            type: "p",
            text: "Apps werden über das Entwickler-Dashboard eingereicht und vor Veröffentlichung nach unseren App-Review-Richtlinien, der App-Inhaltsrichtlinie und den App-Datenschutzanforderungen geprüft. Wir können die Veröffentlichung ablehnen oder eine überarbeitete Fassung verlangen, wenn die App den Richtlinien nicht entspricht. Die Review-Dauer beträgt in der Regel [X] Werktage. Eine Ablehnung begründen wir schriftlich; du kannst innerhalb von 14 Tagen Einspruch einlegen.",
          },
        ],
      },
      {
        id: "zusicherungen",
        title: "Zusicherungen des Entwicklers",
        blocks: [
          {
            type: "p",
            text: "Du sicherst zu und gewährleistest, dass:",
          },
          {
            type: "ul",
            items: [
              "du berechtigt bist, die App einzureichen und alle Rechte daran (insbesondere Urheberrechte, Lizenzen für eingebundene Komponenten) innehatst;",
              "die App keine Rechte Dritter verletzt (insbesondere Urheber-, Marken-, Patent- und Persönlichkeitsrechte);",
              "die App keine Malware, Hintertüren, versteckte Datensammlung oder sonstige schädliche Funktionalität enthält;",
              "die App den App-Review-Richtlinien, der Inhaltsrichtlinie, den Datenschutzanforderungen und allen geltenden Gesetzen entspricht (einschließlich DSGVO, DSA und Verbraucherschutzrecht);",
              "die im Store angezeigten Angaben (Beschreibung, Screenshots, Preise, Datenschutzangaben) wahrheitsgemäß und vollständig sind.",
            ],
          },
        ],
      },
      {
        id: "datenschutz",
        title: "Datenschutzpflichten (DSGVO)",
        blocks: [
          {
            type: "p",
            text: "Soweit deine App personenbezogene Daten verarbeitet, bist du dafür eigenständig Verantwortlicher im Sinne der DSGVO. Du verpflichtest dich insbesondere:",
          },
          {
            type: "ul",
            items: [
              "die Grundsätze des Art. 5 DSGVO einzuhalten (Rechtmäßigkeit, Transparenz, Zweckbindung, Datenminimierung, Speicherbegrenzung, Integrität und Vertraulichkeit);",
              "eine Rechtsgrundlage für jede Verarbeitung gemäß Art. 6 DSGVO zu haben und betroffene Personen gemäß Art. 13/14 DSGVO zu informieren;",
              "eine Datenschutzerklärung für deine App bereitzustellen und diese im Store zu verlinken;",
              "die Rechte betroffener Personen (Art. 15–22 DSGVO) zu gewährleisten;",
              "Auftragsverarbeiter nur auf Grundlage eines Vertrags gemäß Art. 28 DSGVO einzusetzen;",
              "Datenpannen gemäß Art. 33/34 DSGVO zu melden;",
              "die App-Datenschutzanforderungen des Stores einzuhalten.",
            ],
          },
          {
            type: "note",
            text: "Soweit wir personenbezogene Daten im Zusammenhang mit dem Betrieb des Stores für dich verarbeiten (z. B. Fehlerberichte, die deine App an uns weiterleitet), handeln wir als Auftragsverarbeiter; die Details regelt eine separate Auftragsverarbeitungsvereinbarung gemäß Art. 28 DSGVO.",
          },
        ],
      },
      {
        id: "lizenzen",
        title: "Lizenzen",
        blocks: [
          {
            type: "p",
            text: "Du gewährst rumahl eine nicht-ausschließliche, weltweite, übertragbare, unterlizenzierbare Lizenz, die App zu hosten, zu reproduzieren, zu vertreiben und Nutzern im Rahmen des Stores zugänglich zu machen. Die Lizenz gilt für die Dauer dieser Vereinbarung und endet mit deren Beendigung, soweit nicht eine Fortführung zur Erfüllung gesetzlicher Pflichten oder zur Abwicklung bereits erfolgter Installationen erforderlich ist.",
          },
          {
            type: "p",
            text: "Endnutzer erwerben die Lizenz an deiner App von dir; du bist für die Lizenzbedingungen gegenüber den Nutzern verantwortlich. Der rumahl Store erhebt keine Rechte an deiner App über die vorstehend beschriebene Nutzung hinaus.",
          },
        ],
      },
      {
        id: "zahlungen",
        title: "Zahlungen und Umsatzbeteiligung",
        blocks: [
          {
            type: "p",
            text: "[Platzhalter: Sobald kostenpflichtige Apps oder In-App-Käufe unterstützt werden, werden hier Provisionssatz, Abrechnungszeitraum, Auszahlung, Umsatzsteuer (inkl. OSS-Verfahren für digitale Dienste) und Mindestauszahlungsbeträge beschrieben.] Kostenlose Apps können ohne Umsatzbeteiligung veröffentlicht werden.",
          },
        ],
      },
      {
        id: "entfernung",
        title: "Entfernung, Sperrung und Meldungen",
        blocks: [
          {
            type: "p",
            text: "Wir können Apps entfernen oder den Zugang sperren, wenn sie gegen diese Vereinbarung, die Store-Richtlinien oder geltendes Recht verstoßen, ein Sicherheitsrisiko darstellen oder wenn wir dazu gesetzlich verpflichtet sind (insbesondere nach dem DSA). Bei Meldungen rechtswidriger Inhalte (Notice-and-Action, Art. 16 DSA) informieren wir dich über die Entscheidung; du kannst dagegen über das interne Beschwerdeverfahren (Art. 20 DSA) vorgehen.",
          },
          {
            type: "p",
            text: "Bei schwerwiegenden oder wiederholten Verstößen können wir dein Entwicklerkonto suspendieren oder dauerhaft sperren. Bereits installierte Kopien der Apps bleiben beim Nutzer; Updates werden eingestellt.",
          },
        ],
      },
      {
        id: "freistellung",
        title: "Freistellung",
        blocks: [
          {
            type: "p",
            text: "Du stellst rumahl von allen Ansprüchen Dritter frei, die auf einer Verletzung von Zusicherungen aus dieser Vereinbarung, auf Rechtsverletzungen durch deine App oder auf einer Verletzung von Datenschutzrecht durch deine App beruhen, einschließlich angemessener Rechtsverteidigungskosten. Diese Freistellung entfällt, soweit die Rechtsverletzung auf von uns verursachten Änderungen der App beruht.",
          },
        ],
      },
      {
        id: "haftung",
        title: "Haftung",
        blocks: [
          {
            type: "p",
            text: "Wir haften unbeschränkt für Vorsatz, grobe Fahrlässigkeit, Verletzung von Leben, Körper oder Gesundheit sowie nach dem Produkthaftungsgesetz. Für einfache Fahrlässigkeit haften wir nur bei Verletzung wesentlicher Vertragspflichten, begrenzt auf den vertragstypischen, vorhersehbaren Schaden. Soweit du Verbraucher bist, gelten die zwingenden gesetzlichen Regelungen.",
          },
        ],
      },
      {
        id: "laufzeit",
        title: "Laufzeit und Kündigung",
        blocks: [
          {
            type: "p",
            text: "Diese Vereinbarung beginnt mit deiner Registrierung und gilt für unbestimmte Zeit. Du kannst sie jederzeit durch Entfernung deiner Apps und Löschung deines Entwicklerkontos kündigen. Wir können die Vereinbarung mit einer Frist von 30 Tagen kündigen oder bei schwerwiegenden Verstößen fristlos. Mit Beendigung werden deine Apps aus dem Store entfernt; bereits erfolgte Installationen bei Nutzern bleiben unberührt.",
          },
        ],
      },
      {
        id: "aenderungen",
        title: "Änderungen der Vereinbarung",
        blocks: [
          {
            type: "p",
            text: "Wir können diese Vereinbarung mit Wirkung für die Zukunft ändern und kündigen wesentliche Änderungen mindestens 30 Tage vor Inkrafttreten an. Wenn du nicht einverstanden bist, kannst du die Vereinbarung vor Inkrafttreten kündigen.",
          },
        ],
      },
      {
        id: "recht",
        title: "Anwendbares Recht und Kontakt",
        blocks: [
          {
            type: "p",
            text: "Auf diese Vereinbarung findet das Recht der Bundesrepublik Deutschland Anwendung. Für Verbraucher gelten zwingende Schutzbestimmungen ihres Aufenthaltsstaats innerhalb der EU. Gerichtsstand für Kaufleute ist unser Sitz. Fragen: " + company.email + ".",
          },
        ],
      },
    ],
  },
  en: {
    title: "Developer Agreement (rumahl Store)",
    subtitle:
      "The agreement between developers and rumahl for publishing Apps in the rumahl Store — including the review process, data protection obligations and DSA compliance.",
    effective: "2026-08-20",
    updated: "2026-08-20",
    version: "1.0",
    sections: [
      {
        id: "parties",
        title: "Parties and purpose",
        blocks: [
          {
            type: "p",
            text: "This Developer Agreement (the “Agreement”) governs the relationship between you (the “Developer”) and " + legalName + " (“rumahl”) for publishing and distributing Apps and plugins for rumahl OS through the rumahl Store. By registering as a developer and submitting an App, you accept this Agreement.",
          },
        ],
      },
      {
        id: "eligibility",
        title: "Eligibility and registration",
        blocks: [
          {
            type: "p",
            text: "You must be at least 18 years old and have full legal capacity to become a developer. Legal entities act through their authorized representatives. You agree to provide truthful and complete information when registering (name, address, email, VAT ID where applicable) and to keep it up to date. We may refuse registration, in particular in cases of prior convictions related to fraud, malware or data protection violations.",
          },
        ],
      },
      {
        id: "submission",
        title: "Submission and review",
        blocks: [
          {
            type: "p",
            text: "Apps are submitted through the developer dashboard and reviewed before publication in accordance with our App Review Guidelines, App Content Policy and App Privacy Requirements. We may refuse publication or require a revised version if the App does not comply with the policies. The review period is typically [X] business days. We state the reasons for a rejection in writing; you may appeal within 14 days.",
          },
        ],
      },
      {
        id: "warranties",
        title: "Developer warranties",
        blocks: [
          {
            type: "p",
            text: "You represent and warrant that:",
          },
          {
            type: "ul",
            items: [
              "you are entitled to submit the App and hold all rights to it (in particular copyrights and licenses for incorporated components);",
              "the App does not infringe the rights of third parties (in particular copyright, trademark, patent and personality rights);",
              "the App contains no malware, backdoors, hidden data collection or other harmful functionality;",
              "the App complies with the App Review Guidelines, the Content Policy, the Privacy Requirements and all applicable laws (including the GDPR, the DSA and consumer protection law);",
              "the information displayed in the Store (description, screenshots, prices, privacy information) is truthful and complete.",
            ],
          },
        ],
      },
      {
        id: "data-protection",
        title: "Data protection obligations (GDPR)",
        blocks: [
          {
            type: "p",
            text: "Where your App processes personal data, you are an independent controller within the meaning of the GDPR. You agree in particular to:",
          },
          {
            type: "ul",
            items: [
              "comply with the principles of Art. 5 GDPR (lawfulness, transparency, purpose limitation, data minimization, storage limitation, integrity and confidentiality);",
              "have a legal basis for each processing operation under Art. 6 GDPR and inform data subjects in accordance with Art. 13/14 GDPR;",
              "provide a privacy policy for your App and link it in the Store;",
              "ensure the rights of data subjects (Arts. 15–22 GDPR);",
              "engage processors only on the basis of a contract under Art. 28 GDPR;",
              "report data breaches in accordance with Arts. 33/34 GDPR;",
              "comply with the App Privacy Requirements of the Store.",
            ],
          },
          {
            type: "note",
            text: "Where we process personal data for you in connection with the operation of the Store (e.g. error reports that your App forwards to us), we act as a processor; the details are governed by a separate data processing agreement in accordance with Art. 28 GDPR.",
          },
        ],
      },
      {
        id: "licenses",
        title: "Licenses",
        blocks: [
          {
            type: "p",
            text: "You grant rumahl a non-exclusive, worldwide, transferable, sublicensable license to host, reproduce, distribute and make the App available to users in the context of the Store. The license applies for the duration of this Agreement and ends upon its termination, unless continued use is required to fulfil statutory obligations or to support installations already made.",
          },
          {
            type: "p",
            text: "End users acquire the license to your App from you; you are responsible for the license terms towards users. The rumahl Store does not acquire rights to your App beyond the use described above.",
          },
        ],
      },
      {
        id: "payments",
        title: "Payments and revenue share",
        blocks: [
          {
            type: "p",
            text: "[Placeholder: Once paid Apps or in-app purchases are supported, commission rate, billing period, payout, VAT (including the OSS scheme for digital services) and minimum payout thresholds will be described here.] Free Apps may be published without revenue share.",
          },
        ],
      },
      {
        id: "removal",
        title: "Removal, suspension and notices",
        blocks: [
          {
            type: "p",
            text: "We may remove Apps or block access if they violate this Agreement, the Store policies or applicable law, pose a security risk, or if we are legally required to do so (in particular under the DSA). Upon notices of illegal content (notice-and-action, Art. 16 DSA), we inform you about the decision; you may challenge it through the internal complaint mechanism (Art. 20 DSA).",
          },
          {
            type: "p",
            text: "In case of serious or repeated violations, we may suspend or permanently ban your developer account. Copies of Apps already installed remain with the user; updates are discontinued.",
          },
        ],
      },
      {
        id: "indemnification",
        title: "Indemnification",
        blocks: [
          {
            type: "p",
            text: "You indemnify rumahl against all third-party claims arising from a breach of warranties under this Agreement, from legal infringements caused by your App or from violations of data protection law by your App, including reasonable legal defence costs. This indemnification does not apply to the extent the infringement results from modifications of the App made by us.",
          },
        ],
      },
      {
        id: "liability",
        title: "Liability",
        blocks: [
          {
            type: "p",
            text: "We are liable without limitation for intent, gross negligence, injury to life, body or health, and under the German Product Liability Act. For slight negligence we are liable only for breach of material contractual obligations, limited to the typical, foreseeable damage. Where you are a consumer, mandatory statutory provisions apply.",
          },
        ],
      },
      {
        id: "term",
        title: "Term and termination",
        blocks: [
          {
            type: "p",
            text: "This Agreement begins with your registration and is concluded for an indefinite period. You may terminate it at any time by removing your Apps and deleting your developer account. We may terminate the Agreement with 30 days' notice or without notice in case of serious violations. Upon termination, your Apps are removed from the Store; installations already made by users remain unaffected.",
          },
        ],
      },
      {
        id: "changes",
        title: "Changes to the Agreement",
        blocks: [
          {
            type: "p",
            text: "We may amend this Agreement with effect for the future and will announce material changes at least 30 days before they take effect. If you do not agree, you may terminate the Agreement before the changes take effect.",
          },
        ],
      },
      {
        id: "law",
        title: "Governing law and contact",
        blocks: [
          {
            type: "p",
            text: "This Agreement is governed by the laws of the Federal Republic of Germany. For consumers, mandatory protective provisions of their state of residence within the EU apply. For merchants, our registered office is the place of jurisdiction. Questions: " + company.email + ".",
          },
        ],
      },
    ],
  },
};
