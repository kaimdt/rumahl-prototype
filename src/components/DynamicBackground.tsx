import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useConfiguration } from '@/contexts/ConfigurationContext'
import type { BackgroundConfig, BackgroundConfigData } from '@/contexts/ConfigurationContext'

export function DynamicBackground() {
  const { background } = useConfiguration()

  if (!background || !background.is_active) {
    return null
  }

  const config = typeof background.config === 'string'
    ? JSON.parse(background.config)
    : background.config

  return (
    <div className="fixed inset-0 -z-10">
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
  return (
    <div
      className="absolute inset-0 bg-cover bg-center bg-no-repeat"
      style={{ backgroundImage: `url(${config.url})` }}
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

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={currentIndex}
        className="absolute inset-0 bg-cover bg-center bg-no-repeat"
        style={{ backgroundImage: `url(${urls[currentIndex]})` }}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 1 }}
      />
    </AnimatePresence>
  )
}

function VideoBackground({ config }: { config: any }) {
  return (
    <video
      className="absolute inset-0 w-full h-full object-cover"
      src={config.url}
      autoPlay
      muted
      loop={config.loop !== false}
      playsInline
    />
  )
}

function GradientBackground({ config }: { config: any }) {
  const colors = config.colors || ['#667eea', '#764ba2']
  const angle = config.angle || 135

  const gradientStyle = {
    background: `linear-gradient(${angle}deg, ${colors.join(', ')})`,
  }

  return <div className="absolute inset-0" style={gradientStyle} />
}
