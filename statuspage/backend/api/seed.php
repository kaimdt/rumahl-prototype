#!/usr/bin/env php
<?php
/**
 * Seed the default component groups and components.
 *
 *   php api/seed.php          # idempotent — skips existing groups
 *   php api/seed.php --reset  # wipe groups/components/checks and reseed
 *
 * The monitored endpoints must be reachable from the server running the
 * cron. Adjust the service URLs to your network (domain names or IPs).
 */

declare(strict_types=1);

require_once __DIR__ . '/src/helpers.php';

$reset = in_array('--reset', $argv, true);

if ($reset) {
    foreach (['check_results', 'uptime_daily', 'component_status', 'incident_components',
              'incident_updates', 'incidents', 'components', 'component_groups'] as $table) {
        db_exec("DELETE FROM {$table}");
    }
    echo "Reset done.\n";
}

$groups = [
    ['Web', [
        ['rumahl.com', 'https://rumahl.com', 'Main website'],
        ['rumahl App Store', 'https://store.rumahl.com', 'App & plugin store'],
        ['Status Page', 'https://status.rumahl.com/api/status', 'This status page'],
    ]],
    ['API Services', [
        ['rumahl Home', 'http://localhost:8126', 'Main API + dashboard'],
        ['rumahl Core', 'http://localhost:8090', 'Service discovery, plugin registry'],
        ['rumahl Control', 'http://localhost:8091', 'Control center, system services'],
        ['rumahl Assist', 'http://localhost:8092', 'AI assistant (ORA)'],
        ['rumahl Supervisor', 'http://localhost:8097', 'Docker container management'],
        ['rumahl Appstore', 'http://localhost:8098', 'App store backend'],
        ['rumahl Gateway', 'http://localhost:8096', 'API gateway'],
    ]],
];

$existingGroups = db_all('SELECT name FROM component_groups');

foreach ($groups as $groupIndex => [$groupName, $components]) {
    $groupId = null;
    if (!in_array($groupName, array_column($existingGroups, 'name'), true)) {
        $groupId = uuid4();
        db_exec(
            'INSERT INTO component_groups (id, name, position, created_at) VALUES (?, ?, ?, ?)',
            [$groupId, $groupName, $groupIndex, now_utc()]
        );
        echo "Group: {$groupName}\n";
    } else {
        $row = db_row('SELECT id FROM component_groups WHERE name = ?', [$groupName]);
        $groupId = $row['id'];
    }

    foreach ($components as $position => [$name, $url, $description]) {
        $exists = db_row('SELECT id FROM components WHERE name = ?', [$name]);
        if ($exists !== null) {
            echo "  exists: {$name}\n";
            continue;
        }
        $id = uuid4();
        db_exec(
            'INSERT INTO components (id, group_id, name, description, kind, endpoint_url,
                                     method, expected_status, timeout_ms, position, enabled,
                                     created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [$id, $groupId, $name, $description, 'auto', $url, 'GET', 200,
             $url === 'https://status.rumahl.com/api/status' ? 10000 : 5000,
             $position, 1, now_utc(), now_utc()]
        );
        db_exec(
            'INSERT INTO component_status (component_id, status, changed_at) VALUES (?, ?, ?)',
            [$id, 'operational', now_utc()]
        );
        echo "  added: {$name}\n";
    }
}

echo "Done. Now run the monitor: php api/cron/monitor.php (or the HTTP cron).\n";
