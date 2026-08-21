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

/* ── Incomplete upload check ──────────────────────────────────────── */
// schema_migrations()/db_migrate() live in src/db.php (loaded via
// helpers.php). A stale src/ folder is the #1 upgrade mistake — fail
// with a helpful message instead of a cryptic "undefined function".
if (!function_exists('schema_migrations') || !function_exists('db_migrate')) {
    $msg = 'Incomplete upgrade: the migration functions (schema_migrations/db_migrate) are missing. '
        . 'Your server still has OLD backend files. Upload ALL files from backend/api/ — especially '
        . 'src/db.php and src/helpers.php — and run this tool again. Do NOT delete '
        . 'src/config.local.php (it holds your credentials).';
    if ($isCli) {
        fwrite(STDERR, "[rumahl-status] {$msg}\n");
        exit(1);
    }
    http_response_code(500);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['error' => $msg]);
    exit;
}

/* ── Auth (HTTP only) ───────────────────────────────────────────── */
if (!$isCli) {
    $config = statuspage_config();
    $key = trim((string) ($_GET['key'] ?? ''));
    $configured = trim((string) $config['cron_key']);
    if ($configured === '' || $key === '' || !hash_equals($configured, $key)) {
        http_response_code(403);
        header('Content-Type: application/json; charset=utf-8');
        $host = (string) ($_SERVER['HTTP_HOST'] ?? '');
        $hint = $host !== ''
            ? " — expected URL: https://{$host}/upgrade.php?key=<cron_key> (no /httpdocs or /src path)"
            : '';
        echo json_encode(['error' => 'Invalid cron key' . $hint]);
        exit;
    }
}

/* ── Options ────────────────────────────────────────────────────── */
$doBackup = $isCli
    ? !in_array('--no-backup', $argv, true)
    : ($_GET['backup'] ?? '1') !== '0';

/**
 * Backup directory: STATUSPAGE_BACKUP_DIR env / config.local.php
 * ('backup_dir' key) wins; otherwise the system temp dir is used — it is
 * always inside open_basedir, unlike a folder next to the web root.
 */
function upgrade_backup_dir(array $config): string
{
    $configured = trim((string) ($config['backup_dir'] ?? ''));
    if ($configured !== '') {
        return rtrim($configured, '/\\');
    }
    return sys_get_temp_dir() . '/rumahl-status-backups';
}

/**
 * PHP-based logical dump (no mysqldump / exec required). Writes a plain
 * SQL file that restores with: mysql -u USER -p DB < backup.sql
 */
function upgrade_backup_php(PDO $pdo, string $file): bool
{
    $fh = @fopen($file, 'w');
    if ($fh === false) {
        return false;
    }
    fwrite($fh, "-- rumahl Status backup (PHP dump) " . gmdate('Y-m-d H:i:s') . " UTC\n");
    fwrite($fh, "SET NAMES utf8mb4;\n\n");

    $tables = $pdo->query('SHOW TABLES')->fetchAll(PDO::FETCH_COLUMN);
    foreach ($tables as $table) {
        $table = (string) $table;
        $create = $pdo->query("SHOW CREATE TABLE `{$table}`")->fetch(PDO::FETCH_ASSOC);
        $createSql = is_array($create) ? array_values($create)[1] ?? null : null;
        if (!is_string($createSql) || $createSql === '') {
            continue;
        }
        fwrite($fh, "DROP TABLE IF EXISTS `{$table}`;\n{$createSql};\n\n");

        $rows = $pdo->query("SELECT * FROM `{$table}`")->fetchAll(PDO::FETCH_ASSOC);
        if ($rows === []) {
            continue;
        }
        $cols = array_keys($rows[0]);
        $colsSql = '`' . implode('`,`', $cols) . '`';
        $chunk = [];
        $flush = function () use ($fh, $table, $colsSql, &$chunk): void {
            if ($chunk === []) {
                return;
            }
            fwrite($fh, "INSERT INTO `{$table}` ({$colsSql}) VALUES\n" . implode(",\n", $chunk) . ";\n");
            $chunk = [];
        };
        foreach ($rows as $row) {
            $vals = [];
            foreach ($cols as $col) {
                $value = $row[$col];
                $vals[] = $value === null ? 'NULL' : $pdo->quote((string) $value);
            }
            $chunk[] = '(' . implode(',', $vals) . ')';
            if (count($chunk) >= 500) {
                $flush();
            }
        }
        $flush();
        fwrite($fh, "\n");
    }
    fclose($fh);
    return is_file($file) && (int) filesize($file) > 0;
}

