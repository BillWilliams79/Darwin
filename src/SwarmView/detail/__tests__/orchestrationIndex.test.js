// orchestrationIndex.test.js — req #3435, narrowed by req #3357.
//
// The Orchestration box's whole derivation, exercised without a DOM: which plan
// and epic carry a requirement, and what the Epic dropdown offers.
//
// req #3357 retired the Initiative row and its whole derivation chain, down to
// `epicOptions`'s `initiativeId` scoping — the retired middle tier left the
// frontend and no replacement existed for 1.0. Req #3579 brought the initiative
// scoping back on the 2.0 hop (`epics.initiative_fk`), together with the
// Pipeline and Initiative selects' own option lists (`pipelineOptions`,
// `initiativeOptions`) — the box is a Pipeline → Initiative → Epic cascade now.
//
// req #3356 RE-BASED THE WHOLE INDEX ON PIPELINE 2.0, and the fixture below
// carries the one structural difference: a 2.0 epic has NO `pipeline_fk`. Its
// plan comes through `initiative_fk -> initiatives.pipeline_fk`, so there is an
// INITIATIVES fixture now and the join is two hops. Everything else — the open/closed
// status vocabulary and the id-ascending order — is unchanged. Req #3750 took
// `completed_at` away: an epic has no state, so no epic is ever filtered out
// for being "finished".
//
// THE FIXTURE MIRRORS THE LIVE SHAPE rather than an invented one: two open plans
// (one `active`, one `paused`), one `completed` plan. Every filtering rule in
// `epicOptions` has a row that only it can explain.

import { describe, it, expect } from 'vitest';
import {
    buildOrchestrationIndex,
    emptyOrchestrationIndex,
    isOpenPipeline,
    epicOptions,
    pipelineOptions,
    initiativeOptions,
} from '../orchestrationIndex';

const PIPELINES = [
    { id: 2,  title: 'Darwin',        pipeline_status: 'active',    create_ts: '2026-07-28T05:17:51' },
    { id: 79, title: 'Agent Harness', pipeline_status: 'paused',    create_ts: '2026-08-07T08:54:36' },
    { id: 5,  title: 'Retired plan',  pipeline_status: 'completed', create_ts: '2026-07-01T00:00:00' },
];

// The MIDDLE HOP. One initiative per plan is enough for every rule under test; the
// plan-scoping cases turn on which PLAN an epic reaches, not on which initiative.
const INITIATIVES = [
    { id: 20, pipeline_fk: 2 },
    { id: 79 * 10, pipeline_fk: 79 },
    { id: 50, pipeline_fk: 5 },
];

const EPICS = [
    { id: 100, initiative_fk: 20,  title: 'Polish A' },
    { id: 101, initiative_fk: 20,  title: 'FP A' },
    { id: 102, initiative_fk: 20,  title: 'Polish B' },
    { id: 103, initiative_fk: 20 },          // empty: no reqs, no title
    { id: 200, initiative_fk: 790, title: 'FP B' },
    { id: 300, initiative_fk: 50,  title: 'Retired' },
];

const EPIC_REQUIREMENTS = [
    { epic_fk: 100, requirement_fk: 3435 },
    { epic_fk: 102, requirement_fk: 3436 },  // its work is all met
    { epic_fk: 101, requirement_fk: 3400 },
    { epic_fk: 200, requirement_fk: 3401 },  // paused plan
    { epic_fk: 300, requirement_fk: 3300 },  // the COMPLETED plan only
];

const build = (over = {}) => buildOrchestrationIndex({
    pipelines: PIPELINES,
    initiatives: INITIATIVES,
    epics: EPICS,
    epicRequirements: EPIC_REQUIREMENTS,
    ...over,
});

describe('isOpenPipeline', () => {
    it('excludes only completed', () => {
        expect(isOpenPipeline({ pipeline_status: 'active' })).toBe(true);
        expect(isOpenPipeline({ pipeline_status: 'draft' })).toBe(true);
        expect(isOpenPipeline({ pipeline_status: 'paused' })).toBe(true);
        expect(isOpenPipeline({ pipeline_status: 'completed' })).toBe(false);
    });

    // A status nobody has invented yet is far more likely to be workable than
    // finished, so the unknown case must fall on the OFFERED side.
    it('treats an unknown status as open', () => {
        expect(isOpenPipeline({ pipeline_status: 'quiesced' })).toBe(true);
    });
});

