/**
 * Shared types for the legal document system.
 *
 * Every legal document is written bilingually (German + English) and rendered
 * by <LegalDocument />, which provides the language toggle, the sticky table
 * of contents and consistent typography.
 */

export type LegalBlock =
  | { type: "p"; text: string }
  | { type: "ul"; items: string[] }
  | { type: "note"; text: string }
  | { type: "table"; headers: string[]; rows: string[][] };

export interface LegalSection {
  id: string;
  title: string;
  blocks: LegalBlock[];
}

export interface LegalDoc {
  /** Short title, e.g. "Privacy Policy" */
  title: string;
  /** One-line description shown under the title */
  subtitle: string;
  /** ISO date the document takes effect, e.g. "2026-08-20" */
  effective: string;
  /** ISO date of the last revision */
  updated: string;
  version: string;
  sections: LegalSection[];
}

export interface BilingualDoc {
  de: LegalDoc;
  en: LegalDoc;
}

export type LegalLang = "de" | "en";
