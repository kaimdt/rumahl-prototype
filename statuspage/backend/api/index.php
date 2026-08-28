<?php
/**
 * rumahl Status Page — API front controller.
 *
 * Routes (all JSON unless noted):
 *   GET  /api/status             full public status
 *   GET  /api/status.json        statuspage.io-style machine output
 *   GET  /api/uptime             daily uptime for one component
 *   GET  /api/latency            latency series for one component (downsampled)
 *   GET  /api/downtime           outage episodes for one component on one day
 *   GET  /api/incidents          incident list (pagination) or ?id= detail
 *   GET  /api/rss                RSS feed of incidents & maintenance
 *   GET  /api/feed               alias of /api/rss (kept for compatibility)
 *   GET  /api/favicon.svg        status-colored favicon (green/yellow/orange/red/blue)
 *   POST /api/admin/auth/verify  check admin token
 *   GET  /api/admin/settings     GET/POST settings
 *   GET  /api/admin/components   components with groups
 *   POST /api/admin/components   create / update / delete component
 *   POST /api/admin/groups       create / update / delete group
 *   POST /api/admin/incidents    create / update / delete incident
 *   POST /api/admin/checks/run   run the monitor now
 *   GET  /api/admin/checks       recent check results
 *
 * The API works both deployed as <docroot>/api/ (path starts with /api)
 * and standalone (api/ as the document root).
 */

declare(strict_types=1);

require_once __DIR__ . '/src/helpers.php';
require_once __DIR__ . '/src/status.php';
require_once __DIR__ . '/src/checks.php';
require_once __DIR__ . '/src/alerts.php';
require_once __DIR__ . '/src/incidents.php';
require_once __DIR__ . '/src/admin.php';
require_once __DIR__ . '/src/monitoring.php';

$path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
$method = strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');

// Normalize: strip the /api mount prefix when deployed under a docroot.
if (str_starts_with($path, '/api')) {
    $path = substr($path, 4);
}
if ($path === '' || $path === '/') {
    $path = '/status';
}

try {
    route($method, $path);
} catch (Throwable $e) {
    error_log('[rumahl-status] ' . $e->getMessage() . ' @ ' . $e->getFile() . ':' . $e->getLine());
    json_error('Internal server error', 500);
}

