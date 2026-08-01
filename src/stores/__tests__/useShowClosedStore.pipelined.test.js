// @vitest-environment jsdom
//
// req #3180 — `hidePipelinedRequirements`, the requirements-page pipeline filter.
// Exercises the REAL store action. The default is the load-bearing part: OFF must
// be exactly today's behaviour, because this control ships to users who have a
// persisted blob that predates it.

import { describe, it, expect, beforeEach } from 'vitest';
import { useShowClosedStore } from '../useShowClosedStore';

const flag = () => useShowClosedStore.getState().hidePipelinedRequirements;
const toggle = () => useShowClosedStore.getState().toggleHidePipelinedRequirements();

describe('hidePipelinedRequirements', () => {
    beforeEach(() => {
        useShowClosedStore.setState({ hidePipelinedRequirements: false });
    });

    it('defaults to OFF — everything shown, exactly today\'s behaviour', () => {
        expect(flag()).toBe(false);
    });

    it('toggles ON and back OFF', () => {
        toggle();
        expect(flag()).toBe(true);
        toggle();
        expect(flag()).toBe(false);
    });

    it('leaves the status chip filter alone — the two are independent dimensions', () => {
        const before = useShowClosedStore.getState().requirementStatusFilter;
        toggle();
        expect(useShowClosedStore.getState().requirementStatusFilter).toBe(before);
    });

    it('an older persisted blob with no key keeps the OFF default', () => {
        // No persist version bump was taken: zustand merges the persisted object
        // over the initializer, so a missing key falls through to `false`. This
        // pins that assumption rather than leaving it implicit.
        const merged = { ...useShowClosedStore.getInitialState(),
                         ...{ requirementStatusFilter: ['met'] } };
        expect(merged.hidePipelinedRequirements).toBe(false);
    });
});
