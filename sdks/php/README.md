# IORA PHP SDK

Official PHP SDK for developing IORA apps and plugins.

## Features

- 🐘 **Modern PHP 8+** - Uses PHP 8 features like enums, named arguments, and promoted properties
- 🔒 **Type Safety** - Full type declarations for type-safe development
- 📦 **Plugin Framework** - Base classes for plugin development
- 🔑 **Permission Management** - Built-in permission enums and helpers
- 📝 **Manifest Builder** - Fluent API for manifest creation
- 🎯 **REST API Client** - Complete IORA API client using Guzzle

## Requirements

- PHP 8.0 or higher
- Composer
- ext-json

## Installation

```bash
composer require iora/sdk
```

## Quick Start

### Simple App Example

```php
<?php

require 'vendor/autoload.php';

use Iora\Client;
use Iora\NotificationPayload;

// Initialize client
$client = new Client('http://localhost:8080', 'your-api-key');

// Get all entities
$entities = $client->getEntities();
echo "Found " . count($entities) . " entities\n";

// Turn on a light
$client->turnOn('light.living_room', ['brightness' => 255]);

// Send notification
$client->sendNotification(new NotificationPayload(
    title: 'Hello IORA',
    message: 'App is running!',
    priority: 'normal'
));

// Store data
$client->setStorage('last_run', ['timestamp' => date('Y-m-d H:i:s')]);

// Get stored data
$data = $client->getStorage('last_run');
print_r($data);
```

### Plugin Development

```php
<?php

use Iora\Plugin;
use Iora\PluginContext;

class MyPlugin extends Plugin
{
    public function execute(PluginContext $context): array
    {
        // Get settings
        $apiKey = $context->settings['api_key'];

        // Get entity state
        $entity = $context->getEntity('sensor.temperature');
        $temperature = floatval($entity->state);

        // Process data
        if ($temperature > 30) {
            $context->notify(
                'High Temperature',
                "Temperature is {$temperature}°C",
                'high'
            );
        }

        // Store result
        $context->store('last_temperature', $temperature);

        return [
            'status' => 'success',
            'temperature' => $temperature,
            'timestamp' => $entity->lastUpdated,
        ];
    }

    public function onInstall(PluginContext $context): void
    {
        $context->notify('Plugin Installed', 'MyPlugin is ready!');
    }

    public function onSettingsChanged(PluginContext $context): void
    {
        $context->notify('Settings Updated', 'Plugin settings have changed');
    }
}

// Execute plugin
$client = new \Iora\Client('http://localhost:8080', 'api-key');
$context = new PluginContext(
    client: $client,
    appId: 'my-plugin',
    settings: ['api_key' => 'test']
);

$plugin = new MyPlugin();
$result = $plugin->execute($context);
print_r($result);
```

### Data Processor Plugin

```php
<?php

use Iora\DataProcessorPlugin;
use Iora\PluginContext;

class TemperatureConverter extends DataProcessorPlugin
{
    public function process(PluginContext $context, mixed $data): mixed
    {
        $mode = $context->settings['mode'] ?? 'c_to_f';
        $value = floatval($data);

        if ($mode === 'c_to_f') {
            return ($value * 9 / 5) + 32;
        } else {
            return ($value - 32) * 5 / 9;
        }
    }
}
```

### Automation Plugin

```php
<?php

use Iora\AutomationPlugin;
use Iora\PluginContext;

class MotionLightAutomation extends AutomationPlugin
{
    public function onEvent(PluginContext $context, array $event): void
    {
        if (($event['type'] ?? '') !== 'entity_state_changed') {
            return;
        }

        $entityId = $event['data']['entity_id'] ?? '';
        $newState = $event['data']['new_state'] ?? '';

        // Get configured motion sensor
        $motionSensorId = $context->settings['motion_sensor_id'];
        if ($entityId !== $motionSensorId) {
            return;
        }

        // Get light settings
        $lightId = $context->settings['light_entity_id'];
        $brightness = $context->settings['brightness'] ?? 255;

        // Turn on light when motion detected
        if ($newState === 'on') {
            $context->callService('light', 'turn_on', $lightId, [
                'brightness' => $brightness
            ]);

            $context->notify(
                'Motion Detected',
                "Turned on {$lightId} at {$brightness} brightness"
            );
        }
    }
}
```

## API Reference

### Client

Main HTTP client for IORA API interactions.

#### Constructor

```php
$client = new Iora\Client(string $baseUrl = 'http://localhost:8080', ?string $apiKey = null);
```

#### Entity Methods

