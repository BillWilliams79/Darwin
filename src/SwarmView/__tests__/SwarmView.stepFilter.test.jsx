// @vitest-environment jsdom
//
// Req #3503 — the WIRING of the `?step=` filter, which is where its real risk
// sits, exactly as `SwarmView.epicFilter.test.jsx` says of its own.
//
// The pure rules are pinned in `swarmViewLink.stepParam.test.js` and
// `utils/__tests__/pipelineMembership.test.js`. What no pure suite can catch is
// the page assembling this wrongly: a pill rendered in a view the filter is not
// applying to, a scope that never reaches the cards, a toggle left on screen
// that no longer does anything — each of which renders a plausible page and
// reports nothing.
//
// The last describe is the one that exists ONLY because there are two filters:
// they are independent, so neither may suppress or rewrite the other.

import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// See the epic suite's note: the first mounted `it()` absorbs the cold
// module-compile cost of react-dnd + MUI + this page.
vi.setConfig({ testTimeout: 30000 });

// TWO projects, and the step's work is in the SECOND — so the tab seed has a
// real decision to make.
const PROJECTS = [
    { id: 7, project_name: 'Personal', sort_order: 0 },
    { id: 1, project_name: 'Darwin', sort_order: 1 },
];
// The step's own category sits under project 1 ('Darwin'); the epic's own
// (req #3503 review's tab-seed-race describe, below) sits under project 7
// ('Personal') — two DIFFERENT tabs, so a test asserting which one gets
// seeded actually exercises a choice rather than two paths that happen to
// agree.
const CATEGORIES = [{ id: 5, project_fk: 1 }, { id: 6, project_fk: 7 }];
const SCOPE_REQUIREMENTS = [{ id: 3503, category_fk: 5 }];
const EPIC_SCOPE_REQUIREMENTS = [{ id: 9001, category_fk: 6 }];
// `pipeline_steps` as the pill's `id,title` projection returns them. Step 187
// carries the EMPTY STRING, which is legal in a NOT NULL VARCHAR and is the case
// the `||` fallback exists for.
const STEPS = [
    { id: 186, title: 'Second-click zoom' },
    { id: 187, title: '' },
];
const EMPTY_EPICS = [];
let stepReqIdsFromHook = new Set([3503]);
let scopeReadFails = false;
// INACTIVE (null) by default — every describe block but the last one asserts
// the step filter alone and never sets this, so it keeps behaving exactly as
// the old hardcoded-inactive mock did for them.
let epicReqIdsFromHook = null;

vi.mock('../../hooks/useDataQueries', () => ({
    useProjects: () => ({ data: PROJECTS }),
    useAllEpics: () => ({ data: EMPTY_EPICS }),
    useAllCategories: () => ({ data: CATEGORIES }),
    useAllPipelineSteps: () => ({ data: STEPS }),
    useEpicRequirementIds: (_creator, epicId) => {
        if (epicId == null || epicReqIdsFromHook == null) {
            return { epicReqIds: null, isError: false, requirements: undefined };
        }
        return { epicReqIds: epicReqIdsFromHook, isError: false, requirements: EPIC_SCOPE_REQUIREMENTS };
    },
    useStepRequirementIds: (_creator, stepId) => {
        if (stepId == null) return { stepReqIds: null, isError: false, requirements: undefined };
        if (scopeReadFails) return { stepReqIds: null, isError: true, requirements: undefined };
        return { stepReqIds: stepReqIdsFromHook, isError: false, requirements: SCOPE_REQUIREMENTS };
    },
}));

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

