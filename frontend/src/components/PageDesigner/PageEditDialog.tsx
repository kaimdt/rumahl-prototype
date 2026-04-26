import { useState, useEffect } from 'react'
import {
  House,
  Lightbulb,
  Thermometer,
  PlugsConnected,
  Gauge,
  Gear,
  FloppyDisk,
  VideoCamera,
  SpeakerHigh,
  Lock,
  Garage,
  Fan,
  Bathtub,
  Bed,
  CookingPot,
  Couch,
  Desktop,
  Tree,
  Door,
  ShieldCheck,
  Drop,
  Lightning,
  WifiHigh,
  Broadcast,
  Baby,
  Dog,
  Car,
  Sun,
  Moon,
  FireSimple,
  Globe,
  User,
  // Additional icons
  Warehouse,
  Buildings,
  Armchair,
  Shower,
  Stairs,
  SwimmingPool,
  CloudSun,
  CloudRain,
  Snowflake,
  Wind,
  Umbrella,
  Rainbow,
  Television,
  Lamp,
  WashingMachine,
  Cat,
  Bird,
  Fish,
  PawPrint,
  Flower,
  Leaf,
  Plant,
  Bicycle,
  Airplane,
  Train,
  Bluetooth,
  Cpu,
  HardDrive,
  Robot,
  Heartbeat,
  FirstAid,
  Siren,
  Coffee,
  Wine,
  ForkKnife,
  Bell,
  Calendar,
  ChatCircle,
  Clock,
  MapPin,
  Star,
  Gift,
  Wrench,
  Eye,
  Phone,
  EnvelopeSimple,
  Alarm,
  Timer,
  Power,
  Plug,
  Toolbox,
  Palette,
  MusicNote,
  GameController,
  BookOpen,
  Heart,
  Trophy,
  Megaphone,
} from '@phosphor-icons/react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import type { DashboardPage, ModalSettings } from '@/lib/types'

const availableIcons = {
  House, Lightbulb, Thermometer, PlugsConnected, Gauge, Gear, FloppyDisk,
  VideoCamera, SpeakerHigh, Lock, Garage, Fan, Bathtub, Bed, CookingPot,
  Couch, Desktop, Tree, Door, ShieldCheck, Drop, Lightning, WifiHigh,
  Broadcast, Baby, Dog, Car, Sun, Moon, FireSimple,
  // Rooms & Spaces
  Warehouse, Buildings, Armchair, Shower, Stairs, SwimmingPool,
  // Weather
  CloudSun, CloudRain, Snowflake, Wind, Umbrella, Rainbow,
  // Appliances
  Television, Lamp, WashingMachine,
  // Animals
  Cat, Bird, Fish, PawPrint,
  // Plants & Nature
  Flower, Leaf, Plant,
  // Transport
  Bicycle, Airplane, Train,
  // Technology
  Bluetooth, Cpu, HardDrive, Robot,
  // Health & Safety
  Heartbeat, FirstAid, Siren,
  // Food & Drink
  Coffee, Wine, ForkKnife,
  // Utility
  Bell, Calendar, ChatCircle, Clock, MapPin, Star, Gift, Wrench, Eye,
  Phone, EnvelopeSimple, Alarm, Timer, Power, Plug,
  // Tools & Hobbies
  Toolbox, Palette, MusicNote, GameController, BookOpen, Heart, Trophy, Megaphone,
} as const

