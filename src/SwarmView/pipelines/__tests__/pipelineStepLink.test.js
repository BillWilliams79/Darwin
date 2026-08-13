// Req #3140 — the addressable-step contract.
//
// Both halves live in one module precisely so they can be pinned against each
// other: the round-trip test below is the whole point of the file. A builder that
// emits `?stepId=` and a reader that looks for `?step=` would each pass their own
// unit test and produce a link that navigates to the right plan and silently
// highlights nothing.

import { describe, it, expect } from 'vitest';
import {
    FOCUS_LEVEL_PARAM,
    FOCUS_STEP_PARAM,
    STEP_PLAN_LINK_LEVEL,
    readFocusStepParam,
    readLevelParam,
    stepLinkTo,
    stepPlanLinkTo,
} from '../pipelineStepLink';
import { PLAN_LEVEL_BY_PREF } from '../pipelinePlanLayout';

describe('stepLinkTo', () => {
    it('names the plan, the table mode and the step', () => {
        expect(stepLinkTo(2, 47)).toBe('/swarm/pipeline/2?mode=table&step=47');
    });

    it('accepts numeric strings, because a grid row carries whatever the wire sent', () => {
        expect(stepLinkTo('2', '47')).toBe('/swarm/pipeline/2?mode=table&step=47');
    });

    it('returns null rather than a link to /swarm/pipeline/undefined', () => {
        // The caller renders a plain chip instead. A step whose pipeline did not
        // resolve is a real state on the editor page — the pipelines read can fail
        // independently of the steps read.
        expect(stepLinkTo(null, 47)).toBeNull();
        expect(stepLinkTo(undefined, 47)).toBeNull();
        expect(stepLinkTo(2, null)).toBeNull();
        expect(stepLinkTo('abc', 47)).toBeNull();
        expect(stepLinkTo(2, 1.5)).toBeNull();
    });
});

describe('readFocusStepParam', () => {
    const params = (search) => new URLSearchParams(search);

    it('reads the id a link names', () => {
        expect(readFocusStepParam(params('mode=table&step=47'))).toBe(47);
    });

    it('is null when the parameter is absent', () => {
        expect(readFocusStepParam(params('mode=table'))).toBeNull();
    });

    it('rejects every non-integer form rather than producing a NaN or a 0', () => {
        // `Number('')` is 0 and `Number('12abc')` is NaN. Both would be handed to a
        // `row.id === focusStepId` comparison and to a querySelector, matching
        // nothing while suppressing nothing — a highlight that silently never
        // appears is worse than no parameter at all.
        expect(readFocusStepParam(params('step='))).toBeNull();
        expect(readFocusStepParam(params('step=%20'))).toBeNull();
        expect(readFocusStepParam(params('step=12abc'))).toBeNull();
        expect(readFocusStepParam(params('step=1.5'))).toBeNull();
        expect(readFocusStepParam(params('step=NaN'))).toBeNull();
    });

    it('survives a caller with no search params at all', () => {
        expect(readFocusStepParam(null)).toBeNull();
        expect(readFocusStepParam(undefined)).toBeNull();
        expect(readFocusStepParam({})).toBeNull();
    });

    it('round-trips what stepLinkTo built', () => {
        const to = stepLinkTo(2, 47);
        const search = to.slice(to.indexOf('?'));
        expect(readFocusStepParam(new URLSearchParams(search))).toBe(47);
        expect(new URLSearchParams(search).get('mode')).toBe('table');
    });

    it('exports the key both halves agree on', () => {
        expect(FOCUS_STEP_PARAM).toBe('step');
        expect(stepLinkTo(1, 2)).toContain(`${FOCUS_STEP_PARAM}=2`);
    });

    // req #3356 — the `era` PARAMETER IS GONE, not merely defaulted. It existed
    // so a caller holding a 1.0 id could ask for the 1.0 route; there are no 1.0
    // ids and no 1.0 route. A surviving parameter would be a way to ask for a
    // page that does not exist, which is req #3462's shape.
    it('takes no era argument — a stray one cannot redirect the link', () => {
        expect(stepLinkTo(2, 47, 1)).toBe(stepLinkTo(2, 47));
        expect(stepPlanLinkTo(2, 47, 1)).toBe(stepPlanLinkTo(2, 47));
    });
});

