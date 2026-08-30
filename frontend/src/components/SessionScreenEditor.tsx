import { useRef, useState, type ChangeEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { ArrowsOutCardinal, GridFour, Magnet, Monitor, UploadSimple, X } from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'
import { RumahlMark } from '@/components/RumahlMark'
import { useLocalStorage } from '@/lib/storage'
import { LOCK_SCREEN_STYLES, type LockScreenStyle } from '@/lib/lockScreenStyles'
import { SESSION_CLOCK_FONT_STACKS, normalizeSessionScreenSettings, type SessionScreenElement, type SessionScreenSettings } from '@/lib/sessionScreenSettings'
import monsteraUrl from '../../../default_assets/images/backgrounds/MidnightMonstera.jpg'

interface Props { open: boolean; onClose: () => void; value: SessionScreenSettings; onChange: (value: SessionScreenSettings) => void }

export function SessionScreenEditor({ open, onClose, value, onChange }: Props) {
  const { t } = useTranslation(); const stageRef = useRef<HTMLDivElement>(null); const imageInputRef = useRef<HTMLInputElement>(null)
  const [target, setTarget] = useState<'lock' | 'login'>('lock'); const [selected, setSelected] = useState<SessionScreenElement>('clock')
  const [grid, setGrid] = useState(true); const [snap, setSnap] = useState(true); const [guides, setGuides] = useState<{ x: number; y: number } | null>(null)
  const [lockStyle, setLockStyle] = useLocalStorage<LockScreenStyle>('rumahl-lock-screen-style', 'midnight')
  const [customBackground, setCustomBackground] = useLocalStorage<string>('rumahl-lock-screen-custom-image', '')
  const settings = normalizeSessionScreenSettings(value)
  if (!open) return null
  const updateSettings = (patch: Partial<SessionScreenSettings>) => onChange({ ...settings, ...patch })
  const move = (element: SessionScreenElement, event: ReactPointerEvent<HTMLElement>) => {
    const stage = stageRef.current; if (!stage) return
    const update = (clientX: number, clientY: number) => { const rect = stage.getBoundingClientRect(); let x = Math.max(4, Math.min(96, ((clientX - rect.left) / rect.width) * 100)); let y = Math.max(5, Math.min(95, ((clientY - rect.top) / rect.height) * 100)); if (snap) { x = Math.round(x / 5) * 5; y = Math.round(y / 5) * 5 }; setGuides({ x, y }); onChange({ ...settings, positions: { ...settings.positions, [element]: { x, y } } }) }
    update(event.clientX, event.clientY)
    const onMove = (pointerEvent: PointerEvent) => update(pointerEvent.clientX, pointerEvent.clientY)
    const onUp = () => { setGuides(null); window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp) }
    window.addEventListener('pointermove', onMove); window.addEventListener('pointerup', onUp)
  }
  const chooseImage = (event: ChangeEvent<HTMLInputElement>) => { const file = event.target.files?.[0]; if (!file) return; const reader = new FileReader(); reader.onload = () => { if (typeof reader.result === 'string') { setCustomBackground(reader.result); setLockStyle('custom') } }; reader.readAsDataURL(file); event.target.value = '' }
  const place = (element: SessionScreenElement) => ({ left: `${settings.positions[element].x}%`, top: `${settings.positions[element].y}%` })
  const item = (element: SessionScreenElement, content: ReactNode) => <button type="button" className={`rumahl-session-editor-item rumahl-session-editor-item-${element} ${selected === element ? 'is-selected' : ''}`} style={place(element)} onPointerDown={(event) => { setSelected(element); move(element, event) }} aria-label={t(`settings.sessionElements.${element}`)}>{content}<ArrowsOutCardinal className="rumahl-session-editor-grip" size={14} /></button>
  const stageBackground = lockStyle === 'custom' && customBackground ? `linear-gradient(rgb(0 0 0 / .28), rgb(0 0 0 / .58)), url(${customBackground})` : lockStyle === 'monstera' ? `linear-gradient(rgb(0 0 0 / .3), rgb(0 0 0 / .62)), url(${monsteraUrl})` : undefined
  return <div className="rumahl-session-editor fixed inset-0 z-[10000] flex flex-col bg-[#08090d] text-white">
    <header><div><Monitor size={18} /><div><strong>{t('settings.sessionEditor')}</strong><span>{t('settings.sessionEditorHint')}</span></div></div><div className="rumahl-session-editor-target"><button className={target === 'lock' ? 'is-active' : ''} onClick={() => setTarget('lock')}>{t('settings.lockScreenStyle')}</button><button className={target === 'login' ? 'is-active' : ''} onClick={() => setTarget('login')}>{t('auth.login')}</button></div><div className="rumahl-session-editor-tools"><button className={grid ? 'is-active' : ''} onClick={() => setGrid(!grid)} title={t('settings.sessionGrid')}><GridFour size={17} /></button><button className={snap ? 'is-active' : ''} onClick={() => setSnap(!snap)} title={t('settings.sessionSnap')}><Magnet size={17} /></button><button onClick={onClose} aria-label={t('common.close')}><X size={20} /></button></div></header>
    <main className="rumahl-session-editor-workspace min-h-0 flex-1"><div className="rumahl-session-editor-canvas"><div ref={stageRef} className={`rumahl-session-editor-stage ${grid ? 'has-grid' : ''}`} data-target={target} data-style={lockStyle} data-clock-font={settings.clockFont} style={stageBackground ? { backgroundImage: stageBackground } : undefined}>
      {guides && <><i className="rumahl-session-guide-x" style={{ left: `${guides.x}%` }} /><i className="rumahl-session-guide-y" style={{ top: `${guides.y}%` }} /></>}
      {item('clock', <span style={{ fontFamily: SESSION_CLOCK_FONT_STACKS[settings.clockFont], fontSize: `calc(clamp(42px, 8vw, 92px) * ${settings.clockScale / 100})` }}>12:48</span>)}
      {settings.showDate && item('date', <span style={{ fontSize: `${settings.textScale / 100}rem` }}>{t('settings.sessionEditorDate')}</span>)}
      {settings.showStatusWidget && item('status', <span className="rumahl-session-status-widget">rumahl OS</span>)}
      {settings.showBrand && item('brand', <RumahlMark className="h-6 text-white/55" />)}
      <div className="rumahl-session-editor-auth">{target === 'login' ? <><span className="h-12 w-12 rounded-2xl bg-white/10" /><strong>rumahl OS</strong><small>{t('auth.loginSubtitle')}</small></> : <><span className="h-20 w-20 rounded-full bg-white/10" /><strong>{t('os.lock.sessionLocked')}</strong><small>{t('os.lock.unlock')}</small></>}</div>
    </div></div><aside className="rumahl-session-editor-inspector">
      <section><h2>{t('settings.lockScreenStyle')}</h2><div className="rumahl-session-editor-backgrounds">{LOCK_SCREEN_STYLES.map((style) => <button key={style} data-style={style} className={lockStyle === style ? 'is-active' : ''} onClick={() => setLockStyle(style)}><i /><span>{t(`os.lock.styles.${style}`)}</span></button>)}</div><input ref={imageInputRef} type="file" accept="image/*" hidden onChange={chooseImage} /><button className="rumahl-session-editor-upload" onClick={() => imageInputRef.current?.click()}><UploadSimple size={15} />{t('settings.lockScreenChooseImage')}</button></section>
      <section><h2>{t('settings.sessionElements.clock')}</h2><label>{t('settings.sessionClockSize')}<input type="range" min="70" max="150" value={settings.clockScale} onChange={(event) => updateSettings({ clockScale: Number(event.target.value) })} /></label><label>{t('settings.sessionTextSize')}<input type="range" min="80" max="130" value={settings.textScale} onChange={(event) => updateSettings({ textScale: Number(event.target.value) })} /></label><label>{t('settings.sessionClockFont')}<select value={settings.clockFont} onChange={(event) => updateSettings({ clockFont: event.target.value as SessionScreenSettings['clockFont'] })}>{(['rumahl', 'system', 'rounded', 'serif', 'mono'] as const).map((font) => <option key={font} value={font}>{t(`settings.sessionFonts.${font}`)}</option>)}</select></label><p className="rumahl-session-font-note">{t('settings.rumahlSansHint')}</p></section>
      <section><h2>{t('settings.sessionWidgets')}</h2>{([['showDate', 'sessionWidgetDate'], ['showBrand', 'sessionWidgetBrand'], ['showStatusWidget', 'sessionWidgetStatus']] as const).map(([key, label]) => <label className="rumahl-session-editor-check" key={key}><input type="checkbox" checked={settings[key]} onChange={(event) => updateSettings({ [key]: event.target.checked })} /><span>{t(`settings.${label}`)}</span></label>)}</section>
    </aside></main>
  </div>
}
