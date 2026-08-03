// @vitest-environment jsdom
//
// Req #3158 — Map Aggregator Card visibility store. Same shape as
// useSwarmStartCardStore: a persisted `show` boolean and a `toggle` action,
// so the /maps combined-map card survives reloads in whichever state the
// user left it.

import { describe, it, expect, beforeEach } from 'vitest';
import { useMapAggregatorCardStore } from '../useMapAggregatorCardStore';

const state = () => useMapAggregatorCardStore.getState();

describe('useMapAggregatorCardStore (req #3158)', () => {
    beforeEach(() => {
        useMapAggregatorCardStore.setState({ show: false });
    });

    it('defaults to hidden', () => {
        expect(state().show).toBe(false);
    });

    it('toggle flips visibility both directions', () => {
        state().toggle();
        expect(state().show).toBe(true);
        state().toggle();
        expect(state().show).toBe(false);
    });

    it('persists under the darwin_map_aggregator_card key', () => {
        expect(useMapAggregatorCardStore.persist.getOptions().name)
            .toBe('darwin_map_aggregator_card');
        state().toggle();
        const persisted = JSON.parse(localStorage.getItem('darwin_map_aggregator_card'));
        expect(persisted.state.show).toBe(true);
    });
});
