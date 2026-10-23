// pipelinePlanTime.test.js — the derived START rules behind the Plan
// visualizer's time axis (req #3201).
//
// These are the DECISIONS the requirement asked to be made explicitly rather
// than left to whatever the data happened to do, so each one is pinned here:
// which requirements count as started, what "not started" positively means,
// and the difference between FUTURE (a claim) and UNKNOWN (no claim).

import { describe, it, expect } from 'vitest';

import {
    requirementLastActivity, stepTime, planTimeAxis, isNotYetStarted, emptyStepStart,
    runningStepTime, pullFutureGatesToToday, dragFutureDependentsToToday, localDayOf,
    TIME_DATED, TIME_FUTURE, TIME_UNKNOWN,
} from '../pipelinePlanTime';
import { TERMINAL_REQUIREMENT_STATUSES } from '../pipelineModel';

const req = (o) => ({
    id: 1, title: 't', requirement_status: 'met', feature_fk: null,
    machine_fk: null, coordination_type: 'implemented', tracking: 0,
    started_at: null, completed_at: null, ...o,
});
const row = (o) => ({ id: 1, reqIds: [], initiativeId: 1, ...o });
const index = (reqs) => new Map(reqs.map((r) => [r.id, r]));

describe('requirementLastActivity (req #3692)', () => {
    it('takes the LATER of started_at and completed_at', () => {
        expect(requirementLastActivity(req({
            started_at: '2026-10-17T09:00:00', completed_at: '2026-10-20T01:00:00',
        }))).toBe('2026-10-20T01:00:00');
        expect(requirementLastActivity(req({ started_at: '2026-10-20T01:00:00' })))
            .toBe('2026-10-20T01:00:00');
    });

    // 820 of 960 live `met` requirements have no `started_at` at all; treating
    // them as never-worked banishes finished work to the right-hand future.
    it('uses completed_at alone — terminal-without-a-start COUNTS as activity', () => {
        expect(requirementLastActivity(req({ completed_at: 'B' }))).toBe('B');
    });

    it('is null when neither stamp exists', () => {
        expect(requirementLastActivity(req({}))).toBe(null);
        expect(requirementLastActivity(null)).toBe(null);
    });
});

describe('stepTime', () => {
    // THE req #3692 rule: a step aligns to the LAST activity of its
    // requirements, not the first. Under req #3201's minimum, a step whose
    // first requirement closed yesterday sat in yesterday's column even when
    // its others closed today.
    it('takes the MAXIMUM over the step\'s requirements', () => {
        const reqs = [
            req({ id: 1, completed_at: '2026-07-26T00:00:00' }),
            req({ id: 2, started_at: '2026-07-24T00:00:00' }),
        ];
        expect(stepTime(row({ reqIds: [1, 2] }), index(reqs)))
            .toEqual({ at: '2026-07-26T00:00:00', kind: TIME_DATED });
    });

    it('stays dated when work is mixed with not-yet-started requirements', () => {
        const reqs = [
            req({ id: 1, completed_at: '2026-10-19T00:00:00' }),
            req({ id: 2, requirement_status: 'swarm_ready' }),
        ];
        expect(stepTime(row({ reqIds: [1, 2] }), index(reqs)))
            .toEqual({ at: '2026-10-19T00:00:00', kind: TIME_DATED });
    });

    // req #3750 — a step has no time of its own; requirement stamps are the
    // only source.
    it('gives a req-less step no time', () => {
        expect(stepTime(row({ reqIds: [] }), new Map()))
            .toEqual({ at: null, kind: TIME_UNKNOWN });
    });

    it('dates a step from its requirements alone, containers included', () => {
        const reqs = [req({ id: 1, tracking: 1, completed_at: '2026-07-20T00:00:00' })];
        expect(stepTime(row({ reqIds: [1] }), index(reqs)))
            .toEqual({ at: '2026-07-20T00:00:00', kind: TIME_DATED });
    });

    it('is FUTURE when every requirement is positively not-yet-started', () => {
        const reqs = [
            req({ id: 1, requirement_status: 'authoring' }),
            req({ id: 2, requirement_status: 'approved' }),
            req({ id: 3, requirement_status: 'swarm_ready' }),
        ];
        expect(stepTime(row({ reqIds: [1, 2, 3] }), index(reqs)).kind).toBe(TIME_FUTURE);
    });

    // THE review finding. `deferred` is TERMINAL — deriveStepState returns
    // `done` for a step whose requirements are all terminal — so calling it
    // not-yet-started put a green checked bead in the not-yet-begun region and,
    // because the monotone max propagates FUTURE downstream, dragged that
    // step's whole subtree with it. Live case: pipeline 2 step 35 "Messaging
    // Design", requirement 3108, deferred with no stamps.
    it.each(TERMINAL_REQUIREMENT_STATUSES)(
        'never calls a step FUTURE on a terminal requirement (%s)', (status) => {
            const reqs = [req({ id: 1, requirement_status: status })];
            expect(stepTime(row({ reqIds: [1] }), index(reqs)).kind).toBe(TIME_UNKNOWN);
        });

    it('classifies not-yet-started from the ENGINE\'s terminal set, not a local list', () => {
        for (const s of TERMINAL_REQUIREMENT_STATUSES) expect(isNotYetStarted(s)).toBe(false);
        expect(isNotYetStarted('development')).toBe(false);
        for (const s of ['authoring', 'approved', 'swarm_ready']) {
            expect(isNotYetStarted(s)).toBe(true);
        }
    });

    it('is UNKNOWN, not FUTURE, when a met requirement lost both stamps', () => {
        const reqs = [
            req({ id: 1, requirement_status: 'met' }),
            req({ id: 2, requirement_status: 'authoring' }),
        ];
        expect(stepTime(row({ reqIds: [1, 2] }), index(reqs)).kind).toBe(TIME_UNKNOWN);
    });

    it('ignores links whose requirement is missing from the read', () => {
        expect(stepTime(row({ reqIds: [999] }), new Map()).kind).toBe(TIME_UNKNOWN);
    });
});

