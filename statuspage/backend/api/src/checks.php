<?php
/**
 * Monitor — runs the checks (HTTP/TCP/ping), derives component status,
 * maintains the daily uptime table, queues alerts on status changes and
 * creates/resolves incidents automatically on outages.
 */

declare(strict_types=1);

require_once __DIR__ . '/helpers.php';
require_once __DIR__ . '/status.php';
require_once __DIR__ . '/incidents.php';

/** Parse the custom headers column (JSON array of "Name: value" lines). */
function check_headers(array $component): array
{
    $raw = (string) ($component['headers'] ?? '');
    if ($raw === '') {
        return [];
    }
    $decoded = json_decode($raw, true);
    if (!is_array($decoded)) {
        return [];
    }
    $headers = [];
    foreach ($decoded as $line) {
        if (is_string($line) && trim($line) !== '' && str_contains($line, ':')) {
            $headers[] = trim($line);
        }
    }
    return $headers;
}

/**
 * Perform a single check. Returns [ok, latency_ms, status_code, error, softfail].
 * softfail = the target answered, but the response did not match expectations
 * (e.g. HTTP 308 instead of 200) — as opposed to a hard failure (timeout,
 * connection refused, DNS error).
 */
function run_check(array $component): array
{
    $type = (string) ($component['check_type'] ?? 'http');
    return match ($type) {
        'tcp' => tcp_check($component),
        'ping' => ping_check($component),
        default => http_check($component),
    };
}

/** HTTP(S) check with custom headers. */
function http_check(array $component): array
{
    $url = $component['endpoint_url'];
    if ($url === '') {
        return [false, null, null, 'No endpoint configured', false];
    }
    if (!filter_var($url, FILTER_VALIDATE_URL)) {
        return [false, null, null, 'Invalid endpoint URL', false];
    }

    $curlHeaders = array_merge(['Accept: */*'], check_headers($component));
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
        CURLOPT_HTTPHEADER => $curlHeaders,
    ]);

    $start = hrtime(true);
    $body = curl_exec($ch);
    $latencyMs = (int) round((hrtime(true) - $start) / 1e6);
    $statusCode = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    $error = curl_error($ch);
    curl_close($ch);
    unset($body);

    if ($error !== '') {
        return [false, $latencyMs, $statusCode, $error, false];
    }
    $expected = (int) $component['expected_status'];
    $ok = $statusCode === $expected;
    return [
        $ok,
        $latencyMs,
        $statusCode,
        $ok ? null : "Unexpected HTTP status {$statusCode} (expected {$expected})",
        true, // answered → softfail, not a connectivity failure
    ];
}

/** TCP connect check — endpoint is "host" or "host:port" (default 80). */
function tcp_check(array $component): array
{
    $target = trim((string) $component['endpoint_url']);
    if ($target === '') {
        return [false, null, null, 'No endpoint configured', false];
    }

    $host = $target;
    $port = 80;
    $scheme = null;
    if (preg_match('#^([a-z][a-z0-9+.-]*)://#i', $target, $m)) {
        $scheme = strtolower($m[1]);
        $parts = parse_url($target);
        if ($parts === false || empty($parts['host'])) {
            return [false, null, null, 'Invalid TCP endpoint URL', false];
        }
        $host = (string) $parts['host'];
        $port = (int) ($parts['port'] ?? ($scheme === 'https' ? 443 : 80));
    } elseif (preg_match('/^(.*):(\d{1,5})$/', $target, $m)) {
        $host = $m[1];
        $port = (int) $m[2];
        if ($port < 1 || $port > 65535) {
            return [false, null, null, "Invalid port {$port}", false];
        }
    }
    if ($host === '' || preg_match('/[\s;|&`$<>]/', $host)) {
        return [false, null, null, 'Invalid TCP host', false];
    }

    $timeout = max(0.5, (int) $component['timeout_ms'] / 1000);
    $address = $scheme === 'https' ? 'ssl://' . $host : $host;
    $start = hrtime(true);
    $fp = @fsockopen($address, $port, $errno, $errstr, $timeout);
    $latencyMs = (int) round((hrtime(true) - $start) / 1e6);
    if ($fp === false) {
        return [false, $latencyMs, null, "TCP connection to {$host}:{$port} failed ({$errstr})", false];
    }
    fclose($fp);
    return [true, $latencyMs, null, null, false];
}

