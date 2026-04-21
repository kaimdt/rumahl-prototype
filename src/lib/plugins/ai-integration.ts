/**
 * ORA AI Integration for Plugins
 *
 * This module provides APIs for plugins and apps to:
 * 1. Call ORA AI with custom prompts
 * 2. Register new AI tools/capabilities
 * 3. Subscribe to AI events and responses
 */

const ASSIST_URL = import.meta.env.VITE_IORA_ASSIST_URL || 'http://localhost:8092'

// ────────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────────

export interface AIResponse {
  message: string
  provider: string
  message_id: string
  timestamp: string
}

export interface AITool {
  name: string
  description: string
  parameters: AIToolParameter[]
  handler: (params: Record<string, any>) => Promise<any>
}

export interface AIToolParameter {
  name: string
  type: 'string' | 'number' | 'boolean' | 'object' | 'array'
  description: string
  required: boolean
  default?: any
}

export interface AIContext {
  entities?: string[]
  history?: string[]
  metadata?: Record<string, any>
}

export interface AICallOptions {
  message: string
  context?: AIContext
  systemPrompt?: string
  stream?: boolean
}

// ────────────────────────────────────────────────────────────────────────────
// AI Client for Plugins
// ────────────────────────────────────────────────────────────────────────────

export class PluginAIClient {
  private pluginId: string
  private registeredTools: Map<string, AITool> = new Map()

  constructor(pluginId: string) {
    this.pluginId = pluginId
  }

