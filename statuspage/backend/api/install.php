<?php
/**
 * Web installer — creates the database schema and writes src/config.local.php.
 *
 *   https://status.rumahl.com/api/install.php
 *
 * Only runs when no config.local.php exists yet. After a successful install
 * the file must be removed (the script refuses to run again anyway).
 * If you prefer the CLI: create the DB, run schema.sql, then write
 * src/config.local.php manually (see src/config.php for the format).
 */

declare(strict_types=1);

error_reporting(E_ALL);
ini_set('display_errors', '1');

$configFile = __DIR__ . '/src/config.local.php';

function install_schema(PDO $pdo): void
{
    $schema = file_get_contents(__DIR__ . '/schema.sql');
    if ($schema === false) {
        throw new RuntimeException('schema.sql not found');
    }

    // Remove full-line comments BEFORE splitting — otherwise the first
    // chunk (comment header + CREATE TABLE component_groups) starts with
    // "--" and the whole table gets skipped, breaking the foreign keys.
    $lines = preg_split('/\r?\n/', $schema);
    $clean = implode("\n", array_filter($lines, fn (string $line): bool =>
        !str_starts_with(trim($line), '--')
    ));

    // Split on statement-terminating semicolons (the schema contains no
    // semicolons inside strings, only plain CREATE TABLE statements).
    $statements = array_filter(array_map('trim', explode(';', $clean)));
    foreach ($statements as $statement) {
        if ($statement === '') {
            continue;
        }
        $pdo->exec($statement);
    }

    // Sanity check: all tables must exist now.
    $tables = ['component_groups', 'components', 'check_results', 'component_status',
               'uptime_daily', 'incidents', 'incident_updates', 'incident_components',
               'alert_log', 'settings'];
    $existing = $pdo->query(
        "SELECT TABLE_NAME FROM information_schema.TABLES
          WHERE TABLE_SCHEMA = DATABASE()"
    )->fetchAll(PDO::FETCH_COLUMN);
    $missing = array_diff($tables, array_map('strtolower', $existing));
    if ($missing !== []) {
        throw new RuntimeException('Schema incomplete — missing tables: ' . implode(', ', $missing));
    }
}

$error = null;
$success = null;

if (is_file($configFile)) {
    $error = 'Already installed — config.local.php exists. Delete it to re-run the installer.';
} elseif ($_SERVER['REQUEST_METHOD'] === 'POST') {
    try {
        $host = trim((string) ($_POST['db_host'] ?? '127.0.0.1'));
        $port = (int) ($_POST['db_port'] ?? 3306);
        $name = trim((string) ($_POST['db_name'] ?? ''));
        $user = trim((string) ($_POST['db_user'] ?? ''));
        $pass = (string) ($_POST['db_pass'] ?? '');
        $adminToken = trim((string) ($_POST['admin_token'] ?? ''));
        $cronKey = trim((string) ($_POST['cron_key'] ?? ''));

        if ($name === '' || $user === '') {
            throw new RuntimeException('Database name and user are required');
        }
        if ($adminToken === '' || strlen($adminToken) < 12) {
            throw new RuntimeException('Admin token must be at least 12 characters');
        }
        if ($cronKey === '') {
            throw new RuntimeException('Cron key is required (used by cron.php?key=…)');
        }

        $pdo = new PDO(
            sprintf('mysql:host=%s;port=%d;dbname=%s;charset=utf8mb4', $host, $port, $name),
            $user,
            $pass,
            [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]
        );
        install_schema($pdo);

        $local = "<?php\nreturn " . var_export([
            'db' => ['host' => $host, 'port' => $port, 'name' => $name, 'user' => $user, 'pass' => $pass],
            'admin_token' => $adminToken,
            'cron_key' => $cronKey,
        ], true) . ";\n";
        if (file_put_contents($configFile, $local, LOCK_EX) === false) {
            throw new RuntimeException('Could not write src/config.local.php — check directory permissions');
        }

        // Seed default settings (db() now picks up the new config).
        require_once __DIR__ . '/src/helpers.php';
        settings_save([
            'page_name' => trim((string) ($_POST['page_name'] ?? 'rumahl Status')),
            'page_url' => trim((string) ($_POST['page_url'] ?? 'https://status.rumahl.com')),
            'timezone' => trim((string) ($_POST['timezone'] ?? 'Europe/Berlin')),
            'from_email' => trim((string) ($_POST['from_email'] ?? 'status@rumahl.com')),
            'alert_emails' => [],
            'webhook_urls' => [],
            'latency_threshold_ms' => 3000,
            'failure_window' => 5,
        ]);

        $success = 'Installation complete. Remove install.php from the server and set up the cron job (CLI or HTTP cron.php).';
    } catch (Throwable $e) {
        $error = $e->getMessage();
    }
}

