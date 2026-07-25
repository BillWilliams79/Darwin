// req #3053 — the Agents card's model pin chip used a hardcoded black text +
// pastel fill regardless of theme.palette.mode. Against a white light-mode
// card the pastel fill measures well under 3:1 (verified with dataviz's
// validate_palette.js `contrast()`), reading as a washed-out, near-grey patch
// even though the black text on it is independently legible. agentModelChipProps
// now resolves its fill through modelChipStyles.js's mode-aware modelFillColor.

import { describe, it, expect } from 'vitest';
import { agentModelChipProps, agentModelLabel } from '../agentRegistryUtils';

const lightTheme = { palette: { mode: 'light' } };
const darkTheme = { palette: { mode: 'dark' } };

describe('agentModelChipProps (req #3053)', () => {
    it('extracts the base model from the frontmatter-style pin ("opus[1m]" -> opus)', () => {
        expect(agentModelChipProps('opus[1m]').sx(darkTheme)).toEqual({ bgcolor: '#81c784', color: '#000' });
    });

    it('keeps the original ramp unchanged in dark mode (already clears the dark card)', () => {
        expect(agentModelChipProps('haiku').sx(darkTheme)).toEqual({ bgcolor: '#e57373', color: '#000' });
        expect(agentModelChipProps('opus[1m]').sx(darkTheme)).toEqual({ bgcolor: '#81c784', color: '#000' });
        expect(agentModelChipProps('fable[1m]').sx(darkTheme)).toEqual({ bgcolor: '#388e3c', color: '#000' });
    });

    it('darkens the pastel rungs (not fable) in light mode so the fill clears 3:1 on white', () => {
        expect(agentModelChipProps('haiku').sx(lightTheme)).toEqual({ bgcolor: 'rgb(217, 109, 109)', color: '#000' });
        expect(agentModelChipProps('opus[1m]').sx(lightTheme)).toEqual({ bgcolor: 'rgb(99, 153, 101)', color: '#000' });
        expect(agentModelChipProps('fable[1m]').sx(lightTheme)).toEqual({ bgcolor: '#388e3c', color: '#000' });
    });

    it('falls back to opus styling for null/unknown, per mode', () => {
        expect(agentModelChipProps(null).sx(darkTheme)).toEqual({ bgcolor: '#81c784', color: '#000' });
        expect(agentModelChipProps(null).sx(lightTheme)).toEqual({ bgcolor: 'rgb(99, 153, 101)', color: '#000' });
    });

    it('agentModelLabel shows the stored value verbatim (keeps the [1m] suffix)', () => {
        expect(agentModelLabel('opus[1m]')).toBe('opus[1m]');
        expect(agentModelLabel(null)).toBe('—');
    });
});
