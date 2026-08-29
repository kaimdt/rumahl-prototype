<?php
/** Internal monitoring platform and explicitly filtered public status-page DTOs. */

declare(strict_types=1);

const MONITORING_STATUSES = ['operational', 'degraded', 'partial_outage', 'major_outage', 'maintenance', 'unknown'];
const ALERT_STATES = ['active', 'acknowledged', 'resolved'];

function monitoring_pagination(): array
{
    return [
        max(1, (int) ($_GET['page'] ?? 1)),
        max(1, min(100, (int) ($_GET['per_page'] ?? 25))),
    ];
}

function monitoring_overview(): never
{
    $row = db_row(
        "SELECT
          (SELECT COUNT(*) FROM monitoring_hosts) hosts,
          (SELECT COUNT(*) FROM monitoring_services) services,
          (SELECT COUNT(*) FROM monitoring_services WHERE status IN ('partial_outage','major_outage')) failing_services,
          (SELECT COUNT(*) FROM monitoring_services WHERE status = 'degraded') degraded_services,
          (SELECT COUNT(*) FROM incidents WHERE type = 'incident' AND status NOT IN ('resolved','completed')) active_incidents,
          (SELECT COUNT(*) FROM incidents WHERE type = 'maintenance' AND status IN ('scheduled','in_progress')) maintenances,
          (SELECT COUNT(*) FROM monitor_checks WHERE enabled = 1 AND status IN ('partial_outage','major_outage')) failed_checks,
          (SELECT COUNT(*) FROM monitoring_agents WHERE revoked_at IS NULL AND (last_seen_at IS NULL OR last_seen_at < DATE_SUB(UTC_TIMESTAMP(), INTERVAL 5 MINUTE))) offline_agents,
          (SELECT COUNT(*) FROM monitoring_alerts WHERE state = 'active') active_alerts"
    ) ?? [];

    $alerts = db_all(
        "SELECT a.id, a.title, a.severity, a.state, a.created_at,
                s.internal_name service_name, h.display_name host_name
           FROM monitoring_alerts a
           LEFT JOIN monitoring_services s ON s.id = a.service_id
           LEFT JOIN monitoring_hosts h ON h.id = a.host_id
          WHERE a.state != 'resolved'
          ORDER BY FIELD(a.severity, 'critical','major','minor','info'), a.created_at DESC LIMIT 8"
    );
    $latency = db_all(
        "SELECT s.id, s.internal_name name, AVG(m.value) avg_latency_ms
           FROM monitoring_metrics m JOIN monitoring_services s ON s.id = m.service_id
          WHERE m.metric_key = 'response_time_ms' AND m.recorded_at >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 1 HOUR)
          GROUP BY s.id, s.internal_name ORDER BY avg_latency_ms DESC LIMIT 5"
    );
    $resourceHosts = db_all(
        "SELECT h.id, h.display_name name, m.metric_key, m.value, m.unit, m.recorded_at
           FROM monitoring_metrics m JOIN monitoring_hosts h ON h.id = m.host_id
          WHERE m.metric_key IN ('cpu_percent','memory_percent','disk_percent')
            AND m.recorded_at >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 15 MINUTE)
            AND m.value >= 80 ORDER BY m.value DESC LIMIT 8"
    );
    $recentFailures = db_all(
        "SELECT s.id, s.internal_name name, c.name check_name, c.last_failure_at, c.status
           FROM monitor_checks c JOIN monitoring_services s ON s.id = c.service_id
          WHERE c.last_failure_at IS NOT NULL ORDER BY c.last_failure_at DESC LIMIT 8"
    );

    json_out([
        'summary' => array_map('intval', $row),
        'alerts' => $alerts,
        'high_latency_services' => $latency,
        'high_resource_hosts' => $resourceHosts,
        'recent_failures' => $recentFailures,
        'generated_at' => iso(now_utc()),
    ]);
}

function monitoring_list(string $entity): never
{
    if (in_array($entity, ['checks', 'services', 'status-pages'], true)) {
        monitoring_ensure_check_services();
    }
    [$page, $perPage] = monitoring_pagination();
    $offset = ($page - 1) * $perPage;
    $search = trim((string) ($_GET['search'] ?? ''));
    $status = trim((string) ($_GET['status'] ?? ''));
    $params = [];
    $where = [];
    $config = match ($entity) {
        'hosts' => ['monitoring_hosts', 'display_name', 'updated_at'],
        'services' => ['monitoring_services', 'internal_name', 'updated_at'],
        'checks' => ['monitor_checks', 'name', 'updated_at'],
        'alerts' => ['monitoring_alerts', 'title', 'updated_at'],
        'agents' => ['monitoring_agents', 'name', 'created_at'],
        'status-pages' => ['status_pages', 'title', 'updated_at'],
        default => null,
    };
    if ($config === null) {
        json_error('Unknown monitoring entity', 404);
    }
    [$table, $nameColumn, $sortColumn] = $config;
    if ($search !== '') {
        $where[] = "{$nameColumn} LIKE ?";
        $params[] = '%' . $search . '%';
    }
    if ($status !== '' && in_array($entity, ['hosts', 'services', 'checks', 'alerts', 'agents'], true)) {
        $column = $entity === 'alerts' ? 'state' : 'status';
        $where[] = "{$column} = ?";
        $params[] = $status;
    }
    $whereSql = $where === [] ? '' : ' WHERE ' . implode(' AND ', $where);
    $total = (int) (db_row("SELECT COUNT(*) total FROM {$table}{$whereSql}", $params)['total'] ?? 0);
    $items = db_all(
        "SELECT * FROM {$table}{$whereSql} ORDER BY {$sortColumn} DESC LIMIT {$perPage} OFFSET {$offset}",
        $params
    );
    foreach ($items as &$item) {
        unset($item['token_hash']);
        if ($entity === 'services') {
            $legacy = !empty($item['legacy_component_id'])
                ? db_row('SELECT endpoint_url,check_type,method,enabled FROM components WHERE id=?', [$item['legacy_component_id']])
                : null;
            $check = db_row('SELECT id,target,interval_seconds,last_checked_at,enabled FROM monitor_checks WHERE service_id=? ORDER BY updated_at DESC LIMIT 1', [$item['id']]);
            $item['monitor_check_id'] = $check['id'] ?? null;
            $item['target'] = $check['target'] ?? ($legacy['endpoint_url'] ?? null);
            $item['interval_seconds'] = isset($check['interval_seconds']) ? (int) $check['interval_seconds'] : null;
            $item['last_checked_at'] = $check['last_checked_at'] ?? null;
            $item['monitor_enabled'] = isset($check['enabled']) ? (bool) $check['enabled'] : null;
            $item['legacy_check_type'] = $legacy['check_type'] ?? null;
        }
        if ($entity === 'status-pages') {
            $resources = db_all(
                "SELECT ps.service_id,ps.group_id,ps.position,ps.enabled,ps.show_uptime,ps.show_performance,ps.history_days,
                        s.public_name,s.internal_name
                   FROM status_page_services ps JOIN monitoring_services s ON s.id=ps.service_id
                  WHERE ps.status_page_id=? ORDER BY ps.position,s.public_name",
                [$item['id']]
            );
            $sections = [];
            foreach (db_all('SELECT id,name,position,collapsed,auto_expand FROM status_page_groups WHERE status_page_id=? ORDER BY position,name', [$item['id']]) as $group) {
                $sections[(string) $group['id']] = [
                    'id' => $group['id'], 'name' => $group['name'], 'position' => (int) $group['position'],
                    'collapsed' => (bool) $group['collapsed'], 'auto_expand' => (bool) $group['auto_expand'], 'resources' => [],
                ];
            }
            $ungrouped = ['id' => null, 'name' => '', 'position' => 9999, 'resources' => []];
            foreach ($resources as $resource) {
                $resource['position'] = (int) $resource['position'];
                $resource['enabled'] = (bool) $resource['enabled'];
                $resource['show_uptime'] = (bool) $resource['show_uptime'];
                $resource['show_performance'] = (bool) $resource['show_performance'];
                $resource['history_days'] = (int) $resource['history_days'];
                $groupId = $resource['group_id'] !== null ? (string) $resource['group_id'] : '';
                unset($resource['group_id']);
                if ($groupId !== '' && isset($sections[$groupId])) {
                    $sections[$groupId]['resources'][] = $resource;
                } else {
                    $ungrouped['resources'][] = $resource;
                }
            }
            if ($ungrouped['resources'] !== []) {
                $sections[''] = $ungrouped;
            }
            $item['sections'] = array_values($sections);
            $item['service_ids'] = array_column($resources, 'service_id');
        }
    }
    json_out(['items' => $items, 'total' => $total, 'page' => $page, 'pages' => max(1, (int) ceil($total / $perPage))]);
}

