// @vitest-environment jsdom
//
// Req #3503 — the aggregator under a EPIC filter.
//
// The same two things the initiative suite beside this one asserts, for the same
// reasons, over the narrower scope:
//
//   1. THE BADGE STILL EQUALS THE ROWS. This card's own comments call that
//      invariant LOAD-BEARING, and it now runs through TWO scope passes — a
//      count and a list must be narrowed by both, or they drift silently.
//   2. THE CARD DOES NOT OPEN BLANK. An epic reached from the plan visualizer's
//      badge is plan-carried BY DEFINITION, and the three launch chips exclude
//      plan-carried work unconditionally — so the persisted `swarm_ready` chip
//      can never have anything on it here. That is structural, not incidental.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DarwinDndContext } from '../../dnd';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.setConfig({ testTimeout: 30000 });

vi.mock('react-router-dom', () => ({ useNavigate: () => () => {} }));

// THE SHAPE OF A LIVE EPIC: everything `development`, everything pipelined.
// Plus one `swarm_ready` row on a DIFFERENT epic, so "the swarm_ready chip is
// empty" is a fact about the FILTER and not about the fixture.
const EPIC_ROWS = [
    { id: 3503, title: 'Epic dev A', requirement_status: 'development', category_fk: 1209 },
    { id: 3504, title: 'Epic dev B', requirement_status: 'development', category_fk: 1 },
];
const OTHER_ROWS = [
    { id: 900, title: 'Another epic, swarm_ready', requirement_status: 'swarm_ready', category_fk: 5 },
];
const ALL_ROWS = [...EPIC_ROWS, ...OTHER_ROWS];
// The junction in the wire shape the real `useRequirementVisibility` reads.
const JUNCTION = [
    { epic_fk: 186, requirement_fk: 3503 },
    { epic_fk: 186, requirement_fk: 3504 },
    { epic_fk: 187, requirement_fk: 900 },
];

// PRE-BUCKETED AND FROZEN AT MODULE SCOPE. A mock that builds its array inside
// the hook mints a new reference on every render, which re-seeds the card's local
// state, which re-renders — an infinite loop that presents as the test runner
// being killed rather than as a failure.
const BY_STATUS = {};
for (const r of ALL_ROWS) (BY_STATUS[r.requirement_status] ??= []).push(r);

// req #3503 review — A SET, NOT A SINGLE "LAST CALL WINS" VALUE. The card runs
// a SECOND `useRequirementsByStatus('met', …)` unconditionally
// (`serverMetRequirementsAllTime`), and a mock that does not model `enabled`
// records whichever of the two calls happens to execute last in render order
// — not necessarily the one that matters. Mirrors the identical fix already
// applied to `SwarmStartCard.initiativeFilter.test.jsx`'s own mock for the same
// reason; see that file's comment for the full history.
let statusesAsked = new Set();
const EMPTY = [];
vi.mock('../../hooks/useDataQueries', () => ({
    useRequirementsByStatus: (_c, status, opts) => {
        const enabled = opts?.enabled ?? true;
        if (enabled) statusesAsked.add(status);
        return { data: enabled ? (BY_STATUS[status] ?? EMPTY) : undefined };
    },
    useRequirementsDone: () => ({ data: EMPTY }),
    useSessions: () => ({ data: EMPTY }),
    useCategoryColors: () => ({ data: EMPTY }),
    useAllRequirements: () => ({ data: ALL_ROWS }),
    useAllPipelineEpicRequirements: () => ({ data: JUNCTION }),
    ALL_ROWS: 'all',
}));

vi.mock('../../RestApi/RestApi', () => ({ default: vi.fn(() => Promise.resolve({ httpStatus: { httpStatus: 200 }, data: [] })) }));

import SwarmStartCard from '../SwarmStartCard';
import AuthContext from '../../Context/AuthContext';
import AppContext from '../../Context/AppContext';
import { useSwarmStartCardStore } from '../../stores/useSwarmStartCardStore';
import { useShowClosedStore } from '../../stores/useShowClosedStore';

const EPIC_SET = new Set([3503, 3504]);

