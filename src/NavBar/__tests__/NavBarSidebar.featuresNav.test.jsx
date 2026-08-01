// @vitest-environment jsdom
//
// Req #3217 — the Features entry is a MOVE between nav groups, and navConfig.test.js
// can only see the data. What it cannot see is the sidebar that consumes it, where
// the move's real consequence lives: `visibleLinks` is filtered by the profile's
// per-group app toggle, so which group a link is filed under decides whether it
// renders AT ALL. An entry that is correct in NAV_LINKS and still invisible to the
// user would pass every assertion in that file.
//
// Which makes the move a TRADE, not a pure gain, and the toggle matrix below is the
// point of this file. A link has exactly one group, so gaining `app_swarm` means
// losing `app_swarm_validate`: Features became visible to a Swarm user (the case the
// requirement is about — the Validate toggle ships disabled, so the entry was dead
// for anyone who had not gone looking for it) and invisible to a Validate-only one.
// That second state is a deliberate consequence of reclassifying Features as a PLAN
// entity, so it is pinned as an expectation rather than left to be rediscovered as a
// surprise. All four states are asserted; if a later change flips any of them, this
// file says so.
//
// The remaining tests pin invariants the move must not break — one row not two, the
// right row highlighted, present on mobile — rather than the move itself.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { MemoryRouter } from 'react-router-dom';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// NavBarSidebar imports exactly one hook from this module. A full replacement is
// lighter than a partial mock and keeps the whole react-query/RestApi chain out.
vi.mock('../../hooks/useDataQueries', () => ({
    useDevServers: () => ({ data: [] }),
}));

// Never opened here; stubbing it keeps ProfileContent's REST imports out of jsdom.
vi.mock('../ProfileDialog', () => ({ default: () => null }));

import NavBarSidebar from '../NavBarSidebar';
import AuthContext from '../../Context/AuthContext';
import AppContext from '../../Context/AppContext';

const CLUSTER = ['/swarm/pipelines', '/swarm/epics', '/swarm/features', '/swarm/steps'];

let mountedRoots = [];

// Desktop is the branch with group headers; without a matchMedia stub jsdom answers
// "no match" and MUI renders the mobile bottom nav, where the SWARM header this test
// positions against does not exist at all.
function stubDesktop(isDesktop = true) {
    window.matchMedia = (query) => ({
        matches: query.includes('min-width:900px') ? isDesktop : false,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
    });
}

function mount({ profile, initialPath = '/swarm' } = {}) {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => {
        root.render(
            <MemoryRouter initialEntries={[initialPath]}>
                <AppContext.Provider value={{ database: 'darwin_dev' }}>
                    <AuthContext.Provider value={{ idToken: 'tok', profile }}>
                        <NavBarSidebar />
                    </AuthContext.Provider>
                </AppContext.Provider>
            </MemoryRouter>
        );
    });
    mountedRoots.push(root);
}

const BOTH_GROUPS_ON = {
    userName: 'tester',
    app_tasks: 1, app_maps: 1, app_swarm: 1, app_swarm_validate: 1,
};

// Every nav row in DOM order, group headers included, so a link's group membership
// can be read off its position rather than trusted from the config it came from.
const navRows = () => [...document.body.querySelectorAll(
    'a[href], [data-testid^="nav-group-header-"]'
)].map(el => (
    el.tagName === 'A'
        ? { href: el.getAttribute('href'), label: el.textContent }
        : { header: el.getAttribute('data-testid').replace('nav-group-header-', '') }
));

const featureLinks = () =>
    [...document.body.querySelectorAll('a[href="/swarm/features"]')];

beforeEach(() => {
    mountedRoots = [];
    localStorage.clear();
    stubDesktop(true);
});

afterEach(() => {
    act(() => { mountedRoots.forEach(r => r.unmount()); });
    document.body.innerHTML = '';
});