function monitoring_save_host(): never
{
    $input = json_body()['host'] ?? [];
    $name = trim((string) ($input['name'] ?? ''));
    if ($name === '') {
        json_error('Host name is required');
    }
    $id = (string) ($input['id'] ?? uuid4());
    $status = (string) ($input['status'] ?? 'unknown');
    if (!in_array($status, MONITORING_STATUSES, true)) {
        json_error('Invalid host status');
    }
    $environment = (string) ($input['environment'] ?? 'production');
    if (!in_array($environment, ['production', 'staging', 'development'], true)) {
        json_error('Invalid environment');
    }
    db_exec(
        "INSERT INTO monitoring_hosts
          (id,name,display_name,description,location,environment,tags,operating_system,internal_address,status,notes,created_at,updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
         ON DUPLICATE KEY UPDATE name=VALUES(name),display_name=VALUES(display_name),description=VALUES(description),
          location=VALUES(location),environment=VALUES(environment),tags=VALUES(tags),operating_system=VALUES(operating_system),
          internal_address=VALUES(internal_address),status=VALUES(status),notes=VALUES(notes),updated_at=VALUES(updated_at)",
        [$id, $name, trim((string) ($input['display_name'] ?? $name)), $input['description'] ?? null,
         $input['location'] ?? null, $environment, json_encode(array_values($input['tags'] ?? [])),
         $input['operating_system'] ?? null, $input['internal_address'] ?? null, $status,
         $input['notes'] ?? null, now_utc(), now_utc()]
    );
    json_out(['ok' => true, 'id' => $id]);
}

function monitoring_save_service(): never
{
    $input = json_body()['service'] ?? [];
    $name = trim((string) ($input['internal_name'] ?? ''));
    if ($name === '') {
        json_error('Service name is required');
    }
    $id = (string) ($input['id'] ?? uuid4());
    $status = (string) ($input['status'] ?? 'unknown');
    if (!in_array($status, MONITORING_STATUSES, true)) {
        json_error('Invalid service status');
    }
    $environment = (string) ($input['environment'] ?? 'production');
    if (!in_array($environment, ['production', 'staging', 'development'], true)) {
        json_error('Invalid environment');
    }
    db_exec(
        "INSERT INTO monitoring_services
          (id,internal_name,internal_description,public_name,public_description,environment,tags,status,public_status_enabled,notes,created_at,updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
         ON DUPLICATE KEY UPDATE internal_name=VALUES(internal_name),internal_description=VALUES(internal_description),
          public_name=VALUES(public_name),public_description=VALUES(public_description),environment=VALUES(environment),
          tags=VALUES(tags),status=VALUES(status),public_status_enabled=VALUES(public_status_enabled),notes=VALUES(notes),updated_at=VALUES(updated_at)",
        [$id, $name, $input['internal_description'] ?? null, trim((string) ($input['public_name'] ?? $name)),
         $input['public_description'] ?? null, $environment, json_encode(array_values($input['tags'] ?? [])), $status,
         !empty($input['public_status_enabled']) ? 1 : 0, $input['notes'] ?? null, now_utc(), now_utc()]
    );
    json_out(['ok' => true, 'id' => $id]);
}

function monitoring_save_check(): never
{
    $input = json_body()['check'] ?? [];
    $name = trim((string) ($input['name'] ?? ''));
    $target = trim((string) ($input['target'] ?? ''));
    $type = (string) ($input['check_type'] ?? 'http');
    if ($name === '' || $target === '' || !in_array($type, ['http', 'tcp', 'icmp', 'dns', 'tls', 'smtp', 'custom'], true)) {
        json_error('Check name, type and target are required');
    }
    if ($type !== 'custom' && !monitoring_validate_target($target)) {
        json_error('Monitoring target is not allowed');
    }
    $id = (string) ($input['id'] ?? uuid4());
    $serviceId = trim((string) ($input['service_id'] ?? ''));
    if ($serviceId === '') {
        $existing = db_row('SELECT service_id FROM monitor_checks WHERE id=?', [$id]);
        $serviceId = trim((string) ($existing['service_id'] ?? ''));
    }
    if ($serviceId === '') {
        $serviceId = uuid4();
        db_exec(
            "INSERT INTO monitoring_services (id,internal_name,internal_description,public_name,public_description,environment,tags,status,public_status_enabled,notes,created_at,updated_at)
             VALUES (?,?,?,?,?,'production','[]','unknown',1,NULL,?,?)",
            [$serviceId, $name, 'Created from monitor', $name, $target, now_utc(), now_utc()]
        );
    } else {
        db_exec('UPDATE monitoring_services SET internal_name=?,public_name=?,public_description=?,public_status_enabled=1,updated_at=? WHERE id=?', [$name, $name, $target, now_utc(), $serviceId]);
    }
    db_exec(
        "INSERT INTO monitor_checks
          (id,service_id,host_id,name,check_type,target,config,interval_seconds,timeout_ms,retry_count,
           failure_threshold,recovery_threshold,status,monitoring_location,auto_incident_enabled,enabled,created_at,updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
         ON DUPLICATE KEY UPDATE service_id=VALUES(service_id),host_id=VALUES(host_id),name=VALUES(name),
          check_type=VALUES(check_type),target=VALUES(target),config=VALUES(config),interval_seconds=VALUES(interval_seconds),
          timeout_ms=VALUES(timeout_ms),retry_count=VALUES(retry_count),failure_threshold=VALUES(failure_threshold),
          recovery_threshold=VALUES(recovery_threshold),monitoring_location=VALUES(monitoring_location),
          auto_incident_enabled=VALUES(auto_incident_enabled),enabled=VALUES(enabled),updated_at=VALUES(updated_at)",
        [$id, $serviceId, $input['host_id'] ?? null, $name, $type, $target,
         json_encode($input['config'] ?? new stdClass()), max(30, (int) ($input['interval_seconds'] ?? 60)),
         max(100, min(60000, (int) ($input['timeout_ms'] ?? 10000))), max(0, min(10, (int) ($input['retry_count'] ?? 1))),
         max(1, min(20, (int) ($input['failure_threshold'] ?? 3))), max(1, min(20, (int) ($input['recovery_threshold'] ?? 2))),
         'unknown', $input['monitoring_location'] ?? null, !empty($input['auto_incident_enabled']) ? 1 : 0,
         !isset($input['enabled']) || !empty($input['enabled']) ? 1 : 0, now_utc(), now_utc()]
    );
    json_out(['ok' => true, 'id' => $id]);
}

/** Give legacy monitoring-center checks a public service identity for status pages. */
function monitoring_ensure_check_services(): void
{
    foreach (db_all('SELECT id,name,target,status,created_at FROM monitor_checks WHERE service_id IS NULL') as $check) {
        $serviceId = uuid4();
        db_exec(
            "INSERT INTO monitoring_services (id,internal_name,internal_description,public_name,public_description,environment,tags,status,public_status_enabled,notes,created_at,updated_at)
             VALUES (?,?,?,?,?,'production','[]',?,1,NULL,?,?)",
            [$serviceId, $check['name'], 'Created from monitor', $check['name'], $check['target'], $check['status'], $check['created_at'], now_utc()]
        );
        db_exec('UPDATE monitor_checks SET service_id=?,updated_at=? WHERE id=? AND service_id IS NULL', [$serviceId, now_utc(), $check['id']]);
    }
}

function monitoring_run_check_now(string $id): never
{
    if (db_row('SELECT id FROM monitor_checks WHERE id=?', [$id]) === null) {
        json_error('Monitor not found', 404);
    }
    $results = run_platform_checks($id);
    if ($results === []) {
        json_error('Monitor is disabled and cannot be checked', 409);
    }
    json_out(['ok' => true, 'result' => $results[0]]);
}

function monitoring_check_detail(string $id): never
{
    $check = db_row(
        "SELECT c.*,s.public_name service_name,h.display_name host_name
           FROM monitor_checks c
           LEFT JOIN monitoring_services s ON s.id=c.service_id
           LEFT JOIN monitoring_hosts h ON h.id=c.host_id
          WHERE c.id=?",
        [$id]
    );
    if ($check === null) {
        json_error('Monitor not found', 404);
    }
    $check['config'] = json_decode((string) ($check['config'] ?? '{}'), true) ?: [];
    $period = (string) ($_GET['period'] ?? 'day');
    $hours = match ($period) { 'hour' => 1, 'week' => 168, 'month' => 744, default => 24 };
    $metrics = db_all(
        "SELECT metric_key,value,unit,recorded_at FROM monitoring_metrics
          WHERE check_id=? AND metric_key IN ('response_time_ms','latency_ms')
            AND recorded_at >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL {$hours} HOUR)
          ORDER BY recorded_at ASC",
        [$id]
    );
    $history = db_all(
        "SELECT id,ok,softfail,status,latency_ms,dns_ms,connect_ms,tls_ms,server_ms,status_code,error_text,diagnostic_json,checked_at
           FROM monitoring_check_results
          WHERE check_id=? AND checked_at >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL {$hours} HOUR)
          ORDER BY checked_at DESC,id DESC LIMIT 250",
        [$id]
    );
    foreach ($history as &$historyItem) {
        $historyItem['ok'] = (bool) $historyItem['ok'];
        $historyItem['softfail'] = (bool) $historyItem['softfail'];
        $historyItem['diagnostic'] = json_decode((string) ($historyItem['diagnostic_json'] ?? 'null'), true);
        unset($historyItem['diagnostic_json']);
    }
    unset($historyItem);
    $alertSummary = db_row(
        "SELECT COUNT(*) total,
                SUM(CASE WHEN state='resolved' THEN 0 ELSE 1 END) incidents
           FROM monitoring_alerts WHERE check_id=?",
        [$id]
    );
    $values = array_values(array_map(static fn(array $metric): float => (float) $metric['value'], $metrics));
    sort($values, SORT_NUMERIC);
    $sampleCount = count($values);
    $p95Index = $sampleCount > 0 ? max(0, (int) ceil($sampleCount * 0.95) - 1) : 0;
    $summary = [
        'total' => (int) ($alertSummary['total'] ?? 0),
        'incidents' => (int) ($alertSummary['incidents'] ?? 0),
        'samples' => $sampleCount,
        'minimum_ms' => $sampleCount > 0 ? $values[0] : null,
        'maximum_ms' => $sampleCount > 0 ? $values[$sampleCount - 1] : null,
        'average_ms' => $sampleCount > 0 ? array_sum($values) / $sampleCount : null,
        'p95_ms' => $sampleCount > 0 ? $values[$p95Index] : null,
        'latest_ms' => $sampleCount > 0 ? (float) $metrics[$sampleCount - 1]['value'] : null,
    ];
    $problem = null;
    if ($history !== [] && empty($history[0]['ok'])) {
        $latestError = trim((string) ($history[0]['error_text'] ?? ''));
        $streak = [];
        foreach ($history as $result) {
            if (!empty($result['ok'])) break;
            $streak[] = $result;
        }
        $sameError = array_values(array_filter($history, static fn(array $result): bool => empty($result['ok']) && trim((string) ($result['error_text'] ?? '')) === $latestError));
        $oldest = $streak[count($streak) - 1];
        $problem = [
            'error' => $latestError !== '' ? $latestError : 'The check did not return a successful result',
            'started_at' => $oldest['checked_at'],
            'last_seen_at' => $history[0]['checked_at'],
            'consecutive_failures' => count($streak),
            'same_error_count' => count($sameError),
            'previous_same_error_at' => count($sameError) > 1 ? $sameError[1]['checked_at'] : null,
            'latest' => $history[0],
        ];
        $fullStreak = db_row(
            "SELECT MIN(checked_at) started_at,COUNT(*) failures
               FROM monitoring_check_results
              WHERE check_id=? AND ok=0 AND checked_at > COALESCE((SELECT MAX(ok_result.checked_at) FROM monitoring_check_results ok_result WHERE ok_result.check_id=? AND ok_result.ok=1),'1970-01-01')",
            [$id, $id]
        );
        $previousSame = db_row(
            'SELECT checked_at FROM monitoring_check_results WHERE check_id=? AND ok=0 AND error_text <=> ? AND id<>? ORDER BY checked_at DESC,id DESC LIMIT 1',
            [$id, $history[0]['error_text'], $history[0]['id']]
        );
        $problem['started_at'] = $fullStreak['started_at'] ?? $problem['started_at'];
        $problem['consecutive_failures'] = (int) ($fullStreak['failures'] ?? $problem['consecutive_failures']);
        $problem['previous_same_error_at'] = $previousSame['checked_at'] ?? null;
    }
    json_out(['check' => $check, 'metrics' => $metrics, 'history' => $history, 'problem' => $problem, 'period' => $period, 'summary' => $summary]);
}

function monitoring_test_alert(string $id): never
{
    $check = db_row('SELECT id,name,service_id,host_id FROM monitor_checks WHERE id=?', [$id]);
    if ($check === null) {
        json_error('Monitor not found', 404);
    }
    $alertId = uuid4();
    db_exec(
        "INSERT INTO monitoring_alerts (id,host_id,service_id,check_id,alert_type,title,description,severity,state,created_at,updated_at)
         VALUES (?,?,?,?,? ,?,?,?,'active',?,?)",
        [$alertId, $check['host_id'], $check['service_id'], $id, 'test',
         'Test alert: ' . $check['name'], 'Manually triggered monitor test alert.', 'info', now_utc(), now_utc()]
    );
    json_out(['ok' => true, 'alert_id' => $alertId]);
}

function monitoring_save_status_page(): never
{
    $input = json_body()['status_page'] ?? [];
    $title = trim((string) ($input['title'] ?? ''));
    $slug = strtolower(trim((string) ($input['slug'] ?? '')));
    if ($title === '' || !preg_match('/^[a-z0-9]+(?:-[a-z0-9]+)*$/', $slug)) {
        json_error('Title and a valid slug are required');
    }
    $id = (string) ($input['id'] ?? uuid4());
    $canonical = isset($input['canonical_domain']) ? monitoring_normalize_hostname((string) $input['canonical_domain']) : null;
    if (($input['canonical_domain'] ?? '') !== '' && $canonical === null) {
        json_error('Invalid canonical domain');
    }
    $customCssUrl = trim((string) ($input['custom_css_url'] ?? ''));
    if ($customCssUrl !== '' && (!filter_var($customCssUrl, FILTER_VALIDATE_URL) || !str_starts_with($customCssUrl, 'https://'))) {
        json_error('Custom CSS URL must use HTTPS');
    }
    $logoMode = (string) ($input['logo_mode'] ?? 'same');
    if (!in_array($logoMode, ['same', 'adaptive', 'custom'], true)) {
        json_error('Invalid logo mode');
    }
    $headerBrandMode = (string) ($input['header_brand_mode'] ?? 'logo');
    if (!in_array($headerBrandMode, ['logo', 'text'], true)) {
        json_error('Invalid header brand mode');
    }
    $customCss = (string) ($input['custom_css'] ?? '');
    if (strlen($customCss) > 100000) {
        json_error('Custom CSS is too large');
    }
    db_exec(
        "INSERT INTO status_pages (id,slug,title,description,logo_url,logo_dark_url,mobile_logo_url,mobile_logo_dark_url,logo_mode,header_brand_mode,header_config,nav_links,footer_config,footer_links,favicon_url,custom_css_url,custom_css,theme,contact_links,canonical_domain,path_enabled,domain_enabled,show_disabled_components,default_language,enabled_locales,translations,problem_reports_enabled,problem_report_threshold,problem_report_window_minutes,layout_config,enabled,created_at,updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
         ON DUPLICATE KEY UPDATE slug=VALUES(slug),title=VALUES(title),description=VALUES(description),logo_url=VALUES(logo_url),
          logo_dark_url=VALUES(logo_dark_url),mobile_logo_url=VALUES(mobile_logo_url),mobile_logo_dark_url=VALUES(mobile_logo_dark_url),
          logo_mode=VALUES(logo_mode),header_brand_mode=VALUES(header_brand_mode),header_config=VALUES(header_config),nav_links=VALUES(nav_links),
          footer_config=VALUES(footer_config),footer_links=VALUES(footer_links),favicon_url=VALUES(favicon_url),
          custom_css_url=VALUES(custom_css_url),custom_css=VALUES(custom_css),theme=VALUES(theme),contact_links=VALUES(contact_links),canonical_domain=VALUES(canonical_domain),
          path_enabled=VALUES(path_enabled),domain_enabled=VALUES(domain_enabled),show_disabled_components=VALUES(show_disabled_components),default_language=VALUES(default_language),enabled_locales=VALUES(enabled_locales),translations=VALUES(translations),problem_reports_enabled=VALUES(problem_reports_enabled),problem_report_threshold=VALUES(problem_report_threshold),problem_report_window_minutes=VALUES(problem_report_window_minutes),layout_config=VALUES(layout_config),enabled=VALUES(enabled),updated_at=VALUES(updated_at)",
        [$id, $slug, $title, $input['description'] ?? null, $input['logo_url'] ?? null,
         $input['logo_dark_url'] ?? null, $input['mobile_logo_url'] ?? null, $input['mobile_logo_dark_url'] ?? null,
         $logoMode, $headerBrandMode, json_encode($input['header_config'] ?? new stdClass()),
         json_encode(array_values(is_array($input['nav_links'] ?? null) ? $input['nav_links'] : [])),
         json_encode($input['footer_config'] ?? new stdClass()),
         json_encode(array_values(is_array($input['footer_links'] ?? null) ? $input['footer_links'] : [])),
         $input['favicon_url'] ?? null,
         $customCssUrl !== '' ? $customCssUrl : null, $customCss !== '' ? $customCss : null,
         json_encode($input['theme'] ?? new stdClass()),
         json_encode($input['contact_links'] ?? []), $canonical,
         !isset($input['path_enabled']) || !empty($input['path_enabled']) ? 1 : 0,
         !isset($input['domain_enabled']) || !empty($input['domain_enabled']) ? 1 : 0,
         !isset($input['show_disabled_components']) || !empty($input['show_disabled_components']) ? 1 : 0,
         preg_match('/^[a-z]{2}(?:-[A-Z]{2})?$/', (string) ($input['default_language'] ?? 'en')) ? $input['default_language'] : 'en',
         json_encode(array_values(array_filter($input['enabled_locales'] ?? ['en'], static fn($locale): bool => is_string($locale) && preg_match('/^[a-z]{2}(?:-[A-Z]{2})?$/', $locale) === 1))),
         json_encode(is_array($input['translations'] ?? null) ? $input['translations'] : new stdClass()),
         !isset($input['problem_reports_enabled']) || !empty($input['problem_reports_enabled']) ? 1 : 0,
         max(2, min(100, (int) ($input['problem_report_threshold'] ?? 3))),
         max(5, min(1440, (int) ($input['problem_report_window_minutes'] ?? 60))),
         json_encode(is_array($input['layout_config'] ?? null) ? $input['layout_config'] : new stdClass()),
         !isset($input['enabled']) || !empty($input['enabled']) ? 1 : 0, now_utc(), now_utc()]
    );
    if (array_key_exists('sections', $input) && is_array($input['sections'])) {
        $servicePosition = 0;
        foreach (array_values($input['sections']) as $sectionPosition => $section) {
            if (!is_array($section)) {
                continue;
            }
            $groupName = trim((string) ($section['name'] ?? ''));
            $groupId = null;
            if ($groupName !== '') {
                $candidateGroupId = trim((string) ($section['id'] ?? ''));
                $existingGroup = $candidateGroupId !== ''
                    ? db_row('SELECT id FROM status_page_groups WHERE id=? AND status_page_id=?', [$candidateGroupId, $id])
                    : null;
                $groupId = $existingGroup !== null ? $candidateGroupId : uuid4();
                db_exec(
                    'INSERT INTO status_page_groups (id,status_page_id,name,position,collapsed,auto_expand,created_at) VALUES (?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE name=VALUES(name),position=VALUES(position),collapsed=VALUES(collapsed),auto_expand=VALUES(auto_expand)',
                    [$groupId, $id, mb_substr($groupName, 0, 150), $sectionPosition,
                     !empty($section['collapsed']) ? 1 : 0, !isset($section['auto_expand']) || !empty($section['auto_expand']) ? 1 : 0, now_utc()]
                );
            }
            foreach (array_values(is_array($section['resources'] ?? null) ? $section['resources'] : []) as $resource) {
                if (!is_array($resource)) {
                    continue;
                }
                $serviceId = trim((string) ($resource['service_id'] ?? ''));
                if ($serviceId === '' || db_row('SELECT id FROM monitoring_services WHERE id=?', [$serviceId]) === null) {
                    continue;
                }
                $mode = (string) ($resource['view_mode'] ?? 'current');
                if (!in_array($mode, ['current', 'history', 'performance'], true)) {
                    $mode = 'current';
                }
                $historyDays = (int) ($resource['history_days'] ?? 90);
                if (!in_array($historyDays, [7, 14, 30, 60, 90, 180, 365], true)) {
                    $historyDays = 90;
                }
                db_exec(
                    'INSERT INTO status_page_services (status_page_id,service_id,group_id,position,enabled,show_uptime,show_performance,history_days) VALUES (?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE group_id=VALUES(group_id),position=VALUES(position),enabled=VALUES(enabled),show_uptime=VALUES(show_uptime),show_performance=VALUES(show_performance),history_days=VALUES(history_days)',
                    [$id, $serviceId, $groupId, $servicePosition++, !isset($resource['enabled']) || !empty($resource['enabled']) ? 1 : 0,
                     $mode !== 'current' ? 1 : 0, $mode === 'performance' ? 1 : 0, $historyDays]
                );
            }
        }
        foreach (array_values(is_array($input['removed_service_ids'] ?? null) ? $input['removed_service_ids'] : []) as $removedServiceId) {
            $removedServiceId = trim((string) $removedServiceId);
            if ($removedServiceId !== '') {
                db_exec('DELETE FROM status_page_services WHERE status_page_id=? AND service_id=?', [$id, $removedServiceId]);
            }
        }
    } elseif (array_key_exists('service_ids', $input) && is_array($input['service_ids'])) {
        $serviceIds = array_values(array_unique(array_filter(array_map('strval', $input['service_ids']))));
        foreach ($serviceIds as $position => $serviceId) {
            if (db_row('SELECT id FROM monitoring_services WHERE id=?', [$serviceId]) !== null) {
                db_exec(
                    'INSERT INTO status_page_services (status_page_id,service_id,position,show_uptime,show_performance) VALUES (?,?,?,0,0) ON DUPLICATE KEY UPDATE position=VALUES(position)',
                    [$id, $serviceId, $position]
                );
            }
        }
    }
    $verification = null;
    if ($canonical !== null) {
        $domain = db_row('SELECT id,status,verification_token FROM status_page_domains WHERE hostname=?', [$canonical]);
        if ($domain === null) {
            $domainId = uuid4();
            $token = bin2hex(random_bytes(32));
            db_exec(
                "INSERT INTO status_page_domains (id,status_page_id,hostname,verification_token,status,created_at)
                 VALUES (?,?,?,?, 'pending', ?)",
                [$domainId, $id, $canonical, $token, now_utc()]
            );
            $verification = ['type' => 'TXT', 'name' => '_rumahl-status.' . $canonical, 'value' => $token];
        } elseif ($domain['status'] !== 'verified') {
            db_exec('UPDATE status_page_domains SET status_page_id=? WHERE id=?', [$id, $domain['id']]);
            $verification = ['type' => 'TXT', 'name' => '_rumahl-status.' . $canonical, 'value' => $domain['verification_token']];
        }
    }
    json_out(['ok' => true, 'id' => $id, 'verification' => $verification]);
}

function monitoring_save_domain(): never
{
    $input = json_body()['domain'] ?? [];
    $pageId = trim((string) ($input['status_page_id'] ?? ''));
    $hostname = monitoring_normalize_hostname((string) ($input['hostname'] ?? ''));
    if ($pageId === '' || $hostname === null) {
        json_error('Status page and valid hostname are required');
    }
    $id = (string) ($input['id'] ?? uuid4());
    $verificationToken = bin2hex(random_bytes(32));
    db_exec(
        "INSERT INTO status_page_domains (id,status_page_id,hostname,verification_token,status,created_at)
         VALUES (?,?,?,?, 'pending', ?)
         ON DUPLICATE KEY UPDATE status_page_id=VALUES(status_page_id),status='pending',verified_at=NULL",
        [$id, $pageId, $hostname, $verificationToken, now_utc()]
    );
    json_out(['ok' => true, 'id' => $id, 'hostname' => $hostname, 'verification' => ['type' => 'TXT', 'name' => '_rumahl-status.' . $hostname, 'value' => $verificationToken]]);
}

function monitoring_normalize_hostname(string $value): ?string
{
    $host = strtolower(trim($value));
    $host = preg_replace('#^https?://#', '', $host);
    $host = rtrim((string) preg_replace('/[:\/].*$/', '', (string) $host), '.');
    if (!preg_match('/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/', $host)) {
        return null;
    }
    return $host;
}

function monitoring_update_alert(): never
{
    $body = json_body();
    $id = trim((string) ($body['id'] ?? ''));
    $state = (string) ($body['state'] ?? '');
    if ($id === '' || !in_array($state, ALERT_STATES, true)) {
        json_error('Alert id and valid state are required');
    }
    $changed = db_exec(
        "UPDATE monitoring_alerts SET state=?, acknowledged_at=IF(?='acknowledged',UTC_TIMESTAMP(),acknowledged_at),
         resolved_at=IF(?='resolved',UTC_TIMESTAMP(),resolved_at), updated_at=UTC_TIMESTAMP() WHERE id=?",
        [$state, $state, $state, $id]
    );
    json_out(['ok' => $changed > 0]);
}

function monitoring_agent_heartbeat(): never
{
    $token = bearer_token();
    if ($token === null || strlen($token) < 24) {
        json_error('Unauthorized', 401);
    }
    $agent = db_row(
        'SELECT id,host_id,revoked_at FROM monitoring_agents WHERE token_hash=?',
        [hash('sha256', $token)]
    );
    if ($agent === null || $agent['revoked_at'] !== null) {
        json_error('Unauthorized', 401);
    }
    $body = json_body();
    $version = substr(trim((string) ($body['version'] ?? '')), 0, 50);
    db_exec(
        "UPDATE monitoring_agents SET version=?,status='online',last_seen_at=UTC_TIMESTAMP() WHERE id=?",
        [$version !== '' ? $version : null, $agent['id']]
    );
    $allowedMetrics = [
        'cpu_percent' => 'percent', 'load_1' => 'load', 'load_5' => 'load', 'load_15' => 'load',
        'memory_percent' => 'percent', 'swap_percent' => 'percent', 'disk_percent' => 'percent',
        'disk_io_bytes' => 'bytes', 'network_rx_bytes' => 'bytes', 'network_tx_bytes' => 'bytes',
        'network_errors' => 'count', 'uptime_seconds' => 'seconds', 'temperature_celsius' => 'celsius',
        'process_count' => 'count',
    ];
    foreach (($body['metrics'] ?? []) as $key => $value) {
        if (!isset($allowedMetrics[$key]) || !is_numeric($value) || $agent['host_id'] === null) {
            continue;
        }
        db_exec(
            "INSERT INTO monitoring_metrics (host_id,metric_key,value,unit,granularity,recorded_at)
             VALUES (?,?,?,?, 'raw', UTC_TIMESTAMP())",
            [$agent['host_id'], $key, (float) $value, $allowedMetrics[$key]]
        );
    }
    json_out(['ok' => true, 'server_time' => iso(now_utc())]);
}

function monitoring_resolve_public_page(?string $slug = null): ?array
{
    $host = strtolower(preg_replace('/:\d+$/', '', (string) ($_SERVER['HTTP_HOST'] ?? '')));
    if ($slug !== null && $slug !== '') {
        $page = db_row('SELECT * FROM status_pages WHERE slug = ? AND enabled = 1 AND path_enabled = 1', [$slug]);
    } elseif ($host !== '') {
        monitoring_verify_domain_for_host($host);
        $page = db_row(
            "SELECT p.* FROM status_pages p JOIN status_page_domains d ON d.status_page_id=p.id
              WHERE d.hostname=? AND d.status='verified' AND p.enabled=1 AND p.domain_enabled=1",
            [$host]
        );
    } else {
        $page = null;
    }
    $knownDomain = $host !== ''
        ? db_row('SELECT id FROM status_page_domains WHERE hostname=?', [$host]) !== null
        : false;
    if ($page === null && ($slug === null || $slug === '') && !$knownDomain) {
        $page = db_row("SELECT * FROM status_pages WHERE slug='default' AND enabled=1");
    }
    return $page;
}

function monitoring_public_page(?string $slug = null): never
{
    $page = monitoring_resolve_public_page($slug);
    if ($page === null) json_error('Status page not found', 404);
    try {
        $services = db_all(
            "SELECT s.id,s.public_name name,s.public_description description,s.status,s.legacy_component_id,
                    ps.enabled,ps.show_uptime,ps.show_performance,ps.history_days,ps.position,g.id group_id,
                    g.name group_name,g.position group_position,g.collapsed group_collapsed,g.auto_expand group_auto_expand,
                    s.legacy_component_id component_id
               FROM status_page_services ps
               JOIN monitoring_services s ON s.id=ps.service_id
               LEFT JOIN status_page_groups g ON g.id=ps.group_id AND g.status_page_id=ps.status_page_id
              WHERE ps.status_page_id=? AND ps.enabled=1
              ORDER BY COALESCE(g.position,9999),ps.position,s.public_name",
            [$page['id']]
        );
    } catch (Throwable $e) {
        error_log('[rumahl-status] Public status services failed for page ' . $page['id'] . ': ' . $e->getMessage());
        // Keep the independent status page online even if optional component
        // presentation metadata is temporarily inconsistent.
        $services = [];
    }
    $groups = [];
    $overallStatuses = [];
    $reportRegion = mb_substr(trim((string) ($_GET['region'] ?? 'unknown')), 0, 80);
    $reportWindow = max(5, min(1440, (int) ($page['problem_report_window_minutes'] ?? 60)));
    $reportThreshold = max(2, min(100, (int) ($page['problem_report_threshold'] ?? 3)));
    $incidentServiceMap = active_incident_service_map(array_values(array_column($services, 'id')));
    foreach ($services as $service) {
        try {
            if (!empty($service['legacy_component_id'])) {
                $legacyMonitoring = db_row('SELECT enabled FROM components WHERE id=?', [$service['legacy_component_id']]);
                $service['monitoring_enabled'] = (bool) ((int) ($legacyMonitoring['enabled'] ?? 0));
            } else {
                $monitoring = db_row('SELECT MAX(enabled) enabled FROM monitor_checks WHERE service_id=?', [$service['id']]);
                $service['monitoring_enabled'] = $monitoring === null || $monitoring['enabled'] === null
                    ? true
                    : (bool) ((int) $monitoring['enabled']);
            }
        } catch (Throwable $e) {
            error_log('[rumahl-status] Public monitor state failed for service ' . $service['id'] . ': ' . $e->getMessage());
            $service['monitoring_enabled'] = true;
        }
        $service['show_uptime'] = (bool) ((int) $service['show_uptime']);
        $service['show_performance'] = (bool) ((int) $service['show_performance']);
        $service['monitoring_enabled'] = (bool) ((int) $service['monitoring_enabled']);
        if (empty($page['show_disabled_components']) && !$service['monitoring_enabled']) {
            continue;
        }
        $service['monitor_status'] = (string) $service['status'];
        $service['active_incidents'] = $incidentServiceMap[$service['id']] ?? [];
        $service['community_report'] = null;
        if (!empty($page['problem_reports_enabled']) && $reportRegion !== '' && $reportRegion !== 'unknown') {
            $cluster = db_row(
                'SELECT COUNT(DISTINCT visitor_hash) reports,MAX(created_at) last_report_at
                   FROM status_page_problem_reports
                  WHERE status_page_id=? AND service_id=? AND region=?
                    AND created_at>=DATE_SUB(UTC_TIMESTAMP(),INTERVAL ? MINUTE)',
                [$page['id'], $service['id'], $reportRegion, $reportWindow]
            );
            if ((int) ($cluster['reports'] ?? 0) >= $reportThreshold) {
                $service['community_report'] = [
                    'region' => $reportRegion, 'reports' => (int) $cluster['reports'],
                    'window_minutes' => $reportWindow, 'last_report_at' => iso($cluster['last_report_at']),
                ];
            }
        }
        $service['status'] = resolve_component_display_status(
            $service['monitor_status'],
            array_column($service['active_incidents'], 'display_status')
        );
        $overallStatuses[] = (string) $service['status'];
        $service['history_days'] = (int) $service['history_days'];
        $service['position'] = (int) $service['position'];
        $groupId = $service['group_id'] ?? 'ungrouped';
        if (!isset($groups[$groupId])) {
            $groups[$groupId] = [
                'id' => $groupId, 'name' => $service['group_name'] ?? 'Services',
                'collapsed' => (bool) ($service['group_collapsed'] ?? false),
                'auto_expand' => !isset($service['group_auto_expand']) || (bool) $service['group_auto_expand'],
                'services' => [],
            ];
        }
        unset($service['group_id'], $service['group_name'], $service['group_position'], $service['group_collapsed'], $service['group_auto_expand'], $service['enabled'], $service['legacy_component_id']);
        $groups[$groupId]['services'][] = $service;
    }
    try {
        $incidents = db_all(
            "SELECT i.id,i.type,i.source,i.title,i.description,i.status,i.impact,i.starts_at,i.resolves_at,i.scheduled_start,i.scheduled_end,i.actual_start,i.actual_end,i.created_at,i.updated_at
               FROM status_page_incidents pi JOIN incidents i ON i.id=pi.incident_id
              WHERE pi.status_page_id=? AND i.public_visible=1
                AND i.status NOT IN ('resolved','completed','cancelled') ORDER BY i.starts_at DESC",
            [$page['id']]
        );
    } catch (Throwable $e) {
        error_log('[rumahl-status] Public incidents failed for page ' . $page['id'] . ': ' . $e->getMessage());
        $incidents = [];
    }
    foreach ($incidents as &$incident) {
        $incident['updates'] = db_all(
            "SELECT id,status,message,author,created_at FROM incident_updates
              WHERE incident_id=? AND visibility='public' ORDER BY created_at ASC,id ASC",
            [$incident['id']]
        );
        $incident['components'] = array_column(
            db_all('SELECT component_id FROM incident_components WHERE incident_id=?', [$incident['id']]),
            'component_id'
        );
        $incident['affected_components'] = db_all(
            "SELECT linked.* FROM (
                SELECT rel.service_id,rel.service_id component_id,rel.display_status status,s.public_name name,s.public_description description
                  FROM incident_services rel JOIN monitoring_services s ON s.id=rel.service_id
                 WHERE rel.incident_id=?
                UNION ALL
                SELECT s.id service_id,s.id component_id,
                       CASE i.impact WHEN 'critical' THEN 'major_outage' WHEN 'major' THEN 'partial_outage' ELSE 'degraded' END status,
                       s.public_name name,s.public_description description
                  FROM incident_components legacy
                  JOIN incidents i ON i.id=legacy.incident_id
                  JOIN monitoring_services s ON s.legacy_component_id=legacy.component_id OR s.id=legacy.component_id
                 WHERE legacy.incident_id=?
                   AND NOT EXISTS (SELECT 1 FROM incident_services rel WHERE rel.incident_id=legacy.incident_id AND rel.service_id=s.id)
            ) linked ORDER BY linked.name",
            [$incident['id'], $incident['id']]
        );
    }
    unset($incident);
    $pastIncidents = incidents_full(
        "status IN ('resolved','completed') AND id IN (SELECT incident_id FROM status_page_incidents WHERE status_page_id=?)",
        [$page['id']],
        5
    );
    $overall = monitoring_worst_status($overallStatuses);
    json_out([
        'page' => [
            'id' => $page['id'], 'slug' => $page['slug'], 'title' => $page['title'],
            'description' => $page['description'], 'logo_url' => $page['logo_url'],
            'logo_dark_url' => $page['logo_dark_url'], 'logo_mode' => $page['logo_mode'],
            'mobile_logo_url' => $page['mobile_logo_url'], 'mobile_logo_dark_url' => $page['mobile_logo_dark_url'],
            'header_brand_mode' => $page['header_brand_mode'],
            'header_config' => $page['header_config'] === null ? null : (json_decode((string) $page['header_config'], true) ?: []),
            'nav_links' => $page['nav_links'] === null ? null : (json_decode((string) $page['nav_links'], true) ?: []),
            'footer_config' => $page['footer_config'] === null ? null : (json_decode((string) $page['footer_config'], true) ?: []),
            'footer_links' => $page['footer_links'] === null ? null : (json_decode((string) $page['footer_links'], true) ?: []),
            'favicon_url' => $page['favicon_url'], 'custom_css_url' => $page['custom_css_url'],
            'custom_css' => $page['custom_css'],
            'theme' => json_decode((string) ($page['theme'] ?? 'null'), true),
            'contact_links' => json_decode((string) ($page['contact_links'] ?? '[]'), true),
            'canonical_domain' => $page['canonical_domain'],
            'path_enabled' => (bool) $page['path_enabled'], 'domain_enabled' => (bool) $page['domain_enabled'],
            'show_disabled_components' => (bool) $page['show_disabled_components'],
            'problem_reports_enabled' => (bool) ($page['problem_reports_enabled'] ?? true),
            'layout_config' => json_decode((string) ($page['layout_config'] ?? '{}'), true) ?: [],
            'default_language' => $page['default_language'] ?: 'en',
            'enabled_locales' => json_decode((string) ($page['enabled_locales'] ?? '["en"]'), true) ?: ['en'],
            'translations' => json_decode((string) ($page['translations'] ?? '{}'), true) ?: [],
        ],
        'overall' => $overall,
        'groups' => array_values($groups),
        'incidents' => $incidents,
        'past_incidents' => $pastIncidents,
        'updated_at' => iso(now_utc()),
    ]);
}

