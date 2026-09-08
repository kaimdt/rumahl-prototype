<?php
/**
 * Admin handlers — all routes under /api/admin/* (Bearer token required).
 */

declare(strict_types=1);

require_once __DIR__ . '/helpers.php';
require_once __DIR__ . '/status.php';
require_once __DIR__ . '/checks.php';
require_once __DIR__ . '/incidents.php';

/* ── Components ─────────────────────────────────────────────────── */

function admin_components_get(): never
{
    $components = components_with_status();
    json_out(components_grouped($components));
}

function admin_components_save(): never
{
    $body = json_body();
    $input = $body['component'] ?? [];
    if (!is_array($input)) {
        json_error('Invalid payload');
    }

    $name = trim((string) ($input['name'] ?? ''));
    if ($name === '') {
        json_error('Component name is required');
    }
    $kind = ($input['kind'] ?? 'manual') === 'auto' ? 'auto' : 'manual';
    $checkType = in_array($input['check_type'] ?? '', ['http', 'tcp', 'ping', 'dns', 'ssl', 'smtp'], true)
        ? $input['check_type']
        : 'http';
    $headers = component_headers_json($input['headers'] ?? null);
    $viewMode = in_array($input['view_mode'] ?? '', ['compact', 'bars', 'extended'], true)
        ? $input['view_mode']
        : 'compact';
    $historyDays = in_array((int) ($input['history_days'] ?? 90), [0, 7, 14, 30, 90, 180, 365], true)
        ? (int) $input['history_days']
        : 90;
    $latencyThreshold = max(0, min(60000, (int) ($input['latency_threshold_ms'] ?? 0)));

    if (!empty($input['id'])) {
        // Update existing component
        $existing = db_row('SELECT * FROM components WHERE id = ?', [$input['id']]);
        if ($existing === null) {
            json_error('Component not found', 404);
        }
        $fields = [
            'name' => $name,
            'group_id' => ($input['group_id'] ?? $existing['group_id']) ?: null,
            'description' => (string) ($input['description'] ?? $existing['description']),
            'kind' => $kind,
            'check_type' => $checkType,
            'endpoint_url' => (string) ($input['endpoint_url'] ?? $existing['endpoint_url']),
            'method' => strtoupper((string) ($input['method'] ?? $existing['method'])),
            'expected_status' => (int) ($input['expected_status'] ?? $existing['expected_status']),
            'timeout_ms' => max(500, (int) ($input['timeout_ms'] ?? $existing['timeout_ms'])),
            'headers' => $headers,
            'view_mode' => $viewMode,
            'history_days' => $historyDays,
            'latency_threshold_ms' => $latencyThreshold,
            'enabled' => isset($input['enabled']) ? ($input['enabled'] ? 1 : 0) : (int) $existing['enabled'],
            'updated_at' => now_utc(),
        ];
        db_exec(
            'UPDATE components SET name=:name, group_id=:group_id, description=:description,
                    kind=:kind, check_type=:check_type, endpoint_url=:endpoint_url, method=:method,
                    expected_status=:expected_status, timeout_ms=:timeout_ms,
                    headers=:headers, view_mode=:view_mode, history_days=:history_days,
                    latency_threshold_ms=:latency_threshold_ms,
                    enabled=:enabled, updated_at=:updated_at
              WHERE id = :id',
            array_merge($fields, ['id' => $input['id']])
        );
        admin_sync_component_service((string) $input['id'], $name, $fields['description'], $fields['enabled']);

        // Manual components: persist the admin-chosen status immediately.
        if ($kind === 'manual' && isset($input['manual_status'])) {
            $status = (string) $input['manual_status'];
            if (in_array($status, COMPONENT_STATUSES, true)) {
                apply_status($input['id'], $status, manual: true);
            }
        }
        json_out(['ok' => true]);
    }

    // Create
    $id = uuid4();
    db_exec(
        'INSERT INTO components (id, group_id, name, description, kind, check_type, endpoint_url,
                                 method, expected_status, timeout_ms, headers, view_mode, history_days,
                                 latency_threshold_ms, position, enabled, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [
            $id,
            ($input['group_id'] ?? null) ?: null,
            $name,
            (string) ($input['description'] ?? ''),
            $kind,
            $checkType,
            (string) ($input['endpoint_url'] ?? ''),
            strtoupper((string) ($input['method'] ?? 'GET')),
            (int) ($input['expected_status'] ?? 200),
            max(500, (int) ($input['timeout_ms'] ?? 10000)),
            $headers,
            $viewMode,
            $historyDays,
            $latencyThreshold,
            (int) ($input['position'] ?? 0),
            isset($input['enabled']) ? ($input['enabled'] ? 1 : 0) : 1,
            now_utc(),
            now_utc(),
        ]
    );

    $status = $kind === 'manual'
        ? (in_array($input['manual_status'] ?? '', COMPONENT_STATUSES, true) ? $input['manual_status'] : 'operational')
        : 'operational';
    db_exec(
        'INSERT INTO component_status (component_id, status, changed_at) VALUES (?, ?, ?)',
        [$id, $status, now_utc()]
    );
    admin_sync_component_service($id, $name, (string) ($input['description'] ?? ''), isset($input['enabled']) ? ($input['enabled'] ? 1 : 0) : 1);

    json_out(['ok' => true, 'id' => $id]);
}

