// @vitest-environment jsdom
//
// Characterization (req #4117): how often the engine view and the plan overlay
// poll (req #4122 "Engine view polling", memory/pipeline-cycle-cost.md
// finding 10). The three live engine tables refetch every POLL_MS
// (30 s, was 15 s before #4122); a full decision record is read once (content-addressed); its
// outcomes poll only while it is the live record; the overlay drops to
// TRANSITION_POLL_MS (3 s) while an engine is coming up or going down; the
// name dictionaries never poll.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const calls = vi.hoisted(() => ({ log: [], states: [] }));

vi.mock('../../../hooks/useDataQueries', async (importOriginal) => {
    const actual = await importOriginal();
    const hook = (name, rows) => (...args) => {
        calls.log.push({ name, args });
        return { data: typeof rows === 'function' ? rows() : rows, isLoading: false, isError: false };
    };
    return {
        ...actual,
        useEngineStates: hook('useEngineStates', () => calls.states),
        useEngineHeartbeats: hook('useEngineHeartbeats', []),
        useEngineDecisionRecords: hook('useEngineDecisionRecords', []),
        useEngineDecisionRecordsByPipeline: hook('useEngineDecisionRecordsByPipeline', []),
        useEngineDecisionRecord: hook('useEngineDecisionRecord', undefined),
        useEngineOutcomesByRecord: hook('useEngineOutcomesByRecord', []),
        useMachines: hook('useMachines', []),
        useAllPipelines: hook('useAllPipelines', []),
        useAllInitiatives: hook('useAllInitiatives', []),
        useAllPipelineEpics: hook('useAllPipelineEpics', []),
        useComposedPipeline: hook('useComposedPipeline', null),
    };
});

import AuthContext from '../../../Context/AuthContext';
import AppContext from '../../../Context/AppContext';
import { POLL_MS, useEngineRecord, useEngineView } from '../useEngineView';
import { TRANSITION_POLL_MS, usePlanEngineOverlay } from '../usePlanEngineOverlay';

let roots = [];
function mount(Probe) {
    const c = document.createElement('div');
    document.body.appendChild(c);
    const root = createRoot(c);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    act(() => {
        root.render(
            <QueryClientProvider client={client}>
                <AppContext.Provider value={{ darwinUri: 'http://test.local/darwin' }}>
                    <AuthContext.Provider value={{ idToken: 'tok', profile: { userName: 'u', timezone: 'UTC' } }}>
                        <Probe />
                    </AuthContext.Provider>
                </AppContext.Provider>
            </QueryClientProvider>);
    });
    roots.push(root);
}

/** The options object (the last argument) of the newest call of `name`. */
const optionsOf = (name) => {
    const hit = calls.log.filter((c) => c.name === name).pop();
    expect(hit, `${name} was called`).toBeTruthy();
    const last = hit.args[hit.args.length - 1];
    return last && typeof last === 'object' && !Array.isArray(last) ? last : {};
};

beforeEach(() => { calls.log = []; calls.states = []; });
afterEach(() => {
    act(() => { roots.forEach((r) => r.unmount()); });
    roots = [];
    document.body.innerHTML = '';
});

describe('engine view polling', () => {
    it('POLL_MS is 30 s and TRANSITION_POLL_MS 3 s', () => {
        expect(POLL_MS).toBe(30000);
        expect(TRANSITION_POLL_MS).toBe(3000);
    });

    it('machine-wide: states, heartbeats and every record poll; the dictionaries do not', () => {
        mount(() => { useEngineView(); return null; });
        expect(optionsOf('useEngineStates').refetchInterval).toBe(POLL_MS);
        expect(optionsOf('useEngineHeartbeats').refetchInterval).toBe(POLL_MS);
        expect(optionsOf('useEngineDecisionRecords')).toMatchObject({ refetchInterval: POLL_MS, enabled: true });
        expect(optionsOf('useEngineDecisionRecordsByPipeline')).toMatchObject({ refetchInterval: POLL_MS, enabled: false });
        for (const name of ['useMachines', 'useAllPipelines', 'useAllInitiatives', 'useAllPipelineEpics']) {
            expect(optionsOf(name).refetchInterval, name).toBeUndefined();
        }
    });

    it('one plan: the plan-scoped record read polls instead of the machine-wide one', () => {
        mount(() => { useEngineView({ pipelineId: 12 }); return null; });
        expect(optionsOf('useEngineDecisionRecords')).toMatchObject({ refetchInterval: POLL_MS, enabled: false });
        const scoped = calls.log.filter((c) => c.name === 'useEngineDecisionRecordsByPipeline').pop();
        expect(scoped.args[1]).toBe(12);
        expect(scoped.args[2]).toMatchObject({ refetchInterval: POLL_MS, enabled: true });
    });

    it('a decision record is read once; its outcomes poll only while it is live', () => {
        mount(() => { useEngineRecord(41, { live: true }); return null; });
        expect(optionsOf('useEngineDecisionRecord')).toMatchObject({ staleTime: Infinity, enabled: true });
        expect(optionsOf('useEngineDecisionRecord').refetchInterval).toBeUndefined();
        expect(optionsOf('useEngineOutcomesByRecord').refetchInterval).toBe(POLL_MS);
        calls.log = [];
        mount(() => { useEngineRecord(41); return null; });
        expect(optionsOf('useEngineOutcomesByRecord').refetchInterval).toBeUndefined();
    });
});

describe('plan overlay polling', () => {
    const MACHINES = [{ id: 1, title: 'mac', closed: 0 }];
    const probe = () => { usePlanEngineOverlay({ pipelineId: 12, machines: MACHINES, claims: [],
        sessions: [], machineOverride: 1 }); return null; };

    it('a steady plan polls the engine tables every POLL_MS', () => {
        mount(probe);
        for (const name of ['useEngineStates', 'useEngineHeartbeats', 'useEngineDecisionRecords']) {
            expect(optionsOf(name), name).toMatchObject({ refetchInterval: POLL_MS, enabled: true });
        }
    });

    it('an engine coming up polls every TRANSITION_POLL_MS', () => {
        calls.states = [{ id: 3, pipeline_fk: 12, initiative_fk: null, machine_fk: 1,
            desired_state: 'on', actual_state: 'starting', actual_detail: null,
            desired_at: new Date().toISOString().slice(0, 19).replace('T', ' ') }];
        mount(probe);
        for (const name of ['useEngineStates', 'useEngineHeartbeats', 'useEngineDecisionRecords']) {
            expect(optionsOf(name).refetchInterval, name).toBe(TRANSITION_POLL_MS);
        }
    });
});
