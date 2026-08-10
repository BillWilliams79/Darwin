// @vitest-environment jsdom
//
// req #3258, rewritten for req #3419 — the card DELEGATES, it does not decide.
//
// The previous version of this file mounted the real CategoryCard against a
// mocked `usePipelinedRequirementIds` and asserted that a pipelined row
// disappeared. It passed throughout the defect req #3419 fixes, and it had to:
// it handed the card a Set and then checked the card filtered by that Set. What
// was wrong was WHICH ids the Set contained, one layer down, in the code the
// mock replaced. `src/__tests__/requirementVisibility.harness.test.jsx` covers
// that layer for real (only the HTTP transport is mocked).
//
// What is left for this file is the property the harness structurally cannot
// assert, because it runs the real hook: that the card renders exactly what
// `filterVisible` hands back and applies NO second rule of its own. With the
// predicate stubbed to something no real membership rule would ever produce, a
// card carrying a local copy of the rule shows a different list than a card that
// delegates.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DndProvider } from 'react-dnd';
import { TouchBackend } from 'react-dnd-touch-backend';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('react-router-dom', () => ({ useNavigate: () => () => {} }));

const reqData = [
    { id: 10, title: 'Ten', requirement_status: 'authoring', category_fk: 5, sort_order: 0 },
    { id: 11, title: 'Eleven', requirement_status: 'authoring', category_fk: 5, sort_order: 1 },
    { id: 12, title: 'Twelve', requirement_status: 'authoring', category_fk: 5, sort_order: 2 },
];
const EMPTY_SESSIONS = [];
vi.mock('../../hooks/useDataQueries', () => ({
    useRequirements: () => ({ data: reqData }),
    useSessions: () => ({ data: EMPTY_SESSIONS }),
}));

// The stub predicate. `keep` is set per test; the card must reproduce it
// exactly, whatever it says.
let keep = new Set([10, 11, 12]);
let visibilityCalls = 0;
vi.mock('../../hooks/useRequirementVisibility', () => ({
    useRequirementVisibility: () => {
        visibilityCalls += 1;
        // Referentially stable per `keep`, the way the real hook is — an
        // unstable identity here would re-seed the card's local state every
        // render rather than fail an assertion.
        return React.useMemo(() => {
            const isVisible = (r) => keep.has(Number(r?.id));
            return {
                hideOrchestrated: true,
                pipelinedIds: new Set(),
                orchestratedIds: new Set(),
                isVisible,
                filterVisible: (rows) => (Array.isArray(rows) ? rows.filter(isVisible) : rows),
            };
        }, [keep]);
    },
}));

vi.mock('../../RestApi/RestApi', () => ({ default: vi.fn(() => Promise.resolve({ httpStatus: { httpStatus: 200 }, data: [] })) }));

import CategoryCard from '../CategoryCard';
import AuthContext from '../../Context/AuthContext';
import AppContext from '../../Context/AppContext';

const CATEGORY = { id: 5, category_name: 'Test Cat', project_fk: 1, sort_mode: 'process', color: null };
const noop = () => {};

let roots = [];
function mount() {
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
                            <CategoryCard
                                category={CATEGORY}
                                categoryIndex={0}
                                projectId={1}
                                categoryChange={noop}
                                categoryKeyDown={noop}
                                categoryOnBlur={noop}
                                clickCardClosed={noop}
                                clickCardDelete={noop}
                                moveCard={noop}
                                persistCategoryOrder={noop}
                                removeCategory={noop}
                                isTemplate={false}
                                showClosed={false}
                            />
                        </DndProvider>
                    </AuthContext.Provider>
                </AppContext.Provider>
            </QueryClientProvider>
        );
    });
    return { container };
}

const rowIds = (container) =>
    [...container.querySelectorAll('[data-testid^="requirement-"]')]
        .map(el => el.getAttribute('data-testid').slice('requirement-'.length))
        .filter(v => /^\d+$/.test(v))
        .map(Number);

describe('CategoryCard delegates visibility to the shared hook (req #3419)', () => {
    beforeEach(() => {
        roots = [];
        keep = new Set([10, 11, 12]);
        visibilityCalls = 0;
    });
    afterEach(() => {
        act(() => { roots.forEach((r) => r.unmount()); });
        document.body.innerHTML = '';
    });

    // Generous timeouts throughout: this file mounts the real CategoryCard, and
    // the first mount in a worker also pays the module-graph cost. A 5s default
    // makes it flaky on a busy machine, which is noise rather than signal.
    it('asks the shared hook at all', () => {
        mount();
        expect(visibilityCalls).toBeGreaterThan(0);
    }, 30000);

    it('renders exactly what the predicate keeps', () => {
        keep = new Set([10, 12]);
        const { container } = mount();
        expect(rowIds(container)).toEqual([10, 12]);
    }, 30000);

    it('renders NOTHING when the predicate keeps nothing', () => {
        keep = new Set();
        const { container } = mount();
        expect(rowIds(container)).toEqual([]);
        // ...and the add-row survives, because it is an affordance, not a row.
        expect(container.querySelector('[data-testid="requirement-template"]')).not.toBeNull();
    }, 30000);

    it('reproduces a predicate no membership rule would produce', () => {
        // The load-bearing case. A card that kept its own `pipelinedIds.has(...)`
        // copy could still pass the two tests above by coincidence; it cannot
        // reproduce an arbitrary predicate.
        keep = new Set([11]);
        const { container } = mount();
        expect(rowIds(container)).toEqual([11]);
    }, 30000);
});
