// @vitest-environment jsdom
//
// Req #3029 — display preferences for the Model + Effort row columns. Exercises
// the REAL store actions because the behaviors most likely to regress are the
// toggles and the enum-validation guards that keep a bad value (a retired
// display mode / column order) from ever reaching the render path.

import { describe, it, expect, beforeEach } from 'vitest';
import {
    useModelEffortDisplayStore,
    MODEL_EFFORT_DISPLAY_MODES,
    MODEL_EFFORT_COLUMN_ORDERS,
} from '../useModelEffortDisplayStore';

const state = () => useModelEffortDisplayStore.getState();

describe('useModelEffortDisplayStore (req #3029)', () => {
    beforeEach(() => {
        useModelEffortDisplayStore.setState({
            showOnAllCards: false, displayMode: 'pill',
            wideAggregator: true, columnOrder: 'standard',
        });
    });

    it('defaults to aggregator-only + pill, wide aggregator, standard column order', () => {
        expect(state().showOnAllCards).toBe(false);
        expect(state().displayMode).toBe('pill');
        expect(state().wideAggregator).toBe(true);
        expect(state().columnOrder).toBe('standard');
    });

    it('lists exactly the two supported display modes', () => {
        expect(MODEL_EFFORT_DISPLAY_MODES).toEqual(['pill', 'compact']);
    });

    it('lists exactly the three supported column orders', () => {
        expect(MODEL_EFFORT_COLUMN_ORDERS).toEqual(['standard', 'meFirst', 'meAfterReq']);
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

    it('setDisplayMode accepts each supported mode', () => {
        for (const mode of MODEL_EFFORT_DISPLAY_MODES) {
            state().setDisplayMode(mode);
            expect(state().displayMode).toBe(mode);
        }
    });

    it('setDisplayMode falls back to pill for an unknown/retired mode', () => {
        state().setDisplayMode('compact');
        state().setDisplayMode('clean'); // retired
        expect(state().displayMode).toBe('pill');
        state().setDisplayMode(null);
        expect(state().displayMode).toBe('pill');
    });

    it('setColumnOrder accepts each supported order', () => {
        for (const order of MODEL_EFFORT_COLUMN_ORDERS) {
            state().setColumnOrder(order);
            expect(state().columnOrder).toBe(order);
        }
    });

    it('setColumnOrder falls back to standard for an unknown order', () => {
        state().setColumnOrder('meFirst');
        state().setColumnOrder('bogus');
        expect(state().columnOrder).toBe('standard');
        state().setColumnOrder(null);
        expect(state().columnOrder).toBe('standard');
    });
});
