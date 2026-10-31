// req #4145 — a long chain keeps its predecessor's lane, and work whose gates
// are all finished is the NEXT work (today), not the future.
//
// The live repro is pipeline 20's "File sharing" initiative:
//
//     442 ─┬─ 438 ─┬─ 459 ── 462 ── 460 ── 461     the long chain
//          │       └─ 458                          Microchip Service Access
//          └─ 454 ── 456
//
// Before: 458 (older id) inherited 438's row, the five-epic run dropped to the
// band's bottom row, and 458 / 454 / 456 sat in the FUTURE slot at the far
// right although every gate in front of 458 and 454 is met.
import { describe, it, expect } from 'vitest';
import { adaptComposedPipeline } from '../pipelineAdapter';
import { computePlanLayout } from '../pipelinePlanLayout';
import { planTimeAxis, readyAfterFinishedWork } from '../pipelinePlanTime';
import { PLAN20_READ, PLAN20_NOW } from './plan20ChainFixture';

const CHAIN = [442, 438, 459, 462, 460, 461];

describe('pipeline 20: the long chain stays on its row (req #4145)', () => {
    const plan = adaptComposedPipeline(PLAN20_READ, { machines: [], now: PLAN20_NOW });
    const layout = computePlanLayout(plan.rows, { timeAxis: plan.timeAxis, epicLabel: 'title' });
    const n = (id) => layout.nodes.get(id);

    it('keeps 442 → 438 → 459 → 462 → 460 → 461 on one lane, the top one', () => {
        for (const id of CHAIN) expect(n(id).lane, `epic ${id}`).toBe(0);
    });

    it('puts Microchip Service Access directly below the chain, right after its gate', () => {
        expect(n(458).lane).toBe(1);
        expect(n(458).depth).toBe(n(438).depth + 1);
        expect(n(458).depth).toBe(n(459).depth);
    });

    it('keeps the other branch, 454 → 456, together below it', () => {
        expect(n(454).lane).toBe(2);
        expect(n(456).lane).toBe(2);
        expect(n(454).depth).toBe(n(442).depth + 2);
        expect(n(456).depth).toBe(n(454).depth + 1);
    });

    it('treats the ready epics as today, not as the future', () => {
        const ax = plan.timeAxis.epicStarts;
        for (const id of [458, 454, 456]) {
            expect(ax.get(id).kind, `epic ${id}`).toBe('dated');
        }
        expect(layout.slots.some((s) => s.kind === 'future')).toBe(false);
        expect(layout.slots.length).toBe(3);
    });
});

describe('the heir is the longest thread (req #4145)', () => {
    const mk = (id, depIds) => ({
        id, title: `s${id}`, run: 'auto', state: 'pending', reqIds: [],
        depIds, timeDeps: [], initiativeId: 1, initiative: 'I',
        initiativeLabels: [], featureLabels: [], machineLabels: [], machineLabel: '—',
    });
    const lanes = (layout, ids) => ids.map((id) => layout.nodes.get(id).lane);

    it('gives the row to a longer, NEWER thread over an older one-epic branch', () => {
        // 2 (older) and 3 both follow 1; 3 leads 3 → 4 → 5.
        const rows = [mk(1, []), mk(2, [1]), mk(3, [1]), mk(4, [3]), mk(5, [4])];
        const l = computePlanLayout(rows);
        expect(lanes(l, [1, 3, 4, 5])).toEqual([0, 0, 0, 0]);
        expect(l.nodes.get(2).lane).toBe(1);
    });

    it('decides by creation order when the threads are equally long', () => {
        const rows = [mk(1, []), mk(3, [1]), mk(2, [1])];
        const l = computePlanLayout(rows);
        expect(l.nodes.get(2).lane).toBe(0);
        expect(l.nodes.get(3).lane).toBe(1);
    });

    it('lets a merge continue only its longest run in', () => {
        // 7 merges the run 1 → 2 → 3 and the root 5, and is the longest thread
        // out of both — so it is the best heir of each, and can take one row.
        const rows = [mk(1, []), mk(2, [1]), mk(3, [2]), mk(5, []),
            mk(7, [3, 5]), mk(8, [7])];
        const l = computePlanLayout(rows);
        expect(lanes(l, [1, 2, 3, 7, 8])).toEqual([0, 0, 0, 0, 0]);
        expect(l.nodes.get(5).lane).toBe(1);
        // 5's arc bends late along its own, clear row.
        const arc = l.arcs.find((a) => a.fromId === 5 && a.toId === 7);
        expect(arc.route).toBe('late');
    });
});