function route(string $method, string $path): never
{
    if ($method === 'GET' && ($path === '/public/status' || str_starts_with($path, '/public/status/'))) {
        $slug = $path === '/public/status' ? null : rawurldecode(substr($path, strlen('/public/status/')));
        try {
            monitoring_public_page($slug);
        } catch (Throwable $e) {
            if ($slug === null || $slug === '' || $slug === 'default') {
                monitoring_public_default_fallback($e);
            }
            throw $e;
        }
    }
    // ── Public ──────────────────────────────────────────────────
    if ($method === 'GET' && $path === '/status') {
        json_out(build_status_response());
    }
    if ($method === 'GET' && $path === '/status.json') {
        json_out(build_statuspage_json(build_status_response()));
    }
    if ($method === 'GET' && $path === '/uptime') {
        route_uptime();
    }
    if ($method === 'GET' && $path === '/latency') {
        route_latency();
    }
    if ($method === 'GET' && $path === '/downtime') {
        route_downtime();
    }
    if ($method === 'GET' && $path === '/incidents') {
        route_incidents();
    }
    if ($method === 'GET' && ($path === '/rss' || $path === '/feed')) {
        route_feed();
    }
    if ($method === 'GET' && $path === '/favicon.svg') {
        route_favicon();
    }
    if ($method === 'POST' && $path === '/agents/heartbeat') {
        monitoring_agent_heartbeat();
    }

    // ── Admin ───────────────────────────────────────────────────
    if (str_starts_with($path, '/admin')) {
        // Login check runs before require_admin(): on some hosting setups
        // (Plesk / PHP-FPM) the Authorization header is stripped, so the
        // token from the JSON body is accepted as a fallback here.
        if ($method === 'POST' && $path === '/admin/auth/verify') {
            $body = json_body();
            $token = bearer_token() ?? $_SERVER['HTTP_X_AUTH_TOKEN'] ?? (string) ($body['token'] ?? '');
            $identity = operations_identity($token !== '' ? $token : null);
            if ($identity !== null) {
                json_out(['ok' => true, 'identity' => $identity]);
            }
            json_error('Unauthorized', 401);
        }

        require_admin();
        if ($method === 'GET' && $path === '/admin/settings') {
            admin_settings_get();
        }
        if ($method === 'POST' && $path === '/admin/settings') {
            admin_settings_save();
        }
        if ($method === 'GET' && $path === '/admin/components') {
            admin_components_get();
        }
        if ($method === 'POST' && str_starts_with($path, '/admin/components')) {
            $body = json_body();
            if (($body['action'] ?? '') === 'delete') {
                admin_components_delete();
            }
            if (($body['action'] ?? '') === 'move') {
                admin_components_move();
            }
            admin_components_save();
        }
        if ($method === 'POST' && $path === '/admin/groups') {
            $body = json_body();
            if (($body['action'] ?? '') === 'delete') {
                admin_groups_delete();
            }
            if (($body['action'] ?? '') === 'move') {
                admin_groups_move();
            }
            admin_groups_save();
        }
        if ($method === 'POST' && $path === '/admin/incidents') {
            $body = json_body();
            if (($body['action'] ?? '') === 'delete') {
                admin_incidents_delete();
            }
            admin_incidents_save();
        }
        if ($method === 'POST' && $path === '/admin/checks/run') {
            admin_checks_run();
        }
        if ($method === 'POST' && $path === '/admin/checks') {
            $body = json_body();
            if (($body['action'] ?? '') === 'delete') {
                admin_checks_delete();
            }
            if (($body['action'] ?? '') === 'clear') {
                admin_checks_clear();
            }
            json_error('Unknown action', 400);
        }
        if ($method === 'GET' && $path === '/admin/checks') {
            admin_checks_log();
        }
        if ($method === 'GET' && $path === '/admin/monitoring/overview') {
            monitoring_overview();
        }
        if ($method === 'GET' && preg_match('#^/admin/monitoring/(hosts|services|checks|alerts|agents|status-pages)$#', $path, $m)) {
            monitoring_list($m[1]);
        }
        if ($method === 'POST' && $path === '/admin/monitoring/hosts') {
            monitoring_save_host();
        }
        if ($method === 'POST' && $path === '/admin/monitoring/services') {
            monitoring_save_service();
        }
        if ($method === 'POST' && $path === '/admin/monitoring/checks') {
            monitoring_save_check();
        }
        if ($method === 'GET' && preg_match('#^/admin/monitoring/checks/([a-f0-9-]{36})$#', $path, $m)) {
            monitoring_check_detail($m[1]);
        }
        if ($method === 'POST' && preg_match('#^/admin/monitoring/checks/([a-f0-9-]{36})/test-alert$#', $path, $m)) {
            monitoring_test_alert($m[1]);
        }
        if ($method === 'POST' && preg_match('#^/admin/monitoring/checks/([a-f0-9-]{36})/run$#', $path, $m)) {
            monitoring_run_check_now($m[1]);
        }
        if ($method === 'POST' && $path === '/admin/monitoring/status-pages') {
            monitoring_save_status_page();
        }
        if ($method === 'POST' && $path === '/admin/monitoring/branding/upload') {
            monitoring_upload_branding();
        }
        if ($method === 'POST' && $path === '/admin/monitoring/domains') {
            monitoring_save_domain();
        }
        if ($method === 'POST' && $path === '/admin/monitoring/alerts/state') {
            monitoring_update_alert();
        }
        json_error('Not found', 404);
    }

    json_error('Not found', 404);
}

