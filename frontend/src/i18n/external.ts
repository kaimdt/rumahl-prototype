import i18n, { supportedLngs, type SupportedLanguage } from '@/i18n'

export type TranslationResources = Record<string, unknown>

export interface LoadTranslationBundlesResult {
  loaded: SupportedLanguage[]
  missing: SupportedLanguage[]
  failed: { lng: SupportedLanguage; error: string }[]
}

async function safeFetchJson(url: string, fetcher: typeof fetch): Promise<unknown | null> {
  const res = await fetcher(url)
  if (!res.ok) return null
  try {
    return await res.json()
  } catch {
    return null
  }
}

/**
 * Load i18n bundles from a static asset directory.
 *
 * Convention: `${assetsBaseUrl}/i18n/<lng>.json` (e.g. `/api/themes/assets/my-theme/i18n/de.json`)
 *
 * The JSON should match the normal i18next resource shape for that namespace:
 * `{ "some": { "nested": { "key": "value" }}}`
 */
export async function loadTranslationBundlesFromAssets(opts: {
  assetsBaseUrl: string
  namespace: string
  fetcher?: typeof fetch
  languages?: readonly SupportedLanguage[]
}): Promise<LoadTranslationBundlesResult> {
  const fetcher = opts.fetcher ?? fetch
  const languages = (opts.languages ?? supportedLngs) as readonly SupportedLanguage[]
  const result: LoadTranslationBundlesResult = { loaded: [], missing: [], failed: [] }

  await Promise.all(languages.map(async (lng) => {
    const url = `${opts.assetsBaseUrl.replace(/\/$/, '')}/i18n/${lng}.json`
    try {
      const json = await safeFetchJson(url, fetcher)
      if (!json || typeof json !== 'object') {
        result.missing.push(lng)
        return
      }
      i18n.addResourceBundle(lng, opts.namespace, json as TranslationResources, true, true)
      result.loaded.push(lng)
    } catch (e) {
      result.failed.push({ lng, error: (e as Error).message })
    }
  }))

  return result
}
