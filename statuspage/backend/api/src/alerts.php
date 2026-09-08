<?php
/**
 * Alerts — sends pending alert_log entries via PHP mail() and webhooks
 * (Discord / Slack / generic). Called at the end of each monitor cycle.
 */

declare(strict_types=1);

require_once __DIR__ . '/helpers.php';

function process_alerts(): int
{
    $pending = db_all(
        "SELECT * FROM alert_log WHERE status = 'pending' ORDER BY id ASC LIMIT 50"
    );
    $sent = 0;

    foreach ($pending as $alert) {
        $ok = $alert['channel'] === 'email'
            ? send_email_alert($alert)
            : send_webhook_alert($alert);

        db_exec(
            'UPDATE alert_log SET status = ?, attempts = attempts + 1, sent_at = ?
              WHERE id = ?',
            [$ok ? 'sent' : 'failed', $ok ? now_utc() : null, $alert['id']]
        );
        if ($ok) {
            $sent++;
        }
    }

    return $sent;
}

/**
 * Send an email via PHP mail(). Works on shared hosting with a local MTA
 * (the customer server ships one). Returns true on acceptance.
 */
function send_email_alert(array $alert): bool
{
    $settings = settings_get();
    $from = $settings['from_email'] !== '' ? $settings['from_email'] : 'status@rumahl.com';

    $headers = [
        'From: ' . $settings['page_name'] . ' <' . $from . '>',
        'Content-Type: text/plain; charset=utf-8',
        'MIME-Version: 1.0',
    ];
    $subject = '=?UTF-8?B?' . base64_encode($alert['subject']) . '?=';

    return @mail(
        $alert['recipient'],
        $subject,
        (string) $alert['body'],
        implode("\r\n", $headers)
    );
}

/**
 * Send a webhook notification. Discord and Slack use {content} / {text};
 * generic endpoints receive the full JSON payload.
 */
function send_webhook_alert(array $alert): bool
{
    $url = $alert['recipient'];
    if (!filter_var($url, FILTER_VALIDATE_URL)) {
        return false;
    }

    $payload = [
        'content' => $alert['subject'] . "\n\n" . $alert['body'],
        'text' => $alert['subject'] . "\n\n" . $alert['body'],
        'subject' => $alert['subject'],
        'body' => $alert['body'],
        'type' => $alert['type'],
        'sent_at' => now_utc() . ' UTC',
    ];

    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_POST => true,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT_MS => 10000,
        CURLOPT_HTTPHEADER => ['Content-Type: application/json'],
        CURLOPT_POSTFIELDS => json_encode($payload),
        CURLOPT_USERAGENT => 'rumahl-status-monitor/1.0',
    ]);
    curl_exec($ch);
    $status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    $error = curl_error($ch);
    curl_close($ch);

    return $error === '' && $status >= 200 && $status < 300;
}
