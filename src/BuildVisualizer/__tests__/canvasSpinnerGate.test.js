import { describe, it, expect } from 'vitest';
import { shouldShowCanvasSpinner } from '../canvasSpinnerGate';

// req #2895 — the full-canvas spinner must only appear on the very first load.
// A mid-session refetch (running a build, editing a branch, toggling a display
// option) must NOT cover the canvas, or KonvaBuildCanvas unmounts and loses its
// pan/zoom transform, re-centering the view.
describe('shouldShowCanvasSpinner', () => {
    it('shows the spinner on first load: not ready, no branches yet', () => {
        expect(shouldShowCanvasSpinner({
            initialLoad: true, ready: false, hasBranches: false,
        })).toBe(true);
    });

    it('shows the spinner while ready but still loading the first data', () => {
        expect(shouldShowCanvasSpinner({
            initialLoad: true, ready: true, hasBranches: false,
        })).toBe(true);
    });

    it('shows the spinner when the pattern library is not ready and nothing drawn', () => {
        expect(shouldShowCanvasSpinner({
            initialLoad: false, ready: false, hasBranches: false,
        })).toBe(true);
    });

    it('does NOT show the spinner during a refetch that still has branches', () => {
        // The core regression guard: initialLoad may be false here (keepPreviousData
        // keeps branches), but even if a signal briefly trips, an on-screen graph
        // is never covered.
        expect(shouldShowCanvasSpinner({
            initialLoad: true, ready: true, hasBranches: true,
        })).toBe(false);
    });

    it('does NOT show the spinner once loaded and ready', () => {
        expect(shouldShowCanvasSpinner({
            initialLoad: false, ready: true, hasBranches: true,
        })).toBe(false);
    });

    it('never covers an already-drawn graph, even if not ready', () => {
        expect(shouldShowCanvasSpinner({
            initialLoad: false, ready: false, hasBranches: true,
        })).toBe(false);
    });

    it('coerces truthy/falsy initialLoad', () => {
        expect(shouldShowCanvasSpinner({
            initialLoad: undefined, ready: false, hasBranches: false,
        })).toBe(true);
        expect(shouldShowCanvasSpinner({
            initialLoad: 0, ready: true, hasBranches: false,
        })).toBe(false);
    });
});
