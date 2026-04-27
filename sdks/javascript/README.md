# IORA JavaScript/TypeScript SDK

Official JavaScript and TypeScript SDK for developing IORA apps and plugins with iframe integration.

## Features

- 🌐 **HTTP Client** - REST API client for IORA backend services
- 🔒 **Iframe SDK** - Secure postMessage communication for iframe-based apps
- 📦 **TypeScript Support** - Full type definitions for type-safe development
- 🔑 **Permission Management** - Built-in permission enums and risk assessment
- 📝 **Manifest Builder** - Programmatic app manifest creation
- 🎯 **Event System** - Subscribe to IORA events in real-time

## Installation

```bash
npm install @iora/sdk
```

Or with yarn:

```bash
yarn add @iora/sdk
```

## Quick Start

### For Iframe-based Apps (Recommended)

If your app runs inside an iframe within IORA, use the IoraIframe client:

```typescript
import { createIoraIframe } from '@iora/sdk';

// Initialize the SDK
const iora = createIoraIframe('your-app-id');

// Wait for SDK to be ready
await iora.ready();

// Get all entities
const entities = await iora.getEntities();

// Control a device
await iora.callService('light', 'turn_on', 'light.living_room', {
  brightness: 255,
  color_name: 'blue'
});

// Send a notification
await iora.sendNotification('Hello', 'App is ready!');

// Subscribe to entity state changes
iora.on('entity_state_changed', (event) => {
  console.log('Entity changed:', event.data);
});
```

### For HTTP-based Apps

If your app runs externally and needs to make HTTP requests to IORA:

```typescript
import { IoraClient } from '@iora/sdk';

// Initialize client
const client = new IoraClient('http://localhost:8080', 'your-api-key');

// Get entities
const entities = await client.entities.list();

// Turn on a light
await client.entities.turnOn('light.living_room', {
  brightness: 200
});

// Send notification
await client.notifications.send({
  title: 'Alert',
  message: 'Something happened!',
  priority: 'high'
});

// Store data
await client.storage.set('my-key', { some: 'data' });
const data = await client.storage.get('my-key');
```

## API Reference

### IoraIframe (Iframe SDK)

The IoraIframe class provides secure communication between your iframe app and IORA.

#### Constructor

```typescript
const iora = new IoraIframe(appId: string, parentOrigin?: string);
```

- `appId`: Your app's unique identifier
- `parentOrigin`: (Optional) Parent window origin for security. Defaults to auto-detect.

#### Methods

**ready(): Promise\<void\>**
Wait for the SDK to initialize and receive security token.

```typescript
await iora.ready();
```

**call\<T\>(method: string, ...params: any[]): Promise\<T\>**
Call any IORA API method.

```typescript
const result = await iora.call('entities.get', 'light.bedroom');
```

**Entity Management**

```typescript
// Get all entities
const entities = await iora.getEntities();

// Get specific entity
const entity = await iora.getEntity('light.living_room');

// Call a service
await iora.callService('light', 'turn_on', 'light.bedroom', {
  brightness: 255
});
```

**Notifications**

```typescript
await iora.sendNotification('Title', 'Message', {
  priority: 'high',
  icon: 'bell'
});
```

**Storage**

```typescript
// Store data
await iora.setStorage('key', { myData: 'value' });

// Retrieve data
const data = await iora.getStorage('key');

// Delete data
await iora.deleteStorage('key');
```

**Settings**

```typescript
// Get app settings
const settings = await iora.getSettings();

// Update settings
await iora.updateSettings({ theme: 'dark', interval: 60 });
```

**UI Control**

```typescript
// Request fullscreen
await iora.requestFullscreen();

// Exit fullscreen
await iora.exitFullscreen();

// Show toast message
await iora.showToast('Success!', 'success');

// Navigate to a page
await iora.navigateTo('page-id');
```

**Events**

```typescript
// Subscribe to events
const unsubscribe = iora.on('entity_state_changed', (event) => {
  console.log('Entity:', event.data.entity_id);
  console.log('New state:', event.data.state);
});

// Unsubscribe
unsubscribe();
```

**Permissions**

```typescript
// Check permission
const hasPermission = await iora.hasPermission('NetworkAccess');

// Request permission
const granted = await iora.requestPermission('CameraAccess');
```

### IoraClient (HTTP SDK)

HTTP client for making REST API calls to IORA.

#### Constructor

```typescript
const client = new IoraClient(baseUrl?: string, apiKey?: string);
```

- `baseUrl`: IORA instance URL (default: 'http://localhost:8080')
- `apiKey`: API key for authentication

#### Entity API

```typescript
// List all entities
const entities = await client.entities.list();

// Get specific entity
const entity = await client.entities.get('light.bedroom');

// Call service
await client.entities.callService({
  domain: 'light',
  service: 'turn_on',
  entity_id: 'light.bedroom',
  service_data: { brightness: 200 }
});

// Convenience methods
await client.entities.turnOn('light.bedroom', { brightness: 200 });
await client.entities.turnOff('light.bedroom');
```

#### Notifications API

```typescript
// Send notification
await client.notifications.send({
  title: 'Alert',
  message: 'Something happened',
  priority: 'high',
  actions: [
    { action: 'view', title: 'View' },
    { action: 'dismiss', title: 'Dismiss' }
  ]
});

// List notifications
const notifications = await client.notifications.list();
```

#### Storage API

```typescript
// Store value
await client.storage.set('my-key', { data: 'value' });

// Get value
const value = await client.storage.get<MyType>('my-key');

// Delete value
await client.storage.delete('my-key');
```

#### Settings API

```typescript
// Get app settings
const settings = await client.settings.get('app-id');

// Update settings
await client.settings.update('app-id', {
  theme: 'dark',
  interval: 300
});
```

