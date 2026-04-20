# IORA Go SDK

Official Go SDK for developing IORA apps and plugins.

## Features

- 🚀 **Idiomatic Go** - Clean, idiomatic Go code
- 🔒 **Type Safety** - Strong typing with structs
- 📦 **Plugin Framework** - Interfaces for plugin development
- 🔑 **Permission Management** - Built-in permission constants and helpers
- 📝 **Manifest Builder** - Fluent API for manifest creation
- 🎯 **REST API Client** - Complete IORA API client

## Installation

```bash
go get github.com/iora/iora-sdk-go
```

## Quick Start

### Simple App Example

```go
package main

import (
	"fmt"
	"log"

	iora "github.com/iora/iora-sdk-go"
)

func main() {
	// Initialize client
	client := iora.NewClient("http://localhost:8080", "your-api-key")

	// Get all entities
	entities, err := client.GetEntities()
	if err != nil {
		log.Fatal(err)
	}
	fmt.Printf("Found %d entities\n", len(entities))

	// Turn on a light
	err = client.TurnOn("light.living_room", map[string]interface{}{
		"brightness": 255,
	})
	if err != nil {
		log.Fatal(err)
	}

	// Send notification
	err = client.SendNotification(iora.NotificationPayload{
		Title:    "Hello IORA",
		Message:  "App is running!",
		Priority: "normal",
	})
	if err != nil {
		log.Fatal(err)
	}

	// Store data
	err = client.SetStorage("last_run", map[string]interface{}{
		"timestamp": "2024-01-01",
	})
	if err != nil {
		log.Fatal(err)
	}

	// Get stored data
	var data map[string]interface{}
	err = client.GetStorage("last_run", &data)
	if err != nil {
		log.Fatal(err)
	}
	fmt.Printf("Data: %+v\n", data)
}
```

### Plugin Development

```go
package main

import (
	"context"
	"fmt"
	"log"

	iora "github.com/iora/iora-sdk-go"
)

// MyPlugin is an example plugin
type MyPlugin struct {
	iora.BasePlugin
}

// Execute implements the Plugin interface
func (p *MyPlugin) Execute(ctx context.Context, pluginCtx *iora.PluginContext) (map[string]interface{}, error) {
	// Get settings
	apiKey := pluginCtx.Settings["api_key"].(string)

	// Get entity state
	entity, err := pluginCtx.GetEntity("sensor.temperature")
	if err != nil {
		return nil, err
	}

	// Process data
	temperature := parseFloat(entity.State)
	if temperature > 30 {
		err = pluginCtx.Notify(
			"High Temperature",
			fmt.Sprintf("Temperature is %.1f°C", temperature),
			"high",
		)
		if err != nil {
			return nil, err
		}
	}

	// Store result
	err = pluginCtx.Store("last_temperature", temperature)
	if err != nil {
		return nil, err
	}

	return map[string]interface{}{
		"status":      "success",
		"temperature": temperature,
		"timestamp":   entity.LastUpdated,
	}, nil
}

// OnInstall is called when plugin is installed
func (p *MyPlugin) OnInstall(ctx context.Context, pluginCtx *iora.PluginContext) error {
	return pluginCtx.Notify("Plugin Installed", "MyPlugin is ready!", "normal")
}

// OnSettingsChanged is called when settings change
func (p *MyPlugin) OnSettingsChanged(ctx context.Context, pluginCtx *iora.PluginContext) error {
	return pluginCtx.Notify("Settings Updated", "Plugin settings have changed", "normal")
}

func main() {
	plugin := &MyPlugin{}

	// Create context
	client := iora.NewClient("http://localhost:8080", "api-key")
	pluginCtx := &iora.PluginContext{
		Client:   client,
		AppID:    "my-plugin",
		Settings: map[string]interface{}{"api_key": "test"},
	}

	// Execute plugin
	result, err := plugin.Execute(context.Background(), pluginCtx)
	if err != nil {
		log.Fatal(err)
	}

	fmt.Printf("Result: %+v\n", result)
}
```

### Data Processor Plugin

