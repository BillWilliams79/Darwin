// @vitest-environment jsdom
//
// req #3302 — the aggregator's sort menu, driven THROUGH THE MENU.
//
// `swarmStartCardSort.test.js` pins the comparators. That is not enough and this
// file exists because it was not: the original defect was the WIRING —
// `changeSortMode` discarded the mode it was handed — and a pure-comparator suite
// stays green through it. The first fix then re-introduced a half-inert menu (an
// early return that swallowed the click on whichever item matched the unchosen
// default) and, again, every comparator test passed.
//
// So: mount the real card, click the real MenuItems, read the real row order.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DndProvider } from 'react-dnd';
import { TouchBackend } from 'react-dnd-touch-backend';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('react-router-dom', () => ({ useNavigate: () => () => {} }));

let activeRows;
let metRows;
const EMPTY = [];
vi.mock('../../hooks/useDataQueries', () => ({
    useRequirementsByStatus: () => ({ data: activeRows }),
    useRequirementsDone: () => ({ data: metRows }),
    useSessions: () => ({ data: EMPTY }),
    useCategoryColors: () => ({ data: EMPTY }),
    useAllRequirements: () => ({ data: EMPTY }),
    usePipelinedRequirementIds: () => new Set(),
}));

vi.mock('../../RestApi/RestApi', () => ({
    default: vi.fn(() => Promise.resolve({ httpStatus: { httpStatus: 200 }, data: [] })),
}));

import SwarmStartCard from '../SwarmStartCard';
import AuthContext from '../../Context/AuthContext';
import AppContext from '../../Context/AppContext';
import { useSwarmStartCardStore } from '../../stores/useSwarmStartCardStore';
import { useShowClosedStore } from '../../stores/useShowClosedStore';

const QUEUE = [
    { id: 30, title: 'thirty', requirement_status: 'approved', category_fk: 1, completed_at: null },
    { id: 10, title: 'ten',    requirement_status: 'approved', category_fk: 1, completed_at: null },
    { id: 20, title: 'twenty', requirement_status: 'approved', category_fk: 1, completed_at: null },
];

const MET = [
    { id: 30, title: 'thirty', requirement_status: 'met', category_fk: 1, completed_at: '2026-08-01T00:00:00' },
    { id: 10, title: 'ten',    requirement_status: 'met', category_fk: 1, completed_at: '2026-08-05T00:00:00' },
    { id: 20, title: 'twenty', requirement_status: 'met', category_fk: 1, completed_at: '2026-08-03T00:00:00' },
];

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
                            <SwarmStartCard />
                        </DndProvider>
                    </AuthContext.Provider>
                </AppContext.Provider>
            </QueryClientProvider>
        );
    });
    return { container };
}

async function flush() {
    await act(async () => {
        for (let i = 0; i < 10; i++) await Promise.resolve();
        await new Promise((r) => setTimeout(r, 0));
        for (let i = 0; i < 5; i++) await Promise.resolve();
    });
}

const click = async (el) => {
    expect(el, 'element must exist to be clicked').not.toBeNull();
    await act(async () => { el.click(); });
    await flush();
};

// The rendered order, read off the id chips the rows actually draw.
const renderedIds = (container) => {
    const card = container.querySelector('[data-testid="swarm-start-card"]');
    return [...card.querySelectorAll('[data-testid^="req-id-chip-"]')]
        .map(el => Number(el.getAttribute('data-testid').replace('req-id-chip-', '')));
};

// The menu is a portal on document.body, not inside the card.
const openMenu = async (container) => {
    await click(container.querySelector('[data-testid="swarm-start-card-menu"]'));
};
const menuItem = (testid) => document.body.querySelector(`[data-testid="${testid}"]`);

const pick = async (container, testid) => {
    await openMenu(container);
    await click(menuItem(testid));
};

beforeEach(() => {
    activeRows = undefined;
    metRows = undefined;
    useSwarmStartCardStore.setState({ selectedStatus: 'approved', show: true });
    useShowClosedStore.setState({ hidePipelinedRequirements: false });
});

