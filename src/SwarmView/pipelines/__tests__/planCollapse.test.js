// req #3650 — the fold state behind every initiative chip's and step card's own
// collapse head: one string of tokens, flipped one box at a time.

import { describe, it, expect } from 'vitest';

import {
    parseCollapsed, toggleInitiativeCollapsed, toggleStepCollapsed, expandInitiative,
} from '../planCollapse';

describe('planCollapse (req #3650)', () => {
    it('folds nothing when nothing is stored', () => {
        for (const raw of ['', undefined, null]) {
            const { initiativeIds, stepIds } = parseCollapsed(raw);
            expect(initiativeIds.size).toBe(0);
            expect(stepIds.size).toBe(0);
        }
    });

    it('reads initiative, step and "No initiative" tokens apart, as numbers', () => {
        const { initiativeIds, stepIds } = parseCollapsed('i5 s10 inone s11');
        expect([...initiativeIds]).toEqual([5, null]);
        expect([...stepIds]).toEqual([10, 11]);
    });

    it('ignores an unrecognised word rather than losing the reader\'s folds', () => {
        const { initiativeIds, stepIds } = parseCollapsed('i5 garbage s 12 sx  s7');
        expect([...initiativeIds]).toEqual([5]);
        expect([...stepIds]).toEqual([7]);
    });

    it('flips ONE box and leaves every other fold alone', () => {
        let raw = '';
        raw = toggleStepCollapsed(raw, 10);
        raw = toggleInitiativeCollapsed(raw, 5);
        raw = toggleStepCollapsed(raw, 11);
        expect(raw).toBe('s10 i5 s11');
        raw = toggleStepCollapsed(raw, 10);
        expect(raw).toBe('i5 s11');
        raw = toggleInitiativeCollapsed(raw, null);
        expect(parseCollapsed(raw).initiativeIds.has(null)).toBe(true);
        raw = toggleInitiativeCollapsed(raw, 5);
        expect(raw).toBe('s11 inone');
    });

    it('a step and an initiative sharing an id are different boxes', () => {
        const raw = toggleStepCollapsed('', 5);
        expect(parseCollapsed(raw).initiativeIds.has(5)).toBe(false);
        expect(parseCollapsed(raw).stepIds.has(5)).toBe(true);
    });

    it('expandInitiative unfolds only that initiative, and is a no-op when it was open', () => {
        expect(expandInitiative('i5 s10 i6', 5)).toBe('s10 i6');
        expect(expandInitiative('s10 i6', 5)).toBe('s10 i6');
        expect(expandInitiative('inone s3', null)).toBe('s3');
    });
});