```go
package main

import (
	"context"
	"fmt"

	iora "github.com/iora/iora-sdk-go"
)

// TemperatureConverter converts temperature between Celsius and Fahrenheit
type TemperatureConverter struct {
	iora.DataProcessorPlugin
}

// Process implements data processing
func (tc *TemperatureConverter) Process(ctx context.Context, pluginCtx *iora.PluginContext, data interface{}) (interface{}, error) {
	mode := pluginCtx.Settings["mode"].(string)
	value := data.(float64)

	var result float64
	if mode == "c_to_f" {
		result = (value * 9 / 5) + 32
	} else {
		result = (value - 32) * 5 / 9
	}

	return result, nil
}
```

### Automation Plugin

```go
package main

import (
	"context"
	"fmt"

	iora "github.com/iora/iora-sdk-go"
)

// MotionLightAutomation turns on lights when motion is detected
type MotionLightAutomation struct {
	iora.AutomationPlugin
}

// OnEvent handles motion events
func (mla *MotionLightAutomation) OnEvent(ctx context.Context, pluginCtx *iora.PluginContext, event map[string]interface{}) error {
	if event["type"] != "entity_state_changed" {
		return nil
	}

	data := event["data"].(map[string]interface{})
	entityID := data["entity_id"].(string)
	newState := data["new_state"].(string)

	// Check if it's a motion sensor
	if entityID[:20] != "binary_sensor.motion" {
		return nil
	}

	// Turn on light when motion detected
	if newState == "on" {
		lightID := pluginCtx.Settings["light_entity_id"].(string)
		err := pluginCtx.CallService("light", "turn_on", lightID, map[string]interface{}{
			"brightness": 255,
		})
		if err != nil {
			return err
		}

		return pluginCtx.Notify("Motion Detected", fmt.Sprintf("Turned on %s", lightID), "normal")
	}

	return nil
}
```

## API Reference

### Client

Main HTTP client for IORA API interactions.

#### Constructor

```go
client := iora.NewClient(baseURL string, apiKey string)
```

#### Entity Methods

```go
// Get all entities
entities, err := client.GetEntities()

// Get specific entity
entity, err := client.GetEntity("light.bedroom")

// Call service
err = client.CallService(iora.ServiceCall{
	Domain:      "light",
	Service:     "turn_on",
	EntityID:    "light.bedroom",
	ServiceData: map[string]interface{}{"brightness": 200},
})

// Convenience methods
err = client.TurnOn("light.bedroom", map[string]interface{}{"brightness": 200})
err = client.TurnOff("light.bedroom")
```

#### Notification Methods

```go
// Send notification
err = client.SendNotification(iora.NotificationPayload{
	Title:    "Alert",
	Message:  "Something happened",
	Priority: "high",
	Icon:     "bell",
	Actions: []iora.NotificationAction{
		{Action: "view", Title: "View"},
		{Action: "dismiss", Title: "Dismiss"},
	},
})

// Get notifications
notifications, err := client.GetNotifications()
```

#### Storage Methods

```go
// Store value
err = client.SetStorage("my-key", map[string]interface{}{"data": "value"})

// Get value
var data map[string]interface{}
err = client.GetStorage("my-key", &data)

// Delete value
err = client.DeleteStorage("my-key")
```

#### Settings Methods

```go
// Get app settings
settings, err := client.GetSettings("app-id")

// Update settings
err = client.UpdateSettings("app-id", map[string]interface{}{
	"theme":    "dark",
	"interval": 300,
})
```

### ManifestBuilder

Build app manifests with a fluent API.

