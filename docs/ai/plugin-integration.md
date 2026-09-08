# ORA AI Plugin Integration Guide

## Overview

ORA Plugins can now integrate with ORA AI to:
- **Call the AI** with custom prompts and context
- **Register AI tools** that ORA can use to perform actions
- **Stream AI responses** for real-time interactions
- **Access advanced AI features** like web search and vision analysis

## Quick Start

### Basic AI Call from Plugin

```typescript
import { WidgetPlugin, WidgetPluginProps, PluginContext } from '@/lib/plugins/types'
import { createPluginAIClient } from '@/lib/plugins/ai-integration'

function MyWidget({ entity, config, context }: WidgetPluginProps & { context: PluginContext }) {
  const handleAsk = async () => {
    // Call ORA AI
    const response = await context.ai.chat({
      message: `What should I do with the ${entity.attributes.friendly_name}?`,
      context: {
        entities: [entity.entity_id],
      },
    })

    context.notify(response.message, 'info')
  }

  return (
    <button onClick={handleAsk}>
      Ask ORA AI
    </button>
  )
}

export const plugin: WidgetPlugin = {
  metadata: {
    id: 'ai-widget-example',
    name: 'AI Widget Example',
    version: '1.0.0',
    description: 'Example widget with AI integration',
    author: 'Your Name',
  },
  component: MyWidget,
}
```

### Registering an AI Tool

Plugins can extend ORA AI's capabilities by registering custom tools:

```typescript
import { ServicePlugin } from '@/lib/plugins/types'
import { createPluginAIClient, AITool } from '@/lib/plugins/ai-integration'

const weatherTool: AITool = {
  name: 'get_weather',
  description: 'Get current weather for any location',
  parameters: [
    {
      name: 'location',
      type: 'string',
      description: 'City name or coordinates',
      required: true,
    },
    {
      name: 'units',
      type: 'string',
      description: 'Temperature units (celsius or fahrenheit)',
      required: false,
      default: 'celsius',
    },
  ],
  handler: async (params) => {
    // Fetch weather from your API
    const weather = await fetch(`https://api.weather.com/...`)
    const data = await weather.json()

    return {
      temperature: data.temp,
      condition: data.condition,
      humidity: data.humidity,
      location: params.location,
    }
  },
}

export const plugin: ServicePlugin = {
  metadata: {
    id: 'weather-ai-plugin',
    name: 'Weather AI Plugin',
    version: '1.0.0',
    description: 'Adds weather capabilities to ORA AI',
    author: 'Your Name',
  },
  initialize: async () => {
    const ai = createPluginAIClient('weather-ai-plugin')
    await ai.registerTool(weatherTool)
    console.log('Weather tool registered with ORA AI')
  },
  destroy: async () => {
    const ai = createPluginAIClient('weather-ai-plugin')
    await ai.unregisterTool('get_weather')
  },
}
```

Now users can ask: *"What's the weather in Berlin?"* and ORA AI will automatically use your tool!

## AI Client API Reference

### Creating a Client

```typescript
import { createPluginAIClient } from '@/lib/plugins/ai-integration'

const ai = createPluginAIClient('your-plugin-id')
```

### Methods

#### `chat(options: AICallOptions): Promise<AIResponse>`

Call ORA AI with a message.

```typescript
const response = await ai.chat({
  message: 'Turn on the lights in the bedroom',
  context: {
    entities: ['light.bedroom_1', 'light.bedroom_2'],
  },
  systemPrompt: 'You are a helpful smart home assistant',
})

console.log(response.message) // AI's response
console.log(response.provider) // Which AI provider was used
```

#### `chatStream(options: AICallOptions): AsyncGenerator<string>`

Stream AI responses for real-time updates.

```typescript
let fullResponse = ''

for await (const chunk of ai.chatStream({
  message: 'Explain home automation best practices',
})) {
  fullResponse += chunk
  console.log(chunk) // Print each chunk as it arrives
}
```

#### `registerTool(tool: AITool): Promise<void>`

Register a new tool that ORA AI can call.

```typescript
await ai.registerTool({
  name: 'control_lights',
  description: 'Control lights in a specific room',
  parameters: [
    {
      name: 'room',
      type: 'string',
      description: 'Room name (living room, bedroom, etc.)',
      required: true,
    },
    {
      name: 'action',
      type: 'string',
      description: 'Action to perform (on, off, dim, brighten)',
      required: true,
    },
  ],
  handler: async (params) => {
    // Your implementation
    await controlLights(params.room, params.action)
    return { success: true, room: params.room, action: params.action }
  },
})
```

#### `unregisterTool(toolName: string): Promise<void>`

Remove a previously registered tool.

```typescript
await ai.unregisterTool('control_lights')
```

#### `searchInternet(query: string, maxResults?: number): Promise<any>`

Use ORA AI's web search capability.

```typescript
const results = await ai.searchInternet('latest smart home trends', 5)
console.log(results) // Array of search results
```

#### `analyzeImage(imageUrl: string, prompt?: string): Promise<AIResponse>`

Analyze an image using vision AI.

```typescript
const analysis = await ai.analyzeImage(
  'https://example.com/security-camera.jpg',
  'Is there anyone in this image?'
)

