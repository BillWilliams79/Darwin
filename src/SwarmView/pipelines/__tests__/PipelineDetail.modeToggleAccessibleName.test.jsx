// @vitest-environment jsdom
//
// Req #3281 — the plan-page mode toggle is icon-only and had NO accessible
// name: MUI's Tooltip was wrapping the icon INSIDE the ToggleButton, so
// SvgIcon's `aria-hidden={titleAccess ? undefined : true}` pulled the named
// element out of the accessibility tree and the button itself named nothing.
// The fix moves the Tooltip outside the ToggleButton (SwarmView.jsx's
// existing, correct shape) so MUI injects the title as the BUTTON's
// aria-label. This is the accessible-name coverage the requirement says never
// existed for this control.

import { describe, it, expect, afterEach, vi } from 'vitest';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// The real registry's Plan entry pulls in react-konva at module load, which
// needs a `canvas` binding jsdom does not provide. Rather than replacing the
// whole registry (which would leave a real third mode with no coverage —
// req #3281 code review), stub only the two panel bodies so
// `pipelineDetailModes.js` itself, its labels and its icons stay real. That
// is what SvgIcon's aria-hidden dance operates on, and it is the whole point
// of this test: to prove the BUTTON, not the icon, ends up named.
vi.mock('../PipelinePlanTable', () => ({ default: () => <div data-testid="mode-table" /> }));
vi.mock('../PipelinePlanVisualizer', () => ({ default: () => <div data-testid="mode-plan" /> }));

vi.mock('../../../RestApi/RestApi', () => ({ default: vi.fn(() => Promise.resolve({ httpStatus: { httpStatus: 200 }, data: [] })) }));

vi.mock('../../../hooks/useDataQueries', async (importOriginal) => {
    const actual = await importOriginal();
    const empty = () => ({ data: [], isLoading: false, isError: false });
    return {
        ...actual,
        useAllPipelines: () => ({
            data: [{ id: 2, title: 'Darwin', pipeline_status: 'active', description: '' }],
            isLoading: false,
        }),
        useAllPipelineSteps: () => ({
            data: [{ id: 47, pipeline_fk: 2, title: 'Session Drain', run: 'auto', notes: null, completed_at: null }],
            isLoading: false,
        }),
        useAllPipelineStepRequirements: empty,
        useAllPipelineStepDeps: empty,
        useAllRequirements: empty,
        useAllFeatures: empty,
        useAllEpics: empty,
        useMachines: empty,
        useAllRequirementSessions: empty,
        useAllSessionCostRollups: empty,
    };
});

import PipelineDetail from '../PipelineDetail';
import { PIPELINE_DETAIL_MODES } from '../pipelineDetailModes';
import AuthContext from '../../../Context/AuthContext';
import AppContext from '../../../Context/AppContext';

let mountedRoots = [];

function mount(url) {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false, staleTime: 0, gcTime: 0, refetchOnWindowFocus: false } },
    });
    const root = createRoot(container);
    act(() => {
        root.render(
            <QueryClientProvider client={queryClient}>
                <AppContext.Provider value={{ darwinUri: 'http://test.local/darwin' }}>
                    <AuthContext.Provider value={{ idToken: 'tok', profile: { userName: 'tester', timezone: 'UTC' } }}>
                        <MemoryRouter initialEntries={[url]}>
                            <Routes>
                                <Route path="/swarm/pipeline/:id" element={<PipelineDetail />} />
                            </Routes>
                        </MemoryRouter>
                    </AuthContext.Provider>
                </AppContext.Provider>
            </QueryClientProvider>
        );
    });
    mountedRoots.push(root);
}

const node = (testId) => document.body.querySelector(`[data-testid="${testId}"]`);

afterEach(() => {
    act(() => { mountedRoots.forEach(r => r.unmount()); });
    document.body.innerHTML = '';
    mountedRoots = [];
    localStorage.clear();
    sessionStorage.clear();
    vi.restoreAllMocks();
});

describe('PipelineDetail — mode toggle accessible name (req #3281)', () => {
    it('gives every icon-only mode button a non-empty accessible name', () => {
        mount('/swarm/pipeline/2');
        for (const { value, label } of PIPELINE_DETAIL_MODES) {
            const btn = node(`pipeline-mode-${value}`);
            expect(btn, `expected a rendered button for mode "${value}"`).not.toBeNull();
            // MUI's Tooltip injects its `title` as the wrapped child's
            // aria-label when the child sets none of its own. Wrapping the
            // BUTTON (rather than the icon inside it) is what makes this the
            // button's own accessible name rather than a name on an
            // aria-hidden descendant the accessibility tree never sees.
            expect(btn.getAttribute('aria-label')).toBe(`${label} View`);
        }
    });

    it('never puts the Tooltip title on the icon instead of the button', () => {
        mount('/swarm/pipeline/2');
        for (const { value } of PIPELINE_DETAIL_MODES) {
            const btn = node(`pipeline-mode-${value}`);
            const icon = btn.querySelector('svg');
            // The regression shape wrapped the icon in the Tooltip, which
            // left the SvgIcon carrying the title/aria-hidden dance and the
            // BUTTON with nothing. Assert the icon is a plain, un-named,
            // non-hidden decorative child now that the button owns the name.
            expect(icon).not.toBeNull();
            expect(icon.getAttribute('aria-label')).toBeNull();
        }
    });
});
