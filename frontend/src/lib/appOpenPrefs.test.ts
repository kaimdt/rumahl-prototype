import { beforeEach, describe, expect, test } from 'bun:test'
import { isAppOpenExternal, setAppOpenExternal } from '@/lib/appOpenPrefs'

beforeEach(() => {
  localStorage.clear()
})

describe('appOpenPrefs', () => {
  test('defaults to embedded (external = false)', () => {
    expect(isAppOpenExternal('nextcloud')).toBe(false)
  })

  test('toggle persists per app', () => {
    setAppOpenExternal('nextcloud', true)
    expect(isAppOpenExternal('nextcloud')).toBe(true)
    expect(isAppOpenExternal('jellyfin')).toBe(false)
    setAppOpenExternal('nextcloud', false)
    expect(isAppOpenExternal('nextcloud')).toBe(false)
  })
})
