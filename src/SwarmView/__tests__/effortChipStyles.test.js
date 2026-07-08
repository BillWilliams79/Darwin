import { describe, it, expect } from 'vitest';
import {
    EFFORT_COLOR,
    EFFORTS,
    effortLabel,
    effortChipProps,
} from '../effortChipStyles';
import { AI_MODEL_COLOR } from '../modelChipStyles';
import { COORDINATION_COLOR } from '../coordinationChipStyles';

// req #2916 — effort chip palette: low·medium·high·xhigh·ultracode, thermal
// intensity ramp grey → red, distinct from the model and autonomy palettes.
describe('effortChipStyles (req #2916)', () => {
    it('maps the five efforts to the thermal intensity ramp', () => {
        expect(EFFORT_COLOR.low).toBe('#e0e0e0');       // grey
        expect(EFFORT_COLOR.medium).toBe('#fff59d');    // yellow
        expect(EFFORT_COLOR.high).toBe('#ffb74d');      // orange
        expect(EFFORT_COLOR.xhigh).toBe('#ff8a65');     // deep orange
        expect(EFFORT_COLOR.ultracode).toBe('#e57373'); // red
    });

    it('EFFORTS lists all five in intensity order', () => {
        expect(EFFORTS).toEqual(['low', 'medium', 'high', 'xhigh', 'ultracode']);
    });

    it('shares no hue with the model or autonomy palettes (chips must be distinguishable)', () => {
        const effortHues = Object.values(EFFORT_COLOR);
        const modelHues = Object.values(AI_MODEL_COLOR);
        const coordHues = Object.values(COORDINATION_COLOR);
        expect(effortHues.filter(h => modelHues.includes(h))).toEqual([]);
        expect(effortHues.filter(h => coordHues.includes(h))).toEqual([]);
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

    it('effortChipProps yields a filled chip (pastel bg + black text) per effort', () => {
        expect(effortChipProps('low')).toEqual({ sx: { bgcolor: '#e0e0e0', color: '#000' } });
        expect(effortChipProps('medium')).toEqual({ sx: { bgcolor: '#fff59d', color: '#000' } });
        expect(effortChipProps('high')).toEqual({ sx: { bgcolor: '#ffb74d', color: '#000' } });
        expect(effortChipProps('xhigh')).toEqual({ sx: { bgcolor: '#ff8a65', color: '#000' } });
        expect(effortChipProps('ultracode')).toEqual({ sx: { bgcolor: '#e57373', color: '#000' } });
    });

    it('effortChipProps falls back to high styling for null/unknown (NOT the xhigh default)', () => {
        expect(effortChipProps(null)).toEqual({ sx: { bgcolor: '#ffb74d', color: '#000' } });
        expect(effortChipProps('bogus')).toEqual({ sx: { bgcolor: '#ffb74d', color: '#000' } });
    });
});
