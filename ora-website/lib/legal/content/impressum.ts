import type { BilingualDoc } from "@/lib/legal/types";
import { company, legalName } from "@/lib/legal/company";

/**
 * Impressum — mandatory provider identification under German law
 * (§ 5 Digitale-Dienste-Gesetz / DDG, formerly § 5 TMG).
 */

/** Rows of the provider table — empty optional fields are omitted. */
const providerRows: string[][] = [
  ["Anbieter / Diensteanbieter", legalName],
  ["Anschrift", `${company.addressLine1}, ${company.addressLine2}, ${company.country}`],
  ["Vertretungsberechtigt", company.representative],
  ["Telefon", company.phone],
  ["E-Mail", company.email],
  ...(company.registry && company.registryNumber
    ? [["Registereintrag", `${company.registry} — ${company.registryNumber}`]]
    : []),
  ...(company.vatId
    ? [["Umsatzsteuer-ID", `${company.vatId} (gemäß § 27a UStG)`]]
    : []),
  ["D-U-N-S® Nummer", company.duns],
];

const providerRowsEn: string[][] = [
  ["Provider / Service provider", legalName],
  ["Address", `${company.addressLine1}, ${company.addressLine2}, ${company.country}`],
  ["Authorized representatives", company.representative],
  ["Telephone", company.phone],
  ["Email", company.email],
  ...(company.registry && company.registryNumber
    ? [["Commercial register", `${company.registry} — ${company.registryNumber}`]]
    : []),
  ...(company.vatId
    ? [["VAT ID", `${company.vatId} (pursuant to § 27a UStG)`]]
    : []),
  ["D-U-N-S® Number", company.duns],
];