### Manifest Builder

Build app manifests programmatically:

```typescript
import { ManifestBuilder, Permission } from '@iora/sdk';

const manifest = new ManifestBuilder('my-app', 'My App')
  .version('1.0.0')
  .developer('Your Name')
  .description('An awesome IORA app')
  .permissions([
    Permission.ReadEntities,
    Permission.ControlEntities,
    Permission.StorageWrite,
    Permission.SendNotifications
  ])
  .customPage({
    id: 'dashboard',
    title: 'Dashboard',
    icon: 'chart-line',
    url: '/dashboard',
    iframe: true,
    iframe_config: {
      sandbox: ['allow-scripts', 'allow-same-origin'],
      allow: ['camera', 'microphone'],
      security_token: true
    }
  })
  .networkAccess({
    allowed_domains: ['api.example.com'],
    allow_user_domains: true
  })
  .settingsSchema({
    title: 'App Settings',
    description: 'Configure your app',
    fields: [
      {
        key: 'api_key',
        label: 'API Key',
        type: 'password',
        required: true
      },
      {
        key: 'interval',
        label: 'Update Interval (seconds)',
        type: 'number',
        default: 60,
        validation: { min: 10, max: 3600 }
      }
    ]
  })
  .build();

// Export as JSON
const manifestJson = new ManifestBuilder('my-app', 'My App')
  .version('1.0.0')
  .toJSON();
```

### Permissions

```typescript
import { Permission, getPermissionRiskLevel, getPermissionDescription } from '@iora/sdk';

// Use permissions
const perms = [
  Permission.ReadEntities,
  Permission.ControlEntities,
  Permission.NetworkAccess
];

// Get risk level
const risk = getPermissionRiskLevel(Permission.NetworkScan);
// Returns: RiskLevel.Critical

// Get description
const desc = getPermissionDescription(Permission.CameraAccess);
// Returns: "Access camera"
```

## TypeScript Types

All types are exported for TypeScript users:

```typescript
import type {
  Entity,
  ServiceCall,
  NotificationPayload,
  AppSettings,
  IoraEvent,
  IframeMessage,
  AppManifest,
  CustomPage,
  IframeConfig,
  SettingsSchema
} from '@iora/sdk';
```

## Complete Example: Weather Dashboard

```typescript
import { createIoraIframe, Permission } from '@iora/sdk';

// Initialize SDK
const iora = createIoraIframe('weather-dashboard');

async function init() {
  await iora.ready();

  // Get settings
  const settings = await iora.getSettings();
  const apiKey = settings.api_key;
  const updateInterval = settings.update_interval || 300;

  // Fetch weather data
  async function updateWeather() {
    try {
      const response = await fetch(`https://api.weather.com/data?key=${apiKey}`);
      const weather = await response.json();

      // Store in IORA
      await iora.setStorage('current_weather', weather);

      // Update UI
      document.getElementById('temp').textContent = `${weather.temp}°C`;
      document.getElementById('condition').textContent = weather.condition;

      // Send notification if severe weather
      if (weather.severity === 'high') {
        await iora.sendNotification(
          'Severe Weather Alert',
          `${weather.condition} expected in your area`,
          { priority: 'high' }
        );
      }
    } catch (error) {
      await iora.showToast('Failed to update weather', 'error');
    }
  }

  // Update immediately and set interval
  updateWeather();
  setInterval(updateWeather, updateInterval * 1000);

  // Subscribe to settings changes
  iora.on('settings_changed', async (event) => {
    if (event.data.app_id === 'weather-dashboard') {
      const newSettings = await iora.getSettings();
      // Restart with new settings
      location.reload();
    }
  });
}

init();
```

## Security Best Practices

### 1. Always Validate Parent Origin

```typescript
// Specify parent origin explicitly
const iora = new IoraIframe('my-app', 'https://my-iora-instance.com');
```

### 2. Use Security Tokens

Always enable security tokens in your iframe config:

```json
{
  "iframe_config": {
    "security_token": true
  }
}
```

### 3. Minimal Sandbox Permissions

Only request the sandbox permissions you need:

```json
{
  "iframe_config": {
    "sandbox": ["allow-scripts", "allow-same-origin"]
  }
}
```

### 4. Request Minimal Permissions

Only request the IORA permissions your app actually needs:

```typescript
.permissions([
  Permission.ReadEntities,
  Permission.StorageRead
])
```

## Building Your App

### 1. Development

```bash
npm install
npm run dev
```

### 2. Build

```bash
npm run build
```

### 3. Create Manifest

Create a `manifest.json` file:

```json
{
  "id": "my-app",
  "name": "My App",
  "version": "1.0.0",
  "developer": "Your Name",
  "description": "An awesome IORA app",
  "type": "app",
  "permissions": [
    "ReadEntities",
    "StorageWrite"
  ],
  "custom_pages": [
    {
      "id": "main",
      "title": "My App",
      "icon": "app",
      "url": "/",
      "iframe": true,
      "iframe_config": {
        "sandbox": ["allow-scripts", "allow-same-origin"],
        "security_token": true
      }
    }
  ],
  "settings_schema": {
    "title": "Settings",
    "description": "Configure your app",
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

## Browser Support

- Chrome/Edge: Latest 2 versions
- Firefox: Latest 2 versions
- Safari: Latest 2 versions

The SDK uses modern JavaScript features and requires:
- postMessage API
- Fetch API
- Promises/async-await
- ES6 modules

## License

MIT

## Support

For issues and questions:
- GitHub Issues: https://github.com/your-org/iora-sdk
- Documentation: https://docs.iora.io
- Community: https://community.iora.io