```php
// Get all entities
$entities = $client->getEntities();

// Get specific entity
$entity = $client->getEntity('light.bedroom');

// Call service
use Iora\ServiceCall;

$client->callService(new ServiceCall(
    domain: 'light',
    service: 'turn_on',
    entityId: 'light.bedroom',
    serviceData: ['brightness' => 200]
));

// Convenience methods
$client->turnOn('light.bedroom', ['brightness' => 200]);
$client->turnOff('light.bedroom');
```

#### Notification Methods

```php
use Iora\NotificationPayload;
use Iora\NotificationAction;

// Send notification
$client->sendNotification(new NotificationPayload(
    title: 'Alert',
    message: 'Something happened',
    priority: 'high',
    icon: 'bell',
    actions: [
        new NotificationAction('view', 'View'),
        new NotificationAction('dismiss', 'Dismiss')
    ]
));

// Get notifications
$notifications = $client->getNotifications();
```

#### Storage Methods

```php
// Store value
$client->setStorage('my-key', ['data' => 'value']);

// Get value
$data = $client->getStorage('my-key');

// Delete value
$client->deleteStorage('my-key');
```

#### Settings Methods

```php
// Get app settings
$settings = $client->getSettings('app-id');

// Update settings
$client->updateSettings('app-id', [
    'theme' => 'dark',
    'interval' => 300
]);
```

### ManifestBuilder

Build app manifests with a fluent API.

```php
use Iora\ManifestBuilder;
use Iora\Permission;
use Iora\PluginType;

$manifest = (new ManifestBuilder('my-app', 'My App'))
    ->version('1.0.0')
    ->developer('Your Name')
    ->description('An awesome IORA app')
    ->permissions([
        Permission::READ_ENTITIES,
        Permission::CONTROL_ENTITIES,
        Permission::STORAGE_WRITE,
        Permission::SEND_NOTIFICATIONS
    ])
    ->customPage([
        'id' => 'dashboard',
        'title' => 'Dashboard',
        'icon' => 'chart-line',
        'url' => '/dashboard',
        'iframe' => true,
        'iframe_config' => [
            'sandbox' => ['allow-scripts', 'allow-same-origin'],
            'allow' => ['camera', 'microphone'],
            'security_token' => true
        ]
    ])
    ->networkAccess([
        'allowed_domains' => ['api.example.com'],
        'allow_user_domains' => true
    ])
    ->settingsSchema([
        'title' => 'App Settings',
        'description' => 'Configure your app',
        'fields' => [
            [
                'key' => 'api_key',
                'label' => 'API Key',
                'type' => 'password',
                'required' => true
            ],
            [
                'key' => 'interval',
                'label' => 'Update Interval (seconds)',
                'type' => 'number',
                'default' => 60,
                'validation' => [
                    'min' => 10,
                    'max' => 3600
                ]
            ]
        ]
    ])
    ->docker([
        'auto_build' => true,
        'base_image' => 'php:8.2-cli',
        'working_dir' => '/app',
        'install_cmd' => 'composer install',
        'start_cmd' => 'php app.php',
        'internal_ports' => [
            [
                'port' => 8000,
                'protocol' => 'tcp',
                'assignment_mode' => 'random',
                'description' => 'HTTP server'
            ]
        ]
    ]);

// Build manifest
$manifestArray = $manifest->build();

// Save to file
$manifest->save('manifest.json');

// Get as JSON string
$jsonString = $manifest->toJson();
```

### Permissions

```php
use Iora\Permission;
use Iora\RiskLevel;
use function Iora\getPermissionRiskLevel;
use function Iora\getPermissionDescription;

// Use permissions
$perms = [
    Permission::READ_ENTITIES,
    Permission::CONTROL_ENTITIES,
    Permission::NETWORK_ACCESS
];

// Get risk level
$risk = getPermissionRiskLevel(Permission::NETWORK_SCAN);
// Returns: RiskLevel::CRITICAL

// Get description
$desc = getPermissionDescription(Permission::CAMERA_ACCESS);
// Returns: "Access camera"

// All available permissions
Permission::READ_ENTITIES
Permission::CONTROL_ENTITIES
Permission::CREATE_ENTITIES
Permission::DELETE_ENTITIES
Permission::STORAGE_READ
Permission::STORAGE_WRITE
Permission::STORAGE_DELETE
Permission::NETWORK_ACCESS
Permission::NETWORK_OUTBOUND
Permission::NETWORK_INBOUND
Permission::NETWORK_SCAN
Permission::NETWORK_LOCAL_ACCESS
// ... and more
```

### Type Classes

All types are PHP 8 classes with promoted properties:

```php
use Iora\Entity;
use Iora\ServiceCall;
use Iora\NotificationPayload;

$entity = new Entity(
    entityId: 'light.bedroom',
    state: 'on',
    attributes: ['brightness' => 255, 'color' => 'blue']
);

$call = new ServiceCall(
    domain: 'light',
    service: 'turn_on',
    entityId: 'light.bedroom',
    serviceData: ['brightness' => 200]
);
```

