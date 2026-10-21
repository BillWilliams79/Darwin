// @vitest-environment jsdom
//
// Req #3649 — the plan visualizer's two new title-line buttons (the checkpoint,
// the padlock) and the epic chip's padlock write the right stepsApi/epicsApi
// call, and a LOCKED row refuses authoring before any write. jsdom has no
// canvas, so react-konva is stubbed: a Rect that carries a `name` is rendered
// as a real button whose click fires the Rect's `onActivate`. The step card's
// two buttons are HTML since req #3673 and render as themselves.

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('react-konva', () => {
    const Stub = ({ children }) => <div>{typeof children === 'function' ? null : children}</div>;
    return {
        Stage: ({ children }) => <div><canvas data-testid="stage-canvas" />{children}</div>,
        Layer: Stub, Group: Stub,
        Rect: ({ name, onActivate }) => (name
            ? <button type="button" data-testid={name} onClick={() => onActivate?.()} />
            : null),
        Line: () => null, Text: () => null, Path: () => null, Circle: () => null,
        Shape: () => null,
    };
});

vi.mock('konva', () => ({
    default: { Animation: class { start() {} stop() {} } },
}));

const updateStep = vi.fn(() => Promise.resolve({}));
vi.mock('../../../Steps/stepsApi', async (orig) => ({
    ...(await orig()),
    updateStep: (...a) => updateStep(...a),
}));
const updateEpic = vi.fn(() => Promise.resolve({}));
vi.mock('../../../Epics/epicsApi', async (orig) => ({
    ...(await orig()),
    updateEpic: (...a) => updateEpic(...a),
}));

const showError = vi.fn();
vi.mock('../../../stores/useSnackBarStore', () => ({
    useSnackBarStore: (sel) => sel({ showError, showSuccess: vi.fn() }),
}));

import { composedFixture } from './pipelineComposedFixture';
import { adaptComposedPipeline, buildPlanModel } from '../pipelineAdapter';
import { computePlanLayout } from '../pipelinePlanLayout';
import PipelinePlanVisualizer from '../PipelinePlanVisualizer';
import AppContext from '../../../Context/AppContext';
import AuthContext from '../../../Context/AuthContext';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
if (!globalThis.ResizeObserver) {
    globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
}

let root;
let restoreSize;

beforeEach(() => {
    const w = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
    const h = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight');
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 1200 });
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 700 });
    restoreSize = () => {
        if (w) Object.defineProperty(HTMLElement.prototype, 'clientWidth', w);
        if (h) Object.defineProperty(HTMLElement.prototype, 'clientHeight', h);
    };
    updateStep.mockClear();
    updateEpic.mockClear();
    showError.mockClear();
});

afterEach(() => {
    if (root) act(() => { root.unmount(); });
    root = null;
    restoreSize?.();
    document.body.innerHTML = '';
});

const step = (id, epic_fk, title, extra = {}) => ({
    id, epic_fk, title, run: 'auto', notes: null, completed_at: null, not_before: null,
    checkpoint: 1, locked: 0, ...extra,
});

function payloadFor({ epicLocked = 0, planLocked = 0, stepFlags = {} } = {}) {
    const payload = composedFixture({
        epics: [{ id: 5, title: 'Build', pipeline_fk: 2, sort_order: 1, locked: epicLocked },
            { id: 6, title: 'Ship', pipeline_fk: 2, sort_order: 2, locked: 0 }],
        steps: [step(10, 5, 'Design', stepFlags), step(11, 6, 'Implement')],
        stepDeps: [{ id: 1, step_fk: 11, dep_step_fk: 10 }],
    });
    payload.pipeline.locked = planLocked;
    return payload;
}

function render(payload) {
    const plan = adaptComposedPipeline(payload);
    const model = buildPlanModel(payload);
    const container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
        root.render(
            <QueryClientProvider client={new QueryClient()}>
                <AppContext.Provider value={{ darwinUri: 'http://test.local/darwin' }}>
                    <AuthContext.Provider
                        value={{ idToken: 'tok', profile: { userName: 'tester', timezone: 'UTC' } }}>
                        <MemoryRouter>
                            <PipelinePlanVisualizer plan={plan} model={model} levelPref="3"
                                                    pipeline={payload.pipeline} timezone="UTC" />
                        </MemoryRouter>
                    </AuthContext.Provider>
                </AppContext.Provider>
            </QueryClientProvider>
        );
    });
    return plan;
}

