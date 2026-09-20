<?php
/**
 * visitkokino.com — booking / enquiry handler
 *
 * The only server-side code on the site. It serves a signed maths challenge on
 * GET, and accepts one POST from the booking form on contact.html. It reads no
 * database, writes no user files, executes nothing, and echoes back nothing a
 * visitor supplied.
 *
 * Threat notes:
 *  - Email header injection: every header value is either a fixed constant or
 *    an address that passed FILTER_VALIDATE_EMAIL *and* a CR/LF check.
 *  - Spam: honeypot + per-IP rate limit + same-origin check + an HMAC-signed
 *    maths challenge. The answer is never placed in the token -- the signature
 *    is an HMAC *over* the answer -- so it cannot be recovered from the token,
 *    nor brute forced offline without the signing key.
 *  - XSS: nothing from the request is ever rendered back to the browser.
 *  - Mail body is text/plain, so nothing in it is interpreted as markup.
 */

declare(strict_types=1);

// ---------------------------------------------------------------- settings --
const MAIL_FROM      = 'info@visitkokino.com';
const MAIL_FROM_NAME = 'Visit Kokino';
// Single destination. Forwarding to personal addresses is configured in cPanel,
// which keeps deliverability (SPF/DKIM) on one domain instead of two providers.
const MAIL_TO        = ['info@visitkokino.com'];
const SITE_HOST      = 'visitkokino.com';
const REDIRECT_OK    = '/contact.html?sent=1#booking';
const REDIRECT_BAD   = '/contact.html?sent=0#booking';
const RATE_MAX       = 5;     // submissions ...
const RATE_WINDOW    = 3600;  // ... per this many seconds, per IP
const MAX_FIELD      = 2000;
const CHALLENGE_TTL  = 1800;  // a maths challenge is valid for 30 minutes

// Pricing, so the enquiry email can say exactly what to charge.
const TOUR_PRICE   = 119;  // EUR, flat for the vehicle, not per person
const TOUR_MAX_PAX = 3;    // the flat price covers up to this many travellers
const LUNCH_PRICE  = 40;   // EUR per person, optional, at Etno Selo Timcevski

// ------------------------------------------------------------- no indexing --
header('X-Robots-Tag: noindex, nofollow', true);
header('Referrer-Policy: strict-origin-when-cross-origin', true);
header('X-Content-Type-Options: nosniff', true);
header('Cache-Control: no-store, max-age=0', true);

// ------------------------------------------------------------------ helpers --

function wants_json(): bool {
    $a = $_SERVER['HTTP_ACCEPT'] ?? '';
    $x = $_SERVER['HTTP_X_REQUESTED_WITH'] ?? '';
    return str_contains($a, 'application/json') || $x === 'fetch';
}

function send_json(array $payload, int $status = 200) {
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($payload, JSON_UNESCAPED_UNICODE);
    exit;
}

/**
 * Which language to answer in. The form posts `lang`; the challenge endpoint
 * takes it as a query parameter. Anything unrecognised falls back to English.
 */
function lang(): string {
    $v = $_POST['lang'] ?? $_GET['lang'] ?? 'en';
    return (is_string($v) && strtolower($v) === 'mk') ? 'mk' : 'en';
}

/** Look up a response message in the visitor's language. */
function msg(string $key): string {
    static $m = [
        'blocked' => [
            'en' => 'Request blocked.',
            'mk' => 'Барањето е блокирано.',
        ],
        'thanks_quiet' => [
            'en' => 'Thank you — your enquiry has been sent.',
            'mk' => 'Ви благодариме — вашето барање е испратено.',
        ],
        'rate' => [
            'en' => 'Too many enquiries from this connection. Please try again later, or email us directly.',
            'mk' => 'Премногу барања од оваа врска. Обидете се подоцна или пишете ни директно.',
        ],
        'maths' => [
            'en' => 'The anti-spam answer was wrong or has expired. Please try the sum again.',
            'mk' => 'Одговорот на проверката против спам е погрешен или истечен. Обидете се повторно.',
        ],
        'fields' => [
            'en' => 'Please check the highlighted fields and try again.',
            'mk' => 'Проверете ги означените полиња и обидете се повторно.',
        ],
        'badheader' => [
            'en' => 'Could not send the enquiry.',
            'mk' => 'Барањето не можеше да се испрати.',
        ],
        'sendfail' => [
            'en' => 'We could not send your enquiry just now. Please email info@visitkokino.com or message us on WhatsApp.',
            'mk' => 'Во моментов не можевме да го испратиме вашето барање. Пишете на info@visitkokino.com или преку WhatsApp.',
        ],
        'sent' => [
            'en' => 'Thank you — your enquiry is on its way. We usually reply within a few hours.',
            'mk' => 'Ви благодариме — вашето барање е на пат. Обично одговараме во рок од неколку часа.',
        ],
    ];
    return $m[$key][lang()] ?? $m[$key]['en'];
}

