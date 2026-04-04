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

export function formatCardDateTime(dateStr, timezone) {
    const d = toDate(dateStr);
    if (!d || isNaN(d)) return '—';
    const datePart = d.toLocaleDateString('en-US', {
        weekday: 'short', year: 'numeric', month: 'short', day: 'numeric',
        ...(timezone && { timeZone: timezone }),
    });
    const timeFmt = new Intl.DateTimeFormat('en-US', {
        hour: 'numeric', minute: '2-digit', hour12: true,
        ...(timezone && { timeZone: timezone }),
    });
    const parts = timeFmt.formatToParts(d);
    const hour = parts.find(p => p.type === 'hour')?.value;
    const minute = parts.find(p => p.type === 'minute')?.value;
    const period = parts.find(p => p.type === 'dayPeriod')?.value?.toLowerCase();
    return `${datePart} @ ${hour}:${minute}${period}`;
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

// ── datetime-local input conversion ─────────────────────────────────────────

// Convert MySQL UTC datetime string → 'YYYY-MM-DDTHH:MM' in the given timezone
// (for use as an HTML5 datetime-local input value).
export function toDateTimeLocalValue(dateStr, timezone) {
    const d = toDate(dateStr);
    if (!d || isNaN(d)) return '';
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: timezone || undefined,
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(d);
    const get = (type) => parts.find(p => p.type === type)?.value;
    const hour = get('hour') === '24' ? '00' : get('hour');
    return `${get('year')}-${get('month')}-${get('day')}T${hour}:${get('minute')}`;
}

// Convert 'YYYY-MM-DDTHH:MM' in the given timezone → MySQL UTC DATETIME 'YYYY-MM-DD HH:MM:SS'.
export function fromDateTimeLocalValue(localStr, timezone) {
    if (!localStr) return null;
    const [datePart, timePart] = localStr.split('T');
    const [y, m, d] = datePart.split('-').map(Number);
    const [h, min] = timePart.split(':').map(Number);

    const getOffsetMs = (refDate) => {
        if (!timezone) return -refDate.getTimezoneOffset() * 60000;
        const str = new Intl.DateTimeFormat('en-US', {
            timeZone: timezone, timeZoneName: 'shortOffset',
        }).formatToParts(refDate)
          .find(p => p.type === 'timeZoneName')?.value || '';
        const match = str.match(/GMT([+-]?)(\d+)(?::(\d+))?/);
        if (!match) return -refDate.getTimezoneOffset() * 60000;
        const sign = match[1] === '-' ? -1 : 1;
        return sign * (parseInt(match[2]) * 60 + parseInt(match[3] || '0')) * 60000;
    };

    // Treat the input components as UTC to get a starting reference
    const asUtc = new Date(Date.UTC(y, m - 1, d, h, min, 0));

    // Iterate twice to handle DST transitions correctly:
    // first pass computes an approximate UTC, second pass re-checks the offset at that UTC
    const utcGuess1 = new Date(asUtc.getTime() - getOffsetMs(asUtc));
    const utcDate   = new Date(asUtc.getTime() - getOffsetMs(utcGuess1));

    const pad = (n) => String(n).padStart(2, '0');
    return `${utcDate.getUTCFullYear()}-${pad(utcDate.getUTCMonth() + 1)}-${pad(utcDate.getUTCDate())} ` +
           `${pad(utcDate.getUTCHours())}:${pad(utcDate.getUTCMinutes())}:${pad(utcDate.getUTCSeconds())}`;
}

// ── Period summary utilities ────────────────────────────────────────────────

// Return the YYYY-MM-DD string for the start of the current period.
// mode: 'week' → Sunday of the current week, 'month' → 1st of the current month.
export function currentPeriodStart(mode) {
    const now = new Date();
    if (mode === 'week') {
        const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        d.setDate(d.getDate() - d.getDay()); // back to Sunday
        return d.toISOString().slice(0, 10);
    }
    // month
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
}

// Return { start, end } YYYY-MM-DD strings for the period containing dateStr.
// mode: 'week' → 7-day span starting at dateStr, 'month' → full calendar month.
export function periodDateRange(dateStr, mode) {
    if (!dateStr) return { start: null, end: null };
    const d = new Date(dateStr + 'T12:00:00'); // noon avoids DST edge
    if (mode === 'week') {
        const end = new Date(d);
        end.setDate(end.getDate() + 6);
        return { start: dateStr, end: end.toISOString().slice(0, 10) };
    }
    // month: start = 1st, end = last day
    const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0, 12);
    return { start: dateStr, end: lastDay.toISOString().slice(0, 10) };
}

// Shift a period start date forward (+1) or backward (-1).
export function shiftPeriod(dateStr, mode, direction) {
    const d = new Date(dateStr + 'T12:00:00');
    if (mode === 'week') {
        d.setDate(d.getDate() + direction * 7);
    } else {
        d.setMonth(d.getMonth() + direction);
    }
    return d.toISOString().slice(0, 10);
}

// Format a period label for display.
// week: "Apr 6 – 12, 2026" or "Mar 30 – Apr 5, 2026" (cross-month)
// month: "April 2026"
export function formatPeriodLabel(dateStr, mode) {
    if (!dateStr) return '';
    const { start, end } = periodDateRange(dateStr, mode);
    const s = new Date(start + 'T12:00:00');
    const e = new Date(end + 'T12:00:00');
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const fullMonths = ['January','February','March','April','May','June',
                        'July','August','September','October','November','December'];

    if (mode === 'month') {
        return `${fullMonths[s.getMonth()]} ${s.getFullYear()}`;
    }
    // week
    if (s.getMonth() === e.getMonth()) {
        return `${months[s.getMonth()]} ${s.getDate()} – ${e.getDate()}, ${s.getFullYear()}`;
    }
    if (s.getFullYear() === e.getFullYear()) {
        return `${months[s.getMonth()]} ${s.getDate()} – ${months[e.getMonth()]} ${e.getDate()}, ${s.getFullYear()}`;
    }
    return `${months[s.getMonth()]} ${s.getDate()}, ${s.getFullYear()} – ${months[e.getMonth()]} ${e.getDate()}, ${e.getFullYear()}`;
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
