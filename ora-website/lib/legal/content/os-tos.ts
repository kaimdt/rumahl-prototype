import type { BilingualDoc } from "@/lib/legal/types";
import { company, legalName } from "@/lib/legal/company";

/**
 * rumahlOS Software Terms Agreement — open-source software terms (MIT),
 * digital content under German BGB §§ 327 ff. where applicable, no warranty
 * for free software.
 */
export const osTos: BilingualDoc = {
  de: {
    title: "Software-Lizenzbedingungen (rumahl OS)",
    subtitle:
      "Die rechtlichen Bedingungen für die Nutzung von rumahl OS — Open-Source-Software unter der MIT-Lizenz.",
    effective: "2026-08-20",
    updated: "2026-08-20",
    version: "1.0",
    sections: [
      {
        id: "gegenstand",
        title: "Gegenstand",
        blocks: [
          {
            type: "p",
            text: "rumahl OS ist ein quelloffenes, lokales Betriebssystem für Zuhause („die Software“), entwickelt und veröffentlicht von " + legalName + " („rumahl“). Diese Bedingungen regeln die Nutzung der Software. Für Apps und Plugins aus dem rumahl Store gelten die Store-Bedingungen; für ORA gelten die jeweiligen Produktbedingungen.",
          },
        ],
      },
      {
        id: "lizenz",
        title: "Lizenz",
        blocks: [
          {
            type: "p",
            text: "Die Software ist Open Source und wird unter der MIT-Lizenz bereitgestellt („Lizenz“). Die MIT-Lizenz gestattet dir die Nutzung, Vervielfältigung, Modifikation und Verbreitung der Software, einschließlich kommerzieller Nutzung, unter den Bedingungen der Lizenz. Maßgeblich ist der Lizenztext, der im jeweiligen Quellcode-Repository der Software mitgeliefert wird.",
          },
          {
            type: "ul",
            items: [
              "Du darfst die Software auf deiner eigenen Hardware installieren und betreiben;",
              "Du darfst die Software kopieren, verändern und weitergeben, sofern der Urheberrechtshinweis und der Lizenztext erhalten bleiben;",
              "Kommerzielle Nutzung ist unter den Bedingungen der MIT-Lizenz gestattet;",
              "Die Marke „rumahl“ und die zugehörigen Logos sind von der MIT-Lizenz nicht umfasst und dürfen nur mit unserer vorherigen schriftlichen Zustimmung verwendet werden.",
            ],
          },
        ],
      },
      {
        id: "komponenten",
        title: "Open-Source-Komponenten Dritter",
        blocks: [
          {
            type: "p",
            text: "Die Software enthält Komponenten, Bibliotheken und Abhängigkeiten Dritter, die jeweils ihren eigenen Open-Source-Lizenzen (z. B. MIT, Apache-2.0, BSD, GPL) unterliegen. Diese Lizenzen sind in den jeweiligen Repositories und im Rahmen der Software dokumentiert. Im Konfliktfall gehen die Bedingungen der jeweiligen Drittlizenz vor.",
          },
        ],
      },
      {
        id: "kein-kaufvertrag",
        title: "Kostenlose Software — kein Kaufvertrag",
        blocks: [
          {
            type: "p",
            text: "Die Software wird unentgeltlich bereitgestellt. Es entsteht kein Kaufvertrag über digitale Inhalte im Sinne der §§ 327 ff. BGB. Die Software wird im Rahmen der MIT-Lizenz „wie besehen“ (as is) ohne jegliche Gewährleistung oder Garantie bereitgestellt.",
          },
          {
            type: "note",
            text: "Sollten in Zukunft kostenpflichtige Funktionen oder Dienste angeboten werden, gelten für diese die gesetzlichen Regelungen über digitale Produkte (§§ 327 ff. BGB, Richtlinie (EU) 2019/770) sowie die dann geltenden Produktbedingungen.",
          },
        ],
      },
      {
        id: "updates",
        title: "Updates und Sicherheit",
        blocks: [
          {
            type: "p",
            text: "Wir stellen im Rahmen unserer Möglichkeiten Sicherheitsupdates und neue Versionen der Software bereit. Du erhältst Updates über die in der Software vorgesehenen Mechanismen. Wir weisen ausdrücklich darauf hin, dass die Bereitstellung von Updates kein vertragliches Dauerschuldverhältnis begründet; die Weiterentwicklung der Software erfolgt nach unserem Ermessen.",
          },
        ],
      },
      {
        id: "store-apps",
        title: "Apps und Plugins aus dem rumahl Store",
        blocks: [
          {
            type: "p",
            text: "Apps und Plugins, die du über den rumahl Store installierst, werden von den jeweiligen Entwicklern bereitgestellt und unterliegen den rumahl-Store-Bedingungen sowie den Bedingungen des jeweiligen Entwicklers. rumahl ist insoweit Vermittler (Hosting-Anbieter) und nicht Vertragspartner des Entwickler-Vertrags, soweit gesetzlich nichts anderes bestimmt ist.",
          },
        ],
      },
      {
        id: "ora",
        title: "ORA — KI-Assistent",
        blocks: [
          {
            type: "p",
            text: "ORA ist der KI-Assistent von rumahl OS. Standardmäßig läuft ORA vollständig lokal auf deiner Hardware („Local-First“); deine Anfragen und Daten verlassen dein Gerät nicht. Sollten in Zukunft Cloud-basierte KI-Funktionen angeboten werden, erfolgt deren Nutzung ausschließlich mit deiner ausdrücklichen Einwilligung; Details regelt die Datenschutzerklärung von rumahl OS.",
          },
        ],
      },
      {
        id: "haftung",
        title: "Haftung",
        blocks: [
          {
            type: "p",
            text: "Die Software wird kostenlos und ohne Gewähr bereitgestellt. Wir haften unbeschränkt für Vorsatz, grobe Fahrlässigkeit, Schäden aus der Verletzung von Leben, Körper oder Gesundheit sowie nach dem Produkthaftungsgesetz. Für einfache Fahrlässigkeit haften wir nur bei Verletzung wesentlicher Vertragspflichten, begrenzt auf den vertragstypischen, vorhersehbaren Schaden; dies gilt nicht für Verbraucher, soweit zwingende gesetzliche Vorschriften entgegenstehen.",
          },
          {
            type: "p",
            text: "Insbesondere haften wir nicht für Schäden, die aus der Nutzung von Apps Dritter, aus Hardware-Ausfällen oder aus unsachgemäßer Verwendung der Software entstehen. Du trägst die Verantwortung für die Sicherung deiner Daten (Backups).",
          },
        ],
      },
      {
        id: "anwendbares-recht",
        title: "Anwendbares Recht",
        blocks: [
          {
            type: "p",
            text: "Auf diese Bedingungen findet das Recht der Bundesrepublik Deutschland Anwendung, unter Ausschluss des UN-Kaufrechts. Für Verbraucher innerhalb der Europäischen Union gelten zwingende Schutzbestimmungen ihres Aufenthaltsstaats unabhängig von dieser Rechtswahl.",
          },
        ],
      },
      {
        id: "kontakt",
        title: "Kontakt",
        blocks: [
          {
            type: "p",
            text: "Fragen zu diesen Bedingungen: " + company.email + " — Support: " + company.supportEmail + ".",
          },
        ],
      },
    ],
  },
  en: {
    title: "Software Terms Agreement (rumahl OS)",
    subtitle:
      "The legal terms governing your use of rumahl OS — open-source software under the MIT License.",
    effective: "2026-08-20",
    updated: "2026-08-20",
    version: "1.0",
    sections: [
      {
        id: "subject",
        title: "Subject matter",
        blocks: [
          {
            type: "p",
            text: "rumahl OS is an open-source, local-first home operating system (“the Software”), developed and published by " + legalName + " (“rumahl”). These terms govern your use of the Software. Apps and plugins from the rumahl Store are governed by the Store Terms; ORA is governed by its respective product terms.",
          },
        ],
      },
      {
        id: "license",
        title: "License",
        blocks: [
          {
            type: "p",
            text: "The Software is open source and provided under the MIT License (the “License”). The MIT License permits you to use, copy, modify and distribute the Software, including for commercial purposes, subject to the terms of the License. The license text included in the respective source code repository of the Software is authoritative.",
          },
          {
            type: "ul",
            items: [
              "You may install and run the Software on your own hardware;",
              "You may copy, modify and redistribute the Software, provided the copyright notice and the license text are retained;",
              "Commercial use is permitted under the terms of the MIT License;",
              "The “rumahl” trademark and associated logos are not covered by the MIT License and may only be used with our prior written consent.",
            ],
          },
        ],
      },
      {
        id: "components",
        title: "Third-party open-source components",
        blocks: [
          {
            type: "p",
            text: "The Software contains third-party components, libraries and dependencies, each subject to its own open-source license (e.g. MIT, Apache-2.0, BSD, GPL). These licenses are documented in the respective repositories and within the Software. In case of conflict, the respective third-party license prevails.",
          },
        ],
      },
      {
        id: "no-purchase",
        title: "Free software — no purchase contract",
        blocks: [
          {
            type: "p",
            text: "The Software is provided free of charge. No contract for digital content within the meaning of Sections 327 et seq. of the German Civil Code (BGB) is concluded. The Software is provided under the MIT License “as is”, without any warranty or guarantee.",
          },
          {
            type: "note",
            text: "Should paid features or services be offered in the future, the statutory rules on digital products (Sections 327 et seq. BGB, Directive (EU) 2019/770) and the applicable product terms will apply to them.",
          },
        ],
      },
      {
        id: "updates",
        title: "Updates and security",
        blocks: [
          {
            type: "p",
            text: "We provide security updates and new releases of the Software to the extent possible. You receive updates through the mechanisms provided in the Software. We expressly note that providing updates does not create a continuing contractual obligation; the further development of the Software is at our discretion.",
          },
        ],
      },
      {
        id: "store-apps",
        title: "Apps and plugins from the rumahl Store",
        blocks: [
          {
            type: "p",
            text: "Apps and plugins you install through the rumahl Store are provided by their respective developers and are subject to the rumahl Store Terms and the respective developer's terms. In this respect, rumahl acts as an intermediary (hosting provider) and is not a party to the developer contract, unless otherwise required by law.",
          },
        ],
      },
      {
        id: "ora",
        title: "ORA — AI assistant",
        blocks: [
          {
            type: "p",
            text: "ORA is the AI assistant of rumahl OS. By default, ORA runs entirely locally on your hardware (“local-first”); your prompts and data do not leave your device. Should cloud-based AI features be offered in the future, they will only be used with your explicit consent; details are governed by the rumahl OS Privacy Policy.",
          },
        ],
      },
      {
        id: "liability",
        title: "Liability",
        blocks: [
          {
            type: "p",
            text: "The Software is provided free of charge and without warranty. We are liable without limitation for intent, gross negligence, damages resulting from injury to life, body or health, and under the German Product Liability Act. For slight negligence we are liable only for breach of material contractual obligations, limited to the typical, foreseeable damage; this does not apply to consumers where mandatory statutory provisions require otherwise.",
          },
          {
            type: "p",
            text: "In particular, we are not liable for damages arising from the use of third-party apps, hardware failures or improper use of the Software. You are responsible for backing up your data.",
          },
        ],
      },
      {
        id: "governing-law",
        title: "Governing law",
        blocks: [
          {
            type: "p",
            text: "These terms are governed by the laws of the Federal Republic of Germany, excluding the UN Convention on Contracts for the International Sale of Goods. For consumers within the European Union, mandatory protective provisions of their state of residence apply regardless of this choice of law.",
          },
        ],
      },
      {
        id: "contact",
        title: "Contact",
        blocks: [
          {
            type: "p",
            text: "Questions about these terms: " + company.email + " — Support: " + company.supportEmail + ".",
          },
        ],
      },
    ],
  },
};
