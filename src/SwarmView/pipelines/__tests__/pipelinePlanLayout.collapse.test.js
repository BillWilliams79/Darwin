// req #3650 — the layout half of the per-box collapse heads. Every step card
// carries its head as the title line's first control (req #3648 — it had a row
// of its own, labelled "REQS"); a FOLDED step reserves no requirement
// block and draws no rows; a FOLDED epic keeps its header and places no cards —
// without moving any other epic's card sideways.

import { describe, it, expect } from 'vitest';

import {
    computePlanLayout, cardHeight, cardTitleH, drawsLabelKind,
    CARD_PAD_Y, CARD_PAD_X, CARD_FRAME_X, CARD_COLLAPSE_W, CARD_TITLE_BTN,
    CARD_HEAD_LABEL, CARD_LINE_H, STEP_WIDTH_RUNGS, NAME_INLINE_MIN_CHARS, CHW_LABEL,
    CARD_COLLAPSE_GAP, CARD_CLUSTER_H, CARD_CLUSTER_W,
    CARD_NAME_CLUSTER_GAP, CARD_RUN_W, CARD_RUN_TOP, CARD_BADGE_TOP, CARD_BADGE_W,
    CARD_BADGE_GAP, CARD_NAME_LEFT_RESERVE,
} from '../pipelinePlanLayout';

const mk = (id, epicId, depIds = [], reqIds = []) => ({
    id, title: `step ${id}`, run: 'auto', state: 'pending', reqIds,
    depIds, timeDeps: [], epicId, epic: `epic-${epicId}`,
    epicLabels: [], featureLabels: [], machineLabels: [], machineLabel: '—',
});

// Two epics: 5 holds a chain 10 -> 11, 6 holds 12 which waits on 11.
const ROWS = [
    mk(10, 5, [], [101, 102, 103]),
    mk(11, 5, [10], [104]),
    mk(12, 6, [11], [105, 106]),
];

const rectsOverlap = (a, b) =>
    a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

