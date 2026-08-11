import { describe, expect, test } from 'bun:test'
import { normalizeInstallJob } from './useInstalledApps'

describe('install job normalization', () => {
  test('maps the backend snake_case payload used by the local app store', () => {
    expect(normalizeInstallJob({
      id: 'job-1',
      app_id: 'nextcloud',
      app_name: 'Nextcloud',
      status: 'extracting',
      progress: 42,
    })).toMatchObject({
      id: 'job-1',
      appId: 'nextcloud',
      appName: 'Nextcloud',
      status: 'extracting',
      progress: 42,
    })
  })

  test('clamps malformed progress values before rendering a progress ring', () => {
    expect(normalizeInstallJob({ id: 'job-2', status: 'installing', progress: 180 }).progress).toBe(100)
    expect(normalizeInstallJob({ id: 'job-3', status: 'pending', progress: -2 }).progress).toBe(0)
  })
})
