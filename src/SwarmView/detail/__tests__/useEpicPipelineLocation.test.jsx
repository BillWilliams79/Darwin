// @vitest-environment jsdom
//
// Req #3235 — the epic -> pipeline resolver behind the requirement page's
// "view on plan" link. Pins the five-hop chain (features -> requirements ->
// pipeline_step_requirements -> pipeline_steps -> pipelines), that a short
// chain resolves to "no pipeline" rather than staying stuck loading, and the
// tie-break (active pipeline first, else lowest id) reused verbatim from
// `_resolve_pipeline` (darwin-mcp/services/requirements.py, req #3186).

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let responses; // { features, requirements, stepLinks, steps, pipelines } -> { status, data }

const emptyOk = { status: 200, data: [] };

vi.mock('../../../RestApi/RestApi', () => ({
    default: vi.fn((uri, method) => {
        if (method !== 'GET') return Promise.resolve({ httpStatus: { httpStatus: 200 }, data: [] });
        const pick = (key) => responses[key] || emptyOk;
        let hit = emptyOk;
        if (uri.includes('/features?epic_fk=')) hit = pick('features');
        else if (uri.includes('/requirements?feature_fk=')) hit = pick('requirements');
        else if (uri.includes('/pipeline_step_requirements?requirement_fk=')) hit = pick('stepLinks');
        else if (uri.includes('/pipeline_steps?id=')) hit = pick('steps');
        else if (uri.includes('/pipelines?id=')) hit = pick('pipelines');
        return Promise.resolve({ httpStatus: { httpStatus: hit.status }, data: hit.data });
    }),
}));

import { useEpicPipelineLocation } from '../useEpicPipelineLocation';
import AuthContext from '../../../Context/AuthContext';
import AppContext from '../../../Context/AppContext';

function Host({ epicId }) {
    const { pipelineId, isLoading, isError } = useEpicPipelineLocation('tester', epicId);
    return (
        <div data-testid="result"
             data-pipeline={pipelineId == null ? '' : String(pipelineId)}
             data-loading={String(isLoading)}
             data-error={String(isError)} />
    );
}

let mountedRoots = [];

function mount(epicId) {
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
                    <AuthContext.Provider value={{ idToken: 'tok', profile: { userName: 'tester' } }}>
                        <Host epicId={epicId} />
                    </AuthContext.Provider>
                </AppContext.Provider>
            </QueryClientProvider>
        );
    });
    mountedRoots.push(root);
}

// Five hops chained through `enabled`, so this needs more rounds than the
// three-hop epic-linkage box test.
async function flush() {
    for (let round = 0; round < 10; round++) {
        await act(async () => {
            for (let i = 0; i < 10; i++) await Promise.resolve();
            await new Promise((r) => setTimeout(r, 0));
            for (let i = 0; i < 5; i++) await Promise.resolve();
        });
    }
}

const result = () => document.body.querySelector('[data-testid="result"]');

describe('useEpicPipelineLocation (req #3235)', () => {
    beforeEach(() => {
        mountedRoots = [];
        responses = {};
    });
    afterEach(() => {
        act(() => { mountedRoots.forEach((r) => r.unmount()); });
        document.body.innerHTML = '';
    });

    it('resolves null, not stuck loading, for an epic with no features', async () => {
        responses.features = { status: 200, data: [] };
        mount(55);
        await flush();

        const el = result();
        expect(el.getAttribute('data-pipeline')).toBe('');
        expect(el.getAttribute('data-loading')).toBe('false');
        expect(el.getAttribute('data-error')).toBe('false');
    });

    it('resolves null when the chain runs dry partway through (features exist, no requirements)', async () => {
        responses.features = { status: 200, data: [{ id: 88 }] };
        responses.requirements = { status: 200, data: [] };
        mount(55);
        await flush();

        const el = result();
        expect(el.getAttribute('data-pipeline')).toBe('');
        expect(el.getAttribute('data-loading')).toBe('false');
    });

    it('resolves the single pipeline at the end of a full chain', async () => {
        responses.features = { status: 200, data: [{ id: 88 }] };
        responses.requirements = { status: 200, data: [{ id: 101 }] };
        responses.stepLinks = { status: 200, data: [{ step_fk: 47 }] };
        responses.steps = { status: 200, data: [{ id: 47, pipeline_fk: 2 }] };
        responses.pipelines = { status: 200, data: [{ id: 2, pipeline_status: 'active' }] };
        mount(55);
        await flush();

        const el = result();
        expect(el.getAttribute('data-pipeline')).toBe('2');
        expect(el.getAttribute('data-loading')).toBe('false');
    });

    it('tie-breaks on the ACTIVE pipeline over a lower id (the _resolve_pipeline rule)', async () => {
        responses.features = { status: 200, data: [{ id: 88 }] };
        responses.requirements = { status: 200, data: [{ id: 101 }] };
        responses.stepLinks = { status: 200, data: [{ step_fk: 10 }, { step_fk: 20 }] };
        responses.steps = { status: 200, data: [{ id: 10, pipeline_fk: 1 }, { id: 20, pipeline_fk: 3 }] };
        responses.pipelines = {
            status: 200,
            data: [
                { id: 1, pipeline_status: 'draft' },
                { id: 3, pipeline_status: 'active' },
            ],
        };
        mount(55);
        await flush();

        expect(result().getAttribute('data-pipeline')).toBe('3');
    });

    it('falls back to the lowest id when no candidate pipeline is active', async () => {
        responses.features = { status: 200, data: [{ id: 88 }] };
        responses.requirements = { status: 200, data: [{ id: 101 }] };
        responses.stepLinks = { status: 200, data: [{ step_fk: 10 }, { step_fk: 20 }] };
        responses.steps = { status: 200, data: [{ id: 10, pipeline_fk: 5 }, { id: 20, pipeline_fk: 3 }] };
        responses.pipelines = {
            status: 200,
            data: [
                { id: 5, pipeline_status: 'aborted' },
                { id: 3, pipeline_status: 'paused' },
            ],
        };
        mount(55);
        await flush();

        expect(result().getAttribute('data-pipeline')).toBe('3');
    });

    it('reports an error rather than a silent "no pipeline" when a hop fails', async () => {
        responses.features = { status: 500, data: [] };
        mount(55);
        await flush();

        const el = result();
        expect(el.getAttribute('data-error')).toBe('true');
        expect(el.getAttribute('data-pipeline')).toBe('');
    });

    it('does nothing for a null epic id', async () => {
        mount(null);
        await flush();

        const el = result();
        expect(el.getAttribute('data-pipeline')).toBe('');
        expect(el.getAttribute('data-loading')).toBe('false');
        expect(el.getAttribute('data-error')).toBe('false');
    });
});
