<?php
/**
 * Public status computation — components with derived status, uptime
 * percentages, overall status, active incidents and maintenance.
 */

declare(strict_types=1);

require_once __DIR__ . '/helpers.php';

const COMPONENT_STATUSES = ['operational', 'degraded', 'partial_outage', 'major_outage', 'maintenance'];

/**
 * Worst of the given statuses. 'maintenance' is planned and therefore does
 * NOT count as an outage — it is ignored unless every component is in
 * maintenance (then the overall status is 'maintenance').
 */
function worst_status(array $statuses): string
{
    $rank = array_flip(COMPONENT_STATUSES);
    $effective = array_values(array_filter($statuses, fn (string $s) => $s !== 'maintenance'));
    if ($effective === []) {
        return 'maintenance';
    }
    $worst = 'operational';
    foreach ($effective as $status) {
        if (isset($rank[$status]) && $rank[$status] > $rank[$worst]) {
            $worst = $status;
        }
    }
    return $worst;
}

/** Uptime percentages per component over the last N days. */
function uptime_percentages(array $components, int $days): array
{
    $ids = array_column($components, 'id');
    if ($ids === []) {
        return [];
    }
    $placeholders = implode(',', array_fill(0, count($ids), '?'));
    $rows = db_all(
        "SELECT component_id,
                ROUND(SUM(ok_count) / SUM(total_count) * 100, 2) AS pct
           FROM uptime_daily
          WHERE component_id IN ($placeholders)
            AND day >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
          GROUP BY component_id",
        array_merge($ids, [$days])
    );
    $map = [];
    foreach ($rows as $row) {
        $map[$row['component_id']] = (float) $row['pct'];
    }
    return $map;
}

/** All components with current status + last check info. */
function components_with_status(): array
{
    $rows = db_all(
        "SELECT c.*, cs.status AS current_status, cs.changed_at AS status_changed_at,
                (SELECT ok FROM check_results cr
                  WHERE cr.component_id = c.id
                  ORDER BY cr.checked_at DESC, cr.id DESC LIMIT 1) AS last_ok,
                (SELECT COALESCE(server_ms, latency_ms) FROM check_results cr
                  WHERE cr.component_id = c.id
                  ORDER BY cr.checked_at DESC, cr.id DESC LIMIT 1) AS last_latency_ms,
                (SELECT checked_at FROM check_results cr
                  WHERE cr.component_id = c.id
                  ORDER BY cr.checked_at DESC, cr.id DESC LIMIT 1) AS last_checked_at
           FROM components c
           LEFT JOIN component_status cs ON cs.component_id = c.id
          ORDER BY c.position ASC, c.name ASC"
    );

    $uptime30 = uptime_percentages($rows, 30);
    $uptime60 = uptime_percentages($rows, 60);
    $uptime90 = uptime_percentages($rows, 90);

    $out = [];
    foreach ($rows as $row) {
        $status = $row['kind'] === 'manual'
            ? (string) ($row['current_status'] ?? 'operational')
            : (string) ($row['current_status'] ?? 'operational');
        $out[] = [
            'id' => $row['id'],
            'group_id' => $row['group_id'],
            'name' => $row['name'],
            'description' => $row['description'],
            'kind' => $row['kind'],
            'check_type' => (string) ($row['check_type'] ?? 'http'),
            'endpoint_url' => $row['endpoint_url'],
            'method' => $row['method'],
            'expected_status' => (int) $row['expected_status'],
            'timeout_ms' => (int) $row['timeout_ms'],
            'headers' => $row['headers'] !== null ? json_decode((string) $row['headers'], true) : null,
            'view_mode' => (string) ($row['view_mode'] ?? 'compact'),
            'history_days' => (int) ($row['history_days'] ?? 90),
            'latency_threshold_ms' => (int) ($row['latency_threshold_ms'] ?? 0),
            'position' => (int) $row['position'],
            'enabled' => (bool) $row['enabled'],
            'status' => $status,
            'changed_at' => $row['status_changed_at'] !== null ? iso($row['status_changed_at']) : null,
            'uptime_30' => $uptime30[$row['id']] ?? null,
            'uptime_60' => $uptime60[$row['id']] ?? null,
            'uptime_90' => $uptime90[$row['id']] ?? null,
            'last_checked_at' => $row['last_checked_at'] !== null ? iso($row['last_checked_at']) : null,
            'last_latency_ms' => $row['last_latency_ms'] !== null ? (int) $row['last_latency_ms'] : null,
            'last_ok' => $row['last_ok'] !== null ? (bool) $row['last_ok'] : null,
        ];
    }
    return $out;
}