const click = (testId) => {
    const el = document.querySelector(`[data-testid="${testId}"]`);
    expect(el, testId).not.toBeNull();
    act(() => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
};
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

describe('the step card\'s checkpoint and padlock (req #3649, #3673)', () => {
    it('draws both buttons on every card and the flag writes checkpoint=0 then 1', async () => {
        render(payloadFor());
        expect(document.querySelector('[data-testid="pipeline-viz-checkpoint-10"]')).not.toBeNull();
        expect(document.querySelector('[data-testid="pipeline-viz-lock-10"]')).not.toBeNull();
        expect(document.querySelector('[data-testid="pipeline-viz-checkpoint-11"]')).not.toBeNull();
        click('pipeline-viz-checkpoint-10');
        await flush();
        expect(updateStep).toHaveBeenCalledWith('http://test.local/darwin', 'tok', 10, { checkpoint: 0 });
    });

    it('a priority step\'s flag writes checkpoint=1', async () => {
        render(payloadFor({ stepFlags: { checkpoint: 0 } }));
        click('pipeline-viz-checkpoint-10');
        await flush();
        expect(updateStep).toHaveBeenCalledWith('http://test.local/darwin', 'tok', 10, { checkpoint: 1 });
    });

    it('the padlock writes locked=1 on an open step and locked=0 on a locked one', async () => {
        render(payloadFor());
        click('pipeline-viz-lock-10');
        await flush();
        expect(updateStep).toHaveBeenCalledWith('http://test.local/darwin', 'tok', 10, { locked: 1 });
        act(() => { root.unmount(); });
        root = null;
        document.body.innerHTML = '';
        updateStep.mockClear();
        render(payloadFor({ stepFlags: { locked: 1 } }));
        click('pipeline-viz-lock-10');
        await flush();
        expect(updateStep).toHaveBeenCalledWith('http://test.local/darwin', 'tok', 10, { locked: 0 });
    });

    it('a step under a LOCKED epic refuses the flag and names the epic, writing nothing', async () => {
        const plan = render(payloadFor({ epicLocked: 1 }));
        const row = plan.rows.find((r) => r.id === 10);
        expect(row.effectiveLocked).toBe(true);
        expect(row.lockedBy).toBe('epic');
        click('pipeline-viz-checkpoint-10');
        await flush();
        expect(updateStep).not.toHaveBeenCalled();
        expect(showError).toHaveBeenCalledWith(expect.stringMatching(/locked by its epic/));
        // ...and its own padlock cannot lift an epic's lock either.
        click('pipeline-viz-lock-10');
        await flush();
        expect(updateStep).not.toHaveBeenCalled();
    });

    it('draws the state as a picture: barrier down / padlock shut when on, raised / open when off (req #3673)', () => {
        render(payloadFor({ stepFlags: { locked: 1 } }));
        const btn = (id) => document.querySelector(`[data-testid="${id}"]`);
        // Step 10: checkpoint on, locked. Step 11: checkpoint on, unlocked.
        expect(btn('pipeline-viz-checkpoint-10').getAttribute('data-on')).toBe('1');
        expect(btn('pipeline-viz-checkpoint-10').querySelector('[data-arm]')
            .getAttribute('data-arm')).toBe('down');
        expect(btn('pipeline-viz-lock-10').querySelector('[data-lock]')
            .getAttribute('data-lock')).toBe('closed');
        expect(btn('pipeline-viz-lock-11').getAttribute('data-on')).toBe('0');
        expect(btn('pipeline-viz-lock-11').querySelector('[data-lock]')
            .getAttribute('data-lock')).toBe('open');
        // The hover title says what the state means and what a click does.
        expect(btn('pipeline-viz-checkpoint-10').getAttribute('title'))
            .toMatch(/^Checkpoint ON — the steps after this one wait/);
        expect(btn('pipeline-viz-lock-10').getAttribute('title')).toMatch(/^Locked —.*unlock/);
        expect(btn('pipeline-viz-lock-11').getAttribute('title')).toMatch(/^Unlocked — click to lock/);
        act(() => { root.unmount(); });
        root = null;
        document.body.innerHTML = '';
        render(payloadFor({ stepFlags: { checkpoint: 0 }, epicLocked: 1 }));
        expect(btn('pipeline-viz-checkpoint-10').querySelector('[data-arm]')
            .getAttribute('data-arm')).toBe('up');
        expect(btn('pipeline-viz-checkpoint-10').getAttribute('title'))
            .toMatch(/^Checkpoint OFF — the steps after this one may start.*Locked by its epic/);
        // A lock held by the epic says so, and its border is dashed.
        expect(btn('pipeline-viz-lock-10').getAttribute('title')).toMatch(/^Locked by its epic/);
        expect(btn('pipeline-viz-lock-10').style.borderStyle).toBe('dashed');
    });

    it('a locked step draws a closed padlock and takes no requirement drop (layout)', () => {
        const plan = adaptComposedPipeline(payloadFor({ stepFlags: { locked: 1 } }));
        const layout = computePlanLayout(plan.rows, { stepLabel: 'title' });
        expect(layout.labels.find((l) => l.kind === 'lock' && l.stepId === 10).on).toBe(true);
        expect(layout.labels.find((l) => l.kind === 'lock' && l.stepId === 11).on).toBe(false);
        expect(layout.labels.find((l) => l.kind === 'checkpoint' && l.stepId === 10).on).toBe(true);
    });
});

describe('the epic chip\'s padlock (req #3649)', () => {
    it('writes locked=1 on an open epic and locked=0 on a locked one', async () => {
        render(payloadFor());
        click('pipeline-viz-epic-lock-5');
        await flush();
        expect(updateEpic).toHaveBeenCalledWith('http://test.local/darwin', 'tok', 5, { locked: 1 });
        act(() => { root.unmount(); });
        root = null;
        document.body.innerHTML = '';
        updateEpic.mockClear();
        render(payloadFor({ epicLocked: 1 }));
        const chip = document.querySelector('[data-testid="pipeline-viz-epic-lock-5"]');
        expect(chip.getAttribute('data-locked')).toBe('1');
        click('pipeline-viz-epic-lock-5');
        await flush();
        expect(updateEpic).toHaveBeenCalledWith('http://test.local/darwin', 'tok', 5, { locked: 0 });
    });

    it('under a LOCKED plan every chip is closed and a click names the plan', async () => {
        render(payloadFor({ planLocked: 1 }));
        expect(document.querySelector('[data-testid="pipeline-viz-epic-lock-6"]')
            .getAttribute('data-locked')).toBe('1');
        click('pipeline-viz-epic-lock-6');
        await flush();
        expect(updateEpic).not.toHaveBeenCalled();
        expect(showError).toHaveBeenCalledWith(expect.stringMatching(/locked by its pipeline/));
    });
});
