import { useEffect, useState } from 'react'
import { authFetch, resolveIoraUrl } from '@/lib/authHelpers'

/**
 * AuthImage – loads an authenticated image URL via fetch (Authorization
 * header) and exposes it as a blob object URL. Plain <img> tags can only
 * send cookies, which break when the session lives on another host.
 */
export function AuthImage({
  src,
  alt,
  className,
  width,
  height,
}: {
  src: string
  alt?: string
  className?: string
  width?: number
  height?: number
}) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    let url: string | null = null
    setObjectUrl(null)
    authFetch(resolveIoraUrl(src))
      .then((res) => (res.ok ? res.blob() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then((blob) => {
        if (cancelled) return
        url = URL.createObjectURL(blob)
        setObjectUrl(url)
      })
      .catch(() => { /* broken/missing file — render nothing */ })
    return () => {
      cancelled = true
      if (url) URL.revokeObjectURL(url)
    }
  }, [src])

  if (!objectUrl) return null
  return <img src={objectUrl} alt={alt} className={className} width={width} height={height} />
}
