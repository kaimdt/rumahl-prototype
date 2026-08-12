import type { Icon } from '@phosphor-icons/react'
import {
  BookOpen,
  Heartbeat,
  HardDrives,
  Archive,
  DownloadSimple,
  FolderOpen,
  Gear,
  House,
  FlowArrow,
  Robot,
  ShareNetwork,
  Storefront,
  VideoCamera,
  WifiHigh,
} from '@phosphor-icons/react'
import type { DashboardPage } from '@/lib/types'

export type OsAppKind = 'system' | 'installed' | 'custom'

export interface OsAppDefinition {
  id: string
  pageId: string
  nameKey?: string
  fallbackName: string
  descriptionKey?: string
  icon: Icon
  kind: OsAppKind
  adminOnly?: boolean
  requiredPermission?: 'os.files.read' | 'os.network.read' | 'os.system.read' | 'os.updates' | 'os.backups'
  accent: string
  order: number
  /** Remote icon URL (installed Docker apps) — rendered as <img> when set. */
  iconUrl?: string
  /** Web UI to open on click (installed Docker apps without a page). */
  openUrl?: string
  /** Render the icon smaller (object-contain) so its corners aren't clipped. */
  iconPad?: boolean
  /** Runtime status for installed apps ("running" | "stopped" | …). */
  runtimeStatus?: string
}

