// Req #3235 — the addressable-epic-location contract.
//
// Same round-trip discipline as pipelineStepLink.test.js (req #3140): the
// writer (the requirement page's epic box) and the reader (PipelineDetail /
// PipelinePlanVisualizer) must agree on the query-string key exactly, so this
// pins both halves against each other rather than in isolation.

import { describe, it, expect } from 'vitest';
import {
    FOCUS_EPIC_PARAM,
    readFocusEpicParam,
    epicLinkTo,
} from '../pipelineEpicLink';

describe('epicLinkTo', () => {
    it('names the plan, the plan mode and the epic', () => {
        expect(epicLinkTo(2, 55)).toBe('/swarm/pipeline/2?mode=plan&epic=55');
    });

    it('accepts numeric strings', () => {
        expect(epicLinkTo('2', '55')).toBe('/swarm/pipeline/2?mode=plan&epic=55');
    });

    it('returns null rather than a link to /swarm/pipeline/undefined', () => {
        // The caller omits the link entirely — an epic in no pipeline stays
        // without one, and a dead link is worse than an absent one.
        expect(epicLinkTo(null, 55)).toBeNull();
        expect(epicLinkTo(undefined, 55)).toBeNull();
        expect(epicLinkTo(2, null)).toBeNull();
        expect(epicLinkTo('abc', 55)).toBeNull();
        expect(epicLinkTo(2, 1.5)).toBeNull();
    });
});

describe('readFocusEpicParam', () => {
    const params = (search) => new URLSearchParams(search);

    it('reads the id a link names', () => {
        expect(readFocusEpicParam(params('mode=plan&epic=55'))).toBe(55);
    });

    it('is null when the parameter is absent', () => {
        expect(readFocusEpicParam(params('mode=plan'))).toBeNull();
    });

    it('rejects every non-integer form rather than producing a NaN or a 0', () => {
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

    it("round-trips what epicLinkTo built", () => {
        const to = epicLinkTo(2, 55);
        const search = to.slice(to.indexOf('?'));
        expect(readFocusEpicParam(new URLSearchParams(search))).toBe(55);
        expect(new URLSearchParams(search).get('mode')).toBe('plan');
    });

    it('exports the key both halves agree on', () => {
        expect(FOCUS_EPIC_PARAM).toBe('epic');
        expect(epicLinkTo(1, 2)).toContain(`${FOCUS_EPIC_PARAM}=2`);
    });
});
