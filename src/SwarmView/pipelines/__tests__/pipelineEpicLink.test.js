// @vitest-environment jsdom
// Req #3140 — the addressable-epic contract.
//
// Both halves live in one module precisely so they can be pinned against each
// other: the round-trip test below is the whole point of the file. A builder that
// emits `?epicId=` and a reader that looks for `?epic=` would each pass their own
// unit test and produce a link that navigates to the right plan and silently
// highlights nothing.

import { describe, it, expect, afterEach } from 'vitest';
import {
    FOCUS_COLOR_PARAM,
    FOCUS_LEVEL_PARAM,
    FOCUS_EPIC_PARAM,
    EPIC_PLAN_LINK_LEVEL,
    readColorParam,
    readFocusEpicParam,
    readLevelParam,
    epicPlanLinkTo,
    newRequirementSeatState,
    readNewRequirementSeat,
    backToPlanQuery,
    planExitState,
    planViewCarry,
    PLAN_VIEW_PARAMS,
} from '../pipelineEpicLink';
import { PLAN_LEVEL_BY_PREF, REQ_COLOR_KEYS } from '../pipelinePlanLayout';

// `epicLinkTo` (the Table's epic link, `?mode=table&epic=`) was deleted with
// the Table by req #3641; `epicPlanLinkTo` below is the one epic link left.

describe('readFocusEpicParam', () => {
    const params = (search) => new URLSearchParams(search);

    it('reads the id a link names', () => {
        expect(readFocusEpicParam(params('mode=table&epic=47'))).toBe(47);
    });

    it('is null when the parameter is absent', () => {
        expect(readFocusEpicParam(params('mode=table'))).toBeNull();
    });

    it('rejects every non-integer form rather than producing a NaN or a 0', () => {
        // `Number('')` is 0 and `Number('12abc')` is NaN. Both would be handed to a
        // `row.id === focusEpicId` comparison and to a querySelector, matching
        // nothing while suppressing nothing — a highlight that silently never
        // appears is worse than no parameter at all.
        expect(readFocusEpicParam(params('epic='))).toBeNull();
        expect(readFocusEpicParam(params('epic=%20'))).toBeNull();
        expect(readFocusEpicParam(params('epic=12abc'))).toBeNull();
        expect(readFocusEpicParam(params('epic=1.5'))).toBeNull();
        expect(readFocusEpicParam(params('epic=NaN'))).toBeNull();
    });

    it('survives a caller with no search params at all', () => {
        expect(readFocusEpicParam(null)).toBeNull();
        expect(readFocusEpicParam(undefined)).toBeNull();
        expect(readFocusEpicParam({})).toBeNull();
    });

    it('round-trips what epicPlanLinkTo built', () => {
        const to = epicPlanLinkTo(2, 47);
        const search = to.slice(to.indexOf('?'));
        expect(readFocusEpicParam(new URLSearchParams(search))).toBe(47);
        expect(new URLSearchParams(search).get('mode')).toBe('plan');
    });

    it('exports the key both halves agree on', () => {
        expect(FOCUS_EPIC_PARAM).toBe('epic');
        expect(epicPlanLinkTo(1, 2)).toContain(`${FOCUS_EPIC_PARAM}=2`);
    });

    // req #3356 — the `era` PARAMETER IS GONE, not merely defaulted. It existed
    // so a caller holding a 1.0 id could ask for the 1.0 route; there are no 1.0
    // ids and no 1.0 route. A surviving parameter would be a way to ask for a
    // page that does not exist, which is req #3462's shape.
    it('takes no era argument — a stray one cannot redirect the link', () => {
        expect(epicPlanLinkTo(2, 47, 1)).toBe(epicPlanLinkTo(2, 47));
    });
});