function admin_sync_component_service(string $componentId, string $name, string $description, int $enabled): void
{
    $status = db_row('SELECT status FROM component_status WHERE component_id=?', [$componentId])['status'] ?? 'unknown';
    db_exec(
        "INSERT INTO monitoring_services
          (id,legacy_component_id,internal_name,internal_description,public_name,public_description,status,public_status_enabled,created_at,updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?)
         ON DUPLICATE KEY UPDATE legacy_component_id=VALUES(legacy_component_id),internal_name=VALUES(internal_name),
          internal_description=VALUES(internal_description),public_name=VALUES(public_name),public_description=VALUES(public_description),
          status=VALUES(status),public_status_enabled=VALUES(public_status_enabled),updated_at=VALUES(updated_at)",
        [$componentId, $componentId, $name, $description, $name, $description, $status, $enabled, now_utc(), now_utc()]
    );
}

function admin_components_delete(): never
{
    $body = json_body();
    $id = (string) ($body['id'] ?? '');
    if ($id === '') {
        json_error('Component id required');
    }
    db_exec('DELETE FROM components WHERE id = ?', [$id]);
    json_out(['ok' => true]);
}

/** Re-number component positions per group (0..n, gaps removed). */
function normalize_component_positions(): void
{
    db_exec('SET @r := 0');
    db_exec('UPDATE components SET position = (@r := @r + 1) WHERE group_id IS NULL ORDER BY position ASC, name ASC');
    $groups = db_all('SELECT id FROM component_groups ORDER BY position ASC');
    foreach ($groups as $group) {
        db_exec('SET @r := 0');
        db_exec('UPDATE components SET position = (@r := @r + 1) WHERE group_id = ? ORDER BY position ASC, name ASC', [$group['id']]);
    }
}

/** Move a component up/down within its group (position swap + normalize). */
function admin_components_move(): never
{
    $body = json_body();
    $id = (string) ($body['id'] ?? '');
    $direction = ($body['direction'] ?? '') === 'up' ? 'up' : 'down';
    if ($id === '') {
        json_error('Component id required');
    }
    $row = db_row('SELECT id, group_id, position FROM components WHERE id = ?', [$id]);
    if ($row === null) {
        json_error('Component not found', 404);
    }

    $groupCond = $row['group_id'] === null ? 'group_id IS NULL' : 'group_id = ?';
    $params = $row['group_id'] === null ? [] : [$row['group_id']];
    $neighbor = $direction === 'up'
        ? db_row(
            "SELECT id, position FROM components WHERE {$groupCond} AND position < ? ORDER BY position DESC, name DESC LIMIT 1",
            [...$params, (int) $row['position']]
        )
        : db_row(
            "SELECT id, position FROM components WHERE {$groupCond} AND position > ? ORDER BY position ASC, name ASC LIMIT 1",
            [...$params, (int) $row['position']]
        );

    if ($neighbor !== null) {
        db_exec('UPDATE components SET position = ? WHERE id = ?', [(int) $neighbor['position'], $row['id']]);
        db_exec('UPDATE components SET position = ? WHERE id = ?', [(int) $row['position'], $neighbor['id']]);
    }
    normalize_component_positions();
    json_out(['ok' => true]);
}

