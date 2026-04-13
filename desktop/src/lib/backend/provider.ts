import type { EntityState } from '@/lib/types'

/**
 * Backend Provider Interface
 * Allows switching between different backend implementations
 */
export interface BackendProvider {
  /** Provider name */
  name: string

  /** Initialize the provider */
  initialize(config: BackendConfig): Promise<void>

  /** Get all entity states */
  getStates(): Promise<EntityState[]>

  /** Get single entity state */
  getState(entityId: string): Promise<EntityState | undefined>

  /** Call a Home Assistant service */
  callService(domain: string, service: string, data?: ServiceData): Promise<void>

  /** Subscribe to state changes */
  subscribe(callback: (entities: EntityState[]) => void): () => void

  /** Check if provider is connected */
  isConnected(): boolean

  /** Disconnect from provider */
  disconnect(): Promise<void>
}

/**
 * Backend Configuration
 */
export interface BackendConfig {
  /** Backend URL */
  url: string
  /** Authentication token */
  token?: string
  /** Use WebSocket for real-time updates */
  useWebSocket?: boolean
  /** Custom headers */
  headers?: Record<string, string>
  /** Timeout in milliseconds */
  timeout?: number
}

/**
 * Service call data
 */
export interface ServiceData {
  entity_id?: string | string[]
  [key: string]: unknown
}

/**
 * Direct Home Assistant Provider
 * Connects directly to Home Assistant REST API
 */
export class DirectHAProvider implements BackendProvider {
  name = 'direct-ha'
  private config: BackendConfig | null = null
  private subscribers: ((entities: EntityState[]) => void)[] = []
  private pollInterval: number | null = null

  async initialize(config: BackendConfig): Promise<void> {
    this.config = config
    console.log(`Initialized DirectHAProvider with URL: ${config.url}`)
  }

  async getStates(): Promise<EntityState[]> {
    if (!this.config) {
      throw new Error('Provider not initialized')
    }

    const response = await fetch(`${this.config.url}/api/states`, {
      headers: {
        'Authorization': `Bearer ${this.config.token}`,
        'Content-Type': 'application/json',
        ...this.config.headers,
      },
      cache: 'no-store',
      signal: AbortSignal.timeout(this.config.timeout ?? 10000),
    })

    if (!response.ok) {
      throw new Error(`Failed to fetch states: ${response.statusText}`)
    }

    return response.json()
  }

  async getState(entityId: string): Promise<EntityState | undefined> {
    if (!this.config) {
      throw new Error('Provider not initialized')
    }

    const response = await fetch(`${this.config.url}/api/states/${entityId}`, {
      headers: {
        'Authorization': `Bearer ${this.config.token}`,
        'Content-Type': 'application/json',
        ...this.config.headers,
      },
      cache: 'no-store',
      signal: AbortSignal.timeout(this.config.timeout ?? 10000),
    })

    if (!response.ok) {
      if (response.status === 404) {
        return undefined
      }
      throw new Error(`Failed to fetch state: ${response.statusText}`)
    }

    return response.json()
  }

  async callService(domain: string, service: string, data?: ServiceData): Promise<void> {
    if (!this.config) {
      throw new Error('Provider not initialized')
    }

    const response = await fetch(`${this.config.url}/api/services/${domain}/${service}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.config.token}`,
        'Content-Type': 'application/json',
        ...this.config.headers,
      },
      body: JSON.stringify(data ?? {}),
      cache: 'no-store',
      signal: AbortSignal.timeout(this.config.timeout ?? 10000),
    })

    if (!response.ok) {
      throw new Error(`Failed to call service: ${response.statusText}`)
    }
  }

  subscribe(callback: (entities: EntityState[]) => void): () => void {
    this.subscribers.push(callback)

    // Start polling if not already started
    if (!this.pollInterval) {
      this.startPolling()
    }

    // Return unsubscribe function
    return () => {
      const index = this.subscribers.indexOf(callback)
      if (index > -1) {
        this.subscribers.splice(index, 1)
      }

      // Stop polling if no subscribers
      if (this.subscribers.length === 0 && this.pollInterval) {
        clearInterval(this.pollInterval)
        this.pollInterval = null
      }
    }
  }

  private startPolling() {
    this.pollInterval = window.setInterval(async () => {
      try {
        const states = await this.getStates()
        this.subscribers.forEach(callback => callback(states))
      } catch (error) {
        console.error('Failed to poll states:', error)
      }
    }, 5000) // Poll every 5 seconds
  }

  isConnected(): boolean {
    return this.config !== null
  }

  async disconnect(): Promise<void> {
    if (this.pollInterval) {
      clearInterval(this.pollInterval)
      this.pollInterval = null
    }
    this.subscribers = []
    this.config = null
  }
}

/**
 * Proxy Backend Provider
 * Connects to a backend proxy (e.g., Rust/Axum server)
 */
export class ProxyBackendProvider implements BackendProvider {
  name = 'proxy'
  private config: BackendConfig | null = null
  private websocket: WebSocket | null = null
  private subscribers: ((entities: EntityState[]) => void)[] = []
  private reconnectTimer: number | null = null

  async initialize(config: BackendConfig): Promise<void> {
    this.config = config
    console.log(`Initialized ProxyBackendProvider with URL: ${config.url}`)

    if (config.useWebSocket) {
      await this.connectWebSocket()
    }
  }

