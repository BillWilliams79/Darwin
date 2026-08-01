// Req #3140 — the addressable-step contract.
//
// Both halves live in one module precisely so they can be pinned against each
// other: the round-trip test below is the whole point of the file. A builder that
// emits `?stepId=` and a reader that looks for `?step=` would each pass their own
// unit test and produce a link that navigates to the right plan and silently
// highlights nothing.

import { describe, it, expect } from 'vitest';
import {
    FOCUS_STEP_PARAM,
    readFocusStepParam,
    stepLinkTo,
} from '../pipelineStepLink';

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
});
