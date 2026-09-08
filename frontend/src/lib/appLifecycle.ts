/**
 * App lifecycle helpers — UmbrelOS-style start with status watching.
 *
 * A successful `POST /start` only means the supervisor accepted the request;
 * the container can still fail to come up afterwards. This helper polls the
 * supervisor until the app is running and surfaces a failure (status
 * "error"/"failed" with `error_message`) as a toast instead of leaving it in
 * the install/status logs only.
 */
import { authFetch } from '@/lib/authHelpers'
import i18n from '@/i18n'
import { toast } from '@/lib/toast'

const START_POLL_INTERVAL_MS = 2500
/** ~60 s of polling before we give up (start may legitimately take a while). */
const START_POLL_ATTEMPTS = 24

export interface StartWatchResult {
  ok: boolean
  /** True when the supervisor reported a failed container start. */
  failed?: boolean
  message?: string | null
}

/** Fetch the supervisor's app snapshot (latest state, best effort). */
async function fetchSupervisorApps(): Promise<Array<{ id: string; status?: string; error_message?: string | null }>> {
  const res = await authFetch('/api/supervisor/apps')
  if (!res.ok) return []
  const data = await res.json().catch(() => null) as { apps?: Array<{ id: string; status?: string; error_message?: string | null }> } | null
  return data?.apps || []
}

/**
 * Start an app and watch until it is running (or failed).
 * Errors — both request-level and the asynchronous container failure — are
 * shown as toasts; the result is returned for callers that need it.
 */
export async function startAppAndWatch(
  appId: string,
  opts?: { onSettled?: (result: StartWatchResult) => void },
): Promise<StartWatchResult> {
  const fail = (message: string, failed?: boolean): StartWatchResult => {
    const result: StartWatchResult = { ok: false, failed, message }
    toast.error(i18n.t('os.quickActions.actionFailed', { detail: message }))
    opts?.onSettled?.(result)
    return result
  }

  try {
    const res = await authFetch(`/api/supervisor/apps/${appId}/start`, { method: 'POST' })
    if (!res.ok) {
      const data = await res.json().catch(() => null) as { error?: string; message?: string } | null
      return fail(data?.error || data?.message || `HTTP ${res.status}`)
    }
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e))
  }

  // Poll the runtime state — a started container may still crash on boot.
  for (let attempt = 0; attempt < START_POLL_ATTEMPTS; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, START_POLL_INTERVAL_MS))
    try {
      const apps = await fetchSupervisorApps()
      const app = apps.find((candidate) => candidate.id === appId)
      if (!app) continue
      if (app.status === 'running') {
        const result: StartWatchResult = { ok: true }
        opts?.onSettled?.(result)
        return result
      }
      if (app.status === 'error' || app.status === 'failed') {
        return fail(app.error_message || i18n.t('apps.appStore.installFailedUnknown'), true)
      }
    } catch {
      // Backend unreachable — keep polling; the next attempt may recover.
    }
  }

  // No terminal state within the window: not a confirmed failure.
  const result: StartWatchResult = { ok: true }
  opts?.onSettled?.(result)
  return result
}
