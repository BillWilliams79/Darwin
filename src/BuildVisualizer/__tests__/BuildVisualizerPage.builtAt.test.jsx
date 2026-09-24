// @vitest-environment jsdom
//
// req #3515 — every PAGE-owned surface of the build date/time, end to end
// through the real BuildVisualizerPage.
//
// The helpers (buildDateTime), the editor (BuiltAtField) and the layout
// (d3LayoutEngine) each have their own tests. What none of them can see is the
// page's WIRING: that the card, the release datacard, the perform-release
// dialog and the delete preview each actually render the date line; that the
// card's editor PUTs the right body to the right row (including the "NULL"
// clear sentinel); that the card follows the LIVE model after a refetch; and
// that every live event the page performs — Execute Build (both paths), create
// branch, perform release — stamps its event column with "now" in UTC. Each of
// those is a line in BuildVisualizerPage.jsx that a helper test passes over.
//
// Mocked: the canvas (replaced by a prop-capturing stub, so a test can "click"
// a dot exactly as KonvaBuildCanvas would), the toolbar, the two data hooks
// and the REST client. The build records handed to the page's click handlers
// come from the REAL computeLayout, so `dateLabel` is the one the canvas uses.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, cleanup, fireEvent, act, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

let canvasProps;
let currentModel;

vi.mock('../BuildVisualizerCanvas', () => ({
    default: (props) => { canvasProps = props; return <div data-testid="canvas-stub" />; },
}));
vi.mock('../BuildVisualizerControls', () => ({ default: () => null }));
vi.mock('../useBuildPatterns', () => ({
    useBuildPatterns: () => ({
        activePattern: { id: 14, projectId: 14, name: 'Exemplar' },
        isReady: true,
        error: null,
    }),
}));
vi.mock('../useBuildVisualizerData', () => ({
    useBuildVisualizerData: () => ({ isInitialLoad: false, error: null, model: currentModel }),
}));
vi.mock('../../RestApi/RestApi', () => ({ default: vi.fn() }));
vi.mock('../../hooks/factory/createEntityQueries', () => ({
    fetchEntity: vi.fn(async (url) => (url.endsWith('/customers') ? [{ id: 1, customer_name: 'HP' }] : [])),
}));

import BuildVisualizerPage from '../BuildVisualizerPage';
import { computeLayout } from '../d3LayoutEngine';
import AppContext from '../../Context/AppContext';
import AuthContext from '../../Context/AuthContext';
import call_rest_api from '../../RestApi/RestApi';

const URI = 'https://api.test/darwin_dev';
const NOW = new Date('2026-09-22T14:00:00.000Z');
const NOW_SQL = '2026-09-22 14:00:00';

// Exemplar main (project 14, branch 24): 6.2.1.0 NULL, 6.2.2.0 dated and
// production-ready (so the release path is offered).
function exemplarModel({ m1At = null, b2At = '2026-09-14 14:00:00.000000' } = {}) {
    const mk = (id, position, build, builtAt, approved) => ({
        id, branchId: 'main', position, build, branchNum: 0, major: 6, minor: 2,
        dotColor: null, approvedForRelease: approved,
        createdAt: '2026-09-13 06:31:33.000000', builtAt,
    });
    return {
        branches: [{
            id: 'main', type: 'main', name: 'Main', parentBuildId: null, parentBranchId: null,
            side: 'center', rowOrder: null, major: 6, minor: 2, labelEnd: null,
            buildIds: ['m1', '24-b2'],
        }],
        builds: { m1: mk('m1', 0, 1, m1At, false), '24-b2': mk('24-b2', 1, 2, b2At, true) },
        releaseEvents: {},
        releaseEventDetails: {},
    };
}

function emptyMainModel() {
    return {
        branches: [{
            id: 'main', type: 'main', name: 'Main', parentBuildId: null, parentBranchId: null,
            side: 'center', rowOrder: null, major: 6, minor: 2, labelEnd: null, buildIds: [],
        }],
        builds: {}, releaseEvents: {}, releaseEventDetails: {},
    };
}

const layoutRecord = (id) => computeLayout(currentModel).builds.find(b => b.id === id);

function renderPage() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    // The page resolves external_id → SQL id from the data hook's query cache.
    client.setQueryData(['bv-d3-branches', 'creator-1', 14], [{ id: 24, external_id: 'main' }]);
    client.setQueryData(['bv-d3-builds', 'creator-1', 14, '24'], [
        { id: 38, external_id: 'm1' }, { id: 39, external_id: '24-b2' },
    ]);
    const ui = () => (
        <QueryClientProvider client={client}>
            <AppContext.Provider value={{ darwinBuildVizUri: URI }}>
                <AuthContext.Provider value={{ idToken: 'tok', profile: { id: 'creator-1' } }}>
                    <BuildVisualizerPage />
                </AuthContext.Provider>
            </AppContext.Provider>
        </QueryClientProvider>
    );
    const utils = render(ui());
    return { ...utils, rerenderPage: () => utils.rerender(ui()) };
}

