/**
 * ThemeIframeProvider - Synchronizes theme to iframe apps
 * 
 * This component listens to theme changes in the parent context
 * and broadcasts them to all iframe apps via postMessage
 */

import { useEffect, useRef } from 'react'
import { useTheme } from '@/contexts/ThemeContext'

export function ThemeIframeProvider() {
  const { theme, activeCssVariables, themeResponse, capabilities, animationConfig, navConfig, modalConfig, notificationConfig, nightModeConfig } = useTheme()
  const lastThemeRef = useRef<string>('')

  useEffect(() => {
    // Build theme info to send to iframes
    const themeInfo = {
      id: theme,
      name: theme,
      mode: determineMode(theme),
      variables: activeCssVariables,
      capabilities: {
        supportsCustomization: true,
        locksAccent: capabilities?.accent_control?.mode === 'force',
        locksGlass: capabilities?.glass_control?.mode !== 'user',
      },
      animation: animationConfig || null,
      navigation: navConfig || null,
      modals: modalConfig || null,
      notifications: notificationConfig || null,
      night_mode: nightModeConfig || null,
    }

    // Only broadcast if theme actually changed
    const themeKey = JSON.stringify(themeInfo)
    if (themeKey === lastThemeRef.current) return
    lastThemeRef.current = themeKey

    // Find all iframes and send theme update
    const iframes = document.querySelectorAll('iframe')
    iframes.forEach((iframe) => {
      try {
        iframe.contentWindow?.postMessage({
          type: 'iora:theme:update',
          theme: themeInfo,
        }, '*')
      } catch (e) {
        console.warn('Failed to send theme to iframe:', e)
      }
    })
  }, [theme, activeCssVariables, capabilities, animationConfig, navConfig, modalConfig, notificationConfig, nightModeConfig])

  // Listen for theme requests from iframes
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'iora:theme:request') {
        const iframe = Array.from(document.querySelectorAll('iframe')).find(
          (f) => f.contentWindow === event.source
        )
        
        if (iframe) {
          const themeInfo = {
            id: theme,
            name: theme,
            mode: determineMode(theme),
            variables: activeCssVariables,
            capabilities: {
              supportsCustomization: true,
              locksAccent: capabilities?.accent_control?.mode === 'force',
              locksGlass: capabilities?.glass_control?.mode !== 'user',
            },
            animation: animationConfig || null,
            navigation: navConfig || null,
            modals: modalConfig || null,
            notifications: notificationConfig || null,
            night_mode: nightModeConfig || null,
          }

          event.source?.postMessage({
            type: 'iora:theme:update',
            theme: themeInfo,
          }, '*' as any)
        }
      }
    }

    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [theme, activeCssVariables, capabilities, animationConfig, navConfig, modalConfig, notificationConfig, nightModeConfig])

  return null // This is a logic-only component
}

function determineMode(themeId: string): 'light' | 'dark' | 'auto' {
  if (themeId === 'auto') return 'auto'
  if (themeId === 'light' || themeId === 'day') return 'light'
  if (['night', 'sleep', 'evening', 'day-classic'].includes(themeId)) return 'dark'
  return 'auto'
}