header('Content-Type: text/html; charset=utf-8');
?>
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>rumahl Status — Installer</title>
<style>
  body { font-family: system-ui, sans-serif; background: #0a0a0f; color: #e8ecf4; margin: 0; padding: 40px 16px; }
  .card { max-width: 560px; margin: 0 auto; background: #101018; border: 1px solid #23232f; border-radius: 16px; padding: 28px; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  p.sub { color: #8b91a7; font-size: 13px; margin: 0 0 20px; }
  label { display: block; font-size: 12px; font-weight: 600; margin: 12px 0 4px; color: #b6bccf; }
  input { width: 100%; box-sizing: border-box; padding: 9px 10px; border-radius: 8px; border: 1px solid #2c2c3c; background: #0d0d14; color: #e8ecf4; font-size: 14px; }
  button { margin-top: 20px; width: 100%; padding: 11px; border: 0; border-radius: 9px; background: #2e8bff; color: white; font-size: 14px; font-weight: 700; cursor: pointer; }
  .error { background: rgba(255, 60, 60, .12); border: 1px solid rgba(255, 60, 60, .35); color: #ff8b8b; padding: 10px 12px; border-radius: 8px; font-size: 13px; margin-bottom: 16px; }
  .success { background: rgba(60, 220, 140, .12); border: 1px solid rgba(60, 220, 140, .35); color: #7fe8b4; padding: 10px 12px; border-radius: 8px; font-size: 13px; margin-bottom: 16px; }
  code { background: #1a1a26; padding: 2px 6px; border-radius: 5px; font-size: 12px; }
</style>
</head>
<body>
<div class="card">
  <h1>rumahl Status — Installer</h1>
  <p class="sub">Creates the MySQL schema and writes the local configuration. Runs only once.</p>

  <?php if ($error !== null): ?><div class="error"><?= htmlspecialchars($error) ?></div><?php endif; ?>
  <?php if ($success !== null): ?><div class="success"><?= htmlspecialchars($success) ?></div>
    <p class="sub">Cron (every minute) — CLI: <code>php api/cron/monitor.php</code> or HTTP: <code>https://status.rumahl.com/api/cron.php?key=…</code></p>
  <?php else: ?>
  <form method="post">
    <label>MySQL host</label>
    <input name="db_host" value="127.0.0.1">
    <label>MySQL port</label>
    <input name="db_port" value="3306">
    <label>Database name</label>
    <input name="db_name" required>
    <label>Database user</label>
    <input name="db_user" required>
    <label>Database password</label>
    <input type="password" name="db_pass">
    <label>Admin token (min. 12 chars)</label>
    <input name="admin_token" required minlength="12">
    <label>Cron key (for cron.php?key=…)</label>
    <input name="cron_key" required minlength="12">
    <label>Page name</label>
    <input name="page_name" value="rumahl Status">
    <label>Page URL</label>
    <input name="page_url" value="https://status.rumahl.com">
    <label>Timezone</label>
    <input name="timezone" value="Europe/Berlin">
    <label>From email</label>
    <input name="from_email" value="status@rumahl.com">
    <button type="submit">Install</button>
  </form>
  <?php endif; ?>
</div>
</body>
</html>
