import { describe, it, expect } from 'vitest';
import {
    PERCENT_BANDS, PERCENT_NONE_COLOR, DEFAULT_PREVIEW_COLOR, CLEAN_COLOR, CLEAN_MODE,
    epicPercent, percentColor, normalizePreviewColor, previewLegend,
} from '../previewColor';

const band = (pct) => PERCENT_BANDS.find((b) => b.color === percentColor(pct)).key;

describe('previewColor (req #4063, narrowed by req #4184)', () => {
    it('defaults to progress; the clean look is the only other mode', () => {
        expect(DEFAULT_PREVIEW_COLOR).toBe('percent');
        expect(normalizePreviewColor(CLEAN_MODE)).toBe('clean');
        expect(CLEAN_COLOR).toBe('#14692b');      // the 100% green
    });

    it('normalizes hostile and retired stored values to the default', () => {
        expect(normalizePreviewColor('constructor')).toBe('percent');
        expect(normalizePreviewColor('model')).toBe('percent');   // a retired scale
        expect(normalizePreviewColor('flags')).toBe('percent');
        expect(normalizePreviewColor(null)).toBe('percent');
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

    it('keys the progress bands and the no-work swatch', () => {
        expect(previewLegend().map((e) => e.label))
            .toEqual(['0%', '1–25%', '26–50%', '51–75%', '76–99%', '100%', 'no work']);
    });
});
