// Req #3431 — the route trail.
//
// One consumer reads this: the pipelines list's resume gate, whose whole safety
// argument is "did the reader arrive from a plan". Every case below is a way
// that answer can be wrong, and each wrong answer has the same consequence —
// either the resume never fires (the feature is absent) or it fires when the
// reader walked back out to the list (the list becomes unreachable).
//
// No DOM: the module is deliberately React-free.

import { describe, it, expect, beforeEach } from 'vitest';

import { cameFrom, noteRoute, resetRouteTrail } from '../routeTrail';

const LIST = '/swarm/pipelines';
const PLAN = '/swarm/pipeline/2';

describe('routeTrail', () => {
    beforeEach(() => { resetRouteTrail(); });

    describe('a cold trail', () => {
        // A fresh open, a reload, a bookmark, an external link. "Nowhere" is the
        // case the resume exists to serve, so it must not read as a plan.
        it('reports no origin at all', () => {
            expect(cameFrom(LIST)).toBeNull();
        });

        it('still reports no origin once the first route is noted', () => {
            noteRoute(LIST);
            expect(cameFrom(LIST)).toBeNull();
        });
    });

    describe('the effect-ordering contract', () => {
        // React runs a CHILD's effects before its PARENT's, so the page asking
        // the question may run either before or after the shell has advanced the
        // trail. Both orderings must produce the same answer or the resume gate
        // is a coin flip — and the failing half is silent.
        it('answers the same before the shell has advanced the trail', () => {
            noteRoute(PLAN);
            // The shell has NOT yet noted the list: the trail still sits on the
            // plan, and the plan is where the reader came from.
            expect(cameFrom(LIST)).toBe(PLAN);
        });

        it('answers the same after the shell has advanced the trail', () => {
            noteRoute(PLAN);
            noteRoute(LIST);
            expect(cameFrom(LIST)).toBe(PLAN);
        });
    });

    describe('repeat notifications', () => {
        // `App` re-runs its effect on any location change. A navigation to the
        // path already showing, or a re-render that re-notes it, must not
        // shuffle the current path into the previous slot — that would report
        // "you came from a plan" to a reader who is still on that plan and has
        // gone nowhere.
        it('ignores the path it is already on', () => {
            noteRoute(PLAN);
            noteRoute(LIST);
            noteRoute(LIST);
            noteRoute(LIST);
            expect(cameFrom(LIST)).toBe(PLAN);
        });
    });

    describe('a multi-step journey', () => {
        // The scenario the requirement describes: leave a plan for somewhere
        // else entirely, come back later. The origin is the page in between, so
        // the resume fires — leaving a plan for another part of the app is not
        // the same act as walking back out to the list.
        it('remembers only the immediately preceding route', () => {
            noteRoute(PLAN);
            noteRoute('/swarm/sessions');
            noteRoute(LIST);
            expect(cameFrom(LIST)).toBe('/swarm/sessions');
        });
    });

    describe('values that are not routes', () => {
        // `location.pathname` is always a string, but this module is a side
        // channel any caller can reach. A null or '' write must not blank the
        // trail — a lost origin is the bounce case.
        it('ignores nullish and empty writes', () => {
            noteRoute(PLAN);
            noteRoute(null);
            noteRoute(undefined);
            noteRoute('');
            noteRoute(42);
            expect(cameFrom(LIST)).toBe(PLAN);
        });
    });
});
