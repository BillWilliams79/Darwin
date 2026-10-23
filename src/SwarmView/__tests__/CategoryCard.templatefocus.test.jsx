// @vitest-environment jsdom
//
// Req #2884 reproduction harness — does a background-refetch re-seed of
// `requirementsArray` steal focus from the template title field in the card view?
// Mounts the REAL CategoryCard, focuses the template <textarea>, then simulates a
// background refetch returning new `serverRequirements` (the refetchOnWindowFocus
// path) and asserts whether focus survives.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DarwinDndContext } from '../../dnd';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('react-router-dom', () => ({ useNavigate: () => () => {} }));

// Controllable query data. useRequirements returns the current module-level array
// (a new reference per re-seed); useSessions stays a stable empty list.
let reqData = [{ id: 10, title: 'Existing req', requirement_status: 'authoring', category_fk: 5, sort_order: 0 }];
const EMPTY_SESSIONS = [];
// req #3419 — MODULE-LEVEL, never an inline `[]` literal. Each of these is a
// query double called on every render; a fresh array each time churns the id
// Sets in `useRequirementVisibility`, which churns every predicate and filtered
// array downstream, which re-runs the seeding effect, which sets state — a
// SYNCHRONOUS render loop that no per-test timeout can interrupt. Measured in
// review: it wedged the worker rather than failing a test.
const EMPTY_JUNCTION = [];
const EMPTY_ALL_REQS = [];

vi.mock('../../hooks/useDataQueries', () => ({
    useRequirements: () => ({ data: reqData }),
    useSessions: () => ({ data: EMPTY_SESSIONS }),
    useAllRequirements: () => ({ data: EMPTY_ALL_REQS }),

    // req #3419 — the three bounded reads `useRequirementVisibility` joins.
    // The REAL hook runs here rather than a double: it owns the memoization the
    // aggregator's `useMemo` chain depends on, and a stand-in that got that
    // wrong would loop rather than fail. `ALL_ROWS` is re-exported because the
    // hook passes it (a closed initiative still seats its requirements).
    useAllPipelineEpicRequirements: () => ({ data: EMPTY_JUNCTION }),
    ALL_ROWS: 'all',
}));

vi.mock('../../RestApi/RestApi', () => ({ default: vi.fn(() => Promise.resolve({ httpStatus: { httpStatus: 200 }, data: [] })) }));

import CategoryCard from '../CategoryCard';
import AuthContext from '../../Context/AuthContext';
import AppContext from '../../Context/AppContext';
import { useSnackBarStore } from '../../stores/useSnackBarStore';

const CATEGORY = { id: 5, category_name: 'Test Cat', project_fk: 1, sort_mode: 'process', color: null };
const noop = () => {};

let bumpHarness;
function Harness() {
    const [, setTick] = useState(0);
    bumpHarness = () => setTick((t) => t + 1);
    return (
        <CategoryCard
            category={CATEGORY}
            categoryIndex={0}
            projectId={1}
            categoryChange={noop}
            categoryKeyDown={noop}
            categoryOnBlur={noop}
            clickCardClosed={noop}
            clickCardDelete={noop}
            isTemplate={false}
            showClosed={false}
        />
    );
}

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
                        <DarwinDndContext>
                            <Harness />
                        </DarwinDndContext>
                    </AuthContext.Provider>
                </AppContext.Provider>
            </QueryClientProvider>
        );
    });
    return { container };
}

function templateTextarea(container) {
    return container.querySelector('[data-testid="requirement-template"] textarea:not([aria-hidden="true"])');
}

describe('CategoryCard template title keeps focus across a background re-seed (req #2884)', () => {
    beforeEach(() => {
        reqData = [{ id: 10, title: 'Existing req', requirement_status: 'authoring', category_fk: 5, sort_order: 0 }];
        roots = [];
        window.__darwinFocusLoss = [];
    });
    afterEach(() => {
        // Leave the field the way a reader would (a press elsewhere, then the
        // blur): unmounting a focused template IS a remount, and the req #3632
        // recorder would otherwise report the teardown itself.
        act(() => {
            document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
            document.activeElement?.blur?.();
        });
        act(() => { roots.forEach((r) => r.unmount()); });
        document.body.innerHTML = '';
    });

    // req #3419 — explicit timeout. This file mounts the REAL CategoryCard,
    // which since this requirement resolves visibility through three live
    // queries before it can seed a row. Measured at 4.2s on a loaded machine
    // against vitest's 5s default — passing, but close enough that the suite
    // flakes. The work is slow, not hung; the same allowance its sibling
    // CategoryCard specs already carry.
    it('keeps focus on the template title when serverRequirements refetches', async () => {
        const { container } = mount();

        const ta = templateTextarea(container);
        expect(ta).not.toBeNull();

        // User clicks into the template title field.
        await act(async () => { ta.focus(); });
        expect(document.activeElement).toBe(ta);

        // Background refetch lands: a NEW requirement appears, shifting the template's
        // index (1 → 2). This is the decisive case for index-vs-key reconciliation.
        await act(async () => {
            reqData = [
                { id: 10, title: 'Existing req', requirement_status: 'authoring', category_fk: 5, sort_order: 0 },
                { id: 11, title: 'Brand new req', requirement_status: 'authoring', category_fk: 5, sort_order: 1 },
            ];
            bumpHarness();
        });
        await act(async () => { await Promise.resolve(); await Promise.resolve(); });

        // The template field must still be focused.
        const taAfter = templateTextarea(container);
        expect(taAfter).not.toBeNull();
        expect(document.activeElement).toBe(taAfter);
        // req #3632 — and the always-on recorder saw no loss: the re-seed is
        // exactly the scenario under investigation, so it must stay silent.
        await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
        expect(window.__darwinFocusLoss).toHaveLength(0);
    }, 30000);

    // req #3632 — the always-on focus-loss capture is wired to the real template
    // row: a steal names its culprit in the snackbar and lands in the report.
    it('names the culprit in the snackbar when focus is taken from the template title', async () => {
        const { container } = mount();
        const ta = templateTextarea(container);
        const thief = document.createElement('button');
        thief.setAttribute('data-testid', 'focus-thief');
        document.body.appendChild(thief);
        useSnackBarStore.setState({ open: false, message: '' });
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        try {
            await act(async () => { ta.focus(); });
            await act(async () => { thief.focus(); await new Promise((r) => setTimeout(r, 0)); });

            const { open, message, duration, action } = useSnackBarStore.getState();
            expect(open).toBe(true);
            expect(message).toContain('Focus taken from template title (Test Cat) — focus-stolen: button[testid=focus-thief]');
            expect(duration).toBe(30000);
            expect(window.__darwinFocusLoss).toHaveLength(1);

            // req #3652 — the alert's button puts the capture on the clipboard.
            expect(action.label).toBe('Copy for Claude');
            const writeText = vi.fn(() => Promise.resolve());
            Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
            await act(async () => { await action.onClick(); });
            const pasted = writeText.mock.calls[0][0];
            expect(pasted).toContain('paste this whole block to Claude');
            const capture = JSON.parse(pasted.split('```json\n')[1].split('\n```')[0]);
            expect(capture.reason).toBe('focus-loss alert');
            expect(capture.alertedLoss).toBe(window.__darwinFocusLoss[0].at);
            expect(useSnackBarStore.getState().message).toBe('Focus capture copied — paste it to Claude.');
        } finally {
            warn.mockRestore();
        }
    }, 30000);
});
