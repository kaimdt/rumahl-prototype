import { lazy, type ReactNode } from 'react'
import { OsHomeScreen } from '@/components/OsHomeScreen'
import { OsSystemApp } from '@/components/OsSystemApp'
import { OsImagesApp } from '@/components/OsImagesApp'
import { OsSecurityApp } from '@/components/OsSecurityApp'
import { OsMaintenanceApp } from '@/components/OsMaintenanceApp'
import { OsInfoApp } from '@/components/OsInfoApp'
import { OsAppWindow } from '@/components/OsAppWindow'
import { OsWindowActions } from '@/components/OsWindowActions'

// Heavy built-in pages stay lazy-loaded so the initial bundle stays small.
const AdminCenter = lazy(() => import('@/components/AdminCenter').then((m) => ({ default: m.AdminCenter })))
const AgentTab = lazy(() => import('@/components/AgentTab').then((m) => ({ default: m.AgentTab })))
const AutomationEditorApp = lazy(() => import('@/components/AutomationEditorApp').then((m) => ({ default: m.AutomationEditorApp })))
const OsStorageApp = lazy(() => import('@/components/OsStorageApp').then((m) => ({ default: m.OsStorageApp })))
const OsDevicesApp = lazy(() => import('@/components/OsDevicesApp').then((m) => ({ default: m.OsDevicesApp })))
const OsContainersApp = lazy(() => import('@/components/OsContainersApp').then((m) => ({ default: m.OsContainersApp })))
const OsLogsApp = lazy(() => import('@/components/OsLogsApp').then((m) => ({ default: m.OsLogsApp })))
const OsServicesApp = lazy(() => import('@/components/OsServicesApp').then((m) => ({ default: m.OsServicesApp })))
const DocsPage = lazy(() => import('@/components/DocsPageNew').then((m) => ({ default: m.DocsPage })))
const SharePage = lazy(() => import('@/components/SharePage').then((m) => ({ default: m.SharePage })))
const StreamSender = lazy(() => import('@/components/StreamSender').then((m) => ({ default: m.StreamSender })))
const AppStoreTab = lazy(() => import('@/components/AppStoreTab').then((m) => ({ default: m.AppStoreTab })))

/**
 * osPageRegistry — the single source of truth for built-in ORA OS pages.
 *
 * Adding a new built-in page means adding ONE entry here (id + render + an
 * optional fullscreen chrome wrapper) instead of touching the App.tsx switch,
 * the `standaloneAppPageIds` array and the `data-page` mapping separately.
 */

/** Canonical list of built-in system/OS page ids (replaces the duplicated
 *  arrays that previously lived inline in App.tsx). */
export const BUILTIN_PAGE_IDS = [
  'launcher', 'settings', 'app-store', 'admin', 'docs', 'share', 'streaming',
  'ai-agent',
  'os-files', 'os-network', 'os-system', 'os-updates', 'os-backups',
  'os-images', 'os-security', 'os-storage', 'os-devices', 'os-containers',
  'os-logs', 'os-services', 'os-info',
] as const

export function isBuiltinPageId(id: string): boolean {
  return (BUILTIN_PAGE_IDS as readonly string[]).includes(id)
}

export interface PageRenderContext {
  token: string | null
  isAdmin: boolean
  t: (key: string, options?: Record<string, unknown>) => string
  getOsAppName: (id: string) => string
  getOsAppIcon: (id: string) => ReactNode
  /** Heavy settings bundle — provided by App so the registry stays thin. */
  renderSettings: () => ReactNode
}

/** Raw page content (no window chrome) — used by the window manager. */
export function renderBuiltinPage(pageId: string, ctx: PageRenderContext): ReactNode {
  switch (pageId) {
    case 'launcher': return <OsHomeScreen />
    case 'os-files': return <OsSystemApp kind="files" />
    case 'os-images': return <OsImagesApp />
    case 'os-network': return <OsSystemApp kind="network" />
    case 'os-system': return <OsSystemApp kind="system" />
    case 'os-security': return <OsSecurityApp />
    case 'os-storage': return <OsStorageApp />
    case 'os-devices': return <OsDevicesApp />
    case 'os-containers': return <OsContainersApp />
    case 'os-logs': return <OsLogsApp />
    case 'os-services': return <OsServicesApp />
    case 'os-info': return <OsInfoApp />
    case 'os-updates': return <OsMaintenanceApp kind="updates" />
    case 'os-backups': return <OsMaintenanceApp kind="backups" />
    case 'app-store': return <AppStoreTab token={ctx.token || ''} />
    case 'settings': return ctx.renderSettings()
    case 'admin': return ctx.isAdmin ? <AdminCenter /> : null
    case 'docs': return <DocsPage />
    case 'share': return <SharePage />
    case 'streaming': return <StreamSender />
    case 'ai-agent': return <AgentTab token={ctx.token || ''} />
    case 'automations': return <AutomationEditorApp />
    default: return null
  }
}

/** Fullscreen OS page — embedded apps get OS window chrome. */
export function renderBuiltinPageFullscreen(pageId: string, ctx: PageRenderContext): ReactNode {
  switch (pageId) {
    case 'app-store':
      return (
        <section className="ora-app-frame p-4 sm:p-6">
          <header className="mb-6 flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">ORA OS</p>
              <h1 className="mt-1 text-3xl font-semibold">{ctx.t('os.apps.appStore.name')}</h1>
              <p className="mt-1 text-sm text-foreground/45">{ctx.t('os.apps.appStore.description')}</p>
            </div>
            <OsWindowActions pageId={pageId} />
          </header>
          <AppStoreTab token={ctx.token || ''} />
        </section>
      )
    case 'admin':
      return ctx.isAdmin
        ? <OsAppWindow pageId={pageId} title={ctx.t('navigation.admin')} icon={ctx.getOsAppIcon(pageId)} noClip><AdminCenter /></OsAppWindow>
        : null
    case 'docs':
      return <OsAppWindow pageId={pageId} title={ctx.t('navigation.docs')} icon={ctx.getOsAppIcon(pageId)}><DocsPage /></OsAppWindow>
    case 'share':
      return <OsAppWindow pageId={pageId} title={ctx.t('os.apps.share.name')} icon={ctx.getOsAppIcon(pageId)}><SharePage /></OsAppWindow>
    case 'streaming':
      return <OsAppWindow pageId={pageId} title={ctx.t('os.apps.streaming.name')} icon={ctx.getOsAppIcon(pageId)}><StreamSender /></OsAppWindow>
    case 'ai-agent':
      return <OsAppWindow pageId={pageId} title={ctx.t('os.apps.agent.name')} icon={ctx.getOsAppIcon(pageId)}><AgentTab token={ctx.token || ''} /></OsAppWindow>
    case 'automations':
      return <OsAppWindow pageId={pageId} title={ctx.t('os.apps.automations.name')} icon={ctx.getOsAppIcon(pageId)} noClip><AutomationEditorApp /></OsAppWindow>
    default:
      return renderBuiltinPage(pageId, ctx)
  }
}
