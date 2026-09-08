/**
 * Timezone handling — every timestamp on the page is shown in the visitor's
 * local timezone (auto-detected from the browser) unless they pick a fixed
 * one via the footer picker. The choice is stored in localStorage; changing
 * it reloads the page so all rendered timestamps update consistently.
 */

const TZ_KEY = "rumahl-status-tz";

export const TIMEZONES: { value: string; label: string }[] = [
  { value: "", label: "Auto (browser)" },
  { value: "UTC", label: "UTC" },
  { value: "Europe/Berlin", label: "Berlin · CET" },
  { value: "Europe/Vienna", label: "Vienna · CET" },
  { value: "Europe/Zurich", label: "Zurich · CET" },
  { value: "Europe/London", label: "London · GMT" },
  { value: "Europe/Paris", label: "Paris · CET" },
  { value: "Europe/Amsterdam", label: "Amsterdam · CET" },
  { value: "America/New_York", label: "New York · ET" },
  { value: "America/Chicago", label: "Chicago · CT" },
  { value: "America/Denver", label: "Denver · MT" },
  { value: "America/Los_Angeles", label: "Los Angeles · PT" },
  { value: "America/Sao_Paulo", label: "São Paulo · BRT" },
  { value: "Asia/Tokyo", label: "Tokyo · JST" },
  { value: "Asia/Shanghai", label: "Shanghai · CST" },
  { value: "Asia/Singapore", label: "Singapore · SGT" },
  { value: "Asia/Dubai", label: "Dubai · GST" },
  { value: "Australia/Sydney", label: "Sydney · AEDT" },
  { value: "Pacific/Auckland", label: "Auckland · NZDT" },
];

/** The timezone stored by the visitor ("" = auto). */
export function getStoredTimezone(): string {
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(TZ_KEY) ?? "";
  } catch {
    return "";
  }
}

/** The effective IANA timezone used for rendering. */
export function getActiveTimezone(): string {
  const stored = getStoredTimezone();
  if (stored !== "") return stored;
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/** Change the timezone and reload so every timestamp re-renders. */
export function setActiveTimezone(tz: string): void {
  try {
    if (tz === "") window.localStorage.removeItem(TZ_KEY);
    else window.localStorage.setItem(TZ_KEY, tz);
  } catch {
    /* private mode */
  }
  window.location.reload();
}

/** Short label for the footer picker button. */
export function timezonePickerLabel(): string {
  const stored = getStoredTimezone();
  if (stored !== "") return stored.replace("_", " ");
  return `Auto (${getActiveTimezone().replace("_", " ")})`;
}