/**
 * Create the backup: mysqldump when available, otherwise a PHP dump.
 * Returns ['file' => path|null, 'method' => 'mysqldump'|'php'|null,
 *          'reason' => string].
 */
function upgrade_backup(array $config, PDO $pdo): array
{
    $dir = upgrade_backup_dir($config);
    if (!@is_dir($dir) && !@mkdir($dir, 0775, true)) {
        return ['file' => null, 'method' => null, 'reason' => "backup dir not writable: {$dir}"];
    }
    $file = $dir . '/statuspage-' . gmdate('Ymd-His') . '.sql';

    // 1) mysqldump via shell (best effort — often unavailable on shared hosting).
    if (function_exists('exec')) {
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
        if ($code === 0 && is_file($file) && (int) filesize($file) > 0) {
            return ['file' => $file, 'method' => 'mysqldump', 'reason' => ''];
        }
        @unlink($file);
    }

    // 2) PHP-based dump — works everywhere (no exec / mysqldump needed).
    if (upgrade_backup_php($pdo, $file)) {
        return ['file' => $file, 'method' => 'php', 'reason' => ''];
    }
    @unlink($file);
    return ['file' => null, 'method' => null, 'reason' => 'PHP dump failed (disk full or no write permission)'];
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

    $backup = ['file' => null, 'method' => null, 'reason' => 'backup disabled'];
    if ($doBackup) {
        $backup = upgrade_backup($config, $pdo);
    }

    $applied = db_migrate($pdo);
    db_exec(
        "INSERT INTO settings (skey, svalue) VALUES ('schema_version', ?)
         ON DUPLICATE KEY UPDATE svalue = VALUES(svalue)",
        [$toVersion]
    );

    // The schema auto-migrates on every request (db_ensure_schema), so an
    // installation may already be current while the version marker was never
    // written — explain that instead of a confusing empty report.
    $note = null;
    if ($applied === [] && $fromVersion !== $toVersion) {
        $note = 'Schema was already current (auto-migrated by the first request after the upload); version marker updated.';
    }

    $result = [
        'ok' => true,
        'version' => STATUSPAGE_VERSION,
        'schema' => [
            'from' => $fromVersion,
            'to' => $toVersion,
            'migrations_applied' => $applied,
            'up_to_date' => $applied === [],
        ],
        'backup' => $backup['file'] !== null
            ? ['created' => true, 'file' => $backup['file'], 'method' => $backup['method']]
            : ['created' => false, 'reason' => $backup['reason']],
        'note' => $note,
    ];

    if ($isCli) {
        echo "rumahl Status Page upgrade\n";
        echo "─────────────────────────────\n";
        echo "App version        : {$result['version']}\n";
        echo "Schema version     : {$result['schema']['from']} → {$result['schema']['to']}\n";
        echo "Migrations applied : " . ($applied === [] ? '(none — already up to date)' : implode(', ', $applied)) . "\n";
        if ($result['backup']['created']) {
            echo "Backup             : {$result['backup']['file']} ({$result['backup']['method']})\n";
        } else {
            echo "Backup             : NOT created — {$result['backup']['reason']}\n";
        }
        if ($note !== null) {
            echo "Note               : {$note}\n";
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
