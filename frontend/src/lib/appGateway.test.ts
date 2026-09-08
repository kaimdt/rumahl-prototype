import { describe, expect, test } from 'bun:test'
import {
  appRuntimeUrl,
  desktopHostOf,
  iframeAllowFor,
  iframeSandboxFor,
  STRICT_SANDBOX_TOKENS,
  type AppDisplayConfig,
} from '@/lib/appGateway'

const realLocation = globalThis.location

describe('appRuntimeUrl', () => {
  test('builds the app subdomain URL on a real desktop host', () => {
    const url = appRuntimeUrl('nextcloud', { scheme: 'https', host: 'rumahl.local', port: '443' })
    expect(url).toBe('https://nextcloud.apps.rumahl.local/')
  })

  test('keeps a non-default port', () => {
    const url = appRuntimeUrl('files', { scheme: 'http', host: 'rumahl.local', port: '3001' })
    expect(url).toBe('http://files.apps.rumahl.local:3001/')
  })

  test('drops the default port for the scheme', () => {
    const url = appRuntimeUrl('files', { scheme: 'https', host: 'rumahl.local', port: '443' })
    expect(url).toBe('https://files.apps.rumahl.local/')
  })

  test('returns null on loopback hosts (dev fallback)', () => {
    expect(appRuntimeUrl('nextcloud', { scheme: 'http', host: 'localhost', port: '3001' })).toBeNull()
    expect(appRuntimeUrl('nextcloud', { scheme: 'http', host: '127.0.0.1', port: '3001' })).toBeNull()
    expect(appRuntimeUrl('nextcloud', { scheme: 'http', host: '::1', port: '3001' })).toBeNull()
  })

  test('supports a custom suffix', () => {
    const url = appRuntimeUrl('grafana', { scheme: 'http', host: 'myhost.lan', port: '80' })
    // uses the configured VITE_APPS_HOST_SUFFIX (default .apps.rumahl.local)
    expect(url).toBe('http://grafana.apps.rumahl.local/')
  })
})

describe('desktopHostOf', () => {
  test('strips the app prefix and apps root', () => {
    expect(desktopHostOf('nextcloud.apps.rumahl.local')).toBe('rumahl.local')
  })

  test('returns unrelated hosts unchanged', () => {
    expect(desktopHostOf('example.com')).toBe('example.com')
    expect(desktopHostOf('apps.rumahl.local')).toBe('apps.rumahl.local')
  })
})

describe('iframeAllowFor', () => {
  test('maps manifest permissions to allow tokens', () => {
    const display: AppDisplayConfig = {
      permissions: ['clipboard-write', 'fullscreen', 'camera', 'unknown-thing'],
    }
    const allow = iframeAllowFor(display)
    expect(allow).toContain('clipboard-write')
    expect(allow).toContain('fullscreen')
    expect(allow).toContain('camera')
    expect(allow).not.toContain('unknown-thing')
  })

  test('restrictive by default — no privileged APIs without a manifest', () => {
    expect(iframeAllowFor(null)).toBe('')
    expect(iframeAllowFor({})).toBe('')
  })

  test('deduplicates tokens', () => {
    const allow = iframeAllowFor({ permissions: ['fullscreen', 'FULLSCREEN', 'clipboard-write', 'clipboard-write'] })
    expect(allow.split('; ').filter(Boolean)).toEqual(['fullscreen', 'clipboard-write'])
  })
})

describe('iframeSandboxFor', () => {
  test('no sandbox by default (separate origin is the isolation boundary)', () => {
    expect(iframeSandboxFor(null)).toBeUndefined()
    expect(iframeSandboxFor({})).toBeUndefined()
    expect(iframeSandboxFor({ isolation: 'relaxed' })).toBeUndefined()
  })

  test('strict isolation maps to the defined rumahl policy', () => {
    const sandbox = iframeSandboxFor({ isolation: 'strict' })
    expect(sandbox).toBe(STRICT_SANDBOX_TOKENS.join(' '))
    expect(sandbox).toContain('allow-scripts')
    expect(sandbox).toContain('allow-same-origin')
    // No blanket privilege grants.
    expect(sandbox).not.toContain('allow-top-navigation')
  })

  test('explicit sandbox tokens override the strict default', () => {
    expect(iframeSandboxFor({ sandbox: ['allow-scripts'] })).toBe('allow-scripts')
  })
})