/* ── Groups ─────────────────────────────────────────────────────── */

function admin_groups_save(): never
{
    $body = json_body();
    $input = $body['group'] ?? [];
    if (!is_array($input)) {
        json_error('Invalid payload');
    }
    $name = trim((string) ($input['name'] ?? ''));
    if ($name === '') {
        json_error('Group name is required');
    }
    $collapsed = isset($input['collapsed']) ? ($input['collapsed'] ? 1 : 0) : 0;
    $autoExpand = isset($input['auto_expand']) ? ($input['auto_expand'] ? 1 : 0) : 1;

    if (!empty($input['id'])) {
        $existing = db_row('SELECT collapsed, auto_expand FROM component_groups WHERE id = ?', [$input['id']]);
        $collapsed = isset($input['collapsed']) ? ($input['collapsed'] ? 1 : 0) : (int) ($existing['collapsed'] ?? 0);
        $autoExpand = isset($input['auto_expand']) ? ($input['auto_expand'] ? 1 : 0) : (int) ($existing['auto_expand'] ?? 1);
        db_exec(
            'UPDATE component_groups SET name = ?, position = ?, collapsed = ?, auto_expand = ? WHERE id = ?',
            [$name, (int) ($input['position'] ?? 0), $collapsed, $autoExpand, $input['id']]
        );
    } else {
        $id = uuid4();
        db_exec(
            'INSERT INTO component_groups (id, name, position, collapsed, auto_expand, created_at)
             VALUES (?, ?, ?, ?, ?, ?)',
            [$id, $name, (int) ($input['position'] ?? 0), $collapsed, $autoExpand, now_utc()]
        );
    }
    json_out(['ok' => true]);
}

function admin_groups_delete(): never
{
    $body = json_body();
    $id = (string) ($body['id'] ?? '');
    if ($id === '') {
        json_error('Group id required');
    }
    // Components become ungrouped (FK ON DELETE SET NULL).
    db_exec('DELETE FROM component_groups WHERE id = ?', [$id]);
    json_out(['ok' => true]);
}

/** Re-number group positions (0..n, gaps removed). */
function normalize_group_positions(): void
{
    db_exec('SET @r := 0');
    db_exec('UPDATE component_groups SET position = (@r := @r + 1) ORDER BY position ASC, name ASC');
}

/** Move a group up/down (position swap + normalize). */
function admin_groups_move(): never
{
    $body = json_body();
    $id = (string) ($body['id'] ?? '');
    $direction = ($body['direction'] ?? '') === 'up' ? 'up' : 'down';
    if ($id === '') {
        json_error('Group id required');
    }
    $row = db_row('SELECT id, position FROM component_groups WHERE id = ?', [$id]);
    if ($row === null) {
        json_error('Group not found', 404);
    }

    $neighbor = $direction === 'up'
        ? db_row('SELECT id, position FROM component_groups WHERE position < ? ORDER BY position DESC, name DESC LIMIT 1', [(int) $row['position']])
        : db_row('SELECT id, position FROM component_groups WHERE position > ? ORDER BY position ASC, name ASC LIMIT 1', [(int) $row['position']]);

    if ($neighbor !== null) {
        db_exec('UPDATE component_groups SET position = ? WHERE id = ?', [(int) $neighbor['position'], $row['id']]);
        db_exec('UPDATE component_groups SET position = ? WHERE id = ?', [(int) $row['position'], $neighbor['id']]);
    }
    normalize_group_positions();
    json_out(['ok' => true]);
}

/* ── Incidents ──────────────────────────────────────────────────── */

