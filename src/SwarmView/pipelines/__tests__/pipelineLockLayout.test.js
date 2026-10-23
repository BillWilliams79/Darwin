// req #3761 — the Lock view's model and geometry. Pure: no DOM.

import { describe, it, expect } from 'vitest';

import { composedFixture } from './pipelineComposedFixture';
import { adaptComposedPipeline, buildPlanModel } from '../pipelineAdapter';
import { PLAN_VIZ_PALETTE } from '../pipelinePlanLayout';
import {
    cascadeLock, lockHolders, buildLockModel, layoutLockModel, fitLockLayout,
    LOCK_GEOM, LOCK_MIN_FIT,
} from '../pipelineLockLayout';

const epic = (id, initiative_fk, title, extra = {}) => ({
    id, initiative_fk, title, run: 'auto', notes: null, not_before: null,
    checkpoint: 1, locked: 0, ...extra,
});

const NOW = new Date('2026-10-23T12:00:00Z');
const claim = (id, extra = {}) => ({
    id, pipeline_fk: 2, initiative_fk: null, machine_fk: 7,
    claimed_at: '2026-10-23 11:00:00', update_ts: '2026-10-23 11:59:30', ...extra,
});
const MACHINES = [
    { id: 7, title: 'Mac Mini', platform: 'darwin' },
    { id: 8, title: 'MCHP Windows', platform: 'wsl' },
];

function build({ pipeline = {}, initiatives, epics, claims = [], pauseOverride } = {}) {
    const payload = composedFixture({
        initiatives: initiatives || [
            { id: 5, title: 'Build', pipeline_fk: 2, sort_order: 1, locked: 0, initiative_status: 'active' },
            { id: 6, title: 'Ship', pipeline_fk: 2, sort_order: 2, locked: 0, initiative_status: 'active' },
        ],
        epics: epics || [epic(10, 5, 'Design'), epic(11, 5, 'Implement'), epic(12, 6, 'Release')],
        epicDeps: [{ id: 1, epic_fk: 11, dep_epic_fk: 10 }],
    });
    Object.assign(payload.pipeline, pipeline);
    const plan = adaptComposedPipeline(payload);
    if (pauseOverride) plan.pause = { ...plan.pause, ...pauseOverride };
    const model = buildPlanModel(payload);
    return buildLockModel({
        pipeline: payload.pipeline, plan, initiatives: model.initiatives,
        claims, machines: MACHINES, now: NOW,
    });
}

describe('cascadeLock — the outermost lock wins', () => {
    it('names the pipeline, then the initiative, then the epic', () => {
        expect(cascadeLock({ pipelineLocked: true, initiativeLocked: true, epicLocked: true })).toBe('pipeline');
        expect(cascadeLock({ initiativeLocked: true, epicLocked: true })).toBe('initiative');
        expect(cascadeLock({ epicLocked: true })).toBe('epic');
        expect(cascadeLock({})).toBeNull();
        expect(cascadeLock()).toBeNull();
    });
});

