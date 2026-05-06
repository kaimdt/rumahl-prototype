'use client'

import Link from 'next/link'
import { Sparkles, Palette, Package, Sun, Moon } from 'lucide-react'
import { useStoreTheme } from '@/lib/ThemeProvider'

export function Header() {
  const { theme, toggle } = useStoreTheme()
  return (
    <header className="glass-header sticky top-0 z-50">
      <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-3 group">
          <div className="w-9 h-9 rounded-xl bg-accent/15 flex items-center justify-center group-hover:bg-accent/25 transition-colors">
            <Sparkles size={18} className="text-accent" />
          </div>
          <div className="leading-tight">
            <span className="text-sm font-bold tracking-tight text-fg">IORA Store</span>
            <span className="text-[10px] text-muted-fg block -mt-0.5">Themes & Apps</span>
          </div>
        </Link>

        <nav className="flex items-center gap-8">
          <Link href="/themes" className="flex items-center gap-1.5 text-sm font-medium text-muted-fg hover:text-fg transition-colors">
            <Palette size={16} /> Themes
          </Link>
          <Link href="/apps" className="flex items-center gap-1.5 text-sm font-medium text-muted-fg hover:text-fg transition-colors">
            <Package size={16} /> Apps
          </Link>
          {/* <Link href="/plugins" className="flex items-center gap-1.5 text-sm font-medium text-muted-fg hover:text-fg transition-colors">
            <Puzzle size={16} /> Plugins
          </Link> */}
        </nav>

        <button
          onClick={toggle}
          className="w-9 h-9 rounded-xl bg-muted flex items-center justify-center hover:bg-card-hover transition-colors"
          aria-label="Toggle theme"
        >
          {theme === 'dark' ? <Sun size={16} className="text-amber-400" /> : <Moon size={16} className="text-accent" />}
        </button>
      </div>
    </header>
  )
}
