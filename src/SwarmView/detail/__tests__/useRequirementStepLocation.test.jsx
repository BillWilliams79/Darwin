// @vitest-environment jsdom
//
// Req #3253 — the requirement -> step resolver behind the requirement page's
// "view on plan" link. Pins the three-hop chain (pipeline_step_requirements ->
// pipeline_steps -> pipelines), that a short chain resolves to "no step" rather
// than staying stuck loading, the pipeline tie-break (active first, else lowest
// id — `_resolve_pipeline`'s rule, shared with `useEpicPipelineLocation`), and
// the step tie-break (lowest id WITHIN the winning pipeline).
//
// The sibling `useEpicPipelineLocation.test.jsx` is the model for all of this;
// what is specific here is that the answer is a PAIR, and the two halves have to
// agree — a step id from one plan carried alongside another plan's id is a link
// to a step that plan does not have.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let responses; // { stepLinks, steps, pipelines } -> { status, data }
let calls;

const emptyOk = { status: 200, data: [] };

vi.mock('../../../RestApi/RestApi', () => ({
    default: vi.fn((uri, method) => {
        if (method !== 'GET') return Promise.resolve({ httpStatus: { httpStatus: 200 }, data: [] });
        calls.push(uri);
        const pick = (key) => responses[key] || emptyOk;
        let hit = emptyOk;
        if (uri.includes('/pipeline_step_requirements?requirement_fk=')) hit = pick('stepLinks');
        else if (uri.includes('/pipeline_steps?id=')) hit = pick('steps');
        else if (uri.includes('/pipelines?id=')) hit = pick('pipelines');
        const answer = { httpStatus: { httpStatus: hit.status }, data: hit.data };
        // `hold` lets a fixture keep ONE hop in flight, which is the only way to
        // observe the mid-chain window `isSettled` exists for. Every other
        // fixture resolves immediately.
        return hit.hold ? hit.hold.then(() => answer) : Promise.resolve(answer);
    }),
}));

import { useRequirementStepLocation } from '../useRequirementStepLocation';
import AuthContext from '../../../Context/AuthContext';
import AppContext from '../../../Context/AppContext';

function Host({ requirementId, enabled }) {
    const { pipelineId, stepId, isLoading, isError, isSettled } =
        useRequirementStepLocation('tester', requirementId, { enabled });
    return (
        <div data-testid="result"
             data-pipeline={pipelineId == null ? '' : String(pipelineId)}
             data-step={stepId == null ? '' : String(stepId)}
             data-loading={String(isLoading)}
             data-settled={String(isSettled)}
             data-error={String(isError)} />
    );
}

let mountedRoots = [];

function mount(requirementId, enabled = true) {
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
                        <Host requirementId={requirementId} enabled={enabled} />
                    </AuthContext.Provider>
                </AppContext.Provider>
            </QueryClientProvider>
        );
    });
    mountedRoots.push(root);
}

async function flush() {
    for (let round = 0; round < 10; round++) {
        await act(async () => {
            for (let i = 0; i < 10; i++) await Promise.resolve();
            await new Promise((r) => setTimeout(r, 0));
            for (let i = 0; i < 5; i++) await Promise.resolve();
        });
    }
}

// The LAST mounted host — two tests mount twice and would otherwise assert
// against the first one's answer twice over.
const result = () => [...document.body.querySelectorAll('[data-testid="result"]')].at(-1);
const read = (attr) => result().getAttribute(`data-${attr}`);

