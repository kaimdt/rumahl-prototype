<?php
/**
 * PDO connection + tiny query helpers.
 * Pass false to skip the automatic schema migration (used by upgrade.php,
 * which wants to report exactly what it migrated).
 */

declare(strict_types=1);

function db(bool $ensureSchema = true): PDO
{
    static $pdo = null;
    if ($pdo instanceof PDO) {
        return $pdo;
    }

    $config = statuspage_config();

    $dsn = sprintf(
        'mysql:host=%s;port=%d;dbname=%s;charset=utf8mb4',
        $config['db']['host'],
        $config['db']['port'],
        $config['db']['name']
    );

    $pdo = new PDO($dsn, $config['db']['user'], $config['db']['pass'], [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES => false,
    ]);

    if ($ensureSchema) {
        db_ensure_schema($pdo);
    }
    return $pdo;
}

/**
 * Versioned schema migrations (additive only — they never drop or alter
 * existing columns, so upgrading never touches your data).
 *
 *  v1  initial install (schema.sql)
 *  v2  check_type/headers on components, softfail on check_results,
 *      incidents.source (auto incidents)
 *  v3  collapsed/auto_expand on component_groups
 *  v4  per-component display config: view_mode (compact/bars/extended),
 *      history_days (0 = no history) on components
 *  v5  latency phases (dns/connect/tls/server) on check_results and a
 *      per-component latency threshold override on components
 *  v6  check_type extended: dns, ssl (certificate expiry), smtp
 */
function schema_migrations(): array
{
    return [
        'v2' => [
            ['components', 'check_type', "ENUM('http','tcp','ping') NOT NULL DEFAULT 'http'"],
            ['components', 'headers', 'TEXT NULL'],
            ['check_results', 'softfail', 'TINYINT(1) NOT NULL DEFAULT 0'],
            ['incidents', 'source', "VARCHAR(10) NOT NULL DEFAULT 'manual'"],
        ],
        'v3' => [
            ['component_groups', 'collapsed', 'TINYINT(1) NOT NULL DEFAULT 0'],
            ['component_groups', 'auto_expand', 'TINYINT(1) NOT NULL DEFAULT 1'],
        ],
        'v4' => [
            ['components', 'view_mode', "VARCHAR(10) NOT NULL DEFAULT 'compact'"],
            ['components', 'history_days', 'INT NOT NULL DEFAULT 90'],
        ],
        'v5' => [
            ['check_results', 'dns_ms', 'INT NULL'],
            ['check_results', 'connect_ms', 'INT NULL'],
            ['check_results', 'tls_ms', 'INT NULL'],
            ['check_results', 'server_ms', 'INT NULL'],
            ['components', 'latency_threshold_ms', 'INT NOT NULL DEFAULT 0'],
        ],
        'v6' => [
            // modify: idempotent — runs only while an enum value is missing
            ['components', 'check_type', "ENUM('http','tcp','ping','dns','ssl','smtp') NOT NULL DEFAULT 'http'", 'modify'],
        ],
    ];
}

/**
 * Apply all missing migrations. Returns the versions that were applied
 * (empty when the schema is already up to date).
 * Migration format: [table, column, definition] or
 * [table, column, definition, 'modify'] for ALTER … MODIFY COLUMN
 * (idempotent: runs only while one of the enum values is missing).
 */
function db_migrate(PDO $pdo): array
{
    $existing = [];
    $types = [];
    foreach ($pdo->query(
        "SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE FROM information_schema.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE()"
    )->fetchAll(PDO::FETCH_ASSOC) as $row) {
        $key = strtolower((string) $row['TABLE_NAME']) . '.' . strtolower((string) $row['COLUMN_NAME']);
        $existing[$key] = true;
        $types[$key] = strtolower((string) $row['COLUMN_TYPE']);
    }

    $applied = [];
    foreach (schema_migrations() as $version => $migrations) {
        $changed = false;
        foreach ($migrations as $migration) {
            [$table, $column, $definition] = $migration;
            $mode = $migration[3] ?? 'add';
            $key = $table . '.' . $column;

            if ($mode === 'modify') {
                $current = $types[$key] ?? '';
                $needsModify = $current === '';
                if (!$needsModify && preg_match_all("/'([^']+)'/", $definition, $m)) {
                    foreach ($m[1] as $value) {
                        if (!str_contains($current, "'" . strtolower($value) . "'")) {
                            $needsModify = true;
                            break;
                        }
                    }
                }
                if ($needsModify) {
                    $pdo->exec("ALTER TABLE `{$table}` MODIFY COLUMN `{$column}` {$definition}");
                    $types[$key] = strtolower($definition);
                    $changed = true;
                }
                continue;
            }

            if (isset($existing[$key])) {
                continue;
            }
            $pdo->exec("ALTER TABLE `{$table}` ADD COLUMN `{$column}` {$definition}");
            $existing[$key] = true;
            $changed = true;
        }
        if ($changed) {
            $applied[] = $version;
        }
    }
    return $applied;
}

/**
 * Idempotent schema migration — keeps existing installations up to date
 * after an update (schema.sql is only the baseline for new installs).
 * Runs once per process after the connection is opened.
 */
function db_ensure_schema(PDO $pdo): void
{
    static $done = false;
    if ($done) {
        return;
    }
    $done = true;
    db_migrate($pdo);
}

/** SELECT … LIMIT 1 → row or null */
function db_row(string $sql, array $params = []): ?array
{
    $stmt = db()->prepare($sql);
    $stmt->execute($params);
    $row = $stmt->fetch();
    return $row === false ? null : $row;
}

/** SELECT → all rows */
function db_all(string $sql, array $params = []): array
{
    $stmt = db()->prepare($sql);
    $stmt->execute($params);
    return $stmt->fetchAll();
}

/** INSERT / UPDATE / DELETE → affected rows */
function db_exec(string $sql, array $params = []): int
{
    $stmt = db()->prepare($sql);
    $stmt->execute($params);
    return $stmt->rowCount();
}
