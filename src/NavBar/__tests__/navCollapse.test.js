// @vitest-environment jsdom
//
// Req #2869 — navbar group-header collapse persistence + toggle logic.

import { describe, it, expect, beforeEach } from 'vitest';
import {
    COLLAPSED_GROUPS_KEY,
    loadCollapsedGroups,
    persistCollapsedGroups,
    toggleGroupCollapsed,
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
});
