// @vitest-environment jsdom
//
// req #3793 — the Swarm visualizer's full screen switch, through the REAL page
// header and the REAL visualizer toolbar. The user's rule: a visualizer whose
// controls are on screen keeps the switch in the title row — since req #4062,
// in the page header just left of the Req# jump input. Maximized, the page becomes the fixed full-window layer over the
// navbar, the header row STAYS (so the switch never moves), and the visualizer
// is told to fill it. The switch exists only in the Visualizer view. The full
// screen mechanics (browser full screen, Esc, the rack) are the shared hook's,
// pinned in `PipelinePlanVisualizer.maximize.test.jsx`; this pins the wiring.
//
// The mount scaffolding is `SwarmView.epicFilter`'s; the visualizer itself is
// a stub that reports the `maximized` it was handed.

import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
// The first mounted `it()` absorbs the cold module-compile cost of dnd-kit +
// MUI + this page (the epicFilter suite's note).
vi.setConfig({ testTimeout: 30000 });

const PROJECTS = [{ id: 1, project_name: 'Darwin', sort_order: 0 }];

vi.mock('../../hooks/useDataQueries', () => ({
    useProjects: () => ({ data: PROJECTS }),
    useAllInitiatives: () => ({ data: [] }),
    useAllCategories: () => ({ data: [] }),
    useAllPipelineEpics: () => ({ data: [] }),
    useInitiativeRequirementIds: () => ({ initiativeReqIds: null, isError: false, requirements: undefined }),
    useEpicRequirementIds: () => ({ epicReqIds: null, isError: false, requirements: undefined }),
}));

vi.mock('../CategoryTabPanel', () => ({ default: () => <div data-testid="tab-panel" /> }));
vi.mock('../SwarmVisualizerView', () => ({
    default: ({ maximized }) => (
        <div data-testid="swarm-visualizer-stub" data-maximized={String(!!maximized)} />
    ),
}));
vi.mock('../RequirementsTrendsView', () => ({ default: () => null }));
vi.mock('../RequirementsTableView', () => ({
    default: () => <div data-testid="table-view" />, SWARM_TABLE_WIDTH: 1200,
}));
vi.mock('../../Components/SettingsMenu/SettingsMenu', () => ({ default: () => null }));
vi.mock('../../NavBar/RequirementJumpInput', () => ({ default: () => <div data-testid="req-jump-stub" /> }));
vi.mock('../../RestApi/RestApi', () => ({ default: vi.fn(() => Promise.resolve({ httpStatus: { httpStatus: 200 }, data: [] })) }));

import SwarmView from '../SwarmView';
import AuthContext from '../../Context/AuthContext';
import AppContext from '../../Context/AppContext';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { usePanelRackStore } from '../../stores/usePanelRackStore';

const mount = (entry) => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
        <MemoryRouter initialEntries={[entry]}>
            <QueryClientProvider client={queryClient}>
                <AppContext.Provider value={{ darwinUri: 'http://test.local' }}>
                    <AuthContext.Provider value={{ idToken: 'tok', profile: { userName: 'tester', timezone: 'UTC' } }}>
                        <SwarmView />
                    </AuthContext.Provider>
                </AppContext.Provider>
            </QueryClientProvider>
        </MemoryRouter>,
    );
};

