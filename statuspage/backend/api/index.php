<?php
/**
 * rumahl Status Page — API front controller.
 *
 * Routes (all JSON unless noted):
 *   GET  /api/status             full public status
 *   GET  /api/status.json        statuspage.io-style machine output
 *   GET  /api/uptime             daily uptime for one component
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
    if ($method === 'GET' && $path === '/incidents') {
        route_incidents();
    }
    if ($method === 'GET' && ($path === '/rss' || $path === '/feed')) {
        route_feed();
    }
    if ($method === 'GET' && $path === '/favicon.svg') {
        route_favicon();
    }

    // ── Admin ───────────────────────────────────────────────────
    if (str_starts_with($path, '/admin')) {
        // Login check runs before require_admin(): on some hosting setups
        // (Plesk / PHP-FPM) the Authorization header is stripped, so the
        // token from the JSON body is accepted as a fallback here.
        if ($method === 'POST' && $path === '/admin/auth/verify') {
            $body = json_body();
            $config = statuspage_config();
            $token = bearer_token() ?? $_SERVER['HTTP_X_AUTH_TOKEN'] ?? (string) ($body['token'] ?? '');
            if ($config['admin_token'] === '') {
                json_error('Admin token is not configured', 401);
            }
            if ($token !== '' && hash_equals($config['admin_token'], $token)) {
                json_out(['ok' => true]);
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
            admin_components_save();
        }
        if ($method === 'POST' && $path === '/admin/groups') {
            $body = json_body();
            if (($body['action'] ?? '') === 'delete') {
                admin_groups_delete();
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
        if ($method === 'GET' && $path === '/admin/checks') {
            admin_checks_log();
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
    // Fill gaps (days without any checks) so the chart has a bar for each day.
    $uptime = [];
    $seen = array_fill_keys(array_column($rows, 'day'), true);
    for ($i = $days - 1; $i >= 0; $i--) {
        $day = gmdate('Y-m-d', strtotime("-{$i} days"));
        if (isset($seen[$day])) {
            $row = $rows[array_search($day, array_column($rows, 'day'), true)];
            $total = (int) $row['total_count'];
            $ok = (int) $row['ok_count'];
            $uptime[] = [
                'day' => $day,
                'ok' => $ok,
                'total' => $total,
                'pct' => $total > 0 ? round($ok / $total * 100, 2) : null,
            ];
        } else {
            $uptime[] = ['day' => $day, 'ok' => 0, 'total' => 0, 'pct' => null];
        }
    }
    json_out(['component_id' => $componentId, 'days' => $days, 'uptime' => $uptime]);
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
