import type { EntityState } from '@/lib/types'
import { wsSend } from '@/lib/wsConnection'

import { getBackendUrl } from '@/lib/config'
const apiBase = () => getBackendUrl() || ''

class HomeAssistantService {
  private generateIntent(): string {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  }

  private getToken(): string {
    const raw = localStorage.getItem('ha-auth-token') ?? sessionStorage.getItem('ha-auth-token')
    if (!raw) return ''
    try {
      // useLocalStorage stores values via JSON.stringify, so parse to unwrap quotes
      const parsed = JSON.parse(raw)
      return typeof parsed === 'string' ? parsed : ''
    } catch {
      return raw
    }
  }

  async getStates(): Promise<EntityState[]> {
    const token = this.getToken()
    const headers: Record<string, string> = {}
    if (token) {
      headers['Authorization'] = `Bearer ${token}`
    }

    const response = await fetch(`${apiBase()}/api/states`, { headers })

    if (!response.ok) {
      throw new Error(`Failed to fetch states: ${response.status} ${response.statusText}`)
    }

    return await response.json()
  }

  async callService(domain: string, service: string, entity_id: string, data?: Record<string, unknown>) {
    const token = this.getToken()
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Action-Intent': this.generateIntent(),
    }
    if (token) {
      headers['Authorization'] = `Bearer ${token}`
    }

    const payload = { entity_id, ...data }

