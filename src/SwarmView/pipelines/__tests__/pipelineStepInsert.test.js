// Req #3586 — where the plan visualizer's add-step marks sit, asserted against
// a real layout so the marks are tested on the arcs the canvas actually draws.

import { describe, it, expect } from 'vitest';
import { computePlanLayout, CARD_GAP_X, CARD_RADIUS, INITIATIVE_ADD_RESERVE } from '../pipelinePlanLayout';
import {
    insertMarkRadius, arcInsertCandidates, edgeInsertMarks, dependentStub, precedeStub, insertRequest,
    buildInsertMarks, insertMarkAt, initiativeAddMark, INSERT_HIT_SCALE, INSERT_MARK_MAX_R, arcPathPoints,
} from '../pipelineStepInsert';

const row = (id, depIds = [], initiativeId = 1) => ({
    id, title: `Step ${id}`, state: 'pending', reqIds: [], depIds,
    initiativeId, initiative: `Initiative ${initiativeId}`, initiativeSortOrder: initiativeId,
});

// A fan-out and a fan-in: 1 -> {2, 3} -> 4, plus a long same-lane edge 1 -> 4.
const rows = [row(1), row(2, [1]), row(3, [1]), row(4, [2, 3, 1])];
const layout = computePlanLayout(rows);
const inCard = (p) => [...layout.nodes.values()].some((n) =>
    p.x >= n.left && p.x <= n.right && p.y >= n.top && p.y <= n.bottom);

describe('insertMarkRadius', () => {
    it('is ~7 screen px, clamped to [7, 12] world px', () => {
        expect(insertMarkRadius(1)).toBe(7);
        expect(insertMarkRadius(2)).toBe(7);
        expect(insertMarkRadius(0.7)).toBeCloseTo(10);
        expect(insertMarkRadius(0.1)).toBe(12);
        expect(insertMarkRadius(NaN)).toBe(7);
    });
});

describe('edgeInsertMarks', () => {
    const r = insertMarkRadius(1);
    const marks = edgeInsertMarks(layout.arcs, r);

    it('places exactly one mark per dependency arc, naming the edge', () => {
        expect(marks).toHaveLength(layout.arcs.length);
        expect(marks.map((m) => `${m.fromId}>${m.toId}`).sort())
            .toEqual(['1>2', '1>3', '1>4', '2>4', '3>4']);
    });

    it('never sits inside a card', () => {
        for (const m of marks) expect(inCard(m)).toBe(false);
    });

    it('never stacks two marks on each other', () => {
        for (let i = 0; i < marks.length; i++) {
            for (let j = i + 1; j < marks.length; j++) {
                expect(Math.hypot(marks[i].x - marks[j].x, marks[i].y - marks[j].y))
                    .toBeGreaterThanOrEqual(2 * r);
            }
        }
    });

    it('a straight arc puts its mark in the gutter just past the source', () => {
        const straight = { straight: true, x1: 100, y1: 50, x2: 400, y2: 50 };
        expect(arcInsertCandidates(straight)[0]).toEqual({ x: 100 + CARD_GAP_X / 2, y: 50 });
    });

    it('a curved arc puts its mark on the bend midpoint, between the two lanes', () => {
        for (const arc of layout.arcs.filter((a) => !a.straight)) {
            const p = arcInsertCandidates(arc)[0];
            expect(p.y).toBeCloseTo((arc.y1 + arc.y2) / 2);
            expect(p.x).toBeGreaterThan(arc.x1);
            expect(p.x).toBeLessThan(arc.x2);
        }
    });
});

describe('dependentStub', () => {
    it('leaves the card right edge just above the bottom-right corner and ends in the gutter', () => {
        const r = 7;
        for (const n of layout.nodes.values()) {
            const s = dependentStub(n, r);
            expect(s.x1).toBeGreaterThan(n.right);
            expect(s.y).toBeGreaterThan(n.y);
            // On the straight part of the right edge, above the corner's rounding.
            expect(s.y).toBeLessThan(n.bottom - CARD_RADIUS);
            expect(n.bottom - s.y).toBeLessThanOrEqual(CARD_RADIUS + 3 + 1e-9);
            expect(s.x + r).toBeLessThan(n.right + CARD_GAP_X);
        }
    });
});

