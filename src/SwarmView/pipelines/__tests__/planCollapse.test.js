// req #3650 — the fold state behind every epic chip's and step card's own
// collapse head: one string of tokens, flipped one box at a time.

import { describe, it, expect } from 'vitest';

import {
    parseCollapsed, toggleEpicCollapsed, toggleStepCollapsed, expandEpic,
} from '../planCollapse';

describe('planCollapse (req #3650)', () => {
    it('folds nothing when nothing is stored', () => {
        for (const raw of ['', undefined, null]) {
            const { epicIds, stepIds } = parseCollapsed(raw);
            expect(epicIds.size).toBe(0);
            expect(stepIds.size).toBe(0);
        }
    });

    it('reads epic, step and "No epic" tokens apart, as numbers', () => {
        const { epicIds, stepIds } = parseCollapsed('e5 s10 enone s11');
        expect([...epicIds]).toEqual([5, null]);
        expect([...stepIds]).toEqual([10, 11]);
    });

    it('ignores an unrecognised word rather than losing the reader\'s folds', () => {
        const { epicIds, stepIds } = parseCollapsed('e5 garbage s 12 sx  s7');
        expect([...epicIds]).toEqual([5]);
        expect([...stepIds]).toEqual([7]);
    });

    it('flips ONE box and leaves every other fold alone', () => {
        let raw = '';
        raw = toggleStepCollapsed(raw, 10);
        raw = toggleEpicCollapsed(raw, 5);
        raw = toggleStepCollapsed(raw, 11);
        expect(raw).toBe('s10 e5 s11');
        raw = toggleStepCollapsed(raw, 10);
        expect(raw).toBe('e5 s11');
        raw = toggleEpicCollapsed(raw, null);
        expect(parseCollapsed(raw).epicIds.has(null)).toBe(true);
        raw = toggleEpicCollapsed(raw, 5);
        expect(raw).toBe('s11 enone');
    });

    it('a step and an epic sharing an id are different boxes', () => {
        const raw = toggleStepCollapsed('', 5);
        expect(parseCollapsed(raw).epicIds.has(5)).toBe(false);
        expect(parseCollapsed(raw).stepIds.has(5)).toBe(true);
    });

    it('expandEpic unfolds only that epic, and is a no-op when it was open', () => {
        expect(expandEpic('e5 s10 e6', 5)).toBe('s10 e6');
        expect(expandEpic('s10 e6', 5)).toBe('s10 e6');
        expect(expandEpic('enone s3', null)).toBe('s3');
    });
});