describe('rule 7: a queued epic behind finished work sits on today (req #4145)', () => {
    const TODAY = '2026-10-31T22:37:00';
    // `gateOpen` is the server's `gate_open`, read as sent.
    const row = (id, depIds, state, gateOpen = depIds.length === 0) => (
        { id, depIds, state, gateOpen, timeDeps: [], reqIds: [1] });
    const FUT = { at: null, kind: 'future' };
    const OLD = { at: '2026-10-29T10:00:00', kind: 'dated' };
    const starts = (entries) => new Map(entries);

    it('moves a FUTURE epic whose open gate finished work released', () => {
        const rows = [row(1, [], 'done'), row(2, [1], 'done', true), row(3, [1, 2], 'pending', true)];
        const s = starts([[1, OLD], [2, OLD], [3, FUT]]);
        expect(readyAfterFinishedWork(rows, s, TODAY)).toBe(true);
        expect(s.get(3)).toEqual({ at: TODAY, kind: 'dated' });
    });

    it('leaves a dep-less root and every gate the server reports held in the future', () => {
        // 3: a dependency holds open work. 5: its dependency is done but the
        // server holds the gate anyway (not_before ahead, a barrier upstream or
        // an initiative it waits for) — the reason is the server's, not ours.
        const rows = [row(1, [], 'pending'), row(2, [], 'done'), row(3, [2, 4], 'pending', false),
            row(4, [], 'running'), row(5, [2], 'pending', false)];
        const s = starts([[1, FUT], [2, OLD], [3, FUT], [4, OLD], [5, FUT]]);
        expect(readyAfterFinishedWork(rows, s, TODAY)).toBe(false);
        for (const id of [1, 3, 5]) expect(s.get(id), `epic ${id}`).toEqual(FUT);
    });

    it('needs FINISHED work in front of it — an empty epic releases nothing', () => {
        const rows = [row(1, [], 'pending'), row(2, [1], 'pending', true)];
        rows[0].reqIds = [];
        const s = starts([[1, FUT], [2, FUT]]);
        expect(readyAfterFinishedWork(rows, s, TODAY)).toBe(false);
        expect(s.get(2)).toEqual(FUT);
    });

    it('needs the clock', () => {
        const rows = [row(1, [], 'done'), row(2, [1], 'pending', true)];
        const s = starts([[1, OLD], [2, FUT]]);
        expect(readyAfterFinishedWork(rows, s, null)).toBe(false);
        expect(s.get(2)).toEqual(FUT);
    });

    it('drags the released epic\'s own queued dependents after it (with rule 6)', () => {
        const req = (id, status, completed = null) => ({
            id, requirement_status: status, started_at: null, completed_at: completed,
        });
        const rows = [
            { id: 1, depIds: [], state: 'done', gateOpen: true, timeDeps: [], reqIds: [11] },
            { id: 2, depIds: [1], state: 'pending', gateOpen: true, timeDeps: [], reqIds: [12] },
            { id: 3, depIds: [2], state: 'pending', gateOpen: false, timeDeps: [], reqIds: [13] },
            { id: 4, depIds: [], state: 'pending', gateOpen: true, timeDeps: [], reqIds: [14] },
        ];
        const reqs = [req(11, 'met', '2026-10-29T10:00:00'), req(12, 'swarm_ready'),
            req(13, 'swarm_ready'), req(14, 'swarm_ready')];
        const ax = planTimeAxis(rows, reqs, new Date(`${TODAY}Z`));
        expect(ax.epicStarts.get(2).kind).toBe('dated');
        expect(ax.epicStarts.get(3).kind).toBe('dated');
        expect(ax.epicStarts.get(4).kind).toBe('future');
    });
});

