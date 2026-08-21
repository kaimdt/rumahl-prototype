<?php
/**
 * HTTP cron entry point — for hosting panels without CLI cron:
 *
 *   https://status.rumahl.com/api/cron.php?key=YOUR_CRON_KEY
 *
 * Runs the full monitor cycle (checks + alerts). Returns JSON.
 * A cron service should call this URL every minute.
 */

declare(strict_types=1);

require_once __DIR__ . '/src/checks.php';
require_once __DIR__ . '/src/alerts.php';

$config = statuspage_config();

$key = trim((string) ($_GET['key'] ?? ''));
$configured = trim((string) $config['cron_key']);
if ($configured === '' || $key === '' || !hash_equals($configured, $key)) {
    http_response_code(403);
    header('Content-Type: application/json; charset=utf-8');
    $host = (string) ($_SERVER['HTTP_HOST'] ?? '');
    $hint = $host !== ''
        ? " — expected URL: https://{$host}/cron.php?key=<cron_key> (no /httpdocs or /src path)"
        : '';
    echo json_encode(['error' => 'Invalid cron key' . $hint]);
    exit;
}

set_time_limit(120);

try {
    $result = run_monitor();
    json_out(['ok' => true] + $result);
} catch (Throwable $e) {
    error_log('[rumahl-status] cron: ' . $e->getMessage());
    json_error('Monitor failed: ' . $e->getMessage(), 500);
}
