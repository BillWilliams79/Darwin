// @vitest-environment jsdom
//
// Req #3281 — the same icon-inside-Tooltip-inside-ToggleButton shape found in
// PipelineDetail.jsx was copied into this sibling page's Cards/Table view
// toggle. MUI's Tooltip wrapping the icon rather than the ToggleButton left
// the icon aria-hidden and the button unnamed. Req #3282 (landed concurrently
// — converged this page's header onto the canonical `ViewerHeader`) fixed it
// here as a side effect: `ViewerHeader` wraps the Tooltip AROUND the button
// and sets an explicit `aria-label`. This pins that behavior at the
// PipelinesPage integration level rather than trusting it stayed fixed.

import { describe, it, expect, afterEach, vi } from 'vitest';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { MemoryRouter } from 'react-router-dom';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../../../RestApi/RestApi', () => ({ default: vi.fn(() => Promise.resolve({ httpStatus: { httpStatus: 200 }, data: [] })) }));

vi.mock('../../../hooks/useDataQueries', async (importOriginal) => {
    const actual = await importOriginal();
    const empty = () => ({ data: [], isLoading: false, isError: false });
    return {
        ...actual,
        useAllPipelines: empty,
        useAllPipelineSteps: empty,
        useAllPipelineStepRequirements: empty,
        useAllRequirements: empty,
        useMachines: empty,
        useOrchestrationClaims: empty,
    };
});

import PipelinesPage from '../PipelinesPage';
import AuthContext from '../../../Context/AuthContext';

let mountedRoots = [];

function mount() {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => {
        root.render(
            <AuthContext.Provider value={{ profile: { userName: 'tester', timezone: 'UTC' } }}>
                <MemoryRouter initialEntries={['/swarm/pipelines']}>
                    <PipelinesPage />
                </MemoryRouter>
            </AuthContext.Provider>
        );
    });
    mountedRoots.push(root);
}

const node = (testId) => document.body.querySelector(`[data-testid="${testId}"]`);

afterEach(() => {
    act(() => { mountedRoots.forEach(r => r.unmount()); });
    document.body.innerHTML = '';
    mountedRoots = [];
    sessionStorage.clear();
    localStorage.clear();
    vi.restoreAllMocks();
});

describe('PipelinesPage — view toggle accessible name (req #3281)', () => {
    it('gives every icon-only view button a non-empty accessible name', () => {
        mount();
        const cases = [
            { testId: 'view-toggle-cards', name: 'Cards view' },
            { testId: 'view-toggle-table', name: 'Table view' },
        ];
        for (const { testId, name } of cases) {
            const btn = node(testId);
            expect(btn, `expected a rendered button for "${testId}"`).not.toBeNull();
            expect(btn.getAttribute('aria-label')).toBe(name);
        }
    });

    it('never puts the Tooltip title on the icon instead of the button', () => {
        mount();
        for (const testId of ['view-toggle-cards', 'view-toggle-table']) {
            const btn = node(testId);
            const icon = btn.querySelector('svg');
            expect(icon).not.toBeNull();
            expect(icon.getAttribute('aria-label')).toBeNull();
        }
    });
});
