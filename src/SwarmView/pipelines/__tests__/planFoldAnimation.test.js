// req #3695 — a collapsed epic has no rectangle, is a floating title bar, and
// its fold ANIMATES: the layout half (`foldReveal`), the title bar's width
// (`placeEpicChips`), and the animation's own arithmetic.

import { describe, it, expect } from 'vitest';

import {
    computePlanLayout, placeEpicChips, EPIC_BAR_W,
} from '../pipelinePlanLayout';
import {
    easeInOutCubic, foldRevealAt, foldAnimDone, startFoldAnim, foldContentAlpha,
    FOLD_ANIM_MS,
} from '../planFoldAnimation';

const mk = (id, epicId, depIds = [], reqIds = []) => ({
    id, title: `step ${id}`, run: 'auto', state: 'pending', reqIds,
    depIds, timeDeps: [], epicId, epic: `epic-${epicId}`,
    epicLabels: [], featureLabels: [], machineLabels: [], machineLabel: '—',
});

// Epic 5 holds a chain 10 -> 11 over two lanes' worth of work; epic 6 holds
// 12, which waits on 11 (a cross-epic arc into the animating band).
const ROWS = [
    mk(10, 5, [], [101, 102, 103]),
    mk(11, 5, [10], [104]),
    mk(13, 5, [], [107]),
    mk(12, 6, [11], [105, 106]),
];
const band = (l, id) => l.bands.find((b) => b.epicId === id);
const FOLD5 = new Set([5]);

describe('a band\'s reveal (req #3695)', () => {
    const open = computePlanLayout(ROWS);
    const folded = computePlanLayout(ROWS, { collapsedEpicIds: FOLD5 });

    it('is 1 open and 0 folded on every settled layout, which stamps no reveal on anything', () => {
        expect(band(open, 5).reveal).toBe(1);
        expect(band(folded, 5).reveal).toBe(0);
        expect(band(folded, 6).reveal).toBe(1);
        for (const l of [open, folded]) {
            for (const n of l.nodes.values()) expect(n).not.toHaveProperty('reveal');
            for (const a of l.arcs) expect(a).not.toHaveProperty('reveal');
            for (const x of l.labels) expect(x).not.toHaveProperty('reveal');
        }
    });

    it('a full reveal draws exactly the open layout, a zero one exactly the folded layout', () => {
        const full = computePlanLayout(ROWS, { foldReveal: new Map([[5, 1]]) });
        expect(full.height).toBe(open.height);
        for (const [id, n] of open.nodes) expect(full.nodes.get(id)).toEqual(n);
        const none = computePlanLayout(ROWS, {
            collapsedEpicIds: FOLD5, foldReveal: new Map([[5, 0]]) });
        expect(none.height).toBe(folded.height);
        expect([...none.nodes.keys()]).toEqual([...folded.nodes.keys()]);
    });

    it('mid-fold, the box is part-way between its folded and open heights and the epic below slides with it', () => {
        const half = computePlanLayout(ROWS, {
            collapsedEpicIds: FOLD5, foldReveal: new Map([[5, 0.5]]) });
        const b = band(half, 5);
        // The reader's fold is unchanged by the drawing — the chevron reads it.
        expect(b.collapsed).toBe(true);
        expect(b.reveal).toBe(0.5);
        const lanesOpen = band(open, 5).height - band(open, 5).headerH;
        expect(b.height).toBeCloseTo(b.headerH + lanesOpen / 2, 6);
        expect(band(half, 6).y).toBeCloseTo(
            (band(open, 6).y + band(folded, 6).y) / 2, 6);
        // The epic below never moves sideways.
        expect(half.nodes.get(12).x).toBe(open.nodes.get(12).x);
    });

    it('stamps the reveal on the band\'s cards, their labels and the arcs touching them — only those', () => {
        const rv = computePlanLayout(ROWS, { foldReveal: new Map([[5, 0.3]]) });
        for (const id of [10, 11, 13]) {
            expect(rv.nodes.get(id).reveal).toBe(0.3);
            const labels = rv.labels.filter((l) => l.stepId === id);
            expect(labels.length).toBeGreaterThan(0);
            for (const l of labels) expect(l.reveal).toBe(0.3);
        }
        expect(rv.nodes.get(12)).not.toHaveProperty('reveal');
        for (const l of rv.labels.filter((x) => x.stepId === 12)) {
            expect(l).not.toHaveProperty('reveal');
        }
        // 10 -> 11 inside the band and 11 -> 12 across into epic 6 both fade.
        for (const a of rv.arcs) expect(a.reveal).toBe(0.3);
        // Every card of the band stays inside the band's top and the plan.
        const b = band(rv, 5);
        for (const id of [10, 11, 13]) {
            expect(rv.nodes.get(id).y).toBeGreaterThanOrEqual(b.y + b.headerH);
        }
    });

    it('clamps a reveal outside 0..1 and ignores one that is not a number', () => {
        const over = computePlanLayout(ROWS, { foldReveal: new Map([[5, 1.4]]) });
        expect(band(over, 5).height).toBe(band(open, 5).height);
        const junk = computePlanLayout(ROWS, {
            collapsedEpicIds: FOLD5, foldReveal: new Map([[5, 'x']]) });
        expect(band(junk, 5).reveal).toBe(0);
    });
});

