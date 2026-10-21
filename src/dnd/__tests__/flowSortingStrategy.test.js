// req #3664 — chips of different widths reflow as a wrapping row does.

import { describe, it, expect } from 'vitest';
import { flowLayout, flowSortingStrategy } from '../flowSortingStrategy';

const r = (left, top, width, height = 24) => ({ left, top, width, height });

describe('flowLayout', () => {
    // A(120) B(60) C(120) on one line, 4 px apart.
    const line = [r(0, 0, 120), r(124, 0, 60), r(188, 0, 120)];

    it('moving the wide first chip to the end puts each neighbour where it will sit', () => {
        const at = flowLayout(line, 0, 2);
        expect(at[1]).toEqual({ left: 0, top: 0 });     // B
        expect(at[2]).toEqual({ left: 64, top: 0 });    // C — not 124, B's old slot
        expect(at[0]).toEqual({ left: 188, top: 0 });   // A
    });

    it('wraps at the row\'s right edge, one line pitch down', () => {
        const two = [r(0, 0, 100), r(104, 0, 100), r(0, 28, 150)];
        const at = flowLayout(two, 2, 0);                // the wide one first
        expect(at[2]).toEqual({ left: 0, top: 0 });
        expect(at[0]).toEqual({ left: 0, top: 28 });     // 154 + 100 > 204: wraps
        expect(at[1]).toEqual({ left: 104, top: 28 });
    });

    it('nothing moves when nothing has moved', () => {
        expect(flowLayout(line, 1, 1)).toEqual(line.map(({ left, top }) => ({ left, top })));
    });
});

describe('flowSortingStrategy', () => {
    it('is a translate, never a scale', () => {
        const rects = [r(0, 0, 120), r(124, 0, 60), r(188, 0, 120)];
        expect(flowSortingStrategy({ rects, activeIndex: 0, overIndex: 2, index: 2 }))
            .toEqual({ x: -124, y: 0, scaleX: 1, scaleY: 1 });
    });
});
