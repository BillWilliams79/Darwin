// @vitest-environment jsdom
//
// RouteMapFull itself cannot run under jsdom (Leaflet needs a real browser) —
// same limitation MapAggregatorCard.test.jsx's mocking strategy exists to
// work around. downsamplePlacementPoints is pure and exported specifically
// so this one piece of logic — moved out of MapAggregatorCard and into
// RouteMapFull by req #3165's review — keeps direct coverage rather than
// losing it to "the component it now lives in isn't testable."

import { describe, it, expect } from 'vitest';
import { downsamplePlacementPoints, MAX_PLACEMENT_POINTS } from '../RouteMapFull';

const rows = (n) => Array.from({ length: n }, (_, i) => ({ latitude: `${i}`, longitude: '0' }));

describe('downsamplePlacementPoints (req #3174 / #3165 review)', () => {
    it('returns the input unchanged at or below the cap', () => {
        const input = rows(MAX_PLACEMENT_POINTS);
        expect(downsamplePlacementPoints(input)).toBe(input);
    });

    it('caps the output at MAX_PLACEMENT_POINTS once past the boundary', () => {
        const sampled = downsamplePlacementPoints(rows(MAX_PLACEMENT_POINTS + 1));
        expect(sampled.length).toBeLessThanOrEqual(MAX_PLACEMENT_POINTS);
        expect(sampled.length).toBeGreaterThan(0);
    });

    it('every sampled row is a member of the original set (a stride, never a fabrication)', () => {
        const input = rows(6000);
        const sampled = downsamplePlacementPoints(input);
        for (const row of sampled) expect(input).toContain(row);
    });

    it('scales down to a bounded output at extreme input sizes', () => {
        // Measured ~1.8M points at 500 rides (req #3174) — the case this
        // function exists for.
        const sampled = downsamplePlacementPoints(rows(1_800_000));
        expect(sampled.length).toBeLessThanOrEqual(MAX_PLACEMENT_POINTS);
        expect(sampled.length).toBeGreaterThan(0);
    });

    it('respects a caller-supplied max', () => {
        const sampled = downsamplePlacementPoints(rows(100), 10);
        expect(sampled.length).toBeLessThanOrEqual(10);
        expect(sampled.length).toBeGreaterThan(0);
    });
});
