/**
 * Test setup for Bun.
 * Mocks necessary browser globals that are used in the application but
 * unavailable in the Node/Bun environment during testing.
 */

const eventListeners = new Map<string, Array<(...args: any[]) => void>>()
const dispatchWindowEvent = (event: Event) => {
  for (const listener of eventListeners.get(event.type) || []) {
    listener(event)
  }
}
;(globalThis as any).window = {
  location: {
    origin: 'http://backend.test',
    protocol: 'http:',
    pathname: '/',
    search: '',
    hash: ''
  },
  dispatchEvent: (event: Event) => { dispatchWindowEvent(event); return true },
  addEventListener: (type: string, listener: (...args: any[]) => void) => {
    eventListeners.set(type, [...(eventListeners.get(type) || []), listener])
  },
  removeEventListener: (type: string, listener: (...args: any[]) => void) => {
    eventListeners.set(type, (eventListeners.get(type) || []).filter((l) => l !== listener))
  },
  Event,
  CustomEvent,
  setTimeout: (fn: (...args: any[]) => void, ms?: number) => setTimeout(fn, ms),
  clearTimeout: (id?: any) => clearTimeout(id),
  setInterval: (fn: (...args: any[]) => void, ms?: number) => setInterval(fn, ms),
  clearInterval: (id?: any) => clearInterval(id),
};

// import.meta.env is partially supported by Bun, but we can ensure
// VITE_BACKEND_URL is set via process.env for the tests.
process.env.VITE_BACKEND_URL = 'http://backend.test';

// localStorage stub for preference tests (appOpenPrefs etc.).
const store = new Map<string, string>()
;(globalThis as any).localStorage = {
  getItem: (key: string) => store.has(key) ? store.get(key)! : null,
  setItem: (key: string, value: string) => { store.set(key, String(value)) },
  removeItem: (key: string) => { store.delete(key) },
  clear: () => { store.clear() },
  key: (index: number) => [...store.keys()][index] ?? null,
  get length() { return store.size },
}
