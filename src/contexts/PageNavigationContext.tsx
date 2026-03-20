import { createContext, useContext, useState } from 'react'
import { useLocalStorage } from '@/lib/storage'
import type { DashboardPage } from '@/lib/types'
import {
  House,
  Lightbulb,
  Thermometer,
  PlugsConnected,
  Gauge,
  Gear,
  FloppyDisk,
  VideoCamera,
  SpeakerHigh,
  Lock,
  Garage,
  Fan,
  Bathtub,
} from '@phosphor-icons/react'

interface PageNavigationContextType {
  currentPageId: string
  setCurrentPageId: (id: string) => void
  pages: DashboardPage[]
  setPages: (pages: DashboardPage[]) => void
  currentPage: DashboardPage | undefined
}

const PageNavigationContext = createContext<PageNavigationContextType | undefined>(undefined)

const defaultPages: DashboardPage[] = [
  {
    id: 'home',
    name: 'Übersicht',
    icon: 'House',
    widgets: [],
    showInNav: true,
    order: 0,
  },
  {
    id: 'settings',
    name: 'Einstellungen',
    icon: 'Gear',
    widgets: [],
    showInNav: true,
    order: 999,
  },
]

export const iconMap = {
  House,
  Lightbulb,
  Thermometer,
  PlugsConnected,
  Gauge,
  Gear,
  FloppyDisk,
  VideoCamera,
  SpeakerHigh,
  Lock,
  Garage,
  Fan,
  Bathtub,
}

export function PageNavigationProvider({ children }: { children: React.ReactNode }) {
  const [pages, setPages] = useLocalStorage<DashboardPage[]>('ha-dashboard-pages', defaultPages)
  const [currentPageId, setCurrentPageId] = useState<string>('home')

  const currentPage = pages.find(p => p.id === currentPageId)

  return (
    <PageNavigationContext.Provider
      value={{
        currentPageId,
        setCurrentPageId,
        pages,
        setPages,
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