describe('buildLockModel — the three tiers and the cascade', () => {
    it('draws every initiative with its epics, in sort_order, and no requirement', () => {
        const m = build();
        expect(m.initiatives.map((i) => i.id)).toEqual([5, 6]);
        expect(m.initiatives[0].epics.map((e) => e.id)).toEqual([10, 11]);
        expect(m.totals).toMatchObject({ initiatives: 2, epics: 3, lockedEpics: 0, lockedInitiatives: 0 });
        expect(JSON.stringify(m)).not.toMatch(/requirement/i);
    });

    it('an epic under a LOCKED INITIATIVE reads locked, by its initiative', () => {
        const m = build({ initiatives: [
            { id: 5, title: 'Build', pipeline_fk: 2, sort_order: 1, locked: 1 },
            { id: 6, title: 'Ship', pipeline_fk: 2, sort_order: 2, locked: 0 },
        ] });
        const [build5, ship6] = m.initiatives;
        expect(build5).toMatchObject({ locked: true, lockedBy: 'initiative', effectiveLocked: true });
        expect(build5.epics.every((e) => e.effectiveLocked && e.lockedBy === 'initiative')).toBe(true);
        // …and its own flag stays off: the cascade is read, never stored.
        expect(build5.epics.every((e) => e.locked === false)).toBe(true);
        expect(ship6.effectiveLocked).toBe(false);
        expect(ship6.epics[0].effectiveLocked).toBe(false);
        expect(m.totals.lockedInitiatives).toBe(1);
        expect(m.totals.lockedEpics).toBe(2);
    });

    it('a LOCKED PIPELINE locks every initiative and every epic under it', () => {
        const m = build({ pipeline: { locked: 1 } });
        expect(m.pipeline).toMatchObject({ locked: true, lockedBy: 'pipeline' });
        expect(m.initiatives.every((i) => i.effectiveLocked && i.lockedBy === 'pipeline')).toBe(true);
        expect(m.initiatives.flatMap((i) => i.epics).every(
            (e) => e.effectiveLocked && e.lockedBy === 'pipeline')).toBe(true);
    });

    it('an epic locked in its own right is the only locked thing', () => {
        const m = build({ epics: [epic(10, 5, 'Design', { locked: 1 }), epic(11, 5, 'Implement'), epic(12, 6, 'Release')] });
        const e = m.initiatives[0].epics;
        expect(e[0]).toMatchObject({ locked: true, lockedBy: 'epic', effectiveLocked: true });
        expect(e[1].effectiveLocked).toBe(false);
        expect(m.initiatives[0].effectiveLocked).toBe(false);
        expect(m.pipeline.locked).toBe(false);
    });

    it('a locked epic is drawn in the canvas\' locked colour, whatever its run mode or barrier', () => {
        const m = build({ epics: [epic(10, 5, 'Design', { locked: 1, run: 'manual' }),
            epic(11, 5, 'Implement'), epic(12, 6, 'Release', { checkpoint: 0 })] });
        const [locked, barrier] = m.initiatives[0].epics;
        expect(locked.style.frame).toBe(PLAN_VIZ_PALETTE.lockedFrame);
        expect(barrier.barrier).toBe(true);
        expect(barrier.style.frame).toBe(PLAN_VIZ_PALETTE.epicBarrier);
        expect(m.initiatives[1].epics[0]).toMatchObject({ barrier: false });
        expect(m.initiatives[1].epics[0].style.frame).toBe(PLAN_VIZ_PALETTE.epicWillRun);
    });

    it('a paused pipeline pauses every initiative; a paused initiative pauses itself only', () => {
        const solo = build({ initiatives: [
            { id: 5, title: 'Build', pipeline_fk: 2, sort_order: 1, locked: 0, initiative_status: 'paused' },
            { id: 6, title: 'Ship', pipeline_fk: 2, sort_order: 2, locked: 0, initiative_status: 'active' },
        ] });
        expect(solo.initiatives[0]).toMatchObject({ paused: true, pausedBy: 'initiative', effectivePaused: true });
        expect(solo.initiatives[1]).toMatchObject({ paused: false, pausedBy: null, effectivePaused: false });
        expect(solo.pipeline.paused).toBe(false);
        expect(solo.totals.pausedInitiatives).toBe(1);

        const whole = build({ pipeline: { pipeline_status: 'paused' } });
        expect(whole.pipeline).toMatchObject({ paused: true, canPause: true });
        expect(whole.initiatives.every((i) => i.effectivePaused && i.pausedBy === 'pipeline')).toBe(true);
        // …but their own flags stay what they are: a pipeline pause is not copied down.
        expect(whole.initiatives.every((i) => i.paused === false)).toBe(true);
    });

    it('a draft or completed pipeline cannot be paused', () => {
        expect(build({ pipeline: { pipeline_status: 'draft' } }).pipeline.canPause).toBe(false);
        expect(build({ pipeline: { pipeline_status: 'completed' } }).pipeline.canPause).toBe(false);
        expect(build({ pipeline: { pipeline_status: 'active' } }).pipeline.canPause).toBe(true);
    });

    it('draws an initiative that has no epics yet', () => {
        const m = build({ initiatives: [
            { id: 5, title: 'Build', pipeline_fk: 2, sort_order: 1, locked: 0 },
            { id: 6, title: 'Ship', pipeline_fk: 2, sort_order: 2, locked: 0 },
            { id: 9, title: 'Later', pipeline_fk: 2, sort_order: 3, locked: 1 },
        ] });
        const later = m.initiatives.find((i) => i.id === 9);
        expect(later.epics).toEqual([]);
        expect(later.effectiveLocked).toBe(true);
    });

    it('orders unordered initiatives by where their epics first appear, after the ordered ones', () => {
        const m = build({
            initiatives: [
                { id: 5, title: 'Build', pipeline_fk: 2, sort_order: null },
                { id: 6, title: 'Ship', pipeline_fk: 2, sort_order: 1 },
            ],
        });
        expect(m.initiatives.map((i) => i.id)).toEqual([6, 5]);
    });
});

