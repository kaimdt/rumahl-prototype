<?php
/**
 * rumahl Status Page — upgrade / migrate tool.
 *
 * Updates an existing installation WITHOUT losing any data. All migrations
 * are additive (they only ADD columns with defaults), and by default the
 * tool creates a full MySQL dump in ../backups/ before touching the schema.
 *
 * Usage:
 *
 *   CLI:  php api/upgrade.php              # backup + migrate
 *         php api/upgrade.php --no-backup  # skip the dump
 *
 *   HTTP: https://status.rumahl.com/api/upgrade.php?key=YOUR_CRON_KEY
 *         (add &backup=0 to skip the dump)
 *
 * The schema also self-migrates on every request (db_ensure_schema), so
 * simply replacing the files works too — this tool just does it explicitly
 * with a backup and version reporting.
 */

declare(strict_types=1);

require_once __DIR__ . '/src/helpers.php';

error_reporting(E_ALL);
ini_set('display_errors', '1');

$isCli = PHP_SAPI === 'cli';

/* ── Auth (HTTP only) ───────────────────────────────────────────── */
if (!$isCli) {
    $config = statuspage_config();
    $key = (string) ($_GET['key'] ?? '');
    if ($config['cron_key'] === '' || $key === '' || !hash_equals($config['cron_key'], $key)) {
        http_response_code(403);
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode(['error' => 'Invalid cron key']);
        exit;
    }
}

/* ── Options ────────────────────────────────────────────────────── */
$doBackup = $isCli
    ? !in_array('--no-backup', $argv, true)
    : ($_GET['backup'] ?? '1') !== '0';

/** Full mysqldump into ../backups/. Returns the file path or null. */
function upgrade_backup(array $config): ?string
{
    if (!function_exists('exec')) {
        return null;
    }
    $dir = dirname(__DIR__, 2) . '/backups';
    if (!is_dir($dir) && !@mkdir($dir, 0775, true)) {
        return null;
    }
    $file = $dir . '/statuspage-' . gmdate('Ymd-His') . '.sql';
    $cmd = sprintf(
        'mysqldump --host=%s --port=%d --user=%s --password=%s %s > %s 2>&1',
        escapeshellarg($config['db']['host']),
        (int) $config['db']['port'],
        escapeshellarg($config['db']['user']),
        escapeshellarg((string) $config['db']['pass']),
        escapeshellarg($config['db']['name']),
        escapeshellarg($file)
    );
    $out = [];
    $code = 0;
    exec($cmd, $out, $code);
    if ($code !== 0 || !is_file($file) || (int) filesize($file) === 0) {
        @unlink($file);
        return null;
    }
    return $file;
}

set_time_limit(300);

try {
    // Connect WITHOUT the automatic migration — upgrade.php reports exactly
    // what it applies itself (db(false)).
    $pdo = db(false);
    $config = statuspage_config();

    // Make sure the base schema exists at all (fresh server, no installer).
    $tables = $pdo->query(
        "SELECT COUNT(*) AS n FROM information_schema.TABLES
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'settings'"
    )->fetch(PDO::FETCH_ASSOC);
    if ((int) ($tables['n'] ?? 0) === 0) {
        throw new RuntimeException(
            'Database schema not found — run the web installer (api/install.php) first.'
        );
    }

    $row = db_row("SELECT svalue FROM settings WHERE skey = 'schema_version'");
    $fromVersion = $row['svalue'] ?? 'v1';
    $toVersion = (string) array_key_last(schema_migrations());

    $backupFile = null;
    if ($doBackup) {
        $backupFile = upgrade_backup($config);
    }

    $applied = db_migrate($pdo);
    db_exec(
        "INSERT INTO settings (skey, svalue) VALUES ('schema_version', ?)
         ON DUPLICATE KEY UPDATE svalue = VALUES(svalue)",
        [$toVersion]
    );

    $result = [
        'ok' => true,
        'version' => STATUSPAGE_VERSION,
        'schema' => [
            'from' => $fromVersion,
            'to' => $toVersion,
            'migrations_applied' => $applied,
            'up_to_date' => $applied === [],
        ],
        'backup' => $backupFile !== null
            ? ['created' => true, 'file' => $backupFile]
            : ['created' => false, 'reason' => 'mysqldump not available (or backup disabled)'],
    ];

    if ($isCli) {
        echo "rumahl Status Page upgrade\n";
        echo "─────────────────────────────\n";
        echo "App version        : {$result['version']}\n";
        echo "Schema version     : {$result['schema']['from']} → {$result['schema']['to']}\n";
        echo "Migrations applied : " . ($applied === [] ? '(none — already up to date)' : implode(', ', $applied)) . "\n";
        echo "Backup             : " . ($backupFile !== null ? $backupFile : 'NOT created — ' . $result['backup']['reason']) . "\n";
        if ($applied === [] && $backupFile !== null) {
            echo "Note               : schema was already current — backup still created.\n";
        }
        exit(0);
    }

    json_out($result);
} catch (Throwable $e) {
    error_log('[rumahl-status] upgrade: ' . $e->getMessage());
    if ($isCli) {
        fwrite(STDERR, 'Upgrade failed: ' . $e->getMessage() . "\n");
        exit(1);
    }
    json_error('Upgrade failed: ' . $e->getMessage(), 500);
}
