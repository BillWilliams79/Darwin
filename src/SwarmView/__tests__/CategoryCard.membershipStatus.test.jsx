// @vitest-environment jsdom
//
// Req #3598 — under an initiative or step membership filter the Cards view is the
// NORMAL Requirements view with just that set of requirements (user ruling,
// 2026-10-17). The reported defect: the initiative chip's Task Cards link opened a
// page holding only the aggregator, because every category card whose scoped
// rows the chips removed returned null. Test 2 is the one that fails on that
// code; the rest pin that the chips stay in charge under a scope (the first
// design for this requirement bypassed them, and the user rejected it):
//   1. the status chips keep applying to the scope's rows, so closed work shows
//      the moment the reader turns its chip on;
//   2. a card whose scoped rows are all filtered out still renders — the card
//      layout is the normal one, never a page of vanished cards;
//   3. the scope still narrows whatever chips are on;
//   4. dismissing the pill (the host hands `null`) leaves the same card on the
//      reader's own chips, and the status store is never written.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DarwinDndContext } from '../../dnd';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// Cold module-compile cost on the first mounted `it()` — see
// CategoryCard.initiativeFilter.test.jsx for the measurement.
vi.setConfig({ testTimeout: 30000 });

vi.mock('react-router-dom', () => ({ useNavigate: () => () => {} }));

// One open row and three closed ones, all in category 5 and all on step 186 —
// the ordinary shape of an initiative's work, which is mostly finished.
const reqData = [
    { id: 20, title: 'Open work', requirement_status: 'development', category_fk: 5, sort_order: 0 },
    { id: 21, title: 'Shipped', requirement_status: 'met', category_fk: 5, sort_order: 1 },
    { id: 22, title: 'Parked', requirement_status: 'deferred', category_fk: 5, sort_order: 2 },
    { id: 23, title: 'Dropped', requirement_status: 'wontfix', category_fk: 5, sort_order: 3 },
];
const EMPTY_SESSIONS = [];
// MODULE-LEVEL, never inline literals: a fresh array per render churns the
// visibility hook's memoized Sets into a synchronous render loop.
const JUNCTION = reqData.map(({ id }) => ({ step_fk: 186, requirement_fk: id }));
const ALL_REQS = reqData.map(({ id }) => ({ id }));
vi.mock('../../hooks/useDataQueries', () => ({
    useRequirements: () => ({ data: reqData }),
    useSessions: () => ({ data: EMPTY_SESSIONS }),
    useAllPipelineStepRequirements: () => ({ data: JUNCTION }),
    useAllRequirements: () => ({ data: ALL_REQS }),
    ALL_ROWS: 'all',
}));

vi.mock('../../RestApi/RestApi', () => ({ default: vi.fn(() => Promise.resolve({ httpStatus: { httpStatus: 200 }, data: [] })) }));

import CategoryCard from '../CategoryCard';
import {
    useShowClosedStore, DEFAULT_REQUIREMENT_STATUSES, ALL_REQUIREMENT_STATUSES,
} from '../../stores/useShowClosedStore';
import AuthContext from '../../Context/AuthContext';
import AppContext from '../../Context/AppContext';

const CATEGORY = { id: 5, category_name: 'Test Cat', project_fk: 1, sort_mode: 'process', color: null };
const noop = () => {};
let clickCardDelete = vi.fn();

let roots = [];
function mount(scope = {}) {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const root = createRoot(container);
    roots.push(root);
    const render = ({ stepReqIds = null, initiativeReqIds = null } = {}) => act(() => {
        root.render(
            <QueryClientProvider client={queryClient}>
                <AppContext.Provider value={{ darwinUri: 'http://test.local' }}>
                    <AuthContext.Provider value={{ idToken: 'tok', profile: { userName: 'tester', timezone: 'UTC' } }}>
                        <DarwinDndContext>
                            <CategoryCard
                                category={CATEGORY}
                                categoryIndex={0}
                                projectId={1}
                                categoryChange={noop}
                                categoryKeyDown={noop}
                                categoryOnBlur={noop}
                                clickCardClosed={noop}
                                clickCardDelete={clickCardDelete}
                                isTemplate={false}
                                showClosed={false}
                                initiativeReqIds={initiativeReqIds}
                                stepReqIds={stepReqIds}
                            />
                        </DarwinDndContext>
                    </AuthContext.Provider>
                </AppContext.Provider>
            </QueryClientProvider>
        );
    });
    render(scope);
    // `rerender` keeps the SAME mounted card, which is what dismissing the
    // pill does: the host hands the card `null` in place of the scope.
    return { container, rerender: render };
}