export const impressum: BilingualDoc = {
  de: {
    title: "Impressum",
    subtitle:
      "Pflichtangaben gemäß § 5 DDG (Digitale-Dienste-Gesetz) — Angaben zum Anbieter dieses Internetauftritts.",
    effective: "2026-08-20",
    updated: "2026-08-20",
    version: "1.0",
    sections: [
      {
        id: "anbieter",
        title: "Angaben gemäß § 5 DDG",
        blocks: [
          {
            type: "table",
            headers: ["Feld", "Angabe"],
            rows: providerRows,
          },
        ],
      },
      {
        id: "kontakt",
        title: "Kontakt",
        blocks: [
          {
            type: "p",
            text: `Für allgemeine Anfragen, rechtliche Anliegen und Beschwerden erreichst du uns unter ${company.email}. Supportanfragen zu rumahl OS und dem rumahl Store richte bitte an ${company.supportEmail}.`,
          },
        ],
      },
      {
        id: "eu-streitschlichtung",
        title: "EU-Streitschlichtung",
        blocks: [
          {
            type: "p",
            text: "Die Europäische Kommission stellt eine Plattform zur Online-Streitbeilegung (OS) bereit: https://ec.europa.eu/consumers/odr/. Unsere E-Mail-Adresse findest du oben im Impressum.",
          },
          {
            type: "p",
            text: "Wir sind weder verpflichtet noch bereit, an Streitbeilegungsverfahren vor einer Verbraucherschlichtungsstelle teilzunehmen.",
          },
        ],
      },
      {
        id: "verbraucherstreitbeilegung",
        title: "Verbraucherstreitbeilegung (§ 36 VSBG)",
        blocks: [
          {
            type: "p",
            text: "Wir sind nicht verpflichtet und nicht bereit, an Streitbeilegungsverfahren vor einer Verbraucherschlichtungsstelle im Sinne des Verbraucherstreitbeilegungsgesetzes (VSBG) teilzunehmen. Zuständig wäre die Universalschlichtungsstelle des Bundes (https://www.verbraucher-schlichter.de/).",
          },
        ],
      },
      {
        id: "haftung-inhalte",
        title: "Haftung für Inhalte",
        blocks: [
          {
            type: "p",
            text: "Als Diensteanbieter sind wir gemäß § 7 Abs. 1 DDG für eigene Inhalte auf diesen Seiten nach den allgemeinen Gesetzen verantwortlich. Nach §§ 8 bis 10 DDG sind wir als Diensteanbieter jedoch nicht verpflichtet, übermittelte oder gespeicherte fremde Informationen zu überwachen oder nach Umständen zu forschen, die auf eine rechtswidrige Tätigkeit hinweisen.",
          },
          {
            type: "p",
            text: "Verpflichtungen zur Entfernung oder Sperrung der Nutzung von Informationen nach den allgemeinen Gesetzen bleiben hiervon unberührt. Eine diesbezügliche Haftung ist jedoch erst ab dem Zeitpunkt der Kenntnis einer konkreten Rechtsverletzung möglich. Bei Bekanntwerden von entsprechenden Rechtsverletzungen werden wir diese Inhalte umgehend entfernen.",
          },
        ],
      },
      {
        id: "haftung-links",
        title: "Haftung für Links",
        blocks: [
          {
            type: "p",
            text: "Unser Angebot enthält Links zu externen Websites Dritter, auf deren Inhalte wir keinen Einfluss haben. Deshalb können wir für diese fremden Inhalte auch keine Gewähr übernehmen. Für die Inhalte der verlinkten Seiten ist stets der jeweilige Anbieter oder Betreiber der Seiten verantwortlich. Die verlinkten Seiten wurden zum Zeitpunkt der Verlinkung auf mögliche Rechtsverstöße überprüft; rechtswidrige Inhalte waren zu diesem Zeitpunkt nicht erkennbar.",
          },
          {
            type: "p",
            text: "Bei Bekanntwerden von Rechtsverletzungen werden wir derartige Links umgehend entfernen.",
          },
        ],
      },
      {
        id: "urheberrecht",
        title: "Urheberrecht",
        blocks: [
          {
            type: "p",
            text: "Die durch die Seitenbetreiber erstellten Inhalte und Werke auf diesen Seiten unterliegen dem deutschen Urheberrecht. Die Vervielfältigung, Bearbeitung, Verbreitung und jede Art der Verwertung außerhalb der Grenzen des Urheberrechtes bedürfen der schriftlichen Zustimmung des jeweiligen Autors bzw. Erstellers. Downloads und Kopien dieser Seite sind nur für den privaten, nicht kommerziellen Gebrauch gestattet.",
          },
          {
            type: "p",
            text: "Soweit die Inhalte auf dieser Seite nicht vom Betreiber erstellt wurden, werden die Urheberrechte Dritter beachtet. Solltest du trotzdem auf eine Urheberrechtsverletzung aufmerksam werden, bitten wir um einen entsprechenden Hinweis. Bei Bekanntwerden von Rechtsverletzungen werden wir derartige Inhalte umgehend entfernen.",
          },
        ],
      },
      {
        id: "dsa",
        title: "Informationen nach dem Digital Services Act (DSA)",
        blocks: [
          {
            type: "p",
            text: "Der rumahl Store (https://store.rumahl.com) wird als Online-Plattform im Sinne des Digital Services Act (Verordnung (EU) 2022/2065) betrieben. Rechtswidrige Inhalte können über die in den Nutzungsbedingungen des Stores beschriebenen Meldewege (Notice-and-Action) gemeldet werden. Der zentrale Anlaufpunkt für Behörden ist erreichbar über die Kontaktangaben dieses Impressums.",
          },
        ],
      },
    ],
  },
  en: {
    title: "Imprint (Impressum)",
    subtitle:
      "Mandatory provider information in accordance with § 5 of the German Digital Services Act (DDG) — details about the provider of this website.",
    effective: "2026-08-20",
    updated: "2026-08-20",
    version: "1.0",
    sections: [
      {
        id: "provider",
        title: "Information pursuant to § 5 DDG",
        blocks: [
          {
            type: "table",
            headers: ["Field", "Information"],
            rows: providerRowsEn,
          },
        ],
      },
      {
        id: "contact",
        title: "Contact",
        blocks: [
          {
            type: "p",
            text: `For general inquiries, legal matters and complaints, reach us at ${company.email}. For support questions regarding rumahl OS and the rumahl Store, please contact ${company.supportEmail}.`,
          },
        ],
      },
      {
        id: "eu-dispute",
        title: "EU dispute resolution",
        blocks: [
          {
            type: "p",
            text: "The European Commission provides a platform for online dispute resolution (ODR): https://ec.europa.eu/consumers/odr/. Our email address can be found above in this imprint.",
          },
          {
            type: "p",
            text: "We are neither obliged nor willing to participate in dispute resolution proceedings before a consumer arbitration board.",
          },
        ],
      },
      {
        id: "consumer-dispute",
        title: "Consumer dispute resolution (§ 36 VSBG)",
        blocks: [
          {
            type: "p",
            text: "We are not obliged and not willing to participate in dispute resolution proceedings before a consumer arbitration board within the meaning of the German Consumer Dispute Resolution Act (VSBG). The competent authority would be the Federal Universal Arbitration Board (https://www.verbraucher-schlichter.de/).",
          },
        ],
      },
      {
        id: "liability-content",
        title: "Liability for content",
        blocks: [
          {
            type: "p",
            text: "As a service provider, we are responsible for our own content on these pages in accordance with § 7 (1) DDG and the general laws. Pursuant to §§ 8 to 10 DDG, however, we as a service provider are not obliged to monitor transmitted or stored third-party information or to investigate circumstances that indicate illegal activity.",
          },
          {
            type: "p",
            text: "Obligations to remove or block the use of information under the general laws remain unaffected. Liability in this respect is only possible from the point in time at which we become aware of a concrete legal infringement. Upon becoming aware of corresponding legal violations, we will remove this content immediately.",
          },
        ],
      },
      {
        id: "liability-links",
        title: "Liability for links",
        blocks: [
          {
            type: "p",
            text: "Our offer contains links to external third-party websites over whose content we have no influence. We therefore cannot assume any liability for this external content. The respective provider or operator of the linked pages is always responsible for their content. The linked pages were checked for possible legal violations at the time of linking; illegal content was not recognizable at that time.",
          },
          {
            type: "p",
            text: "Upon becoming aware of legal violations, we will remove such links immediately.",
          },
        ],
      },
      {
        id: "copyright",
        title: "Copyright",
        blocks: [
          {
            type: "p",
            text: "The content and works created by the site operators on these pages are subject to German copyright law. Duplication, processing, distribution and any kind of exploitation beyond the limits of copyright law require the written consent of the respective author or creator. Downloads and copies of this page are only permitted for private, non-commercial use.",
          },
          {
            type: "p",
            text: "Where content on this page was not created by the operator, the copyrights of third parties are respected. If you nevertheless become aware of a copyright infringement, we ask for a corresponding notice. Upon becoming aware of legal violations, we will remove such content immediately.",
          },
        ],
      },
      {
        id: "dsa",
        title: "Information under the Digital Services Act (DSA)",
        blocks: [
          {
            type: "p",
            text: "The rumahl Store (https://store.rumahl.com) is operated as an online platform within the meaning of the Digital Services Act (Regulation (EU) 2022/2065). Illegal content can be reported through the notice-and-action channels described in the Store Terms of Service. The central point of contact for authorities is reachable via the contact details in this imprint.",
          },
        ],
      },
    ],
  },
};