```go
manifest := iora.NewManifestBuilder("my-app", "My App").
	Version("1.0.0").
	Developer("Your Name").
	Description("An awesome IORA app").
	Permissions([]iora.Permission{
		iora.PermissionReadEntities,
		iora.PermissionControlEntities,
		iora.PermissionStorageWrite,
		iora.PermissionSendNotifications,
	}).
	CustomPage(iora.CustomPage{
		ID:    "dashboard",
		Title: "Dashboard",
		Icon:  "chart-line",
		URL:   "/dashboard",
		Iframe: true,
		IframeConfig: &iora.IframeConfig{
			Sandbox:       []string{"allow-scripts", "allow-same-origin"},
			Allow:         []string{"camera", "microphone"},
			SecurityToken: true,
		},
	}).
	NetworkAccess(iora.NetworkAccessConfig{
		AllowedDomains:   []string{"api.example.com"},
		AllowUserDomains: true,
	}).
	SettingsSchema(iora.SettingsSchema{
		Title:       "App Settings",
		Description: "Configure your app",
		Fields: []iora.SettingsField{
			{
				Key:      "api_key",
				Label:    "API Key",
				Type:     "password",
				Required: true,
			},
			{
				Key:     "interval",
				Label:   "Update Interval (seconds)",
				Type:    "number",
				Default: 60,
				Validation: &iora.FieldValidation{
					Min: intPtr(10),
					Max: intPtr(3600),
				},
			},
		},
	}).
	Docker(iora.DockerConfig{
		AutoBuild:  true,
		BaseImage:  "golang:1.21-alpine",
		WorkingDir: "/app",
		InstallCmd: "go mod download",
		StartCmd:   "go run main.go",
		InternalPorts: []iora.PortConfig{
			{
				Port:           8000,
				Protocol:       "tcp",
				AssignmentMode: "random",
				Description:    "HTTP server",
			},
		},
	})

// Build and get manifest
appManifest, err := manifest.Build()

// Save to file
err = manifest.Save("manifest.json")

// Get as JSON string
jsonStr, err := manifest.ToJSON()
```

### Permissions

```go
// Use permissions
perms := []iora.Permission{
	iora.PermissionReadEntities,
	iora.PermissionControlEntities,
	iora.PermissionNetworkAccess,
}

// Get risk level
risk := iora.GetPermissionRiskLevel(iora.PermissionNetworkScan)
// Returns: iora.RiskLevelCritical

// Get description
desc := iora.GetPermissionDescription(iora.PermissionCameraAccess)
// Returns: "Access camera"

// All available permissions
iora.PermissionReadEntities
iora.PermissionControlEntities
iora.PermissionCreateEntities
iora.PermissionDeleteEntities
iora.PermissionStorageRead
iora.PermissionStorageWrite
iora.PermissionStorageDelete
iora.PermissionNetworkAccess
iora.PermissionNetworkOutbound
iora.PermissionNetworkInbound
iora.PermissionNetworkScan
iora.PermissionNetworkLocalAccess
iora.PermissionSystemInfo
iora.PermissionSystemControl
iora.PermissionSystemRestart
// ... and more
```

### Type Structs

All types are Go structs:

```go
type Entity struct {
	EntityID    string
	State       string
	Attributes  map[string]interface{}
	LastChanged *time.Time
	LastUpdated *time.Time
}

type ServiceCall struct {
	Domain      string
	Service     string
	EntityID    string
	ServiceData map[string]interface{}
}

type NotificationPayload struct {
	Title    string
	Message  string
	Priority string
	Icon     string
	Actions  []NotificationAction
}
```

## Complete Example: Weather App

