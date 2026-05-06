'use client'

import Link from 'next/link'
import { Header } from '@/components/Header'
import { ArrowLeft, Star, Download, Calendar, Tag, Palette, Sparkles } from 'lucide-react'

export default function ThemeDetailPage({ params }: { params: { id: string } }) {
  const theme = {
    id: params.id,
    name: params.id === 'steampunk-revolution' ? 'Steampunk Revolution' : params.id.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
    icon: params.id === 'steampunk-revolution' ? '⚙️' : '🎨',
    dev: 'IORA',
    version: '1.0.0',
    rating: 4.9,
    ratingCount: 234,
    downloads: '12.4k',
    category: 'Steampunk',
    updated: '2026-05-01',
    description: 'Vollständiges Steampunk-Design mit viktorianischer Ästhetik. Enthält Messing-Rahmen, Zahnrad-Animationen, Dampf-Partikel und eine linksseitige Navigation im Brass-Control-Panel-Stil.\n\nFeatures:\n• Brass & Copper Borders auf allen Karten\n• Rotierende Zahnrad-Dekorationen\n• Animierte Dampf-Partikel\n• Viktorianische Typografie (IM Fell English + Cinzel Decorative)\n• Custom Widget-Templates für Light, Switch & Climate\n• Gaslight-Flackern Ambient-Effekt\n• Dark Mode mit 3 Design-Varianten',
    screenshots: ['/placeholder.svg'],
  }

  return (
    <div className="min-h-screen bg-bg">
      <Header />
      <div className="border-b border-border">
        <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 h-14 flex items-center gap-4">
          <Link href="/themes" className="p-1.5 rounded-lg hover:bg-muted transition-colors"><ArrowLeft size={18} className="text-muted-fg" /></Link>
          <span className="text-xs text-muted-fg">Zurück zu Themes</span>
        </div>
      </div>

      <div className="max-w-[1200px] mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Main */}
          <div className="lg:col-span-2 space-y-6">
            {/* Hero */}
            <div className="glass-card p-8 flex items-start gap-5">
              <div className="app-icon w-20 h-20 text-4xl bg-muted">{theme.icon}</div>
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <h1 className="text-2xl font-extrabold text-fg">{theme.name}</h1>
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-accent/10 text-accent font-medium">{theme.category}</span>
                </div>
                <p className="text-sm text-muted-fg">{theme.dev} · v{theme.version}</p>
                <div className="flex items-center gap-4 mt-3">
                  <div className="flex items-center gap-1">
                    <Star size={14} className="text-star" fill="currentColor" />
                    <span className="text-sm font-bold text-fg">{theme.rating}</span>
                    <span className="text-xs text-muted-fg">({theme.ratingCount})</span>
                  </div>
                  <span className="text-xs text-muted-fg flex items-center gap-1"><Download size={12} /> {theme.downloads}</span>
                </div>
                <Link href={`/api/proxy/themes/${theme.id}/download`}
                  className="btn-install inline-flex items-center gap-2 mt-4">
                  <Download size={14} /> Installieren
                </Link>
              </div>
            </div>

            {/* Description */}
            <div className="glass-card p-6">
              <h2 className="text-sm font-bold text-fg mb-3">Beschreibung</h2>
              <p className="text-sm text-muted-fg leading-relaxed whitespace-pre-wrap">{theme.description}</p>
            </div>

            {/* Screenshots */}
            <div className="glass-card p-6">
              <h2 className="text-sm font-bold text-fg mb-3">Vorschau</h2>
              <div className="aspect-video rounded-xl bg-muted flex items-center justify-center text-6xl">{theme.icon}</div>
            </div>
          </div>

          {/* Sidebar */}
          <div className="space-y-4">
            <div className="glass-card p-5 space-y-3">
              <h3 className="text-xs font-bold text-fg uppercase tracking-wider">Details</h3>
              <div className="space-y-2.5 text-xs">
                <div className="flex items-center gap-2 text-muted-fg"><Calendar size={12} /> Aktualisiert: <span className="text-fg ml-auto">{theme.updated}</span></div>
                <div className="flex items-center gap-2 text-muted-fg"><Tag size={12} /> Kategorie: <span className="text-fg ml-auto">{theme.category}</span></div>
                <div className="flex items-center gap-2 text-muted-fg"><Download size={12} /> Downloads: <span className="text-fg ml-auto">{theme.downloads}</span></div>
              </div>
            </div>

            <div className="glass-card p-5 text-center">
              <div className="text-3xl font-extrabold text-fg">{theme.rating}</div>
              <div className="flex items-center justify-center gap-0.5 mt-1">
                {[1,2,3,4,5].map(i => <Star key={i} size={14} className={i <= Math.round(theme.rating) ? 'text-star' : 'text-muted-fg/20'} fill={i <= Math.round(theme.rating) ? 'currentColor' : 'none'} />)}
              </div>
              <p className="text-[10px] text-muted-fg mt-1">{theme.ratingCount} Bewertungen</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