describe('useRequirementStepLocation (req #3253)', () => {
    beforeEach(() => {
        mountedRoots = [];
        responses = {};
        calls = [];
    });
    afterEach(() => {
        act(() => { mountedRoots.forEach((r) => r.unmount()); });
        document.body.innerHTML = '';
    });

    it('resolves the step and its plan', async () => {
        responses.stepLinks = { status: 200, data: [{ step_fk: 47 }] };
        responses.steps = { status: 200, data: [{ id: 47, pipeline_fk: 2 }] };
        responses.pipelines = { status: 200, data: [{ id: 2, pipeline_status: 'active' }] };
        mount(42);
        await flush();
        expect(read('step')).toBe('47');
        expect(read('pipeline')).toBe('2');
        expect(read('loading')).toBe('false');
        expect(read('error')).toBe('false');
    });

    it('asks about THIS requirement only — never a widened id list', async () => {
        // The epic resolver deliberately widens through every sibling
        // requirement; this one must not, or the "step" it finds could belong to
        // a different requirement entirely.
        responses.stepLinks = { status: 200, data: [{ step_fk: 47 }] };
        responses.steps = { status: 200, data: [{ id: 47, pipeline_fk: 2 }] };
        responses.pipelines = { status: 200, data: [{ id: 2, pipeline_status: 'active' }] };
        mount(42);
        await flush();
        const linkCall = calls.find((u) => u.includes('/pipeline_step_requirements?'));
        expect(linkCall).toContain('requirement_fk=42');
        expect(linkCall).not.toContain('requirement_fk=(');
    });

    it('resolves null, not stuck loading, for a requirement on no step', async () => {
        responses.stepLinks = { status: 200, data: [] };
        mount(42);
        await flush();
        expect(read('step')).toBe('');
        expect(read('pipeline')).toBe('');
        expect(read('loading')).toBe('false');
    });

    it('picks the ACTIVE pipeline, and the step that is on it', async () => {
        responses.stepLinks = { status: 200, data: [{ step_fk: 12 }, { step_fk: 47 }] };
        responses.steps = { status: 200,
            data: [{ id: 12, pipeline_fk: 9 }, { id: 47, pipeline_fk: 2 }] };
        responses.pipelines = { status: 200, data: [
            { id: 9, pipeline_status: 'draft' },
            { id: 2, pipeline_status: 'active' },
        ] };
        mount(42);
        await flush();
        expect(read('pipeline')).toBe('2');
        // NOT the numerically lower step 12 — that one is on plan 9.
        expect(read('step')).toBe('47');
    });

    it('falls back to the lowest pipeline id when none is active', async () => {
        responses.stepLinks = { status: 200, data: [{ step_fk: 12 }, { step_fk: 47 }] };
        responses.steps = { status: 200,
            data: [{ id: 12, pipeline_fk: 9 }, { id: 47, pipeline_fk: 3 }] };
        responses.pipelines = { status: 200, data: [
            { id: 9, pipeline_status: 'draft' },
            { id: 3, pipeline_status: 'paused' },
        ] };
        mount(42);
        await flush();
        expect(read('pipeline')).toBe('3');
        expect(read('step')).toBe('47');
    });

    it('takes the lowest step id when one plan carries the requirement twice', async () => {
        // Returned high-first: the wire order must not decide it.
        responses.stepLinks = { status: 200, data: [{ step_fk: 91 }, { step_fk: 47 }] };
        responses.steps = { status: 200,
            data: [{ id: 91, pipeline_fk: 2 }, { id: 47, pipeline_fk: 2 }] };
        responses.pipelines = { status: 200, data: [{ id: 2, pipeline_status: 'active' }] };
        mount(42);
        await flush();
        expect(read('step')).toBe('47');
    });

    it('reports a failed read as an error rather than as "no step"', async () => {
        // "Couldn't check" and "checked, there is nothing" are different facts.
        responses.stepLinks = { status: 500, data: null };
        mount(42);
        await flush();
        expect(read('error')).toBe('true');
        expect(read('step')).toBe('');
    });

    it('runs nothing at all without a usable requirement id', async () => {
        // `Number(null)` and `Number('')` are both 0 and 0 is a good id — a
        // route with no id would otherwise query step links for requirement 0.
        for (const id of [null, undefined, '', 'new', 1.5]) {
            calls = [];
            mount(id);
            await flush();
            expect(calls, `id ${String(id)}`).toHaveLength(0);
            expect(read('step')).toBe('');
        }
    });

    // ── `isSettled` — the caller's only way to tell the two nulls apart ──────
    // A null `stepId` means EITHER "no step carries this requirement" OR "not
    // answered yet". The requirement page falls back to the epic link on the
    // first and must not on the second, or it renders — and lets the reader
    // click — the whole-epic fit req #3253 exists to remove.
    it('is not settled while any enabled hop is still pending', async () => {
        // Held open at hop 2, i.e. MID-chain: hop 1 has answered with a step id,
        // so a naive `!isLoading` gate would already read as settled here — that
        // one-render hole is what this flag exists to close.
        let releaseSteps;
        const held = new Promise((r) => { releaseSteps = r; });
        responses.stepLinks = { status: 200, data: [{ step_fk: 47 }] };
        responses.steps = { status: 200, data: [{ id: 47, pipeline_fk: 2 }], hold: held };
        responses.pipelines = { status: 200, data: [{ id: 2, pipeline_status: 'active' }] };
        mount(42);
        await flush();
        expect(read('settled'), 'held mid-chain').toBe('false');
        expect(read('step')).toBe('');
        releaseSteps();
        await flush();
        expect(read('settled')).toBe('true');
        expect(read('step')).toBe('47');
    });

    it('settles on a requirement that is on no step', async () => {
        responses.stepLinks = { status: 200, data: [] };
        mount(42);
        await flush();
        expect(read('settled')).toBe('true');
    });

    it('settles on a FAILED read rather than hanging the caller forever', async () => {
        responses.stepLinks = { status: 500, data: null };
        mount(42);
        await flush();
        expect(read('settled')).toBe('true');
    });

    it('is settled immediately when the chain never runs', async () => {
        mount(null);
        await flush();
        expect(read('settled')).toBe('true');
        mount(42, false);
        await flush();
        expect(read('settled')).toBe('true');
    });

    it('runs nothing when disabled', async () => {
        responses.stepLinks = { status: 200, data: [{ step_fk: 47 }] };
        mount(42, false);
        await flush();
        expect(calls).toHaveLength(0);
        expect(read('step')).toBe('');
    });
});
