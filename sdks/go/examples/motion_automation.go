// Example: Motion-activated light automation
package main

import (
	"context"
	"fmt"
	"time"

	iora "github.com/iora/iora-sdk-go"
)

// MotionLightAutomation turns on lights when motion is detected
type MotionLightAutomation struct {
	iora.AutomationPlugin
}

// OnEvent handles motion events
func (mla *MotionLightAutomation) OnEvent(ctx context.Context, pluginCtx *iora.PluginContext, event map[string]interface{}) error {
	// Check if this is a state change event
	if event["type"] != "entity_state_changed" {
		return nil
	}

	data := event["data"].(map[string]interface{})
	entityID := data["entity_id"].(string)
	newState := data["new_state"].(string)

	// Get configured motion sensor
	motionSensorID := pluginCtx.Settings["motion_sensor_id"].(string)
	if entityID != motionSensorID {
		return nil
	}

	// Get light settings
	lightID := pluginCtx.Settings["light_entity_id"].(string)
	brightness := int(pluginCtx.Settings["brightness"].(float64))

	// Turn on light when motion detected
	if newState == "on" {
		err := pluginCtx.CallService("light", "turn_on", lightID, map[string]interface{}{
			"brightness": brightness,
		})
		if err != nil {
			return err
		}

		err = pluginCtx.Notify(
			"Motion Detected",
			fmt.Sprintf("Turned on %s at %d brightness", lightID, brightness),
			"normal",
		)
		if err != nil {
			return err
		}

		// Store activation time
		err = pluginCtx.Store("last_activation", time.Now().Unix())
		if err != nil {
			return err
		}
	} else if newState == "off" {
		// Turn off light when motion clears
		timeout := int(pluginCtx.Settings["timeout"].(float64))

		// Wait for timeout
		time.Sleep(time.Duration(timeout) * time.Second)

		// Check if motion is still off
		sensor, err := pluginCtx.GetEntity(motionSensorID)
		if err != nil {
			return err
		}

		if sensor.State == "off" {
			err = pluginCtx.CallService("light", "turn_off", lightID, nil)
			if err != nil {
				return err
			}

			err = pluginCtx.Notify(
				"Auto-Off",
				fmt.Sprintf("Turned off %s after %ds", lightID, timeout),
				"normal",
			)
			if err != nil {
				return err
			}
		}
	}

	return nil
}

func main() {
	plugin := &MotionLightAutomation{}

	// Create context
	client := iora.NewClient("http://localhost:8080", "api-key")
	pluginCtx := &iora.PluginContext{
		Client: client,
		AppID:  "motion-light-automation",
		Settings: map[string]interface{}{
			"motion_sensor_id": "binary_sensor.motion_living_room",
			"light_entity_id":  "light.living_room",
			"brightness":       255.0,
			"timeout":          60.0,
		},
		InputData: map[string]interface{}{
			"event": map[string]interface{}{
				"type": "entity_state_changed",
				"data": map[string]interface{}{
					"entity_id": "binary_sensor.motion_living_room",
					"new_state": "on",
				},
			},
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
