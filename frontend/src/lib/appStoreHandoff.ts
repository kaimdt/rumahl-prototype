/**
 * Mount-safe handoff between the launcher context menu and the App Store
 * page. The launcher can be on a different route than the App Store, so a
 * plain window event would be lost (no listener mounted yet). We persist a
 * pending request in sessionStorage and additionally fire the event for the
 * already-mounted case; the App Store consumes it on mount.
 */

const PENDING_SHOW_KEY = 'rumahl-appstore-pending-show'
const PENDING_DETAIL_KEY = 'rumahl-appstore-pending-detail'

function remember(key: string, appId: string) {
  try {
    sessionStorage.setItem(key, appId)
  } catch { /* storage unavailable — event-only fallback below */ }
}

function consume(key: string): string | null {
  try {
    const id = sessionStorage.getItem(key)
    sessionStorage.removeItem(key)
    return id
  } catch {
    return null
  }
}

/** "Show in App Store": navigate there and open the app's store page. */
export function requestAppInStore(appId: string) {
  remember(PENDING_SHOW_KEY, appId)
  window.dispatchEvent(new CustomEvent('rumahl:appstore-show-app', { detail: { appId } }))
}

/** Consume a pending "show in store" request (App Store page mount). */
export function consumeAppInStore(): string | null {
  return consume(PENDING_SHOW_KEY)
}

/** "Troubleshooting": open the app detail dialog (logs / runtime / terminal). */
export function requestAppDetail(appId: string) {
  remember(PENDING_DETAIL_KEY, appId)
  window.dispatchEvent(new CustomEvent('open-app-detail', { detail: { appId } }))
}

/** Consume a pending "open detail" request (App Store page mount). */
export function consumeAppDetail(): string | null {
  return consume(PENDING_DETAIL_KEY)
}
