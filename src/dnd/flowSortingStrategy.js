// flowSortingStrategy — sibling reflow for a wrapping row of items of
// different widths (req #3664: the Maps view-chip bar).
//
// dnd-kit's rect strategy moves each item to the slot of the item it displaces
// — right for a grid of equal cells, wrong for chips: a wide chip moved into a
// narrow chip's slot overlaps its neighbour, because the foundation translates
// and never scales (useDarwinDrag). This lays the reordered items out the way
// `flex-wrap` does — left to right, the measured gap between them, wrapping at
// the row's right edge — and moves each item to where it will actually sit.

import { arrayMove } from '@dnd-kit/sortable';

/** Where every item sits once `from` has moved to `to`, laid out as the row flows. */
export function flowLayout(rects, from, to) {
    if (!rects.length) return [];
    const left = Math.min(...rects.map(r => r.left));
    const right = Math.max(...rects.map(r => r.left + r.width));
    const top = Math.min(...rects.map(r => r.top));
    // The gap between neighbours on one line, as rendered.
    let gap = 0;
    for (let i = 1; i < rects.length; i++) {
        const a = rects[i - 1], b = rects[i];
        if (Math.abs(a.top - b.top) < 1) { gap = Math.max(0, b.left - (a.left + a.width)); break; }
    }
    // Line pitch: the next line's top below the first, else a row plus the gap.
    const second = rects.find(r => r.top > top + 1);
    const pitch = second ? second.top - top : Math.max(...rects.map(r => r.height)) + gap;

    const order = arrayMove(rects.map((r, i) => i), from, to);
    const placed = new Array(rects.length);
    let x = left, line = 0;
    order.forEach(i => {
        const w = rects[i].width;
        if (x > left && x + w > right + 0.5) { x = left; line += 1; }
        placed[i] = { left: x, top: top + line * pitch };
        x += w + gap;
    });
    return placed;
}

export function flowSortingStrategy({ rects, activeIndex, overIndex, index }) {
    if (activeIndex < 0 || overIndex < 0 || !rects[index]) return null;
    const at = flowLayout(rects, activeIndex, overIndex)[index];
    if (!at) return null;
    return { x: at.left - rects[index].left, y: at.top - rects[index].top, scaleX: 1, scaleY: 1 };
}
