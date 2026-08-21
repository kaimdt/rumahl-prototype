<?php
/**
 * Dev router for `php -S` — serves real files (cron.php, install.php)
 * and falls back to the API front controller for everything else:
 *
 *   php -S 127.0.0.1:8088 api/router.php
 */
$path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
if ($path !== '/' && is_file(__DIR__ . $path)) {
    return false; // let the built-in server serve the file
}
require __DIR__ . '/index.php';
