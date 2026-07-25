// @vitest-environment jsdom
//
// Req #3029 — display preference for the Model + Effort row columns. req #3043
// trimmed the store to `showOnAllCards` + `wideAggregator` (removed
// `displayMode`/`columnOrder`); req #3064 retired `wideAggregator` too — the
// aggregator card is now always the usual width, same as every other card
// (see index.css / CategoryTabPanel.jsx). Exercises the REAL store actions, including the
// merge() guard that strips stale persisted retired keys so they can never
// reach the render path via old localStorage.

import { describe, it, expect, beforeEach } from 'vitest';
import { useModelEffortDisplayStore } from '../useModelEffortDisplayStore';

const state = () => useModelEffortDisplayStore.getState();

describe('useModelEffortDisplayStore (req #3029 / #3043 / #3064)', () => {
    beforeEach(() => {
        useModelEffortDisplayStore.setState({
            showOnAllCards: false,
        });
    });

    it('defaults to aggregator-only', () => {
        expect(state().showOnAllCards).toBe(false);
    });

    it('no longer exposes displayMode/columnOrder/wideAggregator state or setters', () => {
        expect(state().displayMode).toBeUndefined();
        expect(state().columnOrder).toBeUndefined();
        expect(state().setDisplayMode).toBeUndefined();
        expect(state().setColumnOrder).toBeUndefined();
        expect(state().wideAggregator).toBeUndefined();
        expect(state().toggleWideAggregator).toBeUndefined();
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

    it('merge() strips stale persisted displayMode/columnOrder/wideAggregator', () => {
        const merged = useModelEffortDisplayStore.persist.getOptions().merge(
            { showOnAllCards: true, displayMode: 'compact', columnOrder: 'meFirst', wideAggregator: false },
            { showOnAllCards: false },
        );
        expect(merged.showOnAllCards).toBe(true);
        expect(merged.displayMode).toBeUndefined();
        expect(merged.columnOrder).toBeUndefined();
        expect(merged.wideAggregator).toBeUndefined();
    });
});
