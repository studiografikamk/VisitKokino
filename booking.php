<?php
/**
 * visitkokino.com — booking / enquiry handler
 *
 * The only server-side code on the site. It accepts one POST from the booking
 * form on contact.html, validates it strictly, and emails it on. It reads no
 * database, writes no user files, executes nothing, and echoes back nothing a
 * visitor supplied.
 *
 * Threat notes:
 *  - Email header injection: every header value is either a fixed constant or
 *    an address that passed FILTER_VALIDATE_EMAIL *and* a CR/LF check.
 *  - Spam: honeypot field + per-IP rate limit + same-origin check.
 *  - XSS: nothing from the request is ever rendered back to the browser.
 *  - Mail body is text/plain, so nothing in it is interpreted as markup.
 */

declare(strict_types=1);

// ---------------------------------------------------------------- settings --
const MAIL_FROM     = 'info@visitkokino.com';
const MAIL_FROM_NAME = 'Visit Kokino';
// Single destination. Forwarding to personal addresses is configured in cPanel,
// which keeps deliverability (SPF/DKIM) on one domain instead of two providers.
const MAIL_TO       = ['info@visitkokino.com'];
const SITE_HOST     = 'visitkokino.com';
const REDIRECT_OK   = '/contact.html?sent=1#booking';
const REDIRECT_BAD  = '/contact.html?sent=0#booking';
const RATE_MAX      = 5;     // submissions ...
const RATE_WINDOW   = 3600;  // ... per this many seconds, per IP
const MAX_FIELD     = 2000;

// ------------------------------------------------------------- no indexing --
header('X-Robots-Tag: noindex, nofollow', true);
header('Referrer-Policy: strict-origin-when-cross-origin', true);
header('X-Content-Type-Options: nosniff', true);

// ------------------------------------------------------------------ helpers --

function wants_json(): bool {
    $a = $_SERVER['HTTP_ACCEPT'] ?? '';
    $x = $_SERVER['HTTP_X_REQUESTED_WITH'] ?? '';
    return str_contains($a, 'application/json') || $x === 'fetch';
}

// No `never` return type: that needs PHP 8.1, and this way the file runs on 8.0 too.
function finish(bool $ok, string $message, int $status = 200) {
    if (wants_json()) {
        http_response_code($status);
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode(['ok' => $ok, 'message' => $message], JSON_UNESCAPED_UNICODE);
    } else {
        http_response_code($ok ? 303 : 303);
        header('Location: ' . ($ok ? REDIRECT_OK : REDIRECT_BAD));
    }
    exit;
}

/** Collapse whitespace, strip control characters, hard-limit length. */
function clean(string $key, int $limit = 300): string {
    $v = $_POST[$key] ?? '';
    if (!is_string($v)) return '';
    $v = substr($v, 0, MAX_FIELD);
    $v = preg_replace('/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/u', '', $v) ?? '';
    $v = trim($v);
    return mb_substr($v, 0, $limit, 'UTF-8');
}

/** Any value that reaches a mail header must not be able to start a new one. */
function header_safe(string $v): bool {
    return !preg_match('/[\r\n]/', $v);
}

function client_ip(): string {
    return (string)($_SERVER['REMOTE_ADDR'] ?? '0.0.0.0');
}

/** Simple file-based throttle. Keyed by hashed IP so no raw IP is stored. */
function rate_limited(): bool {
    $file = sys_get_temp_dir() . '/vk_rate_' . hash('sha256', client_ip()) . '.txt';
    $now  = time();
    $hits = [];
    if (is_readable($file)) {
        $raw  = (string)file_get_contents($file);
        $hits = array_filter(
            array_map('intval', explode(',', $raw)),
            static fn(int $t): bool => $t > $now - RATE_WINDOW
        );
    }
    if (count($hits) >= RATE_MAX) return true;
    $hits[] = $now;
    @file_put_contents($file, implode(',', $hits), LOCK_EX);
    return false;
}

// ------------------------------------------------------------------- gate 1 --
// Method
if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    finish(false, 'Method not allowed.', 405);
}

