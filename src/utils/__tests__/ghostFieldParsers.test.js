// Req #3073 — the field rules the two Maps views now share.
//
// These are the rules that used to be written out longhand at each of the fourteen
// call sites, which is how the card and the table drifted apart. Each one answers
// three questions the old `if (!isNaN(v))` could not: what does a bad value LOOK
// like, what gets STORED, and what happens to an emptied field.

import { describe, it, expect } from 'vitest';

import {
    mapRunFields,
    notesField,
    dateTimeField,
    SQL_NULL,
} from '../ghostFieldParsers';

const TZ = 'America/Los_Angeles';

describe('ghostFieldParsers — decimal columns', () => {
    const distance = mapRunFields.distance_mi;

    it('formats a stored value to its display precision', () => {
        expect(distance.format(12)).toBe('12.0');
        expect(distance.format(12.34)).toBe('12.3');
    });

    it('renders a missing value as blank, not as zero', () => {
        expect(distance.format(null)).toBe('');
        expect(distance.format(undefined)).toBe('');
    });

    it('normalizes a committed value into the display form', () => {
        // Without this the field repaints after every commit: the write stores 12,
        // the refetch returns '12.0', and the re-seed guard has to reconcile the two.
        expect(distance.normalize('12')).toBe('12.0');
        expect(distance.normalize('  12.34  ')).toBe('12.3');
    });

    it('leaves an unparseable value alone so the user can see what they typed', () => {
        expect(distance.normalize('abc')).toBe('abc');
    });

    it('REJECTS a value that is only partly a number', () => {
        // The originals used parseFloat, which reads '12abc' as 12 and stored it
        // without telling anybody. That is the silent drop wearing a different hat.
        expect(distance.validate('12abc')).toBe('Enter a number');
        expect(distance.validate('abc')).toBe('Enter a number');
    });

    it('accepts a number in any of the forms a user actually types', () => {
        for (const text of ['12', '12.5', '.5', '-3', '  7  ', '1e2']) {
            expect(distance.validate(text)).toBeNull();
        }
    });

    it('treats blank as a question for `required`, not as a parse failure', () => {
        // Conflating the two would flash "Enter a number" the instant a user
        // select-all-deletes in order to retype.
        expect(distance.validate('')).toBeNull();
        expect(distance.validate('   ')).toBeNull();
    });

    it('marks the NOT NULL column required and the nullable ones not', () => {
        expect(mapRunFields.distance_mi.required).toBe(true);
        expect(mapRunFields.avg_speed_mph.required).toBe(false);
        expect(mapRunFields.max_speed_mph.required).toBe(false);
    });

    it('sends the SQL NULL sentinel when a nullable column is emptied', () => {
        expect(mapRunFields.avg_speed_mph.toApi('')).toBe(SQL_NULL);
        expect(mapRunFields.max_speed_mph.toApi('  ')).toBe(SQL_NULL);
    });

    it('sends a number, not a string, when there is a value', () => {
        expect(distance.toApi('12.5')).toBe(12.5);
        expect(mapRunFields.avg_speed_mph.toApi('15.28')).toBe(15.28);
    });
});

describe('ghostFieldParsers — integer columns', () => {
    const ascent = mapRunFields.ascent_ft;

    it('displays and stores a whole number', () => {
        expect(ascent.format(1234.6)).toBe('1235');
        expect(ascent.normalize('1234.6')).toBe('1235');
        // Rounds rather than truncating, so the stored value matches the one the
        // field showed. The original parseInt() displayed 1235 and stored 1234.
        expect(ascent.toApi('1234.6')).toBe(1235);
    });

    it('is nullable and sends the sentinel when emptied', () => {
        expect(ascent.required).toBe(false);
        expect(ascent.toApi('')).toBe(SQL_NULL);
        expect(mapRunFields.descent_ft.toApi('')).toBe(SQL_NULL);
    });

    it('rejects a non-number', () => {
        expect(ascent.validate('1,234')).toBe('Enter a number');
    });
});

describe('ghostFieldParsers — duration columns', () => {
    const rideTime = mapRunFields.run_time_sec;

    it('renders a missing duration as blank rather than as 00:00:00', () => {
        // formatDuration() does not null-check; unguarded it reports a duration the
        // row does not have. The card used to show 00:00:00 here and the table blank.
        expect(rideTime.format(null)).toBe('');
        expect(rideTime.format(3661)).toBe('01:01:01');
    });

    it('canonicalizes every accepted input form to H:MM:SS', () => {
        expect(rideTime.normalize('1:01:01')).toBe('01:01:01');
        expect(rideTime.normalize('5:30')).toBe('00:05:30');
        expect(rideTime.normalize('90')).toBe('00:01:30');
    });

    it('names the expected format when the value will not parse', () => {
        expect(rideTime.validate('half an hour')).toBe('Use H:MM:SS');
        expect(rideTime.validate('1:02:03')).toBeNull();
    });

    it('stores seconds', () => {
        expect(rideTime.toApi('01:01:01')).toBe(3661);
    });

    it('treats both duration columns as required', () => {
        // Neither view has ever written an empty duration: parseDuration('') is NaN
        // and the old guard skipped the save. `required` makes that visible — the
        // field reverts to the stored value instead of doing nothing.
        expect(mapRunFields.run_time_sec.required).toBe(true);
        expect(mapRunFields.stopped_time_sec.required).toBe(true);
    });
});

describe('ghostFieldParsers — notes', () => {
    it('shows a missing note as an empty field', () => {
        expect(notesField.format(null)).toBe('');
        expect(notesField.format('hi')).toBe('hi');
    });

    it('stores NULL rather than an empty string when the note is cleared', () => {
        expect(notesField.toApi('')).toBe(SQL_NULL);
        expect(notesField.toApi('   ')).toBe(SQL_NULL);
    });

    it('trims, so a note cannot carry invisible padding', () => {
        expect(notesField.normalize('  a note  ')).toBe('a note');
        expect(notesField.toApi('  a note  ')).toBe('a note');
    });

    it('never blocks a write — any text is a valid note', () => {
        expect(notesField.validate('anything at all')).toBeNull();
    });
});

describe('ghostFieldParsers — start_time', () => {
    const rule = dateTimeField(TZ);

    it('round-trips a stored UTC datetime through the local picker form', () => {
        // 2026-03-15 18:30 UTC is 11:30 on the 15th in Los Angeles (PDT, UTC-7).
        const local = rule.format('2026-03-15 18:30:00');
        expect(local).toBe('2026-03-15T11:30');
        expect(rule.toApi(local)).toBe('2026-03-15 18:30:00');
    });

    it('is required, because a half-typed datetime-local reads back as blank', () => {
        // The input reports '' until every segment is filled. Under `required` that
        // reverts visibly to the stored value; left to validate it would either
        // write NULL over a NOT NULL column or paint an error mid-edit.
        expect(rule.required).toBe(true);
        expect(rule.validate('')).toBeNull();
    });

    it('does not throw on a malformed value', () => {
        // fromDateTimeLocalValue() splits on 'T' and dereferences the time half
        // unguarded. validate() runs on every keystroke and must not be the thing
        // that takes the page down.
        expect(() => rule.validate('not-a-date')).not.toThrow();
        expect(rule.validate('not-a-date')).toBe('Enter a date and time');
        expect(rule.toApi('not-a-date')).toBeNull();
    });
});