describe('lockHolders — where each engine is working', () => {
    it('a whole-pipeline claim is the pipeline\'s holder, with the lead tone', () => {
        const h = lockHolders([claim(1)], 2, MACHINES, NOW);
        expect(h.pipeline).toHaveLength(1);
        expect(h.pipeline[0]).toMatchObject({
            scope: 'pipeline', machine: 'Mac Mini', platform: 'Mac', role: 'lead', tone: 'lead',
            stale: false, label: 'Mac Mini · lead',
        });
        expect(h.byInitiative.size).toBe(0);
    });

    it('an initiative claim is that initiative\'s holder; a later machine on the same scope subscribes', () => {
        const h = lockHolders([
            claim(1, { initiative_fk: 5 }),
            claim(2, { initiative_fk: 5, machine_fk: 8 }),
        ], 2, MACHINES, NOW);
        const held = h.byInitiative.get(5);
        expect(held.map((x) => [x.machine, x.role, x.tone])).toEqual([
            ['Mac Mini', 'lead', 'lead'],
            ['MCHP Windows', 'subscriber', 'subscriber'],
        ]);
        expect(h.pipeline).toEqual([]);
    });

    it('a stale claim is shown as stale, not as a live engine', () => {
        const h = lockHolders([claim(1, { update_ts: '2026-10-23 10:00:00' })], 2, MACHINES, NOW);
        expect(h.pipeline[0]).toMatchObject({ stale: true, tone: 'stale', role: null, label: 'Mac Mini (stale)' });
    });

    it('lists live claims first, by id, whatever order the rows arrive in', () => {
        const h = lockHolders([
            claim(3, { initiative_fk: 5, machine_fk: 8, update_ts: '2026-10-23 10:00:00' }),
            claim(2, { initiative_fk: 5, machine_fk: 8 }),
            claim(1, { initiative_fk: 5 }),
        ], 2, MACHINES, NOW).byInitiative.get(5);
        expect(h.map((x) => [x.claimId, x.role])).toEqual([[1, 'lead'], [2, 'subscriber'], [3, null]]);
    });

    it('ignores another pipeline\'s claim and a refused one', () => {
        expect(lockHolders([claim(1, { pipeline_fk: 99 })], 2, MACHINES, NOW).pipeline).toEqual([]);
        // Same machine, overlapping scope: the second is REFUSED and launches nothing.
        const h = lockHolders([claim(1), claim(2)], 2, MACHINES, NOW);
        expect(h.pipeline.map((x) => x.claimId)).toEqual([1]);
        expect(lockHolders([], null, MACHINES, NOW).pipeline).toEqual([]);
    });

    it('lands on the model: pipeline holders on the pipeline, initiative holders on their band', () => {
        const m = build({ claims: [claim(1), claim(2, { initiative_fk: 6, machine_fk: 8 })] });
        expect(m.pipeline.holders.map((h) => h.claimId)).toEqual([1]);
        expect(m.initiatives.find((i) => i.id === 6).holders.map((h) => h.claimId)).toEqual([2]);
        expect(m.initiatives.find((i) => i.id === 5).holders).toEqual([]);
    });
});

