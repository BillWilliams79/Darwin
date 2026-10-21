// req #3665 review — a long press puts the caret where the text was pressed.

import { describe, it, expect } from 'vitest';
import { nearestCaretOffset, domCaretAt } from '../planCaretPoint';

describe('nearestCaretOffset', () => {
    // "abc" at 10px a character.
    const widths = [0, 10, 20, 30];

    it('picks the character boundary nearest the point', () => {
        expect(nearestCaretOffset(widths, 0)).toBe(0);
        expect(nearestCaretOffset(widths, 4)).toBe(0);
        expect(nearestCaretOffset(widths, 6)).toBe(1);
        expect(nearestCaretOffset(widths, 19)).toBe(2);
        expect(nearestCaretOffset(widths, 26)).toBe(3);
    });

    it('a tie goes to the earlier boundary', () => {
        expect(nearestCaretOffset(widths, 15)).toBe(1);
    });

    it('clamps before the text and past its end', () => {
        expect(nearestCaretOffset(widths, -40)).toBe(0);
        expect(nearestCaretOffset(widths, 400)).toBe(3);
    });

    it('answers the start for nothing measurable', () => {
        expect(nearestCaretOffset([], 10)).toBe(0);
        expect(nearestCaretOffset(widths, NaN)).toBe(0);
        expect(nearestCaretOffset(null, 10)).toBe(0);
    });
});

describe('domCaretAt', () => {
    it('answers null with no point', () => {
        expect(domCaretAt(null)).toBeNull();
    });
});