// Req #3617 — the mirror of the dependent stub, off the LEFT side.
describe('precedeStub', () => {
    it('leaves the card left edge at the dependent stub\'s height and ends in the gutter before it', () => {
        const r = 7;
        for (const n of layout.nodes.values()) {
            const s = precedeStub(n, r);
            expect(s.x1).toBeLessThan(n.left);
            expect(s.y).toBe(dependentStub(n, r).y);
            expect(s.x).toBeLessThan(s.x1);
            expect(s.x - r).toBeGreaterThan(n.left - CARD_GAP_X);
            expect(n.left - s.x).toBeCloseTo(dependentStub(n, r).x - n.right);
        }
    });
});

describe('buildInsertMarks — the whole set, as the canvas draws it', () => {
    it('one dependent mark per step, one precede mark per step no arc lands on, one edge mark per arc', () => {
        const g = buildInsertMarks(layout, rows, 7);
        // Only step 1 has a free left side in the fixture.
        expect(g.marks.filter((m) => m.kind === 'precede').map((m) => m.toId)).toEqual([1]);
        expect(g.precedeCount).toBe(1);
        expect(g.dependentCount).toBe(rows.length);
        expect(g.stubs).toHaveLength(rows.length + 1);
        expect(g.marks.filter((m) => m.kind === 'dependent')).toHaveLength(rows.length);
        expect(g.marks.filter((m) => m.kind === 'edge')).toHaveLength(layout.arcs.length);
        expect(g.edgeCount).toBe(layout.arcs.length);
    });

    it('a step waiting on a FOLDED initiative gets no precede mark (req #3650)', () => {
        const folded = [row(1, [], 1), row(2, [1], 2), row(3, [2], 2)];
        const l = computePlanLayout(folded, { collapsedInitiativeIds: new Set([1]) });
        expect(l.arcs.some((a) => a.toId === 2)).toBe(false);   // nothing drawn into 2
        const g = buildInsertMarks(l, folded, 7);
        expect(g.marks.filter((m) => m.kind === 'precede')).toHaveLength(0);
    });

    it('no two HIT areas overlap at the placement radius — so none at any drawn radius', () => {
        const { marks } = buildInsertMarks(layout, rows);
        for (const k of [0.3, 0.58, 0.8, 1, 2]) {
            expect(insertMarkRadius(k)).toBeLessThanOrEqual(INSERT_MARK_MAX_R);
        }
        for (let i = 0; i < marks.length; i++) {
            for (let j = i + 1; j < marks.length; j++) {
                expect(Math.hypot(marks[i].x - marks[j].x, marks[i].y - marks[j].y))
                    .toBeGreaterThanOrEqual(2 * INSERT_MARK_MAX_R * INSERT_HIT_SCALE - 1e-9);
            }
        }
    });

    it('a smaller drawn radius shrinks the hit area without re-placing', () => {
        const g = buildInsertMarks(layout, rows);
        const m = g.marks[0];
        expect(insertMarkAt(g, { x: m.x + 11, y: m.y })?.key).toBe(m.key);
        expect(insertMarkAt(g, { x: m.x + 11, y: m.y }, 7)).toBeNull();
    });

    it('every edge mark is centred ON its own arc line — shared-line arcs included', () => {
        const g = buildInsertMarks(layout, rows);
        for (const m of g.marks.filter((mm) => mm.kind === 'edge')) {
            const arc = layout.arcs.find((a) => a.fromId === m.fromId && a.toId === m.toId);
            const d = Math.min(...arcPathPoints(arc, 1).map((q) => Math.hypot(q.x - m.x, q.y - m.y)));
            expect(d).toBeLessThan(1.5);
        }
    });

    it('insertMarkAt finds the mark under a point and nothing in open air', () => {
        const g = buildInsertMarks(layout, rows, 7);
        for (const m of g.marks) {
            expect(insertMarkAt(g, { x: m.x + 3, y: m.y - 3 })?.key).toBe(m.key);
        }
        expect(insertMarkAt(g, { x: -500, y: -500 })).toBeNull();
        expect(insertMarkAt(null, { x: 0, y: 0 })).toBeNull();
    });
});