  private async connectWebSocket(): Promise<void> {
    if (!this.config) return

    const wsUrl = this.config.url.replace(/^http/, 'ws') + '/ws'

    try {
      this.websocket = new WebSocket(wsUrl)

      this.websocket.onopen = () => {
        console.log('WebSocket connected')
        // Send auth token
        if (this.config?.token) {
          this.websocket?.send(JSON.stringify({ type: 'auth', token: this.config.token }))
        }
      }

      this.websocket.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data)
          if (message.type === 'state_changed') {
            this.subscribers.forEach(callback => callback(message.states))
          }
        } catch (error) {
          console.error('Failed to parse WebSocket message:', error)
        }
      }

      this.websocket.onerror = (error) => {
        console.error('WebSocket error:', error)
      }

      this.websocket.onclose = () => {
        console.log('WebSocket disconnected')
        // Attempt reconnection
        this.reconnectTimer = window.setTimeout(() => {
          this.connectWebSocket()
        }, 5000)
      }
    } catch (error) {
      console.error('Failed to connect WebSocket:', error)
    }
  }

  async getStates(): Promise<EntityState[]> {
    if (!this.config) {
      throw new Error('Provider not initialized')
    }

    const response = await fetch(`${this.config.url}/api/states`, {
      headers: {
        'Authorization': this.config.token ? `Bearer ${this.config.token}` : '',
        'Content-Type': 'application/json',
        ...this.config.headers,
      },
      cache: 'no-store',
      signal: AbortSignal.timeout(this.config.timeout ?? 10000),
    })

    if (!response.ok) {
      throw new Error(`Failed to fetch states: ${response.statusText}`)
    }

    return response.json()
  }

  async getState(entityId: string): Promise<EntityState | undefined> {
    if (!this.config) {
      throw new Error('Provider not initialized')
    }

    const response = await fetch(`${this.config.url}/api/states/${entityId}`, {
      headers: {
        'Authorization': this.config.token ? `Bearer ${this.config.token}` : '',
        'Content-Type': 'application/json',
        ...this.config.headers,
      },
      cache: 'no-store',
      signal: AbortSignal.timeout(this.config.timeout ?? 10000),
    })

    if (!response.ok) {
      if (response.status === 404) {
        return undefined
      }
      throw new Error(`Failed to fetch state: ${response.statusText}`)
    }

    return response.json()
  }

  async callService(domain: string, service: string, data?: ServiceData): Promise<void> {
    if (!this.config) {
      throw new Error('Provider not initialized')
    }

    const response = await fetch(`${this.config.url}/api/services/${domain}/${service}`, {
      method: 'POST',
      headers: {
        'Authorization': this.config.token ? `Bearer ${this.config.token}` : '',
        'Content-Type': 'application/json',
        ...this.config.headers,
      },
      body: JSON.stringify(data ?? {}),
      cache: 'no-store',
      signal: AbortSignal.timeout(this.config.timeout ?? 10000),
    })

    if (!response.ok) {
      throw new Error(`Failed to call service: ${response.statusText}`)
    }
  }

  subscribe(callback: (entities: EntityState[]) => void): () => void {
    this.subscribers.push(callback)

    // Return unsubscribe function
    return () => {
      const index = this.subscribers.indexOf(callback)
      if (index > -1) {
        this.subscribers.splice(index, 1)
      }
    }
  }

  isConnected(): boolean {
    return this.config !== null && (this.websocket?.readyState === WebSocket.OPEN || !this.config.useWebSocket)
  }

  async disconnect(): Promise<void> {
    if (this.websocket) {
      this.websocket.close()
      this.websocket = null
    }

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }

    this.subscribers = []
    this.config = null
  }
}

/**
 * Backend Manager
 * Manages active backend provider
 */
class BackendManager {
  private provider: BackendProvider | null = null
  private availableProviders = new Map<string, new () => BackendProvider>()

  constructor() {
    // Register built-in providers
    this.registerProvider('direct-ha', DirectHAProvider)
    this.registerProvider('proxy', ProxyBackendProvider)
  }

  /**
   * Register a custom backend provider
   */
  registerProvider(name: string, providerClass: new () => BackendProvider) {
    this.availableProviders.set(name, providerClass)
    console.log(`Registered backend provider: ${name}`)
  }

  /**
   * Set active provider
   */
  async setProvider(name: string, config: BackendConfig): Promise<void> {
    // Disconnect current provider
    if (this.provider) {
      await this.provider.disconnect()
    }

    // Get provider class
    const ProviderClass = this.availableProviders.get(name)
    if (!ProviderClass) {
      throw new Error(`Provider ${name} not found`)
    }

    // Initialize new provider
    this.provider = new ProviderClass()
    await this.provider.initialize(config)
    console.log(`Switched to backend provider: ${name}`)
  }

  /**
   * Get active provider
   */
  getProvider(): BackendProvider {
    if (!this.provider) {
      throw new Error('No backend provider set')
    }
    return this.provider
  }

  /**
   * Get available provider names
   */
  getAvailableProviders(): string[] {
    return Array.from(this.availableProviders.keys())
  }
}

// Export singleton instance
export const backendManager = new BackendManager()
