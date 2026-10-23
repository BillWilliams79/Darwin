// @vitest-environment jsdom
//
// req #3761 — the Lock view, mounted against composed fixtures: lock marks and
// their cascade, the holder outline, the six user actions and the gateway's 423
// echoed in place, and an epic click framing the epic in the full view.

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const navigate = vi.fn();
vi.mock('react-router-dom', async (orig) => ({
    ...(await orig()),
    useNavigate: () => navigate,
}));

const updatePipeline = vi.fn(() => Promise.resolve({}));
vi.mock('../../../Pipelines/pipelinesApi', async (orig) => ({
    ...(await orig()),
    updatePipeline: (...a) => updatePipeline(...a),
}));
const updateInitiative = vi.fn(() => Promise.resolve({}));
vi.mock('../../../Initiatives/initiativesApi', async (orig) => ({
    ...(await orig()),
    updateInitiative: (...a) => updateInitiative(...a),
}));
const updateEpic = vi.fn(() => Promise.resolve({}));
vi.mock('../../../Epics/epicsApi', async (orig) => ({
    ...(await orig()),
    updateEpic: (...a) => updateEpic(...a),
}));

import { composedFixture } from './pipelineComposedFixture';
import { adaptComposedPipeline, buildPlanModel } from '../pipelineAdapter';
import { PLAN_VIZ_PALETTE } from '../pipelinePlanLayout';
import PipelineLockView, { refusalText } from '../PipelineLockView';
import AppContext from '../../../Context/AppContext';
import AuthContext from '../../../Context/AuthContext';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };

const P = PLAN_VIZ_PALETTE;
let root;
let queryClient;

beforeEach(() => {
    navigate.mockClear();
    updatePipeline.mockClear().mockImplementation(() => Promise.resolve({}));
    updateInitiative.mockClear().mockImplementation(() => Promise.resolve({}));
    updateEpic.mockClear().mockImplementation(() => Promise.resolve({}));
});

afterEach(() => {
    if (root) act(() => { root.unmount(); });
    root = null;
    document.body.innerHTML = '';
});

const epic = (id, initiative_fk, title, extra = {}) => ({
    id, initiative_fk, title, run: 'auto', notes: null, not_before: null,
    checkpoint: 1, locked: 0, ...extra,
});

const NOW_STAMP = () => new Date().toISOString().slice(0, 19).replace('T', ' ');

function payloadFor({ pipeline = {}, initiatives, epics } = {}) {
    const payload = composedFixture({
        initiatives: initiatives || [
            { id: 5, title: 'Build', pipeline_fk: 2, sort_order: 1, locked: 0, initiative_status: 'active' },
            { id: 6, title: 'Ship', pipeline_fk: 2, sort_order: 2, locked: 0, initiative_status: 'active' },
        ],
        epics: epics || [epic(10, 5, 'Design'), epic(11, 5, 'Implement'), epic(12, 6, 'Release')],
        epicDeps: [{ id: 1, epic_fk: 11, dep_epic_fk: 10 }],
    });
    Object.assign(payload.pipeline, pipeline);
    return payload;
}

function render(payload, { claims = [], machines = [] } = {}) {
    const plan = adaptComposedPipeline(payload);
    const model = buildPlanModel(payload);
    queryClient = new QueryClient();
    const container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
        root.render(
            <QueryClientProvider client={queryClient}>
                <AppContext.Provider value={{ darwinUri: 'http://test.local/darwin' }}>
                    <AuthContext.Provider
                        value={{ idToken: 'tok', profile: { userName: 'tester', timezone: 'UTC' } }}>
                        <MemoryRouter>
                            <PipelineLockView plan={plan} model={model} pipeline={payload.pipeline}
                                              orchestrationClaims={claims} machines={machines} />
                        </MemoryRouter>
                    </AuthContext.Provider>
                </AppContext.Provider>
            </QueryClientProvider>
        );
    });
}

