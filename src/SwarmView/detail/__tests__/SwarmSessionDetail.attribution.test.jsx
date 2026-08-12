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
//
// req #3356 — PIPELINE 1.0 IS ERADICATED, so the page reads `pipeline2_fk` /
// `epic2_fk` and nothing else. The era-arbitration cases below (which were the
// bulk of req #3433's coverage) invert rather than disappear: a 1.0-only stamp
// is a HISTORICAL row whose plan has no page, and the page must show NOTHING
// for it rather than bridging its id onto the 2.0 route — the id spaces are
// disjoint, so that link opens a different plan (req #3462, measured).

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

// ONE ERA'S LISTS. The 1.0 `PIPELINES`/`EPICS` fixtures went with the hooks
// that served them (req #3356); ids 2/3/34 survive below only as 1.0 stamps the
// page must now IGNORE.
const PIPELINES2 = [{ id: 7, title: '2.0 plan' }];
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
        useAllPipelines2: () => ({ data: PIPELINES2 }),
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

    it('navigates to the pipeline detail route when the chip is clicked', () => {
        sessionRow = baseSession({ pipeline2_fk: 7 });
        const { container } = mount();
        act(() => {
            node(container, 'session-pipeline-chip').click();
        });
        expect(navigations).toContain('/swarm/pipeline2/7');
    });

    it('still renders the row when the id is not in the cached list', () => {
        // A pipeline closed/deleted since the stamp, or a list read that has not
        // landed yet. The attribution is a fact on the row and must not vanish
        // because a LABEL could not be resolved.
        sessionRow = baseSession({ pipeline2_fk: 99, epic2_fk: 98 });
        const { container } = mount();
        expect(node(container, 'session-pipeline').textContent).toContain('#99');
        expect(node(container, 'session-epic').textContent).toContain('#98');
    });

    // req #3356 — A 1.0-ONLY STAMP RENDERS NOTHING, and the 1.0 id must not
    // appear anywhere. This is the inverse of req #3433's case and it is the
    // one that matters now: showing `#2` under a page that can only open 2.0
    // plans, or bridging 2 onto `/swarm/pipeline2/2`, names a DIFFERENT plan.
    it('renders neither row for a 1.0-only session, and leaks no 1.0 id', () => {
        sessionRow = baseSession({ pipeline_fk: 2, epic_fk: 34 });
        const { container } = mount();
        expect(node(container, 'session-pipeline')).toBeNull();
        expect(node(container, 'session-epic')).toBeNull();
        expect(container.textContent).not.toContain('#2');
        expect(container.textContent).not.toContain('#34');
    });

    // Both columns stamped is a data defect (the two eras were supposed to be
    // exclusive). With one era left the arbitration is trivial, but the OUTCOME
    // still has to be checked: the 1.0 ids must not surface beside the 2.0 ones.
    it('takes the 2.0 columns when a defective row carries both eras', () => {
        sessionRow = baseSession({ pipeline_fk: 2, epic_fk: 34, pipeline2_fk: 7, epic2_fk: 12 });
        const { container } = mount();

        expect(node(container, 'session-pipeline').textContent).toContain('2.0 plan');
        expect(node(container, 'session-epic').textContent).toContain('#12');
        expect(container.textContent).not.toContain('#34');
    });

    // A MIXED partial stamp — pipeline on one era, epic column set only on the
    // OTHER — is the likelier real shape than a fully dual-stamped row
    // (`update_swarm_session` corrects one column at a time). Neither half of a
    // 1.0 stamp may render.
    it('ignores a 1.0 epic beside a 2.0 pipeline', () => {
        sessionRow = baseSession({ pipeline2_fk: 7, epic_fk: 34 });
        const { container } = mount();
        expect(node(container, 'session-pipeline').textContent).toContain('2.0 plan');
        expect(node(container, 'session-epic')).toBeNull();
    });

    it('ignores a 1.0 pipeline beside a 2.0 epic', () => {
        sessionRow = baseSession({ pipeline_fk: 2, epic2_fk: 12 });
        const { container } = mount();
        expect(node(container, 'session-pipeline')).toBeNull();
        expect(node(container, 'session-epic').textContent).toContain('#12');
    });

    // A session can carry an epic attribution with no pipeline (a manual
    // correction via update_swarm_session, or a partial stamp). The Epic row is
    // INDEPENDENT of the Pipeline row's presence and must keep rendering — that
    // survived req #3356 unchanged, only the column it reads moved.
    it('still renders the Epic row when only the epic column is stamped', () => {
        sessionRow = baseSession({ epic2_fk: 12 });
        const { container } = mount();
        expect(node(container, 'session-pipeline')).toBeNull();
        expect(node(container, 'session-epic').textContent).toContain('#12');
    });
});
