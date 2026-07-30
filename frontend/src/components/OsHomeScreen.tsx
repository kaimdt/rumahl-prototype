import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { MagnifyingGlass, SquaresFour } from '@phosphor-icons/react'
import { motion } from 'motion/react'
import { useAuth } from '@/contexts/AuthContext'
import { iconMap, usePageNavigation } from '@/contexts/PageNavigationContext'
import { createPageApps, SYSTEM_OS_APPS } from '@/lib/osAppRegistry'
import { useOsPermissions } from '@/hooks/useOsPermissions'

export function OsHomeScreen() {
  const { t } = useTranslation()
  const { user } = useAuth()
  const { pages, setCurrentPageId } = usePageNavigation()
  const [query, setQuery] = useState('')
  const { permissions } = useOsPermissions()

  const apps = useMemo(() => {
    const pageApps = createPageApps(pages, (name) => iconMap[name as keyof typeof iconMap])
    return [...SYSTEM_OS_APPS, ...pageApps]
      .filter((app) => !app.adminOnly || user?.isAdmin)
      .filter((app) => !app.requiredPermission || permissions[app.requiredPermission] === true)
      .sort((a, b) => a.order - b.order)
  }, [pages, permissions, user?.isAdmin])

  const visibleApps = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase()
    if (!normalizedQuery) return apps
    return apps.filter((app) => {
      const name = app.nameKey ? t(app.nameKey, app.fallbackName) : app.fallbackName
      return name.toLocaleLowerCase().includes(normalizedQuery)
    })
  }, [apps, query, t])

  return (
    <section className="min-h-[calc(100vh-11rem)] pb-8">
      <div className="mx-auto max-w-6xl">
        <div className="mb-8 flex flex-col gap-5 sm:mb-10 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.22em] text-foreground/45">
              {t('os.eyebrow')}
            </p>
            <h2 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
              {t('os.greeting', { name: user?.displayName || user?.username || t('os.defaultUser') })}
            </h2>
            <p className="mt-2 max-w-xl text-sm text-foreground/55 sm:text-base">
              {t('os.subtitle')}
            </p>
          </div>

          <label className="glass-card flex min-h-12 w-full items-center gap-3 rounded-2xl px-4 sm:w-72">
            <MagnifyingGlass size={19} className="shrink-0 text-foreground/40" />
            <span className="sr-only">{t('os.search')}</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('os.search')}
              className="w-full bg-transparent text-sm text-foreground outline-none placeholder:text-foreground/35"
            />
          </label>
        </div>

        <div className="mb-4 flex items-center gap-2 px-1">
          <SquaresFour size={18} weight="fill" className="text-accent" />
          <h3 className="text-sm font-semibold text-foreground">{t('os.allApps')}</h3>
          <span className="text-xs text-foreground/35">{visibleApps.length}</span>
        </div>

        {visibleApps.length > 0 ? (
          <div className="grid grid-cols-3 gap-x-3 gap-y-6 sm:grid-cols-4 sm:gap-x-5 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7">
            {visibleApps.map((app, index) => {
              const AppIcon = app.icon
              const name = app.nameKey ? t(app.nameKey, app.fallbackName) : app.fallbackName
              const description = app.descriptionKey ? t(app.descriptionKey) : undefined
              return (
                <motion.button
                  key={app.id}
                  type="button"
                  onClick={() => setCurrentPageId(app.pageId)}
                  initial={{ opacity: 0, y: 14 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: Math.min(index * 0.025, 0.25) }}
                  whileHover={{ y: -4, scale: 1.02 }}
                  whileTap={{ scale: 0.95 }}
                  className="group flex min-w-0 flex-col items-center rounded-3xl p-2 text-center focus-ring"
                  aria-label={description ? `${name}: ${description}` : name}
                >
                  <span
                    className="relative flex aspect-square w-full max-w-[5.5rem] items-center justify-center overflow-hidden rounded-[1.65rem] border border-white/15 shadow-lg transition-shadow group-hover:shadow-xl"
                    style={{
                      background: `linear-gradient(145deg, color-mix(in oklch, ${app.accent} 88%, white), color-mix(in oklch, ${app.accent} 76%, black))`,
                      boxShadow: `0 14px 32px color-mix(in oklch, ${app.accent} 24%, transparent)`,
                    }}
                  >
                    <span className="absolute inset-0 bg-gradient-to-br from-white/25 via-transparent to-black/10" />
                    <AppIcon size={36} weight="duotone" className="relative text-white drop-shadow-sm" />
                  </span>
                  <span className="mt-2.5 w-full truncate text-xs font-medium text-foreground/85 sm:text-sm">
                    {name}
                  </span>
                  <span className="mt-0.5 text-[10px] uppercase tracking-wide text-foreground/35">
                    {app.kind === 'system' ? t('os.systemApp') : app.kind === 'installed' ? t('os.installedApp') : t('os.customApp')}
                  </span>
                </motion.button>
              )
            })}
          </div>
        ) : (
          <div className="glass-card rounded-3xl p-10 text-center text-sm text-foreground/50">
            {t('os.noApps')}
          </div>
        )}
      </div>
    </section>
  )
}
