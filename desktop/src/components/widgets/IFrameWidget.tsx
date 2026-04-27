import { useState, useEffect, useCallback } from 'react'
import { motion } from 'framer-motion'
import { Globe, ArrowsOutSimple, ArrowSquareOut, ArrowClockwise } from '@phosphor-icons/react'
import { useLongPressDialog } from '@/hooks/useLongPressDialog'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Tip } from '@/components/ui/tip'

interface IFrameWidgetConfig {
  url?: string
  title?: string
  showHeader?: boolean
  allowFullscreen?: boolean
  variant?: 'standard' | 'borderless' | 'compact'
  cardVariant?: string
  refreshIntervalSeconds?: number
  customHeight?: number
  scrolling?: boolean
  [key: string]: unknown
}

interface IFrameWidgetProps {
  config?: IFrameWidgetConfig
}

export default function IFrameWidget({ config }: IFrameWidgetProps) {
  const url = config?.url
  const title = config?.title || 'Webseite'
  const variant = (config?.variant || config?.cardVariant || 'standard') as 'standard' | 'borderless' | 'compact'
  const showHeader = variant === 'borderless' ? false : (config?.showHeader !== false)
  const allowFullscreen = config?.allowFullscreen !== false
  const refreshInterval = config?.refreshIntervalSeconds ? config.refreshIntervalSeconds * 1000 : 0
  const scrolling = config?.scrolling !== false
  const [iframeKey, setIframeKey] = useState(0)
  const { dialogOpen, setDialogOpen, longPressHandlers } = useLongPressDialog()

  // Auto-refresh
  useEffect(() => {
    if (!refreshInterval || !url) return
    const interval = setInterval(() => setIframeKey(k => k + 1), refreshInterval)
    return () => clearInterval(interval)
  }, [refreshInterval, url])

  if (!url) {
    return (
      <motion.div
        className="glass-card rounded-2xl p-4 sm:p-5 h-full flex flex-col items-center justify-center"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <Globe size={36} className="text-foreground/20 mb-3" />
        <p className="text-sm text-foreground/40 font-medium">Keine URL konfiguriert</p>
        <p className="text-[10px] text-foreground/25 mt-1">URL im Widget konfigurieren</p>
      </motion.div>
    )
  }

  return (
    <>
    <motion.div
      {...longPressHandlers}
      className={`${variant === 'borderless' ? '' : 'glass-card'} rounded-2xl h-full flex flex-col overflow-hidden`}
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ scale: 1.005 }}
      whileTap={{ scale: 0.98 }}
      transition={{ type: 'spring', stiffness: 400, damping: 25 }}
    >
      {showHeader && (
        <div className={`flex items-center justify-between px-4 ${variant === 'compact' ? 'pt-2 pb-1' : 'pt-3 pb-2'}`}>
          <div className="flex items-center gap-2 min-w-0">
            <Globe size={variant === 'compact' ? 14 : 16} weight="fill" className="text-accent shrink-0" />
            <h3 className={`${variant === 'compact' ? 'text-xs' : 'text-sm'} font-semibold text-foreground truncate`}>{title}</h3>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {refreshInterval > 0 && (
              <Tip content="Aktualisieren">
                <button
                  onClick={() => setIframeKey(k => k + 1)}
                  className="p-1 rounded-md hover:bg-foreground/5 text-foreground/40 hover:text-foreground/70 transition-colors"
                >
                  <ArrowClockwise size={14} />
                </button>
              </Tip>
            )}
            <Tip content="In neuem Tab öffnen">
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="p-1 rounded-md hover:bg-foreground/5 text-foreground/40 hover:text-foreground/70 transition-colors"
              >
                <ArrowSquareOut size={14} />
              </a>
            </Tip>
          </div>
        </div>
      )}

      <div className="flex-1 min-h-0">
        <iframe
          key={iframeKey}
          src={url}
          className="w-full h-full border-0"
          title={title}
          loading="lazy"
          referrerPolicy="no-referrer"
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
          allowFullScreen={allowFullscreen}
          scrolling={scrolling ? 'auto' : 'no'}
        />
      </div>
    </motion.div>

    <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
      <DialogContent className="sm:max-w-[90vw] glass-card border-foreground/10 p-0 gap-0 bg-card/95 backdrop-blur-2xl overflow-hidden">
        <DialogHeader className="sr-only">
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        <div className="flex items-center justify-between px-4 pt-3 pb-2 border-b border-foreground/8">
          <div className="flex items-center gap-2 min-w-0">
            <Globe size={16} weight="fill" className="text-accent shrink-0" />
            <h3 className="text-sm font-semibold text-foreground truncate">{title}</h3>
          </div>
          <Tip content="In neuem Tab öffnen">
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="p-1.5 rounded-md hover:bg-foreground/5 text-foreground/40 hover:text-foreground/70 transition-colors"
            >
              <ArrowSquareOut size={14} />
            </a>
          </Tip>
        </div>

        <div className="w-full" style={{ height: '75vh' }}>
          <iframe
            src={url}
            className="w-full h-full border-0"
            title={title}
            loading="lazy"
            referrerPolicy="no-referrer"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
            allowFullScreen
          />
        </div>
      </DialogContent>
    </Dialog>
    </>
  )
}
