import type { EntityState, HomeAssistantConfig } from '@/lib/types'
import { generateMockStates } from '@/lib/mockData'

class HomeAssistantService {
  private config: HomeAssistantConfig | null = null

  configure(config: HomeAssistantConfig) {
    this.config = config
  }

  isConfigured(): boolean {
    return this.config !== null
  }

  async getStates(): Promise<EntityState[]> {
    if (!this.config) {
      return await this.getMockStates()
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
      return await this.getMockStates()
    }
  }

  async callService(domain: string, service: string, entity_id: string, data?: Record<string, unknown>) {
    if (!this.config) {
      await this.mockCallService(domain, service, entity_id, data)
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

  private async getMockStates(): Promise<EntityState[]> {
    const stored = await window.spark.kv.get<EntityState[]>('ha-mock-states')
    if (stored) {
      return stored
    }
    
    const mockStates = generateMockStates()
    await window.spark.kv.set('ha-mock-states', mockStates)
    return mockStates
  }

  private async mockCallService(domain: string, service: string, entity_id: string, data?: Record<string, unknown>) {
    console.log('Mock service call:', { domain, service, entity_id, data })
    
    const states = await this.getMockStates()
    const entityIndex = states.findIndex(e => e.entity_id === entity_id)
    
    if (entityIndex === -1) {
      console.warn('Entity not found:', entity_id)
      return
    }

    const entity = states[entityIndex]
    const now = new Date().toISOString()

    if (service === 'toggle') {
      entity.state = entity.state === 'on' ? 'off' : 'on'
      if (entity.state === 'off' && entity.attributes.brightness !== undefined) {
        entity.attributes.brightness = 0
      } else if (entity.state === 'on' && entity.attributes.brightness === 0) {
        entity.attributes.brightness = 255
      }
    } else if (service === 'turn_on') {
      entity.state = 'on'
      if (data?.brightness !== undefined) {
        entity.attributes.brightness = data.brightness as number
      }
      if (data?.rgb_color !== undefined) {
        entity.attributes.rgb_color = data.rgb_color as [number, number, number]
        entity.attributes.color_mode = 'rgb'
      }
      if (data?.color_temp !== undefined) {
        entity.attributes.color_temp = data.color_temp as number
        entity.attributes.color_mode = 'color_temp'
      }
    } else if (service === 'turn_off') {
      entity.state = 'off'
      if (entity.attributes.brightness !== undefined) {
        entity.attributes.brightness = 0
      }
    } else if (service === 'set_temperature') {
      if (data?.temperature !== undefined) {
        entity.attributes.temperature = data.temperature as number
      }
    }

    entity.last_changed = now
    entity.last_updated = now

    await window.spark.kv.set('ha-mock-states', states)
  }
}

export const haService = new HomeAssistantService()
