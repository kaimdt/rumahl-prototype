import { createRoot } from 'react-dom/client'
import { ErrorBoundary } from "react-error-boundary";

import App from './App.tsx'
import { ErrorFallback } from './ErrorFallback.tsx'
import { initAutoContrast } from './lib/autoContrast'

import "./index.css"

initAutoContrast()
// Restore accent-tinted icons preference
import('./lib/accentIcons').then(({ readAccentIcons, applyAccentIcons }) => applyAccentIcons(readAccentIcons()))

// OS behaviour: never show the browser's default context menu (apps provide
// their own). Text inputs keep the native menu so copy/paste still works.
window.addEventListener('contextmenu', (event) => {
  const target = event.target as HTMLElement | null
  if (target && (target.closest('input, textarea, [contenteditable="true"]'))) return
  event.preventDefault()
}, { capture: true })

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((error) => {
      console.warn('[PWA] Service worker registration failed:', error)
    })
  })
}

createRoot(document.getElementById('root')!).render(
  <ErrorBoundary FallbackComponent={ErrorFallback}>
    <App />
   </ErrorBoundary>
)
