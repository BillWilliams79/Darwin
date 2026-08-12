// @vitest-environment jsdom
//
// Req #3428 — the WIRING, which is where this feature's real risk sits.
//
// Everything else about the epic filter is pure and pinned elsewhere. What no
// pure suite can catch is the page assembling it wrongly: a pill that renders in
// a view the filter is not applying to, an aggregator that was supposed to be
// forced visible and is not, a toggle left on screen that no longer does
// anything, or a scope that never reaches the cards. Each of those renders a
// plausible page and reports nothing.
//
// The heavy children are stubs — this asserts what `SwarmView` DECIDES, not what
// a CategoryCard draws (that has its own suite).

import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// The first mounted `it()` in a file absorbs the cold module-compile cost of the
// component tree (react-dnd + MUI + this page), which on a loaded machine is
// measured at 5-8s against vitest's 5000ms default — red in CI about half the
// time, for nothing. File-scoped rather than a global config change, so no other
// suite's timeout moves.
vi.setConfig({ testTimeout: 30000 });

// TWO projects, and the epic's work is in the SECOND — so the tab seed has a
// real decision to make and the working-project assertions below are not
// trivially satisfied by there being nowhere else to go.
const PROJECTS = [
    { id: 7, project_name: 'Personal', sort_order: 0 },
    { id: 1, project_name: 'Darwin', sort_order: 1 },
];
const EPICS = [{ id: 11, title: "Bill's Polish #1" }];
const CATEGORIES = [{ id: 5, project_fk: 1 }];
const SCOPE_REQUIREMENTS = [{ id: 10, feature_fk: 46, category_fk: 5 }];
let epicReqIdsFromHook = new Set([10]);
let scopeReadFails = false;

vi.mock('../../hooks/useDataQueries', () => ({
    useProjects: () => ({ data: PROJECTS }),
    useAllPipeline2Epics: () => ({ data: EPICS }),
    useAllCategories: () => ({ data: CATEGORIES }),
    useEpicRequirementIds: (_creator, epicId) => {
        if (epicId == null) return { epicReqIds: null, isError: false, requirements: undefined };
        if (scopeReadFails) return { epicReqIds: null, isError: true, requirements: undefined };
        return { epicReqIds: epicReqIdsFromHook, isError: false, requirements: SCOPE_REQUIREMENTS };
    },
}));

// Records the props the page hands the tab panel — the aggregator's forced
// visibility and the filter scope are decisions made HERE, so this is where they
// are observable.
let panelProps = [];
vi.mock('../CategoryTabPanel', () => ({
    default: (props) => { panelProps.push(props); return <div data-testid="tab-panel" />; },
}));
vi.mock('../RequirementDragLayer', () => ({ default: () => null }));
vi.mock('../SwarmVisualizerView', () => ({ default: () => null }));
vi.mock('../RequirementsTrendsView', () => ({ default: () => null }));
vi.mock('../VisualizerToolbar', () => ({ default: () => null }));
vi.mock('../RequirementsTableView', () => ({
    default: () => <div data-testid="table-view" />, SWARM_TABLE_WIDTH: 1200,
}));
vi.mock('../../Components/SettingsMenu/SettingsMenu', () => ({ default: () => null }));
vi.mock('../../NavBar/RequirementJumpInput', () => ({ default: () => null }));
vi.mock('../../RestApi/RestApi', () => ({ default: vi.fn(() => Promise.resolve({ httpStatus: { httpStatus: 200 }, data: [] })) }));

import SwarmView from '../SwarmView';
import AuthContext from '../../Context/AuthContext';
import AppContext from '../../Context/AppContext';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useSwarmStartCardStore } from '../../stores/useSwarmStartCardStore';
import { useWorkingProjectStore } from '../../stores/useWorkingProjectStore';
import { SWARM_VIEW_STORAGE_KEY } from '../swarmViewLink';

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
        </MemoryRouter>
    );
};

const lastPanelProps = () => panelProps[panelProps.length - 1];

