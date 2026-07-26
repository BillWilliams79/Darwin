// Field rules for the editable map_runs columns (req #3073).
//
// The card view (RouteCards/RouteCard) and the table view (MapRuns/MapRunsView) edit
// the SAME columns through two different controls, and before this module each
// hand-rolled its own format / parse / isNaN check per field. That is exactly how the
// two drifted: the table validated its Duration column and the card did not, the card
// rendered a null stopped_time_sec as "00:00:00" while the table rendered it blank, and
// both silently skipped the write when a value failed to parse. One rule per column,
// used by both views, and the rule is unit-testable on its own.
//
// A rule is the vocabulary GhostTextField already speaks:
//
//   format(raw)      stored column value  → the text the field shows
//   normalize(text)  committed text       → its canonical display form
//   validate(text)   text                 → an error string, or null to allow the write
//   toApi(text)      display text         → the value to PUT
//   required         true when an emptied field must revert rather than write
//
// `validate` returns null for blank on purpose. Emptiness is not a parse failure, and
// conflating the two would flash "Enter a number" the moment a user select-all-deletes
// to retype. What happens to a blank is decided by `required` (revert) or by `toApi`
// (write SQL NULL) — never by an error message.

import { formatDuration, parseDuration } from './mapDataUtils';
import { toDateTimeLocalValue, fromDateTimeLocalValue } from './dateFormat';

// Lambda-Rest's PUT body is an array of column bags, so the only way to express SQL
// NULL over JSON is this literal. See CLAUDE.md § Key Lessons.
export const SQL_NULL = 'NULL';

const isBlank = (text) => (text ?? '').trim() === '';

/**
 * Strict numeric read — deliberately `Number`, NOT `parseFloat`.
 *
 * The originals used `parseFloat`, which reads "12abc" as 12 and stored it without
 * telling anybody. That is the silent-drop defect wearing a different hat: the user
 * typed something the field did not understand and got a number back anyway. `Number`
 * rejects the whole string, so it surfaces as a verdict instead.
 */
const asNumber = (text) => {
    if (isBlank(text)) return NaN;
    const n = Number(String(text).trim());
    return Number.isFinite(n) ? n : NaN;
};

/** A decimal column rendered to a fixed number of places. */
const decimal = ({ places = 1, required = false } = {}) => ({
    required,
    format: (raw) => (raw == null ? '' : Number(raw).toFixed(places)),
    normalize: (text) => {
        const n = asNumber(text);
        return isNaN(n) ? text : n.toFixed(places);
    },
    validate: (text) => (isBlank(text) || !isNaN(asNumber(text)) ? null : 'Enter a number'),
    toApi: (text) => (isBlank(text) ? SQL_NULL : asNumber(text)),
});

/** A whole-number column (feet of ascent / descent). */
const integer = ({ required = false } = {}) => ({
    required,
    format: (raw) => (raw == null ? '' : String(Math.round(Number(raw)))),
    normalize: (text) => {
        const n = asNumber(text);
        return isNaN(n) ? text : String(Math.round(n));
    },
    validate: (text) => (isBlank(text) || !isNaN(asNumber(text)) ? null : 'Enter a number'),
    toApi: (text) => (isBlank(text) ? SQL_NULL : Math.round(asNumber(text))),
});

/** A seconds column edited as H:MM:SS (parseDuration also accepts M:SS and raw seconds). */
const duration = ({ required = false } = {}) => ({
    required,
    // Null-guarded: the shared formatDuration() does not null-check and would render a
    // missing duration as "00:00:00", which is a real value the row does not hold.
    format: (raw) => (raw == null ? '' : formatDuration(raw)),
    normalize: (text) => {
        const s = parseDuration(text);
        return isNaN(s) ? text : formatDuration(s);
    },
    validate: (text) => (isBlank(text) || !isNaN(parseDuration(text)) ? null : 'Use H:MM:SS'),
    toApi: (text) => (isBlank(text) ? SQL_NULL : parseDuration(text)),
});

/** Free text stored as a nullable column — an emptied field means NULL, not ''. */
export const notesField = {
    required: false,
    format: (raw) => raw || '',
    normalize: (text) => text.trim(),
    validate: () => null,
    toApi: (text) => text.trim() || SQL_NULL,
};

/**
 * A UTC DATETIME column edited in the user's timezone through an <input
 * type="datetime-local">. Depends on the timezone, so it is a factory rather than a
 * constant.
 *
 * `required: true` is load-bearing and is NOT interchangeable with a validate rule
 * here. A datetime-local input whose segments are only partly filled reads back as
 * '' from the DOM, so a half-typed date arrives at commit as an empty string. Under
 * `required` that reverts to the stored value — visibly, in front of the user, which
 * is the honest outcome. Left to `validate` instead it would either write SQL NULL
 * over a NOT NULL column or paint an error under a field the user is still mid-way
 * through filling in, once per keystroke.
 */
export const dateTimeField = (timezone) => {
    // fromDateTimeLocalValue() assumes a well-formed 'YYYY-MM-DDTHH:MM' and throws on
    // anything else (it splits on 'T' and dereferences the time half unguarded). A
    // native datetime-local input only ever emits that shape or '', but validate() runs
    // on every keystroke and must not be the thing that takes the page down.
    const toUtc = (text) => {
        try {
            return fromDateTimeLocalValue(text, timezone);
        } catch {
            return null;
        }
    };
    return {
        required: true,
        format: (raw) => toDateTimeLocalValue(raw, timezone),
        normalize: (text) => text,
        validate: (text) => (isBlank(text) || toUtc(text) ? null : 'Enter a date and time'),
        toApi: toUtc,
    };
};

/**
 * The editable numeric/duration columns of map_runs.
 *
 * `required` mirrors what the two views already did rather than what the schema
 * permits: distance and the two duration columns have never been writable as empty
 * from either view, so an emptied field reverts. The rest send SQL NULL, which is
 * also what both views already did.
 */
// `places` is the COLUMN's scale, not a display preference, and KEEPING IT THAT WAY
// IS LOAD-BEARING. Both views used to show avg_speed_mph — DECIMAL(5,2) — to one
// decimal, which is worse than cosmetic now that a field only writes a value the user
// changed: normalize rounded 15.28 to 15.3, that equalled the displayed value, and the
// commit short-circuited. A two-decimal average speed was unenterable from either view.
//
// The deeper reason to keep these in step: GhostTextField holds a committed value on
// screen until the `value` prop moves off what the write was issued against. That rests
// on every rule round-tripping — format(toApi(x)) === x. Let `places` drift below the
// column's scale again and the server rounds the value straight back to the pre-edit
// display string, the prop never moves, and the field stays on a value the database
// does not hold instead of correcting itself one refetch later.
export const mapRunFields = {
    distance_mi: decimal({ places: 1, required: true }),     // DECIMAL(6,1) NOT NULL
    avg_speed_mph: decimal({ places: 2 }),                   // DECIMAL(5,2) NULL
    max_speed_mph: decimal({ places: 1 }),                   // DECIMAL(5,1) NULL
    ascent_ft: integer(),
    descent_ft: integer(),
    run_time_sec: duration({ required: true }),
    stopped_time_sec: duration({ required: true }),
};

export { decimal, integer, duration };
