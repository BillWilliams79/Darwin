// req #3650 — the layout half of the per-box collapse heads. Every epic card
// carries its head as the title line's first control (req #3648 — it had a row
// of its own, labelled "REQS"); a FOLDED epic reserves no requirement
// block and draws no rows; a FOLDED initiative keeps its header and places no cards —
// without moving any other initiative's card sideways.

import { describe, it, expect } from 'vitest';

import {
    computePlanLayout, cardHeight, cardTitleH, drawsLabelKind, placeInitiativeChips,
    BAND_HEADER_FOLDED, INITIATIVE_CHIP_H,
    CARD_PAD_Y, CARD_PAD_X, CARD_FRAME_X, CARD_COLLAPSE_W, CARD_TITLE_BTN,
    CARD_HEAD_LABEL, CARD_LINE_H, EPIC_WIDTH_RUNGS, NAME_INLINE_MIN_CHARS, CHW_LABEL,
    CARD_COLLAPSE_GAP, CARD_CLUSTER_H, CARD_CLUSTER_W,
    CARD_NAME_CLUSTER_GAP, CARD_RUN_W, CARD_RUN_TOP, CARD_BADGE_TOP, CARD_BADGE_W,
    CARD_BADGE_GAP, CARD_NAME_LEFT_RESERVE,
} from '../pipelinePlanLayout';

const mk = (id, initiativeId, depIds = [], reqIds = []) => ({
    id, title: `epic ${id}`, run: 'auto', state: 'pending', reqIds,
    depIds, timeDeps: [], initiativeId, initiative: `initiative-${initiativeId}`,
    initiativeLabels: [], featureLabels: [], machineLabels: [], machineLabel: '—',
});

// Two initiatives: 5 holds a chain 10 -> 11, 6 holds 12 which waits on 11.
const ROWS = [
    mk(10, 5, [], [101, 102, 103]),
    mk(11, 5, [10], [104]),
    mk(12, 6, [11], [105, 106]),
];

const rectsOverlap = (a, b) =>
    a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

