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
    ];
}

/**
 * Apply all missing migrations. Returns the versions that were applied
 * (empty when the schema is already up to date).
 */
function db_migrate(PDO $pdo): array
{
    $existing = [];
    foreach ($pdo->query(
        "SELECT TABLE_NAME, COLUMN_NAME FROM information_schema.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE()"
    )->fetchAll(PDO::FETCH_ASSOC) as $row) {
        $existing[strtolower((string) $row['TABLE_NAME']) . '.' . strtolower((string) $row['COLUMN_NAME'])] = true;
    }

    $applied = [];
    foreach (schema_migrations() as $version => $additions) {
        $changed = false;
        foreach ($additions as [$table, $column, $definition]) {
            if (isset($existing[$table . '.' . $column])) {
                continue;
            }
            $pdo->exec("ALTER TABLE `{$table}` ADD COLUMN `{$column}` {$definition}");
            $existing[$table . '.' . $column] = true;
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
