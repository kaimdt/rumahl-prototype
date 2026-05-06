'use client'

import { Suspense, useState } from 'react'
import Link from 'next/link'
import { Header } from '@/components/Header'
import { Search, Star, ArrowLeft, SlidersHorizontal } from 'lucide-react'

const ALL_THEMES = [
  { id: 'steampunk-revolution', name: 'Steampunk Revolution', icon: '⚙️', dev: 'IORA', rating: 4.9, downloads: '12.4k', category: 'Steampunk', desc: 'Viktorianisches Design mit Messing & Dampf-Effekten' },
  { id: 'midnight-ocean', name: 'Midnight Ocean', icon: '🌊', dev: 'IORA', rating: 4.8, downloads: '9.1k', category: 'Dark', desc: 'Tiefes Blau mit Ozean-Palette' },
  { id: 'cyberpunk-neon', name: 'Cyberpunk Neon', icon: '🤖', dev: 'Community', rating: 4.7, downloads: '6.2k', category: 'Cyberpunk', desc: 'Neon-Farben & futuristisches Design' },
  { id: 'forest-dawn', name: 'Forest Dawn', icon: '🌲', dev: 'Community', rating: 4.6, downloads: '5.3k', category: 'Nature', desc: 'Waldgrüne Töne & natürliches Licht' },
  { id: 'glass-morphism', name: 'Glass Morphism', icon: '🪟', dev: 'IORA', rating: 4.5, downloads: '7.8k', category: 'Glass', desc: 'Maximale Transparenz & Frosted-Effekte' },
  { id: 'oled-pitch', name: 'OLED Pitch Black', icon: '🖤', dev: 'IORA', rating: 4.9, downloads: '11.2k', category: 'OLED', desc: '100% Schwarz – perfekt für OLED-Displays' },
  { id: 'sunset-boulevard', name: 'Sunset Boulevard', icon: '🌅', dev: 'Community', rating: 4.4, downloads: '3.6k', category: 'Light', desc: 'Warme Sonnenuntergang-Farbpalette' },
  { id: 'arctic-frost', name: 'Arctic Frost', icon: '❄️', dev: 'IORA Labs', rating: 4.3, downloads: '2.9k', category: 'Minimal', desc: 'Kühles, klares Minimal-Design' },
  { id: 'neon-tokyo', name: 'Neon Tokyo', icon: '🏙️', dev: 'Community', rating: 4.6, downloads: '4.1k', category: 'Cyberpunk', desc: 'Tokyo bei Nacht – pink & cyan' },
  { id: 'autumn-leaves', name: 'Autumn Leaves', icon: '🍂', dev: 'Community', rating: 4.2, downloads: '1.8k', category: 'Nature', desc: 'Herbstliche Farbpalette & Wärme' },
  { id: 'royal-purple', name: 'Royal Purple', icon: '👑', dev: 'IORA', rating: 4.5, downloads: '3.3k', category: 'Dark', desc: 'Tiefes Violett mit goldenen Akzenten' },
  { id: 'minimal-white', name: 'Minimal White', icon: '⬜', dev: 'IORA', rating: 4.4, downloads: '6.7k', category: 'Light', desc: 'Reduziert auf das Wesentliche' },
]

const CATEGORIES = ['Alle', 'Dark', 'Light', 'Steampunk', 'Cyberpunk', 'Nature', 'Glass', 'OLED', 'Minimal']

function StarRating({ rating }: { rating: number }) {
  return (
    <span className="flex items-center gap-0.5">
      <Star size={11} className="text-star" fill="currentColor" />
      <span className="text-[10px] font-semibold text-fg/60">{rating}</span>
    </span>
  )
}

function ThemesPageContent() {
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('Alle')
  const [sort, setSort] = useState<'rating' | 'downloads' | 'name'>('rating')

  const filtered = ALL_THEMES
    .filter(t => category === 'Alle' || t.category === category)
    .filter(t => !search || t.name.toLowerCase().includes(search.toLowerCase()) || t.desc.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => sort === 'rating' ? b.rating - a.rating : sort === 'downloads' ? parseFloat(b.downloads) - parseFloat(a.downloads) : a.name.localeCompare(b.name))

  return (
    <div className="min-h-screen bg-bg">
      <Header />

      {/* Sub-header */}
      <div className="border-b border-border">
        <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 h-14 flex items-center gap-4">
          <Link href="/" className="p-1.5 rounded-lg hover:bg-muted transition-colors">
            <ArrowLeft size={18} className="text-muted-fg" />
          </Link>
          <h1 className="text-sm font-bold text-fg">Themes</h1>
          <span className="text-xs text-muted-fg">{ALL_THEMES.length} verfügbar</span>
        </div>
      </div>

      <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {/* Search & Sort */}
        <div className="flex flex-col sm:flex-row gap-3 mb-5">
          <div className="relative flex-1">
            <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-fg" />
            <input
              type="text" value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Themes durchsuchen..."
              className="w-full pl-10 pr-4 py-2.5 glass text-sm text-fg placeholder:text-muted-fg/50 focus:outline-none focus:ring-2 focus:ring-accent/20"
            />
          </div>
          <div className="flex items-center gap-1 glass rounded-xl p-1">
            {(['rating', 'downloads', 'name'] as const).map(s => (
              <button key={s} onClick={() => setSort(s)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  sort === s ? 'bg-accent text-white' : 'text-muted-fg hover:text-fg'
                }`}
              >
                {s === 'rating' ? '★ Beste' : s === 'downloads' ? '↓ Meiste' : 'A-Z'}
              </button>
            ))}
          </div>
        </div>

        {/* Category Pills */}
        <div className="cat-nav mb-6">
          {CATEGORIES.map(cat => (
            <button key={cat} onClick={() => setCategory(cat)}
              className={category === cat ? 'pill-active' : 'pill'}
            >
              {cat}
            </button>
          ))}
        </div>

        {/* Theme Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
          {filtered.map(theme => (
            <Link
              key={theme.id}
              href={`/themes/${theme.id}`}
              className="glass-card p-4 flex flex-col items-center text-center group"
            >
              <div className="app-icon bg-muted group-hover:bg-card-hover transition-colors">
                {theme.icon}
              </div>
              <h3 className="text-xs font-semibold text-fg mt-2.5 truncate w-full">{theme.name}</h3>
              <p className="text-[10px] text-muted-fg mt-0.5">{theme.dev}</p>
              <p className="text-[10px] text-muted-fg/60 mt-1 line-clamp-1">{theme.desc}</p>
              <div className="flex items-center gap-2 mt-2">
                <StarRating rating={theme.rating} />
                <span className="text-[9px] text-muted-fg/40">{theme.downloads}</span>
              </div>
              <span className="text-[9px] px-2 py-0.5 rounded-full bg-muted text-muted-fg mt-2">{theme.category}</span>
            </Link>
          ))}
        </div>

        {filtered.length === 0 && (
          <div className="text-center py-20">
            <Search size={40} className="mx-auto text-muted-fg/20 mb-3" />
            <p className="text-sm text-muted-fg">Keine Themes gefunden</p>
            <p className="text-xs text-muted-fg/50 mt-1">Versuche andere Suchbegriffe</p>
          </div>
        )}
      </div>
    </div>
  )
}

export default function ThemesPage() {
  return <Suspense fallback={<div className="min-h-screen bg-bg" />}><ThemesPageContent /></Suspense>
}