/** Components grouped by group, with an "__ungrouped__" pseudo group last. */
function components_grouped(array $components): array
{
    $groups = db_all('SELECT id, name, position, collapsed, auto_expand FROM component_groups ORDER BY position ASC, name ASC');
    $byId = [];
    foreach ($groups as $group) {
        $byId[$group['id']] = [
            'id' => $group['id'],
            'name' => $group['name'],
            'position' => (int) $group['position'],
            'collapsed' => (bool) $group['collapsed'],
            'auto_expand' => (bool) $group['auto_expand'],
            'components' => [],
        ];
    }
    $ungrouped = [
        'id' => '__ungrouped__',
        'name' => 'Ungrouped',
        'position' => 9999,
        'collapsed' => false,
        'auto_expand' => true,
        'components' => [],
    ];

    foreach ($components as $component) {
        if ($component['group_id'] !== null && isset($byId[$component['group_id']])) {
            $byId[$component['group_id']]['components'][] = $component;
        } else {
            $ungrouped['components'][] = $component;
        }
    }

    $out = array_values($byId);
    if ($ungrouped['components'] !== []) {
        $out[] = $ungrouped;
    }
    return $out;
}

/** Incidents with their updates and affected component ids. */
function incidents_full(string $where, array $params, int $limit = 100): array
{
    $incidents = db_all(
        "SELECT * FROM incidents WHERE $where ORDER BY starts_at DESC, created_at DESC LIMIT $limit",
        $params
    );
    if ($incidents === []) {
        return [];
    }
    $ids = array_column($incidents, 'id');
    $placeholders = implode(',', array_fill(0, count($ids), '?'));

    $updates = db_all(
        "SELECT * FROM incident_updates WHERE incident_id IN ($placeholders) ORDER BY created_at ASC, id ASC",
        $ids
    );
    $updatesByIncident = [];
    foreach ($updates as $update) {
        $updatesByIncident[$update['incident_id']][] = [
            'id' => (int) $update['id'],
            'status' => $update['status'],
            'message' => $update['message'],
            'created_at' => iso($update['created_at']),
        ];
    }

    $links = db_all(
        "SELECT incident_id, component_id FROM incident_components WHERE incident_id IN ($placeholders)",
        $ids
    );
    $componentsByIncident = [];
    foreach ($links as $link) {
        $componentsByIncident[$link['incident_id']][] = $link['component_id'];
    }

    $out = [];
    foreach ($incidents as $incident) {
        $out[] = [
            'id' => $incident['id'],
            'type' => $incident['type'],
            'title' => $incident['title'],
            'status' => $incident['status'],
            'impact' => $incident['impact'],
            'starts_at' => iso($incident['starts_at']),
            'resolves_at' => $incident['resolves_at'] !== null ? iso($incident['resolves_at']) : null,
            'created_at' => iso($incident['created_at']),
            'updated_at' => iso($incident['updated_at']),
            'components' => $componentsByIncident[$incident['id']] ?? [],
            'updates' => $updatesByIncident[$incident['id']] ?? [],
        ];
    }
    return $out;
}

/**
 * Self-monitoring — checks the status page's OWN infrastructure on every
 * user request:
 *   - database reachability
 *   - monitor heartbeat: when did the last check run? If the cron is dead
 *     the component flips to degraded / major_outage and the status is
 *     persisted in settings.self_status (so it survives page reloads and
 *     is visible even while the monitor itself is down).
 */
function self_health(): array
{
    $settings = settings_get();
    if (!(int) ($settings['self_monitoring_enabled'] ?? 1)) {
        return ['enabled' => false, 'components' => []];
    }

    $now = time();

    // 1) Database.
    $dbOk = true;
    try {
        db_row('SELECT 1');
    } catch (Throwable) {
        $dbOk = false;
    }

    // 2) Monitor heartbeat (last check of ANY component).
    $last = db_row('SELECT MAX(checked_at) AS last_checked FROM check_results');
    $lastTs = ($last !== null && $last['last_checked'] !== null)
        ? strtotime((string) $last['last_checked'])
        : null;
    $ageMin = $lastTs !== null ? (int) floor(($now - $lastTs) / 60) : null;
    $monitorStatus = match (true) {
        $ageMin === null => 'major_outage', // never ran
        $ageMin <= 3 => 'operational',
        $ageMin <= 15 => 'degraded',
        default => 'major_outage',
    };
    $monitorDetail = $ageMin !== null
        ? "Last check {$ageMin} min ago (runs every minute)"
        : 'No checks recorded yet — the cron has never run';

    $components = [
        [
            'id' => '__self_web__',
            'name' => 'Status page (web)',
            'description' => 'The page itself answers requests',
            'status' => 'operational',
        ],
        [
            'id' => '__self_db__',
            'name' => 'Database (MySQL)',
            'description' => $dbOk ? 'Database reachable' : 'Database unreachable',
            'status' => $dbOk ? 'operational' : 'major_outage',
        ],
        [
            'id' => '__self_monitor__',
            'name' => 'Monitor (check loop)',
            'description' => $monitorDetail,
            'status' => $monitorStatus,
        ],
    ];

    // Persist the self status (throttled: only when changed or older than 60 s).
    $stored = db_row("SELECT svalue FROM settings WHERE skey = 'self_status'");
    $prev = $stored !== null ? json_decode((string) $stored['svalue'], true) : null;
    $fresh = is_array($prev) && isset($prev['updated_at']) && ($now - strtotime((string) $prev['updated_at'])) < 60;
    $unchanged = is_array($prev)
        && ($prev['monitor'] ?? null) === $monitorStatus
        && ($prev['db'] ?? null) === ($dbOk ? 'operational' : 'major_outage');
    if (!$fresh || !$unchanged) {
        db_exec(
            "INSERT INTO settings (skey, svalue) VALUES ('self_status', ?)
             ON DUPLICATE KEY UPDATE svalue = VALUES(svalue)",
            [json_encode([
                'updated_at' => now_utc(),
                'web' => 'operational',
                'db' => $dbOk ? 'operational' : 'major_outage',
                'monitor' => $monitorStatus,
                'last_check_age_min' => $ageMin,
            ], JSON_UNESCAPED_SLASHES)]
        );
    }

    return ['enabled' => true, 'components' => $components];
}

