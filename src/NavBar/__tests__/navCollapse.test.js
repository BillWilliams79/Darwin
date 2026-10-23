// @vitest-environment jsdom
//
// Req #2869 — navbar group-header collapse persistence + toggle logic.
// Req #3209 — navbar item expand persistence + toggle logic.
// Req #3590 — icon-only sidebar shows only what the full sidebar shows.

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
    devCollapsedGroupsKey,
    groupForRoute,
    defaultCollapsedGroups,
    iconModeLinks,
} from '../navCollapse';
import { NAV_GROUPS, NAV_LINKS } from '../navConfig';

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

// Req #3589 — dev-server default: groups collapsed except the working area.
describe('navCollapse dev-server default (req #3589)', () => {
    const GROUPS = [
        { id: 'calendar', label: '' },
        { id: 'tasks', label: 'TASKS' },
        { id: 'systems', label: 'SYSTEMS' },
        { id: 'swarm', label: 'SWARM' },
    ];
    const LINKS = [
        { path: '/calview', group: 'calendar' },
        { path: '/taskcards', group: 'tasks' },
        { path: '/systems2', group: 'systems' },
        { path: '/swarm', group: 'swarm', children: [{ path: '/swarm/machines', group: 'swarm' }] },
        { path: '/swarm/sessions', group: 'swarm' },
    ];

    beforeEach(() => {
        localStorage.clear();
    });

    describe('groupForRoute', () => {
        it('resolves an exact path', () => {
            expect(groupForRoute(LINKS, '/systems2')).toBe('systems');
        });

        it('resolves a /-delimited sub-route through its own link', () => {
            expect(groupForRoute(LINKS, '/swarm/sessions/7')).toBe('swarm');
        });

        it('resolves an L3 child route', () => {
            expect(groupForRoute(LINKS, '/swarm/machines')).toBe('swarm');
        });

        it('ignores a query string or hash', () => {
            expect(groupForRoute(LINKS, '/systems2?view=x')).toBe('systems');
            expect(groupForRoute(LINKS, '/taskcards#top')).toBe('tasks');
        });

        it('does not match a bare string prefix', () => {
            expect(groupForRoute(LINKS, '/systems2x')).toBeNull();
        });

        it('returns null for an unowned or empty route', () => {
            expect(groupForRoute(LINKS, '/')).toBeNull();
            expect(groupForRoute(LINKS, '')).toBeNull();
        });
    });

    describe('defaultCollapsedGroups', () => {
        it('collapses every labelled group except the one owning the working area', () => {
            expect(defaultCollapsedGroups(GROUPS, LINKS, ['/systems2'])).toEqual({ tasks: true, swarm: true });
        });

        it('collapses every labelled group when no focus route is owned', () => {
            expect(defaultCollapsedGroups(GROUPS, LINKS, ['/', ''])).toEqual({ tasks: true, systems: true, swarm: true });
        });

        it('opens every group owning any focus route', () => {
            expect(defaultCollapsedGroups(GROUPS, LINKS, ['/systems2', '/swarm/sessions'])).toEqual({ tasks: true });
        });

        it('never flags an unlabelled group', () => {
            expect(defaultCollapsedGroups(GROUPS, LINKS, [])).not.toHaveProperty('calendar');
        });
    });

    describe('loadCollapsedGroups with a dev key + fallback', () => {
        const key = devCollapsedGroupsKey(3589, '/systems2');

        it('scopes the dev key to the requirement and working area', () => {
            expect(key).toBe(`${COLLAPSED_GROUPS_KEY}:dev:3589:/systems2`);
            expect(devCollapsedGroupsKey('', '/maps')).not.toBe(devCollapsedGroupsKey('', '/systems2'));
            expect(devCollapsedGroupsKey(undefined, undefined)).toBe(`${COLLAPSED_GROUPS_KEY}:dev::`);
        });

        it('returns the fallback when nothing is stored', () => {
            expect(loadCollapsedGroups(key, { tasks: true })).toEqual({ tasks: true });
        });

        it('honours a stored empty map over the fallback', () => {
            persistCollapsedGroups({}, key);
            expect(loadCollapsedGroups(key, { tasks: true })).toEqual({});
        });

        it('ignores the production key', () => {
            localStorage.setItem(COLLAPSED_GROUPS_KEY, JSON.stringify({}));
            expect(loadCollapsedGroups(key, { swarm: true })).toEqual({ swarm: true });
        });
    });
});

describe('iconModeLinks (req #3590)', () => {
    const groups = [
        { id: 'cal', label: '' },
        { id: 'work', label: 'WORK' },
        { id: 'swarm', label: 'SWARM' },
    ];
    const links = [
        { path: '/calview', group: 'cal' },
        { path: '/tasks', group: 'work' },
        { path: '/swarm', group: 'swarm', children: [
            { path: '/swarm/sessions', group: 'swarm' },
            { path: '/swarm/starts', group: 'swarm' },
        ] },
        { path: '/swarm/initiatives', group: 'swarm' },
    ];
    const paths = (ls) => ls.map(l => l.path);

    it('shows every L2 link but no L3 children by default', () => {
        expect(paths(iconModeLinks(groups, links, {}, {})))
            .toEqual(['/calview', '/tasks', '/swarm', '/swarm/initiatives']);
    });

    it('hides every link of a collapsed group', () => {
        expect(paths(iconModeLinks(groups, links, { swarm: true }, {})))
            .toEqual(['/calview', '/tasks']);
    });

    it('never hides an unlabelled group, even with a stray flag', () => {
        expect(paths(iconModeLinks(groups, links, { cal: true }, {})))
            .toEqual(['/calview', '/tasks', '/swarm', '/swarm/initiatives']);
    });

    it('shows L3 children right after their parent only while it is expanded', () => {
        expect(paths(iconModeLinks(groups, links, {}, { '/swarm': true })))
            .toEqual(['/calview', '/tasks', '/swarm', '/swarm/sessions', '/swarm/starts', '/swarm/initiatives']);
    });

    it('a collapsed group hides an expanded item\'s children too', () => {
        expect(paths(iconModeLinks(groups, links, { swarm: true }, { '/swarm': true })))
            .toEqual(['/calview', '/tasks']);
    });

    it('follows group order, not link order', () => {
        const reordered = [groups[2], groups[0], groups[1]];
        expect(paths(iconModeLinks(reordered, links, {}, {})))
            .toEqual(['/swarm', '/swarm/initiatives', '/calview', '/tasks']);
    });

    it('with nothing collapsed or expanded, matches the real config\'s top-level links', () => {
        const expected = NAV_GROUPS.flatMap(g => NAV_LINKS.filter(l => l.group === g.id));
        expect(iconModeLinks(NAV_GROUPS, NAV_LINKS, {}, {})).toEqual(expected);
    });
});
