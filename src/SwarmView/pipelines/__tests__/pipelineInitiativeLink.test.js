// Req #3235 — the addressable-initiative-location contract.
//
// Same round-trip discipline as pipelineStepLink.test.js (req #3140): the
// writer (the requirement page's initiative box) and the reader (PipelineDetail /
// PipelinePlanVisualizer) must agree on the query-string key exactly, so this
// pins both halves against each other rather than in isolation.

import { describe, it, expect } from 'vitest';
import {
    FOCUS_INITIATIVE_PARAM,
    readFocusInitiativeParam,
    initiativeLinkTo,
    planLinkTo,
} from '../pipelineInitiativeLink';

describe('initiativeLinkTo', () => {
    it('names the plan, the plan mode and the initiative', () => {
        expect(initiativeLinkTo(2, 55)).toBe('/swarm/pipeline/2?mode=plan&initiative=55');
    });

    it('accepts numeric strings', () => {
        expect(initiativeLinkTo('2', '55')).toBe('/swarm/pipeline/2?mode=plan&initiative=55');
    });

    it('returns null rather than a link to /swarm/pipeline/undefined', () => {
        // The caller omits the link entirely — an initiative in no pipeline stays
        // without one, and a dead link is worse than an absent one.
        expect(initiativeLinkTo(null, 55)).toBeNull();
        expect(initiativeLinkTo(undefined, 55)).toBeNull();
        expect(initiativeLinkTo(2, null)).toBeNull();
        expect(initiativeLinkTo('abc', 55)).toBeNull();
        expect(initiativeLinkTo(2, 1.5)).toBeNull();
    });
});

describe('readFocusInitiativeParam', () => {
    const params = (search) => new URLSearchParams(search);

    it('reads the id a link names', () => {
        expect(readFocusInitiativeParam(params('mode=plan&initiative=55'))).toBe(55);
    });

    it('is null when the parameter is absent', () => {
        expect(readFocusInitiativeParam(params('mode=plan'))).toBeNull();
    });

    it('rejects every non-integer form rather than producing a NaN or a 0', () => {
        expect(readFocusInitiativeParam(params('initiative='))).toBeNull();
        expect(readFocusInitiativeParam(params('initiative=%20'))).toBeNull();
        expect(readFocusInitiativeParam(params('initiative=12abc'))).toBeNull();
        expect(readFocusInitiativeParam(params('initiative=1.5'))).toBeNull();
        expect(readFocusInitiativeParam(params('initiative=NaN'))).toBeNull();
    });

    it('survives a caller with no search params at all', () => {
        expect(readFocusInitiativeParam(null)).toBeNull();
        expect(readFocusInitiativeParam(undefined)).toBeNull();
        expect(readFocusInitiativeParam({})).toBeNull();
    });

    it("round-trips what initiativeLinkTo built", () => {
        const to = initiativeLinkTo(2, 55);
        const search = to.slice(to.indexOf('?'));
        expect(readFocusInitiativeParam(new URLSearchParams(search))).toBe(55);
        expect(new URLSearchParams(search).get('mode')).toBe('plan');
    });

    it('exports the key both halves agree on', () => {
        expect(FOCUS_INITIATIVE_PARAM).toBe('initiative');
        expect(initiativeLinkTo(1, 2)).toContain(`${FOCUS_INITIATIVE_PARAM}=2`);
    });

    // req #3356 — the `era` PARAMETER IS GONE, not merely defaulted. It existed
    // so a caller holding a 1.0 id could ask for the 1.0 route; there are no 1.0
    // ids and no 1.0 route. A surviving parameter would be a way to ask for a
    // page that does not exist, which is req #3462's shape.
    it('takes no era argument — a stray one cannot redirect the link', () => {
        expect(initiativeLinkTo(2, 55, 1)).toBe(initiativeLinkTo(2, 55));
        expect(initiativeLinkTo(2, 55)).toBe('/swarm/pipeline/2?mode=plan&initiative=55');
    });
});

// Req #3435 — the Orchestration box's pipeline row needs a destination even
// when nothing narrower is addressable (the reader pointed the filter at a plan
// this requirement is not seated in).
describe('planLinkTo', () => {
    it('lands on the plan, in plan mode, with nothing focused', () => {
        expect(planLinkTo(2)).toBe('/swarm/pipeline/2?mode=plan');
    });

    it('carries the mode explicitly, so a stored table preference cannot win', () => {
        expect(new URLSearchParams(planLinkTo(79).slice(planLinkTo(79).indexOf('?')))
            .get('mode')).toBe('plan');
    });

    // A caller renders NO link at all rather than one that navigates to
    // /swarm/pipeline/undefined — the same rule initiativeLinkTo/stepLinkTo follow.
    it('is null for every unusable id, and 0 is usable', () => {
        expect(planLinkTo(null)).toBeNull();
        expect(planLinkTo(undefined)).toBeNull();
        expect(planLinkTo('')).toBeNull();
        expect(planLinkTo('12abc')).toBeNull();
        expect(planLinkTo(1.5)).toBeNull();
        expect(planLinkTo(0)).toBe('/swarm/pipeline/0?mode=plan');
    });

    it('accepts a numeric string from the wire', () => {
        expect(planLinkTo('2')).toBe('/swarm/pipeline/2?mode=plan');
    });

    // It must NOT smuggle a focus parameter in — that is initiativeLinkTo's job, and
    // a stray `?initiative=` here would fit a band the reader did not ask for.
    it('names no initiative and no step', () => {
        const search = new URLSearchParams(planLinkTo(2).slice(planLinkTo(2).indexOf('?')));
        expect(search.get(FOCUS_INITIATIVE_PARAM)).toBeNull();
        expect(search.get('step')).toBeNull();
    });
});
