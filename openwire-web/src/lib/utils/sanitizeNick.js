export function sanitizeNick(raw, fallback = 'Anonymous') {
    return (raw || '').trim().replace(/[\x00-\x1f\x7f]/g, '').slice(0, 24) || fallback;
}
