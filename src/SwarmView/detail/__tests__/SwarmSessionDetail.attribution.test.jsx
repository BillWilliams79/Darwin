// @vitest-environment jsdom
//
// Req #3186 — the Pipeline / Epic attribution rows on the swarm session detail
// page.
//
// The point of the two columns is that a session's pipeline and epic are read
// FROM THE SESSION ROW, not walked. So the assertions that matter are:
//   - a stamped session renders both rows, with the title resolved from the
//     cached pipelines / epics lists
//   - the Pipeline chip navigates to that pipeline's detail route
//   - an UNSTAMPED session renders NEITHER row — NULL means "no plan context",
//     a real answer, and an em-dash row for it would be noise on every ad-hoc
//     session
//   - a stamped id whose title is not in the list still renders the row, falling
//     back to the bare id rather than disappearing

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const navigations = [];
vi.mock('react-router-dom', () => ({
    useParams: () => ({ id: '500' }),
    useNavigate: () => (to) => navigations.push(to),
    useLocation: () => ({ key: 'default', state: {} }),
}));

const PIPELINES = [
    { id: 2, title: 'Darwin', pipeline_status: 'active' },
    { id: 3, title: 'Retired plan', pipeline_status: 'aborted' },
];
const PIPELINES2 = [{ id: 7, title: '2.0 plan' }];
const EPICS = [{ id: 34, title: 'Swarm Orchestration' }];
const EPICS2 = [{ id: 12, title: '2.0 Epic' }];

let sessionRow;

vi.mock('../../../hooks/useDataQueries', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        useSession: () => ({ data: sessionRow, isLoading: false }),
        useDevServersBySession: () => ({ data: [] }),
        useMachines: () => ({ data: [] }),
        useAllSwarmStartSessions: () => ({ data: [] }),
        useAllSwarmStarts: () => ({ data: [] }),
        useAllSwarmCompleteSessions: () => ({ data: [] }),
        useAllSwarmCompletes: () => ({ data: [] }),
        useAllRequirements: () => ({ data: [] }),
        useAllPipelines: () => ({ data: PIPELINES }),
        useAllPipelines2: () => ({ data: PIPELINES2 }),
        useAllEpics: () => ({ data: EPICS }),
        useAllPipeline2Epics: () => ({ data: EPICS2 }),
    };
});

vi.mock('../../../RestApi/RestApi', () => ({
    default: vi.fn(() => Promise.resolve({ httpStatus: { httpStatus: 200 }, data: [] })),
}));

import SwarmSessionDetail from '../SwarmSessionDetail';
import AuthContext from '../../../Context/AuthContext';
import AppContext from '../../../Context/AppContext';

let mountedRoots = [];

function mount() {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false, staleTime: 0, gcTime: 0, refetchOnWindowFocus: false } },
    });
    const root = createRoot(container);
    act(() => {
        root.render(
            <QueryClientProvider client={queryClient}>
                <AppContext.Provider value={{ darwinUri: 'http://test.local' }}>
                    <AuthContext.Provider value={{ idToken: 'tok', profile: { userName: 'tester', timezone: 'UTC' } }}>
                        <SwarmSessionDetail />
                    </AuthContext.Provider>
                </AppContext.Provider>
            </QueryClientProvider>
        );
    });
    mountedRoots.push(root);
    return { container };
}

function baseSession(overrides = {}) {
    return {
        id: 500,
        title: 'a session',
        task_name: 'do-a-thing',
        branch: 'feature/3186-x',
        swarm_status: 'completed',
        ai_model: 'opus',
        effort: 'medium',
        instrumented: 1,
        pipeline_fk: null,
        epic_fk: null,
        pipeline2_fk: null,
        epic2_fk: null,
        machine_fk: null,
        source_ref: null,
        ...overrides,
    };
}

const node = (container, testId) => container.querySelector(`[data-testid="${testId}"]`);