describe('Swarm visualizer — the full screen switch (req #3793)', () => {
    beforeEach(() => { localStorage.clear(); });
    afterEach(() => {
        cleanup();
        localStorage.clear();
        document.documentElement.style.overflow = '';
    });

    it('sits in the header row, immediately left of the Req# jump', () => {
        const { getByTestId, getAllByTestId, getByText } = mount('/swarm?view=visualizer');
        const sw = getByTestId('swarm-viz-fullscreen');
        expect(getAllByTestId('swarm-viz-fullscreen')).toHaveLength(1);
        expect(getByTestId('swarm-view-toggle-row').contains(sw)).toBe(true);
        // req #4062 — right after the view toggle, i.e. left of the Req# jump (stubbed here).
        expect(sw.previousElementSibling).toBe(getByTestId('swarm-view-toggle'));
        expect(sw.nextElementSibling).toBe(getByTestId('req-jump-stub'));
        expect(sw.getAttribute('aria-pressed')).toBe('false');
        expect(sw.getAttribute('aria-label')).toBe('Full screen — only the swarm visualizer');
        expect(getByTestId('swarm-view-page').getAttribute('data-maximized')).toBe('false');
    });

    it('is not offered outside the Visualizer view', () => {
        const { queryByTestId } = mount('/swarm?view=table');
        expect(queryByTestId('swarm-viz-fullscreen')).toBeNull();
    });

    it('maximizes the page over the navbar, the header (and the switch) staying on screen', () => {
        const { getByTestId } = mount('/swarm?view=visualizer');
        act(() => { fireEvent.click(getByTestId('swarm-viz-fullscreen')); });
        const pageEl = getByTestId('swarm-view-page');
        expect(pageEl.getAttribute('data-maximized')).toBe('true');
        const cs = getComputedStyle(pageEl);
        expect(cs.position).toBe('fixed');
        expect(cs.zIndex).toBe('1250');
        expect(cs.display).toBe('flex');
        const sw = getByTestId('swarm-viz-fullscreen');
        expect(getByTestId('swarm-view-toggle-row').contains(sw)).toBe(true);
        expect(sw.getAttribute('aria-pressed')).toBe('true');
        expect(sw.getAttribute('aria-label')).toBe('Leave full screen');
        // The visualizer is told to fill the layer.
        expect(getByTestId('swarm-visualizer-stub').getAttribute('data-maximized')).toBe('true');
        expect(usePanelRackStore.getState().covered).toBe(true);
        act(() => { fireEvent.click(sw); });
        expect(pageEl.getAttribute('data-maximized')).toBe('false');
        expect(getByTestId('swarm-visualizer-stub').getAttribute('data-maximized')).toBe('false');
        expect(usePanelRackStore.getState().covered).toBe(false);
    });

    it('Esc leaves', () => {
        vi.useFakeTimers();
        try {
            const { getByTestId } = mount('/swarm?view=visualizer');
            act(() => { fireEvent.click(getByTestId('swarm-viz-fullscreen')); });
            expect(getByTestId('swarm-view-page').getAttribute('data-maximized')).toBe('true');
            act(() => {
                window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
                vi.runAllTimers();
            });
            expect(getByTestId('swarm-view-page').getAttribute('data-maximized')).toBe('false');
        } finally { vi.useRealTimers(); }
    });

    it('Esc in a text field stays the field\'s', () => {
        vi.useFakeTimers();
        try {
            const { getByTestId } = mount('/swarm?view=visualizer');
            act(() => { fireEvent.click(getByTestId('swarm-viz-fullscreen')); });
            const input = document.createElement('input');
            getByTestId('swarm-view-toggle-row').appendChild(input);
            act(() => {
                input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
                vi.runAllTimers();
            });
            expect(getByTestId('swarm-view-page').getAttribute('data-maximized')).toBe('true');
            input.remove();
        } finally { vi.useRealTimers(); }
    });

    it('a switch to another view releases it', () => {
        const { getByTestId } = mount('/swarm?view=visualizer');
        act(() => { fireEvent.click(getByTestId('swarm-viz-fullscreen')); });
        expect(getByTestId('swarm-view-page').getAttribute('data-maximized')).toBe('true');
        act(() => { fireEvent.click(getByTestId('view-toggle-table')); });
        expect(getByTestId('swarm-view-page').getAttribute('data-maximized')).toBe('false');
    });
});

// req #3961 — the header row is the TITLE BAR of all four requirements views:
// the Action Popups lock into it (titleBarLock.js), whichever view is showing.
describe('Requirements views — the header row is the title bar (req #3961)', () => {
    beforeEach(() => { localStorage.clear(); });
    afterEach(() => { cleanup(); localStorage.clear(); });

    it.each(['cards', 'table', 'visualizer', 'trends'])('%s view: the one title bar is its header row', (view) => {
        const { getByTestId, container } = mount(`/swarm?view=${view}`);
        const row = getByTestId('swarm-view-toggle-row');
        expect(row.hasAttribute('data-title-bar')).toBe(true);
        // One per page: a second would never be a drop zone.
        expect(container.querySelectorAll('[data-title-bar]')).toHaveLength(1);
        expect(getByTestId(`view-toggle-${view}`).getAttribute('aria-pressed')).toBe('true');
    });
});
