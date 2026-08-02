import { authFetch } from '@/lib/authHelpers'

export type LauncherBase = 'default' | 'deck' | 'canvas'

export interface StoreLauncherPackage {
  type: 'iora-launcher'
  id: string
  name: string
  base: LauncherBase
  accent?: string
  sourceAppId: string
  version: string
}

export interface StoreWidgetPackage {
  id: string
  name: string
  description?: string
  componentUrl?: string
  sourceAppId: string
  version: string
}

interface InstalledPackage {
  id: string
  name: string
  version?: string
  enabled?: boolean
  manifest?: {
    launcher?: { id?: string; name?: string; base?: LauncherBase; accent?: string }
    iora_launcher?: { id?: string; name?: string; base?: LauncherBase; accent?: string }
    widgets?: Array<{ id?: string; name?: string; description?: string; component_url?: string }>
  }
}

function resolveComponentUrl(appId: string, value?: string): string | undefined {
  if (!value) return undefined
  if (/^https?:\/\//.test(value) || value.startsWith('/')) return value
  return `/api/apps/${encodeURIComponent(appId)}/assets/${value.replace(/^\.\//, '')}`
}

export async function loadLauncherPackages(): Promise<{
  launchers: StoreLauncherPackage[]
  widgets: StoreWidgetPackage[]
}> {
  const response = await authFetch('/api/appstore/installed')
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const payload = await response.json() as { apps?: InstalledPackage[] }
  const launchers: StoreLauncherPackage[] = []
  const widgets: StoreWidgetPackage[] = []

  for (const app of payload.apps || []) {
    if (app.enabled === false || !app.manifest) continue
    const definition = app.manifest.launcher || app.manifest.iora_launcher
    if (definition && ['default', 'deck', 'canvas'].includes(definition.base || '')) {
      launchers.push({
        type: 'iora-launcher',
        id: definition.id || `store-${app.id}`,
        name: definition.name || app.name,
        base: definition.base as LauncherBase,
        accent: definition.accent,
        sourceAppId: app.id,
        version: app.version || '0.0.0',
      })
    }

    for (const widget of app.manifest.widgets || []) {
      if (!widget.id || !widget.name) continue
      widgets.push({
        id: `${app.id}:${widget.id}`,
        name: widget.name,
        description: widget.description,
        componentUrl: resolveComponentUrl(app.id, widget.component_url),
        sourceAppId: app.id,
        version: app.version || '0.0.0',
      })
    }
  }

  return { launchers, widgets }
}
