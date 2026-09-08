# Home Assistant Dashboard - Plugin System

## Overview

The Home Assistant Dashboard is built with extensibility at its core. The plugin system allows you to:

- **Create custom widgets** for any Home Assistant entity type
- **Add API endpoints** for external integrations
- **Register background services** for automation
- **Create custom themes** to personalize the UI
- **Switch backend providers** (direct HA, proxy server, etc.)

## Architecture

### Plugin Types

1. **Widget Plugins** - Custom UI components for entities
2. **API Plugins** - Custom REST endpoints
3. **Service Plugins** - Background services and automation
4. **Theme Plugins** - Custom color schemes and styling

### Core Components

```
src/lib/plugins/
├── types.ts          # Plugin type definitions
├── registry.ts       # Plugin registry and loader
└── examples/         # Example plugins

src/lib/backend/
└── provider.ts       # Backend abstraction layer

backend/              # Rust/Axum backend (optional)
├── src/
│   ├── main.rs      # Server entry point
│   ├── ha_client.rs # Home Assistant client
│   └── websocket.rs # WebSocket handler
└── Cargo.toml
```

## Creating a Widget Plugin

### Basic Structure

```typescript
import { WidgetPlugin, WidgetPluginProps } from '@/lib/plugins/types'
import { motion } from 'framer-motion'

// 1. Define your component
function CustomWidget({ entity, config, onUpdate, onCallService }: WidgetPluginProps) {
  const handleToggle = async () => {
    await onCallService?.(entity.entity_id.split('.')[0], 'toggle', {
      entity_id: entity.entity_id,
    })
    onUpdate?.()
  }

  return (
    <motion.div
      className="glass-card p-4 rounded-2xl"
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
      onClick={handleToggle}
    >
      <h3>{entity.attributes.friendly_name || entity.entity_id}</h3>
      <p>State: {entity.state}</p>
    </motion.div>
  )
}

// 2. Export plugin definition
export const plugin: WidgetPlugin = {
  metadata: {
    id: 'custom-widget',
    name: 'Custom Widget',
    version: '1.0.0',
    description: 'A custom widget example',
    author: 'Your Name',
    supportedDomains: ['switch', 'light'],
  },
  component: CustomWidget,
}

export default plugin
```

### Registering the Plugin

```typescript
import { pluginRegistry } from '@/lib/plugins/registry'
import myPlugin from './plugins/my-plugin'

// Register widget plugin
pluginRegistry.registerWidget(myPlugin)
```

### Loading from URL

```typescript
import { pluginRegistry } from '@/lib/plugins/registry'

// Load plugin from external URL
await pluginRegistry.loadPlugin({
  metadata: {
    id: 'external-widget',
    name: 'External Widget',
    version: '1.0.0',
    description: 'Widget from external source',
    author: 'External Author',
  },
  entry: 'https://example.com/plugins/widget.js',
  type: 'widget',
  permissions: ['homeassistant', 'storage'],
})
```

## Creating an API Plugin

```typescript
import { APIPlugin, APIRequest, APIResponse } from '@/lib/plugins/types'

const weatherAPIPlugin: APIPlugin = {
  metadata: {
    id: 'weather-api',
    name: 'Weather API',
    version: '1.0.0',
    description: 'Custom weather API endpoint',
    author: 'Your Name',
  },
  endpoint: '/weather',
  handler: async (request: APIRequest): Promise<APIResponse> => {
    if (request.method === 'GET') {
      // Fetch data from external API
      const response = await fetch('https://api.weather.com/...')
      const data = await response.json()

      return {
        status: 200,
        body: data,
      }
    }

    return {
      status: 405,
      body: { error: 'Method not allowed' },
    }
  },
}

pluginRegistry.registerAPI(weatherAPIPlugin)
```

## Creating a Service Plugin

```typescript
import { ServicePlugin } from '@/lib/plugins/types'

const automationService: ServicePlugin = {
  metadata: {
    id: 'auto-lights',
    name: 'Automatic Lights',
    version: '1.0.0',
    description: 'Automatically control lights based on time',
    author: 'Your Name',
  },
  initialize: async () => {
    console.log('Automation service started')
    // Set up intervals, event listeners, etc.
  },
  destroy: async () => {
    console.log('Automation service stopped')
    // Clean up intervals, listeners, etc.
  },
  healthCheck: async () => {
    return true
  },
}

await pluginRegistry.registerService(automationService)
```

## Creating a Theme Plugin

```typescript
import { ThemePlugin } from '@/lib/plugins/types'

const darkTheme: ThemePlugin = {
  metadata: {
    id: 'midnight-theme',
    name: 'Midnight Theme',
    version: '1.0.0',
    description: 'A dark theme for night owls',
    author: 'Your Name',
  },
  themeName: 'midnight',
  cssVariables: {
    '--background': 'oklch(0.15 0.01 240)',
    '--foreground': 'oklch(0.95 0.01 240)',
    '--accent': 'oklch(0.60 0.25 280)',
    '--success': 'oklch(0.65 0.20 140)',
    '--destructive': 'oklch(0.55 0.25 25)',
  },
}

pluginRegistry.registerTheme(darkTheme)
```

