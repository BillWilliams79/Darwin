// @vitest-environment jsdom
//
// Req #3428 — the aggregator under an epic filter.
//
// Two things are asserted here and nowhere else:
//
//   1. THE BADGE STILL EQUALS THE ROWS. This card's own comments call that
//      invariant LOAD-BEARING, and it now runs through `epicReqIds` — a count
//      and a list narrowed by the same Set, or they drift silently.
//   2. THE CARD DOES NOT OPEN BLANK. Measured on live Darwin 2026-08-09: every
//      requirement under epic 11 was `development` AND plan-carried, while the
//      persisted chip is `swarm_ready`. The requirement asks for the aggregator
//      ON; on its own data it was on and empty. That is what the derived chip
//      override fixes, and this fixture reproduces exactly that shape.
//
// req #3502 removed the aggregator's unconditional launch exclusion, so the
// `swarm_ready` chip is empty here for ONE reason now instead of two: the epic
// simply has no swarm_ready work. Requirement 900 is swarm_ready and outside the
// epic, so "the chip is empty" remains a fact about the FILTER — which is what
// this file exists to prove — rather than about the deleted rule.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DndProvider } from 'react-dnd';
import { TouchBackend } from 'react-dnd-touch-backend';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.setConfig({ testTimeout: 30000 });

vi.mock('react-router-dom', () => ({ useNavigate: () => () => {} }));

// THE LIVE SHAPE OF EPIC 11: everything `development`, everything pipelined.
// Plus one `swarm_ready` row belonging to a DIFFERENT epic, so "the swarm_ready
// chip is empty" is a fact about the FILTER and not about the fixture.
const EPIC_ROWS = [
    { id: 3428, title: 'Epic dev A', requirement_status: 'development', category_fk: 1209 },
    { id: 3430, title: 'Epic dev B', requirement_status: 'development', category_fk: 1 },
];
const OTHER_ROWS = [
    { id: 900, title: 'Someone else swarm_ready', requirement_status: 'swarm_ready', category_fk: 5 },
];
const ALL_ROWS = [...EPIC_ROWS, ...OTHER_ROWS];
const PIPELINED = new Set([3428, 3430, 900]);
// The junction rows behind PIPELINED, in the wire shape the real hook reads.
const JUNCTION = [...PIPELINED].map((id) => ({ step_fk: 1, requirement_fk: id }));
// `useAllRequirements` here serves BOTH the counts projection and the hook's
// `id,feature_fk` one, so the rows carry no feature_fk and no row is epic-seated
// by that route — leaving PIPELINED as the sole source of orchestrated-ness,
// which is what this fixture intends.
const FEATURES = [];

// PRE-BUCKETED AND FROZEN AT MODULE SCOPE. A mock that builds its array inside
// the hook mints a new reference on every render, which re-seeds the card's local
// state, which re-renders — an infinite loop that presents as the test runner
// being killed rather than as a failure. The real `useQuery` returns a stable
// reference between refetches, and a double has to as well.
const BY_STATUS = {};
for (const r of ALL_ROWS) (BY_STATUS[r.requirement_status] ??= []).push(r);

let activeStatusAsked = null;
const EMPTY = [];
vi.mock('../../hooks/useDataQueries', () => ({
    useRequirementsByStatus: (_c, status) => {
        activeStatusAsked = status;
        return { data: BY_STATUS[status] ?? EMPTY };
    },
    useRequirementsDone: () => ({ data: EMPTY }),
    useSessions: () => ({ data: EMPTY }),
    useCategoryColors: () => ({ data: EMPTY }),
    useAllRequirements: () => ({ data: ALL_ROWS }),
    // req #3419 MERGE — `usePipelinedRequirementIds` is gone. The REAL
    // `useRequirementVisibility` joins these three bounded reads and applies the
    // epic override itself, so the rule this file tests runs for real. Frozen at
    // module scope for the same reason `BY_STATUS` above is.
    useAllPipelineStepRequirements: () => ({ data: JUNCTION }),
    useAllFeatures: () => ({ data: FEATURES }),
    ALL_ROWS: 'all',
}));

vi.mock('../../RestApi/RestApi', () => ({ default: vi.fn(() => Promise.resolve({ httpStatus: { httpStatus: 200 }, data: [] })) }));

import SwarmStartCard from '../SwarmStartCard';
import AuthContext from '../../Context/AuthContext';
import AppContext from '../../Context/AppContext';
import { useSwarmStartCardStore } from '../../stores/useSwarmStartCardStore';
import { useShowClosedStore } from '../../stores/useShowClosedStore';