describe('SwarmView under ?step= (req #3503)', () => {
    beforeEach(() => {
        panelProps = [];
        stepReqIdsFromHook = new Set([3503]);
        scopeReadFails = false;
        localStorage.clear();
        useWorkingProjectStore.setState({ projectId: null, timestamp: null });
        useSwarmStartCardStore.setState({ show: false });
    });
    afterEach(() => { cleanup(); localStorage.clear(); });

    it('renders the dismissable pill, named after the step', () => {
        const { getByTestId } = mount('/swarm?view=cards&step=186');
        expect(getByTestId('swarm-step-filter-chip').textContent).toContain('Second-click zoom');
    });

    it('falls back to the raw id for a step with no row — not an error state', () => {
        const { getByTestId } = mount('/swarm?view=cards&step=99999');
        expect(getByTestId('swarm-step-filter-chip').textContent).toContain('99999');
    });

    it('falls back to the raw id for a step whose title is the EMPTY STRING', () => {
        // `pipeline_steps.title` is NOT NULL but routinely blank — a step named by
        // its requirements alone. `Step: ` with nothing after it names nothing.
        const { getByTestId } = mount('/swarm?view=cards&step=187');
        expect(getByTestId('swarm-step-filter-chip').textContent).toContain('187');
    });

    it('forces the aggregator visible without touching its stored preference', () => {
        mount('/swarm?view=cards&step=186');
        expect(lastPanelProps().showSwarmStartCard).toBe(true);
        expect(useSwarmStartCardStore.getState().show).toBe(false);
    });

    it('hands the scope down to the cards', () => {
        mount('/swarm?view=cards&step=186');
        expect(lastPanelProps().stepReqIds).toBe(stepReqIdsFromHook);
    });

    it('removes the pipeline toggle and the aggregator toggle, because neither '
        + 'would be applying', () => {
        // The pipeline toggle is FORCED OFF under this filter (a step's
        // requirements are on a step by definition), so leaving it on screen
        // would show an ON control whose stored value says the opposite of what
        // the reader sees.
        const { queryByTestId } = mount('/swarm?view=cards&step=186');
        expect(queryByTestId('hide-pipelined-toggle')).toBeNull();
        expect(queryByTestId('swarm-start-card-toggle')).toBeNull();
    });

    it('keeps the status chips, which are orthogonal to step membership', () => {
        const { queryByTestId } = mount('/swarm?view=cards&step=186');
        expect(queryByTestId('requirement-status-filter')).not.toBeNull();
    });

    it('dismissing the pill clears the filter and restores every control', () => {
        const { getByTestId, queryByTestId } = mount('/swarm?view=cards&step=186');
        fireEvent.click(getByTestId('swarm-step-filter-chip').querySelector('.MuiChip-deleteIcon'));
        expect(queryByTestId('swarm-step-filter-chip')).toBeNull();
        expect(queryByTestId('hide-pipelined-toggle')).not.toBeNull();
        expect(queryByTestId('swarm-start-card-toggle')).not.toBeNull();
        expect(lastPanelProps().stepReqIds).toBeNull();
        expect(lastPanelProps().showSwarmStartCard).toBe(false);
    });

    it('dismissing the pill returns to the READER\'S OWN project, not wherever '
        + 'the filter seeded (user report: "goes somewhere random")', () => {
        // The reader was working in 'Personal' (project 7, tab 0) before ever
        // following the step link. The step's own work seeds tab 1 ('Darwin')
        // while the filter is engaged — expected, covered by the epic/step
        // tab-seed tests elsewhere. What THIS pins is what happens AFTER: the
        // seed effect moved `activeTab`, but the "persist to localStorage"
        // effect stands down for as long as a filter is engaged, so the
        // STORED preference never changed — dismissing must read it back
        // rather than leaving the seeded tab standing now that nothing
        // justifies it.
        useWorkingProjectStore.setState({ projectId: '7', timestamp: Date.now() });
        const { getByTestId } = mount('/swarm?view=cards&step=186');
        expect(lastPanelProps().activeTab).toBe(1);   // seeded to 'Darwin' while engaged
        fireEvent.click(getByTestId('swarm-step-filter-chip').querySelector('.MuiChip-deleteIcon'));
        expect(lastPanelProps().activeTab).toBe(0);   // back to 'Personal', the reader's own
    });

    it('THE PARAMETER SLEEPS OUTSIDE THE CARDS VIEW: no pill, no scope, controls '
        + 'back — a filter control is on screen exactly when it is applying', () => {
        const { queryByTestId } = mount('/swarm?view=table&step=186');
        expect(queryByTestId('table-view')).not.toBeNull();
        expect(queryByTestId('swarm-step-filter-chip')).toBeNull();
        expect(queryByTestId('hide-pipelined-toggle')).not.toBeNull();
    });

    it('with no ?step= at all, nothing about the page changes', () => {
        const { queryByTestId } = mount('/swarm?view=cards');
        expect(queryByTestId('swarm-step-filter-chip')).toBeNull();
        expect(queryByTestId('hide-pipelined-toggle')).not.toBeNull();
        expect(queryByTestId('swarm-start-card-toggle')).not.toBeNull();
        expect(lastPanelProps().stepReqIds).toBeNull();
        expect(lastPanelProps().showSwarmStartCard).toBe(false);
    });

    it('a step link never rewrites the reader\'s stored view preference', () => {
        mount('/swarm?view=cards&step=186');
        expect(localStorage.getItem(SWARM_VIEW_STORAGE_KEY)).toBeNull();
    });

    it('NEVER RE-HOMES THE READER: the seeded tab is not written to the persisted '
        + 'working project', () => {
        // `darwin_working_project` lives 90 days. A step scope is narrower than an
        // epic one, so its seeded tab is even less a statement about where this
        // reader works.
        mount('/swarm?view=cards&step=186');
        expect(useWorkingProjectStore.getState().projectId).toBeNull();
        expect(JSON.parse(localStorage.getItem('darwin_working_project')).state.projectId)
            .toBeNull();
    });

    it('A FAILED MEMBERSHIP READ SHOWS EVERYTHING AND SAYS SO — it must never '
        + 'render as "this step has no work"', () => {
        scopeReadFails = true;
        const { getByTestId, queryByTestId } = mount('/swarm?view=cards&step=186');
        expect(getByTestId('swarm-step-filter-chip').textContent).toContain('unavailable');
        expect(lastPanelProps().stepReqIds).toBeNull();
        expect(lastPanelProps().showSwarmStartCard).toBe(false);
        expect(queryByTestId('hide-pipelined-toggle')).not.toBeNull();
        expect(queryByTestId('swarm-start-card-toggle')).not.toBeNull();
    });
});

