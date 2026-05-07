import { useTranslation } from 'react-i18next'
import { supportedLngs, languageNames, type SupportedLanguage } from '@/i18n'
import { Globe } from '@phosphor-icons/react'

export function LanguageSwitcher() {
  const { i18n, t } = useTranslation()
  const currentLang = i18n.language as SupportedLanguage

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 mb-4">
        <Globe size={18} className="text-foreground/70" />
        <h3 className="text-sm font-semibold text-foreground">{t('settings.language')}</h3>
      </div>
      <p className="text-xs text-foreground/50 mb-4">{t('settings.languageDesc')}</p>

      <div className="grid grid-cols-1 gap-2">
        {supportedLngs.map(lng => {
          const info = languageNames[lng]
          const isActive = currentLang === lng
          return (
            <button
              key={lng}
              onClick={() => i18n.changeLanguage(lng)}
              className={`flex items-center gap-4 p-4 rounded-xl border-2 transition-all text-left ${
                isActive
                  ? 'border-accent bg-accent/10 shadow-sm'
                  : 'border-foreground/10 bg-foreground/[0.03] hover:border-foreground/20 hover:bg-foreground/[0.06]'
              }`}
            >
              <span className="w-10 h-10 rounded-xl bg-foreground/[0.04] border border-foreground/[0.08] flex items-center justify-center">
                <span className="text-xs font-semibold tracking-wider text-foreground/70">
                  {lng.toUpperCase()}
                </span>
              </span>
              <div className="flex-1">
                <p className={`text-sm font-medium ${isActive ? 'text-accent' : 'text-foreground'}`}>
                  {info.native}
                </p>
                <p className="text-[10px] text-foreground/40 mt-0.5">
                  {info.english} {info.dir === 'rtl' && '· RTL'}
                </p>
              </div>
              {isActive && (
                <span className="w-6 h-6 rounded-full bg-accent flex items-center justify-center">
                  <span className="text-white text-xs">✓</span>
                </span>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}
