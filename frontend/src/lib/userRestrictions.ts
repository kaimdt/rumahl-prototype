/**
 * User restrictions (family / child profiles).
 *
 * A child profile carries an `allowed_app_ids` whitelist; the shell filters
 * dock, launcher and command palette accordingly. Empty/missing whitelist
 * means unrestricted. System entries that must always stay reachable
 * (launcher, settings for profile management) are exempt.
 */

export interface UserRestrictions {
  allowed_app_ids?: string[]
}

const ALWAYS_ALLOWED = new Set([
  'launcher',
  'rumahl-settings',
  'rumahl-home',
])

/** Whether a user (with optional restrictions) may see the given app id. */
export function isAppAllowed(
  user: { restrictions?: UserRestrictions } | null | undefined,
  appId: string,
): boolean {
  if (!user) return true
  if (ALWAYS_ALLOWED.has(appId)) return true
  const allowed = user.restrictions?.allowed_app_ids
  if (!allowed || allowed.length === 0) return true
  return allowed.includes(appId)
}