describe('buildOrchestrationIndex — requirement seat', () => {
    it('names the epic, the initiative and the plan carrying a requirement', () => {
        // `initiativeId` joined the seat at req #3365, when the Orchestration box's
        // Initiative row came back. It is read from the CHOSEN epic, so the Initiative row
        // and the Epic row can never name different places.
        expect(build().requirementSeat.get(3435))
            .toEqual({ pipelineId: 2, epicId: 100, initiativeId: 20 });
    });

    it('carries the initiative ROWS, not just the initiative → plan hop', () => {
        // The Initiative row renders a TITLE, so the index keeps the rows now. It
        // costs no read: `initiatives` is already fetched for the plan hop.
        const idx = buildOrchestrationIndex({
            pipelines: PIPELINES,
            initiatives: [{ id: 20, pipeline_fk: 2, title: 'First Principles' }],
            epics: EPICS,
            epicRequirements: EPIC_REQUIREMENTS,
        });
        expect(idx.initiativesById.get(20).title).toBe('First Principles');
    });

    it('drops the seat entirely when the initiative rows are absent — one hop answers both', () => {
        // Same silence the PLAN gets in that case, and for the same reason: one
        // hop answers both, so an unresolvable initiative must not surface as an id
        // pointing at a row nobody read. Here the initiative resolves for the plan
        // but its row is absent from `initiativesById` — impossible from one read,
        // asserted because the two maps are populated by one loop and a future
        // split could separate them.
        const idx = build({ initiatives: [] });
        expect(idx.requirementSeat.has(3435)).toBe(false);
    });

    it('has no seat for an unseated requirement', () => {
        expect(build().requirementSeat.has(3200)).toBe(false);
    });

    // An epic from the LOSING plan paired with the winning plan's id links to a
    // epic that is not on that plan, which the visualizer correctly refuses to
    // focus. Lowest epic id WITHIN the chosen plan.
    it('pairs the epic with the plan that won the tie-break', () => {
        const idx = build({
            epicRequirements: [
                { epic_fk: 200, requirement_fk: 3435 },   // paused plan 79
                { epic_fk: 101, requirement_fk: 3435 },   // active plan 2
                { epic_fk: 100, requirement_fk: 3435 },   // active plan 2, lower id
            ],
        });
        expect(idx.requirementSeat.get(3435))
            .toEqual({ pipelineId: 2, epicId: 100, initiativeId: 20 });
    });

    // Nothing in the gateway promises these stay JSON numbers, and a string id
    // would index as a different epic — silently rendering "no seat" for a
    // requirement that plainly has one.
    it('coerces string ids from the wire', () => {
        const idx = build({
            epicRequirements: [{ epic_fk: '100', requirement_fk: '3435' }],
            epics: [{ id: '100', initiative_fk: '20' }],
            initiatives: [{ id: '20', pipeline_fk: '2' }],
            pipelines: [{ id: '2', title: 'Darwin', pipeline_status: 'active' }],
        });
        expect(idx.requirementSeat.get(3435))
            .toEqual({ pipelineId: 2, epicId: 100, initiativeId: 20 });
    });

    // THE INITIATIVE IS THE ONLY ROUTE FROM A EPIC TO A PLAN under 2.0. An epic whose
    // initiative is missing from the read reaches no plan, so it seats nothing —
    // dropped rather than invented, because pinning a requirement to a plan that
    // was never read is worse than reporting no seat at all.
    it('drops a seat whose epic names an initiative the read does not carry', () => {
        const idx = build({ epics: [{ id: 100, initiative_fk: 999 }] });
        expect(idx.requirementSeat.has(3435)).toBe(false);
    });

    it('drops a seat whose epic names no initiative at all', () => {
        const idx = build({ epics: [{ id: 100, initiative_fk: null }] });
        expect(idx.requirementSeat.has(3435)).toBe(false);
    });
});

const labels = (entries) => entries.map((e) => e.label);
const epicIds = (entries) => entries.map((e) => e.epic.id);

