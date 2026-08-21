<?php
/**
 * Monitor — runs the HTTP checks, derives component status, maintains the
 * daily uptime table and queues alerts on status changes.
 */

declare(strict_types=1);

require_once __DIR__ . '/helpers.php';
require_once __DIR__ . '/status.php';

/** Perform a single HTTP check. Returns [ok, latency_ms, status_code, error]. */
function http_check(array $component): array
{
    $url = $component['endpoint_url'];
    if ($url === '') {
        return [false, null, null, 'No endpoint configured'];
    }
    if (!filter_var($url, FILTER_VALIDATE_URL)) {
        return [false, null, null, 'Invalid endpoint URL'];
    }

    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT_MS => max(500, (int) $component['timeout_ms']),
        CURLOPT_CONNECTTIMEOUT_MS => max(500, (int) $component['timeout_ms']),
        CURLOPT_NOBODY => ($component['method'] ?? 'GET') === 'HEAD',
        CURLOPT_FOLLOWLOCATION => false,
        CURLOPT_MAXREDIRS => 0,
        CURLOPT_USERAGENT => 'rumahl-status-monitor/1.0',
        CURLOPT_SSL_VERIFYPEER => true,
        CURLOPT_HTTPHEADER => ['Accept: */*'],
    ]);

    $start = hrtime(true);
    $body = curl_exec($ch);
    $latencyMs = (int) round((hrtime(true) - $start) / 1e6);
    $statusCode = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    $error = curl_error($ch);
    curl_close($ch);
    unset($body);

    if ($error !== '') {
        return [false, $latencyMs, $statusCode, $error];
    }
    $ok = $statusCode === (int) $component['expected_status'];
    return [$ok, $latencyMs, $statusCode, $ok ? null : "Unexpected HTTP status {$statusCode} (expected {$component['expected_status']})"];
}

/**
 * Derive a component status from its recent check results.
 * Rules (window = last N results):
 *   - all ok, avg latency <= threshold           → operational
 *   - all ok, avg latency > threshold            → degraded
 *   - >= 60% ok                                  → degraded
 *   - >= 20% ok                                  → partial_outage
 *   - < 20% ok                                   → major_outage
 */
function derive_status(string $componentId, int $window): string
{
    $settings = settings_get();
    $rows = db_all(
        'SELECT ok, latency_ms FROM check_results
          WHERE component_id = ?
          ORDER BY checked_at DESC, id DESC LIMIT ?',
        [$componentId, $window]
    );
    $count = count($rows);
    if ($count === 0) {
        return 'operational';
    }

    $okCount = 0;
    $latencySum = 0;
    foreach ($rows as $row) {
        if ((int) $row['ok'] === 1) {
            $okCount++;
            $latencySum += (int) $row['latency_ms'];
        }
    }

    $avgLatency = $okCount > 0 ? (int) round($latencySum / $okCount) : 0;
    $threshold = (int) $settings['latency_threshold_ms'];
    $allOk = $okCount === $count;

    if ($allOk) {
        return $avgLatency > $threshold ? 'degraded' : 'operational';
    }
    if ($okCount >= (int) ceil($count * 0.6)) {
        return 'degraded';
    }
    if ($okCount >= (int) ceil($count * 0.2)) {
        return 'partial_outage';
    }
    return 'major_outage';
}

/** Record one check result + update the daily uptime counter. */
function record_check(string $componentId, array $result): void
{
    db_exec(
        'INSERT INTO check_results (component_id, ok, latency_ms, status_code, error, checked_at)
         VALUES (?, ?, ?, ?, ?, ?)',
        [
            $componentId,
            $result[0] ? 1 : 0,
            $result[1],
            $result[2],
            $result[3],
            now_utc(),
        ]
    );
    db_exec(
        'INSERT INTO uptime_daily (component_id, day, ok_count, total_count)
         VALUES (?, CURDATE(), ?, 1)
         ON DUPLICATE KEY UPDATE ok_count = ok_count + ?, total_count = total_count + 1',
        [$componentId, $result[0] ? 1 : 0, $result[0] ? 1 : 0]
    );
}

/** Persist a component status change and queue an alert if it changed. */
function apply_status(string $componentId, string $newStatus, bool $manual = false): void
{
    $current = db_row(
        'SELECT status FROM component_status WHERE component_id = ?',
        [$componentId]
    );

    if ($current !== null && $current['status'] === $newStatus) {
        return;
    }

    db_exec(
        'INSERT INTO component_status (component_id, status, changed_at)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE status = VALUES(status), changed_at = VALUES(changed_at)',
        [$componentId, $newStatus, now_utc()]
    );

    if ($manual) {
        return; // manual changes are admin actions, no alert
    }

    $component = db_row('SELECT name FROM components WHERE id = ?', [$componentId]);
    $from = $current['status'] ?? 'operational';
    if ($from === $newStatus) {
        return;
    }

    $settings = settings_get();
    $rank = array_flip(COMPONENT_STATUSES);
    $worsening = $rank[$newStatus] > $rank[$from];

    $subject = $worsening
        ? "[rumahl Status] {$component['name']} is now {$newStatus}"
        : "[rumahl Status] {$component['name']} recovered to {$newStatus}";
    $body = sprintf(
        "Component: %s\nStatus: %s → %s\nTime: %s UTC\nPage: %s",
        $component['name'],
        $from,
        $newStatus,
        now_utc(),
        $settings['page_url']
    );

    queue_alerts('component_status', $subject, $body);
}

/** Queue email + webhook alerts for all configured channels. */
function queue_alerts(string $type, string $subject, string $body): void
{
    $settings = settings_get();
    foreach ($settings['alert_emails'] as $email) {
        db_exec(
            'INSERT INTO alert_log (type, subject, body, channel, recipient, status, attempts, created_at)
             VALUES (?, ?, ?, ?, ?, ?, 0, ?)',
            [$type, $subject, $body, 'email', $email, 'pending', now_utc()]
        );
    }
    foreach ($settings['webhook_urls'] as $url) {
        db_exec(
            'INSERT INTO alert_log (type, subject, body, channel, recipient, status, attempts, created_at)
             VALUES (?, ?, ?, ?, ?, ?, 0, ?)',
            [$type, $subject, $body, 'webhook', $url, 'pending', now_utc()]
        );
    }
}

/** Full monitor cycle. Returns a summary for callers (CLI / HTTP cron). */
function run_monitor(): array
{
    $settings = settings_get();
    $components = db_all(
        "SELECT * FROM components WHERE enabled = 1 AND kind = 'auto' ORDER BY position ASC"
    );

    $results = [];
    foreach ($components as $component) {
        $result = http_check($component);
        record_check($component['id'], $result);
        $newStatus = derive_status($component['id'], (int) $settings['failure_window']);
        apply_status($component['id'], $newStatus);
        $results[] = [
            'component_id' => $component['id'],
            'name' => $component['name'],
            'ok' => $result[0],
            'latency_ms' => $result[1],
            'status_code' => $result[2],
            'error' => $result[3],
            'status' => $newStatus,
        ];
    }

    // Best-effort cleanup of raw check results (kept 14 days).
    db_exec('DELETE FROM check_results WHERE checked_at < DATE_SUB(NOW(), INTERVAL 14 DAY)');

    $sent = process_alerts();

    return [
        'checked' => count($results),
        'ok' => count(array_filter($results, fn (array $r) => $r['ok'])),
        'failed' => count(array_filter($results, fn (array $r) => !$r['ok'])),
        'alerts_sent' => $sent,
        'results' => $results,
    ];
}