describe('layoutLockModel — the condensed geometry', () => {
    const wide = (n) => {
        const epics = Array.from({ length: n }, (_, i) => epic(100 + i, 5, `Epic ${i}`));
        return build({ epics, initiatives: [{ id: 5, title: 'Build', pipeline_fk: 2, sort_order: 1 }] });
    };

    it('stacks the bands under the header inside the pipeline frame, in order', () => {
        const m = build();
        const l = layoutLockModel(m, 1100);
        expect(l.bands.map((b) => b.key)).toEqual([5, 6]);
        expect(l.bands[0].y).toBe(l.header.y + l.header.h + LOCK_GEOM.BAND_GAP);
        expect(l.bands[1].y).toBe(l.bands[0].y + l.bands[0].h + LOCK_GEOM.BAND_GAP);
        // The frame contains every band; the canvas contains the frame.
        const last = l.bands[l.bands.length - 1];
        expect(l.frame.y + l.frame.h).toBeGreaterThanOrEqual(last.y + last.h);
        expect(l.height).toBeGreaterThan(l.frame.y + l.frame.h);
        expect(l.width).toBe(1100);
    });

    it('places epics left to right inside their band\'s body and wraps at the width', () => {
        const l = layoutLockModel(wide(30), 1100);
        const [band] = l.bands;
        expect(band.cols).toBeGreaterThan(1);
        const xs = band.epics.map((e) => e.x);
        expect(xs[0]).toBe(band.body.x + LOCK_GEOM.BAND_PAD);
        expect(xs[1] - xs[0]).toBe(LOCK_GEOM.CARD_W + LOCK_GEOM.CARD_GAP);
        // the (cols+1)th card starts a new row, back at the first column
        expect(band.epics[band.cols].x).toBe(xs[0]);
        expect(band.epics[band.cols].y).toBe(band.epics[0].y + LOCK_GEOM.CARD_H + LOCK_GEOM.CARD_GAP);
        // every card lies inside its band
        for (const e of band.epics) {
            expect(e.x + e.w).toBeLessThanOrEqual(band.x + band.w);
            expect(e.y + e.h).toBeLessThanOrEqual(band.y + band.h);
        }
    });

    it('a narrower canvas re-wraps into taller bands without ever overlapping them', () => {
        const model = wide(30);
        const wideL = layoutLockModel(model, 1400);
        const narrowL = layoutLockModel(model, 700);
        expect(narrowL.bands[0].cols).toBeLessThan(wideL.bands[0].cols);
        expect(narrowL.bands[0].h).toBeGreaterThan(wideL.bands[0].h);
        const b = narrowL.bands;
        for (let i = 1; i < b.length; i += 1) expect(b[i].y).toBeGreaterThanOrEqual(b[i - 1].y + b[i - 1].h);
    });

    it('an empty band keeps room for its header, and nothing is ever zero columns', () => {
        const m = build({ initiatives: [{ id: 9, title: 'Later', pipeline_fk: 2, sort_order: 1 }], epics: [] });
        const l = layoutLockModel(m, 100);
        expect(l.width).toBe(LOCK_GEOM.MIN_WIDTH);
        expect(l.bands[0].h).toBe(LOCK_GEOM.BAND_MIN_H);
        expect(l.bands[0].cols).toBeGreaterThanOrEqual(1);
        expect(l.bands[0].epics).toEqual([]);
    });
});

describe('fitLockLayout — the whole picture on one screen', () => {
    it('does not shrink a picture that already fits', () => {
        const { k, layout } = fitLockLayout(build(), { width: 1200, height: 900 });
        expect(k).toBe(1);
        expect(layout.width).toBe(1200);
    });

    it('shrinks a tall picture to the viewport height and widens the layout to fill the width', () => {
        const epics = Array.from({ length: 60 }, (_, i) => epic(100 + i, 5 + (i % 3), `Epic ${i}`));
        const model = build({
            epics,
            initiatives: [5, 6, 7].map((id, i) => ({ id, title: `I${id}`, pipeline_fk: 2, sort_order: i + 1 })),
        });
        const tall = layoutLockModel(model, 1000);
        const { k, layout } = fitLockLayout(model, { width: 1000, height: tall.height / 1.5 });
        expect(k).toBeLessThan(1);
        expect(k).toBeGreaterThanOrEqual(LOCK_MIN_FIT);
        // Drawn wider by 1/k so the scaled surface spans the viewport.
        expect(layout.width).toBeGreaterThan(1000);
        expect(layout.width * k).toBeCloseTo(1000, -1);
    });

    // The loop alternates rather than converging on these: the returned layout
    // was drawn for one scale and the old return gave another, spilling up to 40%
    // of the cards off the right edge.
    it.each([[3, 30, 1100, 640], [3, 12, 800, 640], [3, 30, 1400, 640], [10, 12, 1400, 640]])(
        'the scaled picture never spans past the viewport width (%i initiatives x %i epics, %ipx)',
        (n, per, width, height) => {
            const ids = Array.from({ length: n }, (_, i) => 5 + i);
            const model = build({
                initiatives: ids.map((id, i) => ({ id, title: `I${id}`, pipeline_fk: 2, sort_order: i + 1 })),
                epics: ids.flatMap((id) => Array.from({ length: per }, (_, i) => epic(id * 1000 + i, id, `E${i}`))),
            });
            const { layout, k } = fitLockLayout(model, { width, height });
            expect(layout.width * k).toBeLessThanOrEqual(width + 1);
        });

    it('never shrinks past legibility', () => {
        const { k } = fitLockLayout(build(), { width: 1000, height: 10 });
        expect(k).toBe(LOCK_MIN_FIT);
    });
});
