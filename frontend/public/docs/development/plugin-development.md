# Plugin Development Guide

This guide will help you create plugins for the IORA platform.

## Table of Contents

- [Overview](#overview)
- [Plugin Types](#plugin-types)
- [Prerequisites](#prerequisites)
- [Creating Your First Plugin](#creating-your-first-plugin)
- [Manifest Configuration](#manifest-configuration)
- [Sandbox Configuration](#sandbox-configuration)
- [Plugin API](#plugin-api)
- [Widget Plugins](#widget-plugins)
- [Service Plugins](#service-plugins)
- [Integration Plugins](#integration-plugins)
- [Testing](#testing)
- [Publishing](#publishing)

## Overview

IORA plugins are lightweight extensions that run in a sandboxed environment. Unlike apps, plugins:

- Run directly in IORA's runtime (no Docker container)
- Have stricter resource limits
- Can extend IORA's core functionality
- Are faster to load and execute
- Perfect for widgets, automations, and integrations

## Plugin Types

### 1. Widget
Dashboard widgets that display information or controls.

### 2. Service
Background services that process data or events.

### 3. API
Extend IORA's API with new endpoints.

### 4. Integration
Connect IORA to external services or devices.

### 5. Theme
Customize IORA's appearance.

### 6. Automation
Create custom automation triggers and actions.

### 7. Data Processor
Process and transform data streams.

## Prerequisites

- JavaScript/TypeScript knowledge
- Understanding of IORA's API
- Familiarity with async programming
- Knowledge of the plugin type you're creating

## Creating Your First Plugin

### Step 1: Create the Manifest

Create a `manifest.json` file for a simple widget plugin:

```json
{
  "id": "my-first-widget",
  "name": "My First Widget",
  "version": "1.0.0",
  "developer": "Your Name",
  "description": "A simple dashboard widget",
  "type": "plugin",
  "plugin_type": "widget",
  "icon": "icon.png",
  "permissions": [
    "RegisterWidget",
    "ReadEntities"
  ],
  "sandbox": {
    "max_execution_time_ms": 5000,
    "max_memory_mb": 50,
    "allow_network": true,
    "allow_file_system": false
  },
  "widgets": [
    {
      "id": "status-widget",
      "name": "Status Widget",
      "widget_type": "card",
      "component_url": "widget.js",
      "default_config": {
        "refresh_interval": 30
      }
    }
  ]
}
```

### Step 2: Create the Widget Code

Create `widget.js`:

```javascript
class StatusWidget {
  constructor(config) {
    this.config = config;
    this.data = null;
  }

  async init() {
    console.log('Widget initialized');
    await this.refresh();

    // Set up auto-refresh
    setInterval(() => {
      this.refresh();
    }, (this.config.refresh_interval || 30) * 1000);
  }

  async refresh() {
    try {
      // Fetch data from IORA API
      const response = await fetch('/api/core/system-info');
      this.data = await response.json();
      this.render();
    } catch (error) {
      console.error('Failed to fetch data:', error);
    }
  }

  render() {
    const container = document.getElementById('widget-container');
    if (!container || !this.data) return;

    container.innerHTML = `
      <div class="status-widget">
        <h3>System Status</h3>
        <div class="stat">
          <span class="label">Uptime:</span>
          <span class="value">${this.data.uptime_seconds}s</span>
        </div>
        <div class="stat">
          <span class="label">Memory:</span>
          <span class="value">${this.data.memory_usage}%</span>
        </div>
      </div>
    `;
  }
}

// Export the widget class
export default StatusWidget;
```

### Step 3: Package Your Plugin

Create a ZIP file:

```bash
zip -r my-first-widget.zip manifest.json icon.png widget.js styles.css
```

### Step 4: Install in IORA

1. Open IORA Control Center
2. Navigate to Plugins
3. Click "Install Plugin"
4. Upload `my-first-widget.zip`
5. Review and accept permissions
6. Plugin is installed and ready to use

## Manifest Configuration

### Required Fields

```json
{
  "id": "unique-plugin-id",
  "name": "Plugin Name",
  "version": "1.0.0",
  "developer": "Your Name",
  "description": "Plugin description",
  "type": "plugin",
  "plugin_type": "widget"  // or service, api, integration, etc.
}
```

### Plugin-Specific Fields

**For Widget Plugins:**
```json
{
  "widgets": [
    {
      "id": "widget-id",
      "name": "Widget Name",
      "widget_type": "card",  // card, graph, table, custom
      "component_url": "widget.js",
      "default_config": {
        "setting1": "value1"
      }
    }
  ]
}
```

**For Service Plugins:**
```json
{
  "endpoints": [
    {
      "path": "/api/plugin/my-service",
      "method": "GET",
      "description": "Service endpoint",
      "requires_auth": true
    }
  ]
}
```

**For Integration Plugins:**
```json
{
  "settings_schema": {
    "title": "Integration Settings",
    "fields": [
      {
        "key": "api_key",
        "label": "API Key",
        "type": "password",
        "required": true
      }
    ]
  }
}
```

## Sandbox Configuration

Plugins run in a sandboxed environment with resource limits:

```json
{
  "sandbox": {
    "max_execution_time_ms": 5000,    // Max 10 seconds
    "max_memory_mb": 100,               // Max 512 MB
    "allow_network": true,              // Network access
    "allow_file_system": false          // File system access
  }
}
```

**Sandbox Restrictions:**
- No direct file system access (unless permitted)
- Limited execution time
- Memory limits enforced
- Network access controlled by permissions
- No access to other plugins or IORA internals

## Plugin API

Plugins can use the IORA Plugin API:

```javascript
// Get IORA API instance
const iora = window.IORA;

// Read entities
const entities = await iora.entities.list();
const entity = await iora.entities.get('light.living_room');

// Control entities
await iora.entities.setState('light.living_room', 'on');
await iora.entities.callService('light', 'turn_on', {
  entity_id: 'light.living_room',
  brightness: 255
});

// Send notifications
await iora.notifications.send({
  title: 'Plugin Alert',
  message: 'Something happened!',
  type: 'info'
});

// Store data
await iora.storage.set('my_data', { value: 123 });
const data = await iora.storage.get('my_data');

// Register API endpoint
iora.api.register('/api/plugin/my-endpoint', async (req) => {
  return { status: 'ok', data: 'Hello' };
});
```

## Widget Plugins

### Widget Lifecycle

```javascript
class MyWidget {
  constructor(config) {
    // Initialize with configuration
    this.config = config;
  }

  async init() {
    // Called when widget is loaded
    // Set up event listeners, fetch initial data
  }

  async refresh() {
    // Called periodically or manually
    // Fetch new data and update display
  }

  render() {
    // Update the DOM
  }

  destroy() {
    // Clean up resources when widget is removed
  }
}
```

### Widget Configuration

```json
{
  "widgets": [
    {
      "id": "weather-widget",
      "name": "Weather",
      "widget_type": "card",
      "component_url": "weather.js",
      "default_config": {
        "location": "New York",
        "units": "metric",
        "refresh_interval": 300
      }
    }
  ]
}
```

### Configurable Widgets

```javascript
class ConfigurableWidget {
  constructor(config) {
    this.location = config.location || 'London';
    this.units = config.units || 'metric';
  }

  async init() {
    // Use configuration values
    const weather = await this.fetchWeather(this.location, this.units);
    this.render(weather);
  }
}
```

## Service Plugins

Service plugins run in the background:

```javascript
class MyService {
  constructor() {
    this.isRunning = false;
  }

  async start() {
    this.isRunning = true;
    console.log('Service started');

    // Start background task
    this.intervalId = setInterval(() => {
      this.processData();
    }, 60000); // Every minute
  }

  async processData() {
    // Background processing
    const data = await this.fetchData();
    await this.processAndStore(data);
  }

  async stop() {
    this.isRunning = false;
    clearInterval(this.intervalId);
    console.log('Service stopped');
  }
}

export default MyService;
```

## Integration Plugins

Connect to external services:

```javascript
class ExternalServiceIntegration {
  constructor(config) {
    this.apiKey = config.api_key;
    this.baseUrl = 'https://api.example.com';
  }

  async init() {
    // Verify API key
    const isValid = await this.verifyApiKey();
    if (!isValid) {
      throw new Error('Invalid API key');
    }

    // Start listening for events
    this.startEventListener();
  }

  async fetchData(endpoint) {
    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      headers: {
        'Authorization': `Bearer ${this.apiKey}`
      }
    });
    return await response.json();
  }

  async syncDevices() {
    const devices = await this.fetchData('/devices');

    // Create IORA entities for each device
    for (const device of devices) {
      await iora.entities.create({
        id: `external.${device.id}`,
        name: device.name,
        type: device.type,
        state: device.state
      });
    }
  }
}

export default ExternalServiceIntegration;
```

## Testing

### Local Testing

Test plugin code before packaging:

```javascript
// test.js
const MyWidget = require('./widget.js');

const config = {
  refresh_interval: 30,
  location: 'Test'
};

const widget = new MyWidget(config);
widget.init();

// Test methods
console.assert(widget.config.location === 'Test', 'Config not set correctly');
```

### Testing in IORA

1. Install plugin in development mode
2. Check console for errors
3. Verify resource usage
4. Test all functionality
5. Check performance

### Resource Monitoring

Monitor plugin resource usage:

```javascript
// Check memory usage
console.log('Memory:', performance.memory.usedJSHeapSize);

// Check execution time
const start = Date.now();
await myFunction();
const duration = Date.now() - start;
console.log('Execution time:', duration, 'ms');
```

## Publishing

### Pre-Publishing Checklist

- [ ] Test thoroughly in different scenarios
- [ ] Optimize resource usage
- [ ] Add comprehensive README
- [ ] Include examples and screenshots
- [ ] Document all configuration options
- [ ] Handle errors gracefully
- [ ] Add proper logging

### Store Metadata

```json
{
  "store_metadata": {
    "category": "Widgets",
    "tags": ["dashboard", "monitoring"],
    "screenshots": ["screenshots/1.png"],
    "homepage": "https://example.com",
    "source_url": "https://github.com/user/my-plugin",
    "license": "MIT"
  }
}
```

## Best Practices

1. **Performance**
   - Keep execution time minimal
   - Use caching appropriately
   - Debounce frequent operations
   - Clean up resources in `destroy()`

2. **Security**
   - Validate all inputs
   - Don't expose sensitive data
   - Use HTTPS for external APIs
   - Request minimal permissions

3. **Compatibility**
   - Handle API changes gracefully
   - Provide fallbacks for missing features
   - Test on different IORA versions
   - Document dependencies

4. **User Experience**
   - Provide meaningful error messages
   - Show loading states
   - Make configuration intuitive
   - Include help documentation

## Examples

- [Simple Widget](examples/simple-widget/) - Basic dashboard widget
- [Background Service](examples/background-service/) - Data processing service
- [API Extension](examples/api-extension/) - Custom API endpoints
- [Device Integration](examples/device-integration/) - External device integration

## Troubleshooting

### Plugin Won't Load

- Check manifest syntax
- Verify plugin type is correct
- Review sandbox configuration
- Check console for JavaScript errors

### Resource Limit Exceeded

- Optimize code for better performance
- Reduce memory usage
- Request higher limits if necessary
- Use Web Workers for heavy computation

### Permission Denied

- Check requested permissions
- Verify permission approval
- Review sandbox restrictions

## Next Steps

- [App Development](app-development.md)
- [Permissions Reference](permissions.md)
- [Plugin API Documentation](../api/plugin-api.md)
- [Widget Development Guide](../guides/widget-development.md)

## Support

- [GitHub Issues](https://github.com/kaimdt/home-assistant-dashb/issues)
- [Community Forum](https://github.com/kaimdt/home-assistant-dashb/discussions)
- [Plugin Development Chat](https://github.com/kaimdt/home-assistant-dashb/discussions/categories/plugin-development)