// No `never` return type: that needs PHP 8.1, and this way the file runs on 8.0 too.
function finish(bool $ok, string $message, int $status = 200) {
    if (wants_json()) {
        send_json(['ok' => $ok, 'message' => $message], $status);
    }
    $base = lang() === 'mk' ? '/mk/contact.html' : '/contact.html';
    http_response_code(303);
    header('Location: ' . $base . ($ok ? '?sent=1#booking' : '?sent=0#booking'));
    exit;
}

/** Collapse whitespace, strip control characters, hard-limit length. */
function clean(string $key, int $limit = 300): string {
    $v = $_POST[$key] ?? '';
    if (!is_string($v)) return '';
    $v = substr($v, 0, MAX_FIELD);
    $v = preg_replace('/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/u', '', $v) ?? '';
    return mb_substr(trim($v), 0, $limit, 'UTF-8');
}

/** Any value that reaches a mail header must not be able to start a new one. */
function header_safe(string $v): bool {
    return !preg_match('/[\r\n]/', $v);
}

function client_ip(): string {
    return (string)($_SERVER['REMOTE_ADDR'] ?? '0.0.0.0');
}

/**
 * Signing key for the maths challenge.
 *
 * Deliberately kept OUTSIDE the document root and OUT of git: it is generated
 * on first use and lives one directory above the site. If the repository ever
 * leaked, the key would not leak with it.
 */
function secret_key(): string {
    $path = dirname(__DIR__) . '/.vk_form_secret';
    if (is_readable($path)) {
        $k = trim((string)file_get_contents($path));
        if (strlen($k) >= 32) return $k;
    }
    $k = bin2hex(random_bytes(32));
    @file_put_contents($path, $k, LOCK_EX);
    @chmod($path, 0600);
    return $k;
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

// ---------------------------------------------------------- maths challenge --

/** Numbers as words, so a naive "\d+ [+-] \d+" parser cannot just evaluate it. */
function number_word(int $n, string $lang): string {
    $en = [2 => 'two', 3 => 'three', 4 => 'four', 5 => 'five',
           6 => 'six', 7 => 'seven', 8 => 'eight', 9 => 'nine'];
    $mk = [2 => 'два', 3 => 'три', 4 => 'четири', 5 => 'пет',
           6 => 'шест', 7 => 'седум', 8 => 'осум', 9 => 'девет'];
    $t = $lang === 'mk' ? $mk : $en;
    return $t[$n] ?? (string)$n;
}

/**
 * Build a question plus a signed token.
 *
 * The answer is NOT in the payload. The signature IS the answer check: it is an
 * HMAC over the answer together with the nonce and expiry. Without the signing
 * key the answer cannot be recovered from the token, and it cannot be brute
 * forced offline either — only by submitting, which the rate limit caps at five
 * attempts an hour.
 */
function make_challenge(string $lang = 'en'): array {
    $a    = random_int(2, 9);
    $b    = random_int(2, 9);
    $plus = random_int(0, 1) === 1;

    if (!$plus && $b > $a) { [$a, $b] = [$b, $a]; }   // never negative
    $answer = $plus ? $a + $b : $a - $b;

    $expiry = time() + CHALLENGE_TTL;
    $nonce  = bin2hex(random_bytes(8));

    $payload = base64_encode(json_encode(
        ['e' => $expiry, 'n' => $nonce], JSON_THROW_ON_ERROR
    ));
    $sig = hash_hmac('sha256', $answer . '|' . $nonce . '|' . $expiry, secret_key());

    $word = $lang === 'mk' ? ($plus ? 'плус' : 'минус') : ($plus ? 'plus' : 'minus');

    return [
        'question' => number_word($a, $lang) . ' ' . $word . ' ' . number_word($b, $lang),
        'token'    => $payload . '.' . $sig,
    ];
}

/** @return bool true only if the token is authentic, unexpired and answered correctly. */
function challenge_ok(string $token, string $given): bool {
    if ($token === '' || $given === '') return false;
    if (!preg_match('/^-?\d{1,3}$/', $given)) return false;

    $parts = explode('.', $token);
    if (count($parts) !== 2) return false;
    [$payload, $sig] = $parts;

    $raw = base64_decode($payload, true);
    if ($raw === false) return false;

    try {
        $data = json_decode($raw, true, 8, JSON_THROW_ON_ERROR);
    } catch (Throwable $e) {
        return false;
    }

    if (!is_array($data) || !isset($data['e'], $data['n'])) return false;
    if (time() > (int)$data['e']) return false;                 // expired
    if (!preg_match('/^[a-f0-9]{16}$/', (string)$data['n'])) return false;

    // Recompute the signature from the ANSWER THE VISITOR GAVE. If it matches,
    // the answer is right, the token is ours, and the expiry is untampered --
    // all three in one comparison.
    $expected = hash_hmac(
        'sha256',
        (int)$given . '|' . $data['n'] . '|' . (int)$data['e'],
        secret_key()
    );

    return hash_equals($expected, $sig);
}

// ------------------------------------------------------------------- gate 1 --
// GET: either hand out a challenge, or refuse politely.
if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    if (isset($_GET['challenge'])) {
        send_json(make_challenge(lang()));
    }
    http_response_code(405);
    header('Content-Type: text/plain; charset=utf-8');
    header('Allow: POST');
    echo "This endpoint only accepts the booking form.\n";
    echo "Please use https://visitkokino.com/contact.html#booking\n";
    exit;
}