function route_uptime(): never
{
    $componentId = (string) ($_GET['component'] ?? '');
    if ($componentId === '') {
        json_error('Missing component parameter');
    }
    $days = max(7, min(365, (int) ($_GET['days'] ?? 90)));

    $rows = db_all(
        "SELECT day, ok_count, total_count FROM uptime_daily
          WHERE component_id = ? AND day >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
          ORDER BY day ASC",
        [$componentId, $days]
    );

    // Maintenance windows overlapping the range (still running = resolves_at NULL).
    $maintenanceWindows = db_all(
        "SELECT starts_at, resolves_at FROM incidents
          WHERE type = 'maintenance'
            AND (resolves_at IS NULL OR resolves_at >= DATE_SUB(CURDATE(), INTERVAL ? DAY))
            AND starts_at <= DATE_ADD(CURDATE(), INTERVAL 1 DAY)",
        [$days]
    );

    // Fill gaps (days without any checks) so the chart has a bar for each day.
    $uptime = [];
    $seen = array_fill_keys(array_column($rows, 'day'), true);
    for ($i = $days - 1; $i >= 0; $i--) {
        $day = gmdate('Y-m-d', strtotime("-{$i} days"));
        $dayStart = strtotime($day . ' 00:00:00');
        $dayEnd = $dayStart + 86400;
        if (isset($seen[$day])) {
            $row = $rows[array_search($day, array_column($rows, 'day'), true)];
            $total = (int) $row['total_count'];
            $ok = (int) $row['ok_count'];
            // ~1 check per minute → failed checks ≈ outage minutes. For days
            // without a single check total_count is 0 and the bar shows no data.
            $outageMin = $total > 0 ? max(0, $total - $ok) : null;
            $maintenanceMin = 0;
            foreach ($maintenanceWindows as $w) {
                $start = strtotime((string) $w['starts_at']);
                $end = $w['resolves_at'] !== null
                    ? strtotime((string) $w['resolves_at'])
                    : time();
                $overlap = max(0, min($end, $dayEnd) - max($start, $dayStart));
                if ($overlap > 0) {
                    $maintenanceMin += (int) ceil($overlap / 60);
                }
            }
            if ($outageMin !== null) {
                // Maintenance cannot exceed the remaining minutes of the day.
                $maintenanceMin = min($maintenanceMin, 1440 - $outageMin);
                $onlineMin = max(0, 1440 - $outageMin - $maintenanceMin);
            } else {
                // No checks ran (maintenance paused them) — the bar still
                // shows the maintenance window with the rest as online.
                $maintenanceMin = min($maintenanceMin, 1440);
                $onlineMin = $maintenanceMin > 0 ? 1440 - $maintenanceMin : null;
            }
            $uptime[] = [
                'day' => $day,
                'ok' => $ok,
                'total' => $total,
                'pct' => $total > 0 ? round($ok / $total * 100, 2) : null,
                'outage_min' => $outageMin,
                'maintenance_min' => $maintenanceMin,
                'online_min' => $onlineMin,
            ];
        } else {
            $uptime[] = [
                'day' => $day,
                'ok' => 0,
                'total' => 0,
                'pct' => null,
                'outage_min' => null,
                'maintenance_min' => null,
                'online_min' => null,
            ];
        }
    }
    json_out(['component_id' => $componentId, 'days' => $days, 'uptime' => $uptime]);
}

/**
 * Latency series for one component — downsampled into buckets so the
 * chart stays light (target ~500 points). Raw check results are kept for
 * 31 days, so older data is not available here.
 */
function route_latency(): never
{
    $componentId = (string) ($_GET['component'] ?? '');
    if ($componentId === '') {
        json_error('Missing component parameter');
    }
    $days = max(1, min(31, (int) ($_GET['days'] ?? 14)));

    $bucketSeconds = max(300, (int) ceil($days * 86400 / 500));
    $rows = db_all(
        'SELECT FROM_UNIXTIME(FLOOR(UNIX_TIMESTAMP(checked_at) / ?) * ?) AS bucket,
                AVG(COALESCE(server_ms, latency_ms)) AS avg_latency_ms,
                AVG(ok) AS success_ratio,
                COUNT(*) AS n
           FROM check_results
          WHERE component_id = ?
            AND checked_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
          GROUP BY bucket
          ORDER BY bucket ASC',
        [$bucketSeconds, $bucketSeconds, $componentId, $days]
    );

    json_out([
        'component_id' => $componentId,
        'days' => $days,
        'bucket_seconds' => $bucketSeconds,
        'points' => array_map(function (array $row): array {
            return [
                'bucket' => iso((string) $row['bucket']),
                'avg_latency_ms' => $row['avg_latency_ms'] !== null ? round((float) $row['avg_latency_ms'], 1) : null,
                'success_ratio' => $row['success_ratio'] !== null ? round((float) $row['success_ratio'], 4) : null,
                'n' => (int) $row['n'],
            ];
        }, $rows),
    ]);
}

