# rumahl JavaScript/TypeScript SDK

Official JavaScript and TypeScript SDK for developing rumahl apps and plugins with iframe integration.

## Features

- 🌐 **HTTP Client** - REST API client for rumahl backend services
- 🔒 **Iframe SDK** - Secure postMessage communication for iframe-based apps
- 📦 **TypeScript Support** - Full type definitions for type-safe development
- 🔑 **Permission Management** - Built-in permission enums and risk assessment
- 📝 **Manifest Builder** - Programmatic app manifest creation
- 🎯 **Event System** - Subscribe to rumahl events in real-time

## Installation

```bash
npm install @rumahl/sdk
```

Or with yarn:

```bash
yarn add @rumahl/sdk
```

## Quick Start

### For Iframe-based Apps (Recommended)

If your app runs inside an iframe within rumahl, use the rumahlIframe client:

```typescript
import { createrumahlIframe } from '@rumahl/sdk';

// Initialize the SDK
const ora = createrumahlIframe('your-app-id');

// Wait for SDK to be ready
await ora.ready();

// Get all entities
const entities = await ora.getEntities();

// Control a device
await ora.callService('light', 'turn_on', 'light.living_room', {
  brightness: 255,
  color_name: 'blue'
});

// Send a notification
await ora.sendNotification('Hello', 'App is ready!');

// Subscribe to entity state changes
ora.on('entity_state_changed', (event) => {
  console.log('Entity changed:', event.data);
});
```

### For HTTP-based Apps

If your app runs externally and needs to make HTTP requests to rumahl:

```typescript
import { rumahlClient } from '@rumahl/sdk';

// Initialize client
const client = new rumahlClient('http://localhost:8080', 'your-api-key');

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

### rumahlIframe (Iframe SDK)

The rumahlIframe class provides secure communication between your iframe app and rumahl.

#### Constructor

```typescript
const ora = new rumahlIframe(appId: string, parentOrigin?: string);
```

- `appId`: Your app's unique identifier
- `parentOrigin`: (Optional) Parent window origin for security. Defaults to auto-detect.

#### Methods

**ready(): Promise\<void\>**
Wait for the SDK to initialize and receive security token.

```typescript
await ora.ready();
```

**call\<T\>(method: string, ...params: any[]): Promise\<T\>**
Call any rumahl API method.

```typescript
const result = await ora.call('entities.get', 'light.bedroom');
```

**Entity Management**

```typescript
// Get all entities
const entities = await ora.getEntities();

// Get specific entity
const entity = await ora.getEntity('light.living_room');

// Call a service
await ora.callService('light', 'turn_on', 'light.bedroom', {
  brightness: 255
});
```

**Notifications**

```typescript
await ora.sendNotification('Title', 'Message', {
  priority: 'high',
  icon: 'bell'
});
```

**Storage**

```typescript
// Store data
await ora.setStorage('key', { myData: 'value' });

// Retrieve data
const data = await ora.getStorage('key');

// Delete data
await ora.deleteStorage('key');
```

**Settings**

```typescript
// Get app settings
const settings = await ora.getSettings();

// Update settings
await ora.updateSettings({ theme: 'dark', interval: 60 });
```

**UI Control**

```typescript
// Request fullscreen
await ora.requestFullscreen();

// Exit fullscreen
await ora.exitFullscreen();

// Show toast message
await ora.showToast('Success!', 'success');

// Navigate to a page
await ora.navigateTo('page-id');
```

**Events**

```typescript
// Subscribe to events
const unsubscribe = ora.on('entity_state_changed', (event) => {
  console.log('Entity:', event.data.entity_id);
  console.log('New state:', event.data.state);
});

// Unsubscribe
unsubscribe();
```

**Permissions**

```typescript
// Check permission
const hasPermission = await ora.hasPermission('NetworkAccess');

// Request permission
const granted = await ora.requestPermission('CameraAccess');
```

### rumahlClient (HTTP SDK)

HTTP client for making REST API calls to rumahl.

#### Constructor

```typescript
const client = new rumahlClient(baseUrl?: string, apiKey?: string);
```

- `baseUrl`: rumahl instance URL (default: 'http://localhost:8080')
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
import { ManifestBuilder, Permission } from '@rumahl/sdk';

const manifest = new ManifestBuilder('my-app', 'My App')
  .version('1.0.0')
  .developer('Your Name')
  .description('An awesome rumahl app')
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
import { Permission, getPermissionRiskLevel, getPermissionDescription } from '@rumahl/sdk';

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
  rumahlEvent,
  IframeMessage,
  AppManifest,
  CustomPage,
  IframeConfig,
  SettingsSchema
} from '@rumahl/sdk';
```

## Complete Example: Weather Dashboard

```typescript
import { createrumahlIframe, Permission } from '@rumahl/sdk';

// Initialize SDK
const ora = createrumahlIframe('weather-dashboard');

async function init() {
  await ora.ready();

  // Get settings
  const settings = await ora.getSettings();
  const apiKey = settings.api_key;
  const updateInterval = settings.update_interval || 300;

  // Fetch weather data
  async function updateWeather() {
    try {
      const response = await fetch(`https://api.weather.com/data?key=${apiKey}`);
      const weather = await response.json();

      // Store in rumahl
      await ora.setStorage('current_weather', weather);

      // Update UI
      document.getElementById('temp').textContent = `${weather.temp}°C`;
      document.getElementById('condition').textContent = weather.condition;

      // Send notification if severe weather
      if (weather.severity === 'high') {
        await ora.sendNotification(
          'Severe Weather Alert',
          `${weather.condition} expected in your area`,
          { priority: 'high' }
        );
      }
    } catch (error) {
      await ora.showToast('Failed to update weather', 'error');
    }
  }

  // Update immediately and set interval
  updateWeather();
  setInterval(updateWeather, updateInterval * 1000);

  // Subscribe to settings changes
  ora.on('settings_changed', async (event) => {
    if (event.data.app_id === 'weather-dashboard') {
      const newSettings = await ora.getSettings();
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
const ora = new rumahlIframe('my-app', 'https://my-rumahl-instance.com');
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

Only request the rumahl permissions your app actually needs:

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
  "description": "An awesome rumahl app",
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
- GitHub Issues: https://github.com/your-org/rumahl-sdk
- Documentation: https://docs.ora.io
- Community: https://community.ora.io