/** ICMP ping check — endpoint is a hostname or IP address. */
function ping_check(array $component): array
{
    $host = trim((string) $component['endpoint_url']);
    if ($host === '') {
        return [false, null, null, 'No endpoint configured', false];
    }
    // Whitelist: hostnames and IPv4 addresses only — never pass anything
    // else to the shell.
    if (!preg_match('/^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$/', $host)) {
        return [false, null, null, 'Invalid ping host', false];
    }
    if (!function_exists('exec')) {
        return [false, null, null, 'Ping unavailable (exec disabled)', false];
    }

    $isWindows = strtoupper(PHP_OS_FAMILY ?? '') === 'WINDOWS';
    // Linux: ping -n -c 1 -W 2 host  |  Windows: ping -n 1 -w 2000 host
    $cmd = $isWindows
        ? sprintf('ping -n 1 -w 2000 %s 2>&1', escapeshellarg($host))
        : sprintf('ping -n -c 1 -W 2 %s 2>&1', escapeshellarg($host));

    $start = hrtime(true);
    $output = [];
    $exitCode = 0;
    exec($cmd, $output, $exitCode);
    $latencyMs = (int) round((hrtime(true) - $start) / 1e6);
    $text = implode("\n", $output);

    if ($exitCode !== 0) {
        $detail = trim((string) end($output));
        $error = $detail !== '' ? "Ping to {$host} failed: {$detail}" : "Ping to {$host} failed";
        return [false, $latencyMs, null, $error, false];
    }

    // Parse round-trip time: "time=12.3 ms" (Linux) / "time<1ms" (Windows).
    $roundTrip = null;
    if (preg_match('/time[=<]([\d.]+)/i', $text, $m)) {
        $roundTrip = (int) round((float) $m[1]);
    }
    return [true, $roundTrip ?? $latencyMs, null, null, false];
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
        'INSERT INTO check_results (component_id, ok, softfail, latency_ms, status_code, error, checked_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)',
        [
            $componentId,
            $result[0] ? 1 : 0,
            $result[4] ? 1 : 0,
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

    // Automatic incidents on outages (and automatic resolution on recovery).
    sync_auto_incident($componentId, $component['name'] ?? 'Component', $from, $newStatus);

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

/**
 * Create / update / resolve automatic incidents based on status changes.
 *
 * - Worsening to partial_outage or major_outage: create an auto incident
 *   (or append a status update to the still-open one for this component).
 * - Recovery back to operational/degraded: resolve all open auto incidents
 *   for the component with a final update.
 */
function sync_auto_incident(string $componentId, string $name, string $from, string $to): void
{
    $settings = settings_get();
    if (!(int) ($settings['auto_incidents_enabled'] ?? 1)) {
        return;
    }

    $rank = array_flip(COMPONENT_STATUSES);
    $worsening = $rank[$to] > $rank[$from];
    $outage = in_array($to, ['partial_outage', 'major_outage'], true);

    if ($worsening && $outage) {
        $open = db_all(
            "SELECT i.* FROM incidents i
              JOIN incident_components ic ON ic.incident_id = i.id
             WHERE ic.component_id = ?
               AND i.source = 'auto'
               AND i.type = 'incident'
               AND i.status NOT IN ('resolved','completed')
             ORDER BY i.starts_at DESC LIMIT 1",
            [$componentId]
        );

        $impact = $to === 'major_outage' ? 'critical' : 'major';
        if ($open !== []) {
            $incident = $open[0];
            db_exec(
                'UPDATE incidents SET impact = ?, updated_at = ? WHERE id = ?',
                [$impact, now_utc(), $incident['id']]
            );
            $message = sprintf(
                'Status changed from %s to %s (automatic check).',
                str_replace('_', ' ', $from),
                str_replace('_', ' ', $to)
            );
            add_incident_update($incident['id'], $incident['status'], $message);
            $incident['impact'] = $impact;
            queue_incident_alert($incident, (string) $incident['status'], $message);
            return;
        }

        $id = uuid4();
        $title = $to === 'major_outage'
            ? "{$name} is down"
            : "{$name} is experiencing a partial outage";
        db_exec(
            'INSERT INTO incidents (id, type, source, title, status, impact, starts_at, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [$id, 'incident', 'auto', $title, 'investigating', $impact, now_utc(), now_utc(), now_utc()]
        );
        db_exec(
            'INSERT INTO incident_components (incident_id, component_id) VALUES (?, ?)',
            [$id, $componentId]
        );
        $message = sprintf(
            'Detected automatically: %s changed from %s to %s.',
            $name,
            str_replace('_', ' ', $from),
            str_replace('_', ' ', $to)
        );
        add_incident_update($id, 'investigating', $message);

        $row = db_row('SELECT * FROM incidents WHERE id = ?', [$id]);
        if ($row !== null) {
            queue_incident_alert($row, 'investigating', $message);
        }
        return;
    }

    if (!$worsening && $rank[$to] < $rank['partial_outage']) {
        // Recovery: resolve open auto incidents for this component.
        $open = db_all(
            "SELECT i.* FROM incidents i
              JOIN incident_components ic ON ic.incident_id = i.id
             WHERE ic.component_id = ?
               AND i.source = 'auto'
               AND i.type = 'incident'
               AND i.status NOT IN ('resolved','completed')
             ORDER BY i.starts_at DESC",
            [$componentId]
        );
        foreach ($open as $incident) {
            $message = sprintf(
                'Recovered — %s is back to %s.',
                $name,
                str_replace('_', ' ', $to)
            );
            db_exec(
                'UPDATE incidents SET status = ?, resolves_at = ?, updated_at = ? WHERE id = ?',
                ['resolved', now_utc(), now_utc(), $incident['id']]
            );
            add_incident_update($incident['id'], 'resolved', $message);
            $incident['status'] = 'resolved';
            queue_incident_alert($incident, 'resolved', $message);
        }
    }
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
        $result = run_check($component);
        record_check($component['id'], $result);
        $newStatus = derive_status($component['id'], (int) $settings['failure_window']);
        apply_status($component['id'], $newStatus);
        $results[] = [
            'component_id' => $component['id'],
            'name' => $component['name'],
            'check_type' => (string) ($component['check_type'] ?? 'http'),
            'ok' => $result[0],
            'softfail' => $result[4],
            'latency_ms' => $result[1],
            'status_code' => $result[2],
            'error' => $result[3],
            'status' => $newStatus,
        ];
    }

    // Best-effort cleanup of raw check results (kept 31 days — long enough
    // for the per-day outage episode details behind the uptime bars).
    db_exec('DELETE FROM check_results WHERE checked_at < DATE_SUB(NOW(), INTERVAL 31 DAY)');

    $sent = process_alerts();

    return [
        'checked' => count($results),
        'ok' => count(array_filter($results, fn (array $r) => $r['ok'])),
        'failed' => count(array_filter($results, fn (array $r) => !$r['ok'])),
        'alerts_sent' => $sent,
        'results' => $results,
    ];
}
