// Example app demonstrating the enhanced runtime features
package main

import (
	"log"
	"time"

	iora "github.com/iora/iora-sdk-go"
)

func main() {
	// Initialize runtime manager from environment variables
	// IORA sets these when starting the app:
	// - IORA_APP_ID
	// - IORA_ENDPOINT
	// - IORA_HEARTBEAT_INTERVAL
	runtime, err := iora.RuntimeManagerFromEnv()
	if err != nil {
		log.Fatalf("Failed to create runtime manager: %v", err)
	}

	// Start the runtime (begins heartbeat, message processing, etc.)
	if err := runtime.Start(); err != nil {
		log.Fatalf("Failed to start runtime: %v", err)
	}
	defer runtime.Stop()

	// Log that app started
	runtime.Log(iora.LogLevelInfo, "Weather app started successfully", map[string]interface{}{
		"version": "1.0.0",
	})

	// Run the weather app
	runWeatherApp(runtime)
}

func runWeatherApp(runtime *iora.RuntimeManager) {
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
		if err := runtime.SetStatus(iora.AppStatusProcessing, "Fetching weather data"); err != nil {
			log.Printf("Failed to set status: %v", err)
		}

		// Request permission to access network
		token, err := runtime.RequestPermission(
			iora.PermissionNetworkOutbound,
			"Fetch weather data from api.weather.com",
			300, // 5 minutes
		)

		if err == nil && token != nil {
			runtime.Log(iora.LogLevelDebug, "Permission granted for network access", map[string]interface{}{
				"token_expires": token.ExpiresAt,
			})

			// Simulate fetching weather data
			time.Sleep(2 * time.Second)

			runtime.Log(iora.LogLevelInfo, "Weather data updated successfully", map[string]interface{}{
				"temperature": 25.0,
				"condition":   "Sunny",
			})
		} else {
			runtime.Log(iora.LogLevelWarning, "Permission request pending", nil)
		}

		// Update status to idle
		if err := runtime.SetStatus(iora.AppStatusIdle, ""); err != nil {
			log.Printf("Failed to set status: %v", err)
		}

		// Wait before next update
		time.Sleep(60 * time.Second)
	}
}
