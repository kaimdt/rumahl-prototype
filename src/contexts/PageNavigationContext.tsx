import { createContext, useContext, useState } from 'react'
import { useLocalStorage } from '@/lib/storage'
import type { DashboardPage } from '@/lib/types'
import { House, Lightbulb, Thermometer, PlugsConnected, Gauge, Gear } from '@phosphor-icons/react'

interface PageNavigationContextType {
  currentPageId: string
  setCurrentPageId: (id: string) => void
  pages: DashboardPage[]
  currentPage: DashboardPage | undefined
}

const PageNavigationContext = createContext<PageNavigationContextType | undefined>(undefined)

const defaultPages: DashboardPage[] = [
  {
    id: 'home',
    name: 'Übersicht',
    icon: 'House',
    widgets: [],
  },
  {
    id: 'lights',
    name: 'Beleuchtung',
    icon: 'Lightbulb',
    widgets: [],
  },
  {
    id: 'climate',
    name: 'Klima',
    icon: 'Thermometer',
    widgets: [],
  },
  {
    id: 'switches',
    name: 'Schalter',
    icon: 'PlugsConnected',
    widgets: [],
  },
  {
    id: 'sensors',
    name: 'Sensoren',
    icon: 'Gauge',
    widgets: [],
  },
  {
    id: 'settings',
    name: 'Einstellungen',
    icon: 'Gear',
    widgets: [],
  },
]

export const iconMap = {
  House,
  Lightbulb,
  Thermometer,
  PlugsConnected,
  Gauge,
  Gear,
}

export function PageNavigationProvider({ children }: { children: React.ReactNode }) {
  const [pages] = useLocalStorage<DashboardPage[]>('ha-dashboard-pages', defaultPages)
  const [currentPageId, setCurrentPageId] = useState<string>('home')

  const currentPage = pages.find(p => p.id === currentPageId)

  return (
    <PageNavigationContext.Provider
      value={{
        currentPageId,
        setCurrentPageId,
        pages,
        currentPage,
      }}
    >
      {children}
    </PageNavigationContext.Provider>
  )
}

export function usePageNavigation() {
  const context = useContext(PageNavigationContext)
  if (!context) throw new Error('usePageNavigation must be used within PageNavigationProvider')
  return context
}
