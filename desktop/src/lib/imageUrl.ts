import { getApiBase } from '@/lib/apiBase'

function resolveApiBase() {
  const base = getApiBase()
  return (base || window.location.origin).replace(/\/$/, '')
}

export function toBackendImageUrl(raw: string | undefined | null): string | null {
  if (!raw) return null

  const remapKnownApiPath = (path: string, search = ''): string | null => {
    const markers = ['/api/hass_agent/', '/api/image/serve/']
    for (const marker of markers) {
      const index = path.indexOf(marker)
      if (index >= 0) {
        return `${resolveApiBase()}${path.slice(index)}${search}`
      }
    }
    return null
  }

  if (raw.startsWith('http://') || raw.startsWith('https://')) {
    try {
      const parsed = new URL(raw)
      const proxied = remapKnownApiPath(parsed.pathname, parsed.search)
      if (proxied) return proxied
      return raw
    } catch {
      return raw
    }
  }

  if (raw.startsWith('//')) {
    return `${window.location.protocol}${raw}`
  }

  if (raw.startsWith('/')) {
    const proxied = remapKnownApiPath(raw)
    if (proxied) return proxied
    return `${resolveApiBase()}${raw}`
  }

  return `${resolveApiBase()}/${raw.replace(/^\/+/, '')}`
}
