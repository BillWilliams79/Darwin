// Req #2719 — unit tests for buildUndoneChips, the pure function that turns
// (swarmUndos, swarmStarts, requirementById, categoryList) into the chip
// objects the visualizer's swarm-mode renderer consumes. Decoupled from React
// so we can pin the math without spinning up the whole TimeSeriesView.

import { describe, it, expect } from 'vitest';
import { buildUndoneChips } from '../swarmGeometry';

// Dummy positional helper — for these tests we don't care about real time-of-
// day math, only that the chip shape comes out correct given a known mapping.
// `null` means "off-window" — the function should drop those chips.
const inWindowXPct = (ts /*, tz, date */) => {
    if (ts === 'OFF_WINDOW') return null;
    if (ts === '2026-05-27T01:09:10Z') return 5;
    if (ts === '2026-05-27T01:45:00Z') return 8;
    if (ts === '2026-05-27T09:44:32Z') return 40;
    if (ts === '2026-05-27T10:15:00Z') return 42;
    return 50;
};
const fmtHM = () => '01:45';

const baseUndo = {
    id: 14,
    swarm_start_fk_at_undo: 60,
    req_id_at_undo: 2682,
    task_name: 'nccl-extension-post-2629',
    branch: 'feature/2682-nccl-extension-post-2629-continue-1',
    coordination_type: 'deployed',
    reason: 'Spec ambiguity on T/U/S/V variant ordering',
    undone_at: '2026-05-27T01:45:00Z',
};

const baseSwarmStart = {
    id: 60,
    started_at: '2026-05-27T01:09:10Z',
    session_count: 3,
};

const baseRequirement = {
    id: 2682,
    title: 'NCCL Extension (post 2629)',
    category_fk: 1186,
    coordination_type: 'deployed',
    requirement_status: 'approved',
};

const requirementById = new Map([[String(baseRequirement.id), baseRequirement]]);
const categoryList = [{ id: 1186, category_name: 'Topology', color: '#470486' }];

const callArgs = (overrides = {}) => ({
    swarmUndos: [baseUndo],
    swarmStarts: [baseSwarmStart],
    xPctFn: inWindowXPct,
    timezone: 'America/Los_Angeles',
    selectedDate: '2026-05-27',
    requirementById,
    categoryList,
    closeThresholdPct: 1.5,
    formatHHMM: fmtHM,
    ...overrides,
});