describe('the step card\'s collapse head (req #3650)', () => {
    const layout = computePlanLayout(ROWS);

    it('emits exactly one head per card, at the left of its title line', () => {
        for (const r of ROWS) {
            const heads = layout.labels.filter((l) => l.kind === 'collapse' && l.stepId === r.id);
            expect(heads).toHaveLength(1);
            const [h] = heads;
            const n = layout.nodes.get(r.id);
            expect(h.x).toBeCloseTo(n.left + CARD_FRAME_X + CARD_PAD_X, 6);
            expect(h.y).toBeCloseTo(n.top + CARD_PAD_Y, 6);
            expect(h.w).toBe(CARD_COLLAPSE_W);
            expect(h.h).toBe(CARD_TITLE_BTN);
            expect(h.text).toBe(CARD_HEAD_LABEL);
            expect(h.collapsed).toBe(false);
        }
    });

    it('shares the title line, LEFT of the name, overlapping nothing (req #3648, #3742)', () => {
        for (const r of ROWS) {
            const head = layout.labels.find((l) => l.kind === 'collapse' && l.stepId === r.id);
            const others = layout.labels.filter((l) => l.stepId === r.id && l !== head);
            for (const o of others) expect(rectsOverlap(head, o)).toBe(false);
            const name = others.find((l) => l.kind === 'step');
            expect(name.y).toBeCloseTo(head.y, 6);
            // req #3742 — "badge counter between collapse/expand and title":
            // the badge stands in its reserve right after the chevron's gap,
            // flush against the gap before the name.
            const badge = others.find((l) => l.kind === 'badge');
            expect(badge.x).toBeGreaterThanOrEqual(head.x + head.w + CARD_COLLAPSE_GAP - 1e-6);
            expect(badge.x + badge.w)
                .toBeCloseTo(head.x + head.w + CARD_COLLAPSE_GAP + CARD_BADGE_W, 6);
            expect(badge.y).toBeCloseTo(head.y + CARD_BADGE_TOP, 6);
            expect(name.x).toBeCloseTo(badge.x + badge.w + CARD_BADGE_GAP, 6);
            expect(name.x).toBeCloseTo(head.x + CARD_NAME_LEFT_RESERVE, 6);
            // The run pill and the barrier sit right of the name.
            for (const k of ['run', 'barrier']) {
                const c = others.find((l) => l.kind === k);
                expect(c.x, k).toBeGreaterThanOrEqual(name.x + name.w - 1e-6);
            }
        }
    });

    it('draws no padlock on the card (req #3742 — "remove the lock button from the title row")', () => {
        const locked = ROWS.map((r) => ({ ...r, locked: true, effectiveLocked: true, lockedBy: 'step' }));
        const l = computePlanLayout(locked);
        expect(l.labels.some((x) => x.kind === 'lock')).toBe(false);
    });

    // req #3683's 2x2 cluster, down to one column by req #3742 — the badge
    // moved left of the name and the padlock was removed; cards stay two high.
    it('stacks the run pill over the barrier in one column at the right', () => {
        for (const rung of STEP_WIDTH_RUNGS) {
            for (const stepLabel of ['title', 'id']) {
                const l = computePlanLayout(ROWS, { stepLabel, stepWidthLevel: rung });
                for (const r of ROWS) {
                    const n = l.nodes.get(r.id);
                    const get = (k) => l.labels.find((x) => x.kind === k && x.stepId === r.id);
                    const [run, cp] = ['run', 'barrier'].map(get);
                    const right = n.right - CARD_PAD_X;
                    const top = n.top + CARD_PAD_Y;
                    // One column: the run pill over the barrier, flush right.
                    expect(run.x + run.w).toBeCloseTo(right, 6);
                    expect(cp.x + cp.w).toBeCloseTo(right, 6);
                    expect(run.w).toBe(CARD_RUN_W);
                    // Row 1: the pill; row 2: the button, one line down.
                    expect(run.y).toBeCloseTo(top + CARD_RUN_TOP, 6);
                    expect(cp.y).toBeCloseTo(top + CARD_LINE_H, 6);
                    // The whole column is two lines tall and inside the title area,
                    // its left edge where the name's reserve ends.
                    for (const c of [run, cp]) {
                        expect(c.y + c.h).toBeLessThanOrEqual(top + CARD_CLUSTER_H + 1e-6);
                        expect(c.x).toBeGreaterThanOrEqual(right - CARD_CLUSTER_W - 1e-6);
                    }
                    expect(n.titleH).toBeGreaterThanOrEqual(CARD_PAD_Y + CARD_CLUSTER_H - 1e-6);
                    // Nothing in the title area overlaps anything else in it.
                    const cl = [get('collapse'), get('badge'), run, cp];
                    for (let i = 0; i < cl.length; i += 1) {
                        for (let j = i + 1; j < cl.length; j += 1) {
                            expect(rectsOverlap(cl[i], cl[j])).toBe(false);
                        }
                    }
                    // The name's room ends a gap short of the cluster — or, on a
                    // rung too narrow for that (NAME_INLINE_MIN_CHARS), the name
                    // sits under the cluster with the column's full width.
                    const name = get('step');
                    if (Math.abs(name.y - top) < 1e-6) {
                        expect(name.x + name.editW)
                            .toBeCloseTo(right - CARD_CLUSTER_W - CARD_NAME_CLUSTER_GAP, 6);
                    } else {
                        expect(name.y).toBeCloseTo(top + CARD_CLUSTER_H, 6);
                        expect(name.x + name.editW).toBeCloseTo(right, 6);
                    }
                }
            }
        }
    });

    it('every card\'s title area is two lines high, even with a one-line name (req #3683)', () => {
        const short = ROWS.map((r) => ({ ...r, title: 'A' }));
        for (const stepLabel of ['title', 'id']) {
            const l = computePlanLayout(short, { stepLabel });
            for (const r of short) {
                expect(l.nodes.get(r.id).titleH).toBeCloseTo(CARD_PAD_Y + CARD_CLUSTER_H, 6);
            }
        }
        expect(cardTitleH('title', 1)).toBeCloseTo(CARD_PAD_Y + 2 * CARD_LINE_H, 6);
        expect(cardTitleH('title', 2)).toBeCloseTo(cardTitleH('title', 1), 6);
        expect(cardTitleH('title', 3)).toBeCloseTo(CARD_PAD_Y + 3 * CARD_LINE_H, 6);
    });

    it('is reserved in the title area, so a card has room for it at every level', () => {
        const n = layout.nodes.get(10);
        expect(n.titleH).toBeCloseTo(cardTitleH('id', 1), 6);
        expect(n.titleH).toBeGreaterThanOrEqual(CARD_PAD_Y + CARD_LINE_H);
    });

    it('rides the card: drawn wherever the card is, never beside a bare bead', () => {
        expect(drawsLabelKind('collapse', 'out')).toBe(false);
        expect(drawsLabelKind('collapse', 'mid')).toBe(true);
        expect(drawsLabelKind('collapse', 'in')).toBe(true);
    });
});

