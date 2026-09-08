// Example app demonstrating the enhanced runtime features
package main

import (
	"log"
	"time"

	ora "github.com/ora/rumahl-sdk-go"
)

func main() {
	// Initialize runtime manager from environment variables
	// rumahl sets these when starting the app:
	// - RUMAHL_APP_ID
	// - RUMAHL_ENDPOINT
	// - RUMAHL_HEARTBEAT_INTERVAL
	runtime, err := ora.RuntimeManagerFromEnv()
	if err != nil {
		log.Fatalf("Failed to create runtime manager: %v", err)
	}

	// Start the runtime (begins heartbeat, message processing, etc.)
	if err := runtime.Start(); err != nil {
		log.Fatalf("Failed to start runtime: %v", err)
	}
	defer runtime.Stop()

	// Log that app started
	runtime.Log(ora.LogLevelInfo, "Weather app started successfully", map[string]interface{}{
		"version": "1.0.0",
	})

	// Run the weather app
	runWeatherApp(runtime)
}

func runWeatherApp(runtime *ora.RuntimeManager) {
	// Register custom query handler
	runtime.RegisterQueryHandler("get_weather", func(params map[string]interface{}) (interface{}, error) {
		return map[string]interface{}{
			"temperature": 25.0,
			"condition":   "Sunny",
			"humidity":    60,
		}, nil
	})

	for {
		// Update status to processing
		if err := runtime.SetStatus(ora.AppStatusProcessing, "Fetching weather data"); err != nil {
			log.Printf("Failed to set status: %v", err)
		}

		// Request permission to access network
		token, err := runtime.RequestPermission(
			ora.PermissionNetworkOutbound,
			"Fetch weather data from api.weather.com",
			300, // 5 minutes
		)

		if err == nil && token != nil {
			runtime.Log(ora.LogLevelDebug, "Permission granted for network access", map[string]interface{}{
				"token_expires": token.ExpiresAt,
			})

			// Simulate fetching weather data
			time.Sleep(2 * time.Second)

			runtime.Log(ora.LogLevelInfo, "Weather data updated successfully", map[string]interface{}{
				"temperature": 25.0,
				"condition":   "Sunny",
			})
		} else {
			runtime.Log(ora.LogLevelWarning, "Permission request pending", nil)
		}

		// Update status to idle
		if err := runtime.SetStatus(ora.AppStatusIdle, ""); err != nil {
			log.Printf("Failed to set status: %v", err)
		}

		// Wait before next update
		time.Sleep(60 * time.Second)
	}
}