// ── THE CODE REVIEW'S TWO SHAPES (req #4145) ───────────────────────────────
// A merge whose dependencies share one lane (10 gates on 1 AND 2, 1 → 2): the
// late-bend corridor must go to the NEARER dependency, and a corridor held by
// an in-chain source must admit the arc running through it. Otherwise the hold
// cut the trunk 2 → 3 → … off its row and bent 2 → 10 over 22.
describe('late-bend corridors on a merge with two same-lane dependencies (req #4145)', () => {
    const mk = (id, depIds) => ({
        id, title: `s${id}`, run: 'auto', state: 'pending', reqIds: [],
        depIds, timeDeps: [], initiativeId: 1, initiative: 'I',
        initiativeLabels: [], featureLabels: [], machineLabels: [], machineLabel: '—',
    });
    const head = [mk(1, []), mk(2, [1]), mk(20, []), mk(21, [20]), mk(22, [21]),
        mk(10, [1, 2, 22]), mk(30, []), mk(31, [30]), mk(32, [31]), mk(33, [32])];
    const lanesOf = (l, ids) => ids.map((id) => l.nodes.get(id).lane);
    const crossings = (l, rows) => {
        const deps = new Map(rows.map((r) => [r.id, r.depIds]));
        const memo = new Map();
        const reach = (id) => {
            if (memo.has(id)) return memo.get(id);
            const out = new Set();
            memo.set(id, out);
            for (const d of deps.get(id) || []) { out.add(d); for (const x of reach(d)) out.add(x); }
            return out;
        };
        const hits = [];
        for (const arc of l.arcs) {
            const hy = arc.straight || arc.route === 'late' ? arc.y1 : arc.y2;
            for (const node of l.nodes.values()) {
                if (node.id === arc.fromId || node.id === arc.toId || node.y !== hy) continue;
                if (!(node.x > arc.x1 && node.x < arc.x2)) continue;
                if (reach(node.id).has(arc.fromId) && reach(arc.toId).has(node.id)) continue;
                hits.push(`${arc.fromId}->${arc.toId} over ${node.id}`);
            }
        }
        return hits;
    };

    it('keeps the trunk on 2\'s row when 33 runs on elsewhere', () => {
        const rows = [...head, mk(50, [33]), mk(51, [50]), mk(52, [51]), mk(53, [52]),
            mk(3, [2, 33]), mk(4, [3]), mk(5, [4])];
        const l = computePlanLayout(rows);
        expect(lanesOf(l, [1, 2, 3, 4, 5])).toEqual([0, 0, 0, 0, 0]);
        expect(crossings(l, rows)).toEqual([]);
        expect(l.bands[0].sub).toBe(3);
    });

    it('keeps the trunk whole when the merge reaches it only transitively', () => {
        // 4 gates on 1 AND 3 (1 → 2 → 3); 2's heir 5 sits past 4. The late
        // corridor of 1 → 4 must be held for 2 after 2, or 5 loses 2's row.
        const other = (id, depIds) => ({ ...mk(id, depIds), initiativeId: 2, initiative: 'J' });
        const rows = [mk(1, []), mk(2, [1]), mk(3, [2]), mk(4, [1, 3]),
            other(40, []), other(41, [40]), other(42, [41]), other(43, [42]), other(44, [43]),
            mk(5, [2, 44]), mk(6, [5]), mk(7, [6]), mk(8, [7]), mk(9, [8])];
        const l = computePlanLayout(rows);
        expect(lanesOf(l, [1, 2, 5, 6, 7, 8, 9])).toEqual([0, 0, 0, 0, 0, 0, 0]);
        expect(l.arcs.find((a) => a.fromId === 2 && a.toId === 5).straight).toBe(true);
        expect(crossings(l, rows)).toEqual([]);
    });

    it('lets the merge 3 continue 33\'s longer run without bending 2 → 10 over 22', () => {
        const rows = [...head, mk(3, [2, 33]), mk(4, [3]), mk(5, [4]), mk(6, [5])];
        const l = computePlanLayout(rows);
        expect(lanesOf(l, [33, 3, 4, 5, 6])).toEqual(Array(5).fill(l.nodes.get(33).lane));
        expect(crossings(l, rows)).toEqual([]);
        expect(l.bands[0].sub).toBe(3);
    });
});
