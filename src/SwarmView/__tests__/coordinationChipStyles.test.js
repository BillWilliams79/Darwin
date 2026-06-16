import { describe, it, expect } from 'vitest';
import {
    COORDINATION_COLOR,
    coordinationIconColor,
    coordinationChipProps,
} from '../coordinationChipStyles';

// req #2866 — coordination icon/chip colors follow the autonomy progression
// pink (least autonomy) → green (most): discuss·planned·implemented·deployed.
describe('coordinationChipStyles (req #2866)', () => {
    it('maps the four coordination types to the autonomy-progression hues', () => {
        expect(COORDINATION_COLOR.discuss).toBe('#f48fb1');     // pink
        expect(COORDINATION_COLOR.planned).toBe('#ce93d8');     // purple
        expect(COORDINATION_COLOR.implemented).toBe('#90caf9'); // blue
        expect(COORDINATION_COLOR.deployed).toBe('#a5d6a7');    // green
    });

    it('coordinationIconColor returns the mapped hex for each type', () => {
        expect(coordinationIconColor('discuss')).toBe('#f48fb1');
        expect(coordinationIconColor('planned')).toBe('#ce93d8');
        expect(coordinationIconColor('implemented')).toBe('#90caf9');
        expect(coordinationIconColor('deployed')).toBe('#a5d6a7');
    });

    it('coordinationIconColor returns undefined for unknown/unset', () => {
        expect(coordinationIconColor(null)).toBeUndefined();
        expect(coordinationIconColor(undefined)).toBeUndefined();
        expect(coordinationIconColor('')).toBeUndefined();
        expect(coordinationIconColor('bogus')).toBeUndefined();
    });

    it('coordinationChipProps yields a filled chip (pastel bg + black text) per type', () => {
        expect(coordinationChipProps('discuss')).toEqual({ sx: { bgcolor: '#f48fb1', color: '#000' } });
        expect(coordinationChipProps('planned')).toEqual({ sx: { bgcolor: '#ce93d8', color: '#000' } });
        expect(coordinationChipProps('implemented')).toEqual({ sx: { bgcolor: '#90caf9', color: '#000' } });
        expect(coordinationChipProps('deployed')).toEqual({ sx: { bgcolor: '#a5d6a7', color: '#000' } });
    });

    it('coordinationChipProps falls back to the MUI default chip for unknown/unset', () => {
        expect(coordinationChipProps(null)).toEqual({ color: 'default' });
        expect(coordinationChipProps(undefined)).toEqual({ color: 'default' });
        expect(coordinationChipProps('bogus')).toEqual({ color: 'default' });
    });
});
