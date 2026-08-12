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
// req #3356 — PIPELINE 1.0 IS ERADICATED. `swarm_sessions` carried TWO
// attribution pairs while the eras ran side by side; migration 20260812184333
// dropped the older pair and renamed the survivor into `pipeline_fk`/`epic_fk`,
// so there is now exactly ONE pair and the page reads it.
//
// FOUR ERA-ARBITRATION CASES WERE DELETED HERE, and the reason is worth stating
// because they were the bulk of req #3433's coverage. Each existed to prove the
// page picked the RIGHT column out of two — "ignore a 1.0-only stamp", "take the
// 2.0 columns when a row carries both", and one each way for a mixed stamp. Two
// of them constructed the dual-era row literally, and the rename collapsed those
// literals into DUPLICATE OBJECT KEYS (`{ pipeline_fk: 2, …, pipeline_fk: 7 }`),
// where JS silently keeps the last — so they asserted nothing from the moment
// the rename landed. The other two survived as syntax but not as meaning: with
// one column pair, ids 2 and 34 are simply a plan and an epic that RENDER, so
// the cases asserted the opposite of the truth. There is no arbitration left to
// test — one pair cannot disagree with itself — and repairing them would only
// have produced restatements of the render cases already below.
//
// WHAT THAT DELETION DELIBERATELY DOES NOT TAKE WITH IT: "no attribution renders
// neither row", "an unresolvable id still renders the row", and "the Epic row is
// independent of the Pipeline row". All three are still real and all three are
// still here.

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

// ONE ERA'S LISTS. The second pair of fixtures went with the hooks that served
// them (req #3356).
const PIPELINES = [{ id: 7, title: 'a plan' }];
const EPICS = [{ id: 12, title: 'an epic' }];

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
        // ONE pair. This was two pairs until req #3356's rename collapsed them
        // into duplicate keys on the same object literal.
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
        sessionRow = baseSession({ pipeline_fk: 7, epic_fk: 12 });
        const { container } = mount();

        const pipeline = node(container, 'session-pipeline');
        expect(pipeline).not.toBeNull();
        expect(pipeline.textContent).toContain('#7');
        expect(pipeline.textContent).toContain('a plan');

        const epic = node(container, 'session-epic');
        expect(epic).not.toBeNull();
        expect(epic.textContent).toContain('#12');
        expect(epic.textContent).toContain('an epic');
    });

    it('navigates to the pipeline detail route when the chip is clicked', () => {
        sessionRow = baseSession({ pipeline_fk: 7 });
        const { container } = mount();
        act(() => {
            node(container, 'session-pipeline-chip').click();
        });
        expect(navigations).toContain('/swarm/pipeline/7');
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

    // ── The four era-arbitration cases that used to sit here were DELETED by
    // req #3356. See the file header for which they were and why none of them
    // could be repaired into an assertion that still says something. ──────────

    // A session can carry an epic attribution with no pipeline (a manual
    // correction via update_swarm_session, or a partial stamp). The Epic row is
    // INDEPENDENT of the Pipeline row's presence and must keep rendering — that
    // survived req #3356 unchanged, only the column it reads moved.
    it('still renders the Epic row when only the epic column is stamped', () => {
        sessionRow = baseSession({ epic_fk: 12 });
        const { container } = mount();
        expect(node(container, 'session-pipeline')).toBeNull();
        expect(node(container, 'session-epic').textContent).toContain('#12');
    });
});