describe('NavBarSidebar — Features nav entry (req #3217)', () => {
    // The toggle matrix. Each row is a state a user can actually produce:
    // ProfileContent renders the four app toggles as independent cards, and its
    // only guard refuses to disable the LAST enabled app, not any pairing.
    it.each([
        ['swarm on,  validate off → 1 Features entry ', { app_swarm: 1, app_swarm_validate: 0 }, 1],
        ['swarm on,  validate on  → 1 Features entry ', { app_swarm: 1, app_swarm_validate: 1 }, 1],
        // Hidden BY DESIGN: Features is a plan entity now, so it goes when the
        // plan group goes. This is the half of the trade the move gave up, and it
        // is here so that giving it up stays a decision rather than an accident.
        ['swarm off, validate on  → 0 Features entries', { app_swarm: 0, app_swarm_validate: 1 }, 0],
        ['swarm off, validate off → 0 Features entries', { app_swarm: 0, app_swarm_validate: 0 }, 0],
    ])('%s', (_label, toggles, expected) => {
        mount({ profile: { ...BOTH_GROUPS_ON, ...toggles } });
        expect(featureLinks()).toHaveLength(expected);
    });

    it('renders exactly one Features entry, labelled and pointing at the editor', () => {
        // Both toggles on is the state that would expose a copy left behind in
        // swarm-validate. With Validate off — its shipped default — a stale
        // duplicate is invisible and the regression would reach production unseen.
        mount({ profile: BOTH_GROUPS_ON });
        const links = featureLinks();
        expect(links).toHaveLength(1);
        expect(links[0].textContent).toContain('Features');
    });

    it('renders it inside the SWARM group, not SWARM VALIDATE', () => {
        mount({ profile: BOTH_GROUPS_ON });
        const rows = navRows();
        const featuresAt = rows.findIndex(r => r.href === '/swarm/features');
        expect(featuresAt).toBeGreaterThan(-1);
        // The group a row belongs to is the last header above it.
        const owningHeader = rows.slice(0, featuresAt)
                                 .filter(r => r.header).pop();
        expect(owningHeader?.header).toBe('swarm');
    });

    it('renders the plan-editor cluster in Pipelines > Epics > Features > Steps order', () => {
        mount({ profile: BOTH_GROUPS_ON });
        const hrefs = navRows().filter(r => r.href).map(r => r.href);
        const cluster = hrefs.filter(h => CLUSTER.includes(h));
        expect(cluster).toEqual(CLUSTER);
        // Contiguous in the rendered list too, not merely in relative order.
        expect(hrefs.indexOf('/swarm/steps'))
            .toBe(hrefs.indexOf('/swarm/pipelines') + 3);
    });

    it('really does hide the Validate group in the matrix\'s validate-off rows', () => {
        // The control that keeps the matrix's first row honest. "Features renders
        // with Validate off" only means anything if Validate off is genuinely in
        // effect — if the toggle were being ignored, that row would pass for the
        // wrong reason and read as proof of exactly the thing it failed to test.
        mount({ profile: { ...BOTH_GROUPS_ON, app_swarm_validate: 0 } });
        expect(document.body.querySelector('a[href="/swarm/testcases"]')).toBeNull();
        expect(featureLinks()).toHaveLength(1);
    });

    it('renders the Validate group but NOT Features when only Validate is on', () => {
        // The positive counterpart to the matrix's swarm-off rows and to the control
        // above, both of which assert only ABSENCE. Absence is satisfied by the
        // toggle working AND by the sidebar rendering nothing at all, or by the link
        // having been deleted outright — so on its own it cannot tell a working
        // filter from a broken render. Asserting a present sibling in the same
        // profile is what makes the missing Features entry mean what it says.
        mount({ profile: { ...BOTH_GROUPS_ON, app_swarm: 0 } });
        expect(document.body.querySelector('a[href="/swarm/testcases"]')).not.toBeNull();
        expect(featureLinks()).toHaveLength(0);
    });

    it('marks Features active on /swarm/features and leaves Requirements inactive', () => {
        // Standing on the page must highlight its own row and only its own. The
        // swarm group's index path is a PREFIX of this one and isActive() relies on
        // an exact-match special case to tell them apart; a row that moved into
        // that group is exactly what puts the special case to work. The sidebar
        // marks active state through sx, not MUI's `selected` prop, so the accent
        // edge-border is what carries it — asserted as opaque-vs-transparent rather
        // than as a literal colour, which belongs to the theme and not to this test.
        mount({ profile: BOTH_GROUPS_ON, initialPath: '/swarm/features' });
        const border = (el) => getComputedStyle(el).borderRightColor;
        expect(border(featureLinks()[0])).not.toMatch(/rgba\(0, 0, 0, 0\)|transparent/);
        expect(border(document.body.querySelector('a[href="/swarm"]')))
            .toMatch(/rgba\(0, 0, 0, 0\)|transparent/);
    });

    it('reaches Features from the mobile bottom nav too', () => {
        stubDesktop(false);
        mount({ profile: BOTH_GROUPS_ON });
        const labels = [...document.body.querySelectorAll('.MuiBottomNavigationAction-root')]
            .map(el => el.textContent);
        expect(labels.filter(l => l.includes('Features'))).toHaveLength(1);
    });
});