describe('epicOptions', () => {
    it('offers every epic of the given plan', () => {
        expect(epicIds(epicOptions(build(), { pipelineId: 2 })))
            .toEqual([100, 101, 102, 103]);
    });

    // An epic has no state (req #3750): one whose work is all met is not
    // "finished" and still takes new work.
    it('offers an epic whose requirements are all met', () => {
        expect(epicIds(epicOptions(build(), { pipelineId: 2 }))).toContain(102);
        expect(epicIds(epicOptions(build(), {}))).toContain(102);
    });

    it('excludes epics of another plan', () => {
        expect(epicIds(epicOptions(build(), { pipelineId: 2 }))).not.toContain(200);
    });

    // With no plan known the list widens to every OPEN plan rather than
    // emptying: a requirement seated nowhere still has to be placeable, or the
    // control is dead exactly when it is needed.
    it('widens to every open plan when no plan is known', () => {
        // Plan 5 is `completed`, so epic 300 stays out.
        expect(epicIds(epicOptions(build(), {}))).toEqual([100, 101, 102, 103, 200]);
    });

    // A select whose own list denies its value renders blank, which reads as a
    // data bug rather than as a filter.
    it('always offers the current epic, first, whatever the filters say', () => {
        // Epic 200 is on another plan.
        expect(epicIds(epicOptions(build(), { pipelineId: 2, currentEpicId: 200 })))
            .toEqual([200, 100, 101, 102, 103]);
        // ...and an epic of the plan itself moves to the front.
        expect(epicIds(epicOptions(build(), { pipelineId: 2, currentEpicId: 102 })))
            .toEqual([102, 100, 101, 103]);
    });

    it('never lists the current epic twice', () => {
        const ids = epicIds(epicOptions(build(), { pipelineId: 2, currentEpicId: 100 }));
        expect(ids).toEqual([100, 101, 102, 103]);
        expect(new Set(ids).size).toBe(ids.length);
    });

    it('invents a row for a current epic missing from the read', () => {
        const [first] = epicOptions(build(), { currentEpicId: 9999 });
        expect(first).toMatchObject({ label: 'Epic 9999' });
        expect(first.epic.id).toBe(9999);
    });

    it('labels by title, falling back to the id', () => {
        const entries = epicOptions(build(), { pipelineId: 2 });
        expect(labels(entries)).toEqual(['Polish A', 'FP A', 'Polish B', 'Epic 103']);
    });

    // Epic id ascending is the canonical stored order (`pipelineEpics` sorts
    // `id:asc`, and that is load-bearing for the plan engine's tie-breaks). True
    // display order would mean loading the whole plan to order one dropdown.
    it('orders by epic id ascending', () => {
        const idx = build({ epics: [...EPICS].reverse() });
        expect(epicIds(epicOptions(idx, { pipelineId: 2 }))).toEqual([100, 101, 102, 103]);
    });

    // An epic with no resolvable plan is in NEITHER list: it cannot match a named
    // plan, and nothing can vouch for its plan being open.
    it('never offers an epic whose initiative did not resolve', () => {
        const idx = build({ epics: [...EPICS, { id: 400, initiative_fk: 999 }] });
        expect(epicIds(epicOptions(idx, { pipelineId: 2 }))).not.toContain(400);
        expect(epicIds(epicOptions(idx, {}))).not.toContain(400);
    });
});

describe('emptyOrchestrationIndex', () => {
    // Consumers read `.get(...)` on every map on the very first render, before
    // any read has landed.
    it('answers every lookup without throwing', () => {
        const idx = emptyOrchestrationIndex();
        expect(idx.requirementSeat.get(1)).toBeUndefined();
        expect(idx.epicsById.get(1)).toBeUndefined();
        expect(idx.pipelineByEpic.get(1)).toBeUndefined();
        expect(epicOptions(idx)).toEqual([]);
    });
});

// ── Req #3579 — the cascade's option lists ──────────────────────────────────

