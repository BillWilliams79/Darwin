// @vitest-environment jsdom
//
// Req #3649 — the step card's barrier button and the initiative chip's padlock
// write the right stepsApi/initiativesApi call, and a LOCKED row refuses authoring
// before any write. Req #3742 removed the step card's own padlock: a locked
// step's card is drawn with a RED PERIMETER instead. jsdom has no canvas, so
// react-konva is stubbed: a Rect that carries a `name` is rendered as a real
// button (publishing its stroke) whose click fires the Rect's `onActivate`. The
// barrier is HTML since req #3673 and renders as itself.

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
        Rect: ({ name, onActivate, stroke, strokeWidth }) => (name
            ? <button type="button" data-testid={name} data-stroke={stroke}
                      data-stroke-width={strokeWidth} onClick={() => onActivate?.()} />
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
const updateInitiative = vi.fn(() => Promise.resolve({}));
vi.mock('../../../Initiatives/initiativesApi', async (orig) => ({
    ...(await orig()),
    updateInitiative: (...a) => updateInitiative(...a),
}));

const showError = vi.fn();
vi.mock('../../../stores/useSnackBarStore', () => ({
    useSnackBarStore: (sel) => sel({ showError, showSuccess: vi.fn() }),
}));

import { composedFixture } from './pipelineComposedFixture';
import { adaptComposedPipeline, buildPlanModel } from '../pipelineAdapter';
import { computePlanLayout, PLAN_VIZ_PALETTE, CARD_LOCKED_FRAME_W } from '../pipelinePlanLayout';
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
    updateInitiative.mockClear();
    showError.mockClear();
});

afterEach(() => {
    if (root) act(() => { root.unmount(); });
    root = null;
    restoreSize?.();
    document.body.innerHTML = '';
});

const step = (id, initiative_fk, title, extra = {}) => ({
    id, initiative_fk, title, run: 'auto', notes: null, not_before: null,
    checkpoint: 1, locked: 0, ...extra,
});