const clickBuild = (id) => act(() => { canvasProps.onBuildClick(layoutRecord(id), { clientX: 40, clientY: 60 }); });
const builtAtInput = () => screen.getByTestId('bv-menu-built-at-input');
const calls = (method, table) => call_rest_api.mock.calls.filter(
    ([url, m]) => m === method && url.split('?')[0] === `${URI}/${table}`);

// HoldCountButton: a quick click is mousedown on the button + mouseup on window.
const pressExecute = () => {
    fireEvent.mouseDown(screen.getByTestId('bv-menu-add-build'), { button: 0 });
    fireEvent.mouseUp(window);
};

beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    localStorage.clear();
    canvasProps = undefined;
    currentModel = exemplarModel();
    call_rest_api.mockReset();
    call_rest_api.mockImplementation(async (url, method) => {
        if (method === 'GET' && url.includes('/branches?project_fk=')) return { data: [{ id: 24 }] };
        if (method === 'GET' && url.includes('/builds?branch_fk=')) {
            return { data: [{ id: 39, external_id: '24-b2' }] };
        }
        if (method === 'POST' && url === `${URI}/branches`) {
            return { httpStatus: { httpStatus: 200 }, data: [{ id: 99 }] };
        }
        return { httpStatus: { httpStatus: 200 }, data: [] };
    });
});

afterEach(() => {
    cleanup();
    vi.useRealTimers();
});

describe('BuildVisualizerPage — build card date line (req #3515)', () => {
    it('shows the Pacific date directly below "Build <version>"', () => {
        renderPage();
        clickBuild('24-b2');
        const title = screen.getByText('Build 6.2.2.0');
        const date = screen.getByTestId('bv-build-built-at');
        expect(date.textContent).toBe('Sep 14 7:00 AM');
        expect(title.nextElementSibling).toBe(date);
        // The row-write audit time is still there, now labelled as such.
        expect(screen.getByText(/^Record created /)).toBeTruthy();
    });

    it('renders no date line (and an empty editor) for a NULL built_at', () => {
        renderPage();
        clickBuild('m1');
        expect(screen.getByText('Build 6.2.1.0')).toBeTruthy();
        expect(screen.queryByTestId('bv-build-built-at')).toBeNull();
        expect(builtAtInput().value).toBe('');
    });

    it('follows the LIVE model: a refetch updates the open card in place', () => {
        const { rerenderPage } = renderPage();
        clickBuild('24-b2');
        expect(builtAtInput().value).toBe('2026-09-14T07:00');
        currentModel = exemplarModel({ b2At: '2026-09-16 02:00:00' });
        rerenderPage();
        expect(screen.getByTestId('bv-build-built-at').textContent).toBe('Sep 15 7:00 PM');
        expect(builtAtInput().value).toBe('2026-09-15T19:00');
    });
});

describe('BuildVisualizerPage — editing built_at from the card (req #3515)', () => {
    it('PUTs the UTC literal to the clicked build\'s SQL row', async () => {
        renderPage();
        clickBuild('24-b2');
        fireEvent.change(builtAtInput(), { target: { value: '2026-09-15T08:30' } });
        fireEvent.blur(builtAtInput());
        await waitFor(() => expect(calls('PUT', 'builds')).toHaveLength(1));
        expect(calls('PUT', 'builds')[0]).toEqual(
            [`${URI}/builds`, 'PUT', [{ id: 39, built_at: '2026-09-15 15:30:00' }], 'tok']);
    });

    it('clearing the field PUTs the "NULL" sentinel', async () => {
        renderPage();
        clickBuild('24-b2');
        fireEvent.change(builtAtInput(), { target: { value: '' } });
        fireEvent.blur(builtAtInput());
        await waitFor(() => expect(calls('PUT', 'builds')).toHaveLength(1));
        expect(calls('PUT', 'builds')[0][2]).toEqual([{ id: 39, built_at: 'NULL' }]);
    });

    it('setting a date on an undated build targets THAT build', async () => {
        renderPage();
        clickBuild('m1');
        fireEvent.change(builtAtInput(), { target: { value: '2026-09-13T23:00' } });
        fireEvent.keyDown(builtAtInput(), { key: 'Enter' });
        await waitFor(() => expect(calls('PUT', 'builds')).toHaveLength(1));
        expect(calls('PUT', 'builds')[0][2]).toEqual([{ id: 38, built_at: '2026-09-14 06:00:00' }]);
    });

    it('an unchanged blur writes nothing', () => {
        renderPage();
        clickBuild('24-b2');
        fireEvent.blur(builtAtInput());
        expect(calls('PUT', 'builds')).toHaveLength(0);
    });
});

