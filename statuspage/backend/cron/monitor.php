#!/usr/bin/env php
<?php
/**
 * CLI monitor — run from cron every minute:
 *
 *   * * * * * php /path/to/docroot/api/cron/monitor.php >> /var/log/rumahl-status.log 2>&1
 *
 * Performs all HTTP checks, updates component status and sends pending
 * alerts. Exit code 0 on success, 1 on failure (for monitoring the monitor).
 */

declare(strict_types=1);

require_once __DIR__ . '/../api/src/checks.php';
require_once __DIR__ . '/../api/src/alerts.php';

set_time_limit(120);

try {
    $result = run_monitor();
    echo sprintf(
        "[%s] checks=%d ok=%d failed=%d alerts_sent=%d\n",
        gmdate('Y-m-d H:i:s'),
        $result['checked'],
        $result['ok'],
        $result['failed'],
        $result['alerts_sent']
    );
    exit(0); // exit 0 even with failures — failures are the *product*
} catch (Throwable $e) {
    fwrite(STDERR, '[rumahl-status] monitor failed: ' . $e->getMessage() . "\n");
    exit(1);
}
