// @vitest-environment jsdom
//
// Req #3790 — a dev server shows only its session's applications.
//
// Pins the three resolution rules (explicit list wins, else the app owning
// the session's route, else no override), the route-ownership lookup, and the
// one visibility predicate every consumer asks.

import { describe, it, expect, beforeEach } from 'vitest';
import {
    NAV_GROUPS, NAV_LINKS, DEV_APP_GROUPS, DEV_APP_LABELS, GROUP_PROFILE_KEY,
    DEV_APPS_OFF_KEY, DEV_APPS_OFF_ALL,
    appForRoute, resolveDevApps, isGroupVisible, devAppsOptedOut, setDevAppsOptOut,
} from '../navConfig';

describe('appForRoute', () => {
    it.each([
        ['/maps', 'maps'],
        ['/maps/123', 'maps'],
        ['/taskcards', 'tasks'],
        ['/calview', 'tasks'],
        ['/systems2?opt=tpu8t-datacenter-3d', 'systems'],
        ['/swarm/pipelines/2?mode=plan', 'swarm'],
        ['/swarm/pipeline/2?mode=plan', 'swarm'],
        ['/swarm/sessions/7', 'swarm'],
        ['/devservers', 'swarm'],
        ['/agents/instructions', 'swarm'],
        ['/swarm/testcases/9', 'swarm-validate'],
        ['/areaedit', 'tasks'],
        ['/domainedit', 'tasks'],
        ['/projectedit', 'swarm'],
        ['/categoryedit?id=4', 'swarm'],
    ])('%s belongs to %s', (route, app) => {
        expect(appForRoute(route)).toBe(app);
    });

    it('matches at a `/` boundary, never a bare string prefix', () => {
        expect(appForRoute('/mapsx')).toBeNull();
    });

    it('is null for a route no nav link owns, and for no route', () => {
        expect(appForRoute('/profile')).toBeNull();
        expect(appForRoute('')).toBeNull();
        expect(appForRoute(undefined)).toBeNull();
    });
});

describe('resolveDevApps', () => {
    it('is null outside dev mode whatever the inputs', () => {
        expect(resolveDevApps({ dev: false, apps: 'swarm', route: '/maps' })).toBeNull();
    });

    it('takes an explicit list over the route', () => {
        expect([...resolveDevApps({ dev: true, apps: 'swarm, maps', route: '/taskcards' })])
            .toEqual(['swarm', 'maps']);
    });

    it('derives the one app owning the route when no list is named', () => {
        expect([...resolveDevApps({ dev: true, apps: '', route: '/maps/4' })]).toEqual(['maps']);
    });

    it('drops unknown names, and falls back to the route when none is left', () => {
        expect([...resolveDevApps({ dev: true, apps: 'maps,bogus', route: '/swarm' })]).toEqual(['maps']);
        expect([...resolveDevApps({ dev: true, apps: 'bogus', route: '/swarm' })]).toEqual(['swarm']);
    });

    it('is null with no list and no owned route — the profile decides', () => {
        expect(resolveDevApps({ dev: true, apps: undefined, route: undefined })).toBeNull();
        expect(resolveDevApps({ dev: true, apps: '', route: '/profile' })).toBeNull();
    });
});

describe('isGroupVisible', () => {
    const allOff = { app_tasks: 0, app_maps: 0, app_swarm: 0, app_swarm_validate: 0 };

    it('under an override shows exactly the scoped apps\' groups, overriding the profile', () => {
        const scope = new Set(['swarm']);
        const visible = NAV_GROUPS.map(g => g.id).filter(id => isGroupVisible(allOff, id, scope));
        expect(visible).toEqual(NAV_GROUPS.map(g => g.id).filter(id => ['swarm', 'agents'].includes(id)));
    });

    it('Calendar rides with Tasks', () => {
        expect(isGroupVisible({}, 'calendar', new Set(['tasks']))).toBe(true);
        expect(isGroupVisible({}, 'calendar', new Set(['maps']))).toBe(false);
    });

    it('without an override follows the profile toggles and their defaults', () => {
        expect(isGroupVisible({ app_maps: 0 }, 'maps', null)).toBe(false);
        expect(isGroupVisible({ app_swarm: 1 }, 'agents', null)).toBe(true);
        expect(isGroupVisible(undefined, 'swarm-validate', null)).toBe(false);
        expect(isGroupVisible(undefined, 'calendar', null)).toBe(true);
    });
});

describe('the opt-out is remembered per scope, not per port', () => {
    beforeEach(() => localStorage.clear());

    it('switches off exactly the scope it was set against', () => {
        setDevAppsOptOut(true, '3790|/maps|maps');
        expect(devAppsOptedOut('3790|/maps|maps')).toBe(true);
        // A later session reusing the port is scoped again.
        expect(devAppsOptedOut('3801|/swarm|swarm')).toBe(false);
    });

    it('switching back on clears it', () => {
        setDevAppsOptOut(true, 'a');
        setDevAppsOptOut(false, 'a');
        expect(devAppsOptedOut('a')).toBe(false);
        expect(localStorage.getItem(DEV_APPS_OFF_KEY)).toBeNull();
    });

    it('`*` (the E2E setup) switches off every scope on the origin', () => {
        localStorage.setItem(DEV_APPS_OFF_KEY, DEV_APPS_OFF_ALL);
        expect(devAppsOptedOut('anything|/maps|maps')).toBe(true);
    });
});

describe('the application vocabulary', () => {
    it('places every nav group in exactly one application', () => {
        const owned = Object.values(DEV_APP_GROUPS).flat();
        expect(new Set(owned).size).toBe(owned.length);
        // NAV_GROUPS drops `systems` outside dev; the vocabulary must still cover it.
        NAV_GROUPS.forEach(g => expect(owned).toContain(g.id));
        expect(owned).toContain('systems');
    });

    it('every nav link\'s group is owned', () => {
        const owned = new Set(Object.values(DEV_APP_GROUPS).flat());
        NAV_LINKS.forEach(l => expect(owned.has(l.group)).toBe(true));
    });

    it('agrees with the profile toggles on what an application is', () => {
        // A group gated by a profile column sits in the app named for that toggle.
        expect(GROUP_PROFILE_KEY.agents).toBe(GROUP_PROFILE_KEY.swarm);
        expect(DEV_APP_GROUPS.swarm).toEqual(expect.arrayContaining(['swarm', 'agents']));
    });

    it('labels every application', () => {
        expect(Object.keys(DEV_APP_LABELS).sort()).toEqual(Object.keys(DEV_APP_GROUPS).sort());
    });
});