describe('BuildVisualizerPage — other build surfaces (req #3515)', () => {
    it('delete-build preview carries the date line under the version', () => {
        renderPage();
        clickBuild('24-b2');
        fireEvent.click(screen.getByTestId('bv-menu-delete-build'));
        const preview = screen.getByTestId('bv-delete-preview');
        const date = within(preview).getByTestId('bv-delete-built-at');
        expect(date.textContent).toBe('Sep 14 7:00 AM');
        expect(within(preview).getByText('6.2.2.0').nextElementSibling).toBe(date);
    });

    it('release datacard shows the date for a dated build and nothing for NULL', () => {
        renderPage();
        act(() => { canvasProps.onReleaseClick(layoutRecord('24-b2'), { clientX: 5, clientY: 5 }, 'Main'); });
        expect(screen.getByTestId('bv-release-card-built-at').textContent).toBe('Sep 14 7:00 AM');
        act(() => { canvasProps.onReleaseClick(layoutRecord('m1'), { clientX: 5, clientY: 5 }, 'Main'); });
        expect(screen.queryByTestId('bv-release-card-built-at')).toBeNull();
    });

    it('perform-release dialog shows the date and the POST stamps released_at', async () => {
        renderPage();
        clickBuild('24-b2');
        fireEvent.click(screen.getByTestId('bv-menu-release-prompt'));
        expect(screen.getByTestId('bv-release-event-built-at').textContent).toBe('Sep 14 7:00 AM');
        fireEvent.click(await screen.findByTestId('bv-release-customer-1'));
        fireEvent.click(screen.getByTestId('bv-release-event-confirm'));
        await waitFor(() => expect(calls('POST', 'customer_releases')).toHaveLength(1));
        expect(calls('POST', 'customer_releases')[0][2]).toEqual(
            { customer_fk: 1, build_fk: 39, released_at: NOW_SQL });
    });
});

describe('BuildVisualizerPage — live events stamp "now" in UTC (req #3515)', () => {
    it('Execute Build stamps built_at on the new build', async () => {
        renderPage();
        clickBuild('24-b2');
        pressExecute();
        await waitFor(() => expect(calls('POST', 'builds')).toHaveLength(1));
        const body = calls('POST', 'builds')[0][2];
        expect(body).toMatchObject({ branch_fk: 24, position: 2, built_at: NOW_SQL });
    });

    it('Execute Build on an EMPTY branch stamps built_at too', async () => {
        currentModel = emptyMainModel();
        renderPage();
        act(() => { canvasProps.onEmptyAnchorClick('main', { clientX: 5, clientY: 5 }); });
        pressExecute();
        await waitFor(() => expect(calls('POST', 'builds')).toHaveLength(1));
        expect(calls('POST', 'builds')[0][2]).toMatchObject({ branch_fk: 24, position: 0, built_at: NOW_SQL });
    });

    it('create branch stamps branched_at on the branch and the SAME instant on its first build', async () => {
        renderPage();
        clickBuild('24-b2');
        fireEvent.click(screen.getByTestId('bv-menu-branch-release'));
        await waitFor(() => expect(calls('POST', 'builds')).toHaveLength(1));
        const branch = calls('POST', 'branches')[0][2];
        const build = calls('POST', 'builds')[0][2];
        expect(branch).toMatchObject({ branch_type: 'release', branched_at: NOW_SQL });
        expect(build).toMatchObject({ branch_fk: 99, position: 0, built_at: NOW_SQL });
    });

    it('stamps are UTC regardless of the viewer\'s zone', async () => {
        // 11:30 PM Pacific on Sep 21 is 06:30 UTC on Sep 22: the stamp is the UTC
        // wall clock, never the local one (package.json runs vitest in Pacific).
        vi.setSystemTime(new Date('2026-09-22T06:30:00.000Z'));
        renderPage();
        clickBuild('24-b2');
        pressExecute();
        await waitFor(() => expect(calls('POST', 'builds')).toHaveLength(1));
        expect(calls('POST', 'builds')[0][2].built_at).toBe('2026-09-22 06:30:00');
    });
});
