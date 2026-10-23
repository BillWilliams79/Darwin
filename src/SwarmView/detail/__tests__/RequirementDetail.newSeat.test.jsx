// @vitest-environment jsdom
//
// Req #3582 — a plan epic's "+" opens the requirement editor in "new" mode
// carrying the epic. Picking a category is the first save (req #2414); this
// suite pins that the same act SEATS the new requirement on that epic, in
// that order (the requirement must exist before the junction can name it), and
// that Back still returns to the plan afterwards.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let locationState = null;
const navigateCalls = [];
vi.mock('react-router-dom', async () => {
    const actual = await vi.importActual('react-router-dom');
    return {
        ...actual,
        useParams: () => ({ id: 'new' }),
        useNavigate: () => (...args) => navigateCalls.push(args),
        useLocation: () => ({ state: locationState }),
    };
});

vi.mock('../../../hooks/factory/createEntityQueries', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        fetchEntity: vi.fn((uri) => Promise.resolve(
            String(uri).includes('/categories')
                ? [{ id: 11, category_name: 'Darwin', sort_order: 1, closed: 0 }]
                : [])),
    };
});

const restCalls = [];
let seatPostStatus = 200;
let epicLocked = 0;
let initiativeLocked = 0;
let planLocked = 0;
vi.mock('../../../RestApi/RestApi', () => ({
    default: vi.fn((uri, method, body) => {
        restCalls.push({ uri: String(uri), method, body });
        if (String(uri).endsWith('/requirements') && method === 'POST') {
            return Promise.resolve({ httpStatus: { httpStatus: 200 }, data: [{ id: 9001 }] });
        }
        if (String(uri).includes('/epics?id=') && method === 'GET') {
            return Promise.resolve({ httpStatus: { httpStatus: 200 },
                data: [{ id: 412, locked: epicLocked, initiative_fk: 55 }] });
        }
        if (String(uri).includes('/initiatives?id=55') && method === 'GET') {
            return Promise.resolve({ httpStatus: { httpStatus: 200 },
                data: [{ id: 55, locked: initiativeLocked, pipeline_fk: 7 }] });
        }
        if (String(uri).includes('/pipelines?id=7') && method === 'GET') {
            return Promise.resolve({ httpStatus: { httpStatus: 200 },
                data: [{ id: 7, locked: planLocked }] });
        }
        if (String(uri).endsWith('/epic_requirements') && method === 'POST') {
            return Promise.resolve({ httpStatus: { httpStatus: seatPostStatus }, data: [] });
        }
        return Promise.resolve({ httpStatus: { httpStatus: 200 }, data: [] });
    }),
}));

const snackMessages = [];
vi.mock('../../../stores/useSnackBarStore', () => ({
    useSnackBarStore: (selector) => selector({
        showError: (error, errorText) => snackMessages.push(errorText ?? error),
        close: () => {},
        open: false,
        message: '',
    }),
}));

import RequirementDetail from '../RequirementDetail';
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
                        <RequirementDetail />
                    </AuthContext.Provider>
                </AppContext.Provider>
            </QueryClientProvider>
        );
    });
    mountedRoots.push(root);
    return { container };
}

async function flush() {
    await act(async () => {
        for (let i = 0; i < 10; i++) await Promise.resolve();
        await new Promise((r) => setTimeout(r, 0));
        for (let i = 0; i < 5; i++) await Promise.resolve();
    });
}

async function pickCategory(container, label) {
    const trigger = container.querySelector('[data-testid="requirement-category-select"] [role="combobox"]');
    await act(async () => {
        trigger.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }));
    });
    await flush();
    const hit = Array.from(document.querySelectorAll('[role="option"]'))
        .find((o) => o.textContent === label);
    if (!hit) throw new Error(`no option "${label}"`);
    await act(async () => { hit.click(); });
    await flush();
}

const writes = () => restCalls.filter((c) => c.method !== 'GET');

