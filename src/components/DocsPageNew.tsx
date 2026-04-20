import { useState, useMemo, useEffect } from 'react'
import type { ReactNode } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  BookOpen,
  CaretRight,
  CaretLeft,
  MagnifyingGlass,
  List,
  X,
} from '@phosphor-icons/react'
import { marked } from 'marked'

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

interface DocContent {
  path: string
  content: string
  title: string
}

// ─── Markdown Renderer ────────────────────────────────────────────────────

// Configure marked for better rendering
marked.setOptions({
  breaks: true,
  gfm: true,
})

// ─── DocsPage Component ───────────────────────────────────────────────────

export function DocsPage() {
  const [config, setConfig] = useState<DocsConfig | null>(null)
  const [currentDoc, setCurrentDoc] = useState<DocContent | null>(null)
  const [loading, setLoading] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')

  // Load documentation configuration on mount
  useEffect(() => {
    loadConfig()
  }, [])

  // Load document from URL on mount
  useEffect(() => {
    const path = window.location.pathname
    if (path.startsWith('/docs/')) {
      const docPath = path.slice(6) // Remove '/docs/' prefix
      if (docPath) {
        loadDocument(docPath)
      }
    }
  }, [])

  const loadConfig = async () => {
    try {
      const response = await fetch('/api/documentation/config')
      if (response.ok) {
        const data = await response.json()
        setConfig(data)
      }
    } catch (error) {
      console.error('Failed to load docs config:', error)
    }
  }

  const loadDocument = async (path: string) => {
    setLoading(true)
    try {
      const response = await fetch(`/api/documentation/${path}`)
      if (response.ok) {
        const data = await response.json()
        setCurrentDoc(data)
        // Update URL without page reload
        const newPath = `/docs/${path}`
        if (window.location.pathname !== newPath) {
          window.history.pushState({}, '', newPath)
        }
      }
    } catch (error) {
      console.error('Failed to load document:', error)
    } finally {
      setLoading(false)
    }
  }

  // Search across all documentation items
  const filteredSections = useMemo(() => {
    if (!config || !searchQuery.trim()) return config?.navigation || []

    const query = searchQuery.toLowerCase()
    return config.navigation
      .map(section => ({
        ...section,
        items: section.items.filter(item =>
          item.title.toLowerCase().includes(query) ||
          item.path.toLowerCase().includes(query)
        ),
      }))
      .filter(section => section.items.length > 0)
  }, [config, searchQuery])

  // Render markdown content
  const renderMarkdown = (content: string) => {
    const html = marked(content)
    return (
      <div
        className="prose prose-sm max-w-none
          prose-headings:text-foreground
          prose-h1:text-2xl prose-h1:font-bold prose-h1:mb-4 prose-h1:mt-6
          prose-h2:text-xl prose-h2:font-semibold prose-h2:mb-3 prose-h2:mt-5
          prose-h3:text-lg prose-h3:font-medium prose-h3:mb-2 prose-h3:mt-4
          prose-p:text-foreground/70 prose-p:leading-relaxed
          prose-a:text-accent prose-a:no-underline hover:prose-a:underline
          prose-strong:text-foreground prose-strong:font-semibold
          prose-code:text-accent prose-code:bg-foreground/5 prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-code:text-xs prose-code:font-mono prose-code:before:content-none prose-code:after:content-none
          prose-pre:bg-foreground/5 prose-pre:border prose-pre:border-foreground/10 prose-pre:rounded-xl prose-pre:p-4
          prose-ul:text-foreground/70 prose-ul:list-disc prose-ul:ml-4
          prose-ol:text-foreground/70 prose-ol:list-decimal prose-ol:ml-4
          prose-li:text-foreground/70 prose-li:my-1
          prose-table:text-foreground/70 prose-table:border prose-table:border-foreground/10 prose-table:rounded-lg
          prose-th:bg-foreground/5 prose-th:text-foreground/60 prose-th:font-medium prose-th:text-xs
          prose-td:border-t prose-td:border-foreground/5 prose-td:p-2
          prose-blockquote:border-l-4 prose-blockquote:border-accent/30 prose-blockquote:pl-4 prose-blockquote:italic prose-blockquote:text-foreground/60
          prose-img:rounded-xl prose-img:border prose-img:border-foreground/10"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    )
  }

  if (!config) {
    return (
      <div className="glass-card rounded-2xl p-8 flex items-center justify-center">
        <div className="text-center">
          <BookOpen size={48} className="mx-auto mb-3 text-foreground/30" weight="duotone" />
          <p className="text-sm text-foreground/50">Dokumentation wird geladen...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex gap-4 h-full">
      {/* Sidebar */}
      <AnimatePresence>
        {sidebarOpen && (
          <motion.aside
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: 280, opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="flex-shrink-0 overflow-hidden"
          >
            <div className="glass-card rounded-2xl p-4 h-full overflow-y-auto">
              {/* Header */}
              <div className="mb-4">
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
                    <BookOpen size={20} weight="duotone" />
                    Dokumentation
                  </h2>
                  <button
                    onClick={() => setSidebarOpen(false)}
                    className="lg:hidden p-1.5 hover:bg-foreground/5 rounded-lg transition-colors"
                  >
                    <X size={16} />
                  </button>
                </div>

                {/* Search */}
                <div className="relative">
                  <MagnifyingGlass
                    size={14}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-foreground/40"
                  />
                  <input
                    type="text"
                    placeholder="Suchen..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full pl-9 pr-3 py-2 text-xs rounded-lg bg-foreground/5 border border-foreground/10 focus:border-accent/30 focus:outline-none transition-colors text-foreground placeholder:text-foreground/40"
                  />
                </div>
              </div>

              {/* Navigation */}
              <nav className="space-y-4">
                {filteredSections.map((section) => (
                  <div key={section.section}>
                    <h3 className="text-xs font-semibold text-foreground/50 uppercase tracking-wider mb-2">
                      {section.section}
                    </h3>
                    <div className="space-y-0.5">
                      {section.items.map((item) => (
                        <button
                          key={item.path}
                          onClick={() => loadDocument(item.path)}
                          className={`w-full text-left px-3 py-2 rounded-lg text-xs transition-all ${
                            currentDoc?.path === item.path
                              ? 'bg-accent/15 text-accent font-medium'
                              : 'text-foreground/70 hover:bg-foreground/5 hover:text-foreground'
                          } ${item.highlight ? 'font-medium' : ''}`}
                        >
                          <div className="flex items-center justify-between">
                            <span>{item.title}</span>
                            {currentDoc?.path === item.path && (
                              <CaretRight size={12} weight="bold" />
                            )}
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </nav>
            </div>
          </motion.aside>
        )}
      </AnimatePresence>

      {/* Main Content */}
      <div className="flex-1 overflow-y-auto">
        <div className="glass-card rounded-2xl p-6 min-h-full">
          {/* Toggle Sidebar Button (mobile) */}
          {!sidebarOpen && (
            <button
              onClick={() => setSidebarOpen(true)}
              className="mb-4 flex items-center gap-2 px-3 py-2 text-xs bg-foreground/5 hover:bg-foreground/10 rounded-lg transition-colors"
            >
              <List size={16} />
              Inhaltsverzeichnis anzeigen
            </button>
          )}

          {loading ? (
            <div className="flex items-center justify-center py-20">
              <div className="text-center">
                <div className="w-8 h-8 border-2 border-accent/30 border-t-accent rounded-full animate-spin mx-auto mb-3" />
                <p className="text-sm text-foreground/50">Wird geladen...</p>
              </div>
            </div>
          ) : currentDoc ? (
            <div className="space-y-4">
              {/* Document Header */}
              <div className="border-b border-foreground/10 pb-4 mb-6">
                <h1 className="text-2xl font-bold text-foreground">{currentDoc.title}</h1>
                <p className="text-xs text-foreground/40 mt-1">{currentDoc.path}</p>
              </div>

              {/* Document Content */}
              <div className="rounded-xl bg-foreground/[0.02] border border-foreground/5 p-6">
                {renderMarkdown(currentDoc.content)}
              </div>
            </div>
          ) : (
            <div className="text-center py-20">
              <BookOpen size={64} className="mx-auto mb-4 text-foreground/20" weight="duotone" />
              <h2 className="text-lg font-semibold text-foreground mb-2">
                Willkommen zur IORA Dokumentation
              </h2>
              <p className="text-sm text-foreground/50 max-w-md mx-auto">
                Wählen Sie ein Thema aus der Seitenleiste, um loszulegen.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
