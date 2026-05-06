'use client'

import Link from 'next/link'
import { Header } from '@/components/Header'
import { Search, Palette, Package, Star, ArrowRight, Sparkles, Shield, Zap, BarChart3 } from 'lucide-react'

const FEATURED = [
  { id: 'steampunk-revolution', name: 'Steampunk Revolution', dev: 'IORA', rating: 4.9, color: 'from-amber-500/20 via-amber-600/10 to-amber-700/5', icon: '⚙️', downloads: '12.4k', type: 'theme' },
  { id: 'energy-monitor', name: 'Energy Monitor Pro', dev: 'IORA Labs', rating: 4.8, color: 'from-emerald-500/20 via-green-600/10 to-teal-700/5', icon: '⚡', downloads: '8.7k', type: 'app' },
  { id: 'cyberpunk-neon', name: 'Cyberpunk Neon', dev: 'Community', rating: 4.7, color: 'from-fuchsia-500/20 via-pink-600/10 to-purple-700/5', icon: '🤖', downloads: '6.2k', type: 'theme' },
]

const TOP_THEMES = [
  { id: 'midnight-ocean', name: 'Midnight Ocean', icon: '🌊', rating: 4.8, dev: 'IORA', downloads: '9.1k' },
  { id: 'forest-dawn', name: 'Forest Dawn', icon: '🌲', rating: 4.6, dev: 'Community', downloads: '5.3k' },
  { id: 'glass-morphism', name: 'Glass Morphism', icon: '🪟', rating: 4.5, dev: 'IORA', downloads: '7.8k' },
  { id: 'oled-pitch', name: 'OLED Pitch Black', icon: '🖤', rating: 4.9, dev: 'IORA', downloads: '11.2k' },
  { id: 'sunset-boulevard', name: 'Sunset Boulevard', icon: '🌅', rating: 4.4, dev: 'Community', downloads: '3.6k' },
  { id: 'arctic-frost', name: 'Arctic Frost', icon: '❄️', rating: 4.3, dev: 'IORA Labs', downloads: '2.9k' },
]

const TOP_APPS = [
  { id: 'vacuum-control', name: 'Vacuum Control', icon: '🧹', rating: 4.7, dev: 'Community', downloads: '6.1k' },
  { id: 'camera-ai', name: 'Camera AI Detect', icon: '📹', rating: 4.6, dev: 'IORA Labs', downloads: '4.2k' },
  { id: 'calendar-family', name: 'Family Calendar', icon: '📅', rating: 4.5, dev: 'Community', downloads: '3.8k' },
  { id: 'music-station', name: 'Music Station', icon: '🎵', rating: 4.4, dev: 'IORA', downloads: '5.5k' },
  { id: 'garden-planner', name: 'Garden Planner', icon: '🌱', rating: 4.3, dev: 'Community', downloads: '2.1k' },
  { id: 'notify-pro', name: 'Notify Pro', icon: '🔔', rating: 4.8, dev: 'IORA Labs', downloads: '7.3k' },
]

const STATS = [
  { label: 'Themes', value: '60+', icon: Palette },
  { label: 'Apps & Plugins', value: '180+', icon: Package },
  { label: 'Downloads', value: '150k+', icon: BarChart3 },
]

function StarRating({ rating }: { rating: number }) {
  return (
    <span className="flex items-center gap-0.5">
      <Star size={12} className="text-star" fill="currentColor" />
      <span className="text-xs font-semibold text-fg/70">{rating}</span>
    </span>
  )
}

function AppCard({ item }: { item: typeof TOP_THEMES[0] }) {
  return (
    <Link
      href={`/themes/${item.id}`}
      className="glass-card p-4 flex flex-col items-center text-center group"
    >
      <div className="app-icon bg-muted group-hover:bg-card-hover transition-colors">
        {item.icon}
      </div>
      <h4 className="text-xs font-semibold text-fg mt-2.5 truncate w-full">{item.name}</h4>
      <p className="text-[10px] text-muted-fg mt-0.5">{item.dev}</p>
      <div className="flex items-center gap-2 mt-2">
        <StarRating rating={item.rating} />
        <span className="text-[10px] text-muted-fg/60">{item.downloads}</span>
      </div>
    </Link>
  )
}