const EPIC_SET = new Set([3428, 3430]);

let roots = [];
function mount(epicReqIds) {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const root = createRoot(container);
    roots.push(root);
    act(() => {
        root.render(
            <QueryClientProvider client={queryClient}>
                <AppContext.Provider value={{ darwinUri: 'http://test.local' }}>
                    <AuthContext.Provider value={{ idToken: 'tok', profile: { userName: 'tester', timezone: 'UTC' } }}>
                        <DndProvider backend={TouchBackend} options={{ enableMouseEvents: true }}>
                            <SwarmStartCard epicReqIds={epicReqIds} />
                        </DndProvider>
                    </AuthContext.Provider>
                </AppContext.Provider>
            </QueryClientProvider>
        );
    });
    return { container };
}

const rowIds = (container) => Array.from(
    container.querySelectorAll('[data-testid^="requirement-"]'))
    .map(el => el.getAttribute('data-testid').replace('requirement-', ''))
    .filter(id => id !== 'template');

const badge = (container, status) => {
    const el = container.querySelector(`[data-testid="swarm-start-chip-badge-${status}"]`);
    // MUI renders the count in a `.MuiBadge-badge` span; `invisible` when zero.
    const b = el?.querySelector('.MuiBadge-badge');
    return b ? Number(b.textContent || '0') : 0;
};

describe('SwarmStartCard under an epic filter (req #3428)', () => {
    beforeEach(() => {
        roots = [];
        activeStatusAsked = null;
        useSwarmStartCardStore.setState({ selectedStatus: 'swarm_ready', show: true });
        useShowClosedStore.setState({ hidePipelinedRequirements: true });
    });
    afterEach(() => {
        act(() => { roots.forEach((r) => r.unmount()); });
        document.body.innerHTML = '';
        useSwarmStartCardStore.setState({ selectedStatus: 'swarm_ready' });
        useShowClosedStore.setState({ hidePipelinedRequirements: false });
    });

    it('DOES NOT OPEN BLANK: the persisted swarm_ready chip has none of the epic, '
        + 'so the card opens on one that does', () => {
        const { container } = mount(EPIC_SET);
        expect(activeStatusAsked).toBe('development');
        expect(rowIds(container).sort()).toEqual(['3428', '3430']);
    });

    it('never writes the reader\'s chip preference to do it', () => {
        mount(EPIC_SET);
        expect(useSwarmStartCardStore.getState().selectedStatus).toBe('swarm_ready');
    });

    it('the badge equals the rows on the chip it opened', () => {
        const { container } = mount(EPIC_SET);
        expect(badge(container, 'development')).toBe(rowIds(container).length);
    });

    it('shows the epic\'s development rows even though every one is plan-carried '
        + 'and the pipeline toggle is ON', () => {
        const { container } = mount(EPIC_SET);
        expect(rowIds(container)).toHaveLength(2);
    });

    it('keeps another epic\'s swarm_ready work off the launch chip — the FILTER '
        + 'is what empties it (req #3502)', () => {
        // Requirement 900 is swarm_ready, plan-carried, and belongs to a
        // different epic. Before req #3502 this chip was empty for two reasons
        // at once; now the epic scope is the only one, which is what makes this
        // an assertion about the filter.
        const { container } = mount(EPIC_SET);
        expect(badge(container, 'swarm_ready')).toBe(0);
    });

    it('shows that same requirement once the filter is lifted', () => {
        // The other half of the case above: with no epic scope, 900 is on the
        // launch chip — plan-carried work is no longer withheld from it. This is
        // the defect req #3502 was filed for, asserted at the aggregator.
        useShowClosedStore.setState({ hidePipelinedRequirements: false });
        const { container } = mount(null);
        expect(badge(container, 'swarm_ready')).toBe(1);
        expect(rowIds(container)).toEqual(['900']);
    });

    it('excludes another epic\'s requirements from every count', () => {
        const { container } = mount(EPIC_SET);
        expect(badge(container, 'development')).toBe(2);
        expect(badge(container, 'swarm_ready')).toBe(0);
    });

    it('suppresses the add-a-requirement row while filtered', () => {
        const { container } = mount(EPIC_SET);
        expect(container.querySelector('[data-testid="requirement-template"]')).toBeNull();
    });

    it('with NO filter (null) it behaves exactly as before: the stored chip is '
        + 'honoured and the template row is back', () => {
        const { container } = mount(null);
        expect(activeStatusAsked).toBe('swarm_ready');
        expect(container.querySelector('[data-testid="requirement-template"]')).not.toBeNull();
    });
});