    const response = await fetch(`/api/services/${domain}/${service}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    })

    if (!response.ok) {
      throw new Error(`Failed to call service: ${response.status} ${response.statusText}`)
    }
  }

  /**
   * Fire-and-forget service call. Tries WebSocket first (instant, no proxy),
   * falls back to HTTP fetch if WS is not connected.
   */
  callServiceFireAndForget(domain: string, service: string, entity_id: string, data?: Record<string, unknown>) {
    // Try WebSocket first — bypasses Vite proxy, instant delivery
    if (wsSend({ type: 'call_service', domain, service, entity_id, data: data || {} })) {
      console.debug(`[cmd] WS → ${domain}.${service} ${entity_id}`)
      return
    }

    // Fallback: HTTP fetch (goes through Vite proxy in dev)
    console.warn(`[cmd] WS not connected, HTTP fallback → ${domain}.${service} ${entity_id}`)
    const token = this.getToken()
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Action-Intent': this.generateIntent(),
    }
    if (token) {
      headers['Authorization'] = `Bearer ${token}`
    }

    fetch(`/api/services/${domain}/${service}`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        entity_id,
        ...data,
      }),
    }).then(resp => {
      if (!resp.ok) console.warn(`[cmd] HTTP fallback failed: ${resp.status}`)
    }).catch(err => {
      console.warn('[cmd] HTTP fallback error:', err)
    })
  }

  turnOnFireAndForget(entity_id: string, data?: Record<string, unknown>) {
    const domain = entity_id.split('.')[0]
    this.callServiceFireAndForget(domain, 'turn_on', entity_id, data)
  }

  async toggleEntity(entity_id: string) {
    const domain = entity_id.split('.')[0]
    await this.callService(domain, 'toggle', entity_id)
  }

  toggleEntityFireAndForget(entity_id: string) {
    const domain = entity_id.split('.')[0]
    this.callServiceFireAndForget(domain, 'toggle', entity_id)
  }

  async turnOn(entity_id: string, data?: Record<string, unknown>) {
    const domain = entity_id.split('.')[0]
    await this.callService(domain, 'turn_on', entity_id, data)
  }

  async turnOff(entity_id: string) {
    const domain = entity_id.split('.')[0]
    await this.callService(domain, 'turn_off', entity_id)
  }

  turnOffFireAndForget(entity_id: string) {
    const domain = entity_id.split('.')[0]
    this.callServiceFireAndForget(domain, 'turn_off', entity_id)
  }

  async setValue(entity_id: string, value: number) {
    const domain = entity_id.split('.')[0]
    await this.callService(domain, 'set_value', entity_id, { value })
  }

  async selectOption(entity_id: string, option: string) {
    const domain = entity_id.split('.')[0]
    await this.callService(domain, 'select_option', entity_id, { option })
  }

  async setPercentage(entity_id: string, percentage: number) {
    await this.callService('fan', 'set_percentage', entity_id, { percentage })
  }

  async lockEntity(entity_id: string) {
    await this.callService('lock', 'lock', entity_id)
  }

  async unlockEntity(entity_id: string) {
    await this.callService('lock', 'unlock', entity_id)
  }

  async pressButton(entity_id: string) {
    await this.callService('button', 'press', entity_id)
  }

  async setText(entity_id: string, value: string) {
    const domain = entity_id.split('.')[0]
    await this.callService(domain, 'set_value', entity_id, { value })
  }

  async setDateTime(entity_id: string, data: Record<string, unknown>) {
    await this.callService('input_datetime', 'set_datetime', entity_id, data)
  }

  async increment(entity_id: string) {
    await this.callService('counter', 'increment', entity_id)
  }

  async decrement(entity_id: string) {
    await this.callService('counter', 'decrement', entity_id)
  }

  async resetCounter(entity_id: string) {
    await this.callService('counter', 'reset', entity_id)
  }

  async startTimer(entity_id: string, data?: Record<string, unknown>) {
    await this.callService('timer', 'start', entity_id, data)
  }

  async pauseTimer(entity_id: string) {
    await this.callService('timer', 'pause', entity_id)
  }

  async cancelTimer(entity_id: string) {
    await this.callService('timer', 'cancel', entity_id)
  }

  async startVacuum(entity_id: string) {
    await this.callService('vacuum', 'start', entity_id)
  }

  async stopVacuum(entity_id: string) {
    await this.callService('vacuum', 'stop', entity_id)
  }

  async returnToBase(entity_id: string) {
    await this.callService('vacuum', 'return_to_base', entity_id)
  }

  async setHumidity(entity_id: string, humidity: number) {
    await this.callService('humidifier', 'set_humidity', entity_id, { humidity })
  }

  async mediaPlayPause(entity_id: string) {
    await this.callService('media_player', 'media_play_pause', entity_id)
  }

  async mediaPlay(entity_id: string) {
    await this.callService('media_player', 'media_play', entity_id)
  }

  async mediaPause(entity_id: string) {
    await this.callService('media_player', 'media_pause', entity_id)
  }

  async mediaNextTrack(entity_id: string) {
    await this.callService('media_player', 'media_next_track', entity_id)
  }

  async mediaPreviousTrack(entity_id: string) {
    await this.callService('media_player', 'media_previous_track', entity_id)
  }

  async mediaStop(entity_id: string) {
    await this.callService('media_player', 'media_stop', entity_id)
  }

  async mediaSetVolume(entity_id: string, volumeLevel: number) {
    await this.callService('media_player', 'volume_set', entity_id, { volume_level: volumeLevel })
  }

  async mediaSetMute(entity_id: string, muted: boolean) {
    await this.callService('media_player', 'volume_mute', entity_id, { is_volume_muted: muted })
  }

  async mediaSeek(entity_id: string, positionSeconds: number) {
    await this.callService('media_player', 'media_seek', entity_id, { seek_position: positionSeconds })
  }

  async armAlarm(entity_id: string, mode: string, code?: string) {
    await this.callService('alarm_control_panel', `alarm_${mode}`, entity_id, code ? { code } : undefined)
  }

  async disarmAlarm(entity_id: string, code?: string) {
    await this.callService('alarm_control_panel', 'alarm_disarm', entity_id, code ? { code } : undefined)
  }

  async getHistory(entityId: string, startTime?: string, endTime?: string): Promise<HistoryEntry[][]> {
    const token = this.getToken()
    const headers: Record<string, string> = {}
    if (token) {
      headers['Authorization'] = `Bearer ${token}`
    }

    const start = startTime || new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    const params = new URLSearchParams({
      filter_entity_id: entityId,
      minimal_response: '',
      no_attributes: '',
    })
    if (endTime) params.set('end_time', endTime)

    const response = await fetch(`/api/history/period/${start}?${params}`, { headers })
    if (!response.ok) {
      throw new Error(`Failed to fetch history: ${response.status}`)
    }
    return await response.json()
  }

  async getForecasts(entityId: string, type: 'daily' | 'hourly'): Promise<ForecastEntry[]> {
    const token = this.getToken()
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Action-Intent': this.generateIntent(),
    }
    if (token) {
      headers['Authorization'] = `Bearer ${token}`
    }

    // Try to load from cache first
    try {
      const cacheRes = await fetch(`/api/weather/forecast/${encodeURIComponent(entityId)}/${type}`, { headers })
      if (cacheRes.ok) {
        const cacheData = await cacheRes.json()
        if (cacheData.cached && Array.isArray(cacheData.forecast) && cacheData.forecast.length > 0) {
          // Check if cache is fresh (< 30 min)
          const fetchedAt = new Date(cacheData.fetched_at).getTime()
          if (Date.now() - fetchedAt < 30 * 60 * 1000) {
            return cacheData.forecast as ForecastEntry[]
          }
        }
      }
    } catch { /* cache miss, fetch from HA */ }

    const extractForecast = (payload: unknown): ForecastEntry[] | null => {
      if (!payload || typeof payload !== 'object') return null
      const obj = payload as Record<string, unknown>

      // Direct entity key: {"weather.home": { forecast: [...] }}
      const byEntity = obj[entityId] as Record<string, unknown> | undefined
      if (byEntity && Array.isArray(byEntity.forecast)) return byEntity.forecast as ForecastEntry[]

      // Wrapped response: { response: {...} }
      const responseObj = obj.response as Record<string, unknown> | undefined
      if (responseObj) {
        const respEntity = responseObj[entityId] as Record<string, unknown> | undefined
        if (respEntity && Array.isArray(respEntity.forecast)) return respEntity.forecast as ForecastEntry[]
        const respFirst = Object.values(responseObj)[0] as Record<string, unknown> | undefined
        if (respFirst && Array.isArray(respFirst.forecast)) return respFirst.forecast as ForecastEntry[]
      }

      // HA variants where result is nested in service_response/changed_states wrappers
      const serviceResponse = obj.service_response as Record<string, unknown> | undefined
      if (serviceResponse) {
        const serviceEntity = serviceResponse[entityId] as Record<string, unknown> | undefined
        if (serviceEntity && Array.isArray(serviceEntity.forecast)) return serviceEntity.forecast as ForecastEntry[]
      }

      // Sometimes response is an array with one item wrapping the object
      if (Array.isArray(payload) && payload.length > 0) {
        for (const item of payload) {
          const nested = extractForecast(item)
          if (nested && nested.length > 0) return nested
        }
      }

      const firstVal = Object.values(obj)[0] as Record<string, unknown> | undefined
      if (firstVal && Array.isArray(firstVal.forecast)) return firstVal.forecast as ForecastEntry[]

      return null
    }

    const payloadVariants = [
      { entity_id: entityId, type },
      { target: { entity_id: entityId }, type },
      { entity_id: entityId, target: { entity_id: entityId }, type },
    ]

    let sawBadRequest = false
    let lastError: Error | null = null

    for (const payload of payloadVariants) {
      try {
        const response = await fetch(`${apiBase()}/api/services/weather/get_forecasts?return_response`, {
          method: 'POST',
          headers,
          body: JSON.stringify(payload),
        })

        if (!response.ok) {
          if (response.status === 400) {
            sawBadRequest = true
            continue
          }
          throw new Error(`Failed to fetch forecasts: ${response.status}`)
        }

        const data = await response.json()
        const forecast = extractForecast(data)
        if (forecast && forecast.length > 0) {
          // Save to cache in background
          fetch(`/api/weather/forecast/${encodeURIComponent(entityId)}/${type}`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ forecast }),
          }).catch(() => {})
          return forecast
        }
      } catch (error) {
        lastError = error instanceof Error ? error : new Error('Failed to fetch forecasts')
      }
    }

    if (sawBadRequest) {
      return []
    }
    if (lastError) {
      throw lastError
    }
    return []
  }
}

export interface HistoryEntry {
  entity_id: string
  state: string
  last_changed: string
  last_updated: string
  attributes?: Record<string, unknown>
}

export interface ForecastEntry {
  datetime: string
  temperature: number
  templow?: number
  condition: string
  precipitation?: number
  precipitation_probability?: number
  humidity?: number
  wind_speed?: number
  wind_bearing?: number
}

export const haService = new HomeAssistantService()
