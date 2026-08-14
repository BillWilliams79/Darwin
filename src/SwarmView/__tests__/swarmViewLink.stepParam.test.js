// Req #3503 — `?step=` on `/swarm`, both halves of the contract.
//
// Its own file beside `swarmViewLink.epicParam.test.js` rather than cases added
// to it: the two filters are independent contracts read for different reasons,
// and the last describe below is the one that only exists because there are two.

import { describe, it, expect } from 'vitest';
import {
    SWARM_STEP_PARAM, SWARM_STEP_VIEW,
    swarmStepLinkTo, readStepParam, withoutStepParam,
    withoutEpicParam,
} from '../swarmViewLink';

describe('swarmStepLinkTo — the writer', () => {
    it('names the view explicitly, not just the page', () => {
        // `/swarm` alone opens whichever panel the reader last chose, so a link
        // without `view=` lands a Table-preferring reader on the Table — and this
        // link's whole promise is the cards.
        expect(swarmStepLinkTo(186)).toBe('/swarm?view=cards&step=186');
        expect(SWARM_STEP_VIEW).toBe('cards');
        expect(SWARM_STEP_PARAM).toBe('step');
    });

    it('accepts a numeric string, as an id read off a row would arrive', () => {
        expect(swarmStepLinkTo('186')).toBe('/swarm?view=cards&step=186');
    });

    it('returns null on an unusable id so the caller renders NO control', () => {
        // A badge whose step the layout could not resolve is this case. A link
        // built anyway would navigate to `/swarm?step=undefined` and filter every
        // requirement away under a pill reading "Step: undefined".
        for (const bad of [null, undefined, '', '   ', 'abc', 1.5, 0, -3, NaN]) {
            expect(swarmStepLinkTo(bad)).toBeNull();
        }
    });
});

describe('readStepParam — the reader', () => {
    const params = (qs) => new URLSearchParams(qs);

    it('reads an integer id', () => {
        expect(readStepParam(params('view=cards&step=186'))).toBe(186);
    });

    it('is null when the parameter is absent', () => {
        expect(readStepParam(params('view=cards'))).toBeNull();
        expect(readStepParam(undefined)).toBeNull();
        expect(readStepParam({})).toBeNull();
    });

    it('refuses address-bar text that is not an id', () => {
        // `Number('')` is 0 and `Number('1.5')` is 1.5 — either would filter
        // every row away under a pill naming a step that does not exist.
        for (const bad of ['', '   ', 'abc', '1.5', '0', '-3', '186abc']) {
            expect(readStepParam(params(`step=${encodeURIComponent(bad)}`))).toBeNull();
        }
    });

    it('accepts an id that names no step row — that is not an error', () => {
        expect(readStepParam(params('step=99999'))).toBe(99999);
    });
});

describe('withoutStepParam — dismissing the pill', () => {
    it('drops only the step, leaving the rest of the query string alone', () => {
        const next = withoutStepParam(params0('view=cards&step=186&other=x'));
        expect(next.get('step')).toBeNull();
        expect(next.get('view')).toBe('cards');
        expect(next.get('other')).toBe('x');
    });

    it('returns a NEW object — React Router hands back a live one, and mutating '
        + 'it in place changes the location while re-rendering nothing', () => {
        const original = params0('view=cards&step=186');
        const next = withoutStepParam(original);
        expect(next).not.toBe(original);
        expect(original.get('step')).toBe('186');
    });

    it('is a no-op on params that carry no step', () => {
        expect(withoutStepParam(params0('view=table')).toString()).toBe('view=table');
    });
});

describe('the two filters are INDEPENDENT (req #3503)', () => {
    it('a URL can carry both, and each reader sees only its own', () => {
        const p = params0('view=cards&epic=11&step=186');
        expect(readStepParam(p)).toBe(186);
    });

    it('dismissing one pill leaves the other parameter exactly where it was', () => {
        // The whole reason these are two keys rather than one encoded scope: a
        // shared parameter would make clearing one filter a rewrite of the other.
        const both = params0('view=cards&epic=11&step=186');
        expect(withoutStepParam(both).get('epic')).toBe('11');
        expect(withoutEpicParam(both).get('step')).toBe('186');
    });
});

function params0(qs) { return new URLSearchParams(qs); }
