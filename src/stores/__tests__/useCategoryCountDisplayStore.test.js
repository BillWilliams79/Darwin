// @vitest-environment jsdom
//
// Req #3505 — display preference for the per-category-card requirement count
// suffix, e.g. "Swarm (17)". Mirrors useModelEffortDisplayStore.test.js.

import { describe, it, expect, beforeEach } from 'vitest';
import { useCategoryCountDisplayStore } from '../useCategoryCountDisplayStore';

const state = () => useCategoryCountDisplayStore.getState();

describe('useCategoryCountDisplayStore (req #3505)', () => {
    beforeEach(() => {
        useCategoryCountDisplayStore.setState({
            showCount: false,
        });
    });

    it('defaults to off', () => {
        expect(state().showCount).toBe(false);
    });

    it('toggleShowCount flips the boolean both directions', () => {
        state().toggleShowCount();
        expect(state().showCount).toBe(true);
        state().toggleShowCount();
        expect(state().showCount).toBe(false);
    });

    it('setShowCount coerces to a boolean', () => {
        state().setShowCount(1);
        expect(state().showCount).toBe(true);
        state().setShowCount(0);
        expect(state().showCount).toBe(false);
    });
});
