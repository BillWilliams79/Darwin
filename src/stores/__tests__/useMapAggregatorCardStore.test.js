// @vitest-environment jsdom
//
// Req #3158 — Map Aggregator Card visibility store. Same shape as
// useSwarmStartCardStore: a persisted `show` boolean and a `toggle` action,
// so the /maps combined-map card survives reloads in whichever state the
// user left it.
//
// Req #3174 criterion 7 — the persistence SEMANTICS, not just the write.
// "Survives a reload" is a rehydration claim, and rehydration is the half that
// runs on the next page load where no test was watching: the store is rehydrated
// against a seeded localStorage, against a corrupt one, and against none at all.

import { describe, it, expect, beforeEach } from 'vitest';
import { useMapAggregatorCardStore } from '../useMapAggregatorCardStore';

const KEY = 'darwin_map_aggregator_card';
const state = () => useMapAggregatorCardStore.getState();

// What a browser reload does to this store: the module is already loaded, so
// what actually re-runs is persist's read of localStorage back into it.
const reload = () => useMapAggregatorCardStore.persist.rehydrate();

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
        expect(useMapAggregatorCardStore.persist.getOptions().name).toBe(KEY);
        state().toggle();
        const persisted = JSON.parse(localStorage.getItem(KEY));
        expect(persisted.state.show).toBe(true);
    });
});

describe('useMapAggregatorCardStore rehydration (req #3174)', () => {
    beforeEach(() => {
        localStorage.clear();
        useMapAggregatorCardStore.setState({ show: false });
    });

    // Order matters in every case below: setState is ITSELF a persisted write,
    // so the in-memory value is dropped FIRST and storage seeded SECOND. Seeding
    // first and then clearing memory just overwrites the seed, and the test then
    // proves only that a value survives a round trip it never actually took.
    it('comes back ON after a reload when the user left it on', async () => {
        state().toggle();
        expect(JSON.parse(localStorage.getItem(KEY)).state.show).toBe(true);

        // Drop the in-memory value the way a fresh page load would, leaving
        // only what storage holds.
        useMapAggregatorCardStore.setState({ show: false });
        localStorage.setItem(KEY, JSON.stringify({ state: { show: true }, version: 0 }));
        await reload();

        expect(state().show).toBe(true);
    });

    it('comes back OFF after a reload when the user left it off', async () => {
        useMapAggregatorCardStore.setState({ show: true });
        localStorage.setItem(KEY, JSON.stringify({ state: { show: false }, version: 0 }));
        await reload();

        expect(state().show).toBe(false);
    });

    it('leaves a usable boolean when nothing was ever persisted', async () => {
        localStorage.clear();
        await reload();

        // Nothing stored → persist has nothing to merge, so what matters is
        // that it does not throw and `show` stays a boolean the toggle and the
        // MapsPage prop can both use.
        expect(typeof state().show).toBe('boolean');
    });

    it('survives a corrupt persisted payload instead of taking the page down', async () => {
        // A half-written localStorage entry must not throw out of rehydrate:
        // /maps mounts this store on every load, so a throw here costs the
        // whole page for the sake of a card that is off by default.
        localStorage.setItem(KEY, '{not valid json');

        // `.resolves.not.toThrow()` would be decorative here — not-toThrow on a
        // resolved non-function value is a no-op. What is actually being claimed
        // is that rehydrate neither throws synchronously nor rejects, so the
        // assertion says exactly that.
        await expect(reload()).resolves.toBeUndefined();
        expect(() => state().toggle()).not.toThrow();
        expect(typeof state().show).toBe('boolean');
    });

    it('keeps the action callable after rehydrating a payload with no `show`', async () => {
        localStorage.setItem(KEY, JSON.stringify({ state: { unrelated: 1 }, version: 0 }));
        await reload();

        // Actions are not persisted — they come from the initializer on every
        // load — so a partial payload must not leave the toggle unreachable.
        expect(typeof state().toggle).toBe('function');
        state().toggle();
        expect(typeof state().show).toBe('boolean');
    });
});