/**
 * Outage episodes for one component on one day — used by the uptime bar
 * tooltip. Episodes are consecutive failing checks (gaps > 5 min split).
 * Falls back to the daily aggregate for days older than the raw retention.
 *
 * With ?days=N instead of ?day= the whole range is returned in one request
 * (all days with outages) so the frontend can render tooltips instantly.
 */
function route_downtime(): never
{
    $componentId = (string) ($_GET['component'] ?? '');
    $day = (string) ($_GET['day'] ?? '');
    if ($componentId === '') {
        json_error('Missing component parameter');
    }
    if ($day !== '') {
        if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $day)) {
            json_error('Invalid day parameter');
        }
        route_downtime_day($componentId, $day);
    }
    $days = max(1, min(365, (int) ($_GET['days'] ?? 31)));
    route_downtime_range($componentId, $days);
}

/** Episodes for a single day. */
function route_downtime_day(string $componentId, string $day): never
{
    $rows = db_all(
        'SELECT checked_at, ok FROM check_results
          WHERE component_id = ?
            AND checked_at >= ? AND checked_at < DATE_ADD(?, INTERVAL 1 DAY)
          ORDER BY checked_at ASC, id ASC',
        [$componentId, $day . ' 00:00:00', $day]
    );

    if ($rows === []) {
        // No raw data anymore (older than retention) — fall back to the
        // daily aggregate: each check runs once a minute, so failures ≈ minutes.
        $agg = db_row(
            'SELECT total_count, ok_count FROM uptime_daily
              WHERE component_id = ? AND day = ?',
            [$componentId, $day]
        );
        if ($agg === null || (int) $agg['total_count'] === 0) {
            json_out(['day' => $day, 'episodes' => [], 'total_min' => 0, 'count' => 0, 'approx' => false]);
        }
        $approxMin = (int) $agg['total_count'] - (int) $agg['ok_count'];
        json_out([
            'day' => $day,
            'episodes' => [],
            'total_min' => max(0, $approxMin),
            'count' => 0,
            'approx' => true,
        ]);
    }

    // Group consecutive failing checks into episodes (gap > 5 min splits).
    $episodes = [];
    $current = null; // [start, last]
    $failCount = 0;
    foreach ($rows as $row) {
        if ((int) $row['ok'] === 1) {
            continue;
        }
        $failCount++;
        $time = strtotime((string) $row['checked_at']);
        if ($current === null || $time - $current[1] > 300) {
            if ($current !== null) {
                $episodes[] = $current;
            }
            $current = [$time, $time];
        } else {
            $current[1] = $time;
        }
    }
    if ($current !== null) {
        $episodes[] = $current;
    }

    $out = [];
    $totalMin = 0;
    foreach ($episodes as [$start, $end]) {
        // Each failed check covers ~1 minute; add one minute for the last check.
        $durationMin = max(1, (int) ceil(($end - $start + 60) / 60));
        $totalMin += $durationMin;
        $out[] = [
            'start' => gmdate('Y-m-d\TH:i:s\Z', $start),
            'end' => gmdate('Y-m-d\TH:i:s\Z', $end),
            'duration_min' => $durationMin,
        ];
    }

    json_out([
        'day' => $day,
        'episodes' => $out,
        'total_min' => $totalMin,
        'count' => count($out),
        'approx' => false,
        'failed_checks' => $failCount,
    ]);
}

