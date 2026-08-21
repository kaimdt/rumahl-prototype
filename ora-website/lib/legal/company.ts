/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  COMPANY DETAILS — CENTRAL DATA
 * ═══════════════════════════════════════════════════════════════════════════
 *  All legal documents import these values. Update the company data in ONE
 *  place — every page updates at once.
 *
 *  Required by German law (§ 5 DDG — Impressum):
 *  - Legal name incl. legal form (e.g. "rumahl GmbH")
 *  - Full postal address (street, postal code, city, country)
 *  - A fast-reachable contact (email) incl. direct address
 *  - Commercial register entry (if registered)
 *  - VAT ID (USt-IdNr.) if available
 *  - Authorized representatives (Geschäftsführer/Vorstand)
 * ═══════════════════════════════════════════════════════════════════════════
 */
export const company = {
  name: "rumahl",
  legalForm: "",
  addressLine1: "Beethovenstraße 9",
  addressLine2: "86438 Kissing",
  country: "Germany",
  phone: "+49 8233 381 0",
  email: "legal@rumahl.com",
  supportEmail: "support@rumahl.com",
  vatId: "DE353418810",
  registry: "",
  registryNumber: "",
  representative: "Kai Lukas Marquardt",
  duns: "344752158",
  websiteUrl: "https://rumahl.com",
  storeUrl: "https://store.rumahl.com",
} as const;

export const legalContact = {
  email: company.email,
  supportEmail: company.supportEmail,
  storeUrl: company.storeUrl,
} as const;

/** Full legal name without trailing spaces when no legal form is set. */
export const legalName = [company.name, company.legalForm]
  .filter(Boolean)
  .join(" ");
