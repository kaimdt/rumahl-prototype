import { useState, useMemo, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import {
  BookOpen, CaretRight, CaretDown, MagnifyingGlass,
  List, X, ArrowLeft, FileText, Info, House,
  Rocket, PuzzlePiece, ShieldCheck, Wrench,
  Code, Gear, Terminal, Lock, Cloud, Book,
  Users, ChartLine, Database, Globe, Lightning,
  ChatText, Robot, Key, Package, Brain,
} from '@phosphor-icons/react'
import { marked } from 'marked'
import DOMPurify from 'dompurify'

// ─── Types ────────────────────────────────────────────────────────────────
interface DocsConfig {
  title: string
  description: string
  navigation: DocsSection[]
}
interface DocsSection {
  section: string
  icon: string
  items: DocsItem[]
}
interface DocsItem {
  title: string
  path: string
  highlight?: boolean
}

// ─── Icon map ─────────────────────────────────────────────────────────────
const sectionIcons: Record<string, typeof BookOpen> = {
  // PascalCase variants
  'BookOpen': BookOpen, 'Info': Info, 'House': House,
  'Rocket': Rocket, 'PuzzlePiece': PuzzlePiece,
  'ShieldCheck': ShieldCheck, 'Wrench': Wrench,
  'Code': Code, 'Gear': Gear, 'Terminal': Terminal,
  'Lock': Lock, 'Cloud': Cloud, 'Book': Book,
  'Users': Users, 'ChartLine': ChartLine, 'Database': Database,
  'Globe': Globe, 'Lightning': Lightning, 'ChatText': ChatText,
  'Robot': Robot, 'Key': Key, 'Package': Package, 'Brain': Brain,
  // lowercase variants (from docs-config.json)
  'rocket': Rocket, 'code': Code, 'book': Book,
  'gear': Gear, 'terminal': Terminal, 'lock': Lock,
  'cloud': Cloud, 'users': Users, 'chart': ChartLine,
  'database': Database, 'globe': Globe, 'shield': ShieldCheck,
  'wrench': Wrench, 'puzzle': PuzzlePiece, 'house': House,
  'info': Info, 'robot': Robot, 'key': Key,
  'package': Package, 'brain': Brain, 'lightning': Lightning,
  'chat': ChatText, 'book-open': BookOpen,
}

// Default icon if not found
const DEFAULT_ICON = BookOpen

// ─── Configure marked ─────────────────────────────────────────────────────
marked.setOptions({ breaks: true, gfm: true })

// ─── Component ────────────────────────────────────────────────────────────
export function DocsPage() {
  const [config, setConfig] = useState<DocsConfig | null>(null)
  const [currentPath, setCurrentPath] = useState<string | null>(null)
  const [currentContent, setCurrentContent] = useState('')
  const [currentTitle, setCurrentTitle] = useState('')
  const [loading, setLoading] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set())

  // Load config on mount
  useEffect(() => {
    loadConfig()
    // Check URL for doc path
    const path = window.location.pathname
    if (path.startsWith('/docs/')) {
      const docPath = path.slice(6)
      if (docPath) loadDocument(docPath)
    }
  }, [])

  const loadConfig = async () => {
    try {
      const res = await fetch('/api/documentation/config')
      if (res.ok) {
        const data = await res.json()
        setConfig(data)
        // Auto-expand first section, or show hint if empty
        if (data.navigation?.length > 0) {
          setExpandedSections(new Set([data.navigation[0].section]))
        } else {
          setConfig({
            title: 'IORA OS Dokumentation',
            description: 'Keine Dokumentationsdateien gefunden',
            navigation: [{
              section: 'Hinweis',
              icon: 'Info',
              items: [{ title: 'Platziere .md-Dateien im docs/-Ordner oder starte den Backend-Dienst neu', path: '__empty__', highlight: true }],
            }],
          })
        }
        return
      }
    } catch { /* offline — fallback below */ }
    setConfig({
      title: 'IORA OS Dokumentation',
      description: 'Eingebettete Dokumentation',
      navigation: [{
        section: 'Hinweis',
        icon: 'Info',
        items: [{ title: 'Dokumentation derzeit nicht erreichbar', path: '__offline__', highlight: true }],
      }],
    })
  }

  const loadDocument = async (path: string) => {
    if (path === '__offline__') {
      setCurrentPath(path)
      setCurrentTitle('Offline')
      setCurrentContent('Die Dokumentation ist derzeit nicht erreichbar. Stelle sicher, dass der IORA-Backend-Dienst läuft.')
      return
    }
    setLoading(true)
    setCurrentPath(path)
    try {
      const res = await fetch(`/api/documentation/${path}`)
      if (res.ok) {
        const data = await res.json()
        setCurrentTitle(data.title || path)
        setCurrentContent(data.content || '')
        window.history.pushState({}, '', `/docs/${path}`)
      }
    } catch {
      setCurrentTitle('Fehler')
      setCurrentContent('Dokument konnte nicht geladen werden.')
    } finally {
      setLoading(false)
    }
  }

  // Search filtering
  const filteredSections = useMemo(() => {
    if (!config || !searchQuery.trim()) return config?.navigation || []
    const q = searchQuery.toLowerCase()
    return config.navigation
      .map(s => ({ ...s, items: s.items.filter(i => i.title.toLowerCase().includes(q) || i.path.toLowerCase().includes(q)) }))
      .filter(s => s.items.length > 0)
  }, [config, searchQuery])

  const toggleSection = (section: string) => {
    setExpandedSections(prev => {
      const next = new Set(prev)
      if (next.has(section)) next.delete(section)
      else next.add(section)
      return next
    })
  }

  const renderMarkdown = (content: string) => {
    const html = DOMPurify.sanitize(String(marked(content)), {
      // Allow common markdown output incl. tables, code blocks and images.
      // Block scripts, event handlers and inline javascript: URLs.
      ADD_ATTR: ['target'],
      FORBID_TAGS: ['style', 'script', 'iframe', 'object', 'embed'],
      FORBID_ATTR: ['onerror', 'onload', 'onclick'],
    })
    return (
      <div
        className="prose prose-sm max-w-none
          prose-headings:text-foreground prose-headings:scroll-mt-20
          prose-h1:text-2xl prose-h1:font-bold prose-h1:mb-4 prose-h1:mt-6 prose-h1:pb-2 prose-h1:border-b prose-h1:border-foreground/[0.06]
          prose-h2:text-xl prose-h2:font-semibold prose-h2:mb-3 prose-h2:mt-6
          prose-h3:text-lg prose-h3:font-medium prose-h3:mb-2 prose-h3:mt-4
          prose-p:text-foreground/70 prose-p:leading-relaxed prose-p:my-3
          prose-a:text-accent prose-a:no-underline hover:prose-a:underline
          prose-strong:text-foreground prose-strong:font-semibold
          prose-code:text-accent prose-code:bg-foreground/[0.04] prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded-md prose-code:text-xs prose-code:font-mono prose-code:before:content-none prose-code:after:content-none
          prose-pre:bg-foreground/[0.03] prose-pre:border prose-pre:border-foreground/[0.06] prose-pre:rounded-xl prose-pre:p-4 prose-pre:overflow-x-auto
          prose-ul:text-foreground/70 prose-ul:my-3 prose-ul:list-disc prose-ul:pl-5
          prose-ol:text-foreground/70 prose-ol:my-3 prose-ol:list-decimal prose-ol:pl-5
          prose-li:text-foreground/70 prose-li:my-1
          prose-table:text-foreground/70 prose-table:w-full prose-table:border prose-table:border-foreground/[0.08] prose-table:rounded-lg prose-table:overflow-hidden
          prose-th:bg-foreground/[0.03] prose-th:text-foreground/50 prose-th:font-medium prose-th:text-[10px] prose-th:uppercase prose-th:tracking-wider prose-th:px-3 prose-th:py-2
          prose-td:border-t prose-td:border-foreground/[0.04] prose-td:px-3 prose-td:py-2 prose-td:text-xs
          prose-blockquote:border-l-[3px] prose-blockquote:border-accent/30 prose-blockquote:pl-4 prose-blockquote:italic prose-blockquote:text-foreground/50 prose-blockquote:my-4
          prose-img:rounded-xl prose-img:border prose-img:border-foreground/[0.06] prose-img:my-4
          prose-hr:border-foreground/[0.06] prose-hr:my-6"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    )
  }

  // ── Loading state ──────────────────────────────────────────────────
  if (!config) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-center space-y-3">
          <div className="w-10 h-10 border-[3px] border-accent/20 border-t-accent rounded-full animate-spin mx-auto" />
          <p className="text-sm text-foreground/40">Dokumentation wird geladen…</p>
        </div>
      </div>
    )
  }

  const currentItem = config.navigation
    .flatMap(s => s.items)
    .find(i => i.path === currentPath)

  return (
    <div className="flex gap-0 h-[calc(100vh-12rem)] page-transition-enter">
      {/* ── Desktop Sidebar ────────────────────────────────────────── */}
      <aside className={`hidden lg:flex flex-col w-72 flex-shrink-0 mr-4`}>
        <div className="glass-card rounded-2xl border border-foreground/[0.06] p-4 flex flex-col h-full overflow-hidden">
          <div className="flex items-center gap-2 mb-4 flex-shrink-0">
            <BookOpen size={20} weight="duotone" className="text-accent" />
            <h2 className="text-sm font-semibold text-foreground">{config.title}</h2>
          </div>
          <SidebarContent
            config={config}
            searchQuery={searchQuery}
            setSearchQuery={setSearchQuery}
            filteredSections={filteredSections}
            expandedSections={expandedSections}
            toggleSection={toggleSection}
            currentPath={currentPath}
            loadDocument={loadDocument}
          />
        </div>
      </aside>

      {/* ── Mobile Sidebar Toggle ──────────────────────────────────── */}
      <div className="lg:hidden fixed bottom-20 right-4 z-40">
        <button
          onClick={() => setSidebarOpen(true)}
          className="w-12 h-12 rounded-2xl bg-accent text-white shadow-lg shadow-accent/20 flex items-center justify-center active:scale-95 transition-transform"
        >
          <List size={22} />
        </button>
      </div>

      {/* ── Mobile Sidebar Drawer ──────────────────────────────────── */}
      <AnimatePresence>
        {sidebarOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="lg:hidden fixed inset-0 bg-black/60 backdrop-blur-sm z-50"
              onClick={() => setSidebarOpen(false)}
            />
            <motion.div
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={{ type: 'spring', damping: 28, stiffness: 300 }}
              className="lg:hidden fixed inset-y-0 left-0 z-50 w-[85vw] max-w-sm glass-card rounded-r-2xl border-r border-foreground/[0.06] p-4 flex flex-col"
            >
              <div className="flex items-center justify-between mb-4 flex-shrink-0">
                <div className="flex items-center gap-2">
                  <BookOpen size={20} weight="duotone" className="text-accent" />
                  <h2 className="text-sm font-semibold text-foreground">{config.title}</h2>
                </div>
                <button onClick={() => setSidebarOpen(false)} className="p-2 rounded-xl hover:bg-foreground/[0.05]">
                  <X size={18} className="text-foreground/50" />
                </button>
              </div>
              <SidebarContent
                config={config}
                searchQuery={searchQuery}
                setSearchQuery={setSearchQuery}
                filteredSections={filteredSections}
                expandedSections={expandedSections}
                toggleSection={toggleSection}
                currentPath={currentPath}
                loadDocument={(path) => { loadDocument(path); setSidebarOpen(false) }}
              />
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* ── Main Content ───────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto min-w-0">
        <div className="glass-card rounded-2xl border border-foreground/[0.06] p-5 sm:p-6 min-h-full">
          {!currentPath ? (
            /* Empty state */
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="w-20 h-20 rounded-3xl bg-accent/[0.06] ring-1 ring-accent/[0.08] flex items-center justify-center mb-6">
                <BookOpen size={40} weight="duotone" className="text-accent/40" />
              </div>
              <h2 className="text-lg font-semibold text-foreground mb-2">IORA Dokumentation</h2>
              <p className="text-sm text-foreground/40 max-w-sm leading-relaxed">
                Wähle ein Thema aus der Seitenleiste oder nutze die Suche, um die Dokumentation zu durchsuchen.
              </p>
              <div className="flex gap-3 mt-6">
                {config.navigation.slice(0, 3).map(section => (
                  <button
                    key={section.section}
                    onClick={() => {
                      if (section.items[0]) loadDocument(section.items[0].path)
                    }}
                    className="px-4 py-2.5 rounded-xl bg-foreground/[0.03] border border-foreground/[0.06] text-xs font-medium text-foreground/60 hover:text-foreground hover:bg-foreground/[0.05] transition-all"
                  >
                    {section.section}
                  </button>
                ))}
              </div>
            </div>
          ) : loading ? (
            /* Loading */
            <div className="flex items-center justify-center py-20">
              <div className="text-center space-y-3">
                <div className="w-8 h-8 border-[3px] border-accent/20 border-t-accent rounded-full animate-spin mx-auto" />
                <p className="text-xs text-foreground/40">Dokument wird geladen…</p>
              </div>
            </div>
          ) : (
            /* Document */
            <div>
              {/* Breadcrumb */}
              <div className="flex items-center gap-2 text-xs text-foreground/40 mb-6">
                <button onClick={() => { setCurrentPath(null); window.history.pushState({}, '', '/docs') }} className="hover:text-foreground/60 transition-colors">
                  {config.title}
                </button>
                <CaretRight size={12} />
                <span className="text-foreground/60 font-medium">{currentTitle}</span>
              </div>

              <h1 className="text-2xl font-bold text-foreground mb-1">{currentTitle}</h1>
              {currentItem?.highlight && (
                <span className="inline-block text-[10px] px-2 py-0.5 rounded-md bg-accent/10 text-accent font-medium mb-4">Empfohlen</span>
              )}

              <div className="mt-6 rounded-xl bg-foreground/[0.015] border border-foreground/[0.04] p-5 sm:p-6">
                {renderMarkdown(currentContent)}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Sidebar Content (shared between desktop + mobile) ──────────────────
function SidebarContent({
  config, searchQuery, setSearchQuery, filteredSections,
  expandedSections, toggleSection, currentPath, loadDocument,
}: {
  config: DocsConfig
  searchQuery: string
  setSearchQuery: (q: string) => void
  filteredSections: DocsSection[]
  expandedSections: Set<string>
  toggleSection: (s: string) => void
  currentPath: string | null
  loadDocument: (path: string) => void
}) {
  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Search */}
      <div className="relative mb-3 flex-shrink-0">
        <MagnifyingGlass size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-foreground/30" />
        <input
          type="text"
          placeholder="Suchen…"
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          className="w-full pl-9 pr-8 py-2.5 text-xs rounded-xl bg-foreground/[0.04] border border-foreground/[0.06] focus:border-accent/30 focus:outline-none transition-colors text-foreground placeholder:text-foreground/30"
        />
        {searchQuery && (
          <button onClick={() => setSearchQuery('')} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-md hover:bg-foreground/[0.06]">
            <X size={12} className="text-foreground/30" />
          </button>
        )}
      </div>

      {/* Sections */}
      <div className="overflow-y-auto flex-1 space-y-1">
        {filteredSections.length === 0 && searchQuery && (
          <p className="text-xs text-foreground/30 text-center py-8">Keine Ergebnisse für "{searchQuery}"</p>
        )}
        {filteredSections.map(section => {
          const Icon = sectionIcons[section.icon] || BookOpen
          const isExpanded = expandedSections.has(section.section) || !!searchQuery
          const isActive = section.items.some(i => i.path === currentPath)
          return (
            <div key={section.section}>
              <button
                onClick={() => toggleSection(section.section)}
                className={`w-full flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-medium transition-all ${
                  isActive ? 'text-accent' : 'text-foreground/50 hover:text-foreground/70'
                }`}
              >
                <Icon size={14} weight={isActive ? 'fill' : 'regular'} />
                <span className="flex-1 text-left">{section.section}</span>
                <span className="text-[9px] text-foreground/20">{section.items.length}</span>
                <CaretDown size={10} className={`text-foreground/30 transition-transform ${isExpanded ? 'rotate-0' : '-rotate-90'}`} />
              </button>
              <AnimatePresence initial={false}>
                {isExpanded && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="overflow-hidden ml-5"
                  >
                    <div className="space-y-0.5 py-1 border-l border-foreground/[0.04] pl-3">
                      {section.items.map(item => (
                        <button
                          key={item.path}
                          onClick={() => loadDocument(item.path)}
                          className={`w-full text-left px-2.5 py-1.5 rounded-lg text-xs transition-all ${
                            currentPath === item.path
                              ? 'bg-accent/10 text-accent font-semibold'
                              : 'text-foreground/50 hover:text-foreground/70 hover:bg-foreground/[0.03]'
                          } ${item.highlight ? 'font-medium' : ''}`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="truncate">{item.title}</span>
                            {currentPath === item.path && <CaretRight size={10} weight="bold" />}
                          </div>
                        </button>
                      ))}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )
        })}
      </div>
    </div>
  )
}