// req #3648 code review — at Step Width 3 the controls left the name under two
// characters, and it drew under the run pill on every card. Swept at EVERY
// rung, both label modes, with names long enough to wrap.
describe('the title line overlaps nothing at any Step Width (req #3648)', () => {
    const LONG = ROWS.map((r) => ({ ...r, title: `Infrastructure priorities ${r.id}` }));
    for (const rung of STEP_WIDTH_RUNGS) {
        for (const stepLabel of ['title', 'id']) {
            it(`rung ${rung}, ${stepLabel} labels`, () => {
                const layout = computePlanLayout(LONG, { stepLabel, stepWidthLevel: rung });
                for (const r of LONG) {
                    const mine = layout.labels.filter((l) => l.stepId === r.id
                        && ['collapse', 'badge', 'step', 'run', 'barrier', 'lock', 'title']
                            .includes(l.kind));
                    for (let i = 0; i < mine.length; i += 1) {
                        for (let j = i + 1; j < mine.length; j += 1) {
                            expect(rectsOverlap(mine[i], mine[j]),
                                `step ${r.id}: ${mine[i].kind} × ${mine[j].kind}`).toBe(false);
                        }
                    }
                    const n = layout.nodes.get(r.id);
                    const name = mine.find((l) => l.kind === 'step');
                    // Inside the card's text column, and inside its title area.
                    expect(name.x + name.w).toBeLessThanOrEqual(n.right - CARD_PAD_X + 1e-6);
                    expect(name.y + name.h).toBeLessThanOrEqual(n.top + n.titleH + 1e-6);
                    expect(name.editW).toBeGreaterThanOrEqual(3 * 14);
                }
            });
        }
    }

    it('beside the controls only with NAME_INLINE_MIN_CHARS of room, else on the next line', () => {
        for (const rung of STEP_WIDTH_RUNGS) {
            const layout = computePlanLayout(LONG, { stepLabel: 'title', stepWidthLevel: rung });
            const head = layout.labels.find((l) => l.kind === 'collapse' && l.stepId === 10);
            const name = layout.labels.find((l) => l.kind === 'step' && l.stepId === 10);
            if (Math.abs(name.y - head.y) < 1e-6) {
                expect(name.editW, `rung ${rung} inline room`)
                    .toBeGreaterThanOrEqual(NAME_INLINE_MIN_CHARS * CHW_LABEL - 1e-6);
            } else {
                // req #3683 — rung 3 is the one too narrow for a name beside the
                // cluster; it gets the column's full width under it instead.
                expect(rung, 'only the narrowest rung').toBe(3);
                expect(name.y, `rung ${rung}`).toBeCloseTo(head.y + CARD_CLUSTER_H, 6);
                expect(name.x, `rung ${rung}`).toBeCloseTo(head.x, 6);
            }
        }
    });
});