describe('buildUndoneChips', () => {
    it('returns [] for empty/missing undos', () => {
        expect(buildUndoneChips(callArgs({ swarmUndos: [] }))).toEqual([]);
        expect(buildUndoneChips(callArgs({ swarmUndos: null }))).toEqual([]);
        expect(buildUndoneChips(callArgs({ swarmUndos: undefined }))).toEqual([]);
    });

    it('builds a chip with the canonical shape', () => {
        const chips = buildUndoneChips(callArgs());
        expect(chips).toHaveLength(1);
        const c = chips[0];
        expect(c.isUndone).toBe(true);
        expect(c.chipKey).toBe('undone-14');
        expect(c.id).toBe(2682);
        expect(c.title).toBe('NCCL Extension (post 2629)');
        expect(c.color).toBe('#9E9E9E');
        expect(c.leftPct).toBe(8);   // xPct of undone_at
        expect(c.startPct).toBe(5);  // xPct of swarm_start.started_at
        expect(c.markerMode).toBe('normal');
        expect(c.startClamped).toBe(false);
        expect(c.session).toBeNull();   // undo-driven chip, no live session ref
        expect(c.swarmStartId).toBe(60);
        expect(c.swarmStart).toBe(baseSwarmStart);
        expect(c.categoryName).toBe('Topology');
        expect(c.groupKey).toBe(baseSwarmStart.started_at);
        expect(c.coordination_type).toBe('deployed');
        expect(c.undo).toBe(baseUndo);
    });

    it('drops chips whose undone_at lands outside the panel window', () => {
        const offWindowUndo = { ...baseUndo, id: 99, undone_at: 'OFF_WINDOW' };
        const chips = buildUndoneChips(callArgs({ swarmUndos: [offWindowUndo] }));
        expect(chips).toEqual([]);
    });

    it('marks markerMode="clamped" when the swarm_start sits before the window', () => {
        const undo = { ...baseUndo, swarm_start_fk_at_undo: 60 };
        // swarm_start.started_at maps to OFF_WINDOW; undone_at stays in window.
        const ss = { ...baseSwarmStart, started_at: 'OFF_WINDOW' };
        const chips = buildUndoneChips(callArgs({
            swarmUndos: [undo],
            swarmStarts: [ss],
        }));
        expect(chips).toHaveLength(1);
        expect(chips[0].markerMode).toBe('clamped');
        expect(chips[0].startPct).toBe(0);
        expect(chips[0].startClamped).toBe(true);
    });

    it('marks markerMode="left" when start ~= undone_at', () => {
        // Make start and end land at the same X (within threshold)
        const closeXPct = (ts) => ts === '2026-05-27T01:09:10Z' ? 10 : 10.5;
        const chips = buildUndoneChips(callArgs({ xPctFn: closeXPct }));
        expect(chips[0].markerMode).toBe('left');
    });

    it('falls back to undone_at for start when no swarm_start_fk_at_undo', () => {
        const undo = { ...baseUndo, swarm_start_fk_at_undo: null };
        const chips = buildUndoneChips(callArgs({ swarmUndos: [undo] }));
        expect(chips).toHaveLength(1);
        // No swarmStart — canonicalStartedAt becomes undone_at → markerMode 'left'
        expect(chips[0].swarmStart).toBeNull();
        expect(chips[0].swarmStartId).toBeNull();
    });

    it('uses task_name title when the requirement is not in the lookup', () => {
        const chips = buildUndoneChips(callArgs({
            requirementById: new Map(), // empty
        }));
        expect(chips[0].title).toBe('nccl-extension-post-2629');
        expect(chips[0].categoryName).toBeNull();
    });

    it('falls back to "(undone)" when neither requirement nor task_name is available', () => {
        const undo = { ...baseUndo, task_name: null };
        const chips = buildUndoneChips(callArgs({
            swarmUndos: [undo],
            requirementById: new Map(),
        }));
        expect(chips[0].title).toBe('(undone)');
    });

    it('prefers requirement.coordination_type over undo.coordination_type', () => {
        const req = { ...baseRequirement, coordination_type: 'planned' };
        const reqMap = new Map([[String(req.id), req]]);
        const chips = buildUndoneChips(callArgs({ requirementById: reqMap }));
        expect(chips[0].coordination_type).toBe('planned');
    });

    // req #2905 — two-calendar-day window between undo and its swarm-start.
    describe('two-calendar-day start window (req #2905)', () => {
        // xPctFn ignores tz/date; returns a number so nothing is dropped and
        // startPct is computable. timezone 'UTC' makes calendar-day math obvious.
        const xp = (ts) => (ts === 'OFF_WINDOW' ? null
            : ts.includes('T10:00') ? 50 : 10);
        const windowArgs = (undoneAt, startedAt) => callArgs({
            timezone: 'UTC',
            xPctFn: xp,
            swarmUndos: [{ ...baseUndo, undone_at: undoneAt }],
            swarmStarts: [{ ...baseSwarmStart, started_at: startedAt }],
        });

        it('keeps the relationship when start is the SAME calendar day', () => {
            const c = buildUndoneChips(
                windowArgs('2026-05-27T10:00:00Z', '2026-05-27T02:00:00Z'))[0];
            expect(c.startOutOfWindow).toBe(false);
            expect(c.swarmStart).not.toBeNull();
            expect(c.swarmStartId).toBe(60);
            expect(c.startPct).toBe(10);
        });

        it('keeps the relationship when start is the calendar day BEFORE', () => {
            const c = buildUndoneChips(
                windowArgs('2026-05-27T10:00:00Z', '2026-05-26T22:00:00Z'))[0];
            expect(c.startOutOfWindow).toBe(false);
            expect(c.swarmStart).not.toBeNull();
            expect(c.startPct).toBe(10);
        });

        it('detaches the start when it is 2+ calendar days before the undo', () => {
            const c = buildUndoneChips(
                windowArgs('2026-05-27T10:00:00Z', '2026-05-25T22:00:00Z'))[0];
            expect(c.startOutOfWindow).toBe(true);
            expect(c.swarmStart).toBeNull();
            expect(c.swarmStartId).toBeNull();
            expect(c.startPct).toBeNull();
            expect(c.startClamped).toBe(false);
            // Tombstone itself still renders at its own undone_at position.
            expect(c.isUndone).toBe(true);
            expect(c.leftPct).toBe(50);
        });
    });

    it('produces multiple chips ordered by input', () => {
        const a = { ...baseUndo, id: 13, swarm_start_fk_at_undo: 67,
                    undone_at: '2026-05-27T10:15:00Z' };
        const b = baseUndo;
        const ssB = baseSwarmStart;
        const ssA = { ...baseSwarmStart, id: 67, started_at: '2026-05-27T09:44:32Z' };
        const chips = buildUndoneChips(callArgs({
            swarmUndos: [a, b],
            swarmStarts: [ssA, ssB],
            requirementById: new Map([
                [String(baseRequirement.id), baseRequirement],
                ['2627', { id: 2627, title: 'NVL1152 System View', category_fk: 1186 }],
            ]),
        }));
        expect(chips).toHaveLength(2);
        expect(chips[0].chipKey).toBe('undone-13');
        expect(chips[1].chipKey).toBe('undone-14');
    });
});
