import { useState, useCallback, useMemo } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import {
  ShareNetwork, Copy, PaperPlaneTilt,
  Globe, CloudArrowUp,
  Shield, Info, Clock, Users
} from '@phosphor-icons/react'
import { toast } from 'sonner'
import { Tip } from '@/components/ui/tip'
import { NativeShare } from '@/components/NativeShare'

type ShareTab = 'local' | 'remote'

function createShareToken() {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2, 10)
}

export function SharePage() {
  const [activeTab, setActiveTab] = useState<ShareTab>('local')
  const [shareToken] = useState(createShareToken)
  const [cloudEnabled, setCloudEnabled] = useState(false)

  const shareUrl = useMemo(
    () => `${window.location.origin}/share/${shareToken}`,
    [shareToken],
  )

  const copyShareLink = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(shareUrl)
      toast.success('Link in Zwischenablage kopiert')
    } catch {
      toast.error('Kopieren fehlgeschlagen')
    }
  }, [shareUrl])

  const browserShare = useCallback(async () => {
    if (navigator.share) {
      try {
        await navigator.share({ title: 'ORA Share', text: 'Dateien & Links teilen', url: shareUrl })
        toast.success('Geteilt!')
      } catch { /* user cancelled */ }
    } else {
      await copyShareLink()
    }
  }, [copyShareLink, shareUrl])

  return (
    <div className="space-y-4 page-transition-enter max-w-4xl mx-auto">
      {/* ── Header ────────────────────────────────────────────────── */}
      <div className="glass-card rounded-2xl border border-foreground/[0.06] p-5 sm:p-6">
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 rounded-2xl bg-accent/10 ring-1 ring-accent/10 flex items-center justify-center flex-shrink-0">
            <ShareNetwork size={26} weight="duotone" className="text-accent" />
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-xl font-bold text-foreground">ORA Share</h1>
            <p className="text-sm text-foreground/50 mt-1">
              Dateien & Links zwischen Geräten teilen — direkt im lokalen Netzwerk oder weltweit über Cloud Connect
            </p>
          </div>
        </div>
      </div>

      {/* ── Tab Switcher ──────────────────────────────────────────── */}
      <div className="flex gap-1 p-1 rounded-xl bg-foreground/[0.04] border border-foreground/[0.06]">
        <button
          onClick={() => setActiveTab('local')}
          className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-lg text-sm font-semibold transition-all ${
            activeTab === 'local' ? 'bg-accent/10 text-accent shadow-sm' : 'text-foreground/40 hover:text-foreground/60'
          }`}
        >
          <ShareNetwork size={18} weight={activeTab === 'local' ? 'fill' : 'regular'} />
          Lokales Netzwerk
        </button>
        <button
          onClick={() => setActiveTab('remote')}
          className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-lg text-sm font-semibold transition-all ${
            activeTab === 'remote' ? 'bg-accent/10 text-accent shadow-sm' : 'text-foreground/40 hover:text-foreground/60'
          }`}
        >
          <CloudArrowUp size={18} weight={activeTab === 'remote' ? 'fill' : 'regular'} />
          Cloud Connect
        </button>
      </div>

      {/* ── LOCAL: Native Share ───────────────────────────────────── */}
      <AnimatePresence mode="wait">
        {activeTab === 'local' && (
          <motion.div key="local" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}>
            <div className="glass-card rounded-2xl border border-foreground/[0.06] p-5">
              <div className="flex items-start gap-4 mb-4">
                <div className="w-10 h-10 rounded-xl bg-accent/10 ring-1 ring-accent/10 flex items-center justify-center flex-shrink-0">
                  <ShareNetwork size={22} weight="duotone" className="text-accent" />
                </div>
                <div>
                  <h2 className="text-sm font-semibold text-foreground">Lokales Netzwerk</h2>
                  <p className="text-xs text-foreground/50 mt-1">
                    Dateien und Text direkt zwischen Geräten im selben Netzwerk austauschen
                  </p>
                </div>
              </div>
              <NativeShare />
            </div>
          </motion.div>
        )}

        {/* ── REMOTE: Cloud Connect ────────────────────────────────── */}
        {activeTab === 'remote' && (
          <motion.div key="remote" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} className="space-y-4">
            <div className="glass-card rounded-2xl border border-foreground/[0.06] p-5">
              <div className="flex items-start gap-4 mb-4">
                <div className="w-10 h-10 rounded-xl bg-accent/10 ring-1 ring-accent/10 flex items-center justify-center flex-shrink-0">
                  <CloudArrowUp size={22} weight="duotone" className="text-accent" />
                </div>
                <div>
                  <h2 className="text-sm font-semibold text-foreground">Cloud Connect</h2>
                  <p className="text-xs text-foreground/50 mt-1">
                    Dein IORA Home weltweit erreichbar machen — sicher über den Cloud Connect Proxy
                  </p>
                </div>
              </div>

              {/* Status */}
              <div className={`flex items-center gap-3 p-4 rounded-xl border mb-4 ${
                cloudEnabled ? 'bg-emerald-500/[0.04] border-emerald-500/15' : 'bg-foreground/[0.03] border-foreground/[0.08]'
              }`}>
                <div className={`w-2.5 h-2.5 rounded-full ${cloudEnabled ? 'bg-emerald-400' : 'bg-foreground/30'}`} />
                <div className="flex-1">
                  <p className="text-xs font-medium text-foreground/80">{cloudEnabled ? 'Verbunden' : 'Nicht verbunden'}</p>
                  <p className="text-[10px] text-foreground/40">{cloudEnabled ? 'Weltweit erreichbar' : 'Nur lokal erreichbar'}</p>
                </div>
                <button
                  onClick={() => setCloudEnabled(!cloudEnabled)}
                  className={`px-4 py-2 rounded-xl text-xs font-semibold transition-all ${
                    cloudEnabled ? 'bg-foreground/[0.06] text-foreground/60 border border-foreground/[0.1]' : 'bg-accent text-white hover:bg-accent/90'
                  }`}
                >
                  {cloudEnabled ? 'Trennen' : 'Verbinden'}
                </button>
              </div>

              {/* Share Link */}
              <div className="mb-4">
                <p className="text-[10px] font-semibold text-foreground/40 uppercase tracking-wider mb-2">Dein Share-Link</p>
                <div className="flex items-center gap-2 p-3 rounded-xl bg-foreground/[0.03] border border-foreground/[0.08]">
                  <Globe size={16} className="text-foreground/30 flex-shrink-0" />
                  <code className="flex-1 text-sm font-mono text-foreground/60 break-all select-all">
                    {cloudEnabled ? shareUrl : 'Nur mit Cloud Connect verfügbar'}
                  </code>
                  {cloudEnabled && (
                    <Tip content="Link kopieren">
                      <button onClick={copyShareLink} className="p-2 rounded-lg hover:bg-foreground/[0.06]">
                        <Copy size={14} className="text-foreground/40" />
                      </button>
                    </Tip>
                  )}
                </div>
                {cloudEnabled && (
                  <button onClick={browserShare} className="mt-2 w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-foreground/[0.04] border border-foreground/[0.08] text-xs font-medium text-foreground/60 hover:text-foreground transition-all">
                    <PaperPlaneTilt size={14} /> Per System teilen
                  </button>
                )}
              </div>

              {/* Info Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {[
                  { icon: Shield, color: 'text-emerald-400', title: 'Ende-zu-Ende verschlüsselt', desc: 'Alle Daten werden vor dem Verlassen deines Netzwerks verschlüsselt.' },
                  { icon: Users, color: 'text-accent', title: 'Benutzer-basiert', desc: 'Nur autorisierte Benutzer mit gültigem Token können auf deine Shares zugreifen.' },
                  { icon: Clock, color: 'text-amber-400', title: 'Ablaufende Links', desc: 'Share-Links haben eine begrenzte Gültigkeit für mehr Sicherheit.' },
                  { icon: Info, color: 'text-foreground/40', title: 'Admin-Kontrolle', desc: 'Administratoren können Cloud Connect im Control Center verwalten.' },
                ].map((card, i) => (
                  <div key={i} className="p-4 rounded-xl bg-foreground/[0.02] border border-foreground/[0.06]">
                    <div className="flex items-center gap-2 mb-2">
                      <card.icon size={16} weight="fill" className={card.color} />
                      <h4 className="text-xs font-semibold text-foreground/70">{card.title}</h4>
                    </div>
                    <p className="text-[10px] text-foreground/40 leading-relaxed">{card.desc}</p>
                  </div>
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
