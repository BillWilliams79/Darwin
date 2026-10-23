// Req #3428 — `?initiative=` on `/swarm`, both halves of the contract.
//
// Its own file rather than more cases in `swarmViewLink.test.js`: that suite
// pins the VIEW vocabulary, and the two contracts are read for different reasons.

import { describe, it, expect } from 'vitest';
import {
    SWARM_INITIATIVE_PARAM, SWARM_INITIATIVE_VIEW,
    swarmInitiativeLinkTo, readInitiativeParam, withoutInitiativeParam,
} from '../swarmViewLink';

describe('swarmInitiativeLinkTo — the writer', () => {
    it('names the view explicitly, not just the page', () => {
        // `/swarm` alone opens whichever panel the reader last chose, so a link
        // without `view=` lands a Table-preferring reader on the Table — and this
        // link's whole promise is the cards.
        expect(swarmInitiativeLinkTo(11)).toBe('/swarm?view=cards&initiative=11');
        expect(SWARM_INITIATIVE_VIEW).toBe('cards');
        expect(SWARM_INITIATIVE_PARAM).toBe('initiative');
    });

    it('accepts a numeric string, as an id read off a row would arrive', () => {
        expect(swarmInitiativeLinkTo('11')).toBe('/swarm?view=cards&initiative=11');
    });

    it('returns null on an unusable id so the caller renders NO control', () => {
        // A plan's "No initiative" band has no id. A link built anyway would navigate
        // to `/swarm?initiative=undefined` and filter every requirement away under a
        // pill reading "Initiative: undefined".
        for (const bad of [null, undefined, '', '   ', 'abc', 1.5, 0, -3, NaN]) {
            expect(swarmInitiativeLinkTo(bad)).toBeNull();
        }
    });
});

describe('readInitiativeParam — the reader', () => {
    const params = (qs) => new URLSearchParams(qs);

    it('reads an integer id', () => {
        expect(readInitiativeParam(params('view=cards&initiative=11'))).toBe(11);
    });

    it('is null when the parameter is absent', () => {
        expect(readInitiativeParam(params('view=cards'))).toBeNull();
        expect(readInitiativeParam(undefined)).toBeNull();
        expect(readInitiativeParam({})).toBeNull();
    });

    it('refuses address-bar text that is not an id', () => {
        // `Number('')` is 0 and `Number('1.5')` is 1.5 — either would filter
        // every row away under a pill naming an initiative that does not exist.
        for (const bad of ['', '   ', 'abc', '1.5', '0', '-3', '11abc']) {
            expect(readInitiativeParam(params(`initiative=${encodeURIComponent(bad)}`))).toBeNull();
        }
    });

    it('accepts an id that names no initiative row — that is not an error', () => {
        expect(readInitiativeParam(params('initiative=99999'))).toBe(99999);
    });
});

describe('withoutInitiativeParam — dismissing the pill', () => {
    it('drops only the initiative, leaving the rest of the query string alone', () => {
        const next = withoutInitiativeParam(params0('view=cards&initiative=11&other=x'));
        expect(next.get('initiative')).toBeNull();
        expect(next.get('view')).toBe('cards');
        expect(next.get('other')).toBe('x');
    });

    it('returns a NEW object — React Router hands back a live one, and mutating '
        + 'it in place changes the location while re-rendering nothing', () => {
        const original = params0('view=cards&initiative=11');
        const next = withoutInitiativeParam(original);
        expect(next).not.toBe(original);
        expect(original.get('initiative')).toBe('11');
    });

    it('is a no-op on params that carry no initiative', () => {
        expect(withoutInitiativeParam(params0('view=table')).toString()).toBe('view=table');
    });
});

function params0(qs) { return new URLSearchParams(qs); }
