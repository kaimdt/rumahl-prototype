import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useConfiguration } from '@/contexts/ConfigurationContext'
import { useTheme } from '@/contexts/ThemeContext'
import { DEFAULT_DASHBOARD_BACKGROUND_URL } from '@/lib/defaults'

function normalizePosition(raw: unknown): string {
  const value = String(raw ?? 'center').toLowerCase()
  if (value === 'left') return 'left center'
  if (value === 'right') return 'right center'
  if (value === 'top') return 'center top'
  if (value === 'bottom') return 'center bottom'
  if (value.includes(' ')) return value
  return 'center center'
}

function normalizeSize(raw: unknown): 'cover' | 'contain' | 'auto' {
  const value = String(raw ?? 'cover').toLowerCase()
  if (value === 'contain' || value === 'container') return 'contain'
  if (value === 'auto') return 'auto'
  if (value === 'cover' || value === 'about') return 'cover'
  return 'cover'
}

function buildFilter(config: Record<string, unknown>): string {
  const blur = Number(config.blur ?? 0)
  const brightness = Number(config.brightness ?? 100)
  return `blur(${Math.max(0, blur)}px) brightness(${Math.max(20, brightness)}%)`
}

function buildOpacity(config: Record<string, unknown>): number {
  const opacity = Number(config.opacity ?? 100)
  return Math.max(0, Math.min(100, opacity)) / 100
}

export function DynamicBackground() {
  const { background } = useConfiguration()
  const { theme } = useTheme()
  const isSleep = theme === 'sleep'

  if (!background || !background.is_active) {
    return null
  }

  let config: any
  try {
    config = typeof background.config === 'string'
      ? JSON.parse(background.config)
      : background.config
  } catch {
    config = {
      type: 'static',
      url: DEFAULT_DASHBOARD_BACKGROUND_URL,
      position: 'center',
      size: 'cover',
      fixed: true,
      opacity: 100,
      blur: 0,
      brightness: 100,
    }
  }

  return (
    <div
      className="fixed inset-0 z-0 pointer-events-none"
      style={{
        filter: isSleep ? 'brightness(0.03) grayscale(1) saturate(0)' : 'none',
        opacity: isSleep ? 0.1 : 1,
        transition: 'filter 0.6s ease, opacity 0.6s ease',
      }}
    >
      {background.background_type === 'static' && (
        <StaticBackground config={config} />
      )}
      {background.background_type === 'slideshow' && (
        <SlideshowBackground config={config} />
      )}
      {background.background_type === 'video' && (
        <VideoBackground config={config} />
      )}
      {background.background_type === 'gradient' && (
        <GradientBackground config={config} />
      )}
    </div>
  )
}

function StaticBackground({ config }: { config: any }) {
  const position = normalizePosition(config.position)
  const size = normalizeSize(config.size)
  const fixed = config.fixed !== false

  const url = typeof config.url === 'string' && config.url.trim().length > 0
    ? config.url
    : DEFAULT_DASHBOARD_BACKGROUND_URL

  return (
    <div
      className={`${fixed ? 'fixed' : 'absolute'} inset-0 bg-no-repeat`}
      style={{
        backgroundImage: `url(${url})`,
        backgroundPosition: position,
        backgroundSize: size,
        backgroundAttachment: fixed ? 'fixed' : 'scroll',
        opacity: buildOpacity(config),
        filter: buildFilter(config),
        willChange: 'transform',
      }}
    />
  )
}

function SlideshowBackground({ config }: { config: any }) {
  const [currentIndex, setCurrentIndex] = useState(0)
  const urls = config.urls || []
  const interval = (config.interval || 5) * 1000

  useEffect(() => {
    if (urls.length === 0) return

    const timer = setInterval(() => {
      setCurrentIndex((prev) => (prev + 1) % urls.length)
    }, interval)

    return () => clearInterval(timer)
  }, [urls.length, interval])

  if (urls.length === 0) return null

  const currentUrl = urls[currentIndex] || DEFAULT_DASHBOARD_BACKGROUND_URL

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={currentIndex}
        className="fixed inset-0 bg-no-repeat"
        style={{
          backgroundImage: `url(${currentUrl})`,
          backgroundPosition: normalizePosition(config.position),
          backgroundSize: normalizeSize(config.size),
          backgroundAttachment: 'fixed',
          opacity: buildOpacity(config),
          filter: buildFilter(config),
          willChange: 'opacity',
        }}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 1 }}
      />
    </AnimatePresence>
  )
}

function VideoBackground({ config }: { config: any }) {
  const videoUrl = typeof config.url === 'string' && config.url.trim().length > 0
    ? config.url
    : DEFAULT_DASHBOARD_BACKGROUND_URL

  return (
    <video
      className="fixed inset-0 w-full h-full object-cover"
      src={videoUrl}
      autoPlay
      muted
      loop={config.loop !== false}
      playsInline
      style={{
        opacity: buildOpacity(config),
        filter: buildFilter(config),
      }}
    />
  )
}

function GradientBackground({ config }: { config: any }) {
  const colors = config.colors || ['#667eea', '#764ba2']
  const angle = config.angle || 135

  const gradientStyle = {
    background: `linear-gradient(${angle}deg, ${colors.join(', ')})`,
    opacity: buildOpacity(config),
    filter: buildFilter(config),
  }

  return <div className="fixed inset-0" style={gradientStyle} />
}