// ------------------------------------------------------------------- gate 2 --
// Same-origin: the form is on our own page, so a cross-site POST is not ours.
$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
$ref    = $_SERVER['HTTP_REFERER'] ?? '';
$source = $origin !== '' ? $origin : $ref;
if ($source !== '') {
    $host = parse_url($source, PHP_URL_HOST) ?: '';
    if ($host !== SITE_HOST && $host !== 'www.' . SITE_HOST) {
        finish(false, 'Request blocked.', 403);
    }
}

// ------------------------------------------------------------------- gate 3 --
// Honeypot. Real people never see this field, so anything in it is a bot.
// Answer normally so the bot has no signal to learn from.
if (clean('company') !== '') {
    finish(true, 'Thank you — your enquiry has been sent.');
}

// ------------------------------------------------------------------- gate 4 --
if (rate_limited()) {
    finish(false, 'Too many enquiries from this connection. Please try again later, or email us directly.', 429);
}

// ----------------------------------------------------------------- collect --
$name     = clean('name', 120);
$email    = clean('email', 190);
$phone    = clean('phone', 60);
$date     = clean('date', 30);
$people   = clean('people', 20);
$lunch    = clean('lunch', 40);
$pickup   = clean('pickup', 300);
$message  = clean('message', 2000);

// ---------------------------------------------------------------- validate --
$errors = [];

if ($name === '' || mb_strlen($name) < 2)                      $errors[] = 'name';
if ($email === '' || !filter_var($email, FILTER_VALIDATE_EMAIL)
    || !header_safe($email))                                   $errors[] = 'email';
if ($message === '' && $pickup === '' && $date === '')         $errors[] = 'message';
if ($date !== '' && !preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) $errors[] = 'date';
if ($people !== '' && !preg_match('/^[1-4]$/', $people))         $errors[] = 'people';
if (!in_array($lunch, ['', 'yes', 'no', 'undecided'], true))     $errors[] = 'lunch';

if ($errors) {
    finish(false, 'Please check the highlighted fields and try again.', 422);
}

// -------------------------------------------------------------- build mail --
$lunchLabel = match ($lunch) {
    'yes'       => 'Yes, include the lunch (+40 EUR per person)',
    'no'        => 'No lunch',
    'undecided' => 'Undecided',
    default     => 'Not specified',
};

$lines = [
    'New booking enquiry from visitkokino.com',
    str_repeat('=', 44),
    '',
    'Name:            ' . $name,
    'Email:           ' . $email,
    'Phone / WhatsApp:' . ' ' . ($phone !== '' ? $phone : '-'),
    '',
    'Preferred date:  ' . ($date !== '' ? $date : 'not specified'),
    'Travellers:      ' . ($people !== '' ? $people : 'not specified'),
    'Lunch option:    ' . $lunchLabel,
    'Pickup address:  ' . ($pickup !== '' ? $pickup : 'not specified'),
    '',
    'Message',
    str_repeat('-', 44),
    $message !== '' ? $message : '(none)',
    '',
    str_repeat('-', 44),
    'Sent:  ' . gmdate('Y-m-d H:i:s') . ' UTC',
    'Page:  ' . (header_safe($ref) ? substr($ref, 0, 200) : ''),
];

$body = implode("\r\n", $lines);
$body = wordwrap($body, 78, "\r\n", false);

// Subject must be header-safe; encode so non-ASCII names survive.
$subjectRaw = 'Kokino booking enquiry — ' . $name;
$subject    = '=?UTF-8?B?' . base64_encode($subjectRaw) . '?=';

$headers = [
    'From: ' . MAIL_FROM_NAME . ' <' . MAIL_FROM . '>',
    'Reply-To: ' . $email,           // validated above, CR/LF-free
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: 8bit',
    'X-Mailer: visitkokino-form',
    'Auto-Submitted: auto-generated',
];

foreach ($headers as $h) {
    if (!header_safe($h)) finish(false, 'Could not send the enquiry.', 400);
}

// ------------------------------------------------------------------- send ---
$sent = false;
foreach (MAIL_TO as $to) {
    if (!filter_var($to, FILTER_VALIDATE_EMAIL)) continue;
    $ok = @mail($to, $subject, $body, implode("\r\n", $headers), '-f' . MAIL_FROM);
    $sent = $sent || $ok;
}

if (!$sent) {
    finish(false, 'We could not send your enquiry just now. Please email info@visitkokino.com or message us on WhatsApp.', 500);
}

finish(true, 'Thank you — your enquiry is on its way. We usually reply within a few hours.');
