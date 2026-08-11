/**
 * App Embedding Gateway — frontend helpers.
 *
 * Installed ORA apps run on their own origin:
 *
 *   https://<app-id>.apps.ora.local/
 *
 * The ORA desktop (`https://ora.local`) embeds that origin in the App
 * Runner iframe. This module knows how to build the public runtime URL,
 * maps manifest `display` permissions to the iframe `allow` attribute,
 * defines the sandbox policy and exposes the lifecycle states the runner
 * renders.
 *
 * The gateway itself (backend, iora-home) does the header rewriting
 * (X-Frame-Options, CSP frame-ancestors), redirect rewriting, WebSocket
 * tunneling and runtime-target resolution — the frontend never sees
 * internal ports or addresses.
 */

export const APPS_HOST_SUFFIX: string = import.meta.env.VITE_APPS_HOST_SUFFIX || '.apps.ora.local'

export function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.replace(/^\[|\]$/g, '').toLowerCase()
  if (normalized === 'localhost' || normalized === '::1') return true
  const parts = normalized.split('.').map((p) => Number(p))
  return parts.length === 4 && parts[0] === 127 && parts.every((p) => Number.isInteger(p) && p >= 0 && p <= 255)
}

/** Canonical lifecycle states reported by the gateway. */
export const APP_LIFECYCLE = {
  STARTING: 'STARTING',
  RUNNING: 'RUNNING',
  STOPPING: 'STOPPING',
  STOPPED: 'STOPPED',
  FAILED: 'FAILED',
  UNHEALTHY: 'UNHEALTHY',
  NOT_FOUND: 'NOT_FOUND',
} as const
export type GatewayLifecycleState = (typeof APP_LIFECYCLE)[keyof typeof APP_LIFECYCLE]

export type AppDisplayMode = 'embedded' | 'external'
export type AppIsolationLevel = 'strict' | 'relaxed'

export interface AppDisplayConfig {
  mode?: AppDisplayMode
  isolation?: AppIsolationLevel
  permissions?: string[]
  sandbox?: string[]
}

export interface AppRuntimeInfo {
  app_id: string
  state: GatewayLifecycleState
  display?: AppDisplayConfig | null
  /** Public runtime URL served by the gateway (null while not running or
   * when subdomains are not configured — the runner then uses proxy_url). */
  runtime_url?: string | null
  /** Same-origin proxy path (always available, no DNS required). */
  proxy_url?: string | null
  /** URL to open the app outside the runner (external mode / fallback). */
  external_url?: string | null
  ws_supported: boolean
  startable: boolean
}

/** Strip the configured suffix (`.apps.ora.local`) from a host to get the
 * desktop host. The apps root label (`apps`) is dropped as well — the
 * desktop is the parent of the apps subdomain, never an app origin itself:
 * `nextcloud.apps.ora.local` → `ora.local`. Returns the input unchanged
 * when it does not match the suffix. */
export function desktopHostOf(host: string): string {
  const base = APPS_HOST_SUFFIX.trim().replace(/^\./, '').replace(/\.$/, '')
  const lower = host.toLowerCase()
  if (base && lower.endsWith(`.${base}`)) {
    const firstDot = base.indexOf('.')
    if (firstDot !== -1) return base.slice(firstDot + 1)
  }
  return host
}

/**
 * Build the public runtime URL for an app: `{scheme}://{appId}{suffix}/`
 * on the desktop's own host. Ports are kept only when they are not the
 * scheme default (dev setup), because the gateway is served by the same
 * backend as the desktop.
 *
 * When the desktop runs on a loopback host (localhost / 127.0.0.1 — e.g.
 * the Vite dev server) subdomains cannot resolve, so `null` is returned
 * and the runner falls back to the legacy same-origin proxy path.
 */
export function appRuntimeUrl(appId: string, opts?: { scheme?: string; host?: string; port?: string }): string | null {
  if (!appId || typeof window === 'undefined') return null
  const scheme = (opts?.scheme ?? window.location.protocol.replace(/:$/, '')) || 'http'
  const host = opts?.host ?? window.location.hostname
  if (isLoopbackHostname(host)) return null
  const base = APPS_HOST_SUFFIX.trim().replace(/^\./, '')
  const port = opts?.port ?? window.location.port
  const defaultPort = scheme === 'https' ? '443' : '80'
  const withPort = port && port !== defaultPort ? `:${port}` : ''
  return `${scheme}://${appId}.${base}${withPort}/`
}

/**
 * Map manifest `display.permissions` to iframe `allow` tokens. Only
 * whitelisted, explicitly requested browser features are granted — a
 * normal web app never gets camera/microphone/geolocation/clipboard etc.
 * unless the manifest asks for it.
 */
const IFRAME_ALLOW_TOKENS: Record<string, string> = {
  'clipboard-read': 'clipboard-read',
  'clipboard-write': 'clipboard-write',
  fullscreen: 'fullscreen',
  camera: 'camera',
  microphone: 'microphone',
  geolocation: 'geolocation',
  payment: 'payment',
  usb: 'usb',
  serial: 'serial',
  'xr-spatial-tracking': 'xr-spatial-tracking',
  autoplay: 'autoplay',
  'publickey-credentials-get': 'publickey-credentials-get',
}

export function iframeAllowFor(display?: AppDisplayConfig | null): string {
  const permissions = display?.permissions ?? []
  const tokens = permissions
    .map((p) => IFRAME_ALLOW_TOKENS[p.toLowerCase()])
    .filter((t): t is string => Boolean(t))
  return [...new Set(tokens)].join('; ')
}

/**
 * Sandbox policy (defined ORA app policy, never a blanket of all flags).
 * The default is NO sandbox attribute — a separate origin already isolates
 * the app from the desktop, and sandboxing can break legitimate apps
 * (top-level redirects, same-origin cookies, modals). Apps that opt into
 * `isolation: "strict"` (or declare explicit `sandbox` tokens) get a
 * restrictive set: scripts/forms/popups/downloads allowed (normal web app
 * behaviour), privileged/escape capabilities denied.
 */
export const STRICT_SANDBOX_TOKENS = [
  'allow-scripts',
  'allow-forms',
  'allow-popups',
  'allow-downloads',
  'allow-same-origin',
]

export function iframeSandboxFor(display?: AppDisplayConfig | null): string | undefined {
  const sandbox = display?.sandbox
  if (sandbox && sandbox.length > 0) return [...new Set(sandbox)].join(' ')
  if (display?.isolation === 'strict') return STRICT_SANDBOX_TOKENS.join(' ')
  return undefined
}

/** Display mode with `embedded` as the safe default. */
export function displayModeOf(display?: AppDisplayConfig | null): AppDisplayMode {
  return display?.mode ?? 'embedded'
}
