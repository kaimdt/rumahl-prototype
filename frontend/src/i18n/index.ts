/**
 * IORA i18n Configuration
 * 
 * Supports: English (default), German
 * RTL-ready: CSS logical properties + dir attribute
 * 
 * Usage:
 *   import { useTranslation } from 'react-i18next'
 *   const { t } = useTranslation()
 *   <h1>{t('app.name')}</h1>
 */

import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import LanguageDetector from 'i18next-browser-languagedetector'
import en from './locales/en.json'
import de from './locales/de.json'

const resources = {
  en: { translation: en },
  de: { translation: de },
} as const

export const supportedLngs = ['en', 'de'] as const
export type SupportedLanguage = (typeof supportedLngs)[number]

export const languageNames: Record<SupportedLanguage, { native: string; english: string; dir: 'ltr' | 'rtl' }> = {
  en: { native: 'English', english: 'English', dir: 'ltr' },
  de: { native: 'Deutsch', english: 'German', dir: 'ltr' },
}

// Future RTL languages:
// ar: { native: 'العربية', english: 'Arabic', dir: 'rtl', flag: '🇸🇦' },
// he: { native: 'עברית', english: 'Hebrew', dir: 'rtl', flag: '🇮🇱' },

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: 'en',
    supportedLngs: [...supportedLngs],
    defaultNS: 'translation',
    interpolation: { escapeValue: false },
    detection: {
      order: ['localStorage', 'navigator', 'htmlTag'],
      caches: ['localStorage'],
      lookupLocalStorage: 'iora-language',
    },
  })

/**
 * Set the document direction (ltr/rtl) based on language.
 */
export function applyLanguageDirection(lng: string) {
  const dir = languageNames[lng as SupportedLanguage]?.dir || 'ltr'
  document.documentElement.dir = dir
  document.documentElement.lang = lng
}

// Apply direction on language change
i18n.on('languageChanged', (lng) => {
  applyLanguageDirection(lng)
})

// Apply initial direction
applyLanguageDirection(i18n.language)

export default i18n