console.log(analysis.message) // AI's description
```

#### `getHistory(limit?: number): Promise<any[]>`

Get conversation history for this plugin.

```typescript
const history = await ai.getHistory(20) // Last 20 messages
```

#### `clearHistory(): Promise<void>`

Clear the plugin's conversation history.

```typescript
await ai.clearHistory()
```

## Complete Example: Smart Automation Plugin

Here's a complete example showing how to create a plugin that uses AI to suggest automations:

```typescript
import { ServicePlugin, PluginContext } from '@/lib/plugins/types'
import { createPluginAIClient } from '@/lib/plugins/ai-integration'

export const plugin: ServicePlugin = {
  metadata: {
    id: 'smart-automation-ai',
    name: 'Smart Automation AI',
    version: '1.0.0',
    description: 'AI-powered automation suggestions',
    author: 'rumahl Team',
  },

  initialize: async () => {
    const ai = createPluginAIClient('smart-automation-ai')

    // Register automation suggestion tool
    await ai.registerTool({
      name: 'suggest_automation',
      description: 'Suggest smart home automations based on user patterns',
      parameters: [
        {
          name: 'area',
          type: 'string',
          description: 'Area or room to focus on',
          required: false,
        },
        {
          name: 'goal',
          type: 'string',
          description: 'What the user wants to achieve',
          required: true,
        },
      ],
      handler: async (params) => {
        // Analyze entity states
        const entities = await context.getStates()

        // Filter by area if specified
        let relevantEntities = entities
        if (params.area) {
          relevantEntities = entities.filter(e =>
            e.attributes.area === params.area
          )
        }

        // Generate suggestions using AI
        const response = await ai.chat({
          message: `Create automation suggestions for: ${params.goal}`,
          context: {
            entities: relevantEntities.map(e => e.entity_id),
            metadata: {
              area: params.area,
              goal: params.goal,
            },
          },
          systemPrompt: `You are a smart home automation expert.
            Suggest practical, safe automations based on available devices.
            Always consider energy efficiency and user comfort.`,
        })

        return {
          suggestions: response.message,
          entities_used: relevantEntities.length,
        }
      },
    })

    console.log('Smart Automation AI initialized')
  },

  destroy: async () => {
    const ai = createPluginAIClient('smart-automation-ai')
    await ai.unregisterTool('suggest_automation')
  },

  healthCheck: async () => {
    return true
  },
}
```

## Best Practices

### 1. **Provide Clear Tool Descriptions**

Make your tool descriptions specific and actionable:

```typescript
// ❌ Bad
description: 'Does something with lights'

// ✅ Good
description: 'Controls all lights in a specified room (turn on/off, set brightness 0-100, or set color)'
```

### 2. **Handle Errors Gracefully**

```typescript
handler: async (params) => {
  try {
    const result = await yourFunction(params)
    return { success: true, data: result }
  } catch (error) {
    return {
      success: false,
      error: error.message,
    }
  }
}
```

### 3. **Provide Context**

When calling AI, always include relevant context:

```typescript
const response = await ai.chat({
  message: userInput,
  context: {
    entities: relatedEntities,
    metadata: {
      time: new Date().toISOString(),
      location: 'home',
    },
  },
})
```

### 4. **Use Streaming for Long Responses**

For better UX, stream AI responses instead of waiting:

```typescript
let buffer = ''
for await (const chunk of ai.chatStream({ message: query })) {
  buffer += chunk
  updateUI(buffer) // Update UI incrementally
}
```

### 5. **Clean Up Resources**

Always unregister tools when your plugin is destroyed:

```typescript
destroy: async () => {
  const ai = createPluginAIClient('your-plugin-id')
  await ai.unregisterTool('your_tool_name')
}
```

## Security Considerations

1. **Validate Tool Parameters**: Always validate inputs before executing actions
2. **Rate Limiting**: Be mindful of API call frequency
3. **Permissions**: Tools should respect user permissions and security boundaries
4. **Sensitive Data**: Never include passwords or tokens in AI prompts
5. **User Confirmation**: For destructive actions, require user confirmation

## Examples Directory

Check out these example plugins:
- `examples/weather-ai-plugin/` - Weather data integration
- `examples/automation-suggester/` - AI-powered automation suggestions
- `examples/energy-optimizer/` - AI energy optimization recommendations

## Troubleshooting

### "Tool registration failed: 401"
→ Check that ORA Assist backend is running and accessible

### "AI call failed: 504"
→ AI provider might be slow or unavailable, check provider status

### Tool not being called by AI
→ Verify tool description is clear and parameters are well-defined

## Support

For help and questions:
- Documentation: [PLUGIN_GUIDE.md](./PLUGIN_GUIDE.md)
- Issues: https://github.com/rumahl/home-assistant-dashb/issues
