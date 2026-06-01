import { describe, it, expect } from 'vitest';
import { holdCount } from '../holdCountFormula';

// Default timing from HoldCountButton: startDelayMs=400, dwellMs=562.5
const START = 400;
const DWELL = 562.5;
const MAX = 14;

describe('holdCount — quick click', () => {
    it('returns 1 when elapsed is 0 (instant release)', () => {
        expect(holdCount(0, START, DWELL, MAX)).toBe(1);
    });

    it('returns 1 when elapsed is just under startDelayMs', () => {
        expect(holdCount(399, START, DWELL, MAX)).toBe(1);
    });

    it('returns 1 when elapsed equals startDelayMs - 1', () => {
        expect(holdCount(START - 1, START, DWELL, MAX)).toBe(1);
    });
});

describe('holdCount — hold threshold boundary', () => {
    it('returns 2 at exactly startDelayMs (hold begins, floor(0/dwell) = 0 → 2+0)', () => {
        expect(holdCount(START, START, DWELL, MAX)).toBe(2);
    });

    it('returns 2 when held fraction of a dwell past start', () => {
        expect(holdCount(START + 100, START, DWELL, MAX)).toBe(2);
    });

    it('returns 2 just before first full dwell completes', () => {
        expect(holdCount(START + DWELL - 1, START, DWELL, MAX)).toBe(2);
    });
});

describe('holdCount — stepping', () => {
    it('returns 3 after one full dwell', () => {
        expect(holdCount(START + DWELL, START, DWELL, MAX)).toBe(3);
    });

    it('returns 4 after two full dwells', () => {
        expect(holdCount(START + 2 * DWELL, START, DWELL, MAX)).toBe(4);
    });

    it('returns N after (N-2) full dwells', () => {
        for (let n = 2; n <= 10; n++) {
            const elapsed = START + (n - 2) * DWELL;
            expect(holdCount(elapsed, START, DWELL, MAX)).toBe(n);
        }
    });
});

describe('holdCount — maxQty cap', () => {
    it('caps at maxQty', () => {
        // After enough dwells to exceed maxQty
        const elapsed = START + (MAX + 5) * DWELL;
        expect(holdCount(elapsed, START, DWELL, MAX)).toBe(MAX);
    });

    it('reaches maxQty at exactly (maxQty - 2) dwells', () => {
        const elapsed = START + (MAX - 2) * DWELL;
        expect(holdCount(elapsed, START, DWELL, MAX)).toBe(MAX);
    });

    it('stays at maxQty well past the cap', () => {
        const elapsed = START + 100 * DWELL;
        expect(holdCount(elapsed, START, DWELL, MAX)).toBe(MAX);
    });
});

describe('holdCount — custom timing', () => {
    it('works with a shorter start delay', () => {
        expect(holdCount(99, 100, 200, 5)).toBe(1);
        expect(holdCount(100, 100, 200, 5)).toBe(2);
        expect(holdCount(300, 100, 200, 5)).toBe(3);
    });

    it('works with maxQty = 2 (only two states: click=1, hold=2)', () => {
        expect(holdCount(0, 400, 500, 2)).toBe(1);
        expect(holdCount(400, 400, 500, 2)).toBe(2);
        expect(holdCount(10000, 400, 500, 2)).toBe(2);
    });

    it('works with maxQty = 1 (hold never exceeds 1)', () => {
        // min(1, 2 + floor(...)) is always >= 1, but min(1, ...) caps to 1.
        // Wait — actually min(1, 2 + ...) = 1 only if 2+... <= 1, which is
        // never true. So holdCount with maxQty=1 returns 1 before start delay
        // and min(1, 2) = 1 after. Let's verify.
        expect(holdCount(0, 400, 500, 1)).toBe(1);
        expect(holdCount(400, 400, 500, 1)).toBe(1);
        expect(holdCount(10000, 400, 500, 1)).toBe(1);
    });
});