describe('SwarmSessionDetail orchestration attribution (req #3186)', () => {
    beforeEach(() => {
        navigations.length = 0;
        mountedRoots = [];
        sessionRow = baseSession();
    });

    afterEach(() => {
        act(() => { mountedRoots.forEach(r => r.unmount()); });
        document.body.innerHTML = '';
    });

    it('renders neither row when the session carries no attribution', () => {
        const { container } = mount();
        expect(node(container, 'session-pipeline')).toBeNull();
        expect(node(container, 'session-epic')).toBeNull();
    });

    it('renders both rows with titles resolved from the cached lists', () => {
        sessionRow = baseSession({ pipeline_fk: 2, epic_fk: 34 });
        const { container } = mount();

        const pipeline = node(container, 'session-pipeline');
        expect(pipeline).not.toBeNull();
        expect(pipeline.textContent).toContain('#2');
        expect(pipeline.textContent).toContain('Darwin');

        const epic = node(container, 'session-epic');
        expect(epic).not.toBeNull();
        expect(epic.textContent).toContain('#34');
        expect(epic.textContent).toContain('Swarm Orchestration');
    });

    it('navigates to the pipeline detail route when the chip is clicked', () => {
        sessionRow = baseSession({ pipeline_fk: 3 });
        const { container } = mount();
        act(() => {
            node(container, 'session-pipeline-chip').click();
        });
        expect(navigations).toContain('/swarm/pipeline/3');
    });

    it('still renders the row when the id is not in the cached list', () => {
        // A pipeline closed/deleted since the stamp, or a list read that has not
        // landed yet. The attribution is a fact on the row and must not vanish
        // because a LABEL could not be resolved.
        sessionRow = baseSession({ pipeline_fk: 99, epic_fk: 98 });
        const { container } = mount();
        expect(node(container, 'session-pipeline').textContent).toContain('#99');
        expect(node(container, 'session-epic').textContent).toContain('#98');
    });

    // req #3433 — a session seated on a Pipeline 2.0 step stamps
    // pipeline2_fk/epic2_fk with the 1.0 pair NULL. Before this fix the Epic
    // row gated on `epic_fk` alone and went silently blank for these sessions,
    // and even after fixing that gate the Pipeline row's own title text was
    // still resolved against the 1.0 `pipelines` list only — a bare `#7` with
    // no name (caught in code review). Both rows must carry a title.
    it('renders both rows, with titles, for a 2.0-attributed session', () => {
        sessionRow = baseSession({ pipeline2_fk: 7, epic2_fk: 12 });
        const { container } = mount();

        const pipeline = node(container, 'session-pipeline');
        expect(pipeline).not.toBeNull();
        expect(pipeline.textContent).toContain('#7');
        expect(pipeline.textContent).toContain('2.0 plan');

        const epic = node(container, 'session-epic');
        expect(epic).not.toBeNull();
        expect(epic.textContent).toContain('#12');
        expect(epic.textContent).toContain('2.0 Epic');
    });

    // Both columns stamped is a data defect (the two eras are supposed to be
    // exclusive), but the two rows must still describe ONE plan rather than
    // the Pipeline row picking 1.0 and an independently-resolved Epic row
    // picking 2.0 for the same session.
    it('picks one era for both rows when a row carries both eras', () => {
        sessionRow = baseSession({ pipeline_fk: 2, epic_fk: 34, pipeline2_fk: 7, epic2_fk: 12 });
        const { container } = mount();

        expect(node(container, 'session-pipeline').textContent).toContain('Darwin');
        const epic = node(container, 'session-epic');
        expect(epic.textContent).toContain('#34');
        expect(epic.textContent).toContain('Swarm Orchestration');
        expect(epic.textContent).not.toContain('#12');
    });

    // A MIXED partial stamp — pipeline resolved to one era, epic column set
    // only on the OTHER era — is the more likely real shape than a fully
    // dual-stamped row (`update_swarm_session` corrects one column at a
    // time). The Epic row must follow the Pipeline row's era rather than
    // showing a stray epic from a different plan (caught in code review).
    it('does not show a stray other-era epic when only the pipeline side is mixed', () => {
        sessionRow = baseSession({ pipeline2_fk: 7, epic_fk: 34 });
        const { container } = mount();
        expect(node(container, 'session-pipeline').textContent).toContain('2.0 plan');
        expect(node(container, 'session-epic')).toBeNull();
    });

    it('does not show a stray other-era epic when only the epic side is mixed', () => {
        sessionRow = baseSession({ pipeline_fk: 2, epic2_fk: 12 });
        const { container } = mount();
        expect(node(container, 'session-pipeline').textContent).toContain('Darwin');
        expect(node(container, 'session-epic')).toBeNull();
    });

    // A session can carry an epic attribution with no pipeline (a manual
    // correction via update_swarm_session, or a partial stamp) — that used to
    // render before this requirement's fix and must keep rendering.
    it('still renders the Epic row when only the epic column is stamped', () => {
        sessionRow = baseSession({ epic_fk: 34 });
        const { container } = mount();
        expect(node(container, 'session-pipeline')).toBeNull();
        expect(node(container, 'session-epic').textContent).toContain('#34');
    });
});
