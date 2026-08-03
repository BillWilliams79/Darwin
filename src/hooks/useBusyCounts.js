// Per-row in-flight WRITE COUNTS for a list of independently-editable rows
// (req #3101, closing finding 3c from req #3051's review).
//
// WHY A COUNTER AND NOT A SET OF IDS.
//
// Both registry pages used to hold `useState(() => new Set())` and add/delete a
// row id around each queued membership write. A Set answers "is this row busy?"
// with a BOOLEAN, and a boolean cannot be released twice — so two writes queued
// against the SAME row shared one flag, and the FIRST one to finish deleted it
// while the second was still in flight. The card stopped spinning, its ghost chips
// re-enabled, and the user could fire a third write at a card that was still
// mid-write. The underlying writes stayed correctly serialized behind the page's
// promise queue, so nothing was ever corrupted — the signal was simply lying about
// when it was safe to click.
//
// A counter is the smallest correct fix: `mark(id, true)` increments, `mark(id,
// false)` decrements, and a row is busy while its count is above zero. Balanced
// increment/decrement pairs are already guaranteed by the callers — both pages
// decrement in a `finally`.
//
// Zero counts are DELETED rather than kept at 0. The map is a render dependency;
// leaving spent entries behind would grow it for the life of the page and produce
// a new Map identity for every write that returns to idle.
//
// Shared by /agents/documents and /agents/instructions because they had the same
// defect for the same reason. It is deliberately NOT generic beyond that: it takes
// a row id and answers a question about one row, which is all either page needs.

import { useCallback, useMemo, useState } from 'react';

export const useBusyCounts = () => {
    const [counts, setCounts] = useState(() => new Map());

    // Stable across renders so a caller may hold it in a ref or a dep array.
    const mark = useCallback((rowId, on) => setCounts(prev => {
        const current = prev.get(rowId) || 0;
        const next = current + (on ? 1 : -1);
        // A decrement below zero can only mean an unbalanced caller. Clamp rather
        // than store a negative: a negative count reads as "not busy" through the
        // `> 0` test anyway, and keeping it would make every later increment on
        // that row start from a deficit and silently suppress the spinner.
        if (next <= 0) {
            if (!prev.has(rowId)) return prev;
            const map = new Map(prev);
            map.delete(rowId);
            return map;
        }
        const map = new Map(prev);
        map.set(rowId, next);
        return map;
    }), []);

    // Recreated whenever `counts` changes, so a consumer's `useMemo` keyed on this
    // function re-runs whenever a count moved. Deliberately NOT "exactly when a
    // row's busy state moved": a 2→1 decrement makes a new Map and therefore a new
    // identity while every row's boolean is unchanged, so the consumer recomputes
    // for nothing. That is a wasted memo, never a stale one, and narrowing it would
    // mean tracking the previous booleans — more moving parts than the churn costs.
    // A no-op release does NOT churn: `mark` returns the same Map and React bails.
    const isBusy = useMemo(() => (rowId) => (counts.get(rowId) || 0) > 0, [counts]);

    return { mark, isBusy, counts };
};

export default useBusyCounts;
