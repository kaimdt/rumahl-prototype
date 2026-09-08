/**
 * Platform detection hook for rumahl Desktop.
 *
 * Detects the host OS (Windows, macOS, Linux) and exposes it
 * for platform-adaptive UI rendering. Falls back to user-agent
 * detection when not running inside Tauri.
 */
import { useState, useEffect } from 'react'
import type { Platform } from '@/lib/tauri'

let cachedPlatform: Platform | null = null

/** Resolve platform once and cache. Safe to call before React mounts. */
function resolvePlatform(): Platform {
  if (cachedPlatform) return cachedPlatform

  // Try Tauri first
  if ((window as any).__TAURI_INTERNALS__) {
    // Use navigator as fallback; Tauri command is async so use sync path for initial
    const ua = navigator.userAgent
    if (ua.includes('Windows')) {
      cachedPlatform = 'windows'
    } else if (ua.includes('Mac')) {
      cachedPlatform = 'macos'
    } else {
      cachedPlatform = 'linux'
    }
    return cachedPlatform
  }

  // Browser-based detection
  const ua = navigator.userAgent
  if (ua.includes('Windows')) return 'windows'
  if (ua.includes('Mac')) return 'macos'
  return 'linux'
}

/** Set cached platform from a known value (e.g., Tauri command result). */
export function setPlatform(p: Platform) {
  cachedPlatform = p
}

/** Get the platform synchronously (returns cached value or resolves from UA). */
export function getPlatform(): Platform {
  return resolvePlatform()
}

/**
 * React hook for platform detection.
 *
 * Returns the platform immediately from cache, then refreshes
 * from the Tauri backend for the most accurate result.
 */
export function usePlatform(): Platform {
  const [platform, setPlatformState] = useState<Platform>(resolvePlatform)

  useEffect(() => {
    // Async: confirm via Tauri command for highest accuracy
    import('@tauri-apps/api/core')
      .then(({ invoke }) =>
        invoke<Platform>('get_platform').catch(() => resolvePlatform())
      )
      .then((p) => {
        cachedPlatform = p
        setPlatformState(p)
      })
      .catch(() => {
        // Not in Tauri – keep the UA-based value
      })
  }, [])

  return platform
}

/**
 * Apply platform class to the document root for CSS scoping.
 * Call once at app startup.
 */
export function applyPlatformClass(platform: Platform) {
  document.documentElement.classList.add(`platform-${platform}`)
}