  /**
   * Call ORA AI with a custom prompt
   */
  async chat(options: AICallOptions): Promise<AIResponse> {
    const response = await fetch(`${ASSIST_URL}/api/assist/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Plugin-ID': this.pluginId,
      },
      body: JSON.stringify({
        message: options.message,
        context: options.context || null,
        system_prompt: options.systemPrompt,
      }),
    })

    if (!response.ok) {
      throw new Error(`AI call failed: ${response.status}`)
    }

    const data = await response.json()
    return {
      ...data,
      timestamp: new Date().toISOString(),
    }
  }

  /**
   * Stream AI responses for real-time updates
   */
  async *chatStream(options: AICallOptions): AsyncGenerator<string, void, unknown> {
    const response = await fetch(`${ASSIST_URL}/api/assist/chat/stream`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Plugin-ID': this.pluginId,
      },
      body: JSON.stringify({
        message: options.message,
        context: options.context || null,
        system_prompt: options.systemPrompt,
      }),
    })

    if (!response.ok) {
      throw new Error(`AI stream failed: ${response.status}`)
    }

    const reader = response.body?.getReader()
    if (!reader) {
      throw new Error('Response body not available')
    }

    const decoder = new TextDecoder()

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        const chunk = decoder.decode(value, { stream: true })
        const lines = chunk.split('\n')

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6)
            if (data === '[DONE]') continue
            try {
              const json = JSON.parse(data)
              if (json.delta) {
                yield json.delta
              }
            } catch (e) {
              console.error('Failed to parse SSE data:', e)
            }
          }
        }
      }
    } finally {
      reader.releaseLock()
    }
  }

  /**
   * Register a new tool that ORA AI can use
   */
  async registerTool(tool: AITool): Promise<void> {
    this.registeredTools.set(tool.name, tool)

    // Register with backend
    const response = await fetch(`${ASSIST_URL}/api/assist/tools/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Plugin-ID': this.pluginId,
      },
      body: JSON.stringify({
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
        plugin_id: this.pluginId,
      }),
    })

    if (!response.ok) {
      throw new Error(`Tool registration failed: ${response.status}`)
    }
  }

  /**
   * Unregister a tool
   */
  async unregisterTool(toolName: string): Promise<void> {
    this.registeredTools.delete(toolName)

    await fetch(`${ASSIST_URL}/api/assist/tools/${toolName}`, {
      method: 'DELETE',
      headers: {
        'X-Plugin-ID': this.pluginId,
      },
    })
  }

  /**
   * Execute a registered tool (called by AI)
   */
  async executeTool(toolName: string, params: Record<string, any>): Promise<any> {
    const tool = this.registeredTools.get(toolName)
    if (!tool) {
      throw new Error(`Tool not found: ${toolName}`)
    }

    return await tool.handler(params)
  }

  /**
   * Search the internet using ORA AI's search capability
   */
  async searchInternet(query: string, maxResults: number = 5): Promise<any> {
    const response = await fetch(`${ASSIST_URL}/api/assist/tools/search`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Plugin-ID': this.pluginId,
      },
      body: JSON.stringify({
        query,
        max_results: maxResults,
      }),
    })

    if (!response.ok) {
      throw new Error(`Search failed: ${response.status}`)
    }

    return await response.json()
  }

  /**
   * Analyze an image using vision capabilities
   */
  async analyzeImage(imageUrl: string, prompt?: string): Promise<AIResponse> {
    const response = await fetch(`${ASSIST_URL}/api/assist/vision`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Plugin-ID': this.pluginId,
      },
      body: JSON.stringify({
        image_url: imageUrl,
        prompt: prompt || 'What is in this image?',
      }),
    })

    if (!response.ok) {
      throw new Error(`Vision analysis failed: ${response.status}`)
    }

    const data = await response.json()
    return {
      ...data,
      timestamp: new Date().toISOString(),
    }
  }

  /**
   * Get conversation history
   */
  async getHistory(limit: number = 50): Promise<any[]> {
    const response = await fetch(
      `${ASSIST_URL}/api/assist/history?limit=${limit}&plugin_id=${this.pluginId}`
    )

    if (!response.ok) {
      throw new Error(`Failed to fetch history: ${response.status}`)
    }

    return await response.json()
  }

  /**
   * Clear conversation history
   */
  async clearHistory(): Promise<void> {
    await fetch(`${ASSIST_URL}/api/assist/history`, {
      method: 'DELETE',
      headers: {
        'X-Plugin-ID': this.pluginId,
      },
    })
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Plugin Context Extension
// ────────────────────────────────────────────────────────────────────────────

/**
 * Create an AI client for a plugin
 */
export function createPluginAIClient(pluginId: string): PluginAIClient {
  return new PluginAIClient(pluginId)
}

// ────────────────────────────────────────────────────────────────────────────
// Example Usage
// ────────────────────────────────────────────────────────────────────────────

/**
 * Example: Weather plugin registering a tool
 *
 * ```typescript
 * const ai = createPluginAIClient('weather-plugin')
 *
 * // Register a weather tool
 * await ai.registerTool({
 *   name: 'get_weather',
 *   description: 'Get current weather for a location',
 *   parameters: [
 *     {
 *       name: 'location',
 *       type: 'string',
 *       description: 'City name or coordinates',
 *       required: true,
 *     },
 *     {
 *       name: 'units',
 *       type: 'string',
 *       description: 'Temperature units (celsius/fahrenheit)',
 *       required: false,
 *       default: 'celsius',
 *     },
 *   ],
 *   handler: async (params) => {
 *     const weather = await fetchWeather(params.location, params.units)
 *     return {
 *       temperature: weather.temp,
 *       condition: weather.condition,
 *       humidity: weather.humidity,
 *     }
 *   },
 * })
 *
 * // Now ORA AI can call this tool when users ask about weather
 * ```
 */

/**
 * Example: Asking ORA AI from a plugin
 *
 * ```typescript
 * const ai = createPluginAIClient('my-plugin')
 *
 * // Simple query
 * const response = await ai.chat({
 *   message: 'What is the best way to organize my tasks?',
 * })
 * console.log(response.message)
 *
 * // With context
 * const response = await ai.chat({
 *   message: 'Turn on all lights in the living room',
 *   context: {
 *     entities: ['light.living_room_1', 'light.living_room_2'],
 *   },
 * })
 *
 * // Streaming response
 * for await (const chunk of ai.chatStream({
 *   message: 'Explain how to set up automation',
 * })) {
 *   console.log(chunk) // Real-time text chunks
 * }
 * ```
 */