describe('the step filter and the epic filter are INDEPENDENT (req #3503)', () => {
    beforeEach(() => {
        panelProps = [];
        stepReqIdsFromHook = new Set([3503]);
        scopeReadFails = false;
        localStorage.clear();
        useWorkingProjectStore.setState({ projectId: null, timestamp: null });
        useSwarmStartCardStore.setState({ show: false });
    });
    afterEach(() => { cleanup(); localStorage.clear(); });

    it('an ?epic= in the address bar does not suppress the step pill or its scope', () => {
        // The epic hook is stubbed inactive here, so this asserts the STEP half
        // survives an epic parameter being present — the two are separate
        // conditions, never two values of one.
        const { getByTestId } = mount('/swarm?view=cards&epic=11&step=186');
        expect(getByTestId('swarm-step-filter-chip')).not.toBeNull();
        expect(lastPanelProps().stepReqIds).toBe(stepReqIdsFromHook);
    });

    it('dismissing the step pill leaves ?epic= in the address bar', () => {
        // `withoutStepParam` touches `step` alone; this pins that the PAGE calls
        // it that way rather than rebuilding the query string.
        const { getByTestId, queryByTestId } = mount('/swarm?view=cards&epic=11&step=186');
        fireEvent.click(getByTestId('swarm-step-filter-chip').querySelector('.MuiChip-deleteIcon'));
        expect(queryByTestId('swarm-step-filter-chip')).toBeNull();
        // The epic pill renders off `epicFilterApplies`, which is still true —
        // so its presence IS the surviving parameter, observed on screen.
        expect(queryByTestId('swarm-epic-filter-chip')).not.toBeNull();
    });
});

describe('both filters engaged at once seed ONE tab deterministically (req #3503 review)', () => {
    // Code review finding: the epic and step tab-seed effects each guarded
    // only against RE-seeding their OWN scope, so with both engaged they
    // raced on whichever membership read resolved second rather than on
    // which the reader actually followed — an epic link and a step link can
    // both sit in the address bar (the "INDEPENDENT" describe block above is
    // exactly why), and here their candidate tabs genuinely disagree: the
    // step's own work is under project 1 ('Darwin'), the epic's under
    // project 7 ('Personal').
    beforeEach(() => {
        panelProps = [];
        stepReqIdsFromHook = new Set([3503]);
        epicReqIdsFromHook = new Set([9001]);
        scopeReadFails = false;
        localStorage.clear();
        useWorkingProjectStore.setState({ projectId: null, timestamp: null });
        useSwarmStartCardStore.setState({ show: false });
    });
    afterEach(() => {
        cleanup();
        localStorage.clear();
        epicReqIdsFromHook = null;   // back to every other describe block's default
    });

    it('the STEP scope wins — the narrower, more specific link', () => {
        mount('/swarm?view=cards&epic=11&step=186');
        // The step's project ('Darwin', index 1) must win over the epic's
        // ('Personal', index 0) — never a THIRD outcome (e.g. the seed effects
        // cancelling out and leaving `activeTab` at its own initial 0, which
        // would misreport as "the epic won" purely by coincidence).
        expect(lastPanelProps().activeTab).toBe(1);
        expect(lastPanelProps().stepReqIds).toBe(stepReqIdsFromHook);
        expect(lastPanelProps().epicReqIds).toBe(epicReqIdsFromHook);
    });
});