function monitoring_submit_problem_report(): never
{
    $input = json_body();
    $slug = isset($input['slug']) ? trim((string) $input['slug']) : null;
    $page = monitoring_resolve_public_page($slug !== '' ? $slug : null);
    if ($page === null || empty($page['problem_reports_enabled'])) json_error('Problem reporting is not available', 404);
    $serviceId = trim((string) ($input['service_id'] ?? ''));
    $exists = db_row('SELECT service_id FROM status_page_services WHERE status_page_id=? AND service_id=? AND enabled=1', [$page['id'], $serviceId]);
    if ($exists === null) json_error('Service is not published on this status page', 404);
    $region = mb_substr(trim((string) ($input['region'] ?? 'unknown')), 0, 80);
    if ($region === '') $region = 'unknown';
    $message = mb_substr(trim((string) ($input['message'] ?? '')), 0, 500);
    $address = (string) ($_SERVER['REMOTE_ADDR'] ?? 'unknown');
    $visitorHash = hash('sha256', $address . '|' . (string) $page['id'] . '|' . date('Y-m-d') . '|' . (string) statuspage_config()['admin_token']);
    $duplicate = db_row(
        'SELECT id FROM status_page_problem_reports WHERE status_page_id=? AND service_id=? AND visitor_hash=? AND created_at>=DATE_SUB(UTC_TIMESTAMP(),INTERVAL 30 MINUTE)',
        [$page['id'], $serviceId, $visitorHash]
    );
    if ($duplicate === null) {
        db_exec(
            'INSERT INTO status_page_problem_reports (status_page_id,service_id,region,visitor_hash,message,created_at) VALUES (?,?,?,?,?,?)',
            [$page['id'], $serviceId, $region, $visitorHash, $message !== '' ? $message : null, now_utc()]
        );
    }
    json_out(['ok' => true, 'recorded' => $duplicate === null]);
}

