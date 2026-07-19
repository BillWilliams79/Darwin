// Req #2992 — standard ChipFilter color palette.

import { describe, it, expect } from 'vitest';
import {
    FILTER_PALETTE,
    UNASSIGNED_COLOR,
    paletteIndexFor,
    filterColorFor,
    filterChipProps,
} from '../filterPalette';

describe('paletteIndexFor', () => {
    it('is deterministic across calls', () => {
        expect(paletteIndexFor('mac-mini')).toBe(paletteIndexFor('mac-mini'));
        expect(paletteIndexFor(7)).toBe(paletteIndexFor(7));
    });

    it('indexes small integer ids directly so the palette walks in order', () => {
        for (let i = 0; i < FILTER_PALETTE.length; i++) {
            expect(paletteIndexFor(i)).toBe(i);
        }
    });

    it('wraps past the end of the palette', () => {
        expect(paletteIndexFor(FILTER_PALETTE.length)).toBe(0);
        expect(paletteIndexFor(FILTER_PALETTE.length + 3)).toBe(3);
    });

    it('always returns a valid in-range index', () => {
        const values = [0, 1, 999999, -4, 2.5, 'a', '', 'a much longer machine name', true];
        values.forEach(v => {
            const idx = paletteIndexFor(v);
            expect(Number.isInteger(idx)).toBe(true);
            expect(idx).toBeGreaterThanOrEqual(0);
            expect(idx).toBeLessThan(FILTER_PALETTE.length);
        });
    });

    it('routes negative and fractional numbers through the string path', () => {
        // The guard exists so these cannot produce a negative or fractional
        // index — the failure mode would be FILTER_PALETTE[-1] === undefined.
        expect(FILTER_PALETTE[paletteIndexFor(-1)]).toBeDefined();
        expect(FILTER_PALETTE[paletteIndexFor(1.5)]).toBeDefined();
    });
});

describe('filterColorFor', () => {
    it('returns the reserved unassigned color for null and undefined', () => {
        expect(filterColorFor(null)).toEqual(UNASSIGNED_COLOR);
        expect(filterColorFor(undefined)).toEqual(UNASSIGNED_COLOR);
    });

    it('never assigns the unassigned color to a real value', () => {
        for (let i = 0; i < 50; i++) {
            expect(filterColorFor(i).bg).not.toBe(UNASSIGNED_COLOR.bg);
        }
    });

    it('honors a full override', () => {
        const overrides = { 2: { bg: '#123456', fg: '#abcdef' } };
        expect(filterColorFor(2, overrides)).toEqual({ bg: '#123456', fg: '#abcdef' });
    });

    it('fills fg from the palette default when an override supplies only bg', () => {
        const overrides = { 2: { bg: '#123456' } };
        const result = filterColorFor(2, overrides);
        expect(result.bg).toBe('#123456');
        expect(result.fg).toBe(FILTER_PALETTE[paletteIndexFor(2)].fg);
    });

    it('ignores an override for a different value', () => {
        const overrides = { 3: { bg: '#123456' } };
        expect(filterColorFor(2, overrides)).toEqual(FILTER_PALETTE[paletteIndexFor(2)]);
    });

    it('tolerates a missing overrides map', () => {
        expect(filterColorFor(2, undefined)).toEqual(FILTER_PALETTE[paletteIndexFor(2)]);
        expect(filterColorFor(2, {})).toEqual(FILTER_PALETTE[paletteIndexFor(2)]);
    });
});

describe('filterChipProps', () => {
    it('produces the MUI sx shape the other chip-props helpers use', () => {
        const props = filterChipProps(2);
        expect(props).toEqual({
            sx: { bgcolor: FILTER_PALETTE[paletteIndexFor(2)].bg, color: FILTER_PALETTE[paletteIndexFor(2)].fg },
        });
    });

    it('carries overrides through', () => {
        const props = filterChipProps(2, { 2: { bg: '#000000', fg: '#ffffff' } });
        expect(props.sx.bgcolor).toBe('#000000');
        expect(props.sx.color).toBe('#ffffff');
    });
});

describe('palette entries', () => {
    it('every entry has a background and a foreground', () => {
        [...FILTER_PALETTE, UNASSIGNED_COLOR].forEach(entry => {
            expect(entry.bg).toMatch(/^#[0-9a-f]{6}$/i);
            expect(entry.fg).toMatch(/^#[0-9a-f]{3,6}$/i);
        });
    });

    it('has no duplicate backgrounds', () => {
        const bgs = FILTER_PALETTE.map(e => e.bg);
        expect(new Set(bgs).size).toBe(bgs.length);
    });
});