export default function HomePage() {
  return (
    <div className="min-h-screen bg-bg">
      <Header />

      {/* ─── Hero Section ──────────────────────────────────── */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-accent/5 via-transparent to-transparent pointer-events-none" />
        <div className="absolute top-20 right-0 w-[600px] h-[600px] rounded-full bg-accent/3 blur-3xl pointer-events-none" />

        <div className="relative max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 pt-16 sm:pt-24 pb-16 text-center">
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 glass rounded-full text-xs font-medium text-accent mb-8">
            <Sparkles size={14} />
            Entdecke den neuen IORA Store
          </div>
          <h1 className="text-3xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight text-fg leading-[1.1]">
            Dein Zuhause.
            <br />
            <span className="text-accent">Dein Style.</span>
          </h1>
          <p className="text-base sm:text-lg text-muted-fg max-w-xl mx-auto mt-6 leading-relaxed">
            Durchstöbere hunderte Themes, Apps & Plugins für dein IORA Smart Home Dashboard
            und mach es zu deinem ganz persönlichen Control Center.
          </p>

          {/* Search Bar */}
          <div className="relative max-w-lg mx-auto mt-8">
            <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-fg" />
            <input
              type="text"
              placeholder="Nach Themes, Apps & Plugins suchen..."
              className="w-full pl-12 pr-5 py-4 glass text-fg placeholder:text-muted-fg/50 text-sm focus:outline-none focus:ring-2 focus:ring-accent/30 transition-all rounded-2xl"
            />
          </div>

          {/* CTA Buttons */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 mt-6">
            <Link href="/themes" className="btn-install flex items-center gap-2 px-6">
              <Palette size={16} /> Themes entdecken
            </Link>
            <Link href="/apps" className="flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-semibold text-fg border border-border hover:bg-muted transition-all">
              <Package size={16} /> Apps durchstöbern
            </Link>
          </div>

          {/* Stats */}
          <div className="flex items-center justify-center gap-12 mt-14 pt-12 border-t border-border">
            {STATS.map(s => (
              <div key={s.label} className="text-center">
                <div className="text-xl sm:text-2xl font-extrabold text-fg">{s.value}</div>
                <div className="text-[11px] text-muted-fg mt-1 flex items-center justify-center gap-1">
                  <s.icon size={12} /> {s.label}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── Featured Banner ───────────────────────────────── */}
      <section className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 pb-8">
        <div className="flex items-center gap-3 mb-5">
          <div className="w-1 h-5 rounded-full bg-accent" />
          <h2 className="text-lg font-bold text-fg">Empfohlen für dich</h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {FEATURED.map(item => (
            <Link
              key={item.id}
              href={`/${item.type === 'theme' ? 'themes' : 'apps'}/${item.id}`}
              className={`featured-card bg-gradient-to-br ${item.color} border border-border/50 group`}
            >
              <div className="text-4xl mb-4">{item.icon}</div>
              <div className="flex items-center gap-2 mb-1">
                <h3 className="font-bold text-fg">{item.name}</h3>
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-accent/10 text-accent font-medium">{item.type === 'theme' ? 'Theme' : 'App'}</span>
              </div>
              <p className="text-xs text-muted-fg">{item.dev}</p>
              <div className="flex items-center gap-3 mt-3">
                <StarRating rating={item.rating} />
                <span className="text-[10px] text-muted-fg/60">{item.downloads} Downloads</span>
              </div>
              <ArrowRight size={16} className="absolute bottom-4 right-4 text-fg/20 group-hover:text-accent group-hover:translate-x-1 transition-all" />
            </Link>
          ))}
        </div>
      </section>

      {/* ─── Top Themes Grid ───────────────────────────────── */}
      <section className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 pb-10">
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-3">
            <div className="w-1 h-5 rounded-full bg-accent" />
            <h2 className="text-lg font-bold text-fg">Top Themes</h2>
          </div>
          <Link href="/themes" className="text-xs font-semibold text-accent hover:text-accent-hover transition-colors flex items-center gap-1">
            Alle anzeigen <ArrowRight size={12} />
          </Link>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
          {TOP_THEMES.map(item => <AppCard key={item.id} item={item} />)}
        </div>
      </section>

      {/* ─── Top Apps Grid ──────────────────────────────────── */}
      <section className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 pb-16">
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-3">
            <div className="w-1 h-5 rounded-full bg-accent" />
            <h2 className="text-lg font-bold text-fg">Top Apps</h2>
          </div>
          <Link href="/apps" className="text-xs font-semibold text-accent hover:text-accent-hover transition-colors flex items-center gap-1">
            Alle anzeigen <ArrowRight size={12} />
          </Link>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
          {TOP_APPS.map(item => <AppCard key={item.id} item={item} />)}
        </div>
      </section>

      {/* ─── Trust Banner ───────────────────────────────────── */}
      <section className="border-t border-border">
        <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 py-10">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
            {[
              { icon: Shield, title: 'Geprüft & Sicher', desc: 'Alle Apps werden vor Veröffentlichung auf Schadcode geprüft.' },
              { icon: Zap, title: 'One-Click Install', desc: 'Mit einem Klick installiert – direkt in dein IORA Dashboard.' },
              { icon: Sparkles, title: 'Immer aktuell', desc: 'Automatische Updates halten deine Apps und Themes frisch.' },
            ].map(item => (
              <div key={item.title} className="glass-card p-5 text-center">
                <item.icon size={24} className="mx-auto mb-3 text-accent" />
                <h3 className="text-sm font-semibold text-fg">{item.title}</h3>
                <p className="text-xs text-muted-fg mt-1">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── Footer ─────────────────────────────────────────── */}
      <footer className="border-t border-border">
        <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 py-8 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2 text-xs text-muted-fg/60">
            <Sparkles size={12} />
            IORA Store — Powered by IORA OS
          </div>
          <nav className="flex items-center gap-6 text-xs text-muted-fg/60">
            <Link href="/themes" className="hover:text-fg transition-colors">Themes</Link>
            <Link href="/apps" className="hover:text-fg transition-colors">Apps</Link>
            <span className="text-muted-fg/30">v1.0</span>
          </nav>
        </div>
      </footer>
    </div>
  )
}