describe('a folded step (req #3650)', () => {
    const open = computePlanLayout(ROWS);
    const folded = computePlanLayout(ROWS, { collapsedStepIds: new Set([10]) });

    it('shrinks to its title area and draws none of its requirement rows', () => {
        const n = folded.nodes.get(10);
        expect(n.h).toBeCloseTo(cardHeight(0, 'id', 1), 6);
        expect(n.h).toBeLessThan(open.nodes.get(10).h);
        expect(folded.labels.filter((l) => l.kind === 'req' && l.stepId === 10)).toHaveLength(0);
        const head = folded.labels.find((l) => l.kind === 'collapse' && l.stepId === 10);
        expect(head.collapsed).toBe(true);
    });

    it('keeps its count badge, so the card still says what it is holding', () => {
        const badge = folded.labels.find((l) => l.kind === 'badge' && l.stepId === 10);
        expect(badge.text).toBe('3');
    });

    it('leaves every other card exactly as it was', () => {
        for (const id of [11, 12]) {
            expect(folded.nodes.get(id).h).toBeCloseTo(open.nodes.get(id).h, 6);
            expect(folded.nodes.get(id).x).toBeCloseTo(open.nodes.get(id).x, 6);
            expect(folded.labels.filter((l) => l.kind === 'req' && l.stepId === id))
                .toHaveLength(ROWS.find((r) => r.id === id).reqIds.length);
            expect(folded.labels.find((l) => l.kind === 'collapse' && l.stepId === id)
                .collapsed).toBe(false);
        }
    });
});

describe('a folded epic (req #3650)', () => {
    const open = computePlanLayout(ROWS);
    const folded = computePlanLayout(ROWS, { collapsedEpicIds: new Set([5]) });
    const band = (l, id) => l.bands.find((b) => b.epicId === id);

    it('keeps its header — the chip that unfolds it — and draws no lanes', () => {
        const b = band(folded, 5);
        expect(b.collapsed).toBe(true);
        expect(b.sub).toBe(0);
        expect(b.height).toBe(b.headerH);
        expect(b.height).toBeLessThan(band(open, 5).height);
        expect(b.stepIds).toEqual([10, 11]);
        expect(folded.labels.some((l) => l.kind === 'epic' && l.epicId === 5)).toBe(true);
    });

    it('places none of its steps and draws none of their labels or arcs', () => {
        for (const id of [10, 11]) {
            expect(folded.nodes.has(id)).toBe(false);
            expect(folded.labels.some((l) => l.stepId === id)).toBe(false);
        }
        expect(folded.arcs.some((a) => [10, 11].includes(a.fromId) || [10, 11].includes(a.toId)))
            .toBe(false);
    });

    it('moves the other epic up but never sideways, and leaves it open', () => {
        const a = open.nodes.get(12);
        const b = folded.nodes.get(12);
        expect(b.x).toBeCloseTo(a.x, 6);
        expect(b.depth).toBe(a.depth);
        expect(b.y).toBeLessThan(a.y);
        expect(band(folded, 6).collapsed).toBe(false);
        expect(folded.labels.filter((l) => l.kind === 'req' && l.stepId === 12)).toHaveLength(2);
    });

    it('folds the "No epic" band by its own null key', () => {
        const rows = [mk(1, null), mk(2, 5, [1])];
        const l = computePlanLayout(rows, { collapsedEpicIds: new Set([null]) });
        expect(l.bands.find((b) => b.epicId == null).collapsed).toBe(true);
        expect(l.nodes.has(1)).toBe(false);
        expect(l.nodes.has(2)).toBe(true);
    });
});
