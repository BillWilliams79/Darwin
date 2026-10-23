// @vitest-environment jsdom
//
// /swarm/engines and the plan page's Engine mode, mounted over the engine
// tables (req #3760). The rows are `engineViewFixture.json` — four engines
// whose records `core.decide()` produced — served through a live test store,
// so a test can publish a new cycle and watch the page follow it.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../../../RestApi/RestApi', () => ({
    default: vi.fn(() => Promise.resolve({ httpStatus: { httpStatus: 200 }, data: [] })),
}));

vi.mock('../../../hooks/useDataQueries', async (importOriginal) => {
    const actual = await importOriginal();
    const store = await import('./engineTestStore');
    const records = (opts = {}) => {
        const r = store.useTable('engine_decision_records');
        return opts.enabled === false ? { data: undefined, isLoading: false, isError: false } : r;
    };
    return {
        ...actual,
        useEngineStates: () => store.useTable('engine_states'),
        useEngineHeartbeats: () => store.useTable('engine_heartbeats'),
        useEngineDecisionRecords: (_c, opts) => records(opts),
        useEngineDecisionRecordsByPipeline: (_c, pid, opts = {}) => {
            const r = records(opts);
            return r.data ? { ...r, data: r.data.filter((x) => x.pipeline_fk === pid) } : r;
        },
        useEngineDecisionRecord: (_c, id) => {
            const t = store.useTables();
            return { data: id == null ? undefined : t.engine_decision_records.find((r) => r.id === id),
                isLoading: false, isError: false };
        },
        useEngineOutcomesByRecord: (_c, id) => {
            const t = store.useTables();
            return { data: t.engine_outcomes.filter((o) => o.record_fk === id), isLoading: false, isError: false };
        },
        useMachines: () => store.useTable('machines'),
        useAllPipelines: () => store.useTable('pipelines'),
        useAllInitiatives: () => store.useTable('initiatives'),
        useAllPipelineEpics: () => store.useTable('epics'),
    };
});

import EnginesPage from '../EnginesPage';
import EngineScopeView from '../EngineScopeView';
import AuthContext from '../../../Context/AuthContext';
import AppContext from '../../../Context/AppContext';
import { FIXTURE_NOW, resetEngineStore, updateEngineStore } from './engineTestStore';
import fixture from './engineViewFixture.json';

let roots = [];
let lastPath = null;

function Where() {
    const loc = useLocation();
    lastPath = `${loc.pathname}${loc.search}`;
    return null;
}

function mount(element, url = '/swarm/engines') {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    const root = createRoot(container);
    act(() => {
        root.render(
            <QueryClientProvider client={client}>
                <AppContext.Provider value={{ darwinUri: 'http://test.local/darwin' }}>
                    <AuthContext.Provider value={{ idToken: 'tok', profile: { userName: 'u', timezone: 'UTC' } }}>
                        <MemoryRouter initialEntries={[url]}>
                            <Where />
                            <Routes>
                                <Route path="/swarm/engines" element={element} />
                                <Route path="/swarm/pipeline/:id" element={<div data-testid="plan-page" />} />
                            </Routes>
                        </MemoryRouter>
                    </AuthContext.Provider>
                </AppContext.Provider>
            </QueryClientProvider>,
        );
    });
    roots.push(root);
}

const $ = (id) => document.body.querySelector(`[data-testid="${id}"]`);
const text = (id) => ($(id) ? $(id).textContent : null);
const click = (el) => act(() => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); });

beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(FIXTURE_NOW);
    resetEngineStore();
});

afterEach(() => {
    act(() => { roots.forEach((r) => r.unmount()); });
    roots = [];
    document.body.innerHTML = '';
    vi.useRealTimers();
});

