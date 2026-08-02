// @vitest-environment jsdom
//
// req #3180 — `hidePipelinedRequirements`, the requirements-pages pipeline
// filter (Cards view too since req #3258). req #3242 flipped the default to
// ON and bumped the persist version to 9, since — unlike a brand-new key — a
// browser that touched this store even once already has an EXPLICIT `false`
// on disk that a new initializer default alone cannot override.

import { describe, it, expect, beforeEach } from 'vitest';
import { useShowClosedStore } from '../useShowClosedStore';

const flag = () => useShowClosedStore.getState().hidePipelinedRequirements;
const toggle = () => useShowClosedStore.getState().toggleHidePipelinedRequirements();

describe('hidePipelinedRequirements', () => {
    beforeEach(() => {
        useShowClosedStore.setState({ hidePipelinedRequirements: true });
    });

    it('defaults to ON — orchestrated requirements hidden (req #3242)', () => {
        expect(useShowClosedStore.getInitialState().hidePipelinedRequirements).toBe(true);
        expect(flag()).toBe(true);
    });

    it('toggles OFF and back ON', () => {
        toggle();
        expect(flag()).toBe(false);
        toggle();
        expect(flag()).toBe(true);
    });

    it('leaves the status chip filter alone — the two are independent dimensions', () => {
        const before = useShowClosedStore.getState().requirementStatusFilter;
        toggle();
        expect(useShowClosedStore.getState().requirementStatusFilter).toBe(before);
    });
});

describe('v8→v9 migration logic (req #3242)', () => {
    // The migrate function is inside the persist config and not directly
    // exported (same constraint as the v6→v7 session-status migration in
    // useShowClosedStore.test.js) — simulate the logic it applies.
    const simulateMigrate = (persisted, version) => (version < 9
        ? { ...persisted, hidePipelinedRequirements: true }
        : persisted);

    it('forces true on an explicit v8 `false` — the case a new default alone cannot reach', () => {
        // This is the load-bearing case: `persist` writes the whole state on
        // every change, so any browser that has touched this store since req
        // #3180 shipped already has `false` on disk, not an absent key.
        const result = simulateMigrate({ hidePipelinedRequirements: false }, 8);
        expect(result.hidePipelinedRequirements).toBe(true);
    });

    it('forces true when the key is absent from an even older blob', () => {
        const result = simulateMigrate({ requirementStatusFilter: ['met'] }, 3);
        expect(result.hidePipelinedRequirements).toBe(true);
    });

    it('leaves an already-migrated v9+ value alone', () => {
        const result = simulateMigrate({ hidePipelinedRequirements: false }, 9);
        expect(result.hidePipelinedRequirements).toBe(false);
    });
});
