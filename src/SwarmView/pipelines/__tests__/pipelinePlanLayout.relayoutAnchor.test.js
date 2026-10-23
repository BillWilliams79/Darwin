// Req #3688 — "when you hide and expand closed it should redraw the epic cards
// but not move the viewport around". The card the reader is looking at keeps its
// screen position across the Hide-closed relayout.

import { describe, it, expect } from 'vitest';
import {
    relayoutAnchorTransform, computePlanLayout, orderEpicReqs, hideClosedReqs,
} from '../pipelinePlanLayout';

const node = (id, left, top, w = 100, h = 80) => [id, {
    id, left, top, right: left + w, bottom: top + h, x: left + w / 2, y: top + h / 2,
}];
const lay = (...nodes) => ({ nodes: new Map(nodes) });
const SIZE = { w: 400, h: 300 };
const screenOf = (t, n) => ({ x: n.left * t.k + t.x, y: n.top * t.k + t.y });

describe('relayoutAnchorTransform (req #3688)', () => {
    it('holds the card nearest the viewport centre at the same screen position', () => {
        // Viewport at k=1, t=(0,-400) shows world y 400..700; centre (200, 550).
        const t = { x: 0, y: -400, k: 1 };
        const prev = lay(node(1, 0, 0), node(2, 150, 500), node(3, 150, 900));
        const next = lay(node(1, 0, 0), node(2, 150, 260), node(3, 150, 500));
        const out = relayoutAnchorTransform(prev, next, t, SIZE);
        expect(out.k).toBe(1);
        expect(screenOf(out, next.nodes.get(2))).toEqual(screenOf(t, prev.nodes.get(2)));
    });

    it('scales the shift by k', () => {
        const t = { x: -50, y: -200, k: 0.5 };
        const prev = lay(node(7, 300, 700), node(8, 300, 5000));
        const next = lay(node(7, 300, 400), node(8, 300, 4000));
        const out = relayoutAnchorTransform(prev, next, t, SIZE);
        expect(out).toEqual({ x: -50, y: -50, k: 0.5, anchor: 'epic:7' });
        expect(screenOf(out, next.nodes.get(7))).toEqual(screenOf(t, prev.nodes.get(7)));
    });

    it('ignores off-screen cards and cards the next layout does not place', () => {
        const t = { x: 0, y: 0, k: 1 };
        // 1 is on screen but folded away in `next`; 2 is off screen.
        const prev = lay(node(1, 10, 10), node(2, 2000, 2000));
        const next = lay(node(2, 2000, 1000));
        expect(relayoutAnchorTransform(prev, next, t, SIZE)).toBeNull();
    });

    it('answers null without a viewport or a camera', () => {
        const l = lay(node(1, 0, 0));
        expect(relayoutAnchorTransform(l, l, null, SIZE)).toBeNull();
        expect(relayoutAnchorTransform(l, l, { x: 0, y: 0, k: 1 }, { w: 0, h: 0 })).toBeNull();
        expect(relayoutAnchorTransform(null, l, { x: 0, y: 0, k: 1 }, SIZE)).toBeNull();
    });

    it('keeps a real plan card in place when its closed rows above disappear', () => {
        const status = { 1: 'met', 2: 'met', 3: 'met', 4: 'development', 5: 'approved' };
        const mk = (id, reqIds, depIds = []) => ({
            id, title: `epic ${id}`, run: 'auto', state: 'pending', reqIds,
            depIds, timeDeps: [], initiativeId: 5, initiative: 'e', initiativeLabels: [],
            featureLabels: [], machineLabels: [], machineLabel: '—',
        });
        // Two parallel epics in one column: epic 10 (three closed rows) sits
        // above epic 11 in the stack, so hiding closed moves 11 up.
        const rows = orderEpicReqs([mk(10, [1, 2, 3, 4]), mk(11, [5])],
            { statusOf: (id) => status[id] });
        const shown = computePlanLayout(rows);
        const hidden = computePlanLayout(hideClosedReqs(rows));
        const before = shown.nodes.get(11);
        const after = hidden.nodes.get(11);
        expect(after.top).not.toBe(before.top);
        // Camera centred on epic 11, zoomed in so not every card fits.
        const k = 3;
        const t = { k, x: SIZE.w / 2 - before.x * k, y: SIZE.h / 2 - before.y * k };
        const out = relayoutAnchorTransform(shown, hidden, t, SIZE);
        const a = screenOf(t, before);
        const b = screenOf(out, after);
        expect(b.x).toBeCloseTo(a.x, 6);
        expect(b.y).toBeCloseTo(a.y, 6);
    });

    it('keeps the camera when every card is already on screen (the overview)', () => {
        const prev = lay(node(1, 0, 0), node(2, 0, 100));
        const next = lay(node(1, 0, 0), node(2, 0, 60));
        expect(relayoutAnchorTransform(prev, next, { x: 0, y: 0, k: 1 }, SIZE)).toBeNull();
    });

    it('holds the preferred anchor so hide → expand returns exactly', () => {
        // Card 1 is tall and shrinks; after the hide the centre falls below it,
        // onto card 2 — a fresh pick on the expand would hold card 2 instead.
        const tall = lay(node(1, 0, 0, 100, 600), node(2, 0, 620), node(3, 0, 3000));
        const short = lay(node(1, 0, 0, 100, 100), node(2, 0, 120), node(3, 0, 2500));
        const t0 = { x: 0, y: -100, k: 1 };
        const hidden = relayoutAnchorTransform(tall, short, t0, SIZE);
        expect(hidden.anchor).toBe('epic:1');
        const fresh = relayoutAnchorTransform(short, tall, hidden, SIZE);
        expect(fresh.anchor).toBe('epic:2');
        const back = relayoutAnchorTransform(short, tall, hidden, SIZE, hidden.anchor);
        expect(back.anchor).toBe('epic:1');
        expect({ x: back.x, y: back.y, k: back.k }).toEqual(t0);
    });

    it('falls back to a band header where no card is on screen (folded initiatives)', () => {
        const band = (initiativeId, y, height) => ({ initiativeId, y, height });
        const prev = { width: 800, nodes: new Map([node(1, 0, 0)]),
            bands: [band(1, 0, 200), band(2, 1000, 40)] };
        const next = { width: 800, nodes: new Map([node(1, 0, 0)]),
            bands: [band(1, 0, 120), band(2, 920, 40)] };
        const out = relayoutAnchorTransform(prev, next, { x: 0, y: -900, k: 1 }, SIZE);
        expect(out).toEqual({ x: 0, y: -820, k: 1, anchor: 'band:2' });
    });
});
