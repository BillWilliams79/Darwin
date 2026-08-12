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
        // whose children are hidden. Pipelines holds the slot (req #3427), at
        // the one plan list there is since req #3356 collapsed the two eras.
        const firstSwarm = NAV_LINKS.find(l => l.group === 'swarm');
        expect(firstSwarm.path).toBe('/swarm/pipelines');
    });
});

// Req #3236 — the plan-layer editors nest as L3 children of Pipelines, reusing
// the exact mechanism the Sessions block above pins. This SUPERSEDES #3139 and
// #3140, each of which pinned "sibling, never a child of Pipelines" for one of
// these two — the earlier assertions are inverted here on purpose, not merely
// deleted. req #3357 retired the Features entry that once sat between them (the
// Feature tier itself left the plan; a step belongs to its epic directly).
//
// req #3356 — THERE IS ONE PLAN SURFACE NOW, so there is one nav entry per
// level and none of them carries an era marker. The 1.0 pages were deleted and
// the 2.0 pages took their routes (`/swarm/pipelines2` -> `/swarm/pipelines`,
// `/swarm/epics2` -> `/swarm/epics`, `/swarm/steps2` -> `/swarm/steps`) and
// their labels (`Epics 2.0` -> `Epics`, `Steps 2.0` -> `Steps`). The separate
// `Pipelines 2.0` CHILD went at the same time for a mechanical reason, not a
// cosmetic one: it would have held the same path as its own parent, and `path`
// is this config's identity — the React key, the expand/collapse key, the
// testid slug, and what `flattenNavLinks` feeds the mobile bottom nav's
// active-item lookup. That is asserted below.
describe('navConfig — the plan editors nest under Pipelines (req #3236)', () => {
    const PIPELINES_PATH = '/swarm/pipelines';
    // req #3393 — the plan-layer editors, in hierarchy order (Epic > Step).
    // NavBarSidebar renders exactly two levels (a
    // Pipelines-owns-Epics-owns-something L4 shape would be silently dropped),
    // so this array is the only place a plan-editor child can go.
    const CHILD_PATHS = ['/swarm/epics', '/swarm/steps'];

    const pipelines = NAV_LINKS.find(l => l.path === PIPELINES_PATH);

    it('keeps Pipelines as a top-level link in the swarm group', () => {
        expect(pipelines).toBeDefined();
        expect(pipelines.group).toBe('swarm');
        expect(pipelines.label).toBe('Pipelines');
    });

    it('nests the plan editors under Pipelines, in hierarchy order', () => {
        // Epic > Step — not arrival order.
        expect(pipelines.children.map(c => c.path)).toEqual(CHILD_PATHS);
        // Unsuffixed since req #3356 — with one era left, an `Epics 2.0` label
        // would name a distinction the reader can no longer draw.
        expect(pipelines.children.map(c => c.label))
            .toEqual(['Epics', 'Steps']);
    });

    it('never gives a child the same path as its parent', () => {
        // `path` is the React key, the expand/collapse key and the bottom nav's
        // active-item lookup, so a duplicate is a defect rather than a redundant
        // label. This is why the `Pipelines 2.0` child was removed when the
        // parent took its path (req #3356).
        const paths = flattenNavLinks(NAV_LINKS).map(l => l.path);
        expect(new Set(paths).size).toBe(paths.length);
    });

    it('every child carries an icon so the collapsed sidebar can render it', () => {
        pipelines.children.forEach(child => expect(child.icon).toBeTruthy());
    });

    // Group-inheritance and single-level nesting are already pinned GLOBALLY by
    // the Sessions block above (it iterates every NAV_LINKS parent, not just
    // Sessions), so Pipelines is already covered — no per-parent duplicate here.

    it('no longer lists the child paths at the top level', () => {
        const topLevel = NAV_LINKS.map(l => l.path);
        CHILD_PATHS.forEach(p => expect(topLevel).not.toContain(p));
    });

    // THIS ASSERTION IS THE INVERSE OF ITS PRE-#3356 FORM, deliberately. It read
    // "lists no Pipeline 1.0 route anywhere", pinning `/swarm/pipelines` ABSENT
    // while the surviving plan list sat at `/swarm/pipelines2`. The eras
    // collapsed the other way round — the 2.0 pages TOOK the plain routes — so
    // the path it once forbade is now the only plan list there is, and the fact
    // worth pinning is that there is exactly ONE of it.
    it('lists exactly one plan-list route, and no era-suffixed route (req #3356)', () => {
        const flat = flattenNavLinks(NAV_LINKS).map(l => l.path);
        expect(flat.filter(p => p === '/swarm/pipelines')).toEqual(['/swarm/pipelines']);
        // Pinned ABSENT rather than merely unlisted: a nav entry to a page that
        // no longer exists renders a link that 404s, and nothing else catches it.
        ['/swarm/pipelines2', '/swarm/epics2', '/swarm/steps2']
            .forEach(p => expect(flat).not.toContain(p));
    });

    it('no longer lists a Features route anywhere in the tree (req #3357)', () => {
        const occurrences = flattenNavLinks(NAV_LINKS)
            .filter(l => l.path === '/swarm/features').length;
        expect(occurrences).toBe(0);
    });

    it('leaves the swarm-validate group intact', () => {
        expect(NAV_LINKS.filter(l => l.group === 'swarm-validate').map(l => l.path))
            .toEqual(['/swarm/testcases', '/swarm/testplans', '/swarm/testruns']);
        expect(NAV_GROUPS.map(g => g.id)).toContain('swarm-validate');
    });

    it('exposes the L3 routes in the flattened list', () => {
        const flat = flattenNavLinks(NAV_LINKS).map(l => l.path);
        CHILD_PATHS.forEach(p => expect(flat).toContain(p));
        expect(flat).toContain(PIPELINES_PATH);
    });

    it('holds the swarm group\'s first link (req #3427)', () => {
        // Same HomePage-redirect invariant the Sessions block above pins.
        // Pipelines leads the group as of req #3427 — the plan is the entry
        // point workers are launched from, so it reads first.
        expect(NAV_LINKS.find(l => l.group === 'swarm').path).toBe(PIPELINES_PATH);
    });
});

