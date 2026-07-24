// @vitest-environment jsdom
//
// Req #3029 — display preferences for the Model + Effort row columns. req #3043
// trimmed the store to just `showOnAllCards` + `wideAggregator` (removed
// `displayMode`/`columnOrder`). Exercises the REAL store actions, including the
// merge() guard that strips a stale persisted `displayMode`/`columnOrder` so a
// removed option can never reach the render path via old localStorage.

import { describe, it, expect, beforeEach } from 'vitest';
import { useModelEffortDisplayStore } from '../useModelEffortDisplayStore';

const state = () => useModelEffortDisplayStore.getState();

describe('useModelEffortDisplayStore (req #3029 / #3043)', () => {
    beforeEach(() => {
        useModelEffortDisplayStore.setState({
            showOnAllCards: false, wideAggregator: true,
        });
    });

    it('defaults to aggregator-only + wide aggregator', () => {
        expect(state().showOnAllCards).toBe(false);
        expect(state().wideAggregator).toBe(true);
    });

    it('no longer exposes displayMode/columnOrder state or setters', () => {
        expect(state().displayMode).toBeUndefined();
        expect(state().columnOrder).toBeUndefined();
        expect(state().setDisplayMode).toBeUndefined();
        expect(state().setColumnOrder).toBeUndefined();
    });

    it('toggleShowOnAllCards flips the boolean both directions', () => {
        state().toggleShowOnAllCards();
        expect(state().showOnAllCards).toBe(true);
        state().toggleShowOnAllCards();
        expect(state().showOnAllCards).toBe(false);
    });

    it('setShowOnAllCards coerces to a boolean', () => {
        state().setShowOnAllCards(1);
        expect(state().showOnAllCards).toBe(true);
        state().setShowOnAllCards(0);
        expect(state().showOnAllCards).toBe(false);
    });

    it('toggleWideAggregator flips the boolean both directions', () => {
        state().toggleWideAggregator();
        expect(state().wideAggregator).toBe(false);
        state().toggleWideAggregator();
        expect(state().wideAggregator).toBe(true);
    });

    it('merge() strips a stale persisted displayMode/columnOrder', () => {
        const merged = useModelEffortDisplayStore.persist.getOptions().merge(
            { showOnAllCards: true, displayMode: 'compact', columnOrder: 'meFirst' },
            { showOnAllCards: false, wideAggregator: true },
        );
        expect(merged.showOnAllCards).toBe(true);
        expect(merged.wideAggregator).toBe(true);
        expect(merged.displayMode).toBeUndefined();
        expect(merged.columnOrder).toBeUndefined();
    });
});
