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
    if ($name === '' || $target === '' || !in_array($type, ['http', 'tcp', 'icmp', 'dns', 'tls', 'custom'], true)) {
        json_error('Check name, type and target are required');
    }
    if ($type !== 'custom' && !monitoring_validate_target($target)) {
        json_error('Monitoring target is not allowed');
    }
    $id = (string) ($input['id'] ?? uuid4());
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
        [$id, $input['service_id'] ?? null, $input['host_id'] ?? null, $name, $type, $target,
         json_encode($input['config'] ?? new stdClass()), max(30, (int) ($input['interval_seconds'] ?? 60)),
         max(100, min(60000, (int) ($input['timeout_ms'] ?? 10000))), max(0, min(10, (int) ($input['retry_count'] ?? 1))),
         max(1, min(20, (int) ($input['failure_threshold'] ?? 3))), max(1, min(20, (int) ($input['recovery_threshold'] ?? 2))),
         'unknown', $input['monitoring_location'] ?? null, !empty($input['auto_incident_enabled']) ? 1 : 0,
         !isset($input['enabled']) || !empty($input['enabled']) ? 1 : 0, now_utc(), now_utc()]
    );
    json_out(['ok' => true, 'id' => $id]);
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
    db_exec(
        "INSERT INTO status_pages (id,slug,title,description,logo_url,favicon_url,theme,contact_links,canonical_domain,enabled,created_at,updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
         ON DUPLICATE KEY UPDATE slug=VALUES(slug),title=VALUES(title),description=VALUES(description),logo_url=VALUES(logo_url),
          favicon_url=VALUES(favicon_url),theme=VALUES(theme),contact_links=VALUES(contact_links),canonical_domain=VALUES(canonical_domain),
          enabled=VALUES(enabled),updated_at=VALUES(updated_at)",
        [$id, $slug, $title, $input['description'] ?? null, $input['logo_url'] ?? null, $input['favicon_url'] ?? null,
         json_encode($input['theme'] ?? new stdClass()), json_encode($input['contact_links'] ?? []), $canonical,
         !isset($input['enabled']) || !empty($input['enabled']) ? 1 : 0, now_utc(), now_utc()]
    );
    json_out(['ok' => true, 'id' => $id]);
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

function monitoring_public_page(?string $slug = null): never
{
    $host = strtolower(preg_replace('/:\d+$/', '', (string) ($_SERVER['HTTP_HOST'] ?? '')));
    if ($slug !== null && $slug !== '') {
        $page = db_row('SELECT * FROM status_pages WHERE slug = ? AND enabled = 1', [$slug]);
    } elseif ($host !== '') {
        $page = db_row(
            "SELECT p.* FROM status_pages p JOIN status_page_domains d ON d.status_page_id=p.id
              WHERE d.hostname=? AND d.status='verified' AND p.enabled=1",
            [$host]
        );
    } else {
        $page = null;
    }
    $page ??= db_row("SELECT * FROM status_pages WHERE slug='default' AND enabled=1");
    if ($page === null) {
        json_error('Status page not found', 404);
    }
    $services = db_all(
        "SELECT s.id,s.public_name name,s.public_description description,s.status,
                ps.show_uptime,ps.show_performance,ps.position,g.id group_id,g.name group_name,g.position group_position,
                c.id component_id
           FROM status_page_services ps
           JOIN monitoring_services s ON s.id=ps.service_id
           LEFT JOIN status_page_groups g ON g.id=ps.group_id
           LEFT JOIN components c ON c.id=s.legacy_component_id
          WHERE ps.status_page_id=? AND s.public_status_enabled=1
          ORDER BY COALESCE(g.position,9999),ps.position,s.public_name",
        [$page['id']]
    );
    $groups = [];
    foreach ($services as $service) {
        $groupId = $service['group_id'] ?? 'ungrouped';
        if (!isset($groups[$groupId])) {
            $groups[$groupId] = ['id' => $groupId, 'name' => $service['group_name'] ?? 'Services', 'services' => []];
        }
        unset($service['group_id'], $service['group_name'], $service['group_position']);
        $groups[$groupId]['services'][] = $service;
    }
    $incidents = db_all(
        "SELECT i.id,i.type,i.title,i.description,i.status,i.impact,i.starts_at,i.resolves_at,i.updated_at
           FROM status_page_incidents pi JOIN incidents i ON i.id=pi.incident_id
          WHERE pi.status_page_id=? AND i.public_visible=1
            AND i.status NOT IN ('resolved','completed','cancelled') ORDER BY i.starts_at DESC",
        [$page['id']]
    );
    foreach ($incidents as &$incident) {
        $incident['updates'] = db_all(
            "SELECT id,status,message,created_at FROM incident_updates
              WHERE incident_id=? AND visibility='public' ORDER BY created_at ASC,id ASC",
            [$incident['id']]
        );
    }
    unset($incident);
    $overall = monitoring_worst_status(array_column($services, 'status'));
    json_out([
        'page' => [
            'id' => $page['id'], 'slug' => $page['slug'], 'title' => $page['title'],
            'description' => $page['description'], 'logo_url' => $page['logo_url'],
            'favicon_url' => $page['favicon_url'], 'theme' => json_decode((string) ($page['theme'] ?? 'null'), true),
            'contact_links' => json_decode((string) ($page['contact_links'] ?? '[]'), true),
            'canonical_domain' => $page['canonical_domain'],
        ],
        'overall' => $overall,
        'groups' => array_values($groups),
        'incidents' => $incidents,
        'updated_at' => iso(now_utc()),
    ]);
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