const q = (id) => document.querySelector(`[data-testid="${id}"]`);
const click = (id) => {
    const el = q(id);
    expect(el, id).not.toBeNull();
    act(() => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
};
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

describe('the three tiers, and no requirement', () => {
    it('draws the pipeline, each initiative and each epic', () => {
        render(payloadFor());
        expect(q('lock-view-pipeline-header').textContent).toContain('Darwin');
        expect(q('lock-view-initiative-5').textContent).toContain('Build');
        expect(q('lock-view-initiative-6').textContent).toContain('Ship');
        expect([10, 11, 12].every((id) => q(`lock-view-epic-${id}`) !== null)).toBe(true);
        expect(q('lock-view-epic-10').textContent).toContain('Design');
        // The condensed view is the point: no requirement is drawn.
        expect(document.querySelector('[data-testid*="requirement"]')).toBeNull();
        expect(document.querySelector('[data-testid*="-req-"]')).toBeNull();
    });

    it('every epic keeps the canvas\' colour: green will-run, yellow barrier, orange manual', () => {
        render(payloadFor({ epics: [
            epic(10, 5, 'Plain', { checkpoint: 0 }),
            epic(11, 5, 'Barrier'),
            epic(12, 6, 'Manual', { run: 'manual', checkpoint: 0 }),
        ] }));
        expect(q('lock-view-epic-10').dataset.frame).toBe(P.epicWillRun);
        expect(q('lock-view-epic-11').dataset.frame).toBe(P.epicBarrier);
        expect(q('lock-view-epic-12').dataset.frame).toBe(P.epicManual);
        // the barrier keeps its mark; a non-barrier has none
        expect(q('lock-view-epic-barrier-11')).not.toBeNull();
        expect(q('lock-view-epic-barrier-10')).toBeNull();
    });
});

describe('lock marks and the locked cascade', () => {
    it('a locked initiative marks itself and every epic under it, and nothing else', () => {
        render(payloadFor({ initiatives: [
            { id: 5, title: 'Build', pipeline_fk: 2, sort_order: 1, locked: 1 },
            { id: 6, title: 'Ship', pipeline_fk: 2, sort_order: 2, locked: 0 },
        ] }));
        expect(q('lock-view-initiative-5').dataset).toMatchObject({ locked: '1', lockedBy: 'initiative' });
        expect(q('lock-view-initiative-6').dataset.locked).toBe('0');
        expect(q('lock-view-epic-10').dataset).toMatchObject({ locked: '1', lockedBy: 'initiative' });
        expect(q('lock-view-epic-11').dataset.locked).toBe('1');
        expect(q('lock-view-epic-12').dataset.locked).toBe('0');
        // the locked epics wear the locked colour, the free one its own
        expect(q('lock-view-epic-10').dataset.frame).toBe(P.lockedFrame);
        expect(q('lock-view-epic-12').dataset.frame).not.toBe(P.lockedFrame);
        expect(q('lock-view-pipeline').dataset.locked).toBe('0');
        // the padlock agrees with the mark
        expect(q('lock-view-initiative-lock-5').dataset.locked).toBe('1');
        expect(q('lock-view-epic-lock-10').dataset.locked).toBe('1');
        expect(q('lock-view-epic-lock-12').dataset.locked).toBe('0');
        expect(q('lock-view').dataset).toMatchObject({ lockedInitiatives: '1', lockedEpics: '2' });
    });

    it('a locked pipeline locks everything under it', () => {
        render(payloadFor({ pipeline: { locked: 1 } }));
        expect(q('lock-view-pipeline').dataset.locked).toBe('1');
        [5, 6].forEach((id) => expect(q(`lock-view-initiative-${id}`).dataset)
            .toMatchObject({ locked: '1', lockedBy: 'pipeline' }));
        [10, 11, 12].forEach((id) => expect(q(`lock-view-epic-${id}`).dataset)
            .toMatchObject({ locked: '1', lockedBy: 'pipeline' }));
    });

    it('an epic locked on its own is the only locked thing', () => {
        render(payloadFor({ epics: [epic(10, 5, 'Design', { locked: 1 }), epic(11, 5, 'Implement'), epic(12, 6, 'Release')] }));
        expect(q('lock-view-epic-10').dataset).toMatchObject({ locked: '1', lockedBy: 'epic' });
        expect(q('lock-view-epic-11').dataset.locked).toBe('0');
        expect(q('lock-view-initiative-5').dataset.locked).toBe('0');
    });
});

describe('pause marks', () => {
    it('a paused initiative shows its red bubble and says paused; its sibling does not', () => {
        render(payloadFor({ initiatives: [
            { id: 5, title: 'Build', pipeline_fk: 2, sort_order: 1, locked: 0, initiative_status: 'paused' },
            { id: 6, title: 'Ship', pipeline_fk: 2, sort_order: 2, locked: 0, initiative_status: 'active' },
        ] }));
        expect(q('lock-view-initiative-5').dataset.paused).toBe('1');
        expect(q('lock-view-initiative-5').textContent).toContain('paused');
        expect(q('lock-view-initiative-6').dataset.paused).toBe('0');
        expect(q('lock-view-initiative-pause-5').dataset.paused).toBe('1');
        expect(q('lock-view').dataset.pausedInitiatives).toBe('1');
        const bubble = (id) => getComputedStyle(q(`lock-view-initiative-bubble-${id}`)).backgroundColor;
        expect(bubble(5)).not.toBe(bubble(6));
    });

    it('a paused pipeline marks itself and every initiative under it', () => {
        render(payloadFor({ pipeline: { pipeline_status: 'paused' } }));
        expect(q('lock-view-pipeline').dataset.paused).toBe('1');
        expect(q('lock-view-initiative-5').dataset).toMatchObject({ paused: '1', pausedBy: 'pipeline' });
        expect(q('lock-view-initiative-6').dataset.paused).toBe('1');
    });

    it('a draft pipeline\'s pause control is disabled', () => {
        render(payloadFor({ pipeline: { pipeline_status: 'draft' } }));
        expect(q('lock-view-pipeline-pause').disabled).toBe(true);
    });
});

describe('the engine holder outline', () => {
    const machines = [
        { id: 7, title: 'Mac Mini', platform: 'darwin' },
        { id: 8, title: 'MCHP Windows', platform: 'wsl' },
    ];
    const claim = (id, extra = {}) => ({
        id, pipeline_fk: 2, initiative_fk: null, machine_fk: 7,
        claimed_at: NOW_STAMP(), update_ts: NOW_STAMP(), ...extra,
    });

    it('outlines the initiative an engine is working, in the lead tone, and names its machine and role', () => {
        render(payloadFor(), { claims: [claim(1, { initiative_fk: 6 })], machines });
        expect(q('lock-view-initiative-6').dataset.held).toBe('1');
        expect(q('lock-view-initiative-5').dataset.held).toBe('0');
        expect(q('lock-view-pipeline').dataset.held).toBe('0');
        const holder = q('lock-view-initiative-holder-1');
        expect(holder.dataset).toMatchObject({ tone: 'lead', role: 'lead' });
        expect(holder.textContent).toContain('Mac Mini');
        expect(holder.textContent).toContain('lead');
        expect(holder.textContent).toContain('Mac');
        expect(holder.getAttribute('aria-label')).toMatch(/Mac Mini/);
    });

    it('outlines the whole pipeline for a whole-pipeline claim', () => {
        render(payloadFor(), { claims: [claim(1)], machines });
        expect(q('lock-view-pipeline').dataset.held).toBe('1');
        expect(q('lock-view-pipeline-holder-1').dataset.tone).toBe('lead');
        expect(q('lock-view-initiative-5').dataset.held).toBe('0');
    });

    it('a second machine on the same scope is drawn as a subscriber, in the orange tone', () => {
        render(payloadFor(), {
            claims: [claim(1, { initiative_fk: 5 }), claim(2, { initiative_fk: 5, machine_fk: 8 })], machines,
        });
        expect(q('lock-view-initiative-holder-1').dataset.role).toBe('lead');
        expect(q('lock-view-initiative-holder-2').dataset).toMatchObject({ role: 'subscriber', tone: 'subscriber' });
    });

    it('a stale claim is drawn dashed and grey, not as a live engine', () => {
        render(payloadFor(), {
            claims: [claim(1, { initiative_fk: 5, claimed_at: '2020-01-01 00:00:00', update_ts: '2020-01-01 00:00:00' })],
            machines,
        });
        expect(q('lock-view-initiative-holder-1').dataset).toMatchObject({ tone: 'stale', role: 'stale' });
    });
});

describe('the six user actions write through the existing helpers', () => {
    it('lock / unlock the pipeline', async () => {
        render(payloadFor());
        click('lock-view-pipeline-lock');
        await flush();
        expect(updatePipeline).toHaveBeenCalledWith('http://test.local/darwin', 'tok', 2, { locked: 1 });
    });

    it('unlocking a locked pipeline writes locked 0', async () => {
        render(payloadFor({ pipeline: { locked: 1 } }));
        click('lock-view-pipeline-lock');
        await flush();
        expect(updatePipeline).toHaveBeenCalledWith('http://test.local/darwin', 'tok', 2, { locked: 0 });
    });

    it('pause / unpause the pipeline', async () => {
        render(payloadFor());
        click('lock-view-pipeline-pause');
        await flush();
        expect(updatePipeline).toHaveBeenCalledWith('http://test.local/darwin', 'tok', 2, { pipeline_status: 'paused' });
        act(() => { root.unmount(); });
        document.body.innerHTML = '';
        render(payloadFor({ pipeline: { pipeline_status: 'paused' } }));
        click('lock-view-pipeline-pause');
        await flush();
        expect(updatePipeline).toHaveBeenLastCalledWith('http://test.local/darwin', 'tok', 2, { pipeline_status: 'active' });
    });

    it('lock / unlock an initiative', async () => {
        render(payloadFor());
        click('lock-view-initiative-lock-5');
        await flush();
        expect(updateInitiative).toHaveBeenCalledWith('http://test.local/darwin', 'tok', 5, { locked: 1 });
        act(() => { root.unmount(); });
        document.body.innerHTML = '';
        render(payloadFor({ initiatives: [
            { id: 5, title: 'Build', pipeline_fk: 2, sort_order: 1, locked: 1 },
            { id: 6, title: 'Ship', pipeline_fk: 2, sort_order: 2, locked: 0 },
        ] }));
        click('lock-view-initiative-lock-5');
        await flush();
        expect(updateInitiative).toHaveBeenLastCalledWith('http://test.local/darwin', 'tok', 5, { locked: 0 });
    });

    it('pause / unpause an initiative', async () => {
        render(payloadFor());
        click('lock-view-initiative-pause-6');
        await flush();
        expect(updateInitiative).toHaveBeenCalledWith('http://test.local/darwin', 'tok', 6, { initiative_status: 'paused' });
        act(() => { root.unmount(); });
        document.body.innerHTML = '';
        render(payloadFor({ initiatives: [
            { id: 5, title: 'Build', pipeline_fk: 2, sort_order: 1, locked: 0, initiative_status: 'paused' },
            { id: 6, title: 'Ship', pipeline_fk: 2, sort_order: 2, locked: 0 },
        ] }));
        click('lock-view-initiative-pause-5');
        await flush();
        expect(updateInitiative).toHaveBeenLastCalledWith('http://test.local/darwin', 'tok', 5, { initiative_status: 'active' });
    });

    it('lock / unlock an epic', async () => {
        render(payloadFor());
        click('lock-view-epic-lock-10');
        await flush();
        expect(updateEpic).toHaveBeenCalledWith('http://test.local/darwin', 'tok', 10, { locked: 1 });
        act(() => { root.unmount(); });
        document.body.innerHTML = '';
        render(payloadFor({ epics: [epic(10, 5, 'Design', { locked: 1 }), epic(11, 5, 'Implement'), epic(12, 6, 'Release')] }));
        click('lock-view-epic-lock-10');
        await flush();
        expect(updateEpic).toHaveBeenLastCalledWith('http://test.local/darwin', 'tok', 10, { locked: 0 });
    });

    it('re-reads the plan after a write lands', async () => {
        render(payloadFor());
        const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
        click('lock-view-epic-lock-10');
        await flush();
        expect(invalidate).toHaveBeenCalled();
        expect(invalidate.mock.calls.some(([a]) => a.queryKey[0] === 'pipeline_compose')).toBe(true);
    });
});

describe('a refusal is echoed in place', () => {
    it('echoes the gateway\'s 423 on the epic whose lock was pressed, in its own words', async () => {
        updateEpic.mockImplementation(() => Promise.reject({
            data: null,
            httpStatus: { httpStatus: 423, httpMessage: 'epics 10 is locked by its initiative 5 — unlock it first' },
        }));
        render(payloadFor());
        click('lock-view-epic-lock-10');
        await flush();
        const echo = q('lock-view-refusal-epic-10');
        expect(echo).not.toBeNull();
        expect(echo.textContent).toBe('Refused (423): epics 10 is locked by its initiative 5 — unlock it first');
        expect(echo.getAttribute('role')).toBe('alert');
        // …only on that epic
        expect(q('lock-view-refusal-epic-11')).toBeNull();
        expect(document.querySelectorAll('[data-testid^="lock-view-refusal-"]')).toHaveLength(1);
    });

    it('echoes it on the initiative and on the pipeline, and clears on the next action', async () => {
        const refuse = () => Promise.reject({ data: null, httpStatus: { httpStatus: 423, httpMessage: 'locked' } });
        updateInitiative.mockImplementation(refuse);
        updatePipeline.mockImplementation(refuse);
        render(payloadFor());
        click('lock-view-initiative-pause-5');
        await flush();
        expect(q('lock-view-refusal-initiative-5').textContent).toBe('Refused (423): locked');
        click('lock-view-pipeline-pause');
        await flush();
        expect(q('lock-view-refusal-pipeline').textContent).toBe('Refused (423): locked');
        // the earlier echo went when the next action started
        expect(q('lock-view-refusal-initiative-5')).toBeNull();
    });

    it('says a non-423 failure as a failure, with its status', async () => {
        updateEpic.mockImplementation(() => Promise.reject({
            data: null, httpStatus: { httpStatus: 500, httpMessage: 'boom' } }));
        render(payloadFor());
        click('lock-view-epic-lock-10');
        await flush();
        expect(q('lock-view-refusal-epic-10').textContent)
            .toBe('Could not change the epic lock (HTTP 500: boom)');
    });

    it('refuses before any write when the lock is an ancestor\'s, and names the level to unlock', async () => {
        render(payloadFor({ pipeline: { locked: 1 } }));
        click('lock-view-epic-lock-10');
        click('lock-view-initiative-lock-5');
        await flush();
        expect(updateEpic).not.toHaveBeenCalled();
        expect(updateInitiative).not.toHaveBeenCalled();
        expect(q('lock-view-refusal-initiative-5').textContent)
            .toBe('This initiative is locked by its pipeline — unlock that first');
        click('lock-view-epic-lock-10');
        expect(q('lock-view-refusal-epic-10').textContent)
            .toBe('This epic is locked by its pipeline — unlock that first');
    });

    it('refusalText words each shape', () => {
        expect(refusalText({ httpStatus: { httpStatus: 423, httpMessage: 'x' } }, 'f')).toBe('Refused (423): x');
        expect(refusalText({ httpStatus: { httpStatus: 423 } }, 'f')).toBe('Refused (423): locked');
        expect(refusalText({ httpStatus: { httpStatus: 503, httpMessage: '' } }, 'f')).toBe('f (HTTP 503)');
        expect(refusalText(new Error('net'), 'f')).toBe('f: net');
        expect(refusalText(undefined, 'f')).toBe('f');
    });
});

describe('an epic click frames the epic in the full view', () => {
    it('navigates to the full plan on that epic', () => {
        render(payloadFor());
        click('lock-view-epic-open-11');
        expect(navigate).toHaveBeenCalledTimes(1);
        const target = navigate.mock.calls[0][0];
        expect(target).toContain('/swarm/pipeline/2');
        expect(target).toContain('mode=plan');
        expect(target).toContain('epic=11');
    });

    it('a click on the padlock is not an epic click', async () => {
        render(payloadFor());
        click('lock-view-epic-lock-11');
        await flush();
        expect(navigate).not.toHaveBeenCalled();
    });
});