```go
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"time"

	iora "github.com/iora/iora-sdk-go"
)

type WeatherApp struct {
	client *iora.Client
	appID  string
}

func NewWeatherApp(ioraURL, apiKey string) *WeatherApp {
	return &WeatherApp{
		client: iora.NewClient(ioraURL, apiKey),
		appID:  "weather-app",
	}
}

func (wa *WeatherApp) Run(ctx context.Context) error {
	// Get settings
	settings, err := wa.client.GetSettings(wa.appID)
	if err != nil {
		return err
	}

	weatherAPIKey := settings.Settings["weather_api_key"].(string)
	updateInterval := int(settings.Settings["update_interval"].(float64))

	ticker := time.NewTicker(time.Duration(updateInterval) * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-ticker.C:
			if err := wa.updateWeather(weatherAPIKey); err != nil {
				log.Printf("Error updating weather: %v", err)
			}
		}
	}
}

func (wa *WeatherApp) updateWeather(apiKey string) error {
	// Fetch weather data
	resp, err := http.Get(fmt.Sprintf("https://api.weather.com/data?key=%s", apiKey))
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	var weather map[string]interface{}
	if err := json.NewDecoder(resp.Body).Decode(&weather); err != nil {
		return err
	}

	// Store data
	if err := wa.client.SetStorage("current_weather", weather); err != nil {
		return err
	}

	// Check for alerts
	if severity, ok := weather["severity"].(string); ok && severity == "high" {
		condition := weather["condition"].(string)
		err = wa.client.SendNotification(iora.NotificationPayload{
			Title:    "Severe Weather Alert",
			Message:  fmt.Sprintf("%s expected in your area", condition),
			Priority: "high",
		})
		if err != nil {
			return err
		}
	}

	return nil
}

func createManifest() (*iora.AppManifest, error) {
	manifest := iora.NewManifestBuilder("weather-app", "Weather Dashboard").
		Version("1.0.0").
		Developer("Your Name").
		Description("Real-time weather monitoring and alerts").
		Permissions([]iora.Permission{
			iora.PermissionStorageWrite,
			iora.PermissionSendNotifications,
			iora.PermissionNetworkOutbound,
		}).
		NetworkAccess(iora.NetworkAccessConfig{
			AllowedDomains:   []string{"api.weather.com"},
			AllowUserDomains: false,
		}).
		SettingsSchema(iora.SettingsSchema{
			Title:       "Weather Settings",
			Description: "Configure weather app",
			Fields: []iora.SettingsField{
				{
					Key:      "weather_api_key",
					Label:    "Weather API Key",
					Type:     "password",
					Required: true,
				},
				{
					Key:     "update_interval",
					Label:   "Update Interval (seconds)",
					Type:    "number",
					Default: 300,
					Validation: &iora.FieldValidation{
						Min: intPtr(60),
						Max: intPtr(3600),
					},
				},
			},
		})

	return manifest.Build()
}

func intPtr(i int) *int {
	return &i
}

func main() {
	// Create and save manifest
	manifest, err := createManifest()
	if err != nil {
		log.Fatal(err)
	}

	data, _ := json.MarshalIndent(manifest, "", "  ")
	fmt.Println(string(data))

	// Run app
	app := NewWeatherApp("http://localhost:8080", "your-api-key")
	if err := app.Run(context.Background()); err != nil {
		log.Fatal(err)
	}
}
```

## Building Your App

### 1. Initialize Module

```bash
go mod init my-app
go get github.com/iora/iora-sdk-go
```

### 2. Build

```bash
go build -o app main.go
```

### 3. Create Dockerfile

```dockerfile
FROM golang:1.21-alpine AS builder

WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN go build -o app main.go

FROM alpine:latest
RUN apk --no-cache add ca-certificates
WORKDIR /root/
COPY --from=builder /app/app .
CMD ["./app"]
```

### 4. Create manifest.json

Use the ManifestBuilder as shown above.

## Best Practices

### 1. Error Handling

```go
if err != nil {
	log.Printf("Error: %v", err)
	return err
}
```

### 2. Context Usage

```go
func (p *MyPlugin) Execute(ctx context.Context, pluginCtx *iora.PluginContext) (map[string]interface{}, error) {
	select {
	case <-ctx.Done():
		return nil, ctx.Err()
	default:
		// Continue processing
	}
}
```

### 3. Graceful Shutdown

```go
ctx, cancel := context.WithCancel(context.Background())
defer cancel()

sigChan := make(chan os.Signal, 1)
signal.Notify(sigChan, os.Interrupt, syscall.SIGTERM)

go func() {
	<-sigChan
	cancel()
}()

if err := app.Run(ctx); err != nil && err != context.Canceled {
	log.Fatal(err)
}
```

### 4. Minimal Permissions

Only request permissions you actually need:

```go
.Permissions([]iora.Permission{
	iora.PermissionReadEntities,  // Only if you need to read
	iora.PermissionStorageRead,   // Only if you need storage
})
```

## Go Version Support

- Go 1.21+
- Uses standard library HTTP client
- No external dependencies for core functionality

## License

MIT

## Support

For issues and questions:
- GitHub Issues: https://github.com/iora/iora-sdk-go
- Documentation: https://docs.iora.io
- Community: https://community.iora.io
