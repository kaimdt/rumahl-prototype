export const LOCK_SCREEN_STYLES = ['midnight', 'monstera', 'halo', 'minimal', 'orbit-3d', 'custom'] as const
export type LockScreenStyle = typeof LOCK_SCREEN_STYLES[number]

export function isLockScreenStyle(value: unknown): value is LockScreenStyle {
  return typeof value === 'string' && LOCK_SCREEN_STYLES.includes(value as LockScreenStyle)
}
