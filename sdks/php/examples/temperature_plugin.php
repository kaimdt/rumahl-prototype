<?php

require 'vendor/autoload.php';

use Iora\DataProcessorPlugin;
use Iora\PluginContext;

/**
 * Temperature Converter Plugin
 *
 * Converts temperature between Celsius and Fahrenheit
 */
class TemperatureConverter extends DataProcessorPlugin
{
    public function process(PluginContext $context, mixed $data): mixed
    {
        $mode = $context->settings['mode'] ?? 'c_to_f';
        $value = floatval($data);

        if ($mode === 'c_to_f') {
            // Celsius to Fahrenheit
            $result = ($value * 9 / 5) + 32;
            $context->notify(
                'Temperature Converted',
                sprintf('%.1f°C = %.1f°F', $value, $result),
                'low'
            );
            return $result;
        } else {
            // Fahrenheit to Celsius
            $result = ($value - 32) * 5 / 9;
            $context->notify(
                'Temperature Converted',
                sprintf('%.1f°F = %.1f°C', $value, $result),
                'low'
            );
            return $result;
        }
    }
}

// Example usage
$client = new \Iora\Client('http://localhost:8080', 'api-key');
$context = new PluginContext(
    client: $client,
    appId: 'temperature-converter',
    settings: ['mode' => 'c_to_f'],
    inputData: ['data' => 25.0]
);

$plugin = new TemperatureConverter();
$result = $plugin->execute($context);

echo "Result: " . json_encode($result, JSON_PRETTY_PRINT) . "\n";
