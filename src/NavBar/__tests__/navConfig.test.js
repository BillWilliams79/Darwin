// Req #3209 — Sessions is an L2 nav item with L3 children.
//
// These tests pin the two things that break silently if the nesting is edited
// carelessly: a route disappearing from the nav entirely, and a consumer that
// reads NAV_LINKS flat losing the children.

import { describe, it, expect } from 'vitest';
import { NAV_LINKS, flattenNavLinks } from '../navConfig';

const SESSIONS_PATH = '/swarm/sessions';
const L3_PATHS = ['/swarm/swarm-starts', '/swarm/swarm-completes', '/swarm/swarm-undos'];

describe('navConfig — Sessions sub-items', () => {
    const sessions = NAV_LINKS.find(l => l.path === SESSIONS_PATH);

    it('keeps Sessions as a top-level link in the swarm group', () => {
        expect(sessions).toBeDefined();
        expect(sessions.group).toBe('swarm');
        expect(sessions.label).toBe('Sessions');
    });

    it('nests Starts / Completes / Undos under Sessions, in that order', () => {
        expect(sessions.children.map(c => c.path)).toEqual(L3_PATHS);
        expect(sessions.children.map(c => c.label)).toEqual(['Starts', 'Completes', 'Undos']);
    });

    it('every child carries an icon so the collapsed sidebar can render it', () => {
        sessions.children.forEach(child => expect(child.icon).toBeTruthy());
    });

    it('every child shares its parent\'s group', () => {
        // The sidebar filters by profile app-toggle at the TOP level only and
        // renders children under whichever group the parent landed in, so a
        // child declaring a different group would render in the wrong place
        // AND ignore its own toggle. Pin the invariant rather than the code.
        NAV_LINKS.filter(l => l.children?.length).forEach(parent => {
            parent.children.forEach(child => expect(child.group).toBe(parent.group));
        });
    });

    it('nests exactly one level — no grandchildren', () => {
        // flattenNavLinks is depth-1 by design; a grandchild would be dropped
        // silently and vanish from the mobile bottom nav.
        NAV_LINKS.forEach(parent => {
            (parent.children ?? []).forEach(child => expect(child.children).toBeUndefined());
        });
    });

    it('no longer lists the L3 paths at the top level', () => {
        const topLevel = NAV_LINKS.map(l => l.path);
        L3_PATHS.forEach(p => expect(topLevel).not.toContain(p));
    });

    it('leaves Sessions off the first-link position of the swarm group', () => {
        // HomePage redirects to the FIRST link of the first enabled group; if
        // Sessions ever became that link the redirect would land on a parent
        // whose children are hidden. Requirements holds the slot.
        const firstSwarm = NAV_LINKS.find(l => l.group === 'swarm');
        expect(firstSwarm.path).toBe('/swarm');
    });
});

// Req #3139 — the Epics editor is an L2 entry directly under Pipelines. The
// spec is positional ("goes where pipelines L2 is"), so position is what these
// pin: a later nav edit that appends Epics to the end of the swarm group would
// satisfy every other assertion in this file and still be wrong.
describe('navConfig — Epics editor placement (req #3139)', () => {
    const EPICS_PATH = '/swarm/epics';
    const PIPELINES_PATH = '/swarm/pipelines';

    it('registers Epics as an L2 link in the swarm group', () => {
        const epics = NAV_LINKS.find(l => l.path === EPICS_PATH);
        expect(epics).toBeDefined();
        expect(epics.group).toBe('swarm');
        expect(epics.label).toBe('Epics');
        expect(epics.icon).toBeTruthy();
    });

    it('places Epics immediately after Pipelines', () => {
        const paths = NAV_LINKS.map(l => l.path);
        expect(paths.indexOf(EPICS_PATH)).toBe(paths.indexOf(PIPELINES_PATH) + 1);
    });

    it('keeps Epics a SIBLING of Pipelines, never a child of it', () => {
        // An epic is not a lifecycle record OF a pipeline the way Starts are of
        // a Session, so it must not acquire req #3209's nesting.
        const epics = NAV_LINKS.find(l => l.path === EPICS_PATH);
        expect(epics.children).toBeUndefined();
        NAV_LINKS.forEach(parent => {
            expect((parent.children ?? []).map(c => c.path)).not.toContain(EPICS_PATH);
        });
    });

    it('leaves Requirements as the swarm group\'s first link', () => {
        // Same HomePage-redirect invariant the Sessions block above pins.
        expect(NAV_LINKS.find(l => l.group === 'swarm').path).toBe('/swarm');
    });
});

describe('flattenNavLinks', () => {
    it('emits each parent immediately followed by its children', () => {
        const flat = flattenNavLinks([
            { path: '/a' },
            { path: '/b', children: [{ path: '/b1' }, { path: '/b2' }] },
            { path: '/c' },
        ]);
        expect(flat.map(l => l.path)).toEqual(['/a', '/b', '/b1', '/b2', '/c']);
    });

    it('passes through a list with no children unchanged', () => {
        const links = [{ path: '/a' }, { path: '/b' }];
        expect(flattenNavLinks(links).map(l => l.path)).toEqual(['/a', '/b']);
    });

    it('treats an empty children array as a leaf', () => {
        expect(flattenNavLinks([{ path: '/a', children: [] }]).map(l => l.path)).toEqual(['/a']);
    });

    it('exposes every L3 route so the mobile bottom nav can reach it', () => {
        const flat = flattenNavLinks(NAV_LINKS).map(l => l.path);
        L3_PATHS.forEach(p => expect(flat).toContain(p));
        expect(flat).toContain(SESSIONS_PATH);
    });

    it('produces no duplicate paths', () => {
        const flat = flattenNavLinks(NAV_LINKS).map(l => l.path);
        expect(new Set(flat).size).toBe(flat.length);
    });
});
