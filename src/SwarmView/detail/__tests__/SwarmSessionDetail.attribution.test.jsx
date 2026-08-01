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
const EPICS = [{ id: 34, title: 'Swarm Orchestration' }];

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
        useAllEpics: () => ({ data: EPICS }),
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
});