let roots = [];
function mount({ epicReqIds = null, initiativeReqIds = null } = {}) {
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
                        <DarwinDndContext>
                            <SwarmStartCard initiativeReqIds={initiativeReqIds} epicReqIds={epicReqIds} />
                        </DarwinDndContext>
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

describe('SwarmStartCard under an epic filter (req #3503)', () => {
    beforeEach(() => {
        roots = [];
        statusesAsked = new Set();
        useSwarmStartCardStore.setState({ selectedStatus: 'swarm_ready', show: true });
        // req #3598 — the stored toggle APPLIES under a scope now, and every row
        // here is plan-carried, so the scope's own behaviour is asserted with it
        // OFF; the test that turns it ON pins that it is no longer overridden.
        useShowClosedStore.setState({ hidePipelinedRequirements: false });
    });
    afterEach(() => {
        act(() => { roots.forEach((r) => r.unmount()); });
        document.body.innerHTML = '';
        useSwarmStartCardStore.setState({ selectedStatus: 'swarm_ready' });
        useShowClosedStore.setState({ hidePipelinedRequirements: false });
    });

    it('DOES NOT OPEN BLANK: the persisted swarm_ready chip has none of the epic, '
        + 'so the card opens on one that does', () => {
        const { container } = mount({ epicReqIds: EPIC_SET });
        expect(statusesAsked).toEqual(new Set(['development']));
        expect(rowIds(container).sort()).toEqual(['3503', '3504']);
    });

    it('never writes the reader\'s chip preference to do it', () => {
        mount({ epicReqIds: EPIC_SET });
        expect(useSwarmStartCardStore.getState().selectedStatus).toBe('swarm_ready');
    });

    it('the badge equals the rows on the chip it opened', () => {
        const { container } = mount({ epicReqIds: EPIC_SET });
        expect(badge(container, 'development')).toBe(rowIds(container).length);
    });

    it('the orchestrated toggle APPLIES under an epic filter: stored ON hides '
        + 'its plan-carried rows from the rows AND the badge (req #3598)', () => {
        useShowClosedStore.setState({ hidePipelinedRequirements: true });
        const { container } = mount({ epicReqIds: EPIC_SET });
        expect(rowIds(container)).toHaveLength(0);
        expect(badge(container, 'development')).toBe(0);
    });

    it('with the toggle OFF, shows the epic\'s rows', () => {
        const { container } = mount({ epicReqIds: EPIC_SET });
        expect(rowIds(container)).toHaveLength(2);
    });

    it('keeps the launch chips free of plan-carried work — that exclusion is '
        + 'correctness, not a viewing preference', () => {
        const { container } = mount({ epicReqIds: EPIC_SET });
        expect(badge(container, 'swarm_ready')).toBe(0);
    });

    it('excludes another epic\'s requirements from every count', () => {
        const { container } = mount({ epicReqIds: EPIC_SET });
        expect(badge(container, 'development')).toBe(2);
    });

    it('keeps the add-a-requirement row while filtered (req #3598)', () => {
        const { container } = mount({ epicReqIds: EPIC_SET });
        expect(container.querySelector('[data-testid="requirement-template"]')).not.toBeNull();
    });

    it('with NO filter (null) it behaves exactly as before: the stored chip is '
        + 'honoured and the template row is back', () => {
        const { container } = mount();
        expect(statusesAsked).toEqual(new Set(['swarm_ready']));
        expect(container.querySelector('[data-testid="requirement-template"]')).not.toBeNull();
    });

    it('COMPOSES with the initiative filter as an intersection, in the rows AND the '
        + 'badge — the two must never disagree', () => {
        const { container } = mount({
            initiativeReqIds: new Set([3503, 3504]), epicReqIds: new Set([3504]),
        });
        expect(rowIds(container)).toEqual(['3504']);
        expect(badge(container, 'development')).toBe(1);
    });

    it('req #3598 — a fully-`met` epic opens on Met with its rows, not a `1` badge '
        + 'over an empty list: the all-time Met source covers a EPIC scope too', () => {
        // The trailing-24h query (`useRequirementsDone`) is EMPTY here, as it is
        // for an epic finished more than a day ago.
        const priorAll = ALL_ROWS.slice();
        const priorMet = BY_STATUS.met;
        try {
            const done = { id: 7001, title: 'Done on the epic', requirement_status: 'met', category_fk: 1 };
            ALL_ROWS.push(done);
            BY_STATUS.met = [...(priorMet ?? []), done];
            const { container } = mount({ epicReqIds: new Set([7001]) });
            expect(rowIds(container)).toEqual(['7001']);
            expect(badge(container, 'met')).toBe(1);
        } finally {
            ALL_ROWS.length = 0; ALL_ROWS.push(...priorAll);
            if (priorMet === undefined) delete BY_STATUS.met; else BY_STATUS.met = priorMet;
        }
    });
});