// ------------------------------------------------------------------- gate 2 --
// Same-origin: the form is on our own page, so a cross-site POST is not ours.
$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
$ref    = $_SERVER['HTTP_REFERER'] ?? '';
$source = $origin !== '' ? $origin : $ref;
if ($source !== '') {
    $host = parse_url($source, PHP_URL_HOST) ?: '';
    if ($host !== SITE_HOST && $host !== 'www.' . SITE_HOST) {
        finish(false, msg('blocked'), 403);
    }
}

// ------------------------------------------------------------------- gate 3 --
// Honeypot. Real people never see this field, so anything in it is a bot.
// Answer normally so the bot has no signal to learn from.
if (clean('company') !== '') {
    finish(true, msg('thanks_quiet'));
}

// ------------------------------------------------------------------- gate 4 --
if (rate_limited()) {
    finish(false, msg('rate'), 429);
}

// ------------------------------------------------------------------- gate 5 --
// Maths challenge.
if (!challenge_ok(clean('math_token', 400), clean('math_answer', 8))) {
    finish(false, msg('maths'), 422);
}

// ----------------------------------------------------------------- collect --
$name    = clean('name', 120);
$email   = clean('email', 190);
$phone   = clean('phone', 60);
$date    = clean('date', 30);
$people  = clean('people', 20);
$lunch   = clean('lunch', 40);
$pickup  = clean('pickup', 300);
$message = clean('message', 2000);

// ---------------------------------------------------------------- validate --
$errors = [];

if ($name === '' || mb_strlen($name) < 2)                        $errors[] = 'name';
if ($email === '' || !filter_var($email, FILTER_VALIDATE_EMAIL)
    || !header_safe($email))                                     $errors[] = 'email';
if ($message === '' && $pickup === '' && $date === '')           $errors[] = 'message';
if ($date !== '' && !preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) $errors[] = 'date';
if ($people !== '' && !preg_match('/^[1-4]$/', $people))          $errors[] = 'people';
if (!in_array($lunch, ['', 'yes', 'no', 'undecided'], true))      $errors[] = 'lunch';

if ($errors) {
    finish(false, msg('fields'), 422);
}

// -------------------------------------------------------------- build mail --
$lunchLabel = match ($lunch) {
    'yes'       => 'Yes, include the lunch (+' . LUNCH_PRICE . ' EUR per person)',
    'no'        => 'No lunch',
    'undecided' => 'Undecided',
    default     => 'Not specified',
};

/**
 * Work out what to charge, showing the arithmetic rather than only a total so
 * the figure can be checked at a glance.
 */