describe('epicOptions initiative scoping', () => {
    const initiatives = [...INITIATIVES, { id: 21, pipeline_fk: 2, title: 'Second' }];
    const epics = [...EPICS, { id: 104, initiative_fk: 21, title: 'Second A' }];

    it('narrows to the given initiative', () => {
        const idx = build({ initiatives, epics });
        expect(epicIds(epicOptions(idx, { pipelineId: 2, initiativeId: 21 }))).toEqual([104]);
        expect(epicIds(epicOptions(idx, { pipelineId: 2, initiativeId: 20 }))).toEqual([100, 101, 102, 103]);
    });

    it('offers every initiative of the plan when no initiative is given', () => {
        const idx = build({ initiatives, epics });
        expect(epicIds(epicOptions(idx, { pipelineId: 2 }))).toEqual([100, 101, 102, 103, 104]);
    });

    // "All initiatives" means the initiatives the Initiative select OFFERS, and it does not offer
    // a closed one.
    it('leaves out epics of a CLOSED initiative when no initiative is given', () => {
        const idx = build({ initiatives: [...INITIATIVES, { id: 21, pipeline_fk: 2, closed: 1 }], epics });
        expect(epicIds(epicOptions(idx, { pipelineId: 2 }))).toEqual([100, 101, 102, 103]);
        // Picked explicitly, its epics are still offered.
        expect(epicIds(epicOptions(idx, { pipelineId: 2, initiativeId: 21 }))).toEqual([104]);
    });

    it('exports the initiative hop it narrows by', () => {
        const idx = build({ initiatives, epics });
        expect(idx.initiativeByEpic.get(104)).toBe(21);
    });
});

describe('pipelineOptions', () => {
    const pipelineIds = (entries) => entries.map((e) => e.pipeline.id);

    it('offers every open plan, by title', () => {
        // 'Retired plan' (5) is completed; 'paused' is still open.
        expect(labels(pipelineOptions(build()))).toEqual(['Agent Harness', 'Darwin']);
    });

    // `keepIds` carries the select's value AND the seat's plan, so a reader
    // who scopes away from a closed seat plan can pick their way back.
    it('always offers a kept plan, even a closed one', () => {
        expect(pipelineIds(pipelineOptions(build(), { keepIds: [5] })))
            .toEqual([79, 2, 5]);
        expect(pipelineIds(pipelineOptions(build(), { keepIds: [79, 5, null] })))
            .toEqual([79, 2, 5]);
    });

    it('invents a row for a kept plan missing from the read', () => {
        const entries = pipelineOptions(build(), { keepIds: [999] });
        expect(entries.find((e) => e.pipeline.id === 999).label).toBe('Pipeline 999');
    });

    it('is empty over an empty index', () => {
        expect(pipelineOptions(emptyOrchestrationIndex())).toEqual([]);
    });
});

describe('initiativeOptions', () => {
    const initiatives = [
        { id: 20, pipeline_fk: 2, title: 'B', sort_order: 2 },
        { id: 21, pipeline_fk: 2, title: 'A', sort_order: 1 },
        { id: 22, pipeline_fk: 2, title: 'Closed', sort_order: 0, closed: 1 },
        { id: 23, pipeline_fk: 2, title: 'Unordered' },
        { id: 790, pipeline_fk: 79, title: 'Other plan', sort_order: 0 },
    ];
    const initiativeIds = (entries) => entries.map((e) => e.initiative.id);

    it('offers the plan\u2019s open initiatives by sort_order, unordered last', () => {
        expect(initiativeIds(initiativeOptions(build({ initiatives }), { pipelineId: 2 }))).toEqual([21, 20, 23]);
    });

    it('offers nothing without a plan', () => {
        expect(initiativeOptions(build({ initiatives }), {})).toEqual([]);
    });

    it('always offers a kept initiative of the plan, even a closed one', () => {
        expect(initiativeIds(initiativeOptions(build({ initiatives }), { pipelineId: 2, keepIds: [22] })))
            .toEqual([22, 21, 20, 23]);
        // ...but never a kept initiative of ANOTHER plan.
        expect(initiativeIds(initiativeOptions(build({ initiatives }), { pipelineId: 2, keepIds: [790] })))
            .toEqual([21, 20, 23]);
    });

    // The select's own value has to be in its list, or MUI renders blank and
    // warns — e.g. an initiative deleted elsewhere while the reader was scoped to it.
    it('invents a row for a current initiative missing from the read', () => {
        const entries = initiativeOptions(build({ initiatives }), { pipelineId: 2, currentInitiativeId: 999 });
        expect(entries.find((e) => e.initiative.id === 999).label).toBe('Initiative 999');
    });

    it('falls back to the initiative id for an untitled initiative', () => {
        expect(labels(initiativeOptions(build(), { pipelineId: 2 }))).toEqual(['Initiative 20']);
    });
});