function payloadFor({ initiativeLocked = 0, planLocked = 0, stepFlags = {} } = {}) {
    const payload = composedFixture({
        initiatives: [{ id: 5, title: 'Build', pipeline_fk: 2, sort_order: 1, locked: initiativeLocked },
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

describe('the step card\'s barrier, and its lock as a red perimeter (req #3649, #3673, #3742)', () => {
    it('draws the barrier on every card and no padlock; the flag writes checkpoint=0', async () => {
        render(payloadFor());
        expect(document.querySelector('[data-testid="pipeline-viz-barrier-10"]')).not.toBeNull();
        expect(document.querySelector('[data-testid="pipeline-viz-barrier-11"]')).not.toBeNull();
        // req #3742 — "remove the lock button from the title row".
        expect(document.querySelector('[data-testid^="pipeline-viz-lock-"]')).toBeNull();
        click('pipeline-viz-barrier-10');
        await flush();
        expect(updateStep).toHaveBeenCalledWith('http://test.local/darwin', 'tok', 10, { checkpoint: 0 });
    });

    it('a priority step\'s flag writes checkpoint=1', async () => {
        render(payloadFor({ stepFlags: { checkpoint: 0 } }));
        click('pipeline-viz-barrier-10');
        await flush();
        expect(updateStep).toHaveBeenCalledWith('http://test.local/darwin', 'tok', 10, { checkpoint: 1 });
    });

    it('a step under a LOCKED initiative refuses the flag and names the initiative, writing nothing', async () => {
        const plan = render(payloadFor({ initiativeLocked: 1 }));
        const row = plan.rows.find((r) => r.id === 10);
        expect(row.effectiveLocked).toBe(true);
        expect(row.lockedBy).toBe('initiative');
        click('pipeline-viz-barrier-10');
        await flush();
        expect(updateStep).not.toHaveBeenCalled();
        expect(showError).toHaveBeenCalledWith(expect.stringMatching(/locked by its initiative/));
    });

    it('draws the barrier as a picture: barrier down when on, raised when off (req #3673)', () => {
        render(payloadFor());
        const btn = (id) => document.querySelector(`[data-testid="${id}"]`);
        expect(btn('pipeline-viz-barrier-10').getAttribute('data-on')).toBe('1');
        expect(btn('pipeline-viz-barrier-10').querySelector('[data-arm]')
            .getAttribute('data-arm')).toBe('down');
        // The hover title says what the state means and what a click does.
        expect(btn('pipeline-viz-barrier-10').getAttribute('title'))
            .toMatch(/^Barrier ON — Dependent steps may start requirements only when all requirements in this step are met/);
        act(() => { root.unmount(); });
        root = null;
        document.body.innerHTML = '';
        render(payloadFor({ stepFlags: { checkpoint: 0 }, initiativeLocked: 1 }));
        expect(btn('pipeline-viz-barrier-10').querySelector('[data-arm]')
            .getAttribute('data-arm')).toBe('up');
        expect(btn('pipeline-viz-barrier-10').getAttribute('title'))
            .toMatch(/^Barrier OFF — Dependent steps may start requirements only when all requirements in this step have been started.*Locked by its initiative/);
    });

    // req #3742 — "a locked step has a red perimeter".
    const lockedFrames = () => [...document.querySelectorAll('[data-testid="locked-frame"]')];

    it('a locked step\'s card has a red perimeter; an open one does not', () => {
        render(payloadFor({ stepFlags: { locked: 1 } }));
        const frames = lockedFrames();
        expect(frames).toHaveLength(1);
        expect(frames[0].getAttribute('data-stroke')).toBe(PLAN_VIZ_PALETTE.lockedFrame);
        expect(Number(frames[0].getAttribute('data-stroke-width'))).toBe(CARD_LOCKED_FRAME_W);
        act(() => { root.unmount(); });
        root = null;
        document.body.innerHTML = '';
        render(payloadFor());
        expect(lockedFrames()).toHaveLength(0);
    });

    it('a lock held by the initiative or the plan reddens every card under it', () => {
        render(payloadFor({ initiativeLocked: 1 }));
        expect(lockedFrames()).toHaveLength(1);    // step 10, in initiative 5
        act(() => { root.unmount(); });
        root = null;
        document.body.innerHTML = '';
        render(payloadFor({ planLocked: 1 }));
        expect(lockedFrames()).toHaveLength(2);
    });

    it('a locked step takes no requirement drop, and the layout emits no padlock (layout)', () => {
        const plan = adaptComposedPipeline(payloadFor({ stepFlags: { locked: 1 } }));
        const layout = computePlanLayout(plan.rows, { stepLabel: 'title' });
        expect(layout.labels.some((l) => l.kind === 'lock')).toBe(false);
        expect(plan.rows.find((r) => r.id === 10).effectiveLocked).toBe(true);
        expect(layout.labels.find((l) => l.kind === 'barrier' && l.stepId === 10).on).toBe(true);
    });
});

describe('the initiative chip\'s padlock (req #3649)', () => {
    it('writes locked=1 on an open initiative and locked=0 on a locked one', async () => {
        render(payloadFor());
        click('pipeline-viz-initiative-lock-5');
        await flush();
        expect(updateInitiative).toHaveBeenCalledWith('http://test.local/darwin', 'tok', 5, { locked: 1 });
        act(() => { root.unmount(); });
        root = null;
        document.body.innerHTML = '';
        updateInitiative.mockClear();
        render(payloadFor({ initiativeLocked: 1 }));
        const chip = document.querySelector('[data-testid="pipeline-viz-initiative-lock-5"]');
        expect(chip.getAttribute('data-locked')).toBe('1');
        click('pipeline-viz-initiative-lock-5');
        await flush();
        expect(updateInitiative).toHaveBeenCalledWith('http://test.local/darwin', 'tok', 5, { locked: 0 });
    });

    it('under a LOCKED plan every chip is closed and a click names the plan', async () => {
        render(payloadFor({ planLocked: 1 }));
        expect(document.querySelector('[data-testid="pipeline-viz-initiative-lock-6"]')
            .getAttribute('data-locked')).toBe('1');
        click('pipeline-viz-initiative-lock-6');
        await flush();
        expect(updateInitiative).not.toHaveBeenCalled();
        expect(showError).toHaveBeenCalledWith(expect.stringMatching(/locked by its pipeline/));
    });
});
