<?php
/**
 * Incident helpers — used by the public API and the admin handlers.
 */

declare(strict_types=1);

require_once __DIR__ . '/helpers.php';

const INCIDENT_STATUSES = [
    'investigating', 'identified', 'monitoring', 'resolved',
    'scheduled', 'in_progress', 'completed',
];

/** Insert an update row for an incident (timeline entry). */
function add_incident_update(string $incidentId, string $status, string $message, ?string $author = null, array $serviceStatuses = []): int
{
    db_exec(
        'INSERT INTO incident_updates (incident_id, status, message, author, created_at)
         VALUES (?, ?, ?, ?, ?)',
        [$incidentId, $status, $message, $author, now_utc()]
    );
    $updateId = (int) db()->lastInsertId();
    foreach (normalize_incident_service_statuses($serviceStatuses) as $service) {
        db_exec(
            'INSERT INTO incident_update_services (update_id,service_id,display_status,created_at) VALUES (?,?,?,?)',
            [$updateId, $service['service_id'], $service['status'], now_utc()]
        );
    }
    return $updateId;
}

const COMPONENT_STATUS_PRIORITY = [
    'operational' => 0, 'maintenance' => 1, 'degraded' => 2,
    'partial_outage' => 3, 'major_outage' => 4,
];

function normalize_incident_service_statuses(array $items): array
{
    $normalized = [];
    foreach ($items as $key => $item) {
        if (is_array($item)) {
            $serviceId = trim((string) ($item['service_id'] ?? $item['component_id'] ?? ''));
            $status = (string) ($item['status'] ?? $item['display_status'] ?? 'degraded');
        } else {
            $serviceId = is_string($key) ? trim($key) : trim((string) $item);
            $status = is_string($key) ? (string) $item : 'degraded';
        }
        if ($serviceId !== '' && isset(COMPONENT_STATUS_PRIORITY[$status])) {
            $normalized[$serviceId] = ['service_id' => $serviceId, 'status' => $status];
        }
    }
    return array_values($normalized);
}

function replace_incident_services(string $incidentId, array $serviceStatuses): void
{
    $services = normalize_incident_service_statuses($serviceStatuses);
    db_exec('DELETE FROM incident_services WHERE incident_id=?', [$incidentId]);
    foreach ($services as $service) {
        if (db_row('SELECT id FROM monitoring_services WHERE id=?', [$service['service_id']]) === null) continue;
        db_exec(
            'INSERT INTO incident_services (id,incident_id,service_id,display_status,created_at,updated_at) VALUES (?,?,?,?,?,?)',
            [uuid4(), $incidentId, $service['service_id'], $service['status'], now_utc(), now_utc()]
        );
    }
    // An incident belongs to every status page that publishes one of its
    // affected services. Incidents without a service remain on the default page.
    db_exec('DELETE FROM status_page_incidents WHERE incident_id=?', [$incidentId]);
    db_exec(
        'INSERT IGNORE INTO status_page_incidents (status_page_id,incident_id)
         SELECT DISTINCT pages.status_page_id, rel.incident_id
           FROM incident_services rel
           JOIN status_page_services pages ON pages.service_id=rel.service_id
          WHERE rel.incident_id=?',
        [$incidentId]
    );
    if (db_row('SELECT incident_id FROM status_page_incidents WHERE incident_id=? LIMIT 1', [$incidentId]) === null) {
        db_exec(
            "INSERT IGNORE INTO status_page_incidents (status_page_id,incident_id)
             SELECT id,? FROM status_pages WHERE slug='default' LIMIT 1",
            [$incidentId]
        );
    }
}

/** Resolve monitoring state and all active incident overrides in one place. */
function resolve_component_display_status(string $monitorStatus, array $incidentStatuses): string
{
    // An explicitly managed incident is authoritative. Monitoring is only the
    // fallback while no active incident controls this service.
    if ($incidentStatuses === []) {
        return isset(COMPONENT_STATUS_PRIORITY[$monitorStatus]) ? $monitorStatus : 'operational';
    }
    $resolved = 'operational';
    foreach ($incidentStatuses as $status) {
        if (isset(COMPONENT_STATUS_PRIORITY[$status])
            && COMPONENT_STATUS_PRIORITY[$status] > COMPONENT_STATUS_PRIORITY[$resolved]) {
            $resolved = $status;
        }
    }
    return $resolved;
}

function active_incident_service_map(array $serviceIds): array
{
    if ($serviceIds === []) return [];
    $placeholders = implode(',', array_fill(0, count($serviceIds), '?'));
    $rows = db_all(
        "SELECT linked.* FROM (
            SELECT rel.service_id,rel.display_status,i.id incident_id,i.title,i.status incident_status,i.impact,i.type,i.updated_at
              FROM incident_services rel JOIN incidents i ON i.id=rel.incident_id
             WHERE rel.service_id IN ({$placeholders}) AND i.status NOT IN ('resolved','completed')
            UNION ALL
            SELECT s.id service_id,
                   CASE i.impact WHEN 'critical' THEN 'major_outage' WHEN 'major' THEN 'partial_outage' ELSE 'degraded' END display_status,
                   i.id incident_id,i.title,i.status incident_status,i.impact,i.type,i.updated_at
              FROM incident_components legacy
              JOIN monitoring_services s ON s.legacy_component_id=legacy.component_id OR s.id=legacy.component_id
              JOIN incidents i ON i.id=legacy.incident_id
             WHERE s.id IN ({$placeholders}) AND i.status NOT IN ('resolved','completed')
               AND NOT EXISTS (SELECT 1 FROM incident_services rel WHERE rel.incident_id=i.id AND rel.service_id=s.id)
        ) linked ORDER BY linked.updated_at DESC",
        array_merge($serviceIds, $serviceIds)
    );
    $map = [];
    foreach ($rows as $row) $map[$row['service_id']][] = $row;
    return $map;
}

/** Queue a notification when an incident is created or its status changes. */
function queue_incident_alert(array $incident, string $newStatus, string $message): void
{
    $settings = settings_get();
    $isResolved = in_array($newStatus, ['resolved', 'completed'], true);

    if ($isResolved) {
        $subject = "[rumahl Status] Resolved: {$incident['title']}";
    } elseif (($incident['status'] ?? null) === $newStatus) {
        $subject = "[rumahl Status] Updated: {$incident['title']} ({$newStatus})";
    } else {
        $subject = "[rumahl Status] {$newStatus}: {$incident['title']}";
    }

    $body = sprintf(
        "Incident: %s\nStatus: %s\nImpact: %s\nTime: %s UTC\nPage: %s\n\n%s",
        $incident['title'],
        $newStatus,
        $incident['impact'] ?? 'minor',
        now_utc(),
        $settings['page_url'],
        $message !== '' ? $message : '(no message)'
    );

    queue_alerts('incident', $subject, $body);
}
