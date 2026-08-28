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
 *  v7  component_status gains the 'maintenance' status (checks paused
 *      while a maintenance window covers the component)
 *  v8  monitoring platform entities (hosts, agents, services, checks,
 *      metrics, alerts and independently routed status pages)
 *  v9  per-page domain/path routing switches and failure diagnostics
 *  v10 per-page custom stylesheet URL
 *  v11 uploaded light/dark logos and inline custom CSS
 *  v12 independent mobile logos and text-only header branding
 *  v13 per-status-page group behavior, service visibility and history range
 *  v14 configurable tenant header, navigation, footer and footer links
 *  v15 per-status-page visibility of disabled monitoring components
 *  v16 per-status-page languages and translated public content
 *  v17 persisted monitor check history and SMTP monitor support
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
        'v7' => [
            ['component_status', 'status', "ENUM('operational','degraded','partial_outage','major_outage','maintenance') NOT NULL DEFAULT 'operational'", 'modify'],
        ],
        'v8' => [
            ['incidents', 'description', 'TEXT NULL'],
            ['incidents', 'internal_notes', 'TEXT NULL'],
            ['incidents', 'root_cause', 'TEXT NULL'],
            ['incidents', 'assigned_user', 'VARCHAR(150) NULL'],
            ['incidents', 'public_visible', 'TINYINT(1) NOT NULL DEFAULT 1'],
            ['incident_updates', 'visibility', "ENUM('public','internal') NOT NULL DEFAULT 'public'"],
            ['incident_updates', 'author', 'VARCHAR(150) NULL'],
        ],
        'v9' => [
            ['status_pages', 'path_enabled', 'TINYINT(1) NOT NULL DEFAULT 1'],
            ['status_pages', 'domain_enabled', 'TINYINT(1) NOT NULL DEFAULT 1'],
            ['check_results', 'diagnostic_json', 'LONGTEXT NULL'],
            ['check_results', 'screenshot_url', 'VARCHAR(1000) NULL'],
        ],
        'v10' => [
            ['status_pages', 'custom_css_url', 'VARCHAR(1000) NULL'],
        ],
        'v11' => [
            ['status_pages', 'logo_dark_url', 'VARCHAR(500) NULL'],
            ['status_pages', 'logo_mode', "VARCHAR(20) NOT NULL DEFAULT 'same'"],
            ['status_pages', 'custom_css', 'MEDIUMTEXT NULL'],
        ],
        'v12' => [
            ['status_pages', 'mobile_logo_url', 'VARCHAR(500) NULL'],
            ['status_pages', 'mobile_logo_dark_url', 'VARCHAR(500) NULL'],
            ['status_pages', 'header_brand_mode', "VARCHAR(20) NOT NULL DEFAULT 'logo'"],
        ],
        'v13' => [
            ['status_page_groups', 'collapsed', 'TINYINT(1) NOT NULL DEFAULT 0'],
            ['status_page_groups', 'auto_expand', 'TINYINT(1) NOT NULL DEFAULT 1'],
            ['status_page_services', 'enabled', 'TINYINT(1) NOT NULL DEFAULT 1'],
            ['status_page_services', 'history_days', 'INT NOT NULL DEFAULT 90'],
        ],
        'v14' => [
            ['status_pages', 'header_config', 'JSON NULL'],
            ['status_pages', 'nav_links', 'JSON NULL'],
            ['status_pages', 'footer_config', 'JSON NULL'],
            ['status_pages', 'footer_links', 'JSON NULL'],
        ],
        'v15' => [
            ['status_pages', 'show_disabled_components', 'TINYINT(1) NOT NULL DEFAULT 1'],
        ],
        'v16' => [
            ['status_pages', 'default_language', "VARCHAR(10) NOT NULL DEFAULT 'en'"],
            ['status_pages', 'enabled_locales', 'JSON NULL'],
            ['status_pages', 'translations', 'JSON NULL'],
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
            if (!isset($existing[$table . '.id']) && $table === 'status_pages') {
                // v8 creates this table below on fresh installations.
                continue;
            }
            if (($table === 'status_page_groups' && !isset($existing['status_page_groups.id']))
                || ($table === 'status_page_services' && !isset($existing['status_page_services.status_page_id']))) {
                // v8 creates these tables below on fresh installations.
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

    $monitoringSchemaExists = (int) $pdo->query(
        "SELECT COUNT(*) FROM information_schema.TABLES
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN
          ('monitoring_hosts','monitoring_agents','monitoring_services','monitoring_service_hosts',
           'monitoring_service_dependencies','monitor_checks','monitoring_metrics','monitoring_alerts',
           'status_pages','status_page_domains','status_page_groups','status_page_services','status_page_incidents')"
    )->fetchColumn() === 13;
    if (!$monitoringSchemaExists) {
        $sql = file_get_contents(__DIR__ . '/../migrations/008_monitoring_platform.sql');
        if ($sql === false) {
            throw new RuntimeException('Unable to read monitoring platform migration');
        }
        $statements = preg_split('/\n(?=(?:CREATE TABLE|INSERT IGNORE)\b)/', trim($sql)) ?: [];
        try {
            foreach ($statements as $statement) {
                if (trim($statement) !== '') {
                    $pdo->exec($statement);
                }
            }
            $stmt = $pdo->prepare(
                "INSERT INTO settings (skey, svalue) VALUES ('schema_version', 'v8')
                 ON DUPLICATE KEY UPDATE svalue = VALUES(svalue)"
            );
            $stmt->execute();
            if (!in_array('v8', $applied, true)) {
                $applied[] = 'v8';
            }
        } catch (Throwable $e) {
            throw $e;
        }
    }
    $monitorCheckType = strtolower((string) $pdo->query(
        "SELECT COLUMN_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='monitor_checks' AND COLUMN_NAME='check_type'"
    )->fetchColumn());
    if (!str_contains($monitorCheckType, "'smtp'")) {
        $pdo->exec("ALTER TABLE `monitor_checks` MODIFY COLUMN `check_type` ENUM('http','tcp','icmp','dns','tls','smtp','custom') NOT NULL DEFAULT 'http'");
        if (!in_array('v17', $applied, true)) {
            $applied[] = 'v17';
        }
    }
    $monitorHistoryExists = (int) $pdo->query(
        "SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='monitoring_check_results'"
    )->fetchColumn() === 1;
    if (!$monitorHistoryExists) {
        $sql = file_get_contents(__DIR__ . '/../migrations/017_monitor_check_history.sql');
        if ($sql === false) {
            throw new RuntimeException('Unable to read monitor history migration');
        }
        $pdo->exec($sql);
        if (!in_array('v17', $applied, true)) {
            $applied[] = 'v17';
        }
    }
    foreach ([
        'path_enabled' => 'TINYINT(1) NOT NULL DEFAULT 1',
        'domain_enabled' => 'TINYINT(1) NOT NULL DEFAULT 1',
        'custom_css_url' => 'VARCHAR(1000) NULL',
        'logo_dark_url' => 'VARCHAR(500) NULL',
        'logo_mode' => "VARCHAR(20) NOT NULL DEFAULT 'same'",
        'custom_css' => 'MEDIUMTEXT NULL',
        'mobile_logo_url' => 'VARCHAR(500) NULL',
        'mobile_logo_dark_url' => 'VARCHAR(500) NULL',
        'header_brand_mode' => "VARCHAR(20) NOT NULL DEFAULT 'logo'",
        'header_config' => 'JSON NULL',
        'nav_links' => 'JSON NULL',
        'footer_config' => 'JSON NULL',
        'footer_links' => 'JSON NULL',
        'show_disabled_components' => 'TINYINT(1) NOT NULL DEFAULT 1',
        'default_language' => "VARCHAR(10) NOT NULL DEFAULT 'en'",
        'enabled_locales' => 'JSON NULL',
        'translations' => 'JSON NULL',
    ] as $column => $definition) {
        $stmt = $pdo->prepare(
            "SELECT COUNT(*) FROM information_schema.COLUMNS
              WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='status_pages' AND COLUMN_NAME=?"
        );
        $stmt->execute([$column]);
        if ((int) $stmt->fetchColumn() === 0) {
            $pdo->exec("ALTER TABLE `status_pages` ADD COLUMN `{$column}` {$definition}");
            if (!in_array('v9', $applied, true)) {
                $applied[] = 'v9';
            }
        }
    }
    foreach ([
        'status_page_groups' => [
            'collapsed' => 'TINYINT(1) NOT NULL DEFAULT 0',
            'auto_expand' => 'TINYINT(1) NOT NULL DEFAULT 1',
        ],
        'status_page_services' => [
            'enabled' => 'TINYINT(1) NOT NULL DEFAULT 1',
            'history_days' => 'INT NOT NULL DEFAULT 90',
        ],
    ] as $table => $columns) {
        foreach ($columns as $column => $definition) {
            $stmt = $pdo->prepare(
                'SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLUMN_NAME=?'
            );
            $stmt->execute([$table, $column]);
            if ((int) $stmt->fetchColumn() === 0) {
                $pdo->exec("ALTER TABLE `{$table}` ADD COLUMN `{$column}` {$definition}");
                if (!in_array('v13', $applied, true)) {
                    $applied[] = 'v13';
                }
            }
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