describe('a folded epic is a floating title bar (req #3695)', () => {
    const viewport = { w: 1600, h: 900 };
    const t = { x: 0, y: 0, k: 1 };
    const bandOf = (over) => ({
        key: 5, epicId: 5, epic: 'Build', epicLabel: 'Build', color: '#4488cc',
        y: 0, height: 108, headerH: 108, epicLaneH: 108, ...over,
    });
    const chip = (over, worldWidth = 1600) => placeEpicChips({
        bands: [bandOf(over)], transform: t, viewport, worldWidth })[0];

    it('an open epic\'s chip is as wide as its name, and no bar', () => {
        const c = chip({ collapsed: false, reveal: 1 });
        expect(c.bar).toBe(0);
        expect(c.w).toBeLessThan(EPIC_BAR_W);
    });

    it('a folded epic\'s chip widens to the bar width', () => {
        const c = chip({ collapsed: true, reveal: 0 });
        expect(c.bar).toBe(1);
        expect(c.w).toBe(EPIC_BAR_W);
        expect(c.clipped).toBe(false);
        // Hand-built bands with no reveal answer from `collapsed`.
        expect(chip({ collapsed: true }).w).toBe(EPIC_BAR_W);
    });

    it('morphs between chip and bar with the fold', () => {
        const open = chip({ collapsed: false, reveal: 1 }).w;
        const half = chip({ collapsed: true, reveal: 0.5 });
        expect(half.bar).toBe(0.5);
        expect(half.w).toBeCloseTo((open + EPIC_BAR_W) / 2, 6);
    });

    it('never runs past the band\'s right edge, and never narrows a long name', () => {
        const narrow = chip({ collapsed: true, reveal: 0 }, 300);
        expect(narrow.x + narrow.w).toBeLessThanOrEqual(300 - 2);
        const long = 'A remarkably long epic name that outruns any title bar at all';
        const c = chip({ collapsed: true, reveal: 0, epic: long, epicLabel: long });
        expect(c.w).toBeGreaterThan(EPIC_BAR_W);
        expect(c.w).toBe(chip({ collapsed: false, reveal: 1, epic: long, epicLabel: long }).w);
    });
});

describe('the fold animation\'s arithmetic (req #3695)', () => {
    it('eases from 0 to 1, symmetric about the middle', () => {
        expect(easeInOutCubic(0)).toBe(0);
        expect(easeInOutCubic(1)).toBe(1);
        expect(easeInOutCubic(0.5)).toBeCloseTo(0.5, 9);
        expect(easeInOutCubic(0.25) + easeInOutCubic(0.75)).toBeCloseTo(1, 9);
        expect(easeInOutCubic(-1)).toBe(0);
        expect(easeInOutCubic(2)).toBe(1);
    });

    it('opens over the full duration and lands exactly', () => {
        const a = startFoldAnim(0, true, 1000);
        expect(a).toEqual({ from: 0, to: 1, start: 1000, dur: FOLD_ANIM_MS });
        expect(foldRevealAt(a, 1000)).toBe(0);
        expect(foldRevealAt(a, 1000 + FOLD_ANIM_MS / 2)).toBeCloseTo(0.5, 9);
        expect(foldAnimDone(a, 1000 + FOLD_ANIM_MS - 1)).toBe(false);
        expect(foldRevealAt(a, 1000 + FOLD_ANIM_MS)).toBe(1);
        expect(foldAnimDone(a, 1000 + FOLD_ANIM_MS)).toBe(true);
    });

    it('turns round mid-flight from where the band is, over the share that is left', () => {
        const back = startFoldAnim(0.3, true, 0);
        expect(back.from).toBe(0.3);
        expect(back.dur).toBeCloseTo(FOLD_ANIM_MS * 0.7, 9);
        const shut = startFoldAnim(0.3, false, 0);
        expect(shut.to).toBe(0);
        expect(shut.dur).toBeCloseTo(FOLD_ANIM_MS * 0.3, 9);
    });

    it('brings the cards in after the box has started to open, fully by the end', () => {
        expect(foldContentAlpha(undefined)).toBe(1);
        expect(foldContentAlpha(1)).toBe(1);
        expect(foldContentAlpha(0)).toBe(0);
        expect(foldContentAlpha(0.4)).toBe(0);
        expect(foldContentAlpha(0.7)).toBeCloseTo(0.5, 9);
    });
});