describe('planTimeAxis', () => {
    it('gives every band the MINIMUM time of its own steps, null when none started', () => {
        const reqs = [
            req({ id: 1, completed_at: '2026-07-26T00:00:00' }),
            req({ id: 2, completed_at: '2026-07-24T00:00:00' }),
            req({ id: 3, requirement_status: 'authoring' }),
        ];
        const rows = [
            row({ id: 10, initiativeId: 5, reqIds: [1] }),
            row({ id: 11, initiativeId: 5, reqIds: [2] }),
            row({ id: 12, initiativeId: 6, reqIds: [3] }),
            row({ id: 13, initiativeId: null, reqIds: [] }),
        ];
        const { stepStarts, bandStarts, bandKinds } = planTimeAxis(rows, reqs);
        expect(bandStarts.get(5)).toBe('2026-07-24T00:00:00');
        expect(bandStarts.get(6)).toBe(null);
        expect(bandStarts.get(null)).toBe(null);
        expect(stepStarts.get(12).kind).toBe(TIME_FUTURE);
        expect(stepStarts.get(13).kind).toBe(TIME_UNKNOWN);
        expect(bandKinds.get(5)).toBe(TIME_DATED);
        expect(bandKinds.get(6)).toBe(TIME_FUTURE);
        expect(bandKinds.get(null)).toBe(TIME_UNKNOWN);
    });

    // A NULL start used to mean both "has not begun" and "began, but nobody
    // stamped it", which sorted an ACTIVE initiative into the backlog tier.
    it('separates an unstamped-but-active initiative from a never-started one', () => {
        const reqs = [
            req({ id: 1, requirement_status: 'development' }),   // in flight, unstamped
            req({ id: 2, requirement_status: 'authoring' }),     // untouched backlog
        ];
        const rows = [
            row({ id: 1, initiativeId: 7, reqIds: [1] }),
            row({ id: 2, initiativeId: 6, reqIds: [2] }),
        ];
        const { bandStarts, bandKinds } = planTimeAxis(rows, reqs);
        expect(bandStarts.get(7)).toBe(null);
        expect(bandStarts.get(6)).toBe(null);
        expect(bandKinds.get(7)).toBe(TIME_UNKNOWN);
        expect(bandKinds.get(6)).toBe(TIME_FUTURE);
    });

    it('tolerates junk input rather than throwing on a mid-fetch render', () => {
        const { stepStarts, bandStarts } = planTimeAxis(null, null);
        expect(stepStarts.size).toBe(0);
        expect(bandStarts.size).toBe(0);
    });
});