const iconLabels: Record<keyof typeof availableIcons, string> = {
  House: 'Haus', Lightbulb: 'Licht', Thermometer: 'Temperatur', PlugsConnected: 'Stecker',
  Gauge: 'Sensor', Gear: 'Einstellungen', FloppyDisk: 'Speicher', VideoCamera: 'Kamera',
  SpeakerHigh: 'Lautsprecher', Lock: 'Schloss', Garage: 'Garage', Fan: 'Lüfter',
  Bathtub: 'Bad', Bed: 'Schlafzimmer', CookingPot: 'Küche', Couch: 'Wohnzimmer',
  Desktop: 'Büro', Tree: 'Garten', Door: 'Eingang', ShieldCheck: 'Sicherheit',
  Drop: 'Wasser', Lightning: 'Energie', WifiHigh: 'Netzwerk', Broadcast: 'Medien',
  Baby: 'Kinderzimmer', Dog: 'Haustier', Car: 'Fahrzeug', Sun: 'Sonne',
  Moon: 'Mond', FireSimple: 'Heizung',
  // Rooms & Spaces
  Warehouse: 'Lager', Buildings: 'Gebäude', Armchair: 'Sessel', Shower: 'Dusche',
  Stairs: 'Treppe', SwimmingPool: 'Pool',
  // Weather
  CloudSun: 'Bewölkt', CloudRain: 'Regen', Snowflake: 'Schnee', Wind: 'Wind',
  Umbrella: 'Regenschirm', Rainbow: 'Regenbogen',
  // Appliances
  Television: 'Fernseher', Lamp: 'Lampe', WashingMachine: 'Waschmaschine',
  // Animals
  Cat: 'Katze', Bird: 'Vogel', Fish: 'Fisch', PawPrint: 'Pfote',
  // Plants & Nature
  Flower: 'Blume', Leaf: 'Blatt', Plant: 'Pflanze',
  // Transport
  Bicycle: 'Fahrrad', Airplane: 'Flugzeug', Train: 'Zug',
  // Technology
  Bluetooth: 'Bluetooth', Cpu: 'Prozessor', HardDrive: 'Festplatte', Robot: 'Roboter',
  // Health & Safety
  Heartbeat: 'Herzschlag', FirstAid: 'Erste Hilfe', Siren: 'Sirene',
  // Food & Drink
  Coffee: 'Kaffee', Wine: 'Wein', ForkKnife: 'Besteck',
  // Utility
  Bell: 'Glocke', Calendar: 'Kalender', ChatCircle: 'Chat', Clock: 'Uhr',
  MapPin: 'Standort', Star: 'Favorit', Gift: 'Geschenk', Wrench: 'Werkzeug',
  Eye: 'Auge', Phone: 'Telefon', EnvelopeSimple: 'Nachricht', Alarm: 'Alarm',
  Timer: 'Timer', Power: 'Strom', Plug: 'Steckdose',
  // Tools & Hobbies
  Toolbox: 'Werkzeugkasten', Palette: 'Farben', MusicNote: 'Musik',
  GameController: 'Spiele', BookOpen: 'Buch', Heart: 'Herz',
  Trophy: 'Trophäe', Megaphone: 'Durchsage',
}

interface PageEditDialogProps {
  open: boolean
  onClose: () => void
  page: DashboardPage
  pages: DashboardPage[]
  onSave: (updates: {
    name: string
    icon: string
    showInNav: boolean
    displayMode: 'page' | 'modal'
    parentPageId?: string
    modalSettings?: ModalSettings
  }) => void
}