/** Episodes for every day of a range — one request, instant tooltips. */
function route_downtime_range(string $componentId, int $days): never
{
    // 1) Episodes from raw check results (kept 31 days).
    $failRows = db_all(
        'SELECT checked_at FROM check_results
          WHERE component_id = ? AND ok = 0
            AND checked_at >= DATE_SUB(NOW(), INTERVAL 31 DAY)
          ORDER BY checked_at ASC, id ASC',
        [$componentId]
    );
    $detail = [];
    $current = null; // [day, start, last]
    foreach ($failRows as $row) {
        $ts = strtotime((string) $row['checked_at']);
        $d = gmdate('Y-m-d', $ts);
        if ($current !== null && $current['day'] === $d && $ts - $current['last'] <= 300) {
            $current['last'] = $ts;
            continue;
        }
        if ($current !== null) {
            $detail[$current['day']][] = $current;
        }
        $current = ['day' => $d, 'start' => $ts, 'last' => $ts];
    }
    if ($current !== null) {
        $detail[$current['day']][] = $current;
    }

    $daysData = [];
    foreach ($detail as $d => $episodes) {
        $total = 0;
        $out = [];
        foreach ($episodes as $ep) {
            $dur = max(1, (int) ceil(($ep['last'] - $ep['start'] + 60) / 60));
            $total += $dur;
            $out[] = [
                'start' => gmdate('Y-m-d\TH:i:s\Z', $ep['start']),
                'end' => gmdate('Y-m-d\TH:i:s\Z', $ep['last']),
                'duration_min' => $dur,
            ];
        }
        $daysData[$d] = ['episodes' => $out, 'total_min' => $total, 'count' => count($out), 'approx' => false];
    }

    // 2) Days without raw data (older than retention): daily aggregate.
    $aggRows = db_all(
        'SELECT day, total_count, ok_count FROM uptime_daily
          WHERE component_id = ? AND day >= DATE_SUB(CURDATE(), INTERVAL ? DAY)',
        [$componentId, $days]
    );
    foreach ($aggRows as $r) {
        $d = (string) $r['day'];
        if (isset($daysData[$d])) {
            continue;
        }
        $approxMin = max(0, (int) $r['total_count'] - (int) $r['ok_count']);
        if ($approxMin > 0) {
            $daysData[$d] = ['episodes' => [], 'total_min' => $approxMin, 'count' => 0, 'approx' => true];
        }
    }

    json_out([
        'component_id' => $componentId,
        'days' => $days,
        'days_data' => $daysData,
    ]);
}

function route_incidents(): never
{
    $id = (string) ($_GET['id'] ?? '');
    if ($id !== '') {
        $list = incidents_full('id = ?', [$id], 1);
        if ($list === []) {
            json_error('Incident not found', 404);
        }
        json_out($list[0]);
    }

    // Calendar: list of all months that have incidents (for the
    // previous-incidents month navigator).
    if (isset($_GET['months'])) {
        $rows = db_all(
            "SELECT DATE_FORMAT(starts_at, '%Y-%m') AS month, COUNT(*) AS n
               FROM incidents GROUP BY month ORDER BY month ASC"
        );
        json_out([
            'months' => array_map(fn (array $r) => ['month' => $r['month'], 'count' => (int) $r['n']], $rows),
        ]);
    }

    // One month: full incidents + per-day counts for the calendar preview.
    $month = (string) ($_GET['month'] ?? '');
    if ($month !== '') {
        if (!preg_match('/^\d{4}-\d{2}$/', $month)) {
            json_error('Invalid month');
        }
        $start = $month . '-01 00:00:00';
        $end = gmdate('Y-m-d H:i:s', strtotime($start . ' +1 month'));
        $incidents = incidents_full('starts_at >= ? AND starts_at < ?', [$start, $end], 500);
        $dayRows = db_all(
            "SELECT DATE_FORMAT(starts_at, '%Y-%m-%d') AS d, COUNT(*) AS n,
                    SUM(type = 'maintenance') AS maintenance_count
               FROM incidents
              WHERE starts_at >= ? AND starts_at < ?
              GROUP BY d",
            [$start, $end]
        );
        $days = [];
        foreach ($dayRows as $r) {
            $days[$r['d']] = [
                'count' => (int) $r['n'],
                'maintenance' => (int) $r['maintenance_count'] > 0,
            ];
        }
        json_out(['month' => $month, 'incidents' => $incidents, 'days' => $days]);
    }

    $page = max(1, (int) ($_GET['page'] ?? 1));
    $perPage = max(1, min(100, (int) ($_GET['per_page'] ?? 25)));
    $offset = ($page - 1) * $perPage;

    $total = (int) db_row('SELECT COUNT(*) AS n FROM incidents')['n'];
    $incidents = db_all(
        'SELECT * FROM incidents ORDER BY starts_at DESC, created_at DESC LIMIT ? OFFSET ?',
        [$perPage, $offset]
    );
    $ids = array_column($incidents, 'id');
    $full = $ids === [] ? [] : incidents_full(
        'id IN (' . implode(',', array_fill(0, count($ids), '?')) . ')',
        $ids,
        $perPage
    );
    json_out([
        'incidents' => $full,
        'total' => $total,
        'page' => $page,
        'pages' => max(1, (int) ceil($total / $perPage)),
    ]);
}

