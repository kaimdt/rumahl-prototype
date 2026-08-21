<?php
/**
 * Dev router for `php -S` — mirrors the production layout where the
 * static site lives in the docroot and the API under /api/:
 *
 *   cd backend && php -S 127.0.0.1:8088 dev-router.php
 *
 * Real files (cron.php, install.php) are served directly; everything
 * else goes to the API front controller.
 */
$path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
if ($path === '/') {
    // Root: prefer a static index.html (production layout), then index.php.
    if (is_file(__DIR__ . '/index.html') || is_file(__DIR__ . '/index.php')) {
        return false;
    }
} else {
    $full = __DIR__ . $path;
    // Serve real files directly; directories are served by the built-in
    // server's index handling (index.html for static pages).
    if (is_file($full)) {
        return false;
    }
    if (is_dir($full) && is_file(rtrim($full, '/\\') . '/index.html')) {
        return false;
    }
}
require __DIR__ . '/api/index.php';
