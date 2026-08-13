import { describe, expect, test } from 'bun:test'
import {
  appRoute,
  healthFromRuntime,
  lifecycleFromRuntime,
  normalizeRuntimeState,
  resolveAppRuntime,
} from './appSystem'

describe('canonical app lifecycle', () => {
  test('normalizes backend aliases without leaking backend vocabulary', () => {
    expect(normalizeRuntimeState('healthy')).toBe('running')
    expect(normalizeRuntimeState('restarting')).toBe('starting')
    expect(normalizeRuntimeState('dead')).toBe('failed')
    expect(normalizeRuntimeState('exited')).toBe('stopped')
  })

  test('derives lifecycle and health consistently', () => {
    expect(lifecycleFromRuntime('unhealthy')).toBe('failed')
    expect(healthFromRuntime('unhealthy')).toBe('unhealthy')
    expect(lifecycleFromRuntime('running')).toBe('running')
    expect(healthFromRuntime('running')).toBe('healthy')
  })
})

describe('app runtime resolution', () => {
  test('uses canonical encoded app routes', () => {
    expect(appRoute('my app')).toBe('/app/my%20app')
  })

  test('keeps external apps outside the embedded runtime', () => {
    expect(resolveAppRuntime({
      id: 'external',
      route: '/app/external',
      runtimeKind: 'external',
      runtimeUrl: 'https://example.test',
    })).toEqual({
      kind: 'external',
      route: '/app/external',
      url: 'https://example.test',
      embedded: false,
    })
  })
})
