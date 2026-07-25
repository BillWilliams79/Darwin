import { describe, it, expect } from 'vitest';
import {
    EFFORT_COLOR,
    EFFORTS,
    effortLabel,
    effortChipProps,
    effortFillColor,
    effortIconColor,
} from '../effortChipStyles';
import { AI_MODEL_COLOR } from '../modelChipStyles';
import { COORDINATION_COLOR } from '../coordinationChipStyles';

const lightTheme = { palette: { mode: 'light' } };
const darkTheme = { palette: { mode: 'dark' } };

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

    // req #3053 — dark mode keeps the original ramp verbatim (already clears
    // 3.6–10.5:1 against the dark card surface).
    it('effortChipProps yields the original ramp + black text in dark mode', () => {
        expect(effortChipProps('low').sx(darkTheme)).toEqual({ bgcolor: '#e57373', color: '#000' });
        expect(effortChipProps('medium').sx(darkTheme)).toEqual({ bgcolor: '#ffb74d', color: '#000' });
        expect(effortChipProps('high').sx(darkTheme)).toEqual({ bgcolor: '#ffd54f', color: '#000' });
        expect(effortChipProps('xhigh').sx(darkTheme)).toEqual({ bgcolor: '#81c784', color: '#000' });
        expect(effortChipProps('ultracode').sx(darkTheme)).toEqual({ bgcolor: '#388e3c', color: '#000' });
    });

    // req #3053 — light mode darkens the four pastel rungs so the fill clears
    // 3:1 against a white card instead of reading as a washed-out grey patch.
    // Ultracode is untouched: it already sits at the dark green-700 step.
    it('effortChipProps darkens the pastel rungs (not ultracode) in light mode', () => {
        expect(effortChipProps('low').sx(lightTheme)).toEqual({ bgcolor: 'rgb(217, 109, 109)', color: '#000' });
        expect(effortChipProps('medium').sx(lightTheme)).toEqual({ bgcolor: 'rgb(183, 131, 55)', color: '#000' });
        expect(effortChipProps('high').sx(lightTheme)).toEqual({ bgcolor: 'rgb(165, 138, 51)', color: '#000' });
        expect(effortChipProps('xhigh').sx(lightTheme)).toEqual({ bgcolor: 'rgb(99, 153, 101)', color: '#000' });
        expect(effortChipProps('ultracode').sx(lightTheme)).toEqual({ bgcolor: '#388e3c', color: '#000' });
    });

    it('effortChipProps falls back to high styling for null/unknown (NOT the xhigh default)', () => {
        expect(effortChipProps(null).sx(darkTheme)).toEqual({ bgcolor: '#ffd54f', color: '#000' });
        expect(effortChipProps('bogus').sx(darkTheme)).toEqual({ bgcolor: '#ffd54f', color: '#000' });
        expect(effortChipProps(null).sx(lightTheme)).toEqual({ bgcolor: 'rgb(165, 138, 51)', color: '#000' });
    });

    it('effortFillColor resolves per mode directly (no theme object required)', () => {
        expect(effortFillColor('xhigh', 'dark')).toBe('#81c784');
        expect(effortFillColor('xhigh', 'light')).toBe('rgb(99, 153, 101)');
        expect(effortFillColor('ultracode', 'light')).toBe('#388e3c');
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