const rowPresent = (container, id) => container.querySelector(`[data-testid="requirement-${id}"]`) !== null;
const cardPresent = (container) => container.querySelector('[data-testid="category-card-5"]') !== null;
const ALL_IDS = [20, 21, 22, 23];
const CLOSED_IDS = [21, 22, 23];

describe('CategoryCard: status chips under a membership filter (req #3598)', () => {
    beforeEach(() => {
        roots = [];
        // The shipped status chips; the orchestrated toggle OFF to isolate the
        // chips (every row here is step-seated, as an initiative's work always is).
        useShowClosedStore.setState({
            requirementStatusFilter: DEFAULT_REQUIREMENT_STATUSES,
            hidePipelinedRequirements: false,
        });
    });
    afterEach(() => {
        act(() => { roots.forEach((r) => r.unmount()); });
        document.body.innerHTML = '';
        useShowClosedStore.setState({ requirementStatusFilter: DEFAULT_REQUIREMENT_STATUSES });
    });

    it('the status chips APPLY under an INITIATIVE filter: default chips show only the open row', () => {
        const { container } = mount({ initiativeReqIds: new Set(ALL_IDS) });
        expect(rowPresent(container, 20)).toBe(true);
        CLOSED_IDS.forEach((id) => expect(rowPresent(container, id)).toBe(false));
    });

    it('the status chips APPLY under a STEP filter too', () => {
        const { container } = mount({ stepReqIds: new Set(ALL_IDS) });
        expect(rowPresent(container, 20)).toBe(true);
        CLOSED_IDS.forEach((id) => expect(rowPresent(container, id)).toBe(false));
    });

    it('turning the closed chips on shows the scope\'s met, deferred and wontfix rows', () => {
        useShowClosedStore.setState({ requirementStatusFilter: ALL_REQUIREMENT_STATUSES });
        const { container } = mount({ initiativeReqIds: new Set(ALL_IDS) });
        ALL_IDS.forEach((id) => expect(rowPresent(container, id)).toBe(true));
    });

    it('a card whose scoped work is ALL filtered out still renders — the reported '
        + 'defect, where every category card vanished', () => {
        const { container } = mount({ initiativeReqIds: new Set(CLOSED_IDS) });
        expect(cardPresent(container)).toBe(true);
        ALL_IDS.forEach((id) => expect(rowPresent(container, id)).toBe(false));
    });

    it('the scope still narrows whatever chips are on', () => {
        useShowClosedStore.setState({ requirementStatusFilter: ALL_REQUIREMENT_STATUSES });
        const { container } = mount({ initiativeReqIds: new Set([21]) });
        expect(rowPresent(container, 21)).toBe(true);
        [20, 22, 23].forEach((id) => expect(rowPresent(container, id)).toBe(false));
    });

    it('dismissing the pill leaves the same card on the reader\'s own chips, '
        + 'and the status store is never written', () => {
        const mine = ['development', 'met'];
        useShowClosedStore.setState({ requirementStatusFilter: mine });
        const { container, rerender } = mount({ initiativeReqIds: new Set([21]) });
        expect(rowPresent(container, 20)).toBe(false);
        expect(rowPresent(container, 21)).toBe(true);
        rerender({ initiativeReqIds: null });
        expect(rowPresent(container, 20)).toBe(true);
        expect(rowPresent(container, 21)).toBe(true);
        [22, 23].forEach((id) => expect(rowPresent(container, id)).toBe(false));
        expect(useShowClosedStore.getState().requirementStatusFilter).toBe(mine);
    });

    it('Delete Category names EVERY requirement it would remove, not the rows the '
        + 'chips and the scope left on screen', () => {
        clickCardDelete = vi.fn();
        const { container } = mount({ initiativeReqIds: new Set([21]) });
        act(() => { container.querySelector('[data-testid="card-menu-5"]').click(); });
        act(() => { document.querySelector('[data-testid="menu-delete-category-5"]').click(); });
        expect(clickCardDelete).toHaveBeenCalledTimes(1);
        expect(clickCardDelete.mock.calls[0][3]).toBe(reqData.length);
    });
});
