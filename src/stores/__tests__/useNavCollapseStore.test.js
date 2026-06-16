import { describe, it, expect } from 'vitest';
import {
    normalizePlacement,
    PLACEMENTS,
    DEFAULT_PLACEMENT,
} from '../useNavCollapseStore';

// req #2870 — the collapse control moved into the navbar with two representations
// (header / footer) selectable via a persisted placement. normalizePlacement is the
// guard that keeps any corrupt/unknown persisted value from wedging the navbar.
describe('normalizePlacement (req #2870)', () => {
    it('passes through every valid placement', () => {
        for (const p of PLACEMENTS) {
            expect(normalizePlacement(p)).toBe(p);
        }
    });

    it('defaults unknown values to the default placement', () => {
        expect(normalizePlacement('sidebar')).toBe(DEFAULT_PLACEMENT);
        expect(normalizePlacement('')).toBe(DEFAULT_PLACEMENT);
        expect(normalizePlacement(undefined)).toBe(DEFAULT_PLACEMENT);
        expect(normalizePlacement(null)).toBe(DEFAULT_PLACEMENT);
        expect(normalizePlacement(42)).toBe(DEFAULT_PLACEMENT);
    });

    it('exposes header as the default and both representations', () => {
        expect(DEFAULT_PLACEMENT).toBe('header');
        expect(PLACEMENTS).toEqual(['header', 'footer']);
    });
});
