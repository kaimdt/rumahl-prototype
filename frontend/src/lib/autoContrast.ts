/**
 * Auto-Contrast utility
 *
 * Patches text colors at runtime to maintain WCAG 2.1 AA contrast (4.5:1) on
 * glass-style surfaces and custom themes. Replacement colors are derived from
 * the active theme's `--foreground` / `--background` CSS custom properties so
 * custom themes are honoured automatically.
 *
 * ─── Modes ───────────────────────────────────────────────────────────────
 *   off       — system disabled, all patches removed
 *   light     — scans only on explicit triggers (theme change, route nav,
 *               window resize), no MutationObserver, no per-frame work
 *   balanced  — IntersectionObserver collects only on-screen elements; debounced
 *               scan ~250 ms after DOM/style mutations
 *   full      — eager: every DOM mutation schedules a full document scan at
 *               the next animation frame
 *   auto      — pick `light` / `balanced` / `full` based on detected device tier
 *
 * ─── Persistence ─────────────────────────────────────────────────────────
 *   Global default: localStorage['iora-auto-contrast']
 *   Per-user override (preferred when a user is bound):
 *     localStorage['iora-auto-contrast:user:<userId>']
 *
 * ─── Opt-out per subtree ─────────────────────────────────────────────────
 *   Any ancestor with `data-auto-contrast="false"` excludes its subtree.
 */

export type AutoContrastMode = 'off' | 'light' | 'balanced' | 'full' | 'auto'
export type DeviceTier = 'low' | 'mid' | 'high'

type RGBA = { r: number; g: number; b: number; a: number }

const TRANSPARENT: RGBA = { r: 0, g: 0, b: 0, a: 0 }
const FALLBACK_LIGHT: RGBA = { r: 250, g: 250, b: 250, a: 1 }
const FALLBACK_DARK: RGBA = { r: 17, g: 17, b: 19, a: 1 }

const MIN_CONTRAST = 4.5
const GLOBAL_KEY = 'iora-auto-contrast'
const USER_KEY_PREFIX = 'iora-auto-contrast:user:'
const PATCHED_ATTR = 'data-ac-patched'
const ORIGINAL_ATTR = 'data-ac-original'
const OPT_OUT_ATTR = 'data-auto-contrast'

// ───────────────────────────── color parsing ─────────────────────────────

function parseColor(input: string): RGBA {
  if (!input) return TRANSPARENT
  const s = input.trim().toLowerCase()
  if (s === 'transparent' || s === 'rgba(0, 0, 0, 0)') return TRANSPARENT

  const m = s.match(/^rgba?\(([^)]+)\)$/)
  if (m) {
    const parts = m[1].split(/[,\s/]+/).filter(Boolean)
    const r = Number(parts[0])
    const g = Number(parts[1])
    const b = Number(parts[2])
    const a = parts[3] !== undefined ? Number(parts[3]) : 1
    if ([r, g, b].some(Number.isNaN)) return TRANSPARENT
    return { r, g, b, a: Number.isNaN(a) ? 1 : a }
  }
  const h = s.match(/^hsla?\(([^)]+)\)$/)
  if (h) return hslToRgb(h[1])
  if (s.startsWith('#')) {
    const hex = s.slice(1)
    const norm = hex.length === 3 ? hex.split('').map((c) => c + c).join('') : hex
    if (norm.length === 6) {
      return {
        r: parseInt(norm.slice(0, 2), 16),
        g: parseInt(norm.slice(2, 4), 16),
        b: parseInt(norm.slice(4, 6), 16),
        a: 1,
      }
    }
  }
  return TRANSPARENT
}

