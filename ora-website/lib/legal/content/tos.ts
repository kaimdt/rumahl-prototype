import type { BilingualDoc } from "@/lib/legal/types";
import { company, legalName } from "@/lib/legal/company";

/**
 * Website Terms of Service — governs use of the rumahl website
 * (rumahl.com and related web properties, excluding the rumahl Store,
 * which is governed by its own terms).
 */
export const tos: BilingualDoc = {
  de: {
    title: "Nutzungsbedingungen (Website)",
    subtitle:
      "Diese Bedingungen regeln die Nutzung der rumahl-Website. Für den rumahl Store, rumahl OS und den ORA-Assistenten gelten eigene Dokumente.",
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
            text: `Diese Nutzungsbedingungen („Bedingungen“) regeln deine Nutzung der Website ${company.websiteUrl} sowie aller damit verbundenen Unterseiten (zusammen die „Website“), betrieben von ${legalName} („rumahl“, „wir“, „uns“).`,
          },
          {
            type: "p",
            text: "Für den rumahl Store (https://store.rumahl.com) gelten die Nutzungsbedingungen des Stores; für die Software rumahl OS gelten die Software-Lizenzbedingungen; für die KI-Assistenten ORA gelten die jeweiligen Nutzungsbedingungen des Produkts. Diese Dokumente verweisen wechselseitig aufeinander.",
          },
          {
            type: "p",
            text: "Mit dem Zugriff auf oder der Nutzung der Website erklärst du dich mit diesen Bedingungen einverstanden. Wenn du damit nicht einverstanden bist, nutze die Website bitte nicht.",
          },
        ],
      },
      {
        id: "aenderungen",
        title: "Änderungen dieser Bedingungen",
        blocks: [
          {
            type: "p",
            text: "Wir können diese Bedingungen jederzeit mit Wirkung für die Zukunft ändern. Wesentliche Änderungen kündigen wir auf der Website angemessen an, bevor sie in Kraft treten. Die fortgesetzte Nutzung der Website nach Inkrafttreten der Änderungen gilt als Zustimmung zu den geänderten Bedingungen.",
          },
        ],
      },
      {
        id: "zulaessige-nutzung",
        title: "Zulässige Nutzung",
        blocks: [
          {
            type: "p",
            text: "Du darfst die Website für persönliche und nicht-kommerzielle Zwecke nutzen. Unabhängig vom Zweck ist dir untersagt:",
          },
          {
            type: "ul",
            items: [
              "die Website zu stören, zu überlasten oder zu manipulieren (einschließlich automatisierter Zugriffe, Scraping oder Flooding, soweit nicht ausdrücklich gestattet);",
              "unbefugt auf Systeme, Konten oder Daten Dritter zuzugreifen;",
              "Inhalte zu verbreiten, die rechtswidrig, beleidigend, belästigend, diffamierend, betrügerisch oder in sonstiger Weise unzulässig sind;",
              "Malware, Viren oder andere schädliche Software zu verbreiten;",
              "die Website oder ihre Inhalte zu verändern, zurückzuentwickeln oder darauf basierend Wettbewerbsprodukte zu entwickeln;",
              "sich als andere Person oder Organisation auszugeben.",
            ],
          },
        ],
      },
      {
        id: "konten",
        title: "Konten",
        blocks: [
          {
            type: "p",
            text: "Sofern die Website Konten anbietet (z. B. für Community, Foren oder den Store), bist du für die Vertraulichkeit deiner Zugangsdaten verantwortlich. Du verpflichtest dich, uns über unbefugte Nutzung deines Kontos unverzüglich zu informieren. Wir können Konten sperren oder löschen, wenn diese Bedingungen oder geltendes Recht verletzt werden.",
          },
        ],
      },
      {
        id: "geistiges-eigentum",
        title: "Geistiges Eigentum",
        blocks: [
          {
            type: "p",
            text: "Die Website einschließlich Texten, Grafiken, Logos, Marken, Screenshots, Videos und Software-Komponenten ist — soweit nicht ausdrücklich anders gekennzeichnet — urheberrechtlich geschützt und gehört uns oder unseren Lizenzgebern. Die Verwendung der Marke „rumahl“ und der Logos bedarf unserer vorherigen schriftlichen Zustimmung.",
          },
          {
            type: "p",
            text: "Open-Source-Software, die auf der Website vorgestellt oder verlinkt wird, unterliegt ausschließlich ihren jeweiligen Open-Source-Lizenzen (z. B. MIT) und nicht diesen Bedingungen.",
          },
        ],
      },
      {
        id: "fremde-inhalte",
        title: "Fremde Inhalte und Links",
        blocks: [
          {
            type: "p",
            text: "Die Website kann Links zu Websites und Inhalten Dritter enthalten (z. B. Dokumentationen, Repositories, Community-Plattformen). Für diese Inhalte sind ausschließlich die jeweiligen Dritten verantwortlich. Wir übernehmen keine Haftung für fremde Inhalte, übernehmen sie uns aber auch nicht zu eigen.",
          },
        ],
      },
      {
        id: "haftung",
        title: "Haftung",
        blocks: [
          {
            type: "p",
            text: "Wir haften unbeschränkt für Vorsatz und grobe Fahrlässigkeit, für Schäden aus der Verletzung des Lebens, des Körpers oder der Gesundheit sowie nach dem Produkthaftungsgesetz. Für einfache Fahrlässigkeit haften wir nur bei Verletzung wesentlicher Vertragspflichten (Kardinalpflichten), begrenzt auf den vertragstypischen, vorhersehbaren Schaden.",
          },
          {
            type: "p",
            text: "Für Verbraucher im Sinne des § 13 BGB bleiben zwingende gesetzliche Haftungsregelungen unberührt. Die vorstehenden Haftungsbeschränkungen gelten auch für unsere gesetzlichen Vertreter und Erfüllungsgehilfen.",
          },
          {
            type: "note",
            text: "Die Website wird ohne Gewährleistung bereitgestellt. Insbesondere gewährleisten wir nicht, dass die Website ununterbrochen oder fehlerfrei verfügbar ist. Die Website dient der Information über rumahl OS und verwandte Produkte; sie ist kein Angebot zum Abschluss eines Vertrags, soweit nicht ausdrücklich anders angegeben.",
          },
        ],
      },
      {
        id: "kuendigung",
        title: "Beendigung der Nutzung",
        blocks: [
          {
            type: "p",
            text: "Wir können den Zugang zur Website jederzeit einschränken, aussetzen oder beenden, wenn wir dies für erforderlich halten, insbesondere bei Verstößen gegen diese Bedingungen oder geltendes Recht. Du kannst die Nutzung der Website jederzeit einstellen.",
          },
        ],
      },
      {
        id: "anwendbares-recht",
        title: "Anwendbares Recht und Gerichtsstand",
        blocks: [
          {
            type: "p",
            text: "Auf diese Bedingungen und die Nutzung der Website findet das Recht der Bundesrepublik Deutschland Anwendung, unter Ausschluss des UN-Kaufrechts (CISG). Für Verbraucher gelten die zwingenden Schutzbestimmungen des Rechts des Staates, in dem sie ihren gewöhnlichen Aufenthalt haben (innerhalb der Europäischen Union), unabhängig von dieser Rechtswahl.",
          },
          {
            type: "p",
            text: "Soweit du Kaufmann, juristische Person des öffentlichen Rechts oder öffentlich-rechtliches Sondervermögen bist, ist unser Sitz Gerichtsstand für alle Streitigkeiten aus diesen Bedingungen.",
          },
        ],
      },
      {
        id: "schlussbestimmungen",
        title: "Schlussbestimmungen",
        blocks: [
          {
            type: "p",
            text: "Sollte eine Bestimmung dieser Bedingungen unwirksam sein oder werden, bleibt die Wirksamkeit der übrigen Bestimmungen unberührt. An die Stelle der unwirksamen Bestimmung tritt die gesetzliche Regelung.",
          },
          {
            type: "p",
            text: `Bei Fragen zu diesen Bedingungen wende dich an ${company.email}.`,
          },
        ],
      },
    ],
  },
  en: {
    title: "Terms of Service (Website)",
    subtitle:
      "These terms govern your use of the rumahl website. The rumahl Store, rumahl OS and the ORA assistant are governed by their own documents.",
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
            text: `These Terms of Service (“Terms”) govern your use of the website ${company.websiteUrl} and all related subpages (together, the “Website”), operated by ${legalName} (“rumahl”, “we”, “us”).`,
          },
          {
            type: "p",
            text: "The rumahl Store (https://store.rumahl.com) is governed by the rumahl Store Terms of Service; the rumahl OS software is governed by the rumahl OS Software Terms Agreement; the ORA AI assistant is governed by its respective product terms. These documents refer to each other.",
          },
          {
            type: "p",
            text: "By accessing or using the Website you agree to these Terms. If you do not agree, please do not use the Website.",
          },
        ],
      },
      {
        id: "changes",
        title: "Changes to these Terms",
        blocks: [
          {
            type: "p",
            text: "We may amend these Terms at any time with effect for the future. We will announce material changes on the Website in a reasonable manner before they take effect. Your continued use of the Website after the changes take effect constitutes acceptance of the amended Terms.",
          },
        ],
      },
      {
        id: "acceptable-use",
        title: "Acceptable use",
        blocks: [
          {
            type: "p",
            text: "You may use the Website for personal, non-commercial purposes. Regardless of purpose, you must not:",
          },
          {
            type: "ul",
            items: [
              "disrupt, overload or manipulate the Website (including automated access, scraping or flooding, unless expressly permitted);",
              "gain unauthorized access to systems, accounts or data of third parties;",
              "distribute content that is unlawful, offensive, harassing, defamatory, fraudulent or otherwise objectionable;",
              "distribute malware, viruses or other harmful software;",
              "modify, reverse engineer or build competing products based on the Website or its content;",
              "impersonate other persons or organizations.",
            ],
          },
        ],
      },
      {
        id: "accounts",
        title: "Accounts",
        blocks: [
          {
            type: "p",
            text: "Where the Website offers accounts (e.g. for community, forums or the Store), you are responsible for keeping your credentials confidential. You agree to inform us immediately of any unauthorized use of your account. We may suspend or delete accounts that violate these Terms or applicable law.",
          },
        ],
      },
      {
        id: "ip",
        title: "Intellectual property",
        blocks: [
          {
            type: "p",
            text: "The Website, including texts, graphics, logos, trademarks, screenshots, videos and software components, is — unless expressly marked otherwise — protected by copyright and belongs to us or our licensors. Any use of the “rumahl” trademark and logos requires our prior written consent.",
          },
          {
            type: "p",
            text: "Open-source software presented or linked on the Website is governed exclusively by its respective open-source licenses (e.g. MIT) and not by these Terms.",
          },
        ],
      },
      {
        id: "third-party",
        title: "Third-party content and links",
        blocks: [
          {
            type: "p",
            text: "The Website may contain links to third-party websites and content (e.g. documentation, repositories, community platforms). The respective third parties are solely responsible for such content. We assume no liability for third-party content and do not adopt it as our own.",
          },
        ],
      },
      {
        id: "liability",
        title: "Liability",
        blocks: [
          {
            type: "p",
            text: "We are liable without limitation for intent and gross negligence, for damages resulting from injury to life, body or health, and under the German Product Liability Act (Produkthaftungsgesetz). For slight negligence we are liable only for breach of material contractual obligations (cardinal obligations), limited to the typical, foreseeable damage.",
          },
          {
            type: "p",
            text: "Mandatory statutory liability provisions for consumers within the meaning of § 13 BGB remain unaffected. The aforementioned limitations of liability also apply to our legal representatives and vicarious agents.",
          },
          {
            type: "note",
            text: "The Website is provided without warranty. In particular, we do not warrant that the Website will be available uninterrupted or error-free. The Website serves to inform you about rumahl OS and related products; unless expressly stated otherwise, it does not constitute an offer to conclude a contract.",
          },
        ],
      },
      {
        id: "termination",
        title: "Termination of use",
        blocks: [
          {
            type: "p",
            text: "We may restrict, suspend or terminate access to the Website at any time if we consider this necessary, in particular in the event of violations of these Terms or applicable law. You may stop using the Website at any time.",
          },
        ],
      },
      {
        id: "governing-law",
        title: "Governing law and jurisdiction",
        blocks: [
          {
            type: "p",
            text: "These Terms and the use of the Website are governed by the laws of the Federal Republic of Germany, excluding the UN Convention on Contracts for the International Sale of Goods (CISG). For consumers, the mandatory protective provisions of the law of the state in which they have their habitual residence (within the European Union) apply regardless of this choice of law.",
          },
          {
            type: "p",
            text: "If you are a merchant, a legal entity under public law or a public-law special fund, our registered office is the place of jurisdiction for all disputes arising from these Terms.",
          },
        ],
      },
      {
        id: "final",
        title: "Final provisions",
        blocks: [
          {
            type: "p",
            text: "Should any provision of these Terms be or become invalid, the validity of the remaining provisions shall remain unaffected. The statutory provision shall replace the invalid provision.",
          },
          {
            type: "p",
            text: `If you have questions about these Terms, contact us at ${company.email}.`,
          },
        ],
      },
    ],
  },
};
