import { describe, expect, test } from 'bun:test'
import { House } from '@phosphor-icons/react'
import { buildLauncherItems, type LauncherFolder } from './LauncherAppGrid'
import type { OsAppDefinition } from '@/lib/osAppRegistry'

const apps: OsAppDefinition[] = ['home', 'settings', 'files'].map((id, order) => ({
  id,
  pageId: id,
  fallbackName: id,
  icon: House,
  kind: 'system',
  accent: 'blue',
  order,
}))

describe('buildLauncherItems', () => {
  test('groups available apps and leaves ungrouped apps on the homescreen', () => {
    const folders: LauncherFolder[] = [{ id: 'system', name: 'System', appIds: ['settings', 'files'] }]
    const items = buildLauncherItems(apps, folders)

    expect(items.map((item) => item.type)).toEqual(['folder', 'app'])
    expect(items[0].type === 'folder' && items[0].folder.appIds).toEqual(['settings', 'files'])
    expect(items[1].type === 'app' && items[1].app.id).toBe('home')
  })

  test('removes unavailable apps and empty folders from the rendered layout', () => {
    const folders: LauncherFolder[] = [
      { id: 'stale', name: 'Stale', appIds: ['missing'] },
      { id: 'mixed', name: 'Mixed', appIds: ['home', 'missing'] },
    ]
    const items = buildLauncherItems(apps, folders)

    expect(items[0].type === 'folder' && items[0].folder.appIds).toEqual(['home'])
    expect(items).toHaveLength(3)
  })
})
