// @vitest-environment node
//
// req #4045 — a plate's text is fitted to the face it is printed on: wrapped
// to its lines, the overflow cut with an ellipsis, never drawn past the edge.

import { describe, it, expect } from 'vitest';
import { wrap } from '../pipelineGroupScene';

// A measuring context where every character is 10 px wide.
const g = { measureText: (s) => ({ width: s.length * 10 }) };

describe('wrap', () => {
    it('keeps a line that fits whole', () => {
        expect(wrap(g, 'Meta AI plan', 200, 1)).toEqual({ lines: ['Meta AI plan'], fits: true });
    });

    it('wraps onto the lines it is allowed', () => {
        expect(wrap(g, 'alpha beta gamma', 110, 2)).toEqual({ lines: ['alpha beta', 'gamma'], fits: true });
    });

    it('cuts what does not fit with an ellipsis, inside the width', () => {
        const r = wrap(g, 'alpha beta gamma delta', 100, 2);
        expect(r.fits).toBe(false);
        expect(r.lines[0]).toBe('alpha beta');
        expect(r.lines[1].endsWith('…')).toBe(true);
        for (const l of r.lines) expect(l.length * 10).toBeLessThanOrEqual(100);
    });

    it('cuts a single word longer than the face', () => {
        const r = wrap(g, 'Supercalifragilistic', 80, 1);
        expect(r.fits).toBe(false);
        expect(r.lines[0].length * 10).toBeLessThanOrEqual(80);
    });

    it('an empty text is no lines', () => {
        expect(wrap(g, '', 100, 2)).toEqual({ lines: [], fits: true });
    });
});
