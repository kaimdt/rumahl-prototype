import { motion, AnimatePresence } from 'framer-motion'
import { Warning, WifiSlash, CheckCircle } from '@phosphor-icons/react'
import { useConnection } from '@/contexts/ConnectionContext'

export function ConnectionStatus() {
  const { backend, homeAssistant } = useConnection()

  const showBackendError = backend === 'error' || backend === 'disconnected'
  const showHAError = homeAssistant === 'error' || homeAssistant === 'disconnected'

  if (!showBackendError && !showHAError) {
    return null
  }

  return (
    <AnimatePresence>
      {(showBackendError || showHAError) && (
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -20 }}
          className="fixed top-4 right-4 z-50 flex flex-col gap-2"
        >
          {showBackendError && (
            <motion.div
              className="glass-card px-4 py-3 rounded-lg border border-destructive/20 bg-destructive/10 backdrop-blur-xl"
              initial={{ scale: 0.9 }}
              animate={{ scale: 1 }}
            >
              <div className="flex items-center gap-3">
                <Warning size={20} weight="fill" className="text-destructive" />
                <div>
                  <p className="text-sm font-medium text-destructive">
                    Backend nicht erreichbar
                  </p>
                  <p className="text-xs text-destructive/80">
                    Verbindung wird wiederhergestellt...
                  </p>
                </div>
              </div>
            </motion.div>
          )}

          {showHAError && (
            <motion.div
              className="glass-card px-4 py-3 rounded-lg border border-destructive/20 bg-destructive/10 backdrop-blur-xl"
              initial={{ scale: 0.9 }}
              animate={{ scale: 1 }}
            >
              <div className="flex items-center gap-3">
                <WifiSlash size={20} weight="fill" className="text-destructive" />
                <div>
                  <p className="text-sm font-medium text-destructive">
                    Home Assistant nicht erreichbar
                  </p>
                  <p className="text-xs text-destructive/80">
                    Prüfe deine Verbindung
                  </p>
                </div>
              </div>
            </motion.div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  )
}

/**
 * Full-screen overlay when backend is completely unavailable
 */
export function BackendUnavailableOverlay() {
  const { backend } = useConnection()

  if (backend !== 'error') {
    return null
  }

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 bg-background/95 backdrop-blur-lg flex items-center justify-center"
      >
        <div className="text-center space-y-6 max-w-md px-6">
          <motion.div
            animate={{
              scale: [1, 1.1, 1],
              rotate: [0, 5, -5, 0],
            }}
            transition={{
              duration: 2,
              repeat: Infinity,
              ease: 'easeInOut',
            }}
          >
            <WifiSlash size={64} weight="fill" className="text-destructive mx-auto" />
          </motion.div>

          <div>
            <h2 className="text-2xl font-semibold text-foreground mb-2">
              Backend nicht erreichbar
            </h2>
            <p className="text-foreground/60">
              Die Verbindung zum Backend konnte nicht hergestellt werden.
              Alle Funktionen sind vorübergehend nicht verfügbar.
            </p>
          </div>

          <div className="glass-card p-4 rounded-lg">
            <p className="text-sm text-foreground/80">
              Bitte überprüfe:
            </p>
            <ul className="mt-2 text-sm text-foreground/60 text-left space-y-1">
              <li>• Home Assistant ist gestartet</li>
              <li>• Netzwerkverbindung ist aktiv</li>
              <li>• Backend-Konfiguration ist korrekt</li>
            </ul>
          </div>

          <motion.div
            animate={{ opacity: [0.5, 1, 0.5] }}
            transition={{ duration: 2, repeat: Infinity }}
            className="text-xs text-foreground/40"
          >
            Automatische Neuverbindung...
          </motion.div>
        </div>
      </motion.div>
    </AnimatePresence>
  )
}