## Backend Integration

### Using the Rust Backend

1. **Configure environment variables:**

```bash
# .env file
HA_URL=http://homeassistant.local:8123
HA_TOKEN=your_long_lived_access_token
```

2. **Start the backend:**

```bash
cd backend
cargo run --release
```

3. **Configure frontend to use proxy backend:**

```typescript
import { backendManager } from '@/lib/backend/provider'

await backendManager.setProvider('proxy', {
  url: 'http://localhost:3001',
  useWebSocket: true, // Enable real-time updates
})
```

### Creating a Custom Backend Provider

```typescript
import { BackendProvider, BackendConfig } from '@/lib/backend/provider'
import { backendManager } from '@/lib/backend/provider'

class MyCustomProvider implements BackendProvider {
  name = 'my-custom-backend'

  async initialize(config: BackendConfig): Promise<void> {
    // Initialize your backend connection
  }

  async getStates(): Promise<EntityState[]> {
    // Fetch states from your backend
  }

  async callService(domain: string, service: string, data?: any): Promise<void> {
    // Call service through your backend
  }

  // ... implement other methods
}

// Register custom provider
backendManager.registerProvider('my-custom', MyCustomProvider)

// Use it
await backendManager.setProvider('my-custom', {
  url: 'https://my-backend.com',
})
```

## Plugin Context API

Plugins have access to a powerful context API:

```typescript
import { PluginContext } from '@/lib/plugins/types'

function usePluginContext(context: PluginContext) {
  // Call Home Assistant services
  await context.callService('light', 'turn_on', {
    entity_id: 'light.living_room',
    brightness: 255,
  })

  // Get entity states
  const states = await context.getStates()
  const light = await context.getState('light.living_room')

  // Store plugin data
  await context.storage.set('my-plugin-data', { value: 123 })
  const data = await context.storage.get('my-plugin-data')

  // Show notifications
  context.notify('Operation completed', 'success')

  // Subscribe to entity changes
  const unsubscribe = context.subscribe('light.living_room', (entity) => {
    console.log('Light state changed:', entity.state)
  })

  // Clean up
  unsubscribe()
}
```

## Best Practices

### 1. Type Safety

Always use TypeScript and the provided types:

```typescript
import type { WidgetPluginProps, EntityState } from '@/lib/plugins/types'
```

### 2. Error Handling

Gracefully handle errors and provide feedback:

```typescript
try {
  await onCallService?.(domain, service, data)
  context.notify('Success!', 'success')
} catch (error) {
  console.error('Service call failed:', error)
  context.notify('Operation failed', 'error')
}
```

### 3. Performance

- Use React hooks for state management
- Implement proper cleanup in `useEffect`
- Memoize expensive computations

```typescript
import { useMemo, useCallback } from 'react'

const computedValue = useMemo(() => expensiveCalculation(data), [data])
const handleClick = useCallback(() => { /* ... */ }, [dependencies])
```

### 4. Styling

Follow the existing design system:

```typescript
// Use existing classes
<div className="glass-card rounded-2xl p-4">

// Use CSS variables
style={{ backgroundColor: 'var(--accent)' }}

// Use Framer Motion for animations
<motion.div
  whileHover={{ scale: 1.02 }}
  whileTap={{ scale: 0.98 }}
>
```

### 5. Accessibility

- Provide proper ARIA labels
- Support keyboard navigation
- Use semantic HTML

```typescript
<button
  aria-label="Toggle light"
  onClick={handleToggle}
>
  Toggle
</button>
```

## Example: Complete Weather Widget Plugin

See `src/lib/plugins/examples/weather-widget.tsx` for a complete, production-ready example.

## Testing Plugins

```typescript
import { pluginRegistry } from '@/lib/plugins/registry'

// Test widget rendering
const widget = pluginRegistry.getWidget('my-plugin')
expect(widget).toBeDefined()
expect(widget.metadata.id).toBe('my-plugin')

// Test service initialization
const service = pluginRegistry.getAllServices().find(s => s.metadata.id === 'my-service')
expect(service).toBeDefined()
```

## Security Considerations

1. **Validate plugin sources** - Only load plugins from trusted sources
2. **Sandbox plugins** - Consider using iframes for untrusted plugins
3. **Permission system** - Check required permissions before loading
4. **Token security** - Never expose HA tokens in plugins
5. **Input validation** - Validate all user inputs and API responses

## Publishing Plugins

Create a `plugin.json` manifest:

```json
{
  "metadata": {
    "id": "my-awesome-plugin",
    "name": "My Awesome Plugin",
    "version": "1.0.0",
    "description": "Does awesome things",
    "author": "Your Name"
  },
  "entry": "https://cdn.example.com/plugins/my-plugin.js",
  "type": "widget",
  "dependencies": {
    "framer-motion": "^12.0.0"
  },
  "permissions": ["homeassistant", "storage"]
}
```

## Support

For questions and support:
- GitHub Issues: https://github.com/rumahl/home-assistant-dashb/issues
- Documentation: https://github.com/rumahl/home-assistant-dashb/wiki
