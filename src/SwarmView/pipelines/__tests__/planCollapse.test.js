// req #3650 — the fold state behind every initiative chip's and epic card's own
// collapse head: one string of tokens, flipped one box at a time.

import { describe, it, expect } from 'vitest';

import {
    parseCollapsed, toggleInitiativeCollapsed, toggleEpicCollapsed, expandInitiative,
} from '../planCollapse';

describe('planCollapse (req #3650)', () => {
    it('folds nothing when nothing is stored', () => {
        for (const raw of ['', undefined, null]) {
            const { initiativeIds, epicIds } = parseCollapsed(raw);
            expect(initiativeIds.size).toBe(0);
            expect(epicIds.size).toBe(0);
        }
    });

    it('reads initiative, epic and "No initiative" tokens apart, as numbers', () => {
        const { initiativeIds, epicIds } = parseCollapsed('i5 e10 inone e11');
        expect([...initiativeIds]).toEqual([5, null]);
        expect([...epicIds]).toEqual([10, 11]);
    });

    it('ignores an unrecognised word rather than losing the reader\'s folds', () => {
        const { initiativeIds, epicIds } = parseCollapsed('i5 garbage s 12 sx  e7');
        expect([...initiativeIds]).toEqual([5]);
        expect([...epicIds]).toEqual([7]);
    });

    it('flips ONE box and leaves every other fold alone', () => {
        let raw = '';
        raw = toggleEpicCollapsed(raw, 10);
        raw = toggleInitiativeCollapsed(raw, 5);
        raw = toggleEpicCollapsed(raw, 11);
        expect(raw).toBe('e10 i5 e11');
        raw = toggleEpicCollapsed(raw, 10);
        expect(raw).toBe('i5 e11');
        raw = toggleInitiativeCollapsed(raw, null);
        expect(parseCollapsed(raw).initiativeIds.has(null)).toBe(true);
        raw = toggleInitiativeCollapsed(raw, 5);
        expect(raw).toBe('e11 inone');
    });

    it('an epic and an initiative sharing an id are different boxes', () => {
        const raw = toggleEpicCollapsed('', 5);
        expect(parseCollapsed(raw).initiativeIds.has(5)).toBe(false);
        expect(parseCollapsed(raw).epicIds.has(5)).toBe(true);
    });

    it('expandInitiative unfolds only that initiative, and is a no-op when it was open', () => {
        expect(expandInitiative('i5 e10 i6', 5)).toBe('e10 i6');
        expect(expandInitiative('e10 i6', 5)).toBe('e10 i6');
        expect(expandInitiative('inone e3', null)).toBe('e3');
    });
});
