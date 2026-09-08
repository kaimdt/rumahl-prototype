import { authFetch } from '@/lib/authHelpers'

const DATABASE_NAME = 'rumahl-os-runtime'
const DATABASE_VERSION = 1
const STORE_NAME = 'offline-mutations'
const SYNC_TAG = 'rumahl-os-settings-sync'

interface OfflineMutation {
  id: string
  path: string
  body: string
  createdAt: number
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION)
    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains(STORE_NAME)) database.createObjectStore(STORE_NAME, { keyPath: 'id' })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function runStore<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const database = await openDatabase()
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, mode)
    const request = action(transaction.objectStore(STORE_NAME))
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
    transaction.oncomplete = () => database.close()
  })
}

async function requestBackgroundSync() {
  if (!('serviceWorker' in navigator)) return
  try {
    const registration = await navigator.serviceWorker.ready
    const syncManager = (registration as ServiceWorkerRegistration & { sync?: { register(tag: string): Promise<void> } }).sync
    await syncManager?.register(SYNC_TAG)
  } catch { /* Online and visibility events remain available as fallback. */ }
}

export async function queueOfflineMutation(id: string, path: string, body: string) {
  if (!('indexedDB' in window)) return
  await runStore('readwrite', (store) => store.put({ id, path, body, createdAt: Date.now() } satisfies OfflineMutation))
  await requestBackgroundSync()
}

export async function flushOfflineMutations() {
  if (!navigator.onLine || !('indexedDB' in window)) return
  const mutations = await runStore<OfflineMutation[]>('readonly', (store) => store.getAll())
  for (const mutation of mutations.sort((left, right) => left.createdAt - right.createdAt)) {
    try {
      const response = await authFetch(mutation.path, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: mutation.body,
      })
      if (response.ok) await runStore('readwrite', (store) => store.delete(mutation.id))
      else if (response.status >= 400 && response.status < 500 && ![408, 425, 429].includes(response.status)) {
        // Invalid or unauthorized requests must not retry forever.
        await runStore('readwrite', (store) => store.delete(mutation.id))
      } else break
    } catch { break }
  }
}

export function initializeOfflineMutationQueue() {
  const flush = () => { void flushOfflineMutations() }
  window.addEventListener('online', flush)
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') flush() })
  navigator.serviceWorker?.addEventListener('message', (event) => {
    if (event.data?.type === 'FLUSH_OFFLINE_MUTATIONS') flush()
  })
  flush()
}