function hslToRgb(spec: string): RGBA {
  const parts = spec.split(/[,\s/]+/).filter(Boolean)
  const h = parseFloat(parts[0])
  const s = parseFloat(parts[1]) / 100
  const l = parseFloat(parts[2]) / 100
  const a = parts[3] !== undefined ? parseFloat(parts[3]) : 1
  if ([h, s, l].some(Number.isNaN)) return TRANSPARENT
  const c = (1 - Math.abs(2 * l - 1)) * s
  const hp = h / 60
  const x = c * (1 - Math.abs((hp % 2) - 1))
  let r1 = 0, g1 = 0, b1 = 0
  if (hp >= 0 && hp < 1) { r1 = c; g1 = x }
  else if (hp < 2) { r1 = x; g1 = c }
  else if (hp < 3) { g1 = c; b1 = x }
  else if (hp < 4) { g1 = x; b1 = c }
  else if (hp < 5) { r1 = x; b1 = c }
  else { r1 = c; b1 = x }
  const m = l - c / 2
  return {
    r: Math.round((r1 + m) * 255),
    g: Math.round((g1 + m) * 255),
    b: Math.round((b1 + m) * 255),
    a: Number.isNaN(a) ? 1 : a,
  }
}

// ─────────────────────────── compositing & WCAG ──────────────────────────

function composite(top: RGBA, bottom: RGBA): RGBA {
  const a = top.a + bottom.a * (1 - top.a)
  if (a <= 0) return TRANSPARENT
  return {
    r: (top.r * top.a + bottom.r * bottom.a * (1 - top.a)) / a,
    g: (top.g * top.a + bottom.g * bottom.a * (1 - top.a)) / a,
    b: (top.b * top.a + bottom.b * bottom.a * (1 - top.a)) / a,
    a,
  }
}

