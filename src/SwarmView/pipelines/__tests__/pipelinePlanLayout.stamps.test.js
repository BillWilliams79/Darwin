// req #3825 — the epic card's time line: START at the bottom-left, END at the
// bottom-right, reserved on every card whose work has begun.

import { describe, it, expect } from 'vitest';

import {
    computePlanLayout, cardHeight, drawsLabelKind,
    CARD_PAD_X, CARD_PAD_Y, CARD_FRAME_X, CARD_STAMP_H, CARD_STAMP_TEXT_H,
    EPIC_WIDTH_RUNGS,
} from '../pipelinePlanLayout';
import { formatClock, formatStartStamp } from '../planEpicTimes';

const mk = (id, extra = {}, depIds = [], reqIds = [100 + id]) => ({
    id, title: `epic ${id}`, run: 'auto', state: 'pending', reqIds,
    depIds, timeDeps: [], initiativeId: 1, initiative: 'initiative-1',
    initiativeLabels: [], featureLabels: [], machineLabels: [], machineLabel: '—',
    ...extra,
});

const START = '2026-10-23T15:05:00';
const END = '2026-10-23T21:40:00';

const ROWS = [
    mk(1, { stampsReserved: true, startedAt: START, endedAt: END, state: 'done' }),
    mk(2, { stampsReserved: true, startedAt: START, endedAt: null, state: 'running' }, [1]),
    mk(3, {}, [2]),                                         // queued: no line
    mk(4, { stampsReserved: true, startedAt: null, endedAt: END, state: 'done' }, [1]),
];

const rectsOverlap = (a, b) =>
    a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const stampsOf = (layout, epicId) =>
    layout.labels.filter((l) => l.kind === 'stamp' && l.epicId === epicId);

