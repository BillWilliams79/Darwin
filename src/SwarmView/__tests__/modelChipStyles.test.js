import { describe, it, expect } from 'vitest';
import {
    AI_MODEL_COLOR,
    AI_MODELS,
    aiModelLabel,
    aiModelChipProps,
    modelFillColor,
    aiModelIconColor,
} from '../modelChipStyles';
import { COORDINATION_COLOR } from '../coordinationChipStyles';

const lightTheme = { palette: { mode: 'light' } };
const darkTheme = { palette: { mode: 'dark' } };

// req #2909 — ai_model chip palette: haiku·sonnet·opus·fable. Recolored to a
// red → green capability ramp in req #3044 (red = least capable, dark green =
// frontier); still distinct from the autonomy palette.
describe('modelChipStyles (req #2909, recolored #3044)', () => {
    it('maps the four models to the red → green capability ramp', () => {
        expect(AI_MODEL_COLOR.haiku).toBe('#e57373');  // red
        expect(AI_MODEL_COLOR.sonnet).toBe('#ffd54f'); // amber
        expect(AI_MODEL_COLOR.opus).toBe('#81c784');   // light green
        expect(AI_MODEL_COLOR.fable).toBe('#388e3c');  // dark green
    });

    it('AI_MODELS lists all four in capability order', () => {
        expect(AI_MODELS).toEqual(['haiku', 'sonnet', 'opus', 'fable']);
    });

    it('shares no hue with the autonomy palette (chips must be distinguishable)', () => {
        const modelHues = Object.values(AI_MODEL_COLOR);
        const coordHues = Object.values(COORDINATION_COLOR);
        expect(modelHues.filter(h => coordHues.includes(h))).toEqual([]);
    });

    it('aiModelLabel capitalizes each known model', () => {
        expect(aiModelLabel('haiku')).toBe('Haiku');
        expect(aiModelLabel('sonnet')).toBe('Sonnet');
        expect(aiModelLabel('opus')).toBe('Opus');
        expect(aiModelLabel('fable')).toBe('Fable');
    });

    it('aiModelLabel falls back to Opus for null/unknown (pre-#2909 backfill rule)', () => {
        expect(aiModelLabel(null)).toBe('Opus');
        expect(aiModelLabel(undefined)).toBe('Opus');
        expect(aiModelLabel('')).toBe('Opus');
        expect(aiModelLabel('gpt4')).toBe('Opus');
    });

    // req #3053 — dark mode keeps the original ramp verbatim (already clears
    // 3.6–10.5:1 against the dark card surface).
    it('aiModelChipProps yields the original ramp + black text in dark mode', () => {
        expect(aiModelChipProps('haiku').sx(darkTheme)).toEqual({ bgcolor: '#e57373', color: '#000' });
        expect(aiModelChipProps('sonnet').sx(darkTheme)).toEqual({ bgcolor: '#ffd54f', color: '#000' });
        expect(aiModelChipProps('opus').sx(darkTheme)).toEqual({ bgcolor: '#81c784', color: '#000' });
        expect(aiModelChipProps('fable').sx(darkTheme)).toEqual({ bgcolor: '#388e3c', color: '#000' });
    });

    // req #3053 — light mode darkens the three pastel rungs so the fill clears
    // 3:1 against a white card instead of reading as a washed-out grey patch.
    // Fable is untouched: it already sits at the dark green-700 step.
    it('aiModelChipProps darkens the pastel rungs (not fable) in light mode', () => {
        expect(aiModelChipProps('haiku').sx(lightTheme)).toEqual({ bgcolor: 'rgb(217, 109, 109)', color: '#000' });
        expect(aiModelChipProps('sonnet').sx(lightTheme)).toEqual({ bgcolor: 'rgb(165, 138, 51)', color: '#000' });
        expect(aiModelChipProps('opus').sx(lightTheme)).toEqual({ bgcolor: 'rgb(99, 153, 101)', color: '#000' });
        expect(aiModelChipProps('fable').sx(lightTheme)).toEqual({ bgcolor: '#388e3c', color: '#000' });
    });

    it('aiModelChipProps falls back to opus styling for null/unknown', () => {
        expect(aiModelChipProps(null).sx(darkTheme)).toEqual({ bgcolor: '#81c784', color: '#000' });
        expect(aiModelChipProps('bogus').sx(darkTheme)).toEqual({ bgcolor: '#81c784', color: '#000' });
        expect(aiModelChipProps(null).sx(lightTheme)).toEqual({ bgcolor: 'rgb(99, 153, 101)', color: '#000' });
    });

    it('modelFillColor resolves per mode directly (no theme object required)', () => {
        expect(modelFillColor('opus', 'dark')).toBe('#81c784');
        expect(modelFillColor('opus', 'light')).toBe('rgb(99, 153, 101)');
        expect(modelFillColor('fable', 'light')).toBe('#388e3c');
    });

    // req #3046 — Model renders as a small icon (glyph FILL = ramp hex).
    it('aiModelIconColor returns the ramp hex per model', () => {
        expect(aiModelIconColor('haiku')).toBe('#e57373');
        expect(aiModelIconColor('sonnet')).toBe('#ffd54f');
        expect(aiModelIconColor('opus')).toBe('#81c784');
        expect(aiModelIconColor('fable')).toBe('#388e3c');
    });

    it('aiModelIconColor falls back to opus color for null/unknown', () => {
        expect(aiModelIconColor(null)).toBe('#81c784');
        expect(aiModelIconColor('bogus')).toBe('#81c784');
    });
});