function admin_incidents_save(): never
{
    $body = json_body();
    $input = $body['incident'] ?? [];
    if (!is_array($input)) {
        json_error('Invalid payload');
    }
    $title = trim((string) ($input['title'] ?? ''));
    if ($title === '') {
        json_error('Incident title is required');
    }

    $type = ($input['type'] ?? 'incident') === 'maintenance' ? 'maintenance' : 'incident';
    $status = (string) ($input['status'] ?? 'investigating');
    $impact = in_array($input['impact'] ?? '', ['none', 'minor', 'major', 'critical'], true)
        ? $input['impact']
        : 'minor';

    if (!empty($input['id'])) {
        // Update status (+ optional new update message)
        $existing = db_row('SELECT * FROM incidents WHERE id = ?', [$input['id']]);
        if ($existing === null) {
            json_error('Incident not found', 404);
        }
        $newStatus = $existing['status'];
        if (in_array($status, INCIDENT_STATUSES, true)) {
            $newStatus = $status;
        }
        $resolvesAt = $input['resolves_at'] ?? $existing['resolves_at'];
        if (in_array($newStatus, ['resolved', 'completed'], true) && empty($resolvesAt)) {
            $resolvesAt = now_utc();
        }
        db_exec(
            'UPDATE incidents SET title = ?, type=?, status = ?, impact = ?, resolves_at = ?, scheduled_start=?,scheduled_end=?,actual_start=?,actual_end=?,updated_at = ?
              WHERE id = ?',
            [
                $title,
                $type,
                $newStatus,
                $impact,
                $resolvesAt ?: null,
                $input['scheduled_start'] ?? $existing['scheduled_start'] ?? null,
                $input['scheduled_end'] ?? $existing['scheduled_end'] ?? null,
                $input['actual_start'] ?? $existing['actual_start'] ?? ($newStatus === 'in_progress' ? now_utc() : null),
                $input['actual_end'] ?? $existing['actual_end'] ?? (in_array($newStatus, ['resolved','completed'], true) ? now_utc() : null),
                now_utc(),
                $input['id'],
            ]
        );
        $serviceStatuses = $input['affected_components'] ?? $input['service_statuses'] ?? null;
        if (is_array($serviceStatuses)) {
            replace_incident_services((string) $input['id'], $serviceStatuses);
        }
        // The affected components can be changed with EVERY update.
        if (isset($input['component_ids']) && is_array($input['component_ids'])) {
            db_exec('DELETE FROM incident_components WHERE incident_id = ?', [$input['id']]);
            foreach ($input['component_ids'] as $componentId) {
                $componentId = (string) $componentId;
                if ($componentId !== '') {
                    db_exec(
                        'INSERT IGNORE INTO incident_components (incident_id, component_id) VALUES (?, ?)',
                        [$input['id'], $componentId]
                    );
                }
            }
        }
        if (!empty($input['message'])) {
            add_incident_update($input['id'], $newStatus, (string) $input['message'], $input['author'] ?? null, is_array($serviceStatuses) ? $serviceStatuses : []);
        }
        queue_incident_alert($existing, $newStatus, (string) ($input['message'] ?? ''));
        json_out(['ok' => true]);
    }

    // Create
    $id = uuid4();
    $startsAt = !empty($input['starts_at'])
        ? gmdate('Y-m-d H:i:s', strtotime((string) $input['starts_at']))
        : now_utc();
    $resolvesAt = !empty($input['resolves_at'])
        ? gmdate('Y-m-d H:i:s', strtotime((string) $input['resolves_at']))
        : null;

    db_exec(
        'INSERT INTO incidents (id,type,source,title,status,impact,starts_at,resolves_at,scheduled_start,scheduled_end,actual_start,actual_end,monitor_id,created_at,updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        [$id, $type, in_array($input['source'] ?? '', ['manual','monitor','system'], true) ? $input['source'] : 'manual', $title, $status, $impact, $startsAt, $resolvesAt,
         $input['scheduled_start'] ?? ($type === 'maintenance' ? $startsAt : null), $input['scheduled_end'] ?? $resolvesAt,
         $input['actual_start'] ?? ($status === 'in_progress' ? $startsAt : null), $input['actual_end'] ?? null,
         $input['monitor_id'] ?? null, now_utc(), now_utc()]
    );
    db_exec(
        "INSERT IGNORE INTO status_page_incidents (status_page_id, incident_id)
         SELECT id, ? FROM status_pages WHERE slug = 'default'",
        [$id]
    );

    foreach (($input['component_ids'] ?? []) as $componentId) {
        db_exec(
            'INSERT IGNORE INTO incident_components (incident_id, component_id) VALUES (?, ?)',
            [$id, (string) $componentId]
        );
    }
    $serviceStatuses = $input['affected_components'] ?? $input['service_statuses'] ?? [];
    if (is_array($serviceStatuses)) {
        replace_incident_services($id, $serviceStatuses);
    }
    if (!empty($input['message'])) {
        add_incident_update($id, $status, (string) $input['message'], $input['author'] ?? null, is_array($serviceStatuses) ? $serviceStatuses : []);
    }

    $row = db_row('SELECT * FROM incidents WHERE id = ?', [$id]);
    if ($row !== null) {
        queue_incident_alert($row, $status, (string) ($input['message'] ?? ''));
    }
    json_out(['ok' => true, 'id' => $id]);
}