// req #3618 — rule 3: an EMPTY step sits on TODAY when the plan has active
// work, else in the FUTURE. Without a `now` the rule does not apply.
describe('empty step placement (req #3618)', () => {
    const NOW = '2026-10-18T07:30:00Z';

    it('stamps an empty step TODAY (UTC) when any step in the plan is running', () => {
        const rows = [
            row({ id: 1, reqIds: [1], state: 'running' }),
            row({ id: 2, reqIds: [] }),
        ];
        const { stepStarts } = planTimeAxis(rows, [req({ id: 1, requirement_status: 'development' })], NOW);
        expect(stepStarts.get(2)).toEqual({ at: '2026-10-18T07:30:00', kind: TIME_DATED });
    });

    it('puts an empty step in the FUTURE when nothing in the plan is running', () => {
        const rows = [
            row({ id: 1, reqIds: [1], state: 'done' }),
            row({ id: 2, reqIds: [] }),
        ];
        const { stepStarts } = planTimeAxis(rows, [req({ id: 1, completed_at: '2026-10-17T00:00:00' })], NOW);
        expect(stepStarts.get(2)).toEqual({ at: null, kind: TIME_FUTURE });
    });

    it('emptyStepStart answers only for an empty row with a clock', () => {
        expect(emptyStepStart(row({}), '2026-10-18T07:30:00', true).at).toBe('2026-10-18T07:30:00');
        expect(emptyStepStart(row({ reqIds: [1] }), '2026-10-18T07:30:00', true)).toBe(null);
        expect(emptyStepStart(row({}), null, true)).toBe(null);
    });

    it('accepts a Date as the clock', () => {
        const { stepStarts } = planTimeAxis(
            [row({ id: 1, reqIds: [9], state: 'running' }), row({ id: 2 })], [], new Date(NOW));
        expect(stepStarts.get(2).at).toBe('2026-10-18T07:30:00');
    });

    // req #3750 — a req-less step is EMPTY: it takes rule 3's TODAY, and a
    // step WITH requirements is left alone.
    it('treats every req-less step as empty, and leaves a step WITH requirements alone', () => {
        const rows = [
            row({ id: 1, reqIds: [] }),
            row({ id: 2, reqIds: [5] }),
            row({ id: 3, reqIds: [6], state: 'running' }),   // makes the plan active
        ];
        const { stepStarts } = planTimeAxis(rows, [req({ id: 5, requirement_status: 'authoring' })], NOW);
        expect(stepStarts.get(1)).toEqual({ at: '2026-10-18T07:30:00', kind: TIME_DATED });
        expect(stepStarts.get(2).kind).toBe(TIME_FUTURE);
    });

    it('does not apply without a clock, or with an unparseable one', () => {
        const rows = [row({ id: 1, reqIds: [1], state: 'running' }), row({ id: 2 })];
        expect(planTimeAxis(rows, []).stepStarts.get(2).kind).toBe(TIME_UNKNOWN);
        expect(planTimeAxis(rows, [], 'not a date').stepStarts.get(2).kind).toBe(TIME_UNKNOWN);
    });
});

