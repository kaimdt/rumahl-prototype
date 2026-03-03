import type { EntityState, HomeAssistantConfig } from '@/lib/types'

class HomeAssistantService {
  private config: HomeAssistantConfig | null = null
  private ws: WebSocket | null = null
  private messageId = 1
  private pendingMessages = new Map<number, {
    resolve: (value: unknown) => void
    reject: (error: Error) => void
  }>()
  private eventHandlers = new Map<string, Set<(data: unknown) => void>>()

  configure(config: HomeAssistantConfig) {
    this.config = config
  }

  isConfigured(): boolean {
    return this.config !== null
  }

  async getStates(): Promise<EntityState[]> {
    if (!this.config) {
      return this.getMockStates()
    }

    try {
      const response = await fetch(`${this.config.url}/api/states`, {
        headers: {
          'Authorization': `Bearer ${this.config.token}`,
          'Content-Type': 'application/json',
        },
      })

      if (!response.ok) {
        throw new Error('Failed to fetch states')
      }

      return await response.json()
    } catch (error) {
      console.error('Error fetching HA states:', error)
      return this.getMockStates()
    }
  }

  async callService(domain: string, service: string, entity_id: string, data?: Record<string, unknown>) {
    if (!this.config) {
      console.log('Mock service call:', { domain, service, entity_id, data })
      return
    }

    try {
      const response = await fetch(`${this.config.url}/api/services/${domain}/${service}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.config.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          entity_id,
          ...data,
        }),
      })

      if (!response.ok) {
        throw new Error('Failed to call service')
      }

      return await response.json()
    } catch (error) {
      console.error('Error calling HA service:', error)
      throw error
    }
  }

  async toggleEntity(entity_id: string) {
    const domain = entity_id.split('.')[0]
    await this.callService(domain, 'toggle', entity_id)
  }

  async turnOn(entity_id: string, data?: Record<string, unknown>) {
    const domain = entity_id.split('.')[0]
    await this.callService(domain, 'turn_on', entity_id, data)
  }

  async turnOff(entity_id: string) {
    const domain = entity_id.split('.')[0]
    await this.callService(domain, 'turn_off', entity_id)
  }

  private getMockStates(): EntityState[] {
    return [
      {
        entity_id: 'weather.home',
        state: 'sunny',
        attributes: {
          temperature: 20,
          humidity: 65,
          forecast: [
            { datetime: new Date().toISOString(), temperature: 20, condition: 'sunny' },
            { datetime: new Date(Date.now() + 86400000).toISOString(), temperature: 22, condition: 'cloudy' },
            { datetime: new Date(Date.now() + 172800000).toISOString(), temperature: 22, condition: 'cloudy' },
            { datetime: new Date(Date.now() + 259200000).toISOString(), temperature: 22, condition: 'cloudy' },
            { datetime: new Date(Date.now() + 345600000).toISOString(), temperature: 22, condition: 'sunny' },
          ],
          friendly_name: 'Kissing',
        },
        last_changed: new Date().toISOString(),
        last_updated: new Date().toISOString(),
      },
      {
        entity_id: 'light.living_room',
        state: 'on',
        attributes: {
          brightness: 200,
          friendly_name: 'Wohnzimmer',
          supported_features: 1,
        },
        last_changed: new Date().toISOString(),
        last_updated: new Date().toISOString(),
      },
      {
        entity_id: 'light.bedroom',
        state: 'off',
        attributes: {
          brightness: 0,
          friendly_name: 'Schlafzimmer',
          supported_features: 1,
        },
        last_changed: new Date().toISOString(),
        last_updated: new Date().toISOString(),
      },
      {
        entity_id: 'light.kitchen',
        state: 'on',
        attributes: {
          brightness: 255,
          friendly_name: 'Küche',
          supported_features: 1,
        },
        last_changed: new Date().toISOString(),
        last_updated: new Date().toISOString(),
      },
      {
        entity_id: 'climate.living_room',
        state: 'heat',
        attributes: {
          temperature: 21,
          current_temperature: 20.5,
          hvac_action: 'heating',
          friendly_name: 'Heizung Wohnzimmer',
        },
        last_changed: new Date().toISOString(),
        last_updated: new Date().toISOString(),
      },
      {
        entity_id: 'climate.bedroom',
        state: 'auto',
        attributes: {
          temperature: 19,
          current_temperature: 19.2,
          hvac_action: 'idle',
          friendly_name: 'Heizung Schlafzimmer',
        },
        last_changed: new Date().toISOString(),
        last_updated: new Date().toISOString(),
      },
      {
        entity_id: 'sensor.temperature_outside',
        state: '20',
        attributes: {
          unit_of_measurement: '°C',
          device_class: 'temperature',
          friendly_name: 'Außentemperatur',
        },
        last_changed: new Date().toISOString(),
        last_updated: new Date().toISOString(),
      },
      {
        entity_id: 'sensor.humidity',
        state: '65',
        attributes: {
          unit_of_measurement: '%',
          device_class: 'humidity',
          friendly_name: 'Luftfeuchtigkeit',
        },
        last_changed: new Date().toISOString(),
        last_updated: new Date().toISOString(),
      },
      {
        entity_id: 'switch.coffee_maker',
        state: 'off',
        attributes: {
          friendly_name: 'Kaffeemaschine',
        },
        last_changed: new Date().toISOString(),
        last_updated: new Date().toISOString(),
      },
    ]
  }
}

export const haService = new HomeAssistantService()
