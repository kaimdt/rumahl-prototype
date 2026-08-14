import { authFetch } from '@/lib/authHelpers'

interface CacheEntry {
  response: Promise<Response>
  expiresAt: number
}

const cache = new Map<string, CacheEntry>()

/**
 * cachedGet — GET with in-flight dedupe and a short TTL cache.
 *
 * Multiple pollers hitting the same endpoint share ONE request and reuse a
 * fresh (cloned) response within the TTL, cutting duplicate API calls while
 * keeping real-time data current.
 */
export function cachedGet(url: string, ttlMs = 8000): Promise<Response> {
  const now = Date.now()
  const existing = cache.get(url)
  if (existing && existing.expiresAt > now) {
    return existing.response.then((res) => res.clone())
  }

  const response = authFetch(url)
    .then((res) => {
      if (!res.ok) cache.delete(url)
      return res
    })
    .catch((err) => {
      cache.delete(url)
      throw err
    })

  cache.set(url, { response, expiresAt: now + ttlMs })
  return response.then((res) => res.clone())
}