// req #3692 — rule 4: a RUNNING step sits on TODAY, so every open step of every
// initiative stacks in one column, and a step worked today sits on today by rule 1.
describe('running and today\'s work share one column (req #3692)', () => {
    const NOW = '2026-10-20T07:50:00Z';

    it('runningStepTime answers only for a running row with a clock', () => {
        expect(runningStepTime(row({ state: 'running' }), '2026-10-20T07:50:00'))
            .toEqual({ at: '2026-10-20T07:50:00', kind: TIME_DATED });
        expect(runningStepTime(row({ state: 'pending' }), '2026-10-20T07:50:00')).toBe(null);
        expect(runningStepTime(row({ state: 'running' }), null)).toBe(null);
    });

    it('puts a running step on TODAY even when its stamps are days old', () => {
        const reqs = [req({ id: 1, requirement_status: 'development', started_at: '2026-10-17T09:00:00' })];
        const { stepStarts } = planTimeAxis(
            [row({ id: 1, reqIds: [1], state: 'running' })], reqs, NOW);
        expect(stepStarts.get(1)).toEqual({ at: '2026-10-20T07:50:00', kind: TIME_DATED });
    });

    it('falls back to the stamps without a clock', () => {
        const reqs = [req({ id: 1, requirement_status: 'development', started_at: '2026-10-17T09:00:00' })];
        const { stepStarts } = planTimeAxis(
            [row({ id: 1, reqIds: [1], state: 'running' })], reqs);
        expect(stepStarts.get(1)).toEqual({ at: '2026-10-17T09:00:00', kind: TIME_DATED });
    });

    // Live pipeline 10, 2026-10-20: the Sunday Review initiative's steps each had a
    // requirement close on the 19th AND one close (or start) on the 20th; the
    // Drag and Drop initiative's one running step started on the 20th. Under the
    // req #3201 minimum they split across two day columns.
    it('puts two initiatives\' running and today-worked steps on the same day', () => {
        const reqs = [
            req({ id: 3642, completed_at: '2026-10-19T03:00:00' }),
            req({ id: 3677, completed_at: '2026-10-20T01:00:00' }),
            req({ id: 3691, requirement_status: 'development', started_at: '2026-10-20T07:40:00' }),
            req({ id: 3643, completed_at: '2026-10-19T04:00:00' }),
            req({ id: 3689, completed_at: '2026-10-20T07:20:00' }),
            req({ id: 3662, requirement_status: 'development', started_at: '2026-10-20T06:00:00' }),
            req({ id: 3663, requirement_status: 'swarm_ready' }),
        ];
        const rows = [
            row({ id: 320, initiativeId: 24, reqIds: [3642, 3677, 3691], state: 'running' }),
            row({ id: 321, initiativeId: 24, reqIds: [3643, 3689], state: 'done' }),
            row({ id: 325, initiativeId: 25, reqIds: [3662], state: 'running' }),
            row({ id: 326, initiativeId: 25, reqIds: [3663], state: 'pending' }),
        ];
        const { stepStarts } = planTimeAxis(rows, reqs, NOW);
        const day = (id) => stepStarts.get(id).at.slice(0, 10);
        expect(day(320)).toBe('2026-10-20');
        expect(day(321)).toBe('2026-10-20');
        expect(day(325)).toBe('2026-10-20');
        expect(stepStarts.get(326).kind).toBe(TIME_FUTURE);
    });
});

// req #3692 review — rule 5: a running step's unstarted gate comes to today with
// it, so the layout's monotonize step cannot drag running work into FUTURE.
describe('an unstarted gate of running work sits on today (req #3692)', () => {
    const NOW = '2026-10-20T07:50:00Z';

    it('pulls a FUTURE dependency of a running step onto today, transitively', () => {
        const reqs = [
            req({ id: 1, requirement_status: 'swarm_ready' }),
            req({ id: 2, requirement_status: 'swarm_ready' }),
            req({ id: 3, requirement_status: 'development', started_at: '2026-10-20T06:00:00' }),
            req({ id: 4, requirement_status: 'swarm_ready' }),
        ];
        const rows = [
            row({ id: 1, reqIds: [1], depIds: [], state: 'pending' }),
            row({ id: 2, reqIds: [2], depIds: [1], state: 'pending' }),
            row({ id: 3, reqIds: [3], depIds: [2], state: 'running' }),
            row({ id: 4, reqIds: [4], depIds: [3], state: 'pending' }),
        ];
        const { stepStarts } = planTimeAxis(rows, reqs, NOW);
        expect(stepStarts.get(1)).toEqual({ at: '2026-10-20T07:50:00', kind: TIME_DATED });
        expect(stepStarts.get(2)).toEqual({ at: '2026-10-20T07:50:00', kind: TIME_DATED });
        // Rule 6: step 4 hangs off running step 3, so it follows it to today.
        expect(stepStarts.get(4)).toEqual({ at: '2026-10-20T07:50:00', kind: TIME_DATED });
    });

    it('leaves a DATED gate on its own day, and does nothing without a clock', () => {
        const starts = new Map([
            [1, { at: '2026-10-18T00:00:00', kind: TIME_DATED }],
            [2, { at: null, kind: TIME_FUTURE }],
        ]);
        const rows = [
            row({ id: 1, depIds: [] }),
            row({ id: 2, depIds: [] }),
            row({ id: 3, depIds: [1, 2], state: 'running' }),
        ];
        pullFutureGatesToToday(rows, starts, null);
        expect(starts.get(2).kind).toBe(TIME_FUTURE);
        pullFutureGatesToToday(rows, starts, '2026-10-20T07:50:00');
        expect(starts.get(1).at).toBe('2026-10-18T00:00:00');
        expect(starts.get(2)).toEqual({ at: '2026-10-20T07:50:00', kind: TIME_DATED });
    });
});

