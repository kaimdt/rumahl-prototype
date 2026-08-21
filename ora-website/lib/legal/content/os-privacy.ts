import type { BilingualDoc } from "@/lib/legal/types";
import { company, legalName } from "@/lib/legal/company";

/**
 * rumahlOS Privacy Policy — local-first operating system privacy.
 * Data stays on the user's device; telemetry is opt-in only.
 */
export const osPrivacy: BilingualDoc = {
  de: {
    title: "Datenschutzerklärung (rumahl OS)",
    subtitle:
      "Wie rumahl OS mit deinen Daten umgeht — Local-First-Prinzip, Diagnosefunktionen und deine Rechte nach DSGVO.",
    effective: "2026-08-20",
    updated: "2026-08-20",
    version: "1.0",
    sections: [
      {
        id: "local-first",
        title: "Das Local-First-Prinzip",
        blocks: [
          {
            type: "p",
            text: "rumahl OS ist ein lokales Betriebssystem: Deine Smart-Home-Geräte, Automatisierungen, Medien, Dateien, Apps und KI-Anfragen (ORA) verbleiben standardmäßig vollständig auf deiner Hardware in deinen eigenen vier Wänden. Es gibt keine Cloud-Pflicht und kein Konto, das für den Betrieb der Software erforderlich wäre. Verantwortlicher im Sinne der DSGVO ist " + legalName + " (" + company.addressLine1 + ", " + company.addressLine2 + ", " + company.country + ", E-Mail: " + company.email + ").",
          },
        ],
      },
      {
        id: "was-lokal-bleibt",
        title: "Was lokal bleibt",
        blocks: [
          {
            type: "p",
            text: "Folgende Daten werden ausschließlich lokal auf deinem Gerät gespeichert und nicht an uns übermittelt:",
          },
          {
            type: "ul",
            items: [
              "Konfiguration und Einstellungen von rumahl OS;",
              "Verbindungen, Zugangsdaten und Token zu deinen Smart-Home-Geräten und Diensten;",
              "Automatisierungen, Szenen, Dashboards und Widgets;",
              "Dateien, Medien und Backups auf deinem Speicher;",
              "Verlauf und Daten deiner lokalen KI-Assistenten (ORA) bei lokalen Modellen;",
              "Daten von Apps und Plugins, die du installierst (soweit diese lokal speichern).",
            ],
          },
        ],
      },
      {
        id: "was-uebertragen-wird",
        title: "Was an uns übertragen wird",
        blocks: [
          {
            type: "p",
            text: "Grundsätzlich wird ohne dein Zutun nichts an uns übertragen. Ausnahmen:",
          },
          {
            type: "ul",
            items: [
              "Updates: Beim Abrufen von Software-Updates wird deine IP-Adresse an unsere Update-Server übertragen (Art. 6 Abs. 1 lit. f DSGVO — berechtigtes Interesse an der Bereitstellung und Sicherheit der Software);",
              "Diagnose: Falls du Diagnose-/Telemetriedaten freiwillig aktivierst, übermitteln wir anonymisierte Systeminformationen (z. B. Version, Hardware-Klasse, Fehlerberichte) ausschließlich zur Verbesserung der Software (Einwilligung, Art. 6 Abs. 1 lit. a DSGVO);",
              "Cloud-KI: Falls du Cloud-basierte KI-Funktionen von ORA ausdrücklich aktivierst, werden deine Anfragen an den jeweiligen Anbieter übermittelt (Einwilligung, Art. 6 Abs. 1 lit. a DSGVO);",
              "App-Store-Kommunikation: Für die Installation und Aktualisierung von Apps aus dem rumahl Store wird die Verbindung zum Store-Server benötigt.",
            ],
          },
          {
            type: "note",
            text: "Diagnose- und Cloud-Funktionen sind standardmäßig deaktiviert. Du kannst sie jederzeit in den Einstellungen von rumahl OS aktivieren oder deaktivieren. Eine erteilte Einwilligung kannst du jederzeit mit Wirkung für die Zukunft widerrufen.",
          },
        ],
      },
      {
        id: "apps-dritter",
        title: "Apps und Plugins Dritter",
        blocks: [
          {
            type: "p",
            text: "Apps und Plugins aus dem rumahl Store werden von unabhängigen Entwicklern bereitgestellt. Diese können eigene Datenverarbeitungen vornehmen; der jeweilige Entwickler ist insoweit eigenständig Verantwortlicher. Bevor du eine App installierst, prüfe bitte deren Datenschutzerklärung und die im Store angezeigten Datenangaben. Der rumahl Store verlangt von Entwicklern Transparenz über die Datenverarbeitung ihrer Apps (siehe Store-Bedingungen).",
          },
        ],
      },
      {
        id: "rechte",
        title: "Deine Rechte",
        blocks: [
          {
            type: "p",
            text: "Dir stehen die Rechte aus Art. 15 bis 22 und Art. 77 DSGVO zu: Auskunft, Berichtigung, Löschung, Einschränkung, Datenübertragbarkeit, Widerspruch, Widerruf von Einwilligungen sowie Beschwerde bei einer Datenschutz-Aufsichtsbehörde. Da deine Daten überwiegend lokal auf deinem Gerät liegen, kannst du viele Rechte direkt in der Software wahrnehmen (z. B. Daten löschen, Backups entfernen, Telemetrie deaktivieren).",
          },
          {
            type: "p",
            text: "Für Anfragen an uns genügt eine formlose E-Mail an " + company.email + ".",
          },
        ],
      },
      {
        id: "speicherung",
        title: "Speicherdauer",
        blocks: [
          {
            type: "p",
            text: "Lokal gespeicherte Daten verbleiben auf deinem Gerät, bis du sie löschst. An uns übertragene Daten (z. B. IP-Adressen bei Update-Abrufen, Diagnosedaten) werden nach spätestens 14 Tagen gelöscht oder anonymisiert, soweit keine gesetzlichen Aufbewahrungspflichten bestehen.",
          },
        ],
      },
      {
        id: "sicherheit",
        title: "Sicherheit",
        blocks: [
          {
            type: "p",
            text: "Die Kommunikation mit unseren Servern erfolgt TLS-verschlüsselt. Für die Sicherheit deines Geräts und deiner lokalen Daten bist du verantwortlich: Bitte halte die Software aktuell, verwende starke Passwörter und erstelle regelmäßig Backups (Art. 32 DSGVO).",
          },
        ],
      },
      {
        id: "aenderungen",
        title: "Änderungen und Kontakt",
        blocks: [
          {
            type: "p",
            text: "Wir aktualisieren diese Datenschutzerklärung bei Änderungen der Verarbeitungstätigkeiten. Bei Fragen: " + company.email + ".",
          },
        ],
      },
    ],
  },
  en: {
    title: "Privacy Policy (rumahl OS)",
    subtitle:
      "How rumahl OS handles your data — the local-first principle, diagnostics and your GDPR rights.",
    effective: "2026-08-20",
    updated: "2026-08-20",
    version: "1.0",
    sections: [
      {
        id: "local-first",
        title: "The local-first principle",
        blocks: [
          {
            type: "p",
            text: "rumahl OS is a local operating system: your smart home devices, automations, media, files, apps and AI prompts (ORA) remain entirely on your hardware, inside your own home, by default. There is no cloud requirement and no account needed to operate the Software. The controller within the meaning of the GDPR is " + legalName + " (" + company.addressLine1 + ", " + company.addressLine2 + ", " + company.country + ", Email: " + company.email + ").",
          },
        ],
      },
      {
        id: "stays-local",
        title: "What stays local",
        blocks: [
          {
            type: "p",
            text: "The following data is stored exclusively on your device and is not transmitted to us:",
          },
          {
            type: "ul",
            items: [
              "configuration and settings of rumahl OS;",
              "connections, credentials and tokens for your smart home devices and services;",
              "automations, scenes, dashboards and widgets;",
              "files, media and backups on your storage;",
              "history and data of your local AI assistants (ORA) when using local models;",
              "data of apps and plugins you install (insofar as they store locally).",
            ],
          },
        ],
      },
      {
        id: "what-is-transmitted",
        title: "What is transmitted to us",
        blocks: [
          {
            type: "p",
            text: "In principle, nothing is transmitted to us without your action. Exceptions:",
          },
          {
            type: "ul",
            items: [
              "Updates: When fetching software updates, your IP address is transmitted to our update servers (Art. 6(1)(f) GDPR — legitimate interest in providing and securing the Software);",
              "Diagnostics: If you voluntarily enable diagnostics/telemetry, we receive anonymized system information (e.g. version, hardware class, error reports) solely to improve the Software (consent, Art. 6(1)(a) GDPR);",
              "Cloud AI: If you explicitly enable cloud-based ORA AI features, your prompts are transmitted to the respective provider (consent, Art. 6(1)(a) GDPR);",
              "App Store communication: Installing and updating apps from the rumahl Store requires a connection to the Store server.",
            ],
          },
          {
            type: "note",
            text: "Diagnostics and cloud features are disabled by default. You can enable or disable them at any time in the rumahl OS settings. Consent granted can be withdrawn at any time with effect for the future.",
          },
        ],
      },
      {
        id: "third-party-apps",
        title: "Third-party apps and plugins",
        blocks: [
          {
            type: "p",
            text: "Apps and plugins from the rumahl Store are provided by independent developers. These may perform their own data processing; the respective developer is an independent controller in this respect. Before installing an app, please review its privacy policy and the data information shown in the Store. The rumahl Store requires developers to be transparent about their apps' data processing (see Store Terms).",
          },
        ],
      },
      {
        id: "rights",
        title: "Your rights",
        blocks: [
          {
            type: "p",
            text: "You have the rights under Art. 15 to 22 and Art. 77 GDPR: access, rectification, erasure, restriction, data portability, objection, withdrawal of consent, and the right to lodge a complaint with a data protection supervisory authority. Since your data largely resides locally on your device, you can exercise many rights directly in the Software (e.g. delete data, remove backups, disable telemetry).",
          },
          {
            type: "p",
            text: "For requests addressed to us, an informal email to " + company.email + " is sufficient.",
          },
        ],
      },
      {
        id: "retention",
        title: "Retention",
        blocks: [
          {
            type: "p",
            text: "Locally stored data remains on your device until you delete it. Data transmitted to us (e.g. IP addresses for update fetches, diagnostics data) is deleted or anonymized after no more than 14 days, unless statutory retention obligations apply.",
          },
        ],
      },
      {
        id: "security",
        title: "Security",
        blocks: [
          {
            type: "p",
            text: "Communication with our servers is TLS-encrypted. You are responsible for the security of your device and your local data: please keep the Software up to date, use strong passwords and create regular backups (Art. 32 GDPR).",
          },
        ],
      },
      {
        id: "changes",
        title: "Changes and contact",
        blocks: [
          {
            type: "p",
            text: "We update this Privacy Policy when our processing activities change. For questions: " + company.email + ".",
          },
        ],
      },
    ],
  },
};
