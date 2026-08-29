import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AnimatePresence, motion } from 'motion/react'
import {
  ArrowClockwise,
  Brain,
  CaretLeft,
  Cpu,
  Cube,
  Gauge,
  Globe,
  HardDrives,
  House,
  ListBullets,
  Palette,
  Plug,
  ShieldWarning,
  Terminal,
  Users,
  WifiHigh,
  Wrench,
} from '@phosphor-icons/react'
import { useAuth } from '@/contexts/AuthContext'
import { usePageNavigation } from '@/contexts/PageNavigationContext'
import { renderAdminTabContent, tabGroups, getTabs, type Tab } from '@/components/AdminPanel'
import { useOsPermissions } from '@/hooks/useOsPermissions'
import { authFetch } from '@/lib/authHelpers'
import { useCallback, useEffect } from 'react'
import { OsTerminal } from '@/components/OsTerminal'
import { useShellMode } from '@/hooks/useShellMode'
import { DesktopAdminCenter } from '@/components/DesktopAdminCenter'

/**
 * AdminCenter — Windows 11 Settings-style admin shell.
 *
 * Narrow icon sidebar (categories) → category overview with cards →
 * detail view with a back arrow. The 69 existing admin tabs stay intact
 * (renderAdminTabContent); native OS apps (Storage, Containers, Logs,
 * Services, Devices, System Monitor) are surfaced as primary cards that
 * deep-link into the apps instead of duplicating admin views.
 */

interface Category {
  id: string
  title: string
  icon: typeof Cpu
  items: Tab[]
  /** Native OS app deep links offered at the top of this category. */
  apps?: Array<{ pageId: string; nameKey: string; icon: typeof Cube }>
}

const NATIVE_APPS: Array<{ pageId: string; nameKey: string; icon: typeof Cube }> = [
  { pageId: 'os-storage', nameKey: 'os.apps.storage.name', icon: HardDrives },
  { pageId: 'os-containers', nameKey: 'os.apps.containers.name', icon: Cube },
  { pageId: 'os-logs', nameKey: 'os.apps.logs.name', icon: ListBullets },
  { pageId: 'os-services', nameKey: 'os.apps.services.name', icon: Wrench },
  { pageId: 'os-devices', nameKey: 'os.apps.devices.name', icon: WifiHigh },
  { pageId: 'os-system', nameKey: 'os.apps.system.name', icon: Gauge },
]

