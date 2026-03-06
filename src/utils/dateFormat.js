// Timezone-aware date formatting utilities.
// All functions accept an IANA timezone string (e.g. 'America/Los_Angeles').
// If timezone is null/undefined, falls back to browser default.

function toDate(dateStr) {
    if (!dateStr) return null;
    // MySQL format: "YYYY-MM-DD HH:MM:SS" — stored as UTC, append Z
    if (typeof dateStr === 'string' && dateStr.includes(' ') && !dateStr.includes('T')) {
        return new Date(dateStr.replace(' ', 'T') + 'Z');
    }
    return new Date(dateStr);
}

export function formatDateTime(dateStr, timezone) {
    const d = toDate(dateStr);
    if (!d || isNaN(d)) return '—';
    const options = {
        year: 'numeric', month: 'short', day: 'numeric',
        hour: 'numeric', minute: '2-digit',
        ...(timezone && { timeZone: timezone }),
    };
    return d.toLocaleString(undefined, options);
}

export function formatDate(dateStr, timezone) {
    const d = toDate(dateStr);
    if (!d || isNaN(d)) return '—';
    const options = {
        year: 'numeric', month: 'short', day: 'numeric',
        ...(timezone && { timeZone: timezone }),
    };
    return d.toLocaleDateString(undefined, options);
}

export function formatDateWithOptions(dateStr, timezone, extraOptions) {
    const d = toDate(dateStr);
    if (!d || isNaN(d)) return '—';
    const options = {
        ...extraOptions,
        ...(timezone && { timeZone: timezone }),
    };
    return d.toLocaleDateString(undefined, options);
}

// Extract a YYYY-MM-DD date string in the given timezone (for calendar day placement)
export function toLocaleDateString(dateStr, timezone) {
    const d = toDate(dateStr);
    if (!d || isNaN(d)) return null;
    const options = {
        year: 'numeric', month: '2-digit', day: '2-digit',
        ...(timezone && { timeZone: timezone }),
    };
    // Intl gives locale-formatted; use formatToParts for reliable YYYY-MM-DD
    const parts = new Intl.DateTimeFormat('en-CA', options).formatToParts(d);
    const get = (type) => parts.find(p => p.type === type)?.value;
    return `${get('year')}-${get('month')}-${get('day')}`;
}

// One representative per major timezone, Americas first, then east across the globe.
const TIMEZONE_ENTRIES = [
    // Americas
    { value: 'Pacific/Honolulu',              label: 'Hawaii (HST)' },
    { value: 'America/Anchorage',             label: 'Alaska (AKST/AKDT)' },
    { value: 'America/Los_Angeles',           label: 'Pacific (PST/PDT)' },
    { value: 'America/Phoenix',               label: 'Arizona (MST, no DST)' },
    { value: 'America/Denver',                label: 'Mountain (MST/MDT)' },
    { value: 'America/Chicago',               label: 'Central (CST/CDT)' },
    { value: 'America/New_York',              label: 'Eastern (EST/EDT)' },
    { value: 'America/Halifax',               label: 'Atlantic (AST/ADT)' },
    { value: 'America/St_Johns',              label: 'Newfoundland (NST/NDT)' },
    { value: 'America/Sao_Paulo',             label: 'Brasilia (BRT)' },
    { value: 'America/Argentina/Buenos_Aires', label: 'Argentina (ART)' },
    // Atlantic / Europe / Africa
    { value: 'Atlantic/Cape_Verde',           label: 'Cape Verde (CVT)' },
    { value: 'UTC',                           label: 'UTC' },
    { value: 'Europe/London',                 label: 'London (GMT/BST)' },
    { value: 'Europe/Paris',                  label: 'Central Europe (CET/CEST)' },
    { value: 'Europe/Athens',                 label: 'Eastern Europe (EET/EEST)' },
    { value: 'Africa/Nairobi',               label: 'East Africa (EAT)' },
    // Middle East / Asia
    { value: 'Europe/Moscow',                 label: 'Moscow (MSK)' },
    { value: 'Asia/Dubai',                    label: 'Gulf (GST)' },
    { value: 'Asia/Kolkata',                  label: 'India (IST)' },
    { value: 'Asia/Dhaka',                    label: 'Bangladesh (BST)' },
    { value: 'Asia/Bangkok',                  label: 'Indochina (ICT)' },
    { value: 'Asia/Shanghai',                 label: 'China (CST)' },
    { value: 'Asia/Tokyo',                    label: 'Japan (JST)' },
    { value: 'Asia/Seoul',                    label: 'Korea (KST)' },
    // Oceania
    { value: 'Australia/Adelaide',            label: 'Adelaide (ACST/ACDT)' },
    { value: 'Australia/Sydney',              label: 'Sydney (AEST/AEDT)' },
    { value: 'Pacific/Auckland',              label: 'New Zealand (NZST/NZDT)' },
];

export function getTimezoneList() {
    const now = new Date();
    return TIMEZONE_ENTRIES.map(({ value, label }) => {
        const offset = new Intl.DateTimeFormat('en-US', {
            timeZone: value,
            timeZoneName: 'shortOffset',
        }).formatToParts(now).find(p => p.type === 'timeZoneName')?.value || '';
        return { value, label: `(${offset}) ${label}` };
    });
}
