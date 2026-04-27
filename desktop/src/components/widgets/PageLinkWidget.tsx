import { useMemo } from 'react'
import {
  ArrowSquareOut,
  ArrowRight,
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
import { usePageNavigation } from '@/contexts/PageNavigationContext'

const iconMap: Record<string, React.ComponentType<{ size?: number; weight?: 'regular' | 'fill' | 'bold' }>> = {
  House, Lightbulb, Thermometer, PlugsConnected, Gauge, Gear, FloppyDisk,
  VideoCamera, SpeakerHigh, Lock, Garage, Fan, Bathtub, Bed, CookingPot,
  Couch, Desktop, Tree, Door, ShieldCheck, Drop, Lightning, WifiHigh,
  Broadcast, Baby, Dog, Car, Sun, Moon, FireSimple,
  Warehouse, Buildings, Armchair, Shower, Stairs, SwimmingPool,
  CloudSun, CloudRain, Snowflake, Wind, Umbrella, Rainbow,
  Television, Lamp, WashingMachine,
  Cat, Bird, Fish, PawPrint,
  Flower, Leaf, Plant,
  Bicycle, Airplane, Train,
  Bluetooth, Cpu, HardDrive, Robot,
  Heartbeat, FirstAid, Siren,
  Coffee, Wine, ForkKnife,
  Bell, Calendar, ChatCircle, Clock, MapPin, Star, Gift, Wrench, Eye,
  Phone, EnvelopeSimple, Alarm, Timer, Power, Plug,
  Toolbox, Palette, MusicNote, GameController, BookOpen, Heart, Trophy, Megaphone,
}

export type PageLinkVariant =
  | 'filled'
  | 'outlined'
  | 'ghost'
  | 'card'
  | 'gradient'
  | 'icon_only'
  | 'tile'
  | 'mini'

interface PageLinkWidgetProps {
  config?: Record<string, unknown>
  widgetSize?: { w: number; h: number }
}

export default function PageLinkWidget({ config, widgetSize }: PageLinkWidgetProps) {
  const { pages, pageMap, setCurrentPageId, openModalPage, getSubPages } = usePageNavigation()
  const targetPageId = config?.targetPageId as string | undefined
  const customLabel = config?.label as string | undefined
  const customColor = config?.color as string | undefined
  const variant = ((config?.variant as string) || 'filled') as PageLinkVariant

  const w = widgetSize?.w ?? 1
  const h = widgetSize?.h ?? 1
  const isLarge = w >= 2 && h >= 2
  const isWide = w >= 3
  const isTall = h >= 3

  const targetPage = useMemo(
    () => targetPageId ? pageMap.get(targetPageId) : undefined,
    [pageMap, targetPageId]
  )

  const subPages = useMemo(
    () => targetPageId ? getSubPages(targetPageId) : [],
    [targetPageId, getSubPages]
  )

  if (!targetPageId || !targetPage) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-2 text-foreground/30 p-3">
        <ArrowSquareOut size={24} />
        <span className="text-[10px] text-center">Seite auswählen</span>
      </div>
    )
  }

  const Icon = iconMap[targetPage.icon] || ArrowSquareOut
  const label = customLabel || targetPage.name
  const isModal = targetPage.displayMode === 'modal'

  const handleClick = () => {
    if (isModal) {
      openModalPage(targetPage.id)
    } else {
      setCurrentPageId(targetPage.id)
    }
  }

  const colorStyle = customColor
    ? { '--pl-color': customColor, '--pl-bg': `${customColor}15`, '--pl-bg-hover': `${customColor}25` } as React.CSSProperties
    : undefined

  const accentColor = customColor || 'var(--accent-color, oklch(0.65 0.18 260))'
  const widgetCount = targetPage.widgets?.length ?? 0

  const handleSubPageClick = (subPage: typeof pages[0], e: React.MouseEvent) => {
    e.stopPropagation()
    if (subPage.displayMode === 'modal') {
      openModalPage(subPage.id)
    } else {
      setCurrentPageId(subPage.id)
    }
  }

  // Shared sub-pages list for large widgets
  const subPagesList = isLarge && subPages.length > 0 ? (
    <div className="w-full mt-auto pt-2 border-t border-foreground/5">
      <span className="text-[9px] text-foreground/30 uppercase tracking-wider mb-1.5 block">Unterseiten</span>
      <div className="flex flex-col gap-1">
        {subPages.slice(0, isTall ? 6 : 3).map(sub => {
          const SubIcon = iconMap[sub.icon] || ArrowSquareOut
          return (
            <button
              key={sub.id}
              onClick={(e) => handleSubPageClick(sub, e)}
              className="flex items-center gap-2 px-2 py-1 rounded-lg hover:bg-foreground/5 transition-colors text-left cursor-pointer"
            >
              <SubIcon size={14} weight="regular" className="flex-shrink-0" style={{ color: accentColor }} />
              <span className="text-[11px] text-foreground/70 truncate">{sub.name}</span>
            </button>
          )
        })}
        {subPages.length > (isTall ? 6 : 3) && (
          <span className="text-[9px] text-foreground/25 pl-2">+{subPages.length - (isTall ? 6 : 3)} weitere</span>
        )}
      </div>
    </div>
  ) : null

  // Card variant — matches the glass-card look of other widgets
  if (variant === 'card') {
    return (
      <button
        onClick={handleClick}
        className={`h-full w-full glass-card glass-card-shimmer rounded-2xl theme-transition cursor-pointer active:scale-[0.97] flex flex-col ${isLarge ? 'items-start justify-start' : 'items-center justify-center'} gap-2.5 p-4`}
        style={colorStyle}
      >
        <div className={`flex ${isLarge && isWide ? 'flex-row items-center gap-3' : 'flex-col items-center gap-2.5'} ${isLarge ? '' : 'w-full justify-center'}`}>
          <div
            className={`${isLarge ? 'w-14 h-14' : 'w-11 h-11'} rounded-xl flex items-center justify-center flex-shrink-0`}
            style={{ backgroundColor: `${accentColor}18`, color: accentColor }}
          >
            <Icon size={isLarge ? 28 : 24} weight="fill" />
          </div>
          <div className={isLarge ? 'text-left' : 'text-center'}>
            <span className={`${isLarge ? 'text-sm' : 'text-xs'} font-medium line-clamp-2 text-foreground block`}>{label}</span>
            {isLarge && (
              <span className="text-[10px] text-foreground/40 mt-0.5 block">
                {widgetCount} Widget{widgetCount !== 1 ? 's' : ''}
                {isModal && ' · Modal'}
              </span>
            )}
            {!isLarge && isModal && (
              <span className="text-[8px] text-foreground/30 uppercase tracking-wider">Modal</span>
            )}
          </div>
        </div>
        {subPagesList}
      </button>
    )
  }

  // Gradient variant — accent-colored gradient background
  if (variant === 'gradient') {
    const gradientColor = customColor || 'var(--accent-color, oklch(0.65 0.18 260))'
    const rawColor = customColor || '#6366f1'
    return (
      <button
        onClick={handleClick}
        className={`h-full w-full rounded-2xl cursor-pointer active:scale-[0.97] flex flex-col ${isLarge ? 'items-start justify-start' : 'items-center justify-center'} gap-2 p-3 transition-all hover:brightness-110 hover:shadow-lg`}
        style={{
          background: `linear-gradient(135deg, ${rawColor}22 0%, ${rawColor}08 50%, ${rawColor}18 100%)`,
          border: `1px solid ${rawColor}20`,
        }}
      >
        <div className={`flex ${isLarge && isWide ? 'flex-row items-center gap-3' : 'flex-col items-center gap-2'}`}>
          <span style={{ color: gradientColor }}><Icon size={isLarge ? 32 : 28} weight="fill" /></span>
          <div className={isLarge ? 'text-left' : 'text-center'}>
            <span className={`${isLarge ? 'text-sm' : 'text-xs'} font-medium line-clamp-2`} style={{ color: gradientColor }}>{label}</span>
            {isLarge && (
              <span className="text-[10px] mt-0.5 block" style={{ color: gradientColor, opacity: 0.5 }}>
                {widgetCount} Widget{widgetCount !== 1 ? 's' : ''}
                {isModal && ' · Modal'}
              </span>
            )}
            {!isLarge && isModal && (
              <span className="text-[8px] uppercase tracking-wider" style={{ color: gradientColor, opacity: 0.5 }}>Modal</span>
            )}
          </div>
        </div>
        {isLarge && subPages.length > 0 && (
          <div className="w-full mt-auto pt-2 border-t" style={{ borderColor: `${rawColor}15` }}>
            <span className="text-[9px] uppercase tracking-wider mb-1.5 block" style={{ color: gradientColor, opacity: 0.4 }}>Unterseiten</span>
            <div className="flex flex-col gap-1">
              {subPages.slice(0, isTall ? 6 : 3).map(sub => {
                const SubIcon = iconMap[sub.icon] || ArrowSquareOut
                return (
                  <button
                    key={sub.id}
                    onClick={(e) => handleSubPageClick(sub, e)}
                    className="flex items-center gap-2 px-2 py-1 rounded-lg transition-colors text-left cursor-pointer"
                    style={{ color: gradientColor }}
                    onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = `${rawColor}12` }}
                    onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent' }}
                  >
                    <SubIcon size={14} weight="regular" className="flex-shrink-0" />
                    <span className="text-[11px] truncate" style={{ opacity: 0.7 }}>{sub.name}</span>
                  </button>
                )
              })}
              {subPages.length > (isTall ? 6 : 3) && (
                <span className="text-[9px] pl-2" style={{ color: gradientColor, opacity: 0.3 }}>+{subPages.length - (isTall ? 6 : 3)} weitere</span>
              )}
            </div>
          </div>
        )}
      </button>
    )
  }

  // Icon-only variant — large centered icon, no text (shows label when large)
  if (variant === 'icon_only') {
    return (
      <button
        onClick={handleClick}
        className="h-full w-full flex flex-col items-center justify-center gap-2 rounded-2xl cursor-pointer active:scale-[0.97] transition-all hover:bg-foreground/5"
        style={colorStyle}
      >
        <div
          className={`${isLarge ? 'w-18 h-18' : 'w-14 h-14'} rounded-2xl flex items-center justify-center transition-all hover:scale-105`}
          style={{ backgroundColor: `${accentColor}${isLarge ? '15' : '12'}`, color: accentColor }}
        >
          <Icon size={isLarge ? 40 : 32} weight="fill" />
        </div>
        {isLarge && (
          <span className="text-xs font-medium text-center text-foreground">{label}</span>
        )}
      </button>
    )
  }

  // Tile variant — horizontal layout like a list item
  if (variant === 'tile') {
    return (
      <div
        className="h-full w-full glass-card rounded-2xl theme-transition flex flex-col"
        style={colorStyle}
      >
        <button
          onClick={handleClick}
          className="flex items-center gap-3 px-4 py-3 cursor-pointer active:scale-[0.98] transition-all"
        >
          <div
            className={`${isLarge ? 'w-12 h-12' : 'w-10 h-10'} rounded-xl flex-shrink-0 flex items-center justify-center`}
            style={{ backgroundColor: `${accentColor}12`, color: accentColor }}
          >
            <Icon size={isLarge ? 24 : 22} weight="fill" />
          </div>
          <div className="flex-1 text-left min-w-0">
            <span className={`${isLarge ? 'text-sm' : 'text-sm'} font-medium text-foreground block truncate`}>{label}</span>
            {isLarge && (
              <span className="text-[10px] text-foreground/40 block mt-0.5">
                {widgetCount} Widget{widgetCount !== 1 ? 's' : ''}
                {isModal && ' · Modal'}
              </span>
            )}
            {!isLarge && isModal && (
              <span className="text-[9px] text-foreground/30 uppercase tracking-wider">Modal</span>
            )}
          </div>
          <ArrowRight size={16} className="text-foreground/25 flex-shrink-0" />
        </button>
        {isLarge && subPages.length > 0 && (
          <div className="px-4 pb-3 mt-auto">
            <div className="pt-2 border-t border-foreground/5">
              <span className="text-[9px] text-foreground/30 uppercase tracking-wider mb-1.5 block">Unterseiten</span>
              <div className="flex flex-col gap-1">
                {subPages.slice(0, isTall ? 6 : 3).map(sub => {
                  const SubIcon = iconMap[sub.icon] || ArrowSquareOut
                  return (
                    <button
                      key={sub.id}
                      onClick={(e) => handleSubPageClick(sub, e)}
                      className="flex items-center gap-2 px-2 py-1 rounded-lg hover:bg-foreground/5 transition-colors text-left cursor-pointer"
                    >
                      <SubIcon size={14} weight="regular" className="flex-shrink-0" style={{ color: accentColor }} />
                      <span className="text-[11px] text-foreground/70 truncate">{sub.name}</span>
                    </button>
                  )
                })}
                {subPages.length > (isTall ? 6 : 3) && (
                  <span className="text-[9px] text-foreground/25 pl-2">+{subPages.length - (isTall ? 6 : 3)} weitere</span>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    )
  }

  // Mini variant — compact pill-shaped button
  if (variant === 'mini') {
    return (
      <div className="h-full w-full flex items-center justify-center">
        <button
          onClick={handleClick}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full cursor-pointer active:scale-95 transition-all text-xs font-medium"
          style={{
            backgroundColor: customColor ? `${customColor}18` : 'var(--accent-color, oklch(0.65 0.18 260))' + '15',
            color: customColor || 'var(--accent-color, oklch(0.65 0.18 260))',
            border: `1px solid ${customColor || 'var(--accent-color, oklch(0.65 0.18 260))'}25`,
          }}
        >
          <Icon size={14} weight="bold" />
          <span>{label}</span>
        </button>
      </div>
    )
  }

  // Original variants: filled, outlined, ghost
  const baseClasses = `h-full w-full flex flex-col ${isLarge ? 'items-start justify-start' : 'items-center justify-center'} gap-2 p-3 rounded-xl transition-all cursor-pointer active:scale-95`
  const variantClasses = variant === 'outlined'
    ? 'border border-foreground/15 hover:border-accent/40 hover:bg-accent/5'
    : variant === 'ghost'
      ? 'hover:bg-foreground/5'
      : 'bg-accent/10 hover:bg-accent/20'

  return (
    <button
      onClick={handleClick}
      className={`${baseClasses} ${variantClasses}`}
      style={customColor ? { backgroundColor: `${customColor}20`, color: customColor } : undefined}
    >
      <div className={`flex ${isLarge && isWide ? 'flex-row items-center gap-3' : 'flex-col items-center gap-2'}`}>
        <Icon size={isLarge ? 32 : 28} weight="regular" />
        <div className={isLarge ? 'text-left' : 'text-center'}>
          <span className={`${isLarge ? 'text-sm' : 'text-xs'} font-medium line-clamp-2 block`}>{label}</span>
          {isLarge && (
            <span className="text-[10px] text-foreground/40 mt-0.5 block">
              {widgetCount} Widget{widgetCount !== 1 ? 's' : ''}
              {isModal && ' · Modal'}
            </span>
          )}
          {!isLarge && isModal && (
            <span className="text-[8px] text-foreground/30 uppercase tracking-wider block">Modal</span>
          )}
        </div>
      </div>
      {subPagesList}
    </button>
  )
}
