/**
 * router — a small declarative router for ORA OS (React-Router-style, but
 * in-house). One route table is the single source of truth for path ↔ pageId
 * mapping with `:param` support. Used by PageNavigationContext to match URLs.
 */

export interface RouteMatch {
  pageId: string
  /** Named `:params` captured from the path (e.g. `:appId`). */
  params: Record<string, string>
  /** Remaining sub-path after the matched prefix (e.g. `apps/<id>` for settings). */
  subPath: string
}

export interface Route {
  /** Path pattern; `:name` segments capture params. */
  pattern: string
  /** Literal pageId, or `':name'` to resolve from a captured param. */
  pageId: string
  /** Exact-only match (default true for `/`); system/dynamic routes match deeper too. */
  exact?: boolean
}

/** Declarative route table — order matters (system paths first, then dynamic). */
export const ROUTES: Route[] = [
  { pattern: '/', pageId: 'launcher', exact: true },
  { pattern: '/admin', pageId: 'admin' },
  { pattern: '/settings', pageId: 'settings' },
  { pattern: '/app-store', pageId: 'app-store' },
  { pattern: '/docs', pageId: 'docs' },
  { pattern: '/share', pageId: 'share' },
  { pattern: '/streaming', pageId: 'streaming' },
  { pattern: '/agent', pageId: 'ai-agent' },
  { pattern: '/automations', pageId: 'automations' },
  { pattern: '/files', pageId: 'os-files' },
  { pattern: '/images', pageId: 'os-images' },
  { pattern: '/network', pageId: 'os-network' },
  { pattern: '/system', pageId: 'os-system' },
  { pattern: '/security', pageId: 'os-security' },
  { pattern: '/storage', pageId: 'os-storage' },
  { pattern: '/devices', pageId: 'os-devices' },
  { pattern: '/containers', pageId: 'os-containers' },
  { pattern: '/logs', pageId: 'os-logs' },
  { pattern: '/services', pageId: 'os-services' },
  { pattern: '/updates', pageId: 'os-updates' },
  { pattern: '/backups', pageId: 'os-backups' },
  { pattern: '/info', pageId: 'os-info' },
  { pattern: '/app/:appId', pageId: ':appId' },
  { pattern: '/apps/:appId', pageId: ':appId' },
  { pattern: '/page/:pageId', pageId: ':pageId' },
  { pattern: '/:pageId', pageId: ':pageId', exact: true },
]

function split(path: string): string[] {
  return path.split('/').filter(Boolean)
}

/** Built-in HA entity pages that map to a single `/id` path (not in ROUTES). */
export const BUILTIN_SINGLE_SEGMENT_PAGES = ['home', 'lights', 'climate', 'switches', 'sensors']

/** Match a pathname against the route table. */
export function matchRoute(pathname: string): RouteMatch {
  const normalized = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname
  if (normalized === '') return { pageId: 'launcher', params: {}, subPath: '' }

  const pathSegments = split(normalized)
  for (const route of ROUTES) {
    const patternSegments = split(route.pattern)
    if (patternSegments.length > pathSegments.length) continue

    const params: Record<string, string> = {}
    let ok = true
    for (let i = 0; i < patternSegments.length; i++) {
      const pat = patternSegments[i]
      const seg = pathSegments[i]
      if (pat.startsWith(':')) {
        params[pat.slice(1)] = seg
      } else if (pat !== seg) {
        ok = false
        break
      }
    }
    if (!ok) continue

    const isExact = patternSegments.length === pathSegments.length
    if (!isExact && route.exact) continue

    const pageId = route.pageId.startsWith(':') ? params[route.pageId.slice(1)] || route.pageId : route.pageId
    const subPath = isExact ? '' : pathSegments.slice(patternSegments.length).join('/')
    return { pageId, params, subPath }
  }

  return { pageId: normalized.slice(1), params: {}, subPath: '' }
}

/** Build a URL path for a page id (mirrors the legacy pageIdToPath). */
export function buildPath(
  pageId: string,
  options?: { docPath?: string; subPath?: string; isAppPage?: boolean },
): string {
  if (pageId === 'docs' && options?.docPath) return `/docs/${options.docPath}`

  for (const route of ROUTES) {
    if (route.pageId === pageId && !route.pattern.includes(':')) {
      let base = route.pattern
      if (options?.subPath) {
        const clean = options.subPath.replace(/^\/+|\/+$/g, '')
        if (clean) base = `${base}/${clean}`
      }
      return base
    }
  }

  if (BUILTIN_SINGLE_SEGMENT_PAGES.includes(pageId)) return `/${pageId}`

  let base = options?.isAppPage ? `/app/${pageId}` : `/page/${pageId}`
  if (options?.subPath) {
    const clean = options.subPath.replace(/^\/+|\/+$/g, '')
    if (clean) base = `${base}/${clean}`
  }
  return base
}
