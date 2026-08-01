// Req #3209 — Sessions is an L2 nav item with L3 children.
//
// These tests pin the two things that break silently if the nesting is edited
// carelessly: a route disappearing from the nav entirely, and a consumer that
// reads NAV_LINKS flat losing the children.

import { describe, it, expect } from 'vitest';
import { NAV_LINKS, NAV_GROUPS, flattenNavLinks } from '../navConfig';

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

// Req #3140 — the Steps editor joins feature 37's Pipelines > Epics > Steps L2
// cluster. Same positional spec as #3139 ("goes where pipelines L2 is"), so
// position is again what these pin: appending Steps to the end of the swarm group
// would satisfy every other assertion in this file and still be wrong.
describe('navConfig — Steps editor placement (req #3140)', () => {
    const STEPS_PATH = '/swarm/steps';
    const FEATURES_PATH = '/swarm/features';
    const EPICS_PATH = '/swarm/epics';
    const PIPELINES_PATH = '/swarm/pipelines';

    it('registers Steps as an L2 link in the swarm group', () => {
        const steps = NAV_LINKS.find(l => l.path === STEPS_PATH);
        expect(steps).toBeDefined();
        expect(steps.group).toBe('swarm');
        expect(steps.label).toBe('Steps');
        expect(steps.icon).toBeTruthy();
    });

    it('keeps Pipelines, Epics, Features and Steps contiguous, in that order', () => {
        // Req #3217 seated Features between Epics and Steps, so Steps moved from
        // Pipelines + 2 to Pipelines + 3. Everything #3140 actually pinned — Steps
        // inside the cluster, after Epics, with no gap — is asserted here still;
        // only the constant it was measured against changed.
        const paths = NAV_LINKS.map(l => l.path);
        const pipelines = paths.indexOf(PIPELINES_PATH);
        expect(paths.indexOf(EPICS_PATH)).toBe(pipelines + 1);
        expect(paths.indexOf(FEATURES_PATH)).toBe(pipelines + 2);
        expect(paths.indexOf(STEPS_PATH)).toBe(pipelines + 3);
    });

    it('keeps Steps a SIBLING of Pipelines, never a child of it', () => {
        // A step is a MEMBER of a plan, not a lifecycle record OF one, so it must
        // not acquire req #3209's nesting.
        const steps = NAV_LINKS.find(l => l.path === STEPS_PATH);
        expect(steps.children).toBeUndefined();
        NAV_LINKS.forEach(parent => {
            expect((parent.children ?? []).map(c => c.path)).not.toContain(STEPS_PATH);
        });
    });

    it('leaves Requirements as the swarm group\'s first link', () => {
        // Same HomePage-redirect invariant the blocks above pin.
        expect(NAV_LINKS.find(l => l.group === 'swarm').path).toBe('/swarm');
    });
});

// Req #3217 — the Features editor, the last page of feature 37. Unlike its two
// siblings this one is a MOVE, not an addition: /swarm/features has existed since
// #2380 and was filed under SWARM VALIDATE, a group gated behind a profile toggle
// that ships disabled. Two failure modes are specific to a move and to nothing
// else in this file, so both get their own assertion: leaving the old entry behind
// (a duplicate route in the tree) and moving it somewhere other than the cluster.
describe('navConfig — Features editor placement (req #3217)', () => {
    const FEATURES_PATH = '/swarm/features';
    const STEPS_PATH = '/swarm/steps';
    const EPICS_PATH = '/swarm/epics';
    const PIPELINES_PATH = '/swarm/pipelines';

    it('registers Features as an L2 link in the swarm group', () => {
        const features = NAV_LINKS.find(l => l.path === FEATURES_PATH);
        expect(features).toBeDefined();
        expect(features.group).toBe('swarm');
        expect(features.label).toBe('Features');
        expect(features.icon).toBeTruthy();
    });

    it('places Features between Epics and Steps', () => {
        // Epic > Feature is the plan hierarchy design rule 10 walks (requirement →
        // feature → epic), and feature 37 enumerates its pages in that order.
        const paths = NAV_LINKS.map(l => l.path);
        expect(paths.indexOf(FEATURES_PATH)).toBe(paths.indexOf(EPICS_PATH) + 1);
        expect(paths.indexOf(STEPS_PATH)).toBe(paths.indexOf(FEATURES_PATH) + 1);
    });

    it('no longer files Features under the swarm-validate group', () => {
        const validatePaths = NAV_LINKS.filter(l => l.group === 'swarm-validate')
                                       .map(l => l.path);
        expect(validatePaths).not.toContain(FEATURES_PATH);
    });

    it('lists Features exactly once across the whole tree', () => {
        // The move's own failure mode: adding the swarm entry without deleting the
        // swarm-validate one. Both rows would light up as active on /swarm/features
        // and the mobile bottom nav would show the page twice.
        const occurrences = flattenNavLinks(NAV_LINKS)
            .filter(l => l.path === FEATURES_PATH).length;
        expect(occurrences).toBe(1);
    });

    it('leaves the rest of the swarm-validate group intact', () => {
        // Moving one entry out must not empty or reorder the group it left.
        expect(NAV_LINKS.filter(l => l.group === 'swarm-validate').map(l => l.path))
            .toEqual(['/swarm/testcases', '/swarm/testplans', '/swarm/testruns']);
        expect(NAV_GROUPS.map(g => g.id)).toContain('swarm-validate');
    });

    it('keeps Features a SIBLING of Pipelines, never a child of it', () => {
        // A feature is a tier the plan is composed FROM, not a lifecycle record OF
        // a pipeline, so it must not acquire req #3209's nesting.
        const features = NAV_LINKS.find(l => l.path === FEATURES_PATH);
        expect(features.children).toBeUndefined();
        NAV_LINKS.forEach(parent => {
            expect((parent.children ?? []).map(c => c.path)).not.toContain(FEATURES_PATH);
        });
    });

    it('keeps the whole plan-editor cluster in one unbroken run', () => {
        const paths = NAV_LINKS.map(l => l.path);
        const start = paths.indexOf(PIPELINES_PATH);
        expect(paths.slice(start, start + 4)).toEqual([
            PIPELINES_PATH, EPICS_PATH, FEATURES_PATH, STEPS_PATH,
        ]);
    });

    it('leaves Requirements as the swarm group\'s first link', () => {
        // Same HomePage-redirect invariant the blocks above pin — Features must not
        // land ahead of /swarm and become the redirect target.
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
