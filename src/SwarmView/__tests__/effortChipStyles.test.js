import { describe, it, expect } from 'vitest';
import {
    EFFORT_COLOR,
    EFFORTS,
    effortLabel,
    effortChipProps,
    effortIconColor,
} from '../effortChipStyles';
import { AI_MODEL_COLOR } from '../modelChipStyles';
import { COORDINATION_COLOR } from '../coordinationChipStyles';

// req #2916 — effort chip palette: low·medium·high·xhigh·ultracode. Recolored to
// a red → green intensity ramp in req #3044 (red = least effort, dark green =
// maximum effort); intentionally shares that ramp with the model palette but
// stays distinct from the autonomy palette.
describe('effortChipStyles (req #2916, recolored #3044)', () => {
    it('maps the five efforts to the red → green intensity ramp', () => {
        expect(EFFORT_COLOR.low).toBe('#e57373');       // red
        expect(EFFORT_COLOR.medium).toBe('#ffb74d');    // orange
        expect(EFFORT_COLOR.high).toBe('#ffd54f');      // amber
        expect(EFFORT_COLOR.xhigh).toBe('#81c784');     // light green
        expect(EFFORT_COLOR.ultracode).toBe('#388e3c'); // dark green
    });

    it('EFFORTS lists all five in intensity order', () => {
        expect(EFFORTS).toEqual(['low', 'medium', 'high', 'xhigh', 'ultracode']);
    });

    it('shares no hue with the autonomy palette (chips must be distinguishable)', () => {
        const effortHues = Object.values(EFFORT_COLOR);
        const coordHues = Object.values(COORDINATION_COLOR);
        expect(effortHues.filter(h => coordHues.includes(h))).toEqual([]);
    });

    it('intentionally shares the red → green ramp with the model palette (req #3044)', () => {
        // Both axes read the same way by design: the top rungs are the same
        // greens and the bottom rung the same red. Told apart by label, not hue.
        expect(EFFORT_COLOR.ultracode).toBe(AI_MODEL_COLOR.fable); // dark green
        expect(EFFORT_COLOR.xhigh).toBe(AI_MODEL_COLOR.opus);      // light green
        expect(EFFORT_COLOR.low).toBe(AI_MODEL_COLOR.haiku);       // red
    });

    it('effortLabel capitalizes each known effort (xhigh → XHigh)', () => {
        expect(effortLabel('low')).toBe('Low');
        expect(effortLabel('medium')).toBe('Medium');
        expect(effortLabel('high')).toBe('High');
        expect(effortLabel('xhigh')).toBe('XHigh');
        expect(effortLabel('ultracode')).toBe('Ultracode');
    });

    it('effortLabel falls back to High for null/unknown (pre-#2916 backfill rule)', () => {
        expect(effortLabel(null)).toBe('High');
        expect(effortLabel(undefined)).toBe('High');
        expect(effortLabel('')).toBe('High');
        expect(effortLabel('max')).toBe('High');
    });

    it('effortChipProps yields a filled chip (bg + black text) per effort', () => {
        expect(effortChipProps('low')).toEqual({ sx: { bgcolor: '#e57373', color: '#000' } });
        expect(effortChipProps('medium')).toEqual({ sx: { bgcolor: '#ffb74d', color: '#000' } });
        expect(effortChipProps('high')).toEqual({ sx: { bgcolor: '#ffd54f', color: '#000' } });
        expect(effortChipProps('xhigh')).toEqual({ sx: { bgcolor: '#81c784', color: '#000' } });
        expect(effortChipProps('ultracode')).toEqual({ sx: { bgcolor: '#388e3c', color: '#000' } });
    });

    it('effortChipProps falls back to high styling for null/unknown (NOT the xhigh default)', () => {
        expect(effortChipProps(null)).toEqual({ sx: { bgcolor: '#ffd54f', color: '#000' } });
        expect(effortChipProps('bogus')).toEqual({ sx: { bgcolor: '#ffd54f', color: '#000' } });
    });

    // req #3046 — Effort renders as a small icon (glyph FILL = ramp hex).
    it('effortIconColor returns the ramp hex per effort', () => {
        expect(effortIconColor('low')).toBe('#e57373');
        expect(effortIconColor('medium')).toBe('#ffb74d');
        expect(effortIconColor('high')).toBe('#ffd54f');
        expect(effortIconColor('xhigh')).toBe('#81c784');
        expect(effortIconColor('ultracode')).toBe('#388e3c');
    });

    it('effortIconColor falls back to high color for null/unknown (NOT the xhigh default)', () => {
        expect(effortIconColor(null)).toBe('#ffd54f');
        expect(effortIconColor('bogus')).toBe('#ffd54f');
    });
});