// Req #3238 — Machines nests as an L3 child of Requirements, reusing the exact
// mechanism the Sessions block above pins.
describe('navConfig — Machines nests under Requirements (req #3238)', () => {
    const REQUIREMENTS_PATH = '/swarm';
    const MACHINES_PATH = '/swarm/machines';
    // req #3356 — one plan list, at the unsuffixed route.
    const PIPELINES_PATH = '/swarm/pipelines';

    const requirements = NAV_LINKS.find(l => l.path === REQUIREMENTS_PATH);

    it('keeps Requirements as a top-level link in the swarm group', () => {
        expect(requirements).toBeDefined();
        expect(requirements.group).toBe('swarm');
        expect(requirements.label).toBe('Requirements');
    });

    it('nests Machines under Requirements', () => {
        expect(requirements.children.map(c => c.path)).toEqual([MACHINES_PATH]);
        expect(requirements.children.map(c => c.label)).toEqual(['Machines']);
    });

    it('every child carries an icon so the collapsed sidebar can render it', () => {
        requirements.children.forEach(child => expect(child.icon).toBeTruthy());
    });

    it('no longer lists Machines at the top level', () => {
        const topLevel = NAV_LINKS.map(l => l.path);
        expect(topLevel).not.toContain(MACHINES_PATH);
    });

    it('exposes Machines in the flattened list', () => {
        const flat = flattenNavLinks(NAV_LINKS).map(l => l.path);
        expect(flat).toContain(MACHINES_PATH);
    });

    it('sits second in the swarm group, behind Pipelines (req #3427)', () => {
        // Same HomePage-redirect invariant the Sessions block above pins.
        // Pipelines leads the group as of req #3427; Requirements is second.
        const swarmLinks = NAV_LINKS.filter(l => l.group === 'swarm');
        expect(swarmLinks[0].path).toBe(PIPELINES_PATH);
        expect(swarmLinks[1].path).toBe(REQUIREMENTS_PATH);
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
