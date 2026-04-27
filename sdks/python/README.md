# IORA Python SDK

Official Python SDK for developing IORA apps and plugins.

## Features

- 🐍 **Async/Await Support** - Built on httpx for modern async Python
- 🔒 **Type Safety** - Full Pydantic models for type checking
- 📦 **Plugin Framework** - Base classes for plugin development
- 🔑 **Permission Management** - Built-in permission enums and risk assessment
- 📝 **Manifest Builder** - Programmatic app manifest creation
- 🎯 **REST API Client** - Complete IORA API client

## Installation

```bash
pip install iora-sdk
```

Or with development dependencies:

```bash
pip install iora-sdk[dev]
```

## Quick Start

### Simple App Example

```python
import asyncio
from iora_sdk import IoraClient, Permission
from iora_sdk.types import NotificationPayload

async def main():
    # Initialize client
    async with IoraClient("http://localhost:8080", "your-api-key") as client:
        # Get all entities
        entities = await client.get_entities()
        print(f"Found {len(entities)} entities")

        # Turn on a light
        await client.turn_on("light.living_room", {"brightness": 255})

        # Send notification
        notification = NotificationPayload(
            title="Hello IORA",
            message="App is running!",
            priority="normal"
        )
        await client.send_notification(notification)

        # Store data
        await client.set_storage("last_run", {"timestamp": "2024-01-01"})
        data = await client.get_storage("last_run")

if __name__ == "__main__":
    asyncio.run(main())
```

### Plugin Development

```python
from iora_sdk import Plugin, PluginContext
from typing import Dict, Any

class MyPlugin(Plugin):
    """Example plugin that processes data"""

    async def execute(self, context: PluginContext) -> Dict[str, Any]:
        # Get settings
        api_key = context.settings.get("api_key")

        # Get entity state
        entity = await context.get_entity("sensor.temperature")
        temperature = float(entity.state)

        # Process data
        if temperature > 30:
            await context.notify(
                "High Temperature",
                f"Temperature is {temperature}°C",
                priority="high"
            )

        # Store result
        await context.store("last_temperature", temperature)

        return {
            "status": "success",
            "temperature": temperature,
            "timestamp": entity.last_updated
        }

    async def on_install(self, context: PluginContext) -> None:
        await context.notify("Plugin Installed", "MyPlugin is ready!")

    async def on_settings_changed(self, context: PluginContext) -> None:
        await context.notify("Settings Updated", "Plugin settings have changed")
```

### Data Processor Plugin

```python
from iora_sdk import DataProcessorPlugin, PluginContext
from typing import Any

class TemperatureConverter(DataProcessorPlugin):
    """Convert temperature between Celsius and Fahrenheit"""

    async def process(self, context: PluginContext, data: Any) -> Any:
        mode = context.settings.get("mode", "c_to_f")
        value = float(data)

        if mode == "c_to_f":
            return (value * 9/5) + 32
        else:
            return (value - 32) * 5/9
```

### Automation Plugin

```python
from iora_sdk import AutomationPlugin, PluginContext
from typing import Dict, Any

class MotionLightAutomation(AutomationPlugin):
    """Turn on lights when motion is detected"""

    async def on_event(self, context: PluginContext, event: Dict[str, Any]) -> None:
        if event.get("type") != "entity_state_changed":
            return

        entity_id = event["data"]["entity_id"]
        new_state = event["data"]["new_state"]

        # Check if it's a motion sensor
        if not entity_id.startswith("binary_sensor.motion_"):
            return

        # Turn on light when motion detected
        if new_state == "on":
            light_id = context.settings.get("light_entity_id")
            await context.call_service(
                "light",
                "turn_on",
                light_id,
                {"brightness": 255}
            )

            await context.notify(
                "Motion Detected",
                f"Turned on {light_id}"
            )
```

## API Reference

### IoraClient

Main HTTP client for IORA API interactions.

#### Constructor

```python
client = IoraClient(base_url: str = "http://localhost:8080", api_key: Optional[str] = None)
```

#### Context Manager

```python
async with IoraClient("http://localhost:8080", "api-key") as client:
    entities = await client.get_entities()
```

#### Entity Methods

```python
# Get all entities
entities: List[Entity] = await client.get_entities()

# Get specific entity
entity: Entity = await client.get_entity("light.bedroom")

# Call service
from iora_sdk.types import ServiceCall

await client.call_service(ServiceCall(
    domain="light",
    service="turn_on",
    entity_id="light.bedroom",
    service_data={"brightness": 200}
))

# Convenience methods
await client.turn_on("light.bedroom", {"brightness": 200})
await client.turn_off("light.bedroom")
```

#### Notification Methods

```python
from iora_sdk.types import NotificationPayload, NotificationAction

# Send notification
await client.send_notification(NotificationPayload(
    title="Alert",
    message="Something happened",
    priority="high",
    icon="bell",
    actions=[
        NotificationAction(action="view", title="View"),
        NotificationAction(action="dismiss", title="Dismiss")
    ]
))

# Get notifications
notifications = await client.get_notifications()
```