/**
 * Last-resort response for the infrastructure's default page. The status page
 * must remain useful when page-specific presentation metadata is inconsistent;
 * the original exception is still logged for repair.
 */
function monitoring_public_default_fallback(Throwable $cause): never
{
    error_log('[rumahl-status] Default tenant DTO failed; serving legacy status fallback: ' . $cause->getMessage());
    $legacy = build_status_response();
    $page = db_row("SELECT * FROM status_pages WHERE slug='default' AND enabled=1");
    if ($page === null) {
        throw $cause;
    }
    $groups = [];
    foreach ($legacy['groups'] as $group) {
        $groups[] = [
            'id' => $group['id'],
            'name' => $group['name'] === 'Ungrouped' ? '' : $group['name'],
            'collapsed' => (bool) ($group['collapsed'] ?? false),
            'auto_expand' => (bool) ($group['auto_expand'] ?? true),
            'services' => array_values($group['components'] ?? []),
        ];
    }
    json_out([
        'page' => [
            'id' => $page['id'], 'slug' => $page['slug'], 'title' => $page['title'], 'description' => $page['description'],
            'logo_url' => $page['logo_url'] ?? null, 'logo_dark_url' => $page['logo_dark_url'] ?? null,
            'logo_mode' => $page['logo_mode'] ?? 'same', 'mobile_logo_url' => $page['mobile_logo_url'] ?? null,
            'mobile_logo_dark_url' => $page['mobile_logo_dark_url'] ?? null, 'header_brand_mode' => $page['header_brand_mode'] ?? 'logo',
            'header_config' => json_decode((string) ($page['header_config'] ?? '{}'), true) ?: [],
            'nav_links' => json_decode((string) ($page['nav_links'] ?? 'null'), true),
            'footer_config' => json_decode((string) ($page['footer_config'] ?? '{}'), true) ?: [],
            'footer_links' => json_decode((string) ($page['footer_links'] ?? 'null'), true),
            'favicon_url' => $page['favicon_url'] ?? null, 'custom_css_url' => $page['custom_css_url'] ?? null,
            'custom_css' => $page['custom_css'] ?? null, 'theme' => json_decode((string) ($page['theme'] ?? '{}'), true) ?: [],
            'contact_links' => json_decode((string) ($page['contact_links'] ?? '[]'), true) ?: [],
            'canonical_domain' => $page['canonical_domain'] ?? null, 'path_enabled' => true, 'domain_enabled' => true,
            'show_disabled_components' => true, 'default_language' => $page['default_language'] ?? 'en',
            'enabled_locales' => json_decode((string) ($page['enabled_locales'] ?? '["en"]'), true) ?: ['en'],
            'translations' => json_decode((string) ($page['translations'] ?? '{}'), true) ?: [],
        ],
        'overall' => $legacy['overall'], 'groups' => $groups,
        'incidents' => array_values(array_merge($legacy['active_incidents'], $legacy['scheduled_maintenance'])),
        'updated_at' => iso(now_utc()), 'fallback' => true,
    ]);
}

