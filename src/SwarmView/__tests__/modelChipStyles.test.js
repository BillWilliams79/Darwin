import { describe, it, expect } from 'vitest';
import {
    AI_MODEL_COLOR,
    AI_MODELS,
    aiModelLabel,
    aiModelChipProps,
} from '../modelChipStyles';
import { COORDINATION_COLOR } from '../coordinationChipStyles';

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

    it('aiModelChipProps yields a filled chip (bg + black text) per model', () => {
        expect(aiModelChipProps('haiku')).toEqual({ sx: { bgcolor: '#e57373', color: '#000' } });
        expect(aiModelChipProps('sonnet')).toEqual({ sx: { bgcolor: '#ffd54f', color: '#000' } });
        expect(aiModelChipProps('opus')).toEqual({ sx: { bgcolor: '#81c784', color: '#000' } });
        expect(aiModelChipProps('fable')).toEqual({ sx: { bgcolor: '#388e3c', color: '#000' } });
    });

    it('aiModelChipProps falls back to opus styling for null/unknown', () => {
        expect(aiModelChipProps(null)).toEqual({ sx: { bgcolor: '#81c784', color: '#000' } });
        expect(aiModelChipProps('bogus')).toEqual({ sx: { bgcolor: '#81c784', color: '#000' } });
    });
});