describe('insertRequest', () => {
    const byId = new Map(rows.map((r) => [r.id, r]));

    it('an edge defaults the initiative to the step on its LEFT', () => {
        const rb = new Map([[1, row(1, [], 8)], [2, row(2, [1], 9)]]);
        expect(insertRequest('edge', { fromId: 1, toId: 2 }, rb)).toEqual({
            kind: 'edge', fromId: 1, toId: 2, initiativeId: 8,
            fromTitle: 'Step 1', toTitle: 'Step 2',
        });
    });

    it('a precede names only the step it will gate, and defaults to its initiative', () => {
        const rb = new Map([[2, row(2, [], 9)]]);
        expect(insertRequest('precede', { fromId: null, toId: 2 }, rb)).toEqual({
            kind: 'precede', fromId: null, toId: 2, initiativeId: 9,
            fromTitle: null, toTitle: 'Step 2',
        });
    });

    it('a dependent step carries no target', () => {
        expect(insertRequest('dependent', { fromId: 3, toId: 4 }, byId))
            .toMatchObject({ kind: 'dependent', fromId: 3, toId: null, toTitle: null, initiativeId: 1 });
    });
});

describe('precede marks follow the arcs (req #3617)', () => {
    it('every root of a multi-root plan gets one; a step an arc lands on never does', () => {
        const rr = [row(1), row(2), row(3, [1, 2]), row(4)];
        const ly = computePlanLayout(rr);
        const g = buildInsertMarks(ly, rr);
        expect(g.marks.filter((m) => m.kind === 'precede').map((m) => m.toId).sort())
            .toEqual([1, 2, 4]);
        for (const m of g.marks.filter((mm) => mm.kind === 'precede')) {
            const n = ly.nodes.get(m.toId);
            expect(m.x).toBeLessThan(n.left);
            expect(inCardOf(ly)(m)).toBe(false);
        }
    });
});

function inCardOf(ly) {
    return (p) => [...ly.nodes.values()].some((n) =>
        p.x >= n.left && p.x <= n.right && p.y >= n.top && p.y <= n.bottom);
}

describe('initiativeAddMark (req #3719)', () => {
    const two = computePlanLayout([row(1, [], 1), row(2, [], 2)]);

    it('sits under the bottom of the last band, left-aligned with the initiative chips', () => {
        const m = initiativeAddMark(two);
        const last = [...two.bands].sort((a, b) => b.y - a.y)[0];
        expect(m.kind).toBe('initiative');
        expect(m.y - INSERT_MARK_MAX_R).toBeGreaterThanOrEqual(last.y + last.height);
        expect(m.x - INSERT_MARK_MAX_R).toBe(12);
    });

    it('lies wholly inside the world, so the reserve is charged', () => {
        const m = initiativeAddMark(two);
        expect(m.y + INSERT_MARK_MAX_R).toBeLessThanOrEqual(two.height);
        const last = [...two.bands].sort((a, b) => b.y - a.y)[0];
        expect(two.height).toBeGreaterThanOrEqual(last.y + last.height + INITIATIVE_ADD_RESERVE);
    });

    it('is null for a plan with no band, and absent when initiativeAdd is off', () => {
        expect(initiativeAddMark(computePlanLayout([]))).toBeNull();
        expect(buildInsertMarks(two, [row(1, [], 1), row(2, [], 2)], undefined, { initiativeAdd: false })
            .marks.some((m) => m.kind === 'initiative')).toBe(false);
        expect(buildInsertMarks(two, [row(1, [], 1), row(2, [], 2)]).initiativeCount).toBe(1);
    });

    it('is hit by insertMarkAt like every other mark', () => {
        const g = buildInsertMarks(two, [row(1, [], 1), row(2, [], 2)]);
        const m = g.marks.find((x) => x.kind === 'initiative');
        expect(insertMarkAt(g, { x: m.x, y: m.y }, INSERT_MARK_MAX_R)).toBe(m);
    });
});
