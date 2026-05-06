'use client'

import { Suspense, useState } from 'react'
import Link from 'next/link'
import { Header } from '@/components/Header'
import { Search, Star, ArrowLeft, Shield, ShieldCheck } from 'lucide-react'

const ALL_APPS = [
  { id: 'energy-monitor', name: 'Energy Monitor Pro', icon: '⚡', dev: 'IORA Labs', rating: 4.8, downloads: '8.7k', category: 'Energy', desc: 'Echtzeit-Energieverbrauch mit Vorhersagen', verified: true },
  { id: 'vacuum-control', name: 'Vacuum Control', icon: '🧹', dev: 'Community', rating: 4.7, downloads: '6.1k', category: 'Widgets', desc: 'Staubsauger-Roboter mit Kartenansicht', verified: true },
  { id: 'camera-ai', name: 'Camera AI Detect', icon: '📹', dev: 'IORA Labs', rating: 4.6, downloads: '4.2k', category: 'Security', desc: 'KI-Objekterkennung für Kameras', verified: true },
  { id: 'calendar-family', name: 'Family Calendar', icon: '📅', dev: 'Community', rating: 4.5, downloads: '3.8k', category: 'Productivity', desc: 'Gemeinsamer Familienkalender' },
  { id: 'music-station', name: 'Music Station', icon: '🎵', dev: 'IORA', rating: 4.4, downloads: '5.5k', category: 'Media', desc: 'Multiroom-Audio-Steuerung' },
  { id: 'garden-planner', name: 'Garden Planner', icon: '🌱', dev: 'Community', rating: 4.3, downloads: '2.1k', category: 'Productivity', desc: 'Bewässerungsplan & Pflanzen-Tracker' },
  { id: 'notify-pro', name: 'Notify Pro', icon: '🔔', dev: 'IORA Labs', rating: 4.8, downloads: '7.3k', category: 'Automation', desc: 'Intelligente Benachrichtigungen', verified: true },
  { id: 'weather-plus', name: 'Weather Plus', icon: '🌤️', dev: 'IORA', rating: 4.5, downloads: '9.2k', category: 'Weather', desc: 'Detaillierte Wettervorhersage' },
  { id: 'scene-master', name: 'Scene Master', icon: '🎬', dev: 'IORA', rating: 4.3, downloads: '4.0k', category: 'Automation', desc: 'Komplexe Szenen & Automationen' },
  { id: 'garage-door', name: 'Garage Control', icon: '🚗', dev: 'Community', rating: 4.2, downloads: '1.5k', category: 'Widgets', desc: 'Garagentor-Steuerung mit Status' },
]

const CATEGORIES = ['Alle', 'Widgets', 'Automation', 'Media', 'Security', 'Energy', 'Weather', 'Productivity']

function StarRating({ rating }: { rating: number }) {
  return (
    <span className="flex items-center gap-0.5">
      <Star size={11} className="text-star" fill="currentColor" />
      <span className="text-[10px] font-semibold text-fg/60">{rating}</span>
    </span>
  )
}

function AppsPageContent() {
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('Alle')
  const [sort, setSort] = useState<'rating' | 'downloads'>('rating')

  const filtered = ALL_APPS
    .filter(a => category === 'Alle' || a.category === category)
    .filter(a => !search || a.name.toLowerCase().includes(search.toLowerCase()) || a.desc.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => sort === 'rating' ? b.rating - a.rating : parseFloat(b.downloads) - parseFloat(a.downloads))

  return (
    <div className="min-h-screen bg-bg">
      <Header />
      <div className="border-b border-border">
        <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 h-14 flex items-center gap-4">
          <Link href="/" className="p-1.5 rounded-lg hover:bg-muted transition-colors"><ArrowLeft size={18} className="text-muted-fg" /></Link>
          <h1 className="text-sm font-bold text-fg">Apps</h1>
          <span className="text-xs text-muted-fg">{ALL_APPS.length} verfügbar</span>
        </div>
      </div>

      <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <div className="flex flex-col sm:flex-row gap-3 mb-5">
          <div className="relative flex-1">
            <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-fg" />
            <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Apps durchsuchen..." className="w-full pl-10 pr-4 py-2.5 glass text-sm text-fg placeholder:text-muted-fg/50 focus:outline-none focus:ring-2 focus:ring-accent/20" />
          </div>
          <div className="flex items-center gap-1 glass rounded-xl p-1">
            {(['rating', 'downloads'] as const).map(s => (
              <button key={s} onClick={() => setSort(s)} className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${sort === s ? 'bg-accent text-white' : 'text-muted-fg hover:text-fg'}`}>
                {s === 'rating' ? '★ Beste' : '↓ Meiste'}
              </button>
            ))}
          </div>
        </div>

        <div className="cat-nav mb-6">
          {CATEGORIES.map(cat => (
            <button key={cat} onClick={() => setCategory(cat)} className={category === cat ? 'pill-active' : 'pill'}>{cat}</button>
          ))}
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
          {filtered.map(app => (
            <Link key={app.id} href={`/apps/${app.id}`} className="glass-card p-4 flex flex-col items-center text-center group">
              <div className="app-icon bg-muted group-hover:bg-card-hover transition-colors">{app.icon}</div>
              <div className="flex items-center gap-1.5 mt-2.5">
                <h3 className="text-xs font-semibold text-fg truncate">{app.name}</h3>
                {app.verified && <ShieldCheck size={12} className="text-success shrink-0" />}
              </div>
              <p className="text-[10px] text-muted-fg mt-0.5">{app.dev}</p>
              <p className="text-[10px] text-muted-fg/60 mt-1 line-clamp-1">{app.desc}</p>
              <div className="flex items-center gap-2 mt-2">
                <StarRating rating={app.rating} />
                <span className="text-[9px] text-muted-fg/40">{app.downloads}</span>
              </div>
            </Link>
          ))}
        </div>

        {filtered.length === 0 && (
          <div className="text-center py-20">
            <Search size={40} className="mx-auto text-muted-fg/20 mb-3" />
            <p className="text-sm text-muted-fg">Keine Apps gefunden</p>
          </div>
        )}
      </div>
    </div>
  )
}

export default function AppsPage() {
  return <Suspense fallback={<div className="min-h-screen bg-bg" />}><AppsPageContent /></Suspense>
}
