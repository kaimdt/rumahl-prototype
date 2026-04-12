import { useCallback, useMemo, useState } from 'react'
import { LinkSimple, UploadSimple, PaperPlaneRight, Plug, ShieldCheck, Globe, ShareNetwork } from '@phosphor-icons/react'
import { toast } from 'sonner'

function createShareToken() {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2, 10)
}

export function SharePage() {
  const [shareToken] = useState(createShareToken)
  const [selectedFiles, setSelectedFiles] = useState<File[]>([])
  const [isSharing, setIsSharing] = useState(false)
  const [cloudConnectEnabled, setCloudConnectEnabled] = useState(false)
  const [showPairdrop, setShowPairdrop] = useState(true)
  const [pairdropError, setPairdropError] = useState(false)

  const shareUrl = useMemo(
    () => `${window.location.origin}/share/${shareToken}`,
    [shareToken],
  )

  const handleFileSelect = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files
    if (!files) return
    setSelectedFiles(Array.from(files))
  }, [])

  const copyShareLink = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(shareUrl)
      toast.success('Share-Link kopiert')
    } catch (error) {
      toast.error('Kopieren fehlgeschlagen')
    }
  }, [shareUrl])

  const toggleCloudConnect = useCallback(() => {
    setCloudConnectEnabled((prev) => !prev)
    toast.success('User Cloud Connect wird aktualisiert')
  }, [])

  const startConnector = useCallback(() => {
    setIsSharing(true)
    toast.success('User Cloud Connect wird vorbereitet')
    window.setTimeout(() => setIsSharing(false), 1200)
  }, [])

  const pairdropUrl = 'https://pairdrop.net'
  const handlePairdropLoad = useCallback(() => setPairdropError(false), [])
  const handlePairdropError = useCallback(() => setPairdropError(true), [])
  const togglePairdrop = useCallback(() => setShowPairdrop((prev) => !prev), [])

  const browserShare = useCallback(async () => {
    if (navigator.share) {
      try {
        await navigator.share({ title: 'IORA Share', text: 'Teile diesen Link mit User Cloud Connect', url: shareUrl })
      } catch (error) {
        toast.error('Teilen fehlgeschlagen')
      }
    } else {
      await copyShareLink()
    }
  }, [copyShareLink, shareUrl])

  return (
    <div className="space-y-6 page-transition-enter">
      <div className="glass-card rounded-3xl border border-foreground/10 bg-background/70 p-6 shadow-xl shadow-black/5 backdrop-blur-xl">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex items-center gap-3">
              <div className="grid h-14 w-14 place-items-center rounded-3xl bg-accent/10 text-accent">
                <ShareNetwork size={28} weight="bold" />
              </div>
              <div>
                <h1 className="text-2xl font-semibold text-foreground">Share</h1>
                <p className="mt-1 text-sm text-foreground/70">
                  Wähle zwischen lokalem Pairdrop-/AirDrop-ähnlichem Teilen, direkter lokaler Verbindung bzw. Tailscale und externem Zugang über User Cloud Connect.
                </p>
              </div>
            </div>
          </div>
          <div className="rounded-3xl border border-foreground/10 bg-card/75 p-4 shadow-sm">
            <p className="text-xs uppercase tracking-[0.24em] text-foreground/50">Link teilen über User Cloud Connect</p>
            <div className="mt-3 rounded-2xl border border-foreground/10 bg-background/80 p-3 text-sm break-all text-foreground">
              {shareUrl}
            </div>
            <div className="mt-4 flex flex-col gap-2 sm:flex-row">
              <button
                type="button"
                onClick={copyShareLink}
                className="inline-flex items-center justify-center gap-2 rounded-2xl border border-foreground/10 bg-foreground/10 px-4 py-3 text-sm font-semibold text-foreground transition hover:bg-foreground/15"
              >
                <PaperPlaneRight size={16} weight="bold" /> Link kopieren
              </button>
              <button
                type="button"
                onClick={browserShare}
                className="inline-flex items-center justify-center gap-2 rounded-2xl border border-foreground/10 bg-background/90 px-4 py-3 text-sm font-semibold text-foreground transition hover:bg-foreground/5"
              >
                Teilen
              </button>
            </div>
            <div className="mt-3 rounded-2xl bg-background/90 p-3 text-xs text-foreground/60 border border-foreground/10">
              Externe Erreichbarkeit über User Cloud Connect nur verfügbar, wenn dein Benutzerkonto Cloud Connect aktiviert hat.
            </div>
          </div>
        </div>

        <div className="grid gap-4 xl:grid-cols-[1.2fr_0.9fr]">
          <div className="rounded-3xl border border-foreground/10 bg-card/75 p-6">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-semibold text-foreground">Pairdrop / Lokales Teilen</p>
                <p className="mt-1 text-sm text-foreground/70">
                  Teile Dateien direkt im lokalen Netzwerk – ähnlich AirDrop und Pairdrop.
                </p>
              </div>
              <button
                type="button"
                onClick={togglePairdrop}
                className="rounded-2xl border border-foreground/10 bg-background/90 px-4 py-2 text-sm font-semibold text-foreground transition hover:bg-foreground/5"
              >
                {showPairdrop ? 'Verstecken' : 'Anzeigen'}
              </button>
            </div>
            <div className="mt-5 overflow-hidden rounded-3xl border border-foreground/10 bg-background/80">
              {showPairdrop ? (
                <iframe
                  title="Pairdrop"
                  src={pairdropUrl}
                  className="h-[420px] w-full border-0 bg-background"
                  loading="lazy"
                  onLoad={handlePairdropLoad}
                  onError={handlePairdropError}
                />
              ) : (
                <div className="flex min-h-[420px] items-center justify-center px-6 py-12 text-center text-sm text-foreground/70">
                  Pairdrop ist ausgeblendet. Klicke oben auf &quot;Anzeigen&quot;, um den eingebetteten Share-Raum zu sehen.
                </div>
              )}
            </div>
            {pairdropError && (
              <div className="mt-4 rounded-2xl border border-destructive/20 bg-destructive/10 p-4 text-sm text-destructive">
                Pairdrop konnte nicht geladen werden. Öffne{' '}
                <a href={pairdropUrl} target="_blank" rel="noreferrer" className="font-semibold underline text-destructive">
                  pairdrop.net
                </a>{' '}
                in einem neuen Tab.
              </div>
            )}
          </div>

          <div className="rounded-3xl border border-foreground/10 bg-card/75 p-6">
            <div className="flex items-center gap-3">
              <div className="grid h-11 w-11 place-items-center rounded-2xl bg-foreground/10 text-foreground">
                <Globe size={20} weight="bold" />
              </div>
              <div>
                <p className="text-sm font-semibold text-foreground">User Cloud Connect</p>
                <p className="mt-1 text-sm text-foreground/70">
                  Public Proxy für externen Zugriff auf IORA Home und Share-Funktionen.
                </p>
              </div>
            </div>
            <div className="mt-6 space-y-4 text-sm text-foreground/70">
              <div className="rounded-2xl bg-background/90 p-4 border border-foreground/10">
                Benutzerkonto Cloud Connect muss aktiv sein, damit dieser Link von außen erreichbar wird.
              </div>
              <div className="rounded-2xl bg-background/90 p-4 border border-foreground/10">
                Der Link leitet über den User Cloud Connect Proxy, damit dein IORA Home von außen ohne lokale IP erreichbar ist.
              </div>
              <div className="rounded-2xl bg-background/90 p-4 border border-foreground/10">
                Admin Control Center ist über User Cloud Connect nicht erreichbar. Die Cloud-Verbindung wird im lokalen Admin Center eingerichtet und nur autorisierten Benutzern gewährt.
              </div>
            </div>
            <button
              type="button"
              onClick={toggleCloudConnect}
              className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-accent px-4 py-3 text-sm font-semibold text-accent-foreground transition hover:bg-accent/90"
            >
              {cloudConnectEnabled ? 'Cloud Connect deaktivieren' : 'Cloud Connect aktivieren'}
            </button>
            <p className="mt-3 text-sm font-medium text-foreground">
              Status: <span className={cloudConnectEnabled ? 'text-emerald-400' : 'text-foreground/60'}>{cloudConnectEnabled ? 'Aktiv' : 'Inaktiv'}</span>
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