describe('/swarm/engines — every engine, machine-wide', () => {
    it('draws one panel per engine, grouped by machine, with a summary', () => {
        mount(<EnginesPage />);
        expect(document.body.querySelectorAll('[data-testid^="engine-panel-"]')).toHaveLength(4);
        expect(text('engines-summary')).toBe('4 engines · 2 beating · 1 missing · 1 off');
        expect(text('engine-machine-group-1')).toContain('Mac mini');
    });

    it('shows the latest decision of each engine, in plain words with the cut line', () => {
        mount(<EnginesPage />);
        // machine 4 (dependency-priority): its latest is cycle 2.
        expect(text('engine-cycle-4')).toContain('Cycle 2');
        const items = [...$('engine-queue-4').querySelectorAll('[data-testid^="engine-queue-item-4-"]')];
        expect(items.map((i) => i.getAttribute('data-code'))).toEqual(['IN_FLIGHT', 'CAPACITY', 'IN_FLIGHT']);
        // The cut sits before the second item, where the record put it.
        const cut = $('engine-cut-4');
        expect(cut).not.toBeNull();
        expect(cut.nextElementSibling.getAttribute('data-testid')).toBe('engine-queue-item-4-3002');
        expect(text('engine-queue-item-4-3002')).toContain('no free slot');
    });

    it('says a silent engine is MISSING by the age of its last beat', () => {
        mount(<EnginesPage />);
        expect($('engine-panel-2').getAttribute('data-health')).toBe('missing');
        expect(text('engine-missing-2')).toContain('No heartbeat for 15m');
        expect(text('engine-heartbeat-2')).toContain('last beat 15m ago');
        expect(text('engine-heartbeat-2')).toContain('missing after 3m');
        // ...and still shows the decision it last made.
        expect($('engine-decision-2')).not.toBeNull();
    });

    it('draws an engine that is OFF greyed, with its last record and when it stopped', () => {
        mount(<EnginesPage />);
        expect($('engine-panel-3').getAttribute('data-off')).toBe('true');
        expect(text('engine-off-3')).toMatch(/Turned off — stopped .*\(4m ago\)/);
        expect(getComputedStyle($('engine-body-3')).opacity).toBe('0.5');
        expect(getComputedStyle($('engine-body-1')).opacity).toBe('1');
        expect(text('engine-cycle-3')).toContain('Cycle 6');
        expect(text('engine-supervisor-3')).toContain('stopped — stopped on request');
    });

    it('scrubs the history back to an earlier cycle and returns to the latest', () => {
        mount(<EnginesPage />);
        const rows = fixture.engine_decision_records.filter((r) => r.machine_fk === 3);
        // Cycle 2 of machine 3 is the withheld derivation: an empty queue.
        click($(`engine-history-cell-3-${rows[1].id}`));
        expect(text('engine-cycle-3')).toContain('Cycle 2');
        expect($('engine-queue-empty-3')).not.toBeNull();
        expect(text('engine-verdict-3')).toBe('BUDGET-DERIVED-ONLY');
        expect(text('engine-changes-3')).toContain('verdict NO-PAUSE-DERIVATION → BUDGET-DERIVED-ONLY');
        expect($('engine-pinned-3')).not.toBeNull();
        click($('engine-history-prev-3'));
        expect(text('engine-cycle-3')).toContain('Cycle 1');
        click($('engine-history-latest-3'));
        expect(text('engine-cycle-3')).toContain('Cycle 6');
        expect($('engine-pinned-3')).toBeNull();
    });

    it('shows each new cycle as its record arrives, and keeps a scrubbed view still', () => {
        mount(<EnginesPage />);
        const latest = fixture.engine_decision_records.filter((r) => r.machine_fk === 4).slice(-1)[0];
        const first = fixture.engine_decision_records.find((r) => r.machine_fk === 4);
        // Pin engine 1 to an earlier cycle; engine 4 keeps following.
        const e1 = fixture.engine_decision_records.filter((r) => r.machine_fk === 1);
        click($(`engine-history-cell-1-${e1[2].id}`));
        act(() => {
            updateEngineStore((t) => ({
                engine_decision_records: [...t.engine_decision_records,
                    { ...first, id: 2001, seq: 3, record: { ...first.record, cycle: { ...first.record.cycle, seq: 3 } } },
                    { ...e1[0], id: 2002, seq: 8, record: { ...e1[0].record, cycle: { ...e1[0].record.cycle, seq: 8 } } }],
            }));
        });
        expect(latest.seq).toBe(2);
        expect(text('engine-cycle-4')).toContain('Cycle 3');
        expect($('engine-cut-4')).not.toBeNull();
        expect(text('engine-cycle-1')).toContain('Cycle 3');   // still pinned
        click($('engine-history-latest-1'));
        expect(text('engine-cycle-1')).toContain('Cycle 8');
    });

    it('follows an epic link into the plan view, framed on that epic', () => {
        mount(<EnginesPage />);
        const link = $('engine-epic-row-link-4-102');
        expect(link.getAttribute('href')).toBe('/swarm/pipeline/900?mode=plan&epic=102&level=3');
        click(link);
        expect($('plan-page')).not.toBeNull();
        expect(lastPath).toBe('/swarm/pipeline/900?mode=plan&epic=102&level=3');
    });

    it('an engine switched off that the supervisor has not stopped yet says it is still stopping', () => {
        updateEngineStore((t) => ({ engine_states: t.engine_states.map((s) => (s.machine_fk === 3
            ? { ...s, actual_state: 'running' } : s)) }));
        mount(<EnginesPage />);
        expect(text('engine-off-3')).toContain('Switched off at');
        expect(text('engine-off-3')).toContain('still stopping: the supervisor reports running');
    });

    it('picking the newest cycle follows it; a pinned cycle that ages out says so', () => {
        mount(<EnginesPage />);
        const rows = fixture.engine_decision_records.filter((r) => r.machine_fk === 1);
        click($(`engine-history-cell-1-${rows[rows.length - 1].id}`));
        expect($('engine-pinned-1')).toBeNull();
        click($(`engine-history-cell-1-${rows[1].id}`));
        expect($('engine-pinned-1')).not.toBeNull();
        act(() => {
            updateEngineStore((t) => ({ engine_decision_records:
                t.engine_decision_records.filter((r) => r.id !== rows[1].id) }));
        });
        expect($('engine-pinned-1')).toBeNull();
        expect(text('engine-aged-out-1')).toContain('aged out of the stored history');
        expect(text('engine-cycle-1')).toContain('Cycle 7');
    });

    it('says when there is no engine at all', () => {
        resetEngineStore({ engine_states: [], engine_heartbeats: [], engine_decision_records: [] });
        mount(<EnginesPage />);
        expect(text('engine-list-empty')).toContain('No orchestration engine has published anything yet');
    });
});

describe('the plan page\'s Engine mode — the engines of one plan', () => {
    it('shows the plan\'s engines and nothing else', () => {
        mount(<EngineScopeView pipeline={{ id: 900 }} timezone="UTC" />);
        expect(document.body.querySelectorAll('[data-testid^="engine-panel-"]')).toHaveLength(4);
    });

    it('says when no engine has run on the plan, and points at the Engines page', () => {
        mount(<EngineScopeView pipeline={{ id: 7 }} timezone="UTC" />);
        expect(text('engine-list-empty')).toContain('No engine has run on this plan');
        expect($('engine-list-empty').querySelector('a').getAttribute('href')).toBe('/swarm/engines');
    });
});