// req #3692 review — a DAY is the reader's local day. These assertions are
// written for the suite's pinned zone (`test:unit` runs TZ=America/Los_Angeles)
// and checked against it, so they cannot pass vacuously in UTC.
describe('localDayOf (req #3692)', () => {
    const pacific = new Date('2026-10-20T00:30:00Z').getTimezoneOffset() === 420;

    it('reads a zone-less UTC stamp as the local calendar day', () => {
        if (!pacific) return;
        // 00:06 UTC on the 18th is 17:06 Pacific on the 17th.
        expect(localDayOf('2026-10-18T00:06:02')).toBe('2026-10-17');
        expect(localDayOf('2026-10-18 00:06:02.000000')).toBe('2026-10-17');
        expect(localDayOf('2026-10-18T19:00:00')).toBe('2026-10-18');
        expect(localDayOf(new Date('2026-10-21T02:00:00Z'))).toBe('2026-10-20');
    });

    it('honours an explicit zone, and is null for no stamp', () => {
        if (!pacific) return;
        expect(localDayOf('2026-10-18T00:06:02Z')).toBe('2026-10-17');
        expect(localDayOf('2026-10-18T00:06:02-07:00')).toBe('2026-10-18');
        expect(localDayOf(null)).toBe(null);
        expect(localDayOf('')).toBe(null);
    });
});

// req #3692, the user's review of the first cut — rule 6: today's work drags
// its not-yet-started dependents onto today. Live pipeline 10's Drag and Drop
// steps 326-328 queued behind running 325 were flung past the whole Sunday
// Review initiative into the FUTURE slot.
describe('today\'s work drags its queued dependents with it (req #3692)', () => {
    const NOW = '2026-10-20T19:00:00Z';

    it('places the whole queued chain behind a running step on today', () => {
        const reqs = [
            req({ id: 3662, requirement_status: 'development', started_at: '2026-10-20T06:00:00' }),
            req({ id: 3663, requirement_status: 'swarm_ready' }),
            req({ id: 3664, requirement_status: 'swarm_ready' }),
            req({ id: 3665, requirement_status: 'swarm_ready' }),
        ];
        const rows = [
            row({ id: 325, reqIds: [3662], depIds: [], state: 'running' }),
            row({ id: 326, reqIds: [3663], depIds: [325], state: 'pending' }),
            row({ id: 327, reqIds: [3664], depIds: [326], state: 'pending' }),
            row({ id: 328, reqIds: [3665], depIds: [327], state: 'pending' }),
        ];
        const { stepStarts } = planTimeAxis(rows, reqs, NOW);
        for (const id of [326, 327, 328]) {
            expect(stepStarts.get(id)).toEqual({ at: '2026-10-20T19:00:00', kind: TIME_DATED });
        }
    });

    // Stamps at noon UTC so "today" is one local day in any zone from UTC-11
    // to UTC+11, not only the suite's pinned Pacific.
    it('drags through a step WORKED today (not running), and through an older-dated one', () => {
        const starts = new Map([
            [1, { at: '2026-10-20T11:00:00', kind: TIME_DATED }],   // finished today
            [2, { at: '2026-10-12T00:00:00', kind: TIME_DATED }],   // older, gated on 1
            [3, { at: null, kind: TIME_FUTURE }],                   // queued behind 2
        ]);
        const rows = [
            row({ id: 1, depIds: [] }),
            row({ id: 2, depIds: [1] }),
            row({ id: 3, depIds: [2] }),
        ];
        dragFutureDependentsToToday(rows, starts, '2026-10-20T12:00:00');
        expect(starts.get(2).at).toBe('2026-10-12T00:00:00');   // the layout moves it
        expect(starts.get(3)).toEqual({ at: '2026-10-20T12:00:00', kind: TIME_DATED });
    });

    it('leaves backlog with no path from today, and backlog behind an OLDER day, in the future', () => {
        const starts = new Map([
            [1, { at: '2026-08-10T00:00:00', kind: TIME_DATED }],
            [2, { at: null, kind: TIME_FUTURE }],   // behind 08-10 work only
            [3, { at: null, kind: TIME_FUTURE }],   // no deps at all
        ]);
        const rows = [row({ id: 1, depIds: [] }), row({ id: 2, depIds: [1] }), row({ id: 3, depIds: [] })];
        dragFutureDependentsToToday(rows, starts, '2026-10-20T19:00:00');
        expect(starts.get(2).kind).toBe(TIME_FUTURE);
        expect(starts.get(3).kind).toBe(TIME_FUTURE);
        dragFutureDependentsToToday(rows, starts, null);
        expect(starts.get(2).kind).toBe(TIME_FUTURE);
    });
});