function route_feed(): never
{
    $settings = settings_get();
    $incidents = incidents_full("type IN ('incident','maintenance')", [], 20);

    $items = '';
    foreach ($incidents as $incident) {
        $pubDate = gmdate('D, d M Y H:i:s', strtotime($incident['updated_at'])) . ' +0000';
        $link = $settings['page_url'] . '/incidents/?id=' . urlencode($incident['id']);
        $title = htmlspecialchars(
            ($incident['type'] === 'maintenance' ? '[Maintenance] ' : '') . $incident['title'],
            ENT_XML1
        );
        $lastUpdate = $incident['updates'] === []
            ? $incident['title']
            : $incident['updates'][count($incident['updates']) - 1]['message'];
        $description = htmlspecialchars($lastUpdate, ENT_XML1);
        $category = $incident['type'] === 'maintenance' ? 'Maintenance' : 'Incident';
        $items .= "<item><title>{$title}</title><link>{$link}</link>"
            . "<guid isPermaLink=\"false\">rumahl-status-{$incident['id']}</guid>"
            . "<pubDate>{$pubDate}</pubDate><category>{$category}</category>"
            . "<description>{$description}</description></item>";
    }

    header('Content-Type: application/rss+xml; charset=utf-8');
    echo '<?xml version="1.0" encoding="UTF-8"?>' . "\n";
    echo '<rss version="2.0"><channel>'
        . '<title>' . htmlspecialchars($settings['page_name']) . ' — Incidents</title>'
        . '<link>' . htmlspecialchars($settings['page_url']) . '</link>'
        . '<description>Incident and maintenance history for the rumahl platform.</description>'
        . '<language>en</language>'
        . $items
        . '</channel></rss>';
    exit;
}

/**
 * Status-colored favicon (the “r” mark):
 *   green  = all systems operational
 *   yellow = degraded performance
 *   orange = partial outage
 *   red    = major outage
 *   blue   = scheduled maintenance active (takes priority)
 */
function route_favicon(): never
{
    $status = build_status_response();
    $maintenanceActive = $status['scheduled_maintenance'] !== [];
    $color = match (true) {
        $maintenanceActive => '3b82f6', // blue
        $status['overall'] === 'major_outage' => 'ef4444',
        $status['overall'] === 'partial_outage' => 'f97316',
        $status['overall'] === 'degraded' => 'eab308',
        default => '22c55e',
    };

    header('Content-Type: image/svg+xml; charset=utf-8');
    header('Cache-Control: no-store, max-age=0');
    echo '<svg xmlns="http://www.w3.org/2000/svg" viewBox="-40 50 230 270">'
        . '<rect x="-40" y="50" width="230" height="270" rx="58" fill="#0d1117"/>'
        . '<path fill="#' . $color . '" d="m 22,284 q -4,0 -4,-4 V 171 c 0,-52 34,-86 85,-86 h 17 q 4,0 4,4 v 36 q 0,4 -4,4 h -13 c -28,0 -46,17 -46,45 v 106 q 0,4 -4,4 z"/>'
        . '</svg>';
    exit;
}