#### Storage Methods

```python
# Store value
await client.set_storage("my-key", {"data": "value"})

# Get value
data = await client.get_storage("my-key")

# Delete value
await client.delete_storage("my-key")
```

#### Settings Methods

```python
from iora_sdk.types import AppSettings

# Get app settings
settings: AppSettings = await client.get_settings("app-id")

# Update settings
await client.update_settings("app-id", {
    "theme": "dark",
    "interval": 300
})
```

### ManifestBuilder

Build app manifests programmatically.

```python
from iora_sdk import ManifestBuilder, Permission
from iora_sdk.manifest import (
    CustomPage,
    IframeConfig,
    SettingsSchema,
    SettingsField,
    NetworkAccessConfig,
    DockerConfig,
    PortConfig
)

manifest = (
    ManifestBuilder("my-app", "My App")
    .version("1.0.0")
    .developer("Your Name")
    .description("An awesome IORA app")
    .permissions([
        Permission.READ_ENTITIES,
        Permission.CONTROL_ENTITIES,
        Permission.STORAGE_WRITE,
        Permission.SEND_NOTIFICATIONS
    ])
    .custom_page(CustomPage(
        id="dashboard",
        title="Dashboard",
        icon="chart-line",
        url="/dashboard",
        iframe=True,
        iframe_config=IframeConfig(
            sandbox=["allow-scripts", "allow-same-origin"],
            allow=["camera", "microphone"],
            security_token=True
        )
    ))
    .network_access(NetworkAccessConfig(
        allowed_domains=["api.example.com"],
        allow_user_domains=True
    ))
    .settings_schema(SettingsSchema(
        title="App Settings",
        description="Configure your app",
        fields=[
            SettingsField(
                key="api_key",
                label="API Key",
                type="password",
                required=True
            ),
            SettingsField(
                key="interval",
                label="Update Interval (seconds)",
                type="number",
                default=60,
                validation={"min": 10, "max": 3600}
            )
        ]
    ))
    .docker(DockerConfig(
        auto_build=True,
        base_image="python:3.11-slim",
        working_dir="/app",
        install_cmd="pip install -r requirements.txt",
        start_cmd="python app.py",
        internal_ports=[
            PortConfig(
                port=8000,
                protocol="tcp",
                assignment_mode="random",
                description="HTTP server"
            )
        ]
    ))
    .build()
)

# Save to file
manifest_builder = ManifestBuilder("my-app", "My App")
# ... configure ...
manifest_builder.save("manifest.json")

# Export as JSON string
json_str = manifest_builder.to_json()
```

### Permissions

```python
from iora_sdk import Permission, RiskLevel, get_permission_risk_level, get_permission_description

# Use permissions
perms = [
    Permission.READ_ENTITIES,
    Permission.CONTROL_ENTITIES,
    Permission.NETWORK_ACCESS
]

# Get risk level
risk = get_permission_risk_level(Permission.NETWORK_SCAN)
# Returns: RiskLevel.CRITICAL

# Get description
desc = get_permission_description(Permission.CAMERA_ACCESS)
# Returns: "Access camera"

# All available permissions
Permission.READ_ENTITIES
Permission.CONTROL_ENTITIES
Permission.CREATE_ENTITIES
Permission.DELETE_ENTITIES
Permission.STORAGE_READ
Permission.STORAGE_WRITE
Permission.STORAGE_DELETE
Permission.NETWORK_ACCESS
Permission.NETWORK_OUTBOUND
Permission.NETWORK_INBOUND
Permission.NETWORK_SCAN
Permission.NETWORK_LOCAL_ACCESS
Permission.SYSTEM_INFO
Permission.SYSTEM_CONTROL
Permission.SYSTEM_RESTART
Permission.DATABASE_READ
Permission.DATABASE_WRITE
Permission.DATABASE_CREATE
Permission.DATABASE_DELETE
Permission.REGISTER_API
Permission.CALL_API
Permission.REGISTER_WIDGET
Permission.CONTROL_WIDGET
Permission.SEND_NOTIFICATIONS
Permission.READ_NOTIFICATIONS
Permission.CAMERA_ACCESS
Permission.MICROPHONE_ACCESS
Permission.MEDIA_ACCESS
Permission.PLUGIN_MANAGER
Permission.INSTALL_PLUGINS
Permission.FILE_SYSTEM_READ
Permission.FILE_SYSTEM_WRITE
Permission.FILE_SYSTEM_EXECUTE
Permission.LOCATION_ACCESS
Permission.AUTOMATIONS
```

### Type Models

All types are Pydantic models with full validation:

```python
from iora_sdk.types import (
    Entity,
    ServiceCall,
    NotificationPayload,
    NotificationAction,
    AppSettings,
    HealthStatus,
    IoraEvent
)

# Entity
entity = Entity(
    entity_id="light.bedroom",
    state="on",
    attributes={"brightness": 255, "color": "blue"}
)

# Service Call
call = ServiceCall(
    domain="light",
    service="turn_on",
    entity_id="light.bedroom",
    service_data={"brightness": 200}
)
```

## Complete Example: Weather App

```python
import asyncio
from datetime import datetime
from iora_sdk import IoraClient, ManifestBuilder, Permission
from iora_sdk.types import NotificationPayload
from iora_sdk.manifest import (
    SettingsSchema,
    SettingsField,
    NetworkAccessConfig
)

class WeatherApp:
    def __init__(self, iora_url: str, api_key: str):
        self.client = IoraClient(iora_url, api_key)
        self.app_id = "weather-app"

    async def run(self):
        async with self.client:
            # Get settings
            settings = await self.client.get_settings(self.app_id)
            weather_api_key = settings.settings.get("weather_api_key")
            update_interval = settings.settings.get("update_interval", 300)

            while True:
                try:
                    # Fetch weather (using httpx)
                    import httpx
                    async with httpx.AsyncClient() as http:
                        response = await http.get(
                            f"https://api.weather.com/data?key={weather_api_key}"
                        )
                        weather = response.json()

                    # Store data
                    await self.client.set_storage("current_weather", weather)

                    # Check for alerts
                    if weather.get("severity") == "high":
                        await self.client.send_notification(
                            NotificationPayload(
                                title="Severe Weather Alert",
                                message=f"{weather['condition']} expected",
                                priority="high"
                            )
                        )

                    # Update entity (if you have one)
                    # This would typically be done via a custom service

                except Exception as e:
                    print(f"Error: {e}")

                await asyncio.sleep(update_interval)

def create_manifest():
    """Create app manifest"""
    manifest = (
        ManifestBuilder("weather-app", "Weather Dashboard")
        .version("1.0.0")
        .developer("Your Name")
        .description("Real-time weather monitoring and alerts")
        .permissions([
            Permission.STORAGE_WRITE,
            Permission.SEND_NOTIFICATIONS,
            Permission.NETWORK_OUTBOUND
        ])
        .network_access(NetworkAccessConfig(
            allowed_domains=["api.weather.com"],
            allow_user_domains=False
        ))
        .settings_schema(SettingsSchema(
            title="Weather Settings",
            description="Configure weather app",
            fields=[
                SettingsField(
                    key="weather_api_key",
                    label="Weather API Key",
                    type="password",
                    required=True
                ),
                SettingsField(
                    key="update_interval",
                    label="Update Interval (seconds)",
                    type="number",
                    default=300,
                    validation={"min": 60, "max": 3600}
                )
            ]
        ))
        .build()
    )
    return manifest

if __name__ == "__main__":
    # Create manifest
    manifest = create_manifest()
    with open("manifest.json", "w") as f:
        f.write(manifest.model_dump_json(indent=2, exclude_none=True))

    # Run app
    app = WeatherApp("http://localhost:8080", "your-api-key")
    asyncio.run(app.run())
```

## Development

### Running Tests

```bash
pytest
```

### Type Checking

```bash
mypy iora_sdk
```

### Code Formatting

```bash
black iora_sdk
ruff check iora_sdk
```

## Docker Deployment

Create a `Dockerfile`:

```dockerfile
FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

CMD ["python", "app.py"]
```

Create `requirements.txt`:

```
iora-sdk>=0.1.0
httpx>=0.25.0
```

Create `manifest.json` using the ManifestBuilder as shown above.

## Best Practices

### 1. Use Context Managers

```python
async with IoraClient(url, api_key) as client:
    # Client automatically closes
    pass
```

### 2. Error Handling

```python
try:
    await client.turn_on("light.bedroom")
except httpx.HTTPStatusError as e:
    print(f"API error: {e}")
except Exception as e:
    print(f"Error: {e}")
```

### 3. Type Hints

```python
from typing import List
from iora_sdk.types import Entity

async def get_lights(client: IoraClient) -> List[Entity]:
    entities = await client.get_entities()
    return [e for e in entities if e.entity_id.startswith("light.")]
```

### 4. Minimal Permissions

Only request permissions you actually need:

```python
.permissions([
    Permission.READ_ENTITIES,  # Only if you need to read
    Permission.STORAGE_READ    # Only if you need storage
])
```

### 5. Structured Logging

```python
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

logger.info("App started")
logger.error("Failed to fetch data", exc_info=True)
```

## Python Version Support

- Python 3.8+
- Async/await support required
- Type hints support recommended

## License

MIT

## Support

For issues and questions:
- GitHub Issues: https://github.com/your-org/iora-sdk-python
- Documentation: https://docs.iora.io
- Community: https://community.iora.io