function admin_incidents_delete(): never
{
    $body = json_body();
    $id = (string) ($body['id'] ?? '');
    if ($id === '') {
        json_error('Incident id required');
    }
    db_exec('DELETE FROM incidents WHERE id = ?', [$id]);
    json_out(['ok' => true]);
}

/* ── Settings ───────────────────────────────────────────────────── */

function admin_settings_get(): never
{
    json_out(settings_get());
}

function admin_settings_save(): never
{
    $body = json_body();
    $settings = $body['settings'] ?? [];
    if (!is_array($settings)) {
        json_error('Invalid payload');
    }
    settings_save($settings);
    json_out(['ok' => true]);
}

/* ── Checks ─────────────────────────────────────────────────────── */

function admin_checks_run(): never
{
    $result = run_monitor();
    json_out([
        'ok' => true,
        'checked' => $result['checked'],
        'failed' => $result['failed'],
        'results' => array_map(
            fn (array $r) => ['component_id' => $r['component_id'], 'ok' => $r['ok']],
            $result['results']
        ),
    ]);
}

/**
 * Delete check results (e.g. false positives caused by an outage of the
 * status page itself) and RECALCULATE everything that depends on them:
 * the daily uptime aggregates, the derived component status and — via
 * apply_status → sync_auto_incident — open auto incidents get resolved
 * when the component recovers.
 */
function admin_checks_delete(): never
{
    $body = json_body();
    $ids = $body['ids'] ?? [];
    if (!is_array($ids) || $ids === []) {
        json_error('ids required');
    }
    $ids = array_values(array_filter(array_map('intval', $ids), fn (int $id) => $id > 0));
    if ($ids === []) {
        json_error('ids required');
    }
    $placeholders = implode(',', array_fill(0, count($ids), '?'));

    $rows = db_all(
        "SELECT component_id, ok, checked_at FROM check_results WHERE id IN ({$placeholders})",
        $ids
    );
    if ($rows === []) {
        json_out(['ok' => true, 'deleted' => 0, 'recalculated' => []]);
    }

    db_exec("DELETE FROM check_results WHERE id IN ({$placeholders})", $ids);
    recalculate_after_delete($rows);

    json_out([
        'ok' => true,
        'deleted' => count($rows),
        'recalculated' => array_values(array_unique(array_column($rows, 'component_id'))),
    ]);
}

/** Delete ALL failed results of one component (same recalculation). */
function admin_checks_clear(): never
{
    $body = json_body();
    $componentId = (string) ($body['component_id'] ?? '');
    if ($componentId === '') {
        json_error('component_id required');
    }
    $rows = db_all(
        'SELECT component_id, ok, checked_at FROM check_results WHERE component_id = ? AND ok = 0',
        [$componentId]
    );
    db_exec('DELETE FROM check_results WHERE component_id = ? AND ok = 0', [$componentId]);
    recalculate_after_delete($rows);
    json_out(['ok' => true, 'deleted' => count($rows)]);
}

/**
 * Fix uptime_daily counters and re-derive the component statuses after
 * check results were deleted. $rows = the deleted check_results rows.
 */
