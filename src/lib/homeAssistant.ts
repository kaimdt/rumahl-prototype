import type { EntityState, HomeAssistantConfig } from '@/lib/types'

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
      throw new Error('Home Assistant is not configured')
    }

    try {
      const response = await fetch(`${this.config.url}/api/states`, {
        headers: {
          'Authorization': `Bearer ${this.config.token}`,
          'Content-Type': 'application/json',
        },
      })

      if (!response.ok) {
        throw new Error(`Failed to fetch states: ${response.status} ${response.statusText}`)
      }

      return await response.json()
    } catch (error) {
      console.error('Error fetching HA states:', error)
      throw error
    }
  }

  async callService(domain: string, service: string, entity_id: string, data?: Record<string, unknown>) {
    if (!this.config) {
      throw new Error('Home Assistant is not configured')
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
        throw new Error(`Failed to call service: ${response.status} ${response.statusText}`)
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
}

export const haService = new HomeAssistantService()