## Complete Example: Weather App

```php
<?php

require 'vendor/autoload.php';

use Iora\Client;
use Iora\NotificationPayload;
use Iora\ManifestBuilder;
use Iora\Permission;

class WeatherApp
{
    private Client $client;
    private string $appId = 'weather-app';

    public function __construct(string $ioraUrl, string $apiKey)
    {
        $this->client = new Client($ioraUrl, $apiKey);
    }

    public function run(): void
    {
        // Get settings
        $settings = $this->client->getSettings($this->appId);
        $weatherApiKey = $settings->settings['weather_api_key'];
        $updateInterval = $settings->settings['update_interval'] ?? 300;

        while (true) {
            try {
                $this->updateWeather($weatherApiKey);
            } catch (\Exception $e) {
                error_log("Error: " . $e->getMessage());
            }

            sleep($updateInterval);
        }
    }

    private function updateWeather(string $apiKey): void
    {
        // Fetch weather data
        $weather = json_decode(
            file_get_contents("https://api.weather.com/data?key={$apiKey}"),
            true
        );

        // Store data
        $this->client->setStorage('current_weather', $weather);

        // Check for alerts
        if (($weather['severity'] ?? '') === 'high') {
            $this->client->sendNotification(new NotificationPayload(
                title: 'Severe Weather Alert',
                message: "{$weather['condition']} expected in your area",
                priority: 'high'
            ));
        }
    }
}

function createManifest(): array
{
    return (new ManifestBuilder('weather-app', 'Weather Dashboard'))
        ->version('1.0.0')
        ->developer('Your Name')
        ->description('Real-time weather monitoring and alerts')
        ->permissions([
            Permission::STORAGE_WRITE,
            Permission::SEND_NOTIFICATIONS,
            Permission::NETWORK_OUTBOUND
        ])
        ->networkAccess([
            'allowed_domains' => ['api.weather.com'],
            'allow_user_domains' => false
        ])
        ->settingsSchema([
            'title' => 'Weather Settings',
            'description' => 'Configure weather app',
            'fields' => [
                [
                    'key' => 'weather_api_key',
                    'label' => 'Weather API Key',
                    'type' => 'password',
                    'required' => true
                ],
                [
                    'key' => 'update_interval',
                    'label' => 'Update Interval (seconds)',
                    'type' => 'number',
                    'default' => 300,
                    'validation' => ['min' => 60, 'max' => 3600]
                ]
            ]
        ])
        ->build();
}

// Create and save manifest
$manifest = createManifest();
file_put_contents('manifest.json', json_encode($manifest, JSON_PRETTY_PRINT));

// Run app
$app = new WeatherApp('http://localhost:8080', 'your-api-key');
$app->run();
```

## Building Your App

### 1. Initialize Project

```bash
composer init
composer require iora/sdk
```

### 2. Create Dockerfile

```dockerfile
FROM php:8.2-cli

WORKDIR /app

# Install Composer
COPY --from=composer:latest /usr/bin/composer /usr/bin/composer

# Install dependencies
COPY composer.json composer.lock ./
RUN composer install --no-dev --optimize-autoloader

# Copy application
COPY . .

CMD ["php", "app.php"]
```

### 3. Create manifest.json

Use the ManifestBuilder as shown above.

## Best Practices

### 1. Error Handling

```php
try {
    $entity = $client->getEntity('light.bedroom');
} catch (\Exception $e) {
    error_log("Error: " . $e->getMessage());
    // Handle error
}
```

### 2. Type Declarations

```php
function getLights(Client $client): array
{
    $entities = $client->getEntities();
    return array_filter(
        $entities,
        fn(Entity $e) => str_starts_with($e->entityId, 'light.')
    );
}
```

### 3. Minimal Permissions

Only request permissions you actually need:

```php
->permissions([
    Permission::READ_ENTITIES,  // Only if you need to read
    Permission::STORAGE_READ    // Only if you need storage
])
```

### 4. Logging

```php
error_log("App started");
error_log("Processing data: " . json_encode($data));
```

## Development

### Running Tests

```bash
composer test
```

### Static Analysis

```bash
composer stan
```

### Code Style

```bash
composer cs
```

## PHP Version Support

- PHP 8.0+
- Uses PHP 8 features: enums, named arguments, promoted properties
- PSR-4 autoloading
- PSR-12 coding standard

## License

MIT

## Support

For issues and questions:
- GitHub Issues: https://github.com/iora/iora-sdk-php
- Documentation: https://docs.iora.io
- Community: https://community.iora.io
