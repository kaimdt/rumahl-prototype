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
function add_incident_update(string $incidentId, string $status, string $message): void
{
    db_exec(
        'INSERT INTO incident_updates (incident_id, status, message, created_at)
         VALUES (?, ?, ?, ?)',
        [$incidentId, $status, $message, now_utc()]
    );
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