function relativeLuminance({ r, g, b }: RGBA): number {
  const channel = (v: number) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

function contrastRatio(a: RGBA, b: RGBA): number {
  const la = relativeLuminance(a)
  const lb = relativeLuminance(b)
  const [light, dark] = la > lb ? [la, lb] : [lb, la]
  return (light + 0.05) / (dark + 0.05)
}

function getEffectiveBackground(el: Element): RGBA {
  const stack: RGBA[] = []
  let node: Element | null = el
  while (node) {
    const cs = getComputedStyle(node)
    const bg = parseColor(cs.backgroundColor)
    if (bg.a > 0) stack.push(bg)
    if (bg.a >= 0.999) break
    node = node.parentElement
  }
  if (stack.length === 0 || stack[stack.length - 1].a < 0.999) {
    const rootBg = parseColor(getComputedStyle(document.body).backgroundColor)
    stack.push(rootBg.a > 0 ? { ...rootBg, a: 1 } : { r: 255, g: 255, b: 255, a: 1 })
  }
  let composed = stack[stack.length - 1]
  for (let i = stack.length - 2; i >= 0; i--) composed = composite(stack[i], composed)
  return composed
}

// ─────────────────────── theme-aware target derivation ───────────────────

let cachedLightCss = `rgb(${FALLBACK_LIGHT.r}, ${FALLBACK_LIGHT.g}, ${FALLBACK_LIGHT.b})`
let cachedDarkCss = `rgb(${FALLBACK_DARK.r}, ${FALLBACK_DARK.g}, ${FALLBACK_DARK.b})`
let cachedLight: RGBA = FALLBACK_LIGHT
let cachedDark: RGBA = FALLBACK_DARK

function tryParseVar(value: string): RGBA {
  if (!value) return TRANSPARENT
  const direct = parseColor(value)
  if (direct.a > 0) return direct
  const hsl = parseColor(`hsl(${value})`)
  if (hsl.a > 0) return hsl
  return TRANSPARENT
}

function refreshThemePoles() {
  const rootStyle = getComputedStyle(document.documentElement)
  const bodyStyle = getComputedStyle(document.body)

  const fg = parseColor(bodyStyle.color)
  const bg = parseColor(bodyStyle.backgroundColor)

  const fgFromVar = tryParseVar(rootStyle.getPropertyValue('--foreground').trim())
  const bgFromVar = tryParseVar(rootStyle.getPropertyValue('--background').trim())

  const foreground = fg.a > 0 ? fg : (fgFromVar.a > 0 ? fgFromVar : FALLBACK_LIGHT)
  const background = bg.a > 0 ? bg : (bgFromVar.a > 0 ? bgFromVar : FALLBACK_DARK)

  if (relativeLuminance(foreground) >= relativeLuminance(background)) {
    cachedLight = { ...foreground, a: 1 }
    cachedDark = { ...background, a: 1 }
  } else {
    cachedLight = { ...background, a: 1 }
    cachedDark = { ...foreground, a: 1 }
  }
  cachedLightCss = `rgb(${Math.round(cachedLight.r)}, ${Math.round(cachedLight.g)}, ${Math.round(cachedLight.b)})`
  cachedDarkCss = `rgb(${Math.round(cachedDark.r)}, ${Math.round(cachedDark.g)}, ${Math.round(cachedDark.b)})`
}

// ───────────────────────────── patching logic ────────────────────────────

function isOptedOut(el: Element): boolean {
  let node: Element | null = el
  while (node) {
    const v = node.getAttribute(OPT_OUT_ATTR)
    if (v === 'false' || v === 'off' || v === 'disabled') return true
    node = node.parentElement
  }
  return false
}

function hasOwnText(el: Element): boolean {
  for (const node of Array.from(el.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE && node.textContent && node.textContent.trim()) {
      return true
    }
  }
  return false
}

function restore(el: HTMLElement) {
  const original = el.getAttribute(ORIGINAL_ATTR)
  if (original === null) return
  if (original) el.style.color = original
  else el.style.removeProperty('color')
  el.removeAttribute(ORIGINAL_ATTR)
  el.removeAttribute(PATCHED_ATTR)
}

function patchElement(el: HTMLElement) {
  if (!hasOwnText(el)) return
  if (isOptedOut(el)) {
    restore(el)
    return
  }
  const cs = getComputedStyle(el)
  if (cs.visibility === 'hidden' || cs.display === 'none') return

  const current = parseColor(cs.color)
  if (current.a === 0) return

  const bg = getEffectiveBackground(el)
  const perceived = composite(current, bg)
  const ratio = contrastRatio(perceived, bg)

  if (ratio >= MIN_CONTRAST) { restore(el); return }

  const lightRatio = contrastRatio(cachedLight, bg)
  const darkRatio = contrastRatio(cachedDark, bg)
  const target = lightRatio >= darkRatio ? cachedLightCss : cachedDarkCss

  if (el.getAttribute(PATCHED_ATTR) === target) return
  if (!el.hasAttribute(ORIGINAL_ATTR)) {
    el.setAttribute(ORIGINAL_ATTR, el.style.color || '')
  }
  el.style.color = target
  el.setAttribute(PATCHED_ATTR, target)
}

function restoreAll() {
  const patched = document.querySelectorAll<HTMLElement>(`[${PATCHED_ATTR}]`)
  patched.forEach(restore)
}

function scanAll() {
  refreshThemePoles()
  const all = document.body.querySelectorAll<HTMLElement>('*')
  for (const el of Array.from(all)) patchElement(el)
}

function scanVisible() {
  refreshThemePoles()
  for (const el of Array.from(visibleElements)) patchElement(el)
}

// ─────────────────── device-tier detection (auto mode) ───────────────────

let detectedTier: DeviceTier = 'mid'

function detectDeviceTier(): DeviceTier {
  if (typeof window === 'undefined') return 'mid'
  const nav: any = navigator
  const cores = typeof nav.hardwareConcurrency === 'number' ? nav.hardwareConcurrency : 4
  const mem = typeof nav.deviceMemory === 'number' ? nav.deviceMemory : 4
  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  const saveData = nav.connection?.saveData === true
  const conn = nav.connection?.effectiveType as string | undefined
  const slowConn = conn === 'slow-2g' || conn === '2g'

  if (reducedMotion || saveData || slowConn || cores <= 2 || mem <= 2) return 'low'
  if (cores >= 8 && mem >= 8) return 'high'
  return 'mid'
}

function resolveMode(mode: AutoContrastMode): Exclude<AutoContrastMode, 'auto'> {
  if (mode !== 'auto') return mode
  switch (detectedTier) {
    case 'low': return 'light'
    case 'high': return 'full'
    default: return 'balanced'
  }
}

// ───────────────────────────── lifecycle ─────────────────────────────────

let installed = false
let userMode: AutoContrastMode = 'auto'
let currentUserId: string | null = null

let mutationObserver: MutationObserver | null = null
let intersectionObserver: IntersectionObserver | null = null
const visibleElements = new Set<HTMLElement>()
let debounceTimer: number | null = null
let rafHandle: number | null = null

const listeners = new Set<(mode: AutoContrastMode) => void>()

function clearTimers() {
  if (debounceTimer !== null) { clearTimeout(debounceTimer); debounceTimer = null }
  if (rafHandle !== null) { cancelAnimationFrame(rafHandle); rafHandle = null }
}

function stopMutationObserver() {
  if (!mutationObserver) return
  mutationObserver.disconnect()
  mutationObserver = null
}

function stopIntersectionObserver() {
  if (!intersectionObserver) return
  intersectionObserver.disconnect()
  intersectionObserver = null
  visibleElements.clear()
}

function teardownAll() {
  clearTimers()
  stopMutationObserver()
  stopIntersectionObserver()
}

function scheduleEager() {
  if (rafHandle !== null) return
  rafHandle = requestAnimationFrame(() => {
    rafHandle = null
    scanAll()
  })
}

function scheduleDebounced(delay: number, target: 'all' | 'visible') {
  if (debounceTimer !== null) clearTimeout(debounceTimer)
  debounceTimer = window.setTimeout(() => {
    debounceTimer = null
    if (target === 'visible') scanVisible(); else scanAll()
  }, delay)
}

function buildMutationObserver(onMutation: () => void) {
  stopMutationObserver()
  mutationObserver = new MutationObserver((mutations) => {
    for (const m of mutations) {
      if (
        m.type === 'attributes' &&
        (m.attributeName === 'class' ||
          m.attributeName === 'style' ||
          m.attributeName === OPT_OUT_ATTR ||
          m.attributeName === 'data-theme')
      ) {
        onMutation()
        return
      }
      if (m.type === 'childList' && (m.addedNodes.length || m.removedNodes.length)) {
        onMutation()
        return
      }
    }
  })
  mutationObserver.observe(document.body, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['class', 'style', OPT_OUT_ATTR, 'data-theme'],
  })
}