export function AdminCenter() {
  const { resolvedMode } = useShellMode()
  const { t } = useTranslation()
  const { token } = useAuth()
  const { setCurrentPageId } = usePageNavigation()
  const { can } = useOsPermissions()
  const tabEntries = useMemo(() => getTabs(t), [t])
  const tabById = useMemo(() => new Map(tabEntries.map((entry) => [entry.id, entry])), [tabEntries])

  const [categoryId, setCategoryId] = useState<string>('home')
  const [detailTab, setDetailTab] = useState<Tab | null>(null)

  // System health for the home overview.
  const [health, setHealth] = useState<{ status: string; ha_connected?: boolean; version?: string } | null>(null)
  const [servicesUp, setServicesUp] = useState<number | null>(null)

  const refreshHealth = useCallback(async () => {
    try {
      const [healthResponse, servicesResponse] = await Promise.all([
        fetch('/health'),
        can('os.system.read') ? authFetch('/api/os/control/os/services') : Promise.resolve(null),
      ])
      if (healthResponse.ok) setHealth(await healthResponse.json())
      if (servicesResponse?.ok) {
        const data = await servicesResponse.json()
        setServicesUp((data.services || []).filter((s: { active?: string }) => s.active === 'active').length)
      }
    } catch {
      // offline
    }
  }, [can])

  useEffect(() => {
    void refreshHealth()
    const id = window.setInterval(refreshHealth, 15_000)
    return () => window.clearInterval(id)
  }, [refreshHealth])

  // Category structure: home + the existing admin groups.
  const categories: Category[] = useMemo(() => [
    { id: 'home', title: t('adminCenter.home'), icon: House, items: [] },
    { id: 'terminal', title: t('adminCenter.terminal'), icon: Terminal, items: [] },
    ...tabGroups.map((group) => ({ id: group.id, title: group.title, icon: group.icon as typeof Cpu, items: group.items as Tab[] })),
  ], [t])

  const activeCategory = categories.find((category) => category.id === categoryId) || categories[0]

  const openApp = (pageId: string) => {
    setCurrentPageId(pageId)
  }

  const openDetail = (tab: Tab) => {
    setDetailTab(tab)
  }

  const backToOverview = () => {
    setDetailTab(null)
  }

  if (resolvedMode === 'desktop') {
    return (
      <DesktopAdminCenter
        healthStatus={health?.status}
        version={health?.version}
        servicesUp={servicesUp}
        onOpenApp={openApp}
      />
    )
  }

  // ── Home overview ─────────────────────────────────────────────────────────
  const renderHome = () => (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{t('adminCenter.title')}</h1>
        <p className="mt-1 text-sm text-foreground/50">{t('adminCenter.subtitle')}</p>
      </div>

      {/* System status strip */}
      <div className="grid gap-3 sm:grid-cols-3">
        <StatusCard icon={Gauge} label={t('adminCenter.status')} value={health?.status || t('adminCenter.checking')} good={health?.status === 'ok'} />
        <StatusCard icon={ArrowClockwise} label={t('adminCenter.servicesUp')} value={servicesUp != null ? String(servicesUp) : '–'} />
        <StatusCard icon={Cube} label={t('adminCenter.version')} value={health?.version || '–'} />
      </div>

      {/* Native OS apps — primary surfaces */}
      <div>
        <h2 className="mb-3 text-sm font-semibold text-foreground/70">{t('adminCenter.osApps')}</h2>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {NATIVE_APPS.map((app) => {
            const Icon = app.icon
            return (
              <button key={app.pageId} type="button" onClick={() => openApp(app.pageId)} className="rumahl-card group rounded-2xl p-4 text-left transition-colors hover:bg-foreground/6">
                <span className="grid size-10 place-items-center rounded-xl bg-accent/15 text-accent"><Icon size={20} weight="duotone" /></span>
                <span className="mt-3 block text-sm font-semibold">{t(app.nameKey, app.pageId)}</span>
                <span className="mt-1 block text-[11px] text-foreground/45">{t('adminCenter.openApp')}</span>
              </button>
            )
          })}
        </div>
      </div>

      {/* Categories */}
      <div>
        <h2 className="mb-3 text-sm font-semibold text-foreground/70">{t('adminCenter.categories')}</h2>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {categories.filter((category) => category.id !== 'home').map((category) => {
            const Icon = category.icon
            return (
              <button key={category.id} type="button" onClick={() => setCategoryId(category.id)} className="rumahl-card group rounded-2xl p-4 text-left transition-colors hover:bg-foreground/6">
                <span className="grid size-10 place-items-center rounded-xl bg-foreground/8 text-foreground/70"><Icon size={20} weight="duotone" /></span>
                <span className="mt-3 block text-sm font-semibold">{category.title}</span>
                <span className="mt-1 block text-[11px] text-foreground/45">{category.items.length} {t('adminCenter.items')}</span>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )

  // ── Category overview (Windows 11 settings style) ────────────────────────
  const renderCategory = (category: Category) => (
    <div className="space-y-6">
      {category.id === 'terminal' && <OsTerminal />}
      {category.id !== 'terminal' && (
      <>
      <div>
        <h1 className="text-2xl font-semibold">{category.title}</h1>
        <p className="mt-1 text-sm text-foreground/50">{category.items.length} {t('adminCenter.items')}</p>
      </div>

      {category.apps && category.apps.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {category.apps.map((app) => {
            const Icon = app.icon
            return (
              <button key={app.pageId} type="button" onClick={() => openApp(app.pageId)} className="rumahl-card rounded-2xl border border-accent/25 bg-accent/6 p-4 text-left transition-colors hover:bg-accent/10">
                <span className="grid size-10 place-items-center rounded-xl bg-accent/15 text-accent"><Icon size={20} weight="duotone" /></span>
                <span className="mt-3 block text-sm font-semibold">{t(app.nameKey, app.pageId)}</span>
                <span className="mt-1 block text-[11px] text-foreground/45">{t('adminCenter.openApp')}</span>
              </button>
            )
          })}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {category.items.map((tabId) => {
          const entry = tabById.get(tabId)
          if (!entry) return null
          const Icon = entry.icon as typeof Cpu
          return (
            <button key={tabId} type="button" onClick={() => openDetail(tabId)} className="rumahl-card rounded-2xl p-4 text-left transition-colors hover:bg-foreground/6">
              <span className="grid size-10 place-items-center rounded-xl bg-foreground/8 text-foreground/70"><Icon size={20} weight="duotone" /></span>
              <span className="mt-3 block text-sm font-semibold">{entry.label}</span>
              {entry.description && <span className="mt-1 line-clamp-2 block text-[11px] text-foreground/45">{entry.description}</span>}
            </button>
          )
        })}
      </div>
      </>
      )}
    </div>
  )

  // ── Detail view ───────────────────────────────────────────────────────────
  const detailEntry = detailTab ? tabById.get(detailTab) : null

  return (
    <div className="flex min-h-full">
      {/* Narrow category sidebar (Windows 11 style) */}
      <nav className="sticky top-0 flex h-[calc(100dvh-3.5rem)] w-16 shrink-0 flex-col items-center gap-1 border-r border-foreground/8 bg-foreground/2 py-3">
        {categories.map((category) => {
          const Icon = category.icon
          const active = categoryId === category.id && !detailTab
          return (
            <button
              key={category.id}
              type="button"
              onClick={() => { setCategoryId(category.id); setDetailTab(null) }}
              title={category.title}
              className={`grid size-11 place-items-center rounded-2xl transition-colors ${active ? 'bg-accent/18 text-accent' : 'text-foreground/55 hover:bg-foreground/7 hover:text-foreground'}`}
            >
              <Icon size={20} weight={active ? 'fill' : 'duotone'} />
            </button>
          )
        })}
      </nav>

      {/* Main area */}
      <main className="min-w-0 flex-1 overflow-y-auto p-5 sm:p-7">
        {detailTab ? (
          <div>
            <div className="mb-5 flex items-center gap-3">
              <button type="button" onClick={backToOverview} className="grid size-9 place-items-center rounded-xl bg-foreground/6 text-foreground/70 transition-colors hover:bg-foreground/10" title={t('adminCenter.back')}>
                <CaretLeft size={17} weight="bold" />
              </button>
              <div>
                <p className="text-xs uppercase tracking-wider text-foreground/40">{activeCategory.title}</p>
                <h1 className="text-xl font-semibold">{detailEntry?.label || detailTab}</h1>
              </div>
            </div>
            <AnimatePresence mode="wait">
              <motion.div key={detailTab} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}>
                {renderAdminTabContent(detailTab, token || '')}
              </motion.div>
            </AnimatePresence>
          </div>
        ) : (
          <AnimatePresence mode="wait">
            <motion.div key={categoryId} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}>
              {categoryId === 'home' ? renderHome() : renderCategory(activeCategory)}
            </motion.div>
          </AnimatePresence>
        )}
      </main>
    </div>
  )
}

function StatusCard({ icon: Icon, label, value, good = true }: { icon: typeof Gauge; label: string; value: string; good?: boolean }) {
  return (
    <div className="rumahl-card rounded-2xl p-4">
      <Icon size={20} className={good ? 'text-emerald-400' : 'text-amber-400'} />
      <p className="mt-3 text-lg font-semibold">{value}</p>
      <p className="text-xs text-foreground/40">{label}</p>
    </div>
  )
}
