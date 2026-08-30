const UPDATE_INTERVAL_MS = 5 * 60 * 1000

export function registerServiceWorkerUpdates() {
  if (!('serviceWorker' in navigator) || !import.meta.env.PROD) return

  let reloading = false
  const activateUpdate = (registration: ServiceWorkerRegistration) => {
    registration.waiting?.postMessage({ type: 'SKIP_WAITING' })
  }

  window.addEventListener('load', async () => {
    try {
      const registration = await navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' })
      activateUpdate(registration)
      registration.addEventListener('updatefound', () => {
        const installing = registration.installing
        installing?.addEventListener('statechange', () => {
          if (installing.state === 'installed' && navigator.serviceWorker.controller) activateUpdate(registration)
        })
      })

      const checkForUpdate = () => registration.update().catch(() => undefined)
      const interval = window.setInterval(checkForUpdate, UPDATE_INTERVAL_MS)
      window.addEventListener('online', checkForUpdate)
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') checkForUpdate()
      })
      window.addEventListener('pagehide', () => window.clearInterval(interval), { once: true })
    } catch (error) {
      console.warn('[PWA] Service worker registration failed:', error)
    }
  })

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) return
    reloading = true
    window.location.reload()
  })
}