function buildIntersectionObserver() {
  stopIntersectionObserver()
  intersectionObserver = new IntersectionObserver((entries) => {
    let changed = false
    for (const e of entries) {
      const el = e.target as HTMLElement
      if (e.isIntersecting) {
        if (!visibleElements.has(el)) { visibleElements.add(el); changed = true }
      } else if (visibleElements.delete(el)) {
        changed = true
        restore(el)
      }
    }
    if (changed) scheduleDebounced(150, 'visible')
  }, { rootMargin: '64px' })

  // Observe every text-bearing element; new ones get observed via mutation hook.
  const all = document.body.querySelectorAll<HTMLElement>('*')
  for (const el of Array.from(all)) {
    if (hasOwnText(el)) intersectionObserver.observe(el)
  }
}

function applyMode(mode: AutoContrastMode) {
  teardownAll()
  restoreAll()

  const effective = resolveMode(mode)
  if (effective === 'off') return

  if (effective === 'light') {
    // No observers — react only to explicit signals (theme/resize/route).
    scheduleDebounced(0, 'all')
    return
  }

  if (effective === 'full') {
    buildMutationObserver(scheduleEager)
    scheduleEager()
    return
  }

  // balanced
  buildIntersectionObserver()
  buildMutationObserver(() => {
    // Re-observe newly added text nodes after each mutation burst.
    if (intersectionObserver) {
      const all = document.body.querySelectorAll<HTMLElement>('*')
      for (const el of Array.from(all)) {
        if (hasOwnText(el) && !visibleElements.has(el)) intersectionObserver.observe(el)
      }
    }
    scheduleDebounced(250, 'visible')
  })
  scheduleDebounced(0, 'visible')
}

// ─────────────────────────── storage helpers ─────────────────────────────