export function PageEditDialog({ open, onClose, page, pages, onSave }: PageEditDialogProps) {
  const isHome = page.id === 'home'

  const [name, setName] = useState(page.name)
  const [icon, setIcon] = useState<keyof typeof availableIcons>(page.icon as keyof typeof availableIcons)
  const [showInNav, setShowInNav] = useState(page.showInNav !== false)
  const [displayMode, setDisplayMode] = useState<'page' | 'modal'>(page.displayMode || 'page')
  const [parentPageId, setParentPageId] = useState<string | undefined>(page.parentPageId || undefined)
  const [modalSettings, setModalSettings] = useState<ModalSettings>(page.modalSettings || {})

  useEffect(() => {
    if (open) {
      setName(page.name)
      setIcon(page.icon as keyof typeof availableIcons)
      setShowInNav(page.showInNav !== false)
      setDisplayMode(page.displayMode || 'page')
      setParentPageId(page.parentPageId || undefined)
      setModalSettings(page.modalSettings || {})
    }
  }, [open, page])

  const handleSave = () => {
    onSave({
      name,
      icon,
      showInNav,
      displayMode,
      parentPageId: parentPageId || undefined,
      modalSettings: displayMode === 'modal' ? modalSettings : undefined,
    })
    onClose()
  }

  // Scope badge component
  const ScopeBadge = ({ scope }: { scope: 'global' | 'user' }) => (
    <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[8px] font-semibold uppercase tracking-wider ${
      scope === 'global' ? 'bg-blue-500/10 text-blue-400' : 'bg-purple-500/10 text-purple-400'
    }`} title={scope === 'global' ? 'Gilt für alle Benutzer' : 'Gilt pro Benutzer'}>
      {scope === 'global' ? <Globe size={8} weight="fill" /> : <User size={8} weight="fill" />}
      {scope === 'global' ? 'Alle' : 'User'}
    </span>
  )

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-base text-foreground">Seite bearbeiten</DialogTitle>
          <DialogDescription className="text-xs text-foreground/60">
            Einstellungen für „{page.name}"
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 mt-1">
          {/* Page name */}
          <div>
            <div className="flex items-center gap-2 mb-1.5">
              <label className="text-xs font-medium text-foreground/70">Seitenname</label>
              <ScopeBadge scope="user" />
            </div>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-foreground/5 border border-foreground/10 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-accent/50"
              placeholder="Seitenname"
            />
          </div>

          {/* Icon picker */}
          <div>
            <div className="flex items-center gap-2 mb-1.5">
              <label className="text-xs font-medium text-foreground/70">Symbol</label>
              <ScopeBadge scope="user" />
            </div>
            <div className="grid grid-cols-10 gap-1 max-h-48 overflow-y-auto pr-1">
              {Object.entries(availableIcons).map(([key, IconComponent]) => {
                const iconKey = key as keyof typeof availableIcons
                return (
                  <button
                    key={key}
                    onClick={() => setIcon(iconKey)}
                    className={`p-1.5 rounded-lg transition-all ${
                      icon === iconKey
                        ? 'bg-accent/20 text-accent ring-1 ring-accent/30'
                        : 'text-foreground/40 hover:text-foreground/60 hover:bg-foreground/5'
                    }`}
                    title={iconLabels[iconKey]}
                  >
                    <IconComponent size={16} weight={icon === iconKey ? 'fill' : 'regular'} />
                  </button>
                )
              })}
            </div>
          </div>

          {!isHome && (
            <>
              {/* Show in navigation */}
              <div className="flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <h4 className="text-xs font-medium text-foreground">In Navigation anzeigen</h4>
                    <ScopeBadge scope="user" />
                  </div>
                  <p className="text-[11px] text-foreground/50">Seite in der unteren Navigationsleiste anzeigen.</p>
                </div>
                <button
                  onClick={() => setShowInNav(!showInNav)}
                  className={`relative w-10 h-5 rounded-full transition-colors ${
                    showInNav ? 'bg-accent' : 'bg-foreground/20'
                  }`}
                >
                  <div className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform shadow-sm ${
                    showInNav ? 'translate-x-5' : ''
                  }`} />
                </button>
              </div>

              {/* Display Mode */}
              <div>
                <div className="flex items-center gap-2 mb-1.5">
                  <label className="text-xs font-medium text-foreground/70">Anzeigemodus</label>
                  <ScopeBadge scope="user" />
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => setDisplayMode('page')}
                    className={`flex-1 px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
                      displayMode === 'page'
                        ? 'bg-accent/15 text-accent border border-accent/30'
                        : 'bg-foreground/5 text-foreground/50 hover:bg-foreground/10 border border-transparent'
                    }`}
                  >
                    Vollseite
                  </button>
                  <button
                    onClick={() => setDisplayMode('modal')}
                    className={`flex-1 px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
                      displayMode === 'modal'
                        ? 'bg-accent/15 text-accent border border-accent/30'
                        : 'bg-foreground/5 text-foreground/50 hover:bg-foreground/10 border border-transparent'
                    }`}
                  >
                    Modal
                  </button>
                </div>
              </div>

              {/* Modal Settings */}
              {displayMode === 'modal' && (
                <div className="space-y-3 rounded-xl bg-foreground/3 p-3 border border-foreground/5">
                  <h4 className="text-xs font-medium text-foreground/70">Modal-Einstellungen</h4>

                  {/* Modal Size */}
                  <div>
                    <label className="text-[11px] text-foreground/50 mb-1 block">Größe</label>
                    <div className="grid grid-cols-4 gap-1">
                      {(['small', 'medium', 'large', 'fullscreen'] as const).map(size => (
                        <button
                          key={size}
                          onClick={() => setModalSettings(s => ({ ...s, size }))}
                          className={`px-2 py-1.5 rounded-lg text-[11px] font-medium transition-colors ${
                            (modalSettings.size || 'large') === size
                              ? 'bg-accent/20 text-accent'
                              : 'bg-foreground/5 text-foreground/40 hover:bg-foreground/10'
                          }`}
                        >
                          {{ small: 'Klein', medium: 'Mittel', large: 'Groß', fullscreen: 'Voll' }[size]}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Modal toggles */}
                  {[
                    { key: 'backdropBlur', label: 'Hintergrund-Blur' },
                    { key: 'closeOnBackdropClick', label: 'Klick außen schließt' },
                    { key: 'showCloseButton', label: 'Schließen-Button' },
                    { key: 'rounded', label: 'Abgerundet' },
                  ].map(({ key, label }) => (
                    <div key={key} className="flex items-center justify-between">
                      <span className="text-[11px] text-foreground/60">{label}</span>
                      <button
                        onClick={() => setModalSettings(s => ({
                          ...s,
                          [key]: !(s[key as keyof ModalSettings] !== false),
                        }))}
                        className={`relative w-8 h-4 rounded-full transition-colors ${
                          modalSettings[key as keyof ModalSettings] !== false ? 'bg-accent' : 'bg-foreground/20'
                        }`}
                      >
                        <div className={`absolute top-0.5 left-0.5 w-3 h-3 bg-white rounded-full transition-transform ${
                          modalSettings[key as keyof ModalSettings] !== false ? 'translate-x-4' : ''
                        }`} />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Parent Page */}
              <div>
                <div className="flex items-center gap-2 mb-1.5">
                  <label className="text-xs font-medium text-foreground/70">Übergeordnete Seite</label>
                  <ScopeBadge scope="user" />
                </div>
                <select
                  value={parentPageId || ''}
                  onChange={(e) => {
                    const val = e.target.value || undefined
                    setParentPageId(val)
                    if (val) setShowInNav(false)
                  }}
                  className="w-full px-3 py-2 rounded-lg bg-foreground/5 border border-foreground/10 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-accent/50"
                >
                  <option value="">– Keine (Hauptseite) –</option>
                  {pages
                    .filter(p => p.id !== page.id && p.id !== 'settings' && !p.parentPageId)
                    .map(p => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))
                  }
                </select>
                {parentPageId && (
                  <p className="text-[10px] text-foreground/40 mt-1">
                    Unterseiten können über ein Seitenlink-Widget geöffnet werden.
                  </p>
                )}
              </div>
            </>
          )}

          {/* Actions */}
          <div className="flex gap-2 pt-2 border-t border-foreground/10">
            <button
              onClick={handleSave}
              className="flex-1 px-4 py-2.5 rounded-xl bg-accent text-white text-sm font-medium hover:bg-accent/90 transition-colors"
            >
              Speichern
            </button>
            <button
              onClick={onClose}
              className="px-4 py-2.5 rounded-xl bg-foreground/10 text-foreground text-sm hover:bg-foreground/15 transition-colors"
            >
              Abbrechen
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export { availableIcons, iconLabels }
