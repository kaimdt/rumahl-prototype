<?php

declare(strict_types=1);

require_once __DIR__ . '/../src/monitoring.php';

function assert_same(mixed $expected, mixed $actual, string $message): void
{
    if ($expected !== $actual) {
        throw new RuntimeException($message . ': expected ' . var_export($expected, true) . ', got ' . var_export($actual, true));
    }
}

assert_same('major_outage', monitoring_worst_status(['operational', 'major_outage', 'degraded']), 'Worst status');
assert_same('maintenance', monitoring_worst_status(['operational', 'maintenance']), 'Maintenance status');

$state = monitoring_check_transition('operational', false, 1, 0, 3, 2);
assert_same('operational', $state['status'], 'Failure threshold suppresses premature outage');
$state = monitoring_check_transition('operational', false, 2, 0, 3, 2);
assert_same('major_outage', $state['status'], 'Failure threshold opens outage');
$state = monitoring_check_transition('major_outage', true, 0, 0, 3, 2);
assert_same('major_outage', $state['status'], 'Recovery threshold suppresses premature recovery');
$state = monitoring_check_transition('major_outage', true, 0, 1, 3, 2);
assert_same('operational', $state['status'], 'Recovery threshold closes outage');

assert_same(false, monitoring_validate_target('http://127.0.0.1/health'), 'Loopback SSRF protection');
assert_same(false, monitoring_validate_target('http://10.0.0.4:8080/health'), 'Private network SSRF protection');
assert_same(false, monitoring_validate_target('http://service.local/health'), 'Local hostname SSRF protection');
assert_same(true, monitoring_validate_target('https://status.example.com/health'), 'Public hostname accepted');

assert_same('operational', resolve_component_display_status('operational', []), 'Monitor state without incident override');
assert_same('degraded', resolve_component_display_status('operational', ['degraded']), 'Single incident override');
assert_same('major_outage', resolve_component_display_status('degraded', ['partial_outage', 'major_outage']), 'Worst active override wins');
assert_same('maintenance', resolve_component_display_status('major_outage', ['maintenance']), 'Incident status overrides monitor state');
assert_same('operational', resolve_component_display_status('major_outage', ['operational']), 'Manual operational override is authoritative');

$normalized = normalize_incident_service_statuses([
    ['service_id' => 'service-a', 'status' => 'partial_outage'],
    ['component_id' => 'service-b', 'display_status' => 'major_outage'],
    ['service_id' => 'service-a', 'status' => 'degraded'],
    ['service_id' => 'service-invalid', 'status' => 'invalid'],
]);
assert_same([
    ['service_id' => 'service-a', 'status' => 'degraded'],
    ['service_id' => 'service-b', 'status' => 'major_outage'],
], $normalized, 'Incident service status normalization and de-duplication');

echo "monitoring tests passed\n";
