<?php
/**
 * Shared helpers — JSON responses, auth, settings access, time.
 */

declare(strict_types=1);

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/db.php';

date_default_timezone_set('UTC');

/** Send a JSON response and stop. */
function json_out(mixed $data, int $status = 200): never
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($data, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    exit;
}

function json_error(string $message, int $status = 400): never
{
    json_out(['error' => $message], $status);
}

/** RFC 4122 v4 UUID. */
function uuid4(): string
{
    $bytes = random_bytes(16);
    $bytes[6] = chr((ord($bytes[6]) & 0x0f) | 0x40);
    $bytes[8] = chr((ord($bytes[8]) & 0x3f) | 0x80);
    return vsprintf('%s%s-%s-%s-%s-%s%s%s', str_split(bin2hex($bytes), 4));
}

/** UTC timestamp string (MySQL DATETIME format). */
function now_utc(): string
{
    return gmdate('Y-m-d H:i:s');
}

/** Convert a MySQL DATETIME to an ISO-8601 string with Z suffix. */
function iso(string $datetime): string
{
    return str_replace(' ', 'T', $datetime) . 'Z';
}

/** Read the JSON request body. */
function json_body(): array
{
    $raw = file_get_contents('php://input');
    $data = json_decode($raw === false ? '' : $raw, true);
    return is_array($data) ? $data : [];
}

/** Bearer token from the Authorization header. */
function bearer_token(): ?string
{
    $header = '';

    // FastCGI/CLI: Apache passes the header through SetEnvIf (.htaccess).
    if (isset($_SERVER['HTTP_AUTHORIZATION'])) {
        $header = $_SERVER['HTTP_AUTHORIZATION'];
    } elseif (isset($_SERVER['REDIRECT_HTTP_AUTHORIZATION'])) {
        // Apache RewriteRule env-flag fallback.
        $header = $_SERVER['REDIRECT_HTTP_AUTHORIZATION'];
    } elseif (isset($_SERVER['Authorization'])) {
        $header = $_SERVER['Authorization'];
    }

    // Fallbacks for SAPIs that do not populate $_SERVER at all
    // (PHP-FPM behind Apache: apache_request_headers()/getallheaders()).
    if ($header === '') {
        foreach (['apache_request_headers', 'getallheaders'] as $fn) {
            if (!function_exists($fn)) {
                continue;
            }
            $headers = $fn();
            if (!is_array($headers)) {
                continue;
            }
            foreach ($headers as $name => $value) {
                if (strcasecmp((string) $name, 'Authorization') === 0) {
                    $header = (string) $value;
                    break 2;
                }
            }
        }
    }

    if (preg_match('/^Bearer\s+(.+)$/i', $header, $m)) {
        return trim($m[1]);
    }
    return null;
}

/** Require a valid admin token. */
function require_admin(): void
{
    $config = statuspage_config();
    // Accept the token from the Bearer header or the X-Auth-Token header
    // (Apache does not strip custom headers, so X-Auth-Token works even
    // where the Authorization header is filtered for PHP-FPM/CGI).
    $token = bearer_token();
    if ($token === null) {
        $token = $_SERVER['HTTP_X_AUTH_TOKEN'] ?? null;
        if (is_string($token)) {
            $token = trim($token) !== '' ? trim($token) : null;
        }
    }
    if ($config['admin_token'] === '') {
        json_error('Admin token is not configured', 401);
    }
    if ($token === null || !hash_equals($config['admin_token'], $token)) {
        json_error('Unauthorized', 401);
    }
}

/* ── Settings ─────────────────────────────────────────────────────── */

function settings_get(): array
{
    $config = statuspage_config();
    $defaults = $config['defaults'];

    $rows = db_all('SELECT skey, svalue FROM settings');
    $stored = [];
    foreach ($rows as $row) {
        $stored[$row['skey']] = $row['svalue'];
    }

    return [
        'page_name' => (string) ($stored['page_name'] ?? $defaults['page_name']),
        'page_url' => (string) ($stored['page_url'] ?? $defaults['page_url']),
        'timezone' => (string) ($stored['timezone'] ?? $defaults['timezone']),
        'from_email' => (string) ($stored['from_email'] ?? $defaults['from_email']),
        'alert_emails' => list_value($stored['alert_emails'] ?? $defaults['alert_emails']),
        'webhook_urls' => list_value($stored['webhook_urls'] ?? $defaults['webhook_urls']),
        'latency_threshold_ms' => (int) ($stored['latency_threshold_ms'] ?? $defaults['latency_threshold_ms']),
        'failure_window' => (int) ($stored['failure_window'] ?? $defaults['failure_window']),
        'auto_incidents_enabled' => (int) ($stored['auto_incidents_enabled'] ?? $defaults['auto_incidents_enabled']),
    ];
}

function settings_save(array $settings): void
{
    $pairs = [
        'page_name' => (string) ($settings['page_name'] ?? ''),
        'page_url' => (string) ($settings['page_url'] ?? ''),
        'timezone' => (string) ($settings['timezone'] ?? 'UTC'),
        'from_email' => (string) ($settings['from_email'] ?? ''),
        'alert_emails' => json_encode(array_values(array_filter(array_map('trim', $settings['alert_emails'] ?? [])))),
        'webhook_urls' => json_encode(array_values(array_filter(array_map('trim', $settings['webhook_urls'] ?? [])))),
        'latency_threshold_ms' => max(100, (int) ($settings['latency_threshold_ms'] ?? 3000)),
        'failure_window' => max(1, min(30, (int) ($settings['failure_window'] ?? 5))),
        'auto_incidents_enabled' => isset($settings['auto_incidents_enabled'])
            ? ((int) $settings['auto_incidents_enabled'] ? 1 : 0)
            : 1,
    ];
    foreach ($pairs as $key => $value) {
        db_exec(
            'INSERT INTO settings (skey, svalue) VALUES (?, ?)
             ON DUPLICATE KEY UPDATE svalue = VALUES(svalue)',
            [$key, $value]
        );
    }
}

/** Parse a stored setting that is either a JSON array or a comma list. */
function list_value(mixed $raw): array
{
    if (is_array($raw)) {
        return array_values(array_filter(array_map('trim', $raw)));
    }
    $decoded = json_decode((string) $raw, true);
    if (is_array($decoded)) {
        return array_values(array_filter(array_map('trim', $decoded)));
    }
    return array_values(array_filter(array_map('trim', explode(',', (string) $raw))));
}