/** Full public status payload. */
function build_status_response(): array
{
    $settings = settings_get();
    $components = components_with_status();

    // Self-monitoring: the page's own infrastructure is checked on every
    // request and shown as its own group (participates in the overall status).
    $self = self_health();
    if ($self['enabled']) {
        $components = array_merge($components, array_map(function (array $c): array {
            return [
                'id' => $c['id'],
                'group_id' => '__self__',
                'name' => $c['name'],
                'description' => $c['description'],
                'kind' => 'auto',
                'check_type' => 'http',
                'endpoint_url' => '',
                'method' => 'GET',
                'expected_status' => 200,
                'timeout_ms' => 10000,
                'headers' => null,
                'view_mode' => 'compact',
                'history_days' => 0,
                'latency_threshold_ms' => 0,
                'position' => 0,
                'enabled' => true,
                'status' => $c['status'],
                'changed_at' => null,
                'uptime_30' => null,
                'uptime_60' => null,
                'uptime_90' => null,
                'last_checked_at' => null,
                'last_latency_ms' => null,
                'last_ok' => null,
            ];
        }, $self['components']));
    }

    $enabled = array_filter($components, fn (array $c) => $c['enabled']);

    $overall = worst_status(array_map(fn (array $c) => $c['status'], $enabled));

    $active = incidents_full(
        "type = 'incident' AND status NOT IN ('resolved','completed')",
        [],
        50
    );
    $maintenance = incidents_full(
        "type = 'maintenance' AND status IN ('scheduled','in_progress')",
        [],
        20
    );
    $past = incidents_full(
        "type = 'incident' AND status IN ('resolved','completed')",
        [],
        5
    );

    $groups = components_grouped($components);
    if ($self['enabled']) {
        $groups[] = [
            'id' => '__self__',
            'name' => 'rumahl Status infrastructure',
            'position' => 10000,
            'collapsed' => false,
            'auto_expand' => true,
            'components' => array_map(function (array $c): array {
                return [
                    'id' => $c['id'],
                    'group_id' => '__self__',
                    'name' => $c['name'],
                    'description' => $c['description'],
                    'kind' => 'auto',
                    'check_type' => 'http',
                    'endpoint_url' => '',
                    'method' => 'GET',
                    'expected_status' => 200,
                    'timeout_ms' => 10000,
                    'headers' => null,
                    'view_mode' => 'compact',
                    'history_days' => 0,
                    'latency_threshold_ms' => 0,
                    'position' => 0,
                    'enabled' => true,
                    'status' => $c['status'],
                    'changed_at' => null,
                    'uptime_30' => null,
                    'uptime_60' => null,
                    'uptime_90' => null,
                    'last_checked_at' => null,
                    'last_latency_ms' => null,
                    'last_ok' => null,
                ];
            }, $self['components']),
        ];
    }

    return [
        'page' => [
            'name' => $settings['page_name'],
            'url' => $settings['page_url'],
            'timezone' => $settings['timezone'],
            'updated_at' => iso(now_utc()),
        ],
        'overall' => $overall,
        'groups' => $groups,
        'active_incidents' => $active,
        'scheduled_maintenance' => $maintenance,
        'past_incidents' => $past,
    ];
}

/** statuspage.io-style machine-readable output (GET /api/status.json). */
function build_statuspage_json(array $status): array
{
    $indicator = match ($status['overall']) {
        'degraded' => 'minor',
        'partial_outage' => 'major',
        'major_outage' => 'critical',
        default => 'none',
    };
    $description = match ($indicator) {
        'none' => 'All Systems Operational',
        'minor' => 'Minor Service Outage',
        'major' => 'Partial System Outage',
        default => 'Major Service Outage',
    };

    $components = [];
    foreach ($status['groups'] as $group) {
        foreach ($group['components'] as $component) {
            $components[] = [
                'id' => $component['id'],
                'name' => $component['name'],
                'status' => $component['status'],
                'updated_at' => $component['changed_at'] ?? $status['page']['updated_at'],
            ];
        }
    }

    return [
        'page' => [
            'id' => 'rumahl-status',
            'name' => $status['page']['name'],
            'url' => $status['page']['url'],
            'updated_at' => $status['page']['updated_at'],
        ],
        'status' => ['indicator' => $indicator, 'description' => $description],
        'components' => $components,
        'incidents' => array_merge($status['active_incidents'], $status['scheduled_maintenance']),
    ];
}
