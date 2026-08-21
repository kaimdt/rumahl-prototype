<?php
/**
 * rumahl Status Page — backend configuration.
 *
 * Defaults live here; the installer writes runtime values to
 * src/config.local.php (protected by .htaccess, never served).
 * Environment variables (STATUSPAGE_*) override both — useful for
 * hosting panels that inject credentials.
 */

declare(strict_types=1);

const STATUSPAGE_VERSION = '1.7.0';

function env(string $key, ?string $default = null): ?string
{
    $value = getenv('STATUSPAGE_' . $key);
    return $value === false ? $default : $value;
}

/** Merged configuration — defaults + config.local.php + env overrides. */
function statuspage_config(): array
{
    static $config = null;
    if ($config !== null) {
        return $config;
    }

    $config = [
        'db' => [
            'host' => env('DB_HOST', '127.0.0.1'),
            'port' => (int) env('DB_PORT', '3306'),
            'name' => env('DB_NAME', 'rumahl_status'),
            'user' => env('DB_USER', 'rumahl_status'),
            'pass' => env('DB_PASS', ''),
        ],
        // Admin token — required for /api/admin/* (Bearer auth).
        'admin_token' => env('ADMIN_TOKEN', ''),
        // Key for the HTTP cron entry point (cron.php?key=…).
        'cron_key' => env('CRON_KEY', ''),
        // Backup directory for api/upgrade.php. Empty = system temp dir
        // (always inside open_basedir); set e.g. to an allowed path like
        // /var/www/vhosts/example.com/tmp if you want the dumps elsewhere.
        'backup_dir' => env('BACKUP_DIR', ''),
        'defaults' => [
            'page_name' => 'rumahl Status',
            'page_url' => 'https://status.rumahl.com',
            'timezone' => 'Europe/Berlin',
            'from_email' => 'status@rumahl.com',
            'alert_emails' => [],
            'webhook_urls' => [],
            'latency_threshold_ms' => 3000,
            'failure_window' => 5,
            'auto_incidents_enabled' => 1,
            'self_monitoring_enabled' => 1,
        ],
    ];

    $localFile = __DIR__ . '/config.local.php';
    if (is_file($localFile)) {
        $local = require $localFile;
        if (is_array($local)) {
            $config = array_replace_recursive($config, $local);
        }
    }

    return $config;
}