function recalculate_after_delete(array $rows): void
{
    // 1) Decrement the daily aggregates per (component, day).
    $agg = [];
    foreach ($rows as $row) {
        $day = gmdate('Y-m-d', strtotime((string) $row['checked_at']));
        $key = $row['component_id'] . '|' . $day;
        $agg[$key] ??= ['component_id' => $row['component_id'], 'day' => $day, 'ok' => 0, 'total' => 0];
        $agg[$key]['ok'] += (int) $row['ok'];
        $agg[$key]['total']++;
    }
    foreach ($agg as $a) {
        db_exec(
            'UPDATE uptime_daily
                SET ok_count = GREATEST(0, ok_count - ?), total_count = GREATEST(0, total_count - ?)
              WHERE component_id = ? AND day = ?',
            [$a['ok'], $a['total'], $a['component_id'], $a['day']]
        );
        db_exec(
            'DELETE FROM uptime_daily WHERE component_id = ? AND day = ? AND total_count <= 0',
            [$a['component_id'], $a['day']]
        );
    }

    // 2) Re-derive the status of every affected auto component (this also
    //    resolves open auto incidents on recovery via apply_status).
    $settings = settings_get();
    $componentIds = array_values(array_unique(array_column($rows, 'component_id')));
    foreach ($componentIds as $componentId) {
        $component = db_row('SELECT * FROM components WHERE id = ?', [$componentId]);
        if ($component === null || $component['kind'] !== 'auto') {
            continue;
        }
        $newStatus = derive_status($componentId, (int) $settings['failure_window'], $component);
        apply_status($componentId, $newStatus);
    }
}

function admin_checks_log(): never
{
    $componentId = (string) ($_GET['component'] ?? '');
    $limit = max(1, min(200, (int) ($_GET['limit'] ?? 40)));
    if ($componentId !== '') {
        $rows = db_all(
            'SELECT cr.*, c.name AS component_name, c.check_type
               FROM check_results cr
               JOIN components c ON c.id = cr.component_id
              WHERE cr.component_id = ?
              ORDER BY cr.checked_at DESC, cr.id DESC LIMIT ?',
            [$componentId, $limit]
        );
    } else {
        $rows = db_all(
            'SELECT cr.*, c.name AS component_name, c.check_type
               FROM check_results cr
               JOIN components c ON c.id = cr.component_id
              ORDER BY cr.checked_at DESC, cr.id DESC LIMIT ?',
            [$limit]
        );
    }
    json_out(array_map(function (array $row): array {
        return [
            'id' => (int) $row['id'],
            'component_id' => $row['component_id'],
            'component_name' => $row['component_name'],
            'check_type' => (string) ($row['check_type'] ?? 'http'),
            'ok' => (bool) $row['ok'],
            'softfail' => (bool) $row['softfail'],
            // effective latency: server time, total as fallback (see checks.php)
            'latency_ms' => $row['server_ms'] !== null ? (int) $row['server_ms'] : ($row['latency_ms'] !== null ? (int) $row['latency_ms'] : null),
            'total_ms' => $row['latency_ms'] !== null ? (int) $row['latency_ms'] : null,
            'dns_ms' => $row['dns_ms'] !== null ? (int) $row['dns_ms'] : null,
            'connect_ms' => $row['connect_ms'] !== null ? (int) $row['connect_ms'] : null,
            'tls_ms' => $row['tls_ms'] !== null ? (int) $row['tls_ms'] : null,
            'server_ms' => $row['server_ms'] !== null ? (int) $row['server_ms'] : null,
            'status_code' => $row['status_code'] !== null ? (int) $row['status_code'] : null,
            'error' => $row['error'],
            'diagnostic' => $row['diagnostic_json'] !== null
                ? json_decode((string) $row['diagnostic_json'], true)
                : null,
            'screenshot_url' => $row['screenshot_url'],
            'checked_at' => iso($row['checked_at']),
        ];
    }, $rows));
}

/** Normalize the headers input to a JSON string of "Name: value" lines. */
function component_headers_json(mixed $input): ?string
{
    $lines = [];
    if (is_string($input)) {
        $decoded = json_decode($input, true);
        $candidate = is_array($decoded) ? $decoded : preg_split('/\r?\n/', $input);
    } elseif (is_array($input)) {
        $candidate = $input;
    } else {
        $candidate = [];
    }
    foreach ((array) $candidate as $line) {
        if (!is_string($line)) {
            continue;
        }
        $line = trim($line);
        if ($line === '' || !str_contains($line, ':') || preg_match('/[\r\n]/', $line)) {
            continue;
        }
        $lines[] = $line;
    }
    return $lines === [] ? null : json_encode($lines, JSON_UNESCAPED_SLASHES);
}