// ── Req #3253 — the same step, seen on the PLAN ─────────────────────────────
describe('stepPlanLinkTo', () => {
    it('names the plan, the plan mode, the step and the level', () => {
        expect(stepPlanLinkTo(2, 47)).toBe('/swarm/pipeline/2?mode=plan&step=47&level=3');
    });

    it('is the SAME step parameter as the table link, not a third landing mode', () => {
        const table = new URLSearchParams(stepLinkTo(2, 47).split('?')[1]);
        const plan = new URLSearchParams(stepPlanLinkTo(2, 47).split('?')[1]);
        expect(readFocusStepParam(plan)).toBe(readFocusStepParam(table));
        expect(plan.get('mode')).toBe('plan');
        expect(table.get('mode')).toBe('table');
    });

    it('applies the same id validation — a dead link is worse than no link', () => {
        expect(stepPlanLinkTo(null, 47)).toBeNull();
        expect(stepPlanLinkTo(2, null)).toBeNull();
        expect(stepPlanLinkTo(2, '')).toBeNull();
        expect(stepPlanLinkTo('abc', 47)).toBeNull();
        expect(stepPlanLinkTo(2, 1.5)).toBeNull();
    });

    it('pins L3 — the card, with all its detail (req #3498)', () => {
        // The string is interpolated into the URL and read back through
        // `isPlanLevelPref`; a value the map does not carry would round-trip to
        // null and silently pin nothing. So this asserts BOTH halves: the level
        // the reader gets, and that the vocabulary defines it.
        //
        // It was 'mid' until req #3498. The link lands on ONE card now, framed
        // at a fifth of the panel, and the requirement titles it draws are that
        // card's own contents rather than prose floating over the plan — which
        // is what made L3 a wall in req #3253 and no longer does.
        expect(STEP_PLAN_LINK_LEVEL).toBe('3');
        expect(PLAN_LEVEL_BY_PREF[STEP_PLAN_LINK_LEVEL]).toBe('in');
    });
});

describe('readLevelParam', () => {
    const params = (search) => new URLSearchParams(search);

    it('reads the level a link names', () => {
        expect(readLevelParam(params('mode=plan&level=2'))).toBe('2');
        expect(readLevelParam(params('level=auto'))).toBe('auto');
        expect(readLevelParam(params('level=1'))).toBe('1');
        expect(readLevelParam(params('level=3'))).toBe('3');
    });

    it('is null — NOT auto — for anything outside the vocabulary', () => {
        // 'auto' is a real pin: answering it here would DISCARD a reader's stored
        // L3 on a typo. Null leaves the stored preference in charge, which is the
        // rule `?mode=xyz` already follows.
        expect(readLevelParam(params('mode=plan'))).toBeNull();
        expect(readLevelParam(params('level='))).toBeNull();
        expect(readLevelParam(params('level=9'))).toBeNull();
        expect(readLevelParam(params('level=2.0'))).toBeNull();
        expect(readLevelParam(params('level=mid'))).toBeNull();
    });

    it('rejects an inherited property name reached through the level map', () => {
        // The value is address-bar text used as an object key. `isPlanLevelPref`
        // is `Object.hasOwn`-based for exactly this.
        expect(readLevelParam(params('level=constructor'))).toBeNull();
        expect(readLevelParam(params('level=__proto__'))).toBeNull();
        expect(readLevelParam(params('level=toString'))).toBeNull();
    });

    it('survives a caller with no search params at all', () => {
        expect(readLevelParam(null)).toBeNull();
        expect(readLevelParam(undefined)).toBeNull();
        expect(readLevelParam({})).toBeNull();
    });

    it('round-trips what stepPlanLinkTo built', () => {
        const to = stepPlanLinkTo(2, 47);
        const search = new URLSearchParams(to.slice(to.indexOf('?')));
        expect(readFocusStepParam(search)).toBe(47);
        expect(readLevelParam(search)).toBe(STEP_PLAN_LINK_LEVEL);
        expect(search.get('mode')).toBe('plan');
    });

    it('exports the key both halves agree on', () => {
        expect(FOCUS_LEVEL_PARAM).toBe('level');
        expect(stepPlanLinkTo(1, 2)).toContain(`${FOCUS_LEVEL_PARAM}=`);
    });
});
