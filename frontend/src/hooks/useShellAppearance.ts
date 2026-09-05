import { useEffect } from 'react'
import { useLocalStorage } from '@/lib/storage'

export const DEFAULT_SHELL_APPEARANCE = { material: 'solid', contrast: 'auto', border: true, blur: 20 }

export function normalizeShellAppearance(value: unknown) {
  const stored = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  return {
    material: ['solid', 'glass', 'transparent'].includes(String(stored.material)) ? String(stored.material) : 'solid',
    contrast: ['auto', 'light', 'dark'].includes(String(stored.contrast)) ? String(stored.contrast) : 'auto',
    border: typeof stored.border === 'boolean' ? stored.border : true,
    blur: typeof stored.blur === 'number' && Number.isFinite(stored.blur) ? Math.max(0, Math.min(40, stored.blur)) : 20,
  }
}

export function useShellAppearance() {
  const [stored, save] = useLocalStorage('rumahl-shell-appearance', DEFAULT_SHELL_APPEARANCE)
  const settings = normalizeShellAppearance(stored)
  const { material, contrast, border, blur } = settings
  useEffect(() => {
    const root = document.documentElement
    root.dataset.barMaterial = material
    root.dataset.barContrast = contrast
    root.dataset.barBorder = String(border)
    root.style.setProperty('--shell-bar-blur', `${blur}px`)
  }, [material, contrast, border, blur])
  return { settings, save, reset: () => save(DEFAULT_SHELL_APPEARANCE) }
}
