"use client";

import i18n from "i18next";
import { initReactI18next } from "react-i18next";

if (!i18n.isInitialized) {
  void i18n.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    interpolation: { escapeValue: false },
    resources: {
      en: { translation: {
        "status.operational": "Operational", "status.degraded": "Degraded performance", "status.partial_outage": "Partial outage", "status.major_outage": "Major outage", "status.maintenance": "Maintenance",
        "status.description.operational": "All systems are operational.", "status.description.degraded": "Some systems are experiencing degraded performance.", "status.description.partial_outage": "Some systems are experiencing a partial outage.", "status.description.major_outage": "A major outage is affecting multiple systems.", "status.description.maintenance": "Maintenance is in progress on some systems.",
        "status.lastUpdated": "Last updated on {{date}}", "page.activeIncidents": "Active incidents", "page.pastIncidents": "Past incidents", "page.viewAll": "View all", "page.unavailable": "Status unavailable", "page.unavailableHint": "Could not reach the status API. Please try again in a moment.",
      } },
      de: { translation: {
        "status.operational": "Betriebsbereit", "status.degraded": "Eingeschränkte Leistung", "status.partial_outage": "Teilweiser Ausfall", "status.major_outage": "Schwerwiegender Ausfall", "status.maintenance": "Wartung",
        "status.description.operational": "Alle Systeme sind betriebsbereit.", "status.description.degraded": "Einige Systeme weisen eine eingeschränkte Leistung auf.", "status.description.partial_outage": "Einige Systeme sind teilweise ausgefallen.", "status.description.major_outage": "Ein schwerwiegender Ausfall betrifft mehrere Systeme.", "status.description.maintenance": "An einigen Systemen werden Wartungsarbeiten durchgeführt.",
        "status.lastUpdated": "Zuletzt aktualisiert: {{date}}", "page.activeIncidents": "Aktive Störungen", "page.pastIncidents": "Frühere Störungen", "page.viewAll": "Alle anzeigen", "page.unavailable": "Status nicht verfügbar", "page.unavailableHint": "Die Status-API ist derzeit nicht erreichbar. Bitte versuche es gleich erneut.",
      } },
    },
  });
}

export default i18n;