describe('SwarmView under ?epic= (req #3428)', () => {
    beforeEach(() => {
        panelProps = [];
        epicReqIdsFromHook = new Set([10]);
        scopeReadFails = false;
        localStorage.clear();
        useWorkingProjectStore.setState({ projectId: null, timestamp: null });
        // The aggregator's own persisted preference is OFF — so anything visible
        // below is the filter forcing it, not the store agreeing by accident.
        useSwarmStartCardStore.setState({ show: false });
    });
    afterEach(() => { cleanup(); localStorage.clear(); });

    it('renders the dismissable pill, named after the epic', () => {
        const { getByTestId } = mount('/swarm?view=cards&epic=11');
        expect(getByTestId('swarm-epic-filter-chip').textContent).toContain("Bill's Polish #1");
    });

    it('falls back to the raw id for an epic with no row — not an error state', () => {
        const { getByTestId } = mount('/swarm?view=cards&epic=99999');
        expect(getByTestId('swarm-epic-filter-chip').textContent).toContain('99999');
    });

    it('forces the aggregator visible without touching its stored preference', () => {
        mount('/swarm?view=cards&epic=11');
        expect(lastPanelProps().showSwarmStartCard).toBe(true);
        // THE STORE IS UNTOUCHED — an external condition never overwrites
        // uncommitted user intent, so dismissing the pill restores what was there.
        expect(useSwarmStartCardStore.getState().show).toBe(false);
    });

    it('hands the scope down to the cards', () => {
        mount('/swarm?view=cards&epic=11');
        expect(lastPanelProps().epicReqIds).toBe(epicReqIdsFromHook);
    });

    it('removes the pipeline toggle and the aggregator toggle, because neither '
        + 'would be applying', () => {
        const { queryByTestId } = mount('/swarm?view=cards&epic=11');
        expect(queryByTestId('hide-pipelined-toggle')).toBeNull();
        expect(queryByTestId('swarm-start-card-toggle')).toBeNull();
    });

    it('keeps the status chips, which are orthogonal to epic membership', () => {
        const { queryByTestId } = mount('/swarm?view=cards&epic=11');
        expect(queryByTestId('requirement-status-filter')).not.toBeNull();
    });

    it('dismissing the pill clears the filter and restores every control', () => {
        const { getByTestId, queryByTestId } = mount('/swarm?view=cards&epic=11');
        // MUI puts the ✕ in its own button; clicking it fires `onDelete` alone.
        fireEvent.click(getByTestId('swarm-epic-filter-chip').querySelector('.MuiChip-deleteIcon'));
        expect(queryByTestId('swarm-epic-filter-chip')).toBeNull();
        expect(queryByTestId('hide-pipelined-toggle')).not.toBeNull();
        expect(queryByTestId('swarm-start-card-toggle')).not.toBeNull();
        expect(lastPanelProps().epicReqIds).toBeNull();
        expect(lastPanelProps().showSwarmStartCard).toBe(false);
    });

    it('THE PARAMETER SLEEPS OUTSIDE THE CARDS VIEW: no pill, no scope, controls '
        + 'back — a filter control is on screen exactly when it is applying', () => {
        const { queryByTestId } = mount('/swarm?view=table&epic=11');
        expect(queryByTestId('table-view')).not.toBeNull();
        expect(queryByTestId('swarm-epic-filter-chip')).toBeNull();
        expect(queryByTestId('hide-pipelined-toggle')).not.toBeNull();
    });

    it('with no ?epic= at all, nothing about the page changes', () => {
        const { queryByTestId } = mount('/swarm?view=cards');
        expect(queryByTestId('swarm-epic-filter-chip')).toBeNull();
        expect(queryByTestId('hide-pipelined-toggle')).not.toBeNull();
        expect(queryByTestId('swarm-start-card-toggle')).not.toBeNull();
        expect(lastPanelProps().epicReqIds).toBeNull();
        expect(lastPanelProps().showSwarmStartCard).toBe(false);
    });

    it('an epic link never rewrites the reader\'s stored view preference', () => {
        mount('/swarm?view=cards&epic=11');
        expect(localStorage.getItem(SWARM_VIEW_STORAGE_KEY)).toBeNull();
    });

    it('NEVER RE-HOMES THE READER: the seeded tab is not written to the persisted '
        + 'working project', () => {
        // `darwin_working_project` lives 90 days. Letting the seed through would
        // mean glancing at one epic silently changed where bare `/swarm` opens,
        // for months — the same class of defect as the filter writing the view
        // preference, arrived at through a second effect.
        mount('/swarm?view=cards&epic=11');
        expect(useWorkingProjectStore.getState().projectId).toBeNull();
        // Read the PERSISTED value, not the key's existence: zustand's `persist`
        // writes the whole state on any change, so the reset in `beforeEach`
        // creates the key by itself.
        expect(JSON.parse(localStorage.getItem('darwin_working_project')).state.projectId)
            .toBeNull();
    });

    it('with no filter, the working project is persisted exactly as before', () => {
        mount('/swarm?view=cards');
        expect(useWorkingProjectStore.getState().projectId).not.toBeNull();
    });

    it('A FAILED MEMBERSHIP READ SHOWS EVERYTHING AND SAYS SO — it must never '
        + 'render as "this epic has no work"', () => {
        scopeReadFails = true;
        const { getByTestId, queryByTestId } = mount('/swarm?view=cards&epic=11');
        const chip = getByTestId('swarm-epic-filter-chip');
        expect(chip.textContent).toContain('unavailable');
        // Nothing is filtered, so every control the filter overrides comes back.
        expect(lastPanelProps().epicReqIds).toBeNull();
        expect(lastPanelProps().showSwarmStartCard).toBe(false);
        expect(queryByTestId('hide-pipelined-toggle')).not.toBeNull();
        expect(queryByTestId('swarm-start-card-toggle')).not.toBeNull();
    });
});