describe('the epic card time line (req #3825)', () => {
    const layout = computePlanLayout(ROWS);
    const bare = computePlanLayout(ROWS.map((r) => ({ ...r, stampsReserved: false })));

    it('reserves exactly one time line on a card whose work has begun', () => {
        for (const id of [1, 2, 4]) {
            expect(layout.nodes.get(id).h - bare.nodes.get(id).h).toBeCloseTo(CARD_STAMP_H, 6);
        }
        expect(layout.nodes.get(3).h).toBeCloseTo(bare.nodes.get(3).h, 6);
        expect(cardHeight(100, 'title', 1, CARD_STAMP_H) - cardHeight(100, 'title', 1))
            .toBeCloseTo(CARD_STAMP_H, 6);
    });

    it('puts START at the bottom-left and END at the bottom-right, hh:mmAM/PM', () => {
        const n = layout.nodes.get(1);
        const [start, end] = ['start', 'end'].map(
            (side) => stampsOf(layout, 1).find((l) => l.side === side));
        expect(start.text).toBe(formatClock(START));
        expect(end.text).toBe(formatClock(END));
        expect(start.text).toMatch(/^\d{2}:\d{2}(AM|PM)$/);
        expect(start.x).toBeCloseTo(n.left + CARD_FRAME_X + CARD_PAD_X, 6);
        expect(end.x + end.w).toBeCloseTo(n.right - CARD_PAD_X, 6);
        for (const l of [start, end]) {
            expect(l.y + l.h).toBeCloseTo(n.bottom - CARD_PAD_Y, 6);
            expect(l.h).toBe(CARD_STAMP_TEXT_H);
        }
    });

    it('an end on a later local day carries +Nd and still fits the card', () => {
        const overnight = [mk(1, { stampsReserved: true, state: 'done',
            startedAt: '2026-10-14T08:00:00', endedAt: '2026-10-23T21:40:00' })];
        for (const rung of EPIC_WIDTH_RUNGS) {
            const l = computePlanLayout(overnight, { epicWidthLevel: rung });
            const [start, end] = ['start', 'end'].map(
                (side) => stampsOf(l, 1).find((s) => s.side === side));
            expect(end.text).toMatch(/^\d{2}:\d{2}(AM|PM)\+\d+d$/);
            expect(rectsOverlap(start, end)).toBe(false);
            expect(end.x + end.w).toBeCloseTo(l.nodes.get(1).right - CARD_PAD_X, 6);
        }
    });

    it('a running epic shows its start only; an unstamped start shows the end only', () => {
        expect(stampsOf(layout, 2).map((l) => l.side)).toEqual(['start']);
        expect(stampsOf(layout, 4).map((l) => l.side)).toEqual(['end']);
        expect(stampsOf(layout, 3)).toHaveLength(0);
    });

    it('sits below every other label of its card', () => {
        for (const id of [1, 2, 4]) {
            const stamps = stampsOf(layout, id);
            const others = layout.labels.filter((l) => l.epicId === id && l.kind !== 'stamp');
            for (const s of stamps) {
                for (const o of others) {
                    expect(rectsOverlap(s, o)).toBe(false);
                    expect(o.y + o.h).toBeLessThanOrEqual(s.y + 1e-6);
                }
            }
        }
    });

    it('never lets START and END touch, at every epic width', () => {
        for (const rung of EPIC_WIDTH_RUNGS) {
            const l = computePlanLayout(ROWS, { epicWidthLevel: rung });
            const [start, end] = ['start', 'end'].map(
                (side) => stampsOf(l, 1).find((s) => s.side === side));
            expect(rectsOverlap(start, end)).toBe(false);
        }
    });

    it('a folded card keeps its time line', () => {
        const folded = computePlanLayout(ROWS, { collapsedEpicIds: new Set([1]) });
        expect(stampsOf(folded, 1)).toHaveLength(2);
        const n = folded.nodes.get(1);
        for (const s of stampsOf(folded, 1)) expect(s.y + s.h).toBeLessThanOrEqual(n.bottom);
    });

    it('overlaps no label anywhere, at every width, label mode and fold', () => {
        const long = 'A requirement title long enough to wrap onto its second line';
        const rows = ROWS.map((r) => ({ ...r, reqIds: [101, 102, 103] }));
        const reqTitles = new Map([[101, long], [102, 'short'], [103, long]]);
        for (const epicWidthLevel of EPIC_WIDTH_RUNGS) {
            for (const epicLabel of ['id', 'title']) {
                for (const reqLabel of ['id', 'title']) {
                    for (const collapsedEpicIds of [new Set(), new Set([1, 4])]) {
                        const l = computePlanLayout(rows, {
                            epicWidthLevel, epicLabel, reqLabel, reqTitles, collapsedEpicIds,
                        });
                        const stamps = l.labels.filter((x) => x.kind === 'stamp');
                        expect(stamps.length).toBe(4);
                        for (const st of stamps) {
                            const n = l.nodes.get(st.epicId);
                            expect(st.y + st.h).toBeLessThanOrEqual(n.bottom);
                            expect(st.x + st.w).toBeLessThanOrEqual(n.right);
                            for (const o of l.labels) {
                                if (o !== st) expect(rectsOverlap(st, o)).toBe(false);
                            }
                        }
                    }
                }
            }
        }
    });

    // req #3963 — the Time chip's date state: `Oct 23 03:05PM` on each side.
    it('writes the date in front of each time in date format, and it fits every width', () => {
        const long = 'A requirement title long enough to wrap onto its second line';
        const rows = ROWS.map((r) => ({ ...r, reqIds: [101, 102, 103],
            // The widest dates a stamp can carry: a two-digit day, both sides.
            ...(r.startedAt ? { startedAt: '2026-12-28T15:05:00' } : {}),
            ...(r.endedAt ? { endedAt: '2026-12-29T21:40:00' } : {}) }));
        const reqTitles = new Map([[101, long], [102, 'short'], [103, long]]);
        for (const epicWidthLevel of EPIC_WIDTH_RUNGS) {
            const l = computePlanLayout(rows, {
                epicWidthLevel, reqLabel: 'title', reqTitles, stampFormat: 'date',
            });
            const [start, end] = ['start', 'end'].map(
                (side) => stampsOf(l, 1).find((s) => s.side === side));
            expect(start.text).toBe(formatStartStamp(rows[0].startedAt, 'date'));
            expect(end.text).toBe(formatStartStamp(rows[0].endedAt, 'date'));
            expect(start.text).toMatch(/^[A-Z][a-z]{2} \d{1,2} \d{2}:\d{2}(AM|PM)$/);
            const n = l.nodes.get(1);
            expect(start.x).toBeCloseTo(n.left + CARD_FRAME_X + CARD_PAD_X, 6);
            expect(end.x + end.w).toBeCloseTo(n.right - CARD_PAD_X, 6);
            const stamps = l.labels.filter((x) => x.kind === 'stamp');
            for (const st of stamps) {
                for (const o of l.labels) {
                    if (o !== st) expect(rectsOverlap(st, o)).toBe(false);
                }
            }
        }
    });

    it('rides the card: drawn wherever the card is', () => {
        expect(drawsLabelKind('stamp', 'out')).toBe(false);
        expect(drawsLabelKind('stamp', 'mid')).toBe(drawsLabelKind('req', 'mid'));
        expect(drawsLabelKind('stamp', 'in')).toBe(true);
    });
});