afterEach(() => {
    act(() => { roots.forEach(r => r.unmount()); });
    roots = [];
    document.body.innerHTML = '';
});

describe('the menu changes the rendered order', () => {
    it('opens a queue chip Oldest first', async () => {
        activeRows = QUEUE;
        const { container } = mount();
        await flush();
        expect(renderedIds(container)).toEqual([10, 20, 30]);
    });

    it('reverses the rows when Newest first is picked', async () => {
        activeRows = QUEUE;
        const { container } = mount();
        await flush();
        await pick(container, 'swarm-start-sort-newest');
        expect(renderedIds(container)).toEqual([30, 20, 10]);
    });

    it('goes back when Oldest first is picked again', async () => {
        activeRows = QUEUE;
        const { container } = mount();
        await flush();
        await pick(container, 'swarm-start-sort-newest');
        await pick(container, 'swarm-start-sort-oldest');
        expect(renderedIds(container)).toEqual([10, 20, 30]);
    });

    // THE DEFECT THE FIRST FIX RE-INTRODUCED. `sortMode` starts null, so on the met
    // chip `effectiveSortMode` is already 'newest'; an early return on
    // `newMode === effectiveSortMode` swallowed this click and recorded nothing,
    // leaving the card looking right while the intention was lost.
    it('RECORDS a pick that matches the chip\'s current default', async () => {
        metRows = MET;
        useSwarmStartCardStore.setState({ selectedStatus: 'met' });
        const { container } = mount();
        await flush();
        // Met opens Newest first — most-recently-completed leads.
        expect(renderedIds(container)).toEqual([10, 20, 30]);

        // Clicking the ALREADY-EFFECTIVE item must still stick...
        await pick(container, 'swarm-start-sort-newest');
        expect(renderedIds(container)).toEqual([10, 20, 30]);

        // ...so switching to a queue chip keeps Newest rather than reverting to
        // that chip's own default of Oldest.
        metRows = undefined;
        activeRows = QUEUE;
        await click(container.querySelector('[data-testid="swarm-start-chip-approved"]'));
        expect(renderedIds(container)).toEqual([30, 20, 10]);
    });

    it('applies the pick across a chip switch in the other direction too', async () => {
        activeRows = QUEUE;
        const { container } = mount();
        await flush();
        await pick(container, 'swarm-start-sort-newest');
        expect(renderedIds(container)).toEqual([30, 20, 10]);

        activeRows = undefined;
        metRows = MET;
        await click(container.querySelector('[data-testid="swarm-start-chip-met"]'));
        expect(renderedIds(container)).toEqual([10, 20, 30]);
    });
});

describe('the template row survives a sort pick (req #2747, extended by #3302)', () => {
    it('keeps text typed into the add-row', async () => {
        activeRows = QUEUE;
        const { container } = mount();
        await flush();

        // MUI's multiline TextField renders TWO textareas per field: the real one
        // and an `aria-hidden` shadow it measures with. Grabbing the shadow reads
        // back its single sizing character instead of the value.
        const visibleEditors = (root) => [...root.querySelectorAll('textarea')]
            .filter(t => t.getAttribute('aria-hidden') !== 'true');

        const card = container.querySelector('[data-testid="swarm-start-card"]');
        const editors = visibleEditors(card);
        const template = editors[editors.length - 1];
        expect(template, 'the template row must render an editor').not.toBeUndefined();

        await act(async () => {
            const setter = Object.getOwnPropertyDescriptor(
                window.HTMLTextAreaElement.prototype, 'value').set;
            setter.call(template, 'half-typed requirement');
            template.dispatchEvent(new Event('input', { bubbles: true }));
        });
        await flush();

        await pick(container, 'swarm-start-sort-newest');

        const after = visibleEditors(container.querySelector('[data-testid="swarm-start-card"]'));
        const templateAfter = after[after.length - 1];
        // The seeding effect re-runs on a sort pick; a fresh template would
        // discard this silently.
        expect(templateAfter.value).toBe('half-typed requirement');
    });
});
