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
            'endpoint_url' => (string) ($input['endpoint_url'] ?? $existing['endpoint_url']),
            'method' => strtoupper((string) ($input['method'] ?? $existing['method'])),
            'expected_status' => (int) ($input['expected_status'] ?? $existing['expected_status']),
            'timeout_ms' => max(500, (int) ($input['timeout_ms'] ?? $existing['timeout_ms'])),
            'enabled' => isset($input['enabled']) ? ($input['enabled'] ? 1 : 0) : (int) $existing['enabled'],
            'updated_at' => now_utc(),
        ];
        db_exec(
            'UPDATE components SET name=:name, group_id=:group_id, description=:description,
                    kind=:kind, endpoint_url=:endpoint_url, method=:method,
                    expected_status=:expected_status, timeout_ms=:timeout_ms,
                    enabled=:enabled, updated_at=:updated_at
              WHERE id = :id',
            array_merge($fields, ['id' => $input['id']])
        );

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
        'INSERT INTO components (id, group_id, name, description, kind, endpoint_url,
                                 method, expected_status, timeout_ms, position, enabled, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [
            $id,
            ($input['group_id'] ?? null) ?: null,
            $name,
            (string) ($input['description'] ?? ''),
            $kind,
            (string) ($input['endpoint_url'] ?? ''),
            strtoupper((string) ($input['method'] ?? 'GET')),
            (int) ($input['expected_status'] ?? 200),
            max(500, (int) ($input['timeout_ms'] ?? 10000)),
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

    json_out(['ok' => true, 'id' => $id]);
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

    if (!empty($input['id'])) {
        db_exec(
            'UPDATE component_groups SET name = ?, position = ? WHERE id = ?',
            [$name, (int) ($input['position'] ?? 0), $input['id']]
        );
    } else {
        $id = uuid4();
        db_exec(
            'INSERT INTO component_groups (id, name, position, created_at) VALUES (?, ?, ?, ?)',
            [$id, $name, (int) ($input['position'] ?? 0), now_utc()]
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
        db_exec(
            'UPDATE incidents SET title = ?, status = ?, impact = ?, resolves_at = ?, updated_at = ?
              WHERE id = ?',
            [
                $title,
                $newStatus,
                $impact,
                $resolvesAt ?: null,
                now_utc(),
                $input['id'],
            ]
        );
        if (!empty($input['message'])) {
            add_incident_update($input['id'], $newStatus, (string) $input['message']);
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
        'INSERT INTO incidents (id, type, title, status, impact, starts_at, resolves_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [$id, $type, $title, $status, $impact, $startsAt, $resolvesAt, now_utc(), now_utc()]
    );

    foreach (($input['component_ids'] ?? []) as $componentId) {
        db_exec(
            'INSERT IGNORE INTO incident_components (incident_id, component_id) VALUES (?, ?)',
            [$id, (string) $componentId]
        );
    }
    if (!empty($input['message'])) {
        add_incident_update($id, $status, (string) $input['message']);
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

function admin_checks_log(): never
{
    $componentId = (string) ($_GET['component'] ?? '');
    $limit = max(1, min(200, (int) ($_GET['limit'] ?? 40)));
    if ($componentId !== '') {
        $rows = db_all(
            'SELECT * FROM check_results WHERE component_id = ? ORDER BY checked_at DESC, id DESC LIMIT ?',
            [$componentId, $limit]
        );
    } else {
        $rows = db_all(
            'SELECT * FROM check_results ORDER BY checked_at DESC, id DESC LIMIT ?',
            [$limit]
        );
    }
    json_out(array_map(function (array $row): array {
        return [
            'id' => (int) $row['id'],
            'component_id' => $row['component_id'],
            'ok' => (bool) $row['ok'],
            'latency_ms' => $row['latency_ms'] !== null ? (int) $row['latency_ms'] : null,
            'status_code' => $row['status_code'] !== null ? (int) $row['status_code'] : null,
            'error' => $row['error'],
            'checked_at' => iso($row['checked_at']),
        ];
    }, $rows));
}