export const SYSTEM_OS_APPS: OsAppDefinition[] = [
  {
    id: 'iora-home',
    pageId: 'home',
    nameKey: 'os.apps.home.name',
    fallbackName: 'Home',
    descriptionKey: 'os.apps.home.description',
    icon: House,
    kind: 'system',
    accent: 'oklch(0.68 0.17 155)',
    iconUrl: '/icons/Home.png',
    order: 0,
  },
  {
    id: 'iora-settings',
    pageId: 'settings',
    nameKey: 'os.apps.settings.name',
    fallbackName: 'Settings',
    descriptionKey: 'os.apps.settings.description',
    icon: Gear,
    kind: 'system',
    accent: 'oklch(0.64 0.08 245)',
    iconUrl: '/icons/Settings.png',
    order: 20,
  },
  {
    id: 'iora-images',
    pageId: 'os-images',
    nameKey: 'os.apps.images.name',
    fallbackName: 'Bilder',
    descriptionKey: 'os.apps.images.description',
    icon: House,
    kind: 'system',
    accent: 'oklch(0.62 0.15 260)',
    iconUrl: '/icons/Images.png',
    order: 22,
  },
  {
    id: 'iora-files',
    pageId: 'os-files',
    nameKey: 'os.apps.files.name',
    fallbackName: 'Files',
    descriptionKey: 'os.apps.files.description',
    icon: FolderOpen,
    kind: 'system',
    accent: 'oklch(0.68 0.16 80)',
    iconUrl: '/icons/folder.png',
    iconPad: true,
    order: 21,
  },
  {
    id: 'iora-app-store',
    pageId: 'app-store',
    nameKey: 'os.apps.appStore.name',
    fallbackName: 'App Store',
    descriptionKey: 'os.apps.appStore.description',
    icon: Storefront,
    kind: 'system',
    accent: 'oklch(0.65 0.2 285)',
    iconUrl: '/icons/appstore.png',
    iconPad: true,
    order: 22,
  },
  {
    id: 'iora-network',
    pageId: 'os-network',
    nameKey: 'os.apps.network.name',
    fallbackName: 'Network',
    descriptionKey: 'os.apps.network.description',
    icon: WifiHigh,
    kind: 'system',
    requiredPermission: 'os.system.read',
    accent: 'oklch(0.67 0.16 205)',
    order: 23,
  },
  {
    id: 'iora-storage',
    pageId: 'os-storage',
    nameKey: 'os.apps.storage.name',
    fallbackName: 'Storage',
    descriptionKey: 'os.apps.storage.description',
    icon: HardDrives,
    kind: 'system',
    requiredPermission: 'os.system.read',
    accent: 'oklch(0.68 0.16 205)',
    order: 23,
  },
  {
    id: 'iora-system',
    pageId: 'os-system',
    nameKey: 'os.apps.system.name',
    fallbackName: 'System Monitor',
    descriptionKey: 'os.apps.system.description',
    icon: Heartbeat,
    kind: 'system',
    adminOnly: true,
    accent: 'oklch(0.66 0.17 145)',
    order: 23,
  },
  {
    id: 'iora-updates',
    pageId: 'os-updates',
    nameKey: 'os.apps.updates.name',
    fallbackName: 'Updates',
    descriptionKey: 'os.apps.updates.description',
    icon: DownloadSimple,
    kind: 'system',
    requiredPermission: 'os.updates',
    accent: 'oklch(0.66 0.18 255)',
    order: 24,
  },
  {
    id: 'iora-backups',
    pageId: 'os-backups',
    nameKey: 'os.apps.backups.name',
    fallbackName: 'Backups',
    descriptionKey: 'os.apps.backups.description',
    icon: Archive,
    kind: 'system',
    requiredPermission: 'os.backups',
    accent: 'oklch(0.66 0.16 45)',
    order: 25,
  },
  {
    id: 'iora-automations',
    pageId: 'automations',
    nameKey: 'os.apps.automations.name',
    fallbackName: 'Automations',
    descriptionKey: 'os.apps.automations.description',
    icon: FlowArrow,
    kind: 'system',
    accent: 'oklch(0.65 0.2 285)',
    order: 26,
  },
  {
    id: 'iora-agent',
    pageId: 'ai-agent',
    nameKey: 'os.apps.agent.name',
    fallbackName: 'Agent',
    descriptionKey: 'os.apps.agent.description',
    icon: Robot,
    kind: 'system',
    accent: 'oklch(0.67 0.19 305)',
    order: 30,
  },
  {
    id: 'iora-streaming',
    pageId: 'streaming',
    nameKey: 'os.apps.streaming.name',
    fallbackName: 'Streaming',
    descriptionKey: 'os.apps.streaming.description',
    icon: VideoCamera,
    kind: 'system',
    accent: 'oklch(0.65 0.19 25)',
    order: 40,
  },
  {
    id: 'iora-share',
    pageId: 'share',
    nameKey: 'os.apps.share.name',
    fallbackName: 'Share',
    descriptionKey: 'os.apps.share.description',
    icon: ShareNetwork,
    kind: 'system',
    accent: 'oklch(0.68 0.16 205)',
    order: 50,
  },
  {
    id: 'iora-docs',
    pageId: 'docs',
    nameKey: 'os.apps.docs.name',
    fallbackName: 'Documentation',
    descriptionKey: 'os.apps.docs.description',
    icon: BookOpen,
    kind: 'system',
    accent: 'oklch(0.69 0.15 80)',
    order: 60,
  },
]

const SYSTEM_PAGE_IDS = new Set(SYSTEM_OS_APPS.map((app) => app.pageId))

export function createPageApps(
  pages: DashboardPage[],
  resolveIcon: (name: string) => Icon | undefined,
): OsAppDefinition[] {
  return pages
    .filter((page) => !SYSTEM_PAGE_IDS.has(page.id) && !page.parentPageId)
    .map((page, index) => ({
      id: `page-${page.id}`,
      pageId: page.id,
      fallbackName: page.name,
      icon: resolveIcon(page.icon) || House,
      kind: page.pageType === 'app' || page.pageSource?.kind === 'app' ? 'installed' : 'custom',
      accent: page.pageType === 'app' || page.pageSource?.kind === 'app'
        ? 'oklch(0.67 0.18 285)'
        : 'oklch(0.66 0.12 225)',
      order: 100 + (page.order ?? index),
    }))
}