describe('RequirementDetail new mode filed from a plan epic (req #3582)', { timeout: 15000 }, () => {
    beforeEach(() => {
        mountedRoots = [];
        restCalls.length = 0;
        navigateCalls.length = 0;
        snackMessages.length = 0;
        seatPostStatus = 200;
        epicLocked = 0;
        initiativeLocked = 0;
        planLocked = 0;
        locationState = { seatEpicId: 412, seatEpicName: 'Seat UI',
            from: 'pipeline', pipelineId: 7, mode: 'plan', backEpicId: 412 };
    });
    afterEach(() => {
        act(() => { mountedRoots.forEach((r) => r.unmount()); });
        document.body.innerHTML = '';
    });

    it('names the epic the draft files into', async () => {
        const { container } = mount();
        await flush();
        expect(container.querySelector('[data-testid="requirement-new-seat-epic"]').textContent)
            .toBe('Files into epic 412 · Seat UI');
    });

    it('creates the requirement, THEN seats it on the epic, and keeps the way back to the plan', async () => {
        const { container } = mount();
        await flush();
        await pickCategory(container, 'Darwin');
        const w = writes();
        expect(w.map((c) => `${c.method} ${c.uri.split('/').pop()}`))
            .toEqual(['POST requirements', 'POST epic_requirements']);
        expect(w[1].body).toEqual({ epic_fk: 412, requirement_fk: 9001 });
        expect(snackMessages).toEqual([]);
        expect(navigateCalls.at(-1)).toEqual(['/swarm/requirement/9001', {
            replace: true, state: { from: 'pipeline', pipelineId: 7, mode: 'plan',
                backEpicId: 412 } }]);
    });

    it('reports a failed seat without undoing the created requirement', async () => {
        seatPostStatus = 500;
        const { container } = mount();
        await flush();
        await pickCategory(container, 'Darwin');
        expect(writes().map((c) => c.method)).toEqual(['POST', 'POST']);
        expect(snackMessages).toEqual(['Requirement 9001 created, but not seated on epic 412']);
        expect(navigateCalls.at(-1)[0]).toBe('/swarm/requirement/9001');
    });

    it('writes no seat for the aggregator template flow (no epic in the state)', async () => {
        locationState = { title: 'From the aggregator' };
        const { container } = mount();
        await flush();
        expect(container.querySelector('[data-testid="requirement-new-seat-epic"]')).toBeNull();
        await pickCategory(container, 'Darwin');
        expect(writes().map((c) => c.uri.split('/').pop())).toEqual(['requirements']);
        expect(navigateCalls.at(-1)).toEqual(['/swarm/requirement/9001',
            { replace: true, state: undefined }]);
    });

    // An epic has no state (req #3750) — what can close it to new work is a
    // LOCK (req #3649), which the gateway would enforce with a 423 on the seat.
    it('creates nothing when the epic was locked since the plan rendered', async () => {
        epicLocked = 1;
        const { container } = mount();
        await flush();
        await pickCategory(container, 'Darwin');
        expect(writes()).toEqual([]);
        expect(snackMessages).toEqual(['Epic 412 is locked — it takes no new work; nothing was created']);
        // The re-read names only columns that exist — `completed_at` is dropped.
        const epicRead = restCalls.find((c) => c.uri.includes('/epics?id=412'));
        expect(epicRead.uri).toContain('fields=id,locked,initiative_fk');
        expect(navigateCalls).toEqual([]);
        // The draft is left uncategorized, so the user can see nothing saved.
        expect(container.querySelector('[data-testid="requirement-category-select"]').textContent)
            .toBe('Must Select');
    });

    // The lock CASCADES (req #3649): a locked INITIATIVE or PLAN refuses the seat
    // with a 423 too, so the pre-check walks epic -> initiative -> plan, or the
    // requirement would be created and left unseated.
    it('creates nothing when the epic\'s INITIATIVE is locked', async () => {
        initiativeLocked = 1;
        const { container } = mount();
        await flush();
        await pickCategory(container, 'Darwin');
        expect(writes()).toEqual([]);
        expect(snackMessages).toEqual(["Epic 412's initiative is locked — it takes no new work; nothing was created"]);
        expect(navigateCalls).toEqual([]);
    });

    it('creates nothing when the epic\'s PLAN is locked, naming the outermost lock', async () => {
        planLocked = 1;
        initiativeLocked = 1;
        const { container } = mount();
        await flush();
        await pickCategory(container, 'Darwin');
        expect(writes()).toEqual([]);
        expect(snackMessages).toEqual(["Epic 412's plan is locked — it takes no new work; nothing was created"]);
        expect(restCalls.some((c) => c.uri.includes('/pipelines?id=7&fields=id,locked'))).toBe(true);
    });

    it('Back returns to the plan, not zoomed onto the card (req #3637 — camera restores)', async () => {
        const { container } = mount();
        await flush();
        const back = Array.from(container.querySelectorAll('button'))
            .find((b) => b.textContent === 'Back to Plan');
        await act(async () => { back.click(); });
        expect(navigateCalls.at(-1)).toEqual(['/swarm/pipeline/7?mode=plan']);
    });
});
