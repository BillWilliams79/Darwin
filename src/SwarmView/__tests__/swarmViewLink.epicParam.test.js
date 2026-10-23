// Req #3503 — `?epic=` on `/swarm`, both halves of the contract.
//
// Its own file beside `swarmViewLink.initiativeParam.test.js` rather than cases added
// to it: the two filters are independent contracts read for different reasons,
// and the last describe below is the one that only exists because there are two.

import { describe, it, expect } from 'vitest';
import {
    SWARM_EPIC_PARAM, SWARM_EPIC_VIEW,
    swarmEpicLinkTo, readEpicParam, withoutEpicParam,
    withoutInitiativeParam,
} from '../swarmViewLink';

describe('swarmEpicLinkTo — the writer', () => {
    it('names the view explicitly, not just the page', () => {
        // `/swarm` alone opens whichever panel the reader last chose, so a link
        // without `view=` lands a Table-preferring reader on the Table — and this
        // link's whole promise is the cards.
        expect(swarmEpicLinkTo(186)).toBe('/swarm?view=cards&epic=186');
        expect(SWARM_EPIC_VIEW).toBe('cards');
        expect(SWARM_EPIC_PARAM).toBe('epic');
    });

    it('accepts a numeric string, as an id read off a row would arrive', () => {
        expect(swarmEpicLinkTo('186')).toBe('/swarm?view=cards&epic=186');
    });

    it('returns null on an unusable id so the caller renders NO control', () => {
        // A badge whose epic the layout could not resolve is this case. A link
        // built anyway would navigate to `/swarm?epic=undefined` and filter every
        // requirement away under a pill reading "Epic: undefined".
        for (const bad of [null, undefined, '', '   ', 'abc', 1.5, 0, -3, NaN]) {
            expect(swarmEpicLinkTo(bad)).toBeNull();
        }
    });
});

describe('readEpicParam — the reader', () => {
    const params = (qs) => new URLSearchParams(qs);

    it('reads an integer id', () => {
        expect(readEpicParam(params('view=cards&epic=186'))).toBe(186);
    });

    it('is null when the parameter is absent', () => {
        expect(readEpicParam(params('view=cards'))).toBeNull();
        expect(readEpicParam(undefined)).toBeNull();
        expect(readEpicParam({})).toBeNull();
    });

    it('refuses address-bar text that is not an id', () => {
        // `Number('')` is 0 and `Number('1.5')` is 1.5 — either would filter
        // every row away under a pill naming an epic that does not exist.
        for (const bad of ['', '   ', 'abc', '1.5', '0', '-3', '186abc']) {
            expect(readEpicParam(params(`epic=${encodeURIComponent(bad)}`))).toBeNull();
        }
    });

    it('accepts an id that names no epic row — that is not an error', () => {
        expect(readEpicParam(params('epic=99999'))).toBe(99999);
    });
});

describe('withoutEpicParam — dismissing the pill', () => {
    it('drops only the epic, leaving the rest of the query string alone', () => {
        const next = withoutEpicParam(params0('view=cards&epic=186&other=x'));
        expect(next.get('epic')).toBeNull();
        expect(next.get('view')).toBe('cards');
        expect(next.get('other')).toBe('x');
    });

    it('returns a NEW object — React Router hands back a live one, and mutating '
        + 'it in place changes the location while re-rendering nothing', () => {
        const original = params0('view=cards&epic=186');
        const next = withoutEpicParam(original);
        expect(next).not.toBe(original);
        expect(original.get('epic')).toBe('186');
    });

    it('is a no-op on params that carry no epic', () => {
        expect(withoutEpicParam(params0('view=table')).toString()).toBe('view=table');
    });
});

describe('the two filters are INDEPENDENT (req #3503)', () => {
    it('a URL can carry both, and each reader sees only its own', () => {
        const p = params0('view=cards&initiative=11&epic=186');
        expect(readEpicParam(p)).toBe(186);
    });

    it('dismissing one pill leaves the other parameter exactly where it was', () => {
        // The whole reason these are two keys rather than one encoded scope: a
        // shared parameter would make clearing one filter a rewrite of the other.
        const both = params0('view=cards&initiative=11&epic=186');
        expect(withoutEpicParam(both).get('initiative')).toBe('11');
        expect(withoutInitiativeParam(both).get('epic')).toBe('186');
    });
});

function params0(qs) { return new URLSearchParams(qs); }
