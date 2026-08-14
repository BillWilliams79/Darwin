// @vitest-environment jsdom
//
// Req #3503 — the aggregator under a STEP filter.
//
// The same two things the epic suite beside this one asserts, for the same
// reasons, over the narrower scope:
//
//   1. THE BADGE STILL EQUALS THE ROWS. This card's own comments call that
//      invariant LOAD-BEARING, and it now runs through TWO scope passes — a
//      count and a list must be narrowed by both, or they drift silently.
//   2. THE CARD DOES NOT OPEN BLANK. A step reached from the plan visualizer's
//      badge is plan-carried BY DEFINITION, and the three launch chips exclude
//      plan-carried work unconditionally — so the persisted `swarm_ready` chip
//      can never have anything on it here. That is structural, not incidental.

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

// THE SHAPE OF A LIVE STEP: everything `development`, everything pipelined.
// Plus one `swarm_ready` row on a DIFFERENT step, so "the swarm_ready chip is
// empty" is a fact about the FILTER and not about the fixture.
const STEP_ROWS = [
    { id: 3503, title: 'Step dev A', requirement_status: 'development', category_fk: 1209 },
    { id: 3504, title: 'Step dev B', requirement_status: 'development', category_fk: 1 },
];
const OTHER_ROWS = [
    { id: 900, title: 'Another step, swarm_ready', requirement_status: 'swarm_ready', category_fk: 5 },
];
const ALL_ROWS = [...STEP_ROWS, ...OTHER_ROWS];
// The junction in the wire shape the real `useRequirementVisibility` reads.
const JUNCTION = [
    { step_fk: 186, requirement_fk: 3503 },
    { step_fk: 186, requirement_fk: 3504 },
    { step_fk: 187, requirement_fk: 900 },
];
const FEATURES = [];

// PRE-BUCKETED AND FROZEN AT MODULE SCOPE. A mock that builds its array inside
// the hook mints a new reference on every render, which re-seeds the card's local
// state, which re-renders — an infinite loop that presents as the test runner
// being killed rather than as a failure.
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

const STEP_SET = new Set([3503, 3504]);

let roots = [];
function mount({ stepReqIds = null, epicReqIds = null } = {}) {
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
                            <SwarmStartCard epicReqIds={epicReqIds} stepReqIds={stepReqIds} />
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
    const b = el?.querySelector('.MuiBadge-badge');
    return b ? Number(b.textContent || '0') : 0;
};

describe('SwarmStartCard under a step filter (req #3503)', () => {
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

    it('DOES NOT OPEN BLANK: the persisted swarm_ready chip has none of the step, '
        + 'so the card opens on one that does', () => {
        const { container } = mount({ stepReqIds: STEP_SET });
        expect(activeStatusAsked).toBe('development');
        expect(rowIds(container).sort()).toEqual(['3503', '3504']);
    });

    it('never writes the reader\'s chip preference to do it', () => {
        mount({ stepReqIds: STEP_SET });
        expect(useSwarmStartCardStore.getState().selectedStatus).toBe('swarm_ready');
    });

    it('the badge equals the rows on the chip it opened', () => {
        const { container } = mount({ stepReqIds: STEP_SET });
        expect(badge(container, 'development')).toBe(rowIds(container).length);
    });

    it('shows the step\'s rows even though every one is plan-carried and the '
        + 'pipeline toggle is ON', () => {
        const { container } = mount({ stepReqIds: STEP_SET });
        expect(rowIds(container)).toHaveLength(2);
    });

    it('keeps the launch chips free of plan-carried work — that exclusion is '
        + 'correctness, not a viewing preference', () => {
        const { container } = mount({ stepReqIds: STEP_SET });
        expect(badge(container, 'swarm_ready')).toBe(0);
    });

    it('excludes another step\'s requirements from every count', () => {
        const { container } = mount({ stepReqIds: STEP_SET });
        expect(badge(container, 'development')).toBe(2);
    });

    it('suppresses the add-a-requirement row while filtered', () => {
        const { container } = mount({ stepReqIds: STEP_SET });
        expect(container.querySelector('[data-testid="requirement-template"]')).toBeNull();
    });

    it('with NO filter (null) it behaves exactly as before: the stored chip is '
        + 'honoured and the template row is back', () => {
        const { container } = mount();
        expect(activeStatusAsked).toBe('swarm_ready');
        expect(container.querySelector('[data-testid="requirement-template"]')).not.toBeNull();
    });

    it('COMPOSES with the epic filter as an intersection, in the rows AND the '
        + 'badge — the two must never disagree', () => {
        const { container } = mount({
            epicReqIds: new Set([3503, 3504]), stepReqIds: new Set([3504]),
        });
        expect(rowIds(container)).toEqual(['3504']);
        expect(badge(container, 'development')).toBe(1);
    });
});
