// Req #3857 — the pure half of an Action Popup locked into a page's title bar:
// it is drawn where it was dropped, only in the bar's free space, never over
// the bar's own elements.

import { describe, it, expect } from 'vitest';

import {
    TITLE_BAR_MARGIN, freeGaps, lockFromDrop, onTitleBar, titleBarLine, titleBarPlace, validLock,
} from '../titleBarLock';

const r = (left, right, top = 24, bottom = 56) => ({ left, right, top, bottom,
    width: right - left, height: bottom - top });
/** The Plan page's header row, as filed from (req #3857's capture): 204–1896, y 24–56. */
const BAR = r(204, 1896);
const LIMITS = { minW: 120, headPx: 30.4 };

describe('validLock', () => {
    it('takes a side and a non-negative offset, nothing else', () => {
        expect(validLock({ side: 'l', x: 0 })).toEqual({ side: 'l', x: 0 });
        expect(validLock({ side: 'r', x: 40 })).toEqual({ side: 'r', x: 40 });
        [null, undefined, {}, { side: 'x', x: 1 }, { side: 'l', x: -1 }, { side: 'l', x: NaN }, { side: 'r' }]
            .forEach(v => expect(validLock(v)).toBeNull());
    });
});

describe('lockFromDrop', () => {
    it('locks to the nearer end of the bar, by the panel centre', () => {
        expect(lockFromDrop({ left: 684, width: 171 }, BAR)).toEqual({ side: 'l', x: 480 });
        expect(lockFromDrop({ left: 1500, width: 171 }, BAR)).toEqual({ side: 'r', x: 225 });
    });
    it('never takes a negative offset', () => {
        expect(lockFromDrop({ left: 150, width: 171 }, BAR)).toEqual({ side: 'l', x: 0 });
    });
});

describe('freeGaps', () => {
    it('is the bar between what it draws, kept a margin clear of each', () => {
        const gaps = freeGaps(BAR, [r(204, 400), r(500, 600), r(1700, 1896)]);
        expect(gaps).toEqual([
            { left: 400 + TITLE_BAR_MARGIN, right: 500 - TITLE_BAR_MARGIN },
            { left: 600 + TITLE_BAR_MARGIN, right: 1700 - TITLE_BAR_MARGIN },
        ]);
    });
    it('merges overlapping items and ignores ones off the bar', () => {
        const gaps = freeGaps(BAR, [r(300, 400), r(350, 450), r(0, 100), r(600, 700, 80, 100)]);
        expect(gaps).toEqual([{ left: 204, right: 292 }, { left: 458, right: 1896 }]);
    });
    it('an empty bar is one gap end to end', () => {
        expect(freeGaps(BAR, [])).toEqual([{ left: 204, right: 1896 }]);
    });
    it('a wrapped bar\'s later lines are occupied too: an open popup\'s rows never cover them', () => {
        const tall = r(204, 1896, 24, 124);
        expect(freeGaps(tall, [r(204, 400, 24, 64), r(204, 900, 80, 120)]))
            .toEqual([{ left: 908, right: 1896 }]);
    });
});

describe('titleBarLine', () => {
    it('a one-line bar is its own line', () => {
        expect(titleBarLine(BAR, [], 30.4)).toEqual({ top: 24, height: 32 });
    });
    it('a wrapped bar centres on its first line', () => {
        const tall = r(204, 1896, 24, 124);
        expect(titleBarLine(tall, [r(204, 300, 24, 64), r(204, 300, 80, 120)], 30.4))
            .toEqual({ top: 24, height: 40 });
    });
});

describe('titleBarPlace', () => {
    const items = [r(204, 400), r(500, 600), r(1700, 1896)];

    it('is drawn exactly where it was dropped, in free space, head on the bar line', () => {
        const p = titleBarPlace({ side: 'l', x: 480 }, BAR, items, 171, LIMITS);
        expect(p).toEqual({ left: 684, top: 25, width: 171 });
    });
    it('a right lock keeps its offset from the right end', () => {
        const p = titleBarPlace({ side: 'r', x: 225 }, BAR, items, 171, LIMITS);
        expect(p.left + p.width).toBe(1896 - 225);
    });
    it('never covers the bar\'s own elements: over one, it goes to the nearest gap', () => {
        // Dropped over the 500–600 control: the gap right of it is nearer.
        const p = titleBarPlace({ side: 'l', x: 380 }, BAR, items, 171, LIMITS);
        expect(p.left).toBe(608);
        items.forEach(o => expect(p.left + p.width <= o.left || p.left >= o.right).toBe(true));
    });
    it('a gap narrower than its content narrows it, down to the minimum', () => {
        const crowded = [r(204, 900), r(1050, 1896)];
        const p = titleBarPlace({ side: 'l', x: 720 }, BAR, crowded, 171, LIMITS);
        expect(p).toEqual({ left: 908, top: 25, width: 134 });
    });
    it('with no gap the minimum wide, it is not drawn in the bar (it floats)', () => {
        expect(titleBarPlace({ side: 'l', x: 0 }, BAR, [r(204, 1000), r(1100, 1896)], 171, LIMITS)).toBeNull();
    });
    it('the bar\'s elements are not moved — the placement reads them, never writes', () => {
        const before = JSON.stringify(items);
        titleBarPlace({ side: 'l', x: 10 }, BAR, items, 171, LIMITS);
        expect(JSON.stringify(items)).toBe(before);
    });
});

describe('onTitleBar', () => {
    it('hit-tests the bar, edges included', () => {
        expect(onTitleBar(204, 24, BAR)).toBe(true);
        expect(onTitleBar(1000, 40, BAR)).toBe(true);
        expect(onTitleBar(1000, 60, BAR)).toBe(false);
        expect(onTitleBar(100, 40, BAR)).toBe(false);
        expect(onTitleBar(1000, 40, null)).toBe(false);
    });
});
