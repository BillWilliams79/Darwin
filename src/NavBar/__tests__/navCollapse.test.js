// @vitest-environment jsdom
//
// Req #2869 — navbar group-header collapse persistence + toggle logic.
// Req #3209 — navbar item expand persistence + toggle logic.

import { describe, it, expect, beforeEach } from 'vitest';
import {
    COLLAPSED_GROUPS_KEY,
    EXPANDED_ITEMS_KEY,
    loadCollapsedGroups,
    persistCollapsedGroups,
    toggleGroupCollapsed,
    loadExpandedItems,
    persistExpandedItems,
    toggleItemExpanded,
} from '../navCollapse';

describe('navCollapse', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    describe('loadCollapsedGroups', () => {
        it('returns {} when nothing is stored', () => {
            expect(loadCollapsedGroups()).toEqual({});
        });

        it('parses a stored object', () => {
            localStorage.setItem(COLLAPSED_GROUPS_KEY, JSON.stringify({ swarm: true }));
            expect(loadCollapsedGroups()).toEqual({ swarm: true });
        });

        it('degrades to {} on malformed JSON', () => {
            localStorage.setItem(COLLAPSED_GROUPS_KEY, 'not json{');
            expect(loadCollapsedGroups()).toEqual({});
        });

        it('rejects a non-object payload (array)', () => {
            localStorage.setItem(COLLAPSED_GROUPS_KEY, JSON.stringify(['swarm']));
            expect(loadCollapsedGroups()).toEqual({});
        });

        it('rejects a null payload', () => {
            localStorage.setItem(COLLAPSED_GROUPS_KEY, JSON.stringify(null));
            expect(loadCollapsedGroups()).toEqual({});
        });
    });

    describe('toggleGroupCollapsed', () => {
        it('collapses an expanded group by adding the key', () => {
            expect(toggleGroupCollapsed({}, 'maps')).toEqual({ maps: true });
        });

        it('expands a collapsed group by removing the key', () => {
            expect(toggleGroupCollapsed({ maps: true }, 'maps')).toEqual({});
        });

        it('does not mutate the input state', () => {
            const state = { maps: true };
            const next = toggleGroupCollapsed(state, 'swarm');
            expect(state).toEqual({ maps: true });
            expect(next).toEqual({ maps: true, swarm: true });
        });

        it('round-trips collapse then expand back to empty', () => {
            const collapsed = toggleGroupCollapsed({}, 'tasks');
            expect(collapsed).toEqual({ tasks: true });
            expect(toggleGroupCollapsed(collapsed, 'tasks')).toEqual({});
        });
    });

    describe('persistCollapsedGroups + loadCollapsedGroups round-trip', () => {
        it('persists and reloads identical state', () => {
            const state = { swarm: true, maps: true };
            persistCollapsedGroups(state);
            expect(loadCollapsedGroups()).toEqual(state);
        });
    });

    // ── Req #3209 — per-item expand state ──

    describe('loadExpandedItems', () => {
        it('returns {} when nothing is stored (every item starts closed)', () => {
            expect(loadExpandedItems()).toEqual({});
        });

        it('parses a stored object', () => {
            localStorage.setItem(EXPANDED_ITEMS_KEY, JSON.stringify({ '/swarm/sessions': true }));
            expect(loadExpandedItems()).toEqual({ '/swarm/sessions': true });
        });

        it('degrades to {} on malformed JSON', () => {
            localStorage.setItem(EXPANDED_ITEMS_KEY, 'not json{');
            expect(loadExpandedItems()).toEqual({});
        });

        it('rejects a non-object payload (array)', () => {
            localStorage.setItem(EXPANDED_ITEMS_KEY, JSON.stringify(['/swarm/sessions']));
            expect(loadExpandedItems()).toEqual({});
        });
    });

    describe('toggleItemExpanded', () => {
        it('expands a closed item by adding the key', () => {
            expect(toggleItemExpanded({}, '/swarm/sessions'))
                .toEqual({ '/swarm/sessions': true });
        });

        it('closes an expanded item by removing the key', () => {
            expect(toggleItemExpanded({ '/swarm/sessions': true }, '/swarm/sessions'))
                .toEqual({});
        });

        it('does not mutate the input state', () => {
            const state = { '/swarm/sessions': true };
            const next = toggleItemExpanded(state, '/agents');
            expect(state).toEqual({ '/swarm/sessions': true });
            expect(next).toEqual({ '/swarm/sessions': true, '/agents': true });
        });
    });

    describe('the two maps are independent', () => {
        it('uses distinct storage keys so neither clobbers the other', () => {
            expect(EXPANDED_ITEMS_KEY).not.toBe(COLLAPSED_GROUPS_KEY);
            persistCollapsedGroups({ swarm: true });
            persistExpandedItems({ '/swarm/sessions': true });
            expect(loadCollapsedGroups()).toEqual({ swarm: true });
            expect(loadExpandedItems()).toEqual({ '/swarm/sessions': true });
        });
    });
});
