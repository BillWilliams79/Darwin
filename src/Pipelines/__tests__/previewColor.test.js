import { describe, it, expect } from 'vitest';
import {
    PERCENT_BANDS, PERCENT_NONE_COLOR, PREVIEW_COLOR_MODES, DEFAULT_PREVIEW_COLOR,
    epicPercent, percentColor, normalizePreviewColor, beadSlices, previewLegend,
} from '../previewColor';

const band = (pct) => PERCENT_BANDS.find((b) => b.color === percentColor(pct)).key;

describe('previewColor (req #4063)', () => {
    it('defaults to progress and lists it first, the visualizer scales after, flags last', () => {
        expect(DEFAULT_PREVIEW_COLOR).toBe('percent');
        expect(PREVIEW_COLOR_MODES.map((m) => m.key))
            .toEqual(['percent', 'state', 'session', 'autonomy', 'model', 'machine', 'flags']);
    });

    it('normalizes a hostile stored value to the default', () => {
        expect(normalizePreviewColor('constructor')).toBe('percent');
        expect(normalizePreviewColor('model')).toBe('model');
    });

    it('bands progress exactly as the user named them', () => {
        expect(band(0)).toBe('p0');
        expect(band(0.4)).toBe('p25');     // some work closed is never "0"
        expect(band(25)).toBe('p25');
        expect(band(26)).toBe('p50');
        expect(band(50)).toBe('p50');
        expect(band(51)).toBe('p75');
        expect(band(75)).toBe('p75');
        expect(band(76)).toBe('p99');
        expect(band(99.5)).toBe('p99');
        expect(band(100)).toBe('p100');
        expect(percentColor(null)).toBe(PERCENT_NONE_COLOR);
    });

    it('reads progress from the server\'s open work, ignoring tracking containers', () => {
        expect(epicPercent({ reqIds: [1, 2, 3, 4], trackingReqIds: [4], openReqIds: [3] }))
            .toBeCloseTo(66.67, 1);
        expect(epicPercent({ reqIds: [9], trackingReqIds: [9], openReqIds: [] })).toBeNull();
        expect(epicPercent({ reqIds: [], openReqIds: [] })).toBeNull();
    });

    it('draws a scale-coloured epic as a pie of its requirements, in legend order', () => {
        const view = {
            colorOf: (id) => (id < 3 ? '#aaa' : '#bbb'),
            legend: [{ color: '#bbb' }, { color: '#aaa' }],
        };
        const slices = beadSlices({ reqIds: [1, 2, 3, 4], trackingReqIds: [4] }, view);
        expect(slices).toEqual([
            { color: '#bbb', frac: 1 / 3 }, { color: '#aaa', frac: 2 / 3 }]);
        expect(beadSlices({ reqIds: [] }, view)).toEqual([]);
    });

    it('keys the progress bands and every value a scale can paint', () => {
        expect(previewLegend('percent').map((e) => e.label))
            .toEqual(['0%', '1–25%', '26–50%', '51–75%', '76–99%', '100%', 'no work']);
        expect(previewLegend('autonomy').map((e) => e.key))
            .toEqual(['discuss', 'planned', 'implemented', 'deployed', 'none']);
        expect(previewLegend('flags')).toEqual([]);
        // Neutral "no work" closes every key; unknown joins Session until sessions load.
        expect(previewLegend('autonomy').at(-1).key).toBe('none');
        expect(previewLegend('session', [], { sessionsKnown: false }).map((e) => e.key))
            .toContain('unknown');
        expect(previewLegend('session').map((e) => e.key)).not.toContain('unknown');
    });
});
