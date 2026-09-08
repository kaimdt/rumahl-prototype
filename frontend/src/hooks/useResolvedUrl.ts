import { useEffect, useState } from 'react'
import { resolverumahlUrlAsync } from '@/lib/authHelpers'

/**
 * Resolves an rumahl/web/filesystem path to a working browser URL.
 * The raw stored value is never changed — only the render URL is resolved.
 */
export function useResolvedUrl(raw: string): string {
  const [resolved, setResolved] = useState(raw)
  useEffect(() => {
    let cancelled = false
    resolverumahlUrlAsync(raw)
      .then((url) => { if (!cancelled) setResolved(url) })
      .catch(() => { if (!cancelled) setResolved(raw) })
    return () => { cancelled = true }
  }, [raw])
  return resolved
}