// ── Req #3253 — the same epic, seen on the PLAN ─────────────────────────────
describe('epicPlanLinkTo', () => {
    it('names the plan, the plan mode, the epic and the level', () => {
        expect(epicPlanLinkTo(2, 47)).toBe('/swarm/pipeline/2?mode=plan&epic=47&level=3');
    });

    it('applies the same id validation — a dead link is worse than no link', () => {
        expect(epicPlanLinkTo(null, 47)).toBeNull();
        expect(epicPlanLinkTo(2, null)).toBeNull();
        expect(epicPlanLinkTo(2, '')).toBeNull();
        expect(epicPlanLinkTo('abc', 47)).toBeNull();
        expect(epicPlanLinkTo(2, 1.5)).toBeNull();
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
        expect(EPIC_PLAN_LINK_LEVEL).toBe('3');
        expect(PLAN_LEVEL_BY_PREF[EPIC_PLAN_LINK_LEVEL]).toBe('in');
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

    it('round-trips what epicPlanLinkTo built', () => {
        const to = epicPlanLinkTo(2, 47);
        const search = new URLSearchParams(to.slice(to.indexOf('?')));
        expect(readFocusEpicParam(search)).toBe(47);
        expect(readLevelParam(search)).toBe(EPIC_PLAN_LINK_LEVEL);
        expect(search.get('mode')).toBe('plan');
    });

    it('exports the key both halves agree on', () => {
        expect(FOCUS_LEVEL_PARAM).toBe('level');
        expect(epicPlanLinkTo(1, 2)).toContain(`${FOCUS_LEVEL_PARAM}=`);
    });
});

describe('newRequirementSeatState / readNewRequirementSeat (req #3582)', () => {
    it('round-trips the epic a "+" files into, with plan provenance', () => {
        const state = newRequirementSeatState(7, 'plan', { id: 412, title: 'Seat UI' });
        expect(state).toEqual({ seatEpicId: 412, seatEpicName: 'Seat UI',
            from: 'pipeline', pipelineId: 7, mode: 'plan', backEpicId: 412 });
        expect(readNewRequirementSeat(state)).toEqual({ epicId: 412, epicName: 'Seat UI' });
    });

    it('omits provenance without a plan and a blank name', () => {
        expect(newRequirementSeatState(null, 'table', { id: 5, title: '  ' }))
            .toEqual({ seatEpicId: 5, seatEpicName: null });
    });

    it('names no epic for a missing or non-id epic', () => {
        expect(newRequirementSeatState(7, 'plan', null)).toBeUndefined();
        expect(newRequirementSeatState(7, 'plan', { id: 'x' })).toBeUndefined();
        for (const bad of [undefined, null, {}, { seatEpicId: 0 }, { seatEpicId: 'abc' },
            { seatEpicId: 1.5 }]) {
            expect(readNewRequirementSeat(bad)).toBeNull();
        }
    });
});

describe('Back to Plan returns to the same view (req #3637)', () => {
    afterEach(() => { window.history.replaceState(null, '', '/'); });

    it('stamps the panel, and the plan\'s ?level= pin when it has one', () => {
        window.history.replaceState(null, '', '/swarm/pipeline/7?mode=plan&epic=412&level=3');
        expect(planExitState(7, 'plan')).toEqual(
            { from: 'pipeline', pipelineId: 7, mode: 'plan', level: '3' });
        window.history.replaceState(null, '', '/swarm/pipeline/7');
        expect(planExitState(7, 'table')).toEqual(
            { from: 'pipeline', pipelineId: 7, mode: 'table' });
    });

    it('lands on the plain plan — mode and level, never a ?epic= that moves the view', () => {
        expect(backToPlanQuery({ mode: 'plan', level: '3', backEpicId: 412 }))
            .toBe('mode=plan&level=3');
        expect(backToPlanQuery({ mode: 'table', backEpicId: 412 })).toBe('mode=table');
    });

    it('drops anything it cannot validate', () => {
        expect(backToPlanQuery({ mode: 'plan&x=1', level: '9' })).toBeNull();
        expect(backToPlanQuery({ color: 'chartreuse&x=1' })).toBeNull();
        expect(backToPlanQuery(undefined)).toBeNull();
    });

    // req #3651 — every view override travels, not `level` alone: a `?color=`
    // the reader was looking at used to be dropped by "Back to Plan", so it
    // landed on a different view than the browser's Back to the same entry.
    it('carries every PLAN_VIEW_PARAMS override — ?color= as well as ?level=', () => {
        window.history.replaceState(null, '', '/swarm/pipeline/7?mode=plan&level=2&color=session');
        const state = planExitState(7, 'plan');
        expect(state).toEqual(
            { from: 'pipeline', pipelineId: 7, mode: 'plan', level: '2', color: 'session' });
        expect(backToPlanQuery(state)).toBe('mode=plan&level=2&color=session');
        // …and what a page re-writing its own state must forward.
        expect(planViewCarry({ ...state, backEpicId: 9 })).toEqual({ level: '2', color: 'session' });
        expect(PLAN_VIEW_PARAMS.map((p) => p.param)).toEqual(['level', 'color']);
    });
});

describe('readColorParam (req #3636)', () => {
    const params = (search) => new URLSearchParams(search);

    it('is spelled `color`', () => {
        expect(FOCUS_COLOR_PARAM).toBe('color');
    });

    it('reads every registered colour key a link names', () => {
        for (const key of REQ_COLOR_KEYS) {
            expect(readColorParam(params(`mode=plan&color=${key}`))).toBe(key);
        }
    });

    it('is null for anything outside REQ_COLOR_KEYS, so the stored key stays in charge', () => {
        expect(readColorParam(params('mode=plan'))).toBeNull();
        expect(readColorParam(params('color='))).toBeNull();
        expect(readColorParam(params('color=Session'))).toBeNull();
        expect(readColorParam(params('color=constructor'))).toBeNull();
        expect(readColorParam(params('color=__proto__'))).toBeNull();
    });

    it('survives a caller with no search params at all', () => {
        expect(readColorParam(null)).toBeNull();
        expect(readColorParam(undefined)).toBeNull();
        expect(readColorParam({})).toBeNull();
    });
});
