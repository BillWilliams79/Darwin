import { describe, it, expect } from 'vitest';
import { shouldShowPhaseLegend } from '../SwarmVisualizerView';

// req #2880 — the phase key (PhaseLegend) is gated by shouldShowPhaseLegend. The
// Phases toggle drives it at the out/mid zoom levels; the deepest `in` zoom always
// draws phase segments, so the key must always show there regardless of the toggle.
describe('shouldShowPhaseLegend', () => {
    it('shows the key whenever the Phases toggle is on, at any zoom level', () => {
        for (const zoomLevel of ['out', 'mid', 'in']) {
            expect(shouldShowPhaseLegend({ phasesOn: true, zoomLevel })).toBe(true);
        }
    });

    it('forces the key visible at the `in` level even when the toggle is off', () => {
        expect(shouldShowPhaseLegend({ phasesOn: false, zoomLevel: 'in' })).toBe(true);
    });

    it('hides the key at out/mid levels when the toggle is off', () => {
        expect(shouldShowPhaseLegend({ phasesOn: false, zoomLevel: 'out' })).toBe(false);
        expect(shouldShowPhaseLegend({ phasesOn: false, zoomLevel: 'mid' })).toBe(false);
    });

    it('coerces a falsy phasesOn (undefined) without throwing', () => {
        expect(shouldShowPhaseLegend({ phasesOn: undefined, zoomLevel: 'mid' })).toBe(false);
        expect(shouldShowPhaseLegend({ phasesOn: undefined, zoomLevel: 'in' })).toBe(true);
    });
});
