<?php
/**
 * PDO connection + tiny query helpers.
 */

declare(strict_types=1);

function db(): PDO
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

    db_ensure_schema($pdo);
    return $pdo;
}

/**
 * Idempotent schema migration — adds columns introduced after the initial
 * install (schema.sql is the baseline, this keeps existing installations
 * up to date). Runs once per process after the connection is opened.
 */
function db_ensure_schema(PDO $pdo): void
{
    static $done = false;
    if ($done) {
        return;
    }
    $done = true;

    $existing = [];
    foreach ($pdo->query(
        "SELECT TABLE_NAME, COLUMN_NAME FROM information_schema.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE()"
    )->fetchAll(PDO::FETCH_ASSOC) as $row) {
        $existing[strtolower((string) $row['TABLE_NAME']) . '.' . strtolower((string) $row['COLUMN_NAME'])] = true;
    }

    $additions = [
        ['components', 'check_type', "ENUM('http','tcp','ping') NOT NULL DEFAULT 'http'"],
        ['components', 'headers', 'TEXT NULL'],
        ['check_results', 'softfail', 'TINYINT(1) NOT NULL DEFAULT 0'],
        ['incidents', 'source', "VARCHAR(10) NOT NULL DEFAULT 'manual'"],
    ];
    foreach ($additions as [$table, $column, $definition]) {
        if (isset($existing[$table . '.' . $column])) {
            continue;
        }
        $pdo->exec("ALTER TABLE `{$table}` ADD COLUMN `{$column}` {$definition}");
    }
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