function monitoring_upload_branding(): never
{
    $file = $_FILES['file'] ?? null;
    $kind = (string) ($_POST['kind'] ?? 'logo');
    $colorMode = (string) ($_POST['color_mode'] ?? 'same');
    if (!is_array($file) || ($file['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK) {
        json_error('A branding file is required');
    }
    if (!in_array($kind, ['logo', 'logo_dark', 'mobile_logo', 'mobile_logo_dark', 'favicon'], true)
        || !in_array($colorMode, ['same', 'adaptive', 'custom'], true)) {
        json_error('Invalid branding upload options');
    }
    if ((int) ($file['size'] ?? 0) > 2 * 1024 * 1024) {
        json_error('Branding files must not exceed 2 MB');
    }
    $original = (string) ($file['name'] ?? '');
    $extension = strtolower(pathinfo($original, PATHINFO_EXTENSION));
    $allowed = ['svg', 'png', 'jpg', 'jpeg', 'webp', 'ico'];
    if (!in_array($extension, $allowed, true)) {
        json_error('Unsupported branding file type');
    }
    $tmp = (string) ($file['tmp_name'] ?? '');
    $content = file_get_contents($tmp);
    if ($content === false) {
        json_error('Unable to read uploaded file');
    }
    if ($extension === 'svg') {
        $content = monitoring_sanitize_svg($content);
    }
    $directory = dirname(__DIR__) . '/uploads/branding';
    if (!is_dir($directory) && !mkdir($directory, 0755, true) && !is_dir($directory)) {
        json_error('Branding upload directory is not writable', 500);
    }
    $base = bin2hex(random_bytes(16));
    $filename = $base . '.' . $extension;
    if (file_put_contents($directory . '/' . $filename, $content, LOCK_EX) === false) {
        json_error('Unable to store branding file', 500);
    }
    $urlPrefix = basename(dirname(__DIR__)) === 'api' ? '/api' : '';
    $result = ['url' => $urlPrefix . '/uploads/branding/' . $filename, 'dark_url' => null, 'color_mode' => $colorMode];
    if ($extension === 'svg' && in_array($kind, ['logo', 'mobile_logo'], true) && $colorMode === 'adaptive') {
        $darkName = $base . '-dark.svg';
        $darkSvg = preg_replace('/\b(fill|stroke)=([' . "'\"" . '])(?!none\b|url\()[^' . "'\"" . ']+\2/i', '$1=$2#ffffff$2', $content) ?? $content;
        if (file_put_contents($directory . '/' . $darkName, $darkSvg, LOCK_EX) !== false) {
            $result['dark_url'] = $urlPrefix . '/uploads/branding/' . $darkName;
        }
    }
    json_out($result);
}

function monitoring_sanitize_svg(string $svg): string
{
    if (!str_contains(strtolower($svg), '<svg')
        || preg_match('/<(script|foreignObject|iframe|object|embed)\b/i', $svg)
        || preg_match('/\son[a-z]+\s*=/i', $svg)
        || preg_match('/(?:href|src)\s*=\s*[' . "'\"" . ']\s*(?:https?:|data:text\/html|javascript:)/i', $svg)) {
        json_error('Unsafe SVG content');
    }
    return $svg;
}

/** Verify a pending custom domain from its DNS TXT record on first use. */
function monitoring_verify_domain_for_host(string $host): void
{
    if (!function_exists('dns_get_record')) {
        return;
    }
    $domain = db_row(
        "SELECT id,verification_token FROM status_page_domains WHERE hostname=? AND status='pending'",
        [$host]
    );
    if ($domain === null) {
        return;
    }
    $records = @dns_get_record('_rumahl-status.' . $host, DNS_TXT);
    if (!is_array($records)) {
        return;
    }
    foreach ($records as $record) {
        $value = (string) ($record['txt'] ?? '');
        if ($value !== '' && hash_equals((string) $domain['verification_token'], $value)) {
            db_exec("UPDATE status_page_domains SET status='verified',verified_at=UTC_TIMESTAMP() WHERE id=?", [$domain['id']]);
            return;
        }
    }
}

function monitoring_worst_status(array $statuses): string
{
    $rank = ['unknown' => 0, 'operational' => 1, 'maintenance' => 2, 'degraded' => 3, 'partial_outage' => 4, 'major_outage' => 5];
    $worst = 'unknown';
    foreach ($statuses as $status) {
        if (($rank[$status] ?? 0) > $rank[$worst]) {
            $worst = $status;
        }
    }
    return $worst;
}

function monitoring_check_transition(string $current, bool $ok, int $failures, int $successes, int $failureThreshold, int $recoveryThreshold): array
{
    if ($ok) {
        $successes++;
        $failures = 0;
        $next = $successes >= max(1, $recoveryThreshold) ? 'operational' : $current;
    } else {
        $failures++;
        $successes = 0;
        $next = $failures >= max(1, $failureThreshold) ? 'major_outage' : $current;
    }
    return ['status' => $next, 'consecutive_failures' => $failures, 'consecutive_successes' => $successes];
}

function monitoring_validate_target(string $target): bool
{
    $host = parse_url($target, PHP_URL_HOST) ?: $target;
    $host = trim((string) preg_replace('/:\d+$/', '', $host), '[]');
    if ($host === '' || strtolower($host) === 'localhost' || str_ends_with(strtolower($host), '.local')) {
        return false;
    }
    if (filter_var($host, FILTER_VALIDATE_IP)) {
        return filter_var($host, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE) !== false;
    }
    return (bool) preg_match('/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i', $host);
}
