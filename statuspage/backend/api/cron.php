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

// CLI mode (hosting panel “PHP script” jobs): there is no $_GET, so the key
// is read from the arguments — php src/cron.php key=…
if (PHP_SAPI === 'cli') {
    $argvKey = '';
    foreach (($argv ?? []) as $arg) {
        if (str_starts_with((string) $arg, 'key=')) {
            $argvKey = substr((string) $arg, 4);
            break;
        }
    }
    $key = trim($argvKey);
} else {
    $key = trim((string) ($_GET['key'] ?? ''));
}
$configured = trim((string) $config['cron_key']);
if ($configured === '' || $key === '' || !hash_equals($configured, $key)) {
    $host = (string) ($_SERVER['HTTP_HOST'] ?? '');
    $hint = PHP_SAPI === 'cli'
        ? " — usage: php cron.php key=<cron_key>"
        : ($host !== ''
            ? " — expected URL: https://{$host}/cron.php?key=<cron_key> (no /httpdocs or /src path)"
            : '');
    if (PHP_SAPI === 'cli') {
        fwrite(STDERR, '[rumahl-status] Invalid cron key' . $hint . "\n");
        exit(1);
    }
    http_response_code(403);
    header('Content-Type: application/json; charset=utf-8');
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
