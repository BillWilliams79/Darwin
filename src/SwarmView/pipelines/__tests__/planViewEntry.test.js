// Req #3651 — the three transitions a plan history entry can be, and the focus
// each one hands the panels. The page half (no render carries another entry's
// focus) is in `PipelineDetail.retainView.test.jsx`.

import { describe, it, expect } from 'vitest';

import {
    classifyPlanEntry, isPlanLinkConsumed, planEntryFocus,
    PLAN_ENTRY_LINK, PLAN_ENTRY_REWRITE, PLAN_ENTRY_RETURN,
    PLAN_LINK_CONSUMED_STATE_KEY,
} from '../planViewEntry';

const link = { epicId: 47, initiativeId: null };
const held = { epicId: 12, initiativeId: 9 };

describe('classifyPlanEntry', () => {
    it('an unmarked entry carrying a focus link is a LINK, however it was reached', () => {
        for (const navigationType of ['PUSH', 'POP', 'REPLACE']) {
            expect(classifyPlanEntry({ consumed: false, navigationType, hasFocusLink: true }))
                .toBe(PLAN_ENTRY_LINK);
        }
    });

    it("a marked entry reached by REPLACE is the page's own REWRITE", () => {
        expect(classifyPlanEntry({ consumed: true, navigationType: 'REPLACE', hasFocusLink: true }))
            .toBe(PLAN_ENTRY_REWRITE);
    });

    it('Back/Forward or a reload onto a marked entry is a RETURN', () => {
        for (const navigationType of ['POP', 'PUSH']) {
            expect(classifyPlanEntry({ consumed: true, navigationType, hasFocusLink: true }))
                .toBe(PLAN_ENTRY_RETURN);
        }
    });

    it('an entry with no focus link is a RETURN (Back to Plan, the bare plan URL)', () => {
        for (const navigationType of ['PUSH', 'POP', 'REPLACE']) {
            expect(classifyPlanEntry({ consumed: false, navigationType, hasFocusLink: false }))
                .toBe(PLAN_ENTRY_RETURN);
        }
    });
});

describe('planEntryFocus', () => {
    it('a LINK hands over its own focus', () => {
        expect(planEntryFocus(PLAN_ENTRY_LINK, link, held)).toEqual({ epicId: 47, initiativeId: null });
    });

    it('a REWRITE keeps the focus in hand', () => {
        expect(planEntryFocus(PLAN_ENTRY_REWRITE, link, held)).toEqual({ epicId: 12, initiativeId: 9 });
        expect(planEntryFocus(PLAN_ENTRY_REWRITE, link, null)).toEqual({ epicId: null, initiativeId: null });
    });

    it('a RETURN hands over NO focus, whatever was in hand', () => {
        expect(planEntryFocus(PLAN_ENTRY_RETURN, link, held)).toEqual({ epicId: null, initiativeId: null });
    });
});

describe('isPlanLinkConsumed', () => {
    it('matches the mark against the CURRENT query only', () => {
        const mark = (q) => ({ [PLAN_LINK_CONSUMED_STATE_KEY]: q });
        expect(isPlanLinkConsumed({ search: '?epic=4', state: mark('?epic=4') })).toBe(true);
        expect(isPlanLinkConsumed({ search: '?epic=5', state: mark('?epic=4') })).toBe(false);
        expect(isPlanLinkConsumed({ search: '?epic=4', state: null })).toBe(false);
        expect(isPlanLinkConsumed(undefined)).toBe(false);
    });
});
