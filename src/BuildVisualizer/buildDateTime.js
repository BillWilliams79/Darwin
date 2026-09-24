// Build Visualizer event times (req #3515).
//
// builds.built_at / branches.branched_at / customer_releases.released_at are
// stored as naive UTC DATETIME and DISPLAYED in Pacific time — a fixed zone, not
// the viewer's profile zone, because the build schedule itself is defined in
// Pacific (the sprint simulator's 7am/7pm PT slots). Only built_at is surfaced
// in the UI today; the other two are recorded when the event is performed.

import {
    formatSimpleDateTime,
    toDateTimeLocalValue,
    fromDateTimeLocalValue,
    toUtcDate,
} from '../utils/dateFormat';

export const BUILD_TIMEZONE = 'America/Los_Angeles';

// "Sep 14 7:00 AM" in Pacific; '' when the value is NULL/invalid (blank line).
export function formatBuiltAt(value) {
    return formatSimpleDateTime(value, BUILD_TIMEZONE);
}

// The stored UTC value as a Date — for SORTING and comparison, never display.
// A grid column that sorts on the formatted string orders "Oct 1" before "Sep 9".
export function builtAtToDate(value) {
    return toUtcDate(value);
}

// UTC DATETIME → 'YYYY-MM-DDTHH:MM' Pacific, for a datetime-local input.
export function builtAtToInput(value) {
    return toDateTimeLocalValue(value, BUILD_TIMEZONE);
}

// datetime-local input (Pacific) → UTC 'YYYY-MM-DD HH:MM:SS', or null when empty.
export function builtAtFromInput(localValue) {
    return localValue ? fromDateTimeLocalValue(localValue, BUILD_TIMEZONE) : null;
}

// The current instant as a UTC MySQL DATETIME literal — the stamp a live event
// (Execute Build, create branch, release event) records.
export function nowUtcSql(now = new Date()) {
    return now.toISOString().slice(0, 19).replace('T', ' ');
}
