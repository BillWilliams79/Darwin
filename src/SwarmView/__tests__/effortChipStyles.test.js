import { describe, it, expect } from 'vitest';
import {
    EFFORT_COLOR,
    EFFORTS,
    effortLabel,
    effortChipProps,
    effortFillColor,
    effortIconColor,
    effortPulses,
    effortDistinctColor,
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
    // req #3455 re-cut the ramp: `medium` is hardly ever selected, so it no
    // longer holds a hue of its own — it sits beside `low` as a lighter red and
    // recedes, freeing the greens for the three rungs that carry real traffic.
    it('maps the five efforts to the re-cut red → green ramp (req #3455)', () => {
        expect(EFFORT_COLOR.low).toBe('#e57373');       // red
        expect(EFFORT_COLOR.medium).toBe('#ef9a9a');    // LIGHT red — adjacent to low
        expect(EFFORT_COLOR.high).toBe('#81c784');      // light green
        expect(EFFORT_COLOR.xhigh).toBe('#388e3c');     // dark green
        expect(EFFORT_COLOR.ultracode).toBe('#388e3c'); // dark green, same as xhigh
    });

    it('groups medium WITH low rather than giving it its own hue', () => {
        // The point of the re-cut. If a future change gives medium a distinct
        // hue again, this is the assertion that should be argued with first.
        expect(EFFORT_COLOR.medium).not.toBe(EFFORT_COLOR.high);
        expect(EFFORT_COLOR.medium).not.toBe(EFFORT_COLOR.xhigh);
    });

    // ultracode and xhigh SHARE a fill on purpose. Motion is the differentiator,
    // and the label is the differentiator that survives reduced-motion, a
    // screenshot, and colour-blindness — so the shared hue costs nothing.
    it('ultracode shares xhigh green and is told apart by the pulse', () => {
        expect(EFFORT_COLOR.ultracode).toBe(EFFORT_COLOR.xhigh);
        expect(effortPulses('ultracode')).toBe(true);
        expect(effortPulses('xhigh')).toBe(false);
        expect(effortLabel('ultracode')).not.toBe(effortLabel('xhigh'));
    });

    // Sharing xhigh's green is right for a chip (motion + a written label tell
    // them apart) and WRONG for a mark that has neither: the effort pie, its
    // legend swatch, and ModelEffortIcon's bare bolt glyph. Live production
    // effort is {high 955, xhigh 151, medium 17, low 3, ultracode 1}, so two
    // identically-filled slices with different legend rows was reachable today.
    it('effortDistinctColor separates xhigh from ultracode for label-less marks', () => {
        expect(effortDistinctColor('ultracode')).not.toBe(effortDistinctColor('xhigh'));
        expect(effortDistinctColor('xhigh')).toBe(EFFORT_COLOR.xhigh);
    });

    it('effortDistinctColor changes ONLY ultracode', () => {
        for (const e of ['low', 'medium', 'high', 'xhigh']) {
            expect(effortDistinctColor(e)).toBe(EFFORT_COLOR[e]);
        }
    });

    it('the glyph colour uses the distinct ramp — it has no label at all', () => {
        expect(effortIconColor('ultracode')).not.toBe(effortIconColor('xhigh'));
    });

    it('no other effort pulses', () => {
        for (const e of ['low', 'medium', 'high', 'xhigh', null, 'bogus']) {
            expect(effortPulses(e)).toBe(false);
        }
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
        expect(EFFORT_COLOR.xhigh).toBe(AI_MODEL_COLOR.fable);     // dark green
        expect(EFFORT_COLOR.high).toBe(AI_MODEL_COLOR.opus);       // light green
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
        expect(effortChipProps('medium').sx(darkTheme)).toEqual({ bgcolor: '#ef9a9a', color: '#000' });
        expect(effortChipProps('high').sx(darkTheme)).toEqual({ bgcolor: '#81c784', color: '#000' });
        expect(effortChipProps('xhigh').sx(darkTheme)).toEqual({ bgcolor: '#388e3c', color: '#000' });
        expect(effortChipProps('ultracode').sx(darkTheme)).toEqual({ bgcolor: '#388e3c', color: '#000' });
    });

    // req #3053 — light mode darkens the four pastel rungs so the fill clears
    // 3:1 against a white card instead of reading as a washed-out grey patch.
    // Ultracode is untouched: it already sits at the dark green-700 step.
    // req #3455 re-cut: the rungs needing help CHANGED with the palette. Only
    // low/medium (reds) and high (light green) are pastel now; xhigh and
    // ultracode are both the shade-700 dark green, which clears the surface
    // floor unaided — the exemption ultracode already had, now covering both.
    it('effortChipProps darkens only the pastel rungs in light mode', () => {
        expect(effortChipProps('low').sx(lightTheme)).toEqual({ bgcolor: 'rgb(217, 109, 109)', color: '#000' });
        expect(effortChipProps('medium').sx(lightTheme)).toEqual({ bgcolor: 'rgb(195, 126, 126)', color: '#000' });
        expect(effortChipProps('high').sx(lightTheme)).toEqual({ bgcolor: 'rgb(99, 153, 101)', color: '#000' });
        expect(effortChipProps('xhigh').sx(lightTheme)).toEqual({ bgcolor: '#388e3c', color: '#000' });
        expect(effortChipProps('ultracode').sx(lightTheme)).toEqual({ bgcolor: '#388e3c', color: '#000' });
    });

    it('effortChipProps falls back to high styling for null/unknown (NOT the xhigh default)', () => {
        expect(effortChipProps(null).sx(darkTheme)).toEqual({ bgcolor: '#81c784', color: '#000' });
        expect(effortChipProps('bogus').sx(darkTheme)).toEqual({ bgcolor: '#81c784', color: '#000' });
        expect(effortChipProps(null).sx(lightTheme)).toEqual({ bgcolor: 'rgb(99, 153, 101)', color: '#000' });
    });

    it('effortFillColor resolves per mode directly (no theme object required)', () => {
        expect(effortFillColor('high', 'dark')).toBe('#81c784');
        expect(effortFillColor('high', 'light')).toBe('rgb(99, 153, 101)');
        expect(effortFillColor('xhigh', 'light')).toBe('#388e3c');
        expect(effortFillColor('ultracode', 'light')).toBe('#388e3c');
    });

    // req #3046 — Effort renders as a small icon (glyph FILL = ramp hex).
    it('effortIconColor returns the DISTINCT ramp hex per effort', () => {
        expect(effortIconColor('low')).toBe('#e57373');
        expect(effortIconColor('medium')).toBe('#ef9a9a');
        expect(effortIconColor('high')).toBe('#81c784');
        expect(effortIconColor('xhigh')).toBe('#388e3c');
        expect(effortIconColor('ultracode')).toBe('#1b5e20');  // distinct ramp
    });

    it('effortIconColor falls back to high color for null/unknown (NOT the xhigh default)', () => {
        expect(effortIconColor(null)).toBe('#81c784');
        expect(effortIconColor('bogus')).toBe('#81c784');
    });
});