function price_lines(string $people, string $lunch): array {
    $pax = ctype_digit($people) ? (int)$people : 0;

    $row = static function (string $label, string $amount): string {
        return str_pad($label, 40) . str_pad($amount, 9, ' ', STR_PAD_LEFT);
    };

    $out   = ['PRICE', str_repeat('-', 49)];
    $out[] = $row('Tour (private, up to ' . TOUR_MAX_PAX . ' travellers)', TOUR_PRICE . ' EUR');

    $lunchTotal = $pax > 0 ? $pax * LUNCH_PRICE : 0;
    $sum        = $pax > 0 ? sprintf('%d x %d EUR', $pax, LUNCH_PRICE) : '';

    if ($lunch === 'yes') {
        if ($pax > 0) {
            $out[] = $row('Lunch at Etno Selo (' . $sum . ')', $lunchTotal . ' EUR');
            $out[] = str_repeat('-', 49);
            $out[] = $row('TOTAL TO CHARGE', (TOUR_PRICE + $lunchTotal) . ' EUR');
        } else {
            $out[] = $row('Lunch at Etno Selo', LUNCH_PRICE . ' EUR pp');
            $out[] = str_repeat('-', 49);
            $out[] = $row('TOTAL', TOUR_PRICE . ' EUR + lunch');
            $out[] = '  ** Travellers not given - ask, then add ' . LUNCH_PRICE . ' EUR per person.';
        }
    } elseif ($lunch === 'no') {
        $out[] = $row('Lunch', 'not taken');
        $out[] = str_repeat('-', 49);
        $out[] = $row('TOTAL TO CHARGE', TOUR_PRICE . ' EUR');
    } else {
        // undecided: give both figures so either answer is covered
        if ($pax > 0) {
            $out[] = $row('Lunch (undecided, ' . $sum . ')', $lunchTotal . ' EUR');
            $out[] = str_repeat('-', 49);
            $out[] = $row('TOTAL without lunch', TOUR_PRICE . ' EUR');
            $out[] = $row('TOTAL with lunch', (TOUR_PRICE + $lunchTotal) . ' EUR');
        } else {
            $out[] = $row('Lunch', 'undecided');
            $out[] = str_repeat('-', 49);
            $out[] = $row('TOTAL without lunch', TOUR_PRICE . ' EUR');
            $out[] = '  ** Travellers not given - lunch is ' . LUNCH_PRICE . ' EUR per person.';
        }
    }

    if ($pax > TOUR_MAX_PAX) {
        $out[] = '';
        $out[] = '  ** ' . $pax . ' travellers. The ' . TOUR_PRICE
                 . ' EUR price covers up to ' . TOUR_MAX_PAX . '.';
        $out[] = '     Check the vehicle and confirm the price before accepting.';
    }

    return $out;
}

$lines = [
    'New booking enquiry from visitkokino.com',
    str_repeat('=', 44),
    '',
    'Name:             ' . $name,
    'Email:            ' . $email,
    'Phone / WhatsApp: ' . ($phone !== '' ? $phone : '-'),
    '',
    'Preferred date:   ' . ($date !== '' ? $date : 'not specified'),
    'Travellers:       ' . ($people !== '' ? $people : 'not specified'),
    'Lunch option:     ' . $lunchLabel,
    'Pickup address:   ' . ($pickup !== '' ? $pickup : 'not specified'),
    '',
    '',
    ...price_lines($people, $lunch),
    '',
    'Message',
    str_repeat('-', 44),
    $message !== '' ? $message : '(none)',
    '',
    str_repeat('-', 44),
    'Sent:  ' . gmdate('Y-m-d H:i:s') . ' UTC',
    'Page:  ' . (header_safe($ref) ? substr($ref, 0, 200) : ''),
];

// No wordwrap: the price block is column-aligned and wrapping would break it.
$body = implode("\r\n", $lines);

// Subject must be header-safe; encode so non-ASCII names survive.
$subject = '=?UTF-8?B?' . base64_encode('Kokino booking enquiry — ' . $name) . '?=';

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
    if (!header_safe($h)) finish(false, msg('badheader'), 400);
}

// ------------------------------------------------------------------- send ---
$sent = false;
foreach (MAIL_TO as $to) {
    if (!filter_var($to, FILTER_VALIDATE_EMAIL)) continue;
    $ok = @mail($to, $subject, $body, implode("\r\n", $headers), '-f' . MAIL_FROM);
    $sent = $sent || $ok;
}

if (!$sent) {
    finish(false, msg('sendfail'), 500);
}

finish(true, msg('sent'));