describe('the epic card\'s collapse head (req #3650)', () => {
    const layout = computePlanLayout(ROWS);

    it('emits exactly one head per card, at the left of its title line', () => {
        for (const r of ROWS) {
            const heads = layout.labels.filter((l) => l.kind === 'collapse' && l.epicId === r.id);
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
            const head = layout.labels.find((l) => l.kind === 'collapse' && l.epicId === r.id);
            const others = layout.labels.filter((l) => l.epicId === r.id && l !== head);
            for (const o of others) expect(rectsOverlap(head, o)).toBe(false);
            const name = others.find((l) => l.kind === 'epic');
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
        const locked = ROWS.map((r) => ({ ...r, locked: true, effectiveLocked: true, lockedBy: 'epic' }));
        const l = computePlanLayout(locked);
        expect(l.labels.some((x) => x.kind === 'lock')).toBe(false);
    });

    // req #3683's 2x2 cluster, down to one column by req #3742 — the badge
    // moved left of the name and the padlock was removed; cards stay two high.
    it('stacks the run pill over the barrier in one column at the right', () => {
        for (const rung of EPIC_WIDTH_RUNGS) {
            for (const epicLabel of ['title', 'id']) {
                const l = computePlanLayout(ROWS, { epicLabel, epicWidthLevel: rung });
                for (const r of ROWS) {
                    const n = l.nodes.get(r.id);
                    const get = (k) => l.labels.find((x) => x.kind === k && x.epicId === r.id);
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
                    const name = get('epic');
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
        for (const epicLabel of ['title', 'id']) {
            const l = computePlanLayout(short, { epicLabel });
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

// req #3648 code review — at Epic Width 3 the controls left the name under two
// characters, and it drew under the run pill on every card. Swept at EVERY
// rung, both label modes, with names long enough to wrap.
describe('the title line overlaps nothing at any Epic Width (req #3648)', () => {
    const LONG = ROWS.map((r) => ({ ...r, title: `Infrastructure priorities ${r.id}` }));
    for (const rung of EPIC_WIDTH_RUNGS) {
        for (const epicLabel of ['title', 'id']) {
            it(`rung ${rung}, ${epicLabel} labels`, () => {
                const layout = computePlanLayout(LONG, { epicLabel, epicWidthLevel: rung });
                for (const r of LONG) {
                    const mine = layout.labels.filter((l) => l.epicId === r.id
                        && ['collapse', 'badge', 'epic', 'run', 'barrier', 'lock', 'title']
                            .includes(l.kind));
                    for (let i = 0; i < mine.length; i += 1) {
                        for (let j = i + 1; j < mine.length; j += 1) {
                            expect(rectsOverlap(mine[i], mine[j]),
                                `epic ${r.id}: ${mine[i].kind} × ${mine[j].kind}`).toBe(false);
                        }
                    }
                    const n = layout.nodes.get(r.id);
                    const name = mine.find((l) => l.kind === 'epic');
                    // Inside the card's text column, and inside its title area.
                    expect(name.x + name.w).toBeLessThanOrEqual(n.right - CARD_PAD_X + 1e-6);
                    expect(name.y + name.h).toBeLessThanOrEqual(n.top + n.titleH + 1e-6);
                    expect(name.editW).toBeGreaterThanOrEqual(3 * 14);
                }
            });
        }
    }

    it('beside the controls only with NAME_INLINE_MIN_CHARS of room, else on the next line', () => {
        for (const rung of EPIC_WIDTH_RUNGS) {
            const layout = computePlanLayout(LONG, { epicLabel: 'title', epicWidthLevel: rung });
            const head = layout.labels.find((l) => l.kind === 'collapse' && l.epicId === 10);
            const name = layout.labels.find((l) => l.kind === 'epic' && l.epicId === 10);
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

describe('a folded epic (req #3650)', () => {
    const open = computePlanLayout(ROWS);
    const folded = computePlanLayout(ROWS, { collapsedEpicIds: new Set([10]) });

    it('shrinks to its title area and draws none of its requirement rows', () => {
        const n = folded.nodes.get(10);
        expect(n.h).toBeCloseTo(cardHeight(0, 'id', 1), 6);
        expect(n.h).toBeLessThan(open.nodes.get(10).h);
        expect(folded.labels.filter((l) => l.kind === 'req' && l.epicId === 10)).toHaveLength(0);
        const head = folded.labels.find((l) => l.kind === 'collapse' && l.epicId === 10);
        expect(head.collapsed).toBe(true);
    });

    it('keeps its count badge, so the card still says what it is holding', () => {
        const badge = folded.labels.find((l) => l.kind === 'badge' && l.epicId === 10);
        expect(badge.text).toBe('3');
    });

    it('leaves every other card exactly as it was', () => {
        for (const id of [11, 12]) {
            expect(folded.nodes.get(id).h).toBeCloseTo(open.nodes.get(id).h, 6);
            expect(folded.nodes.get(id).x).toBeCloseTo(open.nodes.get(id).x, 6);
            expect(folded.labels.filter((l) => l.kind === 'req' && l.epicId === id))
                .toHaveLength(ROWS.find((r) => r.id === id).reqIds.length);
            expect(folded.labels.find((l) => l.kind === 'collapse' && l.epicId === id)
                .collapsed).toBe(false);
        }
    });
});

describe('a folded initiative (req #3650)', () => {
    const open = computePlanLayout(ROWS);
    const folded = computePlanLayout(ROWS, { collapsedInitiativeIds: new Set([5]) });
    const band = (l, id) => l.bands.find((b) => b.initiativeId === id);

    it('keeps its header — the chip that unfolds it — and draws no lanes', () => {
        const b = band(folded, 5);
        expect(b.collapsed).toBe(true);
        expect(b.sub).toBe(0);
        expect(b.height).toBe(b.headerH);
        expect(b.height).toBeLessThan(band(open, 5).height);
        expect(b.epicIds).toEqual([10, 11]);
        expect(folded.labels.some((l) => l.kind === 'initiative' && l.initiativeId === 5)).toBe(true);
    });

    it('places none of its epics and draws none of their labels or arcs', () => {
        for (const id of [10, 11]) {
            expect(folded.nodes.has(id)).toBe(false);
            expect(folded.labels.some((l) => l.epicId === id)).toBe(false);
        }
        expect(folded.arcs.some((a) => [10, 11].includes(a.fromId) || [10, 11].includes(a.toId)))
            .toBe(false);
    });

    it('moves the other initiative up but never sideways, and leaves it open', () => {
        const a = open.nodes.get(12);
        const b = folded.nodes.get(12);
        expect(b.x).toBeCloseTo(a.x, 6);
        expect(b.depth).toBe(a.depth);
        expect(b.y).toBeLessThan(a.y);
        expect(band(folded, 6).collapsed).toBe(false);
        expect(folded.labels.filter((l) => l.kind === 'req' && l.epicId === 12)).toHaveLength(2);
    });

    it('folds the "No initiative" band by its own null key', () => {
        const rows = [mk(1, null), mk(2, 5, [1])];
        const l = computePlanLayout(rows, { collapsedInitiativeIds: new Set([null]) });
        expect(l.bands.find((b) => b.initiativeId == null).collapsed).toBe(true);
        expect(l.nodes.has(1)).toBe(false);
        expect(l.nodes.has(2)).toBe(true);
    });
});

// req #3805 — "reduce the white space between closed initiatives in up and
// down directions by 70%". Folded initiatives stacked one under another: the gap
// between their floating title bars, measured on the chips `placeInitiativeChips`
// actually places, at native scale (k = 1: world px = screen px).
describe('folded initiatives stack closer (req #3805)', () => {
    // Five one-epic initiatives, the middle three folded, so a run of folded bands
    // sits between two open ones.
    const RUN = [mk(1, 1), mk(2, 2, [1]), mk(3, 3, [2]), mk(4, 4, [3]), mk(5, 5, [4])];
    const FOLD = new Set([2, 3, 4]);
    const open = computePlanLayout(RUN);
    const folded = computePlanLayout(RUN, { collapsedInitiativeIds: FOLD });
    const band = (l, id) => l.bands.find((b) => b.initiativeId === id);
    const chipsAt = (l, k, vh = 4000) => placeInitiativeChips({
        bands: l.bands, transform: { x: 0, y: 0, k },
        viewport: { w: 2000, h: vh }, worldWidth: l.width,
    });
    const gaps = (chips) => chips.slice(1).map((c, i) => c.y - (chips[i].y + chips[i].h));

    // Before req #3805 a folded band kept the open header, so two stacked
    // folded title bars stood one open header + one band gap apart: the gap
    // between them was that pitch less the chip, 108 + 8 − 24 = 92.
    const bandGap = band(open, 2).y - (band(open, 1).y + band(open, 1).height);
    const oldGap = band(open, 1).headerH + bandGap - INITIATIVE_CHIP_H;

    it('cuts the gap between stacked folded title bars by 70% at native scale', () => {
        expect(oldGap).toBe(92);
        const chips = chipsAt(folded, 1).filter((c) => FOLD.has(c.initiativeId));
        expect(chips).toHaveLength(3);
        for (const c of chips) expect(c.h).toBe(INITIATIVE_CHIP_H);
        for (const g of gaps(chips)) {
            expect(g).toBeCloseTo(28, 6);
            expect(1 - g / oldGap).toBeCloseTo(0.7, 2);
        }
    });

    it('derives BAND_HEADER_FOLDED from the 70% (pinned literal, recomputed here)', () => {
        expect(BAND_HEADER_FOLDED).toBe(Math.round(INITIATIVE_CHIP_H + 0.3 * oldGap - bandGap));
        for (const id of FOLD) expect(band(folded, id).headerH).toBe(BAND_HEADER_FOLDED);
    });

    it('leaves every open band\'s header exactly as it was', () => {
        for (const id of [1, 5]) {
            expect(band(folded, id).headerH).toBe(band(open, id).headerH);
            expect(band(folded, id).height).toBe(band(open, id).height);
            expect(band(folded, id).initiativeLaneH).toBe(band(open, id).initiativeLaneH);
        }
        expect(folded.nodes.get(5).x).toBe(open.nodes.get(5).x);
    });

    it('never lets two folded title bars overlap, and names every folded initiative down to k = 0.38', () => {
        for (const k of [2, 1, 0.75, 0.5, 0.4, 0.38]) {
            const chips = chipsAt(folded, k);
            expect(chips.map((c) => c.initiativeId), `k=${k}`).toEqual([1, 2, 3, 4, 5]);
            for (const g of gaps(chips)) expect(g, `k=${k}`).toBeGreaterThan(0);
        }
    });

    // Code review: a folded band's name no longer fits inside its own 44px
    // band at landing scales, and the per-band push bound dropped it — plan 7
    // (two initiatives, both folded) LANDED at k = 0.148 with one of them nameless.
    // A run of folded bands shares its room instead (`placeInitiativeChips`).
    it('names every folded initiative at landing scales when nothing open follows the run', () => {
        const pair = computePlanLayout([mk(1, 1), mk(2, 2, [1])],
            { collapsedInitiativeIds: new Set([1, 2]) });
        const after = computePlanLayout(RUN, { collapsedInitiativeIds: new Set([3, 4, 5]) });
        for (const k of [0.3, 0.2, 0.148, 0.1]) {
            expect(chipsAt(pair, k).map((c) => c.initiativeId), `pair k=${k}`).toEqual([1, 2]);
            expect(chipsAt(after, k).map((c) => c.initiativeId), `after k=${k}`)
                .toEqual([1, 2, 3, 4, 5]);
            for (const l of [pair, after]) {
                for (const g of gaps(chipsAt(l, k))) expect(g, `k=${k}`).toBeGreaterThan(0);
            }
        }
    });

    it('a long run ABOVE an open initiative thins out below k = 0.3 rather than overlaps — the measured cost', () => {
        const rows = [1, 2, 3, 4, 5, 6, 7, 8].map((i) => mk(i, i, i > 1 ? [i - 1] : []));
        const l = computePlanLayout(rows, { collapsedInitiativeIds: new Set([2, 3, 4, 5, 6, 7]) });
        const named = (k) => chipsAt(l, k).map((c) => c.initiativeId);
        expect(named(0.3)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
        expect(named(0.25)).toHaveLength(7);
        expect(named(0.2)).toHaveLength(6);
        for (const k of [0.3, 0.25, 0.2]) {
            const chips = chipsAt(l, k);
            for (const g of gaps(chips)) expect(g, `k=${k}`).toBeGreaterThan(0);
            // Every folded name's box stays above the open initiative's cards.
            const open = l.bands.find((b) => b.initiativeId === 8);
            for (const c of chips.filter((x) => x.initiativeId !== 8)) {
                expect(c.y + c.h, `k=${k}`).toBeLessThanOrEqual((open.y + open.headerH) * k + 1e-6);
            }
        }
    });
});
