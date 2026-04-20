<?php

require 'vendor/autoload.php';

use Iora\AutomationPlugin;
use Iora\PluginContext;

/**
 * Motion Light Automation Plugin
 *
 * Turns on lights when motion is detected
 */
class MotionLightAutomation extends AutomationPlugin
{
    public function onEvent(PluginContext $context, array $event): void
    {
        // Check if this is a state change event
        if (($event['type'] ?? '') !== 'entity_state_changed') {
            return;
        }

        $data = $event['data'] ?? [];
        $entityId = $data['entity_id'] ?? '';
        $newState = $data['new_state'] ?? '';

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

            // Store activation time
            $context->store('last_activation', time());
        } elseif ($newState === 'off') {
            // Turn off light when motion clears
            $timeout = $context->settings['timeout'] ?? 60;

            // Wait for timeout
            sleep($timeout);

            // Check if motion is still off
            $sensor = $context->getEntity($motionSensorId);
            if ($sensor->state === 'off') {
                $context->callService('light', 'turn_off', $lightId);
                $context->notify(
                    'Auto-Off',
                    "Turned off {$lightId} after {$timeout}s"
                );
            }
        }
    }
}

// Example usage
$client = new \Iora\Client('http://localhost:8080', 'api-key');
$context = new PluginContext(
    client: $client,
    appId: 'motion-light-automation',
    settings: [
        'motion_sensor_id' => 'binary_sensor.motion_living_room',
        'light_entity_id' => 'light.living_room',
        'brightness' => 255,
        'timeout' => 60
    ],
    inputData: [
        'event' => [
            'type' => 'entity_state_changed',
            'data' => [
                'entity_id' => 'binary_sensor.motion_living_room',
                'new_state' => 'on'
            ]
        ]
    ]
);

$plugin = new MotionLightAutomation();
$result = $plugin->execute($context);

echo "Result: " . json_encode($result, JSON_PRETTY_PRINT) . "\n";
