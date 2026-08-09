// @vitest-environment jsdom
//
// Req #3431 — THE APP SHELL FEEDS THE ROUTE TRAIL.
//
// `utils/routeTrail.test.js` pins the module in isolation and
// `PipelinesPage.resume.test.jsx` calls `noteRoute()` by hand to stage its
// journeys. Between those two suites sits the one line that makes either of
// them describe the running app — `useEffect(() => { noteRoute(pathname) })`
// in `App.jsx` — and NOTHING asserted it.
//
// WHAT BREAKS IF IT GOES. `cameFrom()` answers null forever, so the pipelines
// list believes every arrival came from nowhere, so it resumes to the last plan
// EVEN WHEN THE READER JUST WALKED OUT OF ONE. Clicking Pipelines in the nav
// rail bounces straight back to the plan and the list can never be opened
// again — the single catastrophic failure this feature's whole design is built
// around. Delete the effect, or narrow its dependency list to `[]`, and every
// other test in this repository still passes.
//
// The shell is rendered for real (as the layout route it is) so the assertion
// covers the WIRING and not a re-statement of the module: the probe asks
// `cameFrom` exactly the way `PipelinesPage` does — from a `useState`
// initializer, i.e. during render, before any effect on the page has run.
//
// `NavBar` and `SnackBar` are stubbed. Neither participates in the trail, and
// the real NavBar drags in the profile, the query client and the whole nav
// config for nothing.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../NavBar/NavBar', () => ({ default: () => null }));
vi.mock('../Components/SnackBar/SnackBar', () => ({ SnackBar: () => null }));

import App from '../App';
import { cameFrom, resetRouteTrail } from '../utils/routeTrail';
import { isPipelineDetailPath } from '../SwarmView/pipelines/pipelinePlace';

let roots = [];

// The pipelines list, reduced to the one question it asks on arrival. A
// `useState` initializer and not an effect, because that is where
// `PipelinesPage` freezes the answer — asking any later would test an ordering
// the page does not use.
function ListProbe() {
    const { pathname } = useLocation();
    const [origin] = useState(() => cameFrom(pathname));
    return <div data-testid="list" data-origin={origin == null ? '' : origin} />;
}

function PlanStub() {
    const navigate = useNavigate();
    return (
        <div data-testid="plan">
            <button data-testid="to-list" onClick={() => navigate('/swarm/pipelines')} />
            <button data-testid="to-sessions" onClick={() => navigate('/swarm/sessions')} />
        </div>
    );
}

function SessionsStub() {
    const navigate = useNavigate();
    return (
        <button data-testid="to-list-from-sessions"
                onClick={() => navigate('/swarm/pipelines')} />
    );
}

function mount(start) {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    act(() => {
        root.render(
            <MemoryRouter initialEntries={[start]}>
                <Routes>
                    <Route element={<App />}>
                        <Route path="/swarm/pipelines" element={<ListProbe />} />
                        <Route path="/swarm/pipeline/:id" element={<PlanStub />} />
                        <Route path="/swarm/sessions" element={<SessionsStub />} />
                    </Route>
                </Routes>
            </MemoryRouter>,
        );
    });
    roots.push(root);
}

const node = (testId) => document.body.querySelector(`[data-testid="${testId}"]`);
const click = (testId) => act(() => { node(testId).click(); });
// '' is how the probe spells null, so a missing element and "no origin" can
// never be confused: this throws rather than reporting null for a page that
// never rendered.
const originSeenByTheList = () => node('list').getAttribute('data-origin');

describe('App — the route trail (req #3431)', () => {
    beforeEach(() => { resetRouteTrail(); roots = []; });
    afterEach(() => {
        act(() => { roots.forEach((r) => r.unmount()); });
        document.body.innerHTML = '';
    });

    // A fresh open, a reload, a bookmark. Nothing preceded this page, and that
    // is the case the resume exists to serve — the reader who comes back hours
    // later must not be read as having walked out of a plan a moment ago.
    it('reports no origin on a cold arrival at the list', () => {
        mount('/swarm/pipelines');
        expect(originSeenByTheList()).toBe('');
    });

    // THE ONE THAT FAILS IF THE EFFECT IS DELETED. Every other case in this
    // file, and every case in the two sibling suites, survives that edit.
    it('reports the plan the reader came from, through the real shell', () => {
        mount('/swarm/pipeline/2');
        click('to-list');
        expect(originSeenByTheList()).toBe('/swarm/pipeline/2');
        expect(isPipelineDetailPath(originSeenByTheList()),
            'and the resume gate recognises it as a plan').toBe(true);
    });

    // PATHNAME ONLY. `App` destructures `pathname` and never touches
    // `location.search`, and that is load-bearing rather than tidy: the gate
    // tests the origin with `isPipelineDetailPath`, whose pattern is anchored,
    // so a trail carrying `?mode=plan` stops matching — the origin reads as
    // "not a plan", the resume fires on the way out, and the list becomes
    // unreachable. The failure is invisible until somebody arrives by a link.
    it('records the path without the query string', () => {
        mount('/swarm/pipeline/2?mode=plan&step=47');
        click('to-list');
        expect(originSeenByTheList()).toBe('/swarm/pipeline/2');
        expect(isPipelineDetailPath(originSeenByTheList())).toBe(true);
    });

    // The requirement's own sentence — "if you navigate away you would hours
    // later when coming back" — routed through the shell. Leaving a plan for
    // another part of the app is NOT the act of walking back out to the list,
    // so the origin is the page in between and the resume is free to fire.
    it('reports the intermediate page after a detour, not the plan', () => {
        mount('/swarm/pipeline/2');
        click('to-sessions');
        click('to-list-from-sessions');
        expect(originSeenByTheList()).toBe('/swarm/sessions');
        expect(isPipelineDetailPath(originSeenByTheList()),
            'so the gate lets the resume through').toBe(false);
    });
});
