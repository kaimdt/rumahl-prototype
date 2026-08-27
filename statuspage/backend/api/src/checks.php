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
 * Perform a single check. Returns
 * [ok, latency_ms, status_code, error, softfail, dns_ms, connect_ms, tls_ms, server_ms]
 *
 * latency_ms is the TOTAL wall time; dns/connect/tls are the network phases
 * and server_ms is the time the target itself needed (TTFB minus network) —
 * the UI shows server_ms (falling back to latency_ms when unavailable, e.g.
 * on failures or non-HTTP checks), because DNS/TCP/TLS are infrastructure
 * and say nothing about the monitored service.
 */
function run_check(array $component): array
{
    $type = (string) ($component['check_type'] ?? 'http');
    return match ($type) {
        'tcp' => tcp_check($component),
        'ping' => ping_check($component),
        'dns' => dns_check($component),
        'ssl' => ssl_check($component),
        'smtp' => smtp_check($component),
        default => http_check($component),
    };
}

/** HTTP(S) check with custom headers + per-phase timing. */
function http_check(array $component): array
{
    $url = $component['endpoint_url'];
    if ($url === '') {
        return [false, null, null, 'No endpoint configured', false, null, null, null, null];
    }
    if (!filter_var($url, FILTER_VALIDATE_URL)) {
        return [false, null, null, 'Invalid endpoint URL', false, null, null, null, null];
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

    // Per-phase timing (seconds → ms). Network phases (DNS/TCP/TLS) are
    // infrastructure — the interesting value is server_ms (TTFB minus
    // network), which is what the UI shows.
    $info = curl_getinfo($ch);
    $dnsMs = (float) ($info['namelookup_time'] ?? 0);
    $connectMs = (float) ($info['connect_time'] ?? 0);
    $appConnectMs = (float) ($info['appconnect_time'] ?? 0);
    $startTransferMs = (float) ($info['starttransfer_time'] ?? 0);

    $dns = max(0, (int) round($dnsMs * 1000));
    $connect = $connectMs > 0 ? max(0, (int) round(($connectMs - $dnsMs) * 1000)) : null;
    $tls = $appConnectMs > 0 ? max(0, (int) round(($appConnectMs - $connectMs) * 1000)) : null;
    $server = $startTransferMs > 0
        ? max(0, (int) round(($startTransferMs - ($appConnectMs > 0 ? $appConnectMs : $connectMs)) * 1000))
        : null;
    curl_close($ch);
    unset($body);

    if ($error !== '') {
        return [false, $latencyMs, $statusCode, $error, false, $dns, $connect, $tls, $server];
    }
    $expected = (int) $component['expected_status'];
    $ok = $statusCode === $expected;
    return [
        $ok,
        $latencyMs,
        $statusCode,
        $ok ? null : "Unexpected HTTP status {$statusCode} (expected {$expected})",
        true, // answered → softfail, not a connectivity failure
        $dns,
        $connect,
        $tls,
        $server,
    ];
}

/** TCP connect check — endpoint is "host" or "host:port" (default 80). */
function tcp_check(array $component): array
{
    $target = trim((string) $component['endpoint_url']);
    if ($target === '') {
        return [false, null, null, 'No endpoint configured', false, null, null, null, null];
    }

    $host = $target;
    $port = 80;
    $scheme = null;
    if (preg_match('#^([a-z][a-z0-9+.-]*)://#i', $target, $m)) {
        $scheme = strtolower($m[1]);
        $parts = parse_url($target);
        if ($parts === false || empty($parts['host'])) {
            return [false, null, null, 'Invalid TCP endpoint URL', false, null, null, null, null];
        }
        $host = (string) $parts['host'];
        $port = (int) ($parts['port'] ?? ($scheme === 'https' ? 443 : 80));
    } elseif (preg_match('/^(.*):(\d{1,5})$/', $target, $m)) {
        $host = $m[1];
        $port = (int) $m[2];
        if ($port < 1 || $port > 65535) {
            return [false, null, null, "Invalid port {$port}", false, null, null, null, null];
        }
    }
    if ($host === '' || preg_match('/[\s;|&`$<>]/', $host)) {
        return [false, null, null, 'Invalid TCP host', false, null, null, null, null];
    }

    $timeout = max(0.5, (int) $component['timeout_ms'] / 1000);
    $address = $scheme === 'https' ? 'ssl://' . $host : $host;
    $start = hrtime(true);
    $fp = @fsockopen($address, $port, $errno, $errstr, $timeout);
    $latencyMs = (int) round((hrtime(true) - $start) / 1e6);
    if ($fp === false) {
        return [false, $latencyMs, null, "TCP connection to {$host}:{$port} failed ({$errstr})", false, null, null, null, null];
    }
    fclose($fp);
    // For TCP checks the connect time IS the service time.
    return [true, $latencyMs, null, null, false, null, $latencyMs, null, $latencyMs];
}

/** ICMP ping check — endpoint is a hostname or IP address. */
function ping_check(array $component): array
{
    $host = trim((string) $component['endpoint_url']);
    if ($host === '') {
        return [false, null, null, 'No endpoint configured', false, null, null, null, null];
    }
    // Whitelist: hostnames and IPv4 addresses only — never pass anything
    // else to the shell.
    if (!preg_match('/^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$/', $host)) {
        return [false, null, null, 'Invalid ping host', false, null, null, null, null];
    }
    if (!function_exists('exec')) {
        return [false, null, null, 'Ping unavailable (exec disabled)', false, null, null, null, null];
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
        return [false, $latencyMs, null, $error, false, null, null, null, null];
    }

    // Parse round-trip time: "time=12.3 ms" (Linux) / "time<1ms" (Windows).
    $roundTrip = null;
    if (preg_match('/time[=<]([\d.]+)/i', $text, $m)) {
        $roundTrip = (int) round((float) $m[1]);
    }
    // For ping checks the round-trip IS the service time.
    return [true, $roundTrip ?? $latencyMs, null, null, false, null, null, null, $roundTrip ?? $latencyMs];
}

/** DNS resolution check — endpoint is a hostname; status_code = IP count. */
function dns_check(array $component): array
{
    $host = trim((string) $component['endpoint_url']);
    if ($host === '') {
        return [false, null, null, 'No endpoint configured', false, null, null, null, null];
    }
    if (!preg_match('/^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$/', $host)) {
        return [false, null, null, 'Invalid DNS host', false, null, null, null, null];
    }
    if (!function_exists('dns_get_record')) {
        return [false, null, null, 'DNS lookup unavailable (dns_get_record disabled)', false, null, null, null, null];
    }

    $start = hrtime(true);
    $records = @dns_get_record($host, DNS_A | DNS_AAAA);
    $latencyMs = (int) round((hrtime(true) - $start) / 1e6);

    if ($records === false || $records === []) {
        return [false, $latencyMs, null, "DNS resolution failed for {$host}", false, null, null, null, null];
    }
    $ipCount = count(array_filter($records, fn (array $r) => isset($r['ip'])));
    // DNS lookup time IS the service time here.
    return [true, $latencyMs, $ipCount, null, false, null, null, null, $latencyMs];
}

/**
 * SSL/TLS certificate expiry check — endpoint is "host[:port]" (default 443).
 * The certificate is fetched without verifying the chain (so self-signed
 * certs do not fail the check); FAIL = expired, status_code = days left.
 */
function ssl_check(array $component): array
{
    $target = trim((string) $component['endpoint_url']);
    if ($target === '') {
        return [false, null, null, 'No endpoint configured', false, null, null, null, null];
    }
    $host = $target;
    $port = 443;
    if (preg_match('/^(.*):(\d{1,5})$/', $target, $m)) {
        $host = $m[1];
        $port = (int) $m[2];
        if ($port < 1 || $port > 65535) {
            return [false, null, null, "Invalid port {$port}", false, null, null, null, null];
        }
    }
    if ($host === '' || preg_match('/[\s;|&`$<>]/', $host)) {
        return [false, null, null, 'Invalid SSL host', false, null, null, null, null];
    }
    if (!function_exists('openssl_x509_parse')) {
        return [false, null, null, 'Certificate check unavailable (openssl disabled)', false, null, null, null, null];
    }

    $timeout = max(0.5, (int) $component['timeout_ms'] / 1000);
    $context = stream_context_create([
        'ssl' => [
            'capture_peer_cert' => true,
            'verify_peer' => false,
            'verify_peer_name' => false,
            'allow_self_signed' => true,
        ],
    ]);
    $start = hrtime(true);
    $fp = @stream_socket_client(
        "ssl://{$host}:{$port}",
        $errno,
        $errstr,
        $timeout,
        STREAM_CLIENT_CONNECT,
        $context
    );
    $latencyMs = (int) round((hrtime(true) - $start) / 1e6);
    if ($fp === false) {
        return [false, $latencyMs, null, "TLS handshake to {$host}:{$port} failed ({$errstr})", false, null, $latencyMs, $latencyMs, null];
    }
    $params = stream_context_get_params($fp);
    fclose($fp);

    $cert = $params['options']['ssl']['peer_certificate'] ?? null;
    if ($cert === null) {
        return [false, $latencyMs, null, "No certificate presented by {$host}:{$port}", false, null, $latencyMs, $latencyMs, null];
    }
    $parsed = openssl_x509_parse($cert);
    $validTo = (int) ($parsed['validTo_time_t'] ?? 0);
    $daysLeft = (int) floor(($validTo - time()) / 86400);
    if ($daysLeft <= 0) {
        return [
            false,
            $latencyMs,
            $daysLeft,
            'Certificate expired on ' . gmdate('Y-m-d', $validTo),
            false,
            null,
            $latencyMs,
            $latencyMs,
            null,
        ];
    }
    // TLS handshake time IS the service time here.
    return [true, $latencyMs, $daysLeft, null, false, null, $latencyMs, $latencyMs, $latencyMs];
}

/** SMTP check — connects, waits for the banner and answers EHLO. */
function smtp_check(array $component): array
{
    $target = trim((string) $component['endpoint_url']);
    if ($target === '') {
        return [false, null, null, 'No endpoint configured', false, null, null, null, null];
    }
    $host = $target;
    $port = 25;
    if (preg_match('/^(.*):(\d{1,5})$/', $target, $m)) {
        $host = $m[1];
        $port = (int) $m[2];
        if ($port < 1 || $port > 65535) {
            return [false, null, null, "Invalid port {$port}", false, null, null, null, null];
        }
    }
    if ($host === '' || preg_match('/[\s;|&`$<>]/', $host)) {
        return [false, null, null, 'Invalid SMTP host', false, null, null, null, null];
    }

    $timeout = max(0.5, (int) $component['timeout_ms'] / 1000);
    $start = hrtime(true);
    $fp = @fsockopen($host, $port, $errno, $errstr, $timeout);
    $connectMs = (int) round((hrtime(true) - $start) / 1e6);
    if ($fp === false) {
        return [false, $connectMs, null, "SMTP connection to {$host}:{$port} failed ({$errstr})", false, null, $connectMs, null, null];
    }
    stream_set_timeout($fp, (int) ceil($timeout));

    $banner = fgets($fp, 512);
    if ($banner === false || !preg_match('/^2\d\d/', trim((string) $banner))) {
        fclose($fp);
        $detail = trim((string) ($banner ?: ''));
        return [
            false,
            $connectMs,
            null,
            "SMTP banner error from {$host}:{$port}" . ($detail !== '' ? ": {$detail}" : ' (no response)'),
            false,
            null,
            $connectMs,
            null,
            null,
        ];
    }

    $bannerMs = (int) round((hrtime(true) - $start) / 1e6);
    fwrite($fp, "EHLO rumahl-status\r\n");
    $last = '';
    while (($line = fgets($fp, 512)) !== false) {
        $last = $line;
        if (preg_match('/^\d{3} /', $line)) {
            break; // final reply line
        }
    }
    fwrite($fp, "QUIT\r\n");
    fclose($fp);

    if (!preg_match('/^2\d\d/', trim((string) $last))) {
        return [false, $bannerMs, null, "SMTP EHLO failed on {$host}:{$port}", false, null, $connectMs, null, null];
    }
    // Time until the banner IS the service time here.
    return [true, $bannerMs, null, null, false, null, $connectMs, null, $bannerMs];
}

/**
 * Derive a component status from its recent check results.
 * Rules (window = last N results):
 *   - all ok, avg latency <= threshold           → operational
 *   - all ok, avg latency > threshold            → degraded
 *   - >= 60% ok                                  → degraded
 *   - >= 20% ok                                  → partial_outage
 *   - < 20% ok                                   → major_outage
 *
 * Latency is the EFFECTIVE service time (server_ms, falling back to the
 * total for non-HTTP checks / old rows) — network phases are not counted.
 * The threshold is the component's override (0 = global setting).
 */
function derive_status(string $componentId, int $window, ?array $component = null): string
{
    $settings = settings_get();
    $rows = db_all(
        'SELECT ok, COALESCE(server_ms, latency_ms) AS latency_ms FROM check_results
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
    $override = (int) ($component['latency_threshold_ms'] ?? 0);
    $threshold = $override > 0 ? $override : (int) $settings['latency_threshold_ms'];
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
        'INSERT INTO check_results (component_id, ok, softfail, latency_ms, dns_ms, connect_ms,
                                    tls_ms, server_ms, status_code, error, checked_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [
            $componentId,
            $result[0] ? 1 : 0,
            $result[4] ? 1 : 0,
            $result[1],
            $result[5],
            $result[6],
            $result[7],
            $result[8],
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
    db_exec(
        'UPDATE monitoring_services SET status = ?, updated_at = ? WHERE legacy_component_id = ?',
        [$newStatus, now_utc(), $componentId]
    );

    if ($manual) {
        return; // manual changes are admin actions, no alert
    }

    $component = db_row('SELECT name FROM components WHERE id = ?', [$componentId]);
    $from = $current['status'] ?? 'operational';
    if ($from === $newStatus) {
        return;
    }

    // Maintenance transitions are planned and therefore silent — no alerts,
    // no automatic incidents (the monitor pauses checks for these components).
    if ($from === 'maintenance' || $newStatus === 'maintenance') {
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
        db_exec(
            "INSERT IGNORE INTO status_page_incidents (status_page_id, incident_id)
             SELECT id, ? FROM status_pages WHERE slug = 'default'",
            [$id]
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

    // Components covered by an active maintenance window are NOT checked —
    // their status is set to 'maintenance' (silently) and restored by the
    // next normal check once the window ends.
    $maintenanceIds = db_all(
        "SELECT DISTINCT ic.component_id FROM incident_components ic
          JOIN incidents i ON i.id = ic.incident_id
         WHERE i.type = 'maintenance' AND i.status IN ('scheduled','in_progress')"
    );
    $skipIds = [];
    foreach ($maintenanceIds as $m) {
        $skipIds[$m['component_id']] = true;
    }

    $results = [];
    foreach ($components as $component) {
        if (isset($skipIds[$component['id']])) {
            apply_status($component['id'], 'maintenance', manual: true);
            $results[] = [
                'component_id' => $component['id'],
                'name' => $component['name'],
                'check_type' => (string) ($component['check_type'] ?? 'http'),
                'ok' => true,
                'softfail' => false,
                'latency_ms' => null,
                'server_ms' => null,
                'status_code' => null,
                'error' => null,
                'status' => 'maintenance',
                'skipped' => true,
            ];
            continue;
        }
        $result = run_check($component);
        record_check($component['id'], $result);
        $newStatus = derive_status($component['id'], (int) $settings['failure_window'], $component);
        apply_status($component['id'], $newStatus);
        $results[] = [
            'component_id' => $component['id'],
            'name' => $component['name'],
            'check_type' => (string) ($component['check_type'] ?? 'http'),
            'ok' => $result[0],
            'softfail' => $result[4],
            'latency_ms' => $result[1],
            'server_ms' => $result[8],
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
