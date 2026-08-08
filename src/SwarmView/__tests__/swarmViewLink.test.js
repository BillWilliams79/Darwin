// req #3302 — the `/swarm?view=` contract (req #3168 R9).
//
// The rules under test are the ones R9 states, and each is here because breaking
// it is silent: an unvalidated param selects nothing in the ToggleButtonGroup, a
// redundant `?view=cards` overrides a stored preference the link never meant to
// touch, and a drifting key makes every existing link inert with nothing failing.

import { describe, it, expect } from 'vitest';
import {
    SWARM_VIEWS,
    DEFAULT_SWARM_VIEW,
    SWARM_VIEW_STORAGE_KEY,
    SWARM_VIEW_PARAM,
    readViewParam,
    swarmViewLinkTo,
} from '../swarmViewLink';

const params = (qs) => new URLSearchParams(qs);

describe('the vocabulary', () => {
    it('is the four panels SwarmView renders, in toggle order', () => {
        expect(SWARM_VIEWS).toEqual(['cards', 'table', 'visualizer', 'trends']);
    });

    it('names cards as the first-time default', () => {
        expect(DEFAULT_SWARM_VIEW).toBe('cards');
        expect(SWARM_VIEWS[0]).toBe(DEFAULT_SWARM_VIEW);
    });

    // R1 — the storage key is `darwin-<feature>-view`, and `/agents` shows what a
    // non-conforming one costs (a one-time reset for every reader).
    it('persists under the R1-conforming key', () => {
        expect(SWARM_VIEW_STORAGE_KEY).toBe('darwin-swarm-view');
    });

    // R9 — the parameter name is the page's own vocabulary. This toggle switches
    // VIEWS, so it is `view`, not `mode`, and it takes no `darwin-` prefix.
    it('reads the page\'s own vocabulary as the parameter name', () => {
        expect(SWARM_VIEW_PARAM).toBe('view');
        expect(SWARM_VIEW_PARAM.startsWith('darwin-')).toBe(false);
    });
});

describe('readViewParam — validated, never trusted', () => {
    it.each(SWARM_VIEWS)('accepts the known view %s', (v) => {
        expect(readViewParam(params(`view=${v}`))).toBe(v);
    });

    // Falling through to null is what leaves the stored preference in charge. A
    // pass-through would select nothing in the exclusive ToggleButtonGroup, which
    // renders the toggle with no active state at all.
    it.each([
        ['an unknown value', 'view=xyz'],
        ['an empty value', 'view='],
        ['a case mismatch', 'view=Cards'],
        ['a whitespace-padded value', 'view=%20cards'],
        ['a different parameter', 'mode=table'],
        ['no parameters at all', ''],
    ])('returns null for %s', (_label, qs) => {
        expect(readViewParam(params(qs))).toBeNull();
    });

    it('is safe against a missing searchParams object', () => {
        expect(readViewParam(undefined)).toBeNull();
        expect(readViewParam(null)).toBeNull();
        expect(readViewParam({})).toBeNull();
    });
});

describe('swarmViewLinkTo — the writing half', () => {
    it.each(SWARM_VIEWS)('addresses the view %s', (v) => {
        expect(swarmViewLinkTo(v)).toBe(`/swarm?view=${v}`);
    });

    // `?view=cards` is NOT redundant. `/swarm` alone lands a reader with a stored
    // Table preference on Table — the exact gap R9 exists to close — so a link
    // that means Cards has to say so. A link that means the PAGE writes `/swarm`
    // and never calls this.
    it('names the default view too', () => {
        expect(swarmViewLinkTo(DEFAULT_SWARM_VIEW)).toBe('/swarm?view=cards');
    });

    it.each([undefined, null, '', 'xyz'])('falls back to the bare route for %s', (v) => {
        expect(swarmViewLinkTo(v)).toBe('/swarm');
    });

    // The two halves are one contract: everything the writer emits, the reader
    // must accept as the same view.
    it('round-trips every view through the reader', () => {
        for (const v of SWARM_VIEWS) {
            const qs = swarmViewLinkTo(v).split('?')[1] || '';
            expect(readViewParam(params(qs))).toBe(v);
        }
    });
});