// req #3692, second review: rules 5 and 6 together, to a fixed point. Each case
// is one the first cut still drew in the FUTURE column.
describe('today\'s work and its gates settle together (req #3692)', () => {
    const NOW = '2026-10-20T12:00:00Z';
    const TODAY = '2026-10-20T12:00:00';

    // W2: dependencies are a launch priority, so a step can FINISH before a
    // step it depends on has started. Finished today means it is today's work.
    it('pulls the unstarted gate of a step FINISHED today onto today', () => {
        const reqs = [
            req({ id: 1, requirement_status: 'swarm_ready' }),
            req({ id: 2, completed_at: '2026-10-20T10:00:00' }),
        ];
        const rows = [
            row({ id: 1, reqIds: [1], depIds: [], state: 'pending' }),
            row({ id: 2, reqIds: [2], depIds: [1], state: 'done' }),
        ];
        const { stepStarts } = planTimeAxis(rows, reqs, NOW);
        expect(stepStarts.get(1)).toEqual({ at: TODAY, kind: TIME_DATED });
    });

    // W1: a dependent dragged onto today that ALSO waits on unrelated backlog.
    // Without the second pass the backlog gate stays FUTURE and the layout
    // draws the dependent in FUTURE after it.
    it('pulls a second, unrelated gate of a dragged dependent onto today', () => {
        const reqs = [
            req({ id: 1, requirement_status: 'development', started_at: '2026-10-20T09:00:00' }),
            req({ id: 2, requirement_status: 'swarm_ready' }),
            req({ id: 3, requirement_status: 'swarm_ready' }),
        ];
        const rows = [
            row({ id: 1, reqIds: [1], depIds: [], state: 'running' }),
            row({ id: 2, reqIds: [2], depIds: [], state: 'pending' }),      // backlog gate
            row({ id: 3, reqIds: [3], depIds: [1, 2], state: 'pending' }),  // dragged by 1
        ];
        const { stepStarts } = planTimeAxis(rows, reqs, NOW);
        expect(stepStarts.get(3)).toEqual({ at: TODAY, kind: TIME_DATED });
        expect(stepStarts.get(2)).toEqual({ at: TODAY, kind: TIME_DATED });
    });

    it('still leaves backlog with no tie to today in the future', () => {
        const reqs = [
            req({ id: 1, requirement_status: 'development', started_at: '2026-10-20T09:00:00' }),
            req({ id: 2, requirement_status: 'swarm_ready' }),
        ];
        const rows = [
            row({ id: 1, reqIds: [1], depIds: [], state: 'running' }),
            row({ id: 2, reqIds: [2], depIds: [], state: 'pending' }),
        ];
        expect(planTimeAxis(rows, reqs, NOW).stepStarts.get(2).kind).toBe(TIME_FUTURE);
    });
});
