// Example: Temperature converter data processor plugin
package main

import (
	"context"
	"fmt"

	ora "github.com/ora/rumahl-sdk-go"
)

// TemperatureConverter converts temperature between Celsius and Fahrenheit
type TemperatureConverter struct {
	ora.DataProcessorPlugin
}

// Process implements data processing
func (tc *TemperatureConverter) Process(ctx context.Context, pluginCtx *ora.PluginContext, data interface{}) (interface{}, error) {
	mode := pluginCtx.Settings["mode"].(string)
	value := data.(float64)

	var result float64
	var message string

	if mode == "c_to_f" {
		// Celsius to Fahrenheit
		result = (value * 9 / 5) + 32
		message = fmt.Sprintf("%.1f°C = %.1f°F", value, result)
	} else {
		// Fahrenheit to Celsius
		result = (value - 32) * 5 / 9
		message = fmt.Sprintf("%.1f°F = %.1f°C", value, result)
	}

	// Send notification
	_ = pluginCtx.Notify("Temperature Converted", message, "low")

	return result, nil
}

func main() {
	plugin := &TemperatureConverter{}

	// Create context
	client := ora.NewClient("http://localhost:8080", "api-key")
	pluginCtx := &ora.PluginContext{
		Client: client,
		AppID:  "temperature-converter",
		Settings: map[string]interface{}{
			"mode": "c_to_f",
		},
		InputData: map[string]interface{}{
			"data": 25.0,
		},
	}

	// Execute plugin
	result, err := plugin.Execute(context.Background(), pluginCtx)
	if err != nil {
		fmt.Printf("Error: %v\n", err)
		return
	}

	fmt.Printf("Result: %+v\n", result)
}