function readStorageMode(key: string): AutoContrastMode | null {
  try {
    const v = localStorage.getItem(key)
    if (v === null) return null
    if (v === 'true' || v === '1') return 'auto'   // legacy boolean
    if (v === 'false' || v === '0') return 'off'   // legacy boolean
    if (v === 'off' || v === 'light' || v === 'balanced' || v === 'full' || v === 'auto') {
      return v
    }
    return null
  } catch { return null }
}

function writeStorageMode(key: string, mode: AutoContrastMode) {
  try { localStorage.setItem(key, mode) } catch { /* ignore */ }
}

function effectiveStorageKey(): string {
  return currentUserId ? `${USER_KEY_PREFIX}${currentUserId}` : GLOBAL_KEY
}

function loadMode(): AutoContrastMode {
  const perUser = currentUserId ? readStorageMode(`${USER_KEY_PREFIX}${currentUserId}`) : null
  if (perUser) return perUser
  return readStorageMode(GLOBAL_KEY) ?? 'auto'
}

// ───────────────────────────── public API ────────────────────────────────

/** Install the global auto-contrast watcher. Idempotent. */
export function initAutoContrast() {
  if (installed || typeof window === 'undefined') return
  installed = true
  detectedTier = detectDeviceTier()
  userMode = loadMode()
  applyMode(userMode)

  // Light mode + general triggers: re-scan on resize/theme change/route nav.
  const trigger = () => {
    const eff = resolveMode(userMode)
    if (eff === 'off') return
    if (eff === 'light' || eff === 'balanced') {
      scheduleDebounced(eff === 'light' ? 0 : 150, eff === 'light' ? 'all' : 'visible')
    } else {
      scheduleEager()
    }
  }
  window.addEventListener('resize', trigger, { passive: true })
  window.addEventListener('themechange', trigger as EventListener)
  window.addEventListener('iora:theme-changed', trigger as EventListener)
  window.addEventListener('popstate', trigger)
}

/** Current mode (as stored — may be 'auto'). */
export function getAutoContrastMode(): AutoContrastMode {
  return userMode
}

/** The mode actually applied after resolving 'auto' against device tier. */
export function getEffectiveAutoContrastMode(): Exclude<AutoContrastMode, 'auto'> {
  return resolveMode(userMode)
}

/** Detected device performance tier. */
export function getDeviceTier(): DeviceTier {
  if (!installed) detectedTier = detectDeviceTier()
  return detectedTier
}

/** Convenience boolean. */
export function isAutoContrastEnabled(): boolean {
  return resolveMode(userMode) !== 'off'
}

/**
 * Bind the system to a specific user. Pass null to fall back to the global
 * default. Re-reads stored mode for that user and re-applies.
 */
export function setAutoContrastUser(userId: string | null) {
  if (userId === currentUserId) return
  currentUserId = userId
  const newMode = loadMode()
  if (newMode !== userMode) {
    userMode = newMode
    applyMode(userMode)
    listeners.forEach((fn) => { try { fn(userMode) } catch { /* ignore */ } })
  }
}

/** Set + persist mode for the currently bound user (or global default). */
export function setAutoContrastMode(mode: AutoContrastMode) {
  if (mode === userMode) return
  userMode = mode
  writeStorageMode(effectiveStorageKey(), mode)
  // Also mirror to the global key when no user is bound, so device-wide
  // defaults stay consistent across logouts.
  if (!currentUserId) writeStorageMode(GLOBAL_KEY, mode)
  applyMode(userMode)
  listeners.forEach((fn) => { try { fn(userMode) } catch { /* ignore */ } })
}

/** Legacy boolean toggle helper. */
export function setAutoContrastEnabled(v: boolean) {
  setAutoContrastMode(v ? 'auto' : 'off')
}

/** Subscribe to mode changes. Returns an unsubscribe function. */
export function subscribeAutoContrast(fn: (mode: AutoContrastMode) => void): () => void {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

/** Force an immediate re-evaluation. */
export function refreshAutoContrast() {
  const eff = resolveMode(userMode)
  if (eff === 'off') return
  if (eff === 'full') scheduleEager()
  else scheduleDebounced(0, eff === 'light' ? 'all' : 'visible')
}
