// @vitest-environment jsdom
//
// Req #3641 — a click on a step FRAMES IT ON THIS CANVAS. It used to call
// `onStepFocus`, which switched the page to the Table; the Table is gone (user
// directive: the visualizer is the only way to look at a pipeline), so the
// card's title area — and the bead at L1 — move the camera onto the step, the
// same `stepFocusTransform` a quick click on the step's name already ran.
//
// jsdom has no canvas, so react-konva is stubbed: every shape carrying an
// `onActivate` renders as a button the test can click, publishing its world
// box. The camera is read off the container's published `data-transform`.

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('react-konva', () => {
    const Stub = ({ children }) => <div>{typeof children === 'function' ? null : children}</div>;
    // A shape with an activate handler becomes a clickable button carrying its
    // world box; everything else draws nothing.
    const Activatable = (kind) => function ActivatableShape(p) {
        if (!p.onActivate) return null;
        // The title-area activate rect is unstroked; the card's "+" button is
        // an outlined square — `data-stroked` tells them apart.
        return <button type="button" data-act={kind}
                       data-stroked={p.stroke ? '1' : '0'}
                       data-x={p.x} data-y={p.y}
                       data-w={p.width ?? ''} data-h={p.height ?? ''}
                       onClick={() => p.onActivate()} />;
    };
    return {
        Stage: ({ children }) => <div><canvas data-testid="stage-canvas" />{children}</div>,
        Layer: Stub, Group: Stub,
        Rect: Activatable('rect'), Circle: Activatable('circle'),
        Line: () => null, Text: () => null, Path: () => null, Shape: () => null,
    };
});

vi.mock('konva', () => ({
    default: { Animation: class { start() {} stop() {} } },
}));

import { composedFixture } from './pipelineComposedFixture';
import { adaptComposedPipeline, buildPlanModel } from '../pipelineAdapter';
import PipelinePlanVisualizer from '../PipelinePlanVisualizer';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
if (!globalThis.ResizeObserver) {
    globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
}

const PANEL_W = 1200;
const PANEL_H = 700;
let root;
let restoreSize;

beforeEach(() => {
    // The canvas restores the camera it last saved for a plan (req #3637), so
    // one test's framing would be the next test's landing without this.
    localStorage.clear();
    sessionStorage.clear();
    const w = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
    const h = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight');
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => PANEL_W });
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => PANEL_H });
    restoreSize = () => {
        if (w) Object.defineProperty(HTMLElement.prototype, 'clientWidth', w);
        if (h) Object.defineProperty(HTMLElement.prototype, 'clientHeight', h);
    };
});

afterEach(() => {
    if (root) act(() => { root.unmount(); });
    root = null;
    restoreSize?.();
    document.body.innerHTML = '';
});

const step = (id, title) => ({
    id, epic_fk: 5, title, run: 'auto', notes: null, completed_at: null, not_before: null,
});

function render(levelPref) {
    // A chain long enough that the whole plan does not already fit the panel at
    // the scale a single step is framed at — so framing one is a real move.
    const ids = [10, 11, 12, 13, 14, 15, 16, 17];
    const payload = composedFixture({
        epics: [{ id: 5, title: 'Build', pipeline_fk: 2, sort_order: 1 }],
        steps: ids.map((id) => step(id, `Step ${id}`)),
        stepDeps: ids.slice(1).map((id, i) => ({ id: i + 1, step_fk: id, dep_step_fk: ids[i] })),
    });
    const plan = adaptComposedPipeline(payload);
    const model = buildPlanModel(payload);
    const container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
        root.render(
            <QueryClientProvider client={new QueryClient()}>
                <MemoryRouter>
                    <PipelinePlanVisualizer plan={plan} model={model} levelPref={levelPref}
                                            pipeline={payload.pipeline} timezone="UTC" />
                </MemoryRouter>
            </QueryClientProvider>
        );
    });
}

const transform = () => document.querySelector('[data-testid="pipeline-plan-visualizer"]')
    .getAttribute('data-transform').split(',').map(Number);
// The focus transition is a 420ms d3 transition; let it run to its end.
const settle = () => act(() => new Promise((r) => { setTimeout(r, 800); }));
const clickLast = async (kind) => {
    const targets = [...document.querySelectorAll(`[data-act="${kind}"][data-stroked="0"]`)];
    expect(targets.length).toBeGreaterThan(0);
    const target = targets[targets.length - 1];
    const box = {
        x: Number(target.dataset.x), y: Number(target.dataset.y),
        w: Number(target.dataset.w || 0), h: Number(target.dataset.h || 0),
    };
    act(() => { target.click(); });
    await settle();
    return box;
};

describe('a click on a step frames it on the canvas (req #3641)', () => {
    it('L3: the card title area zooms the camera in onto that card', async () => {
        render('3');
        await settle();
        const [, , k0] = transform();
        // The title-area activate rect — unstroked, unlike the "+" button; the
        // whole-card rect is hover-only and has no activate at all.
        const box = await clickLast('rect');
        const [tx, ty, k] = transform();
        expect(k).toBeGreaterThan(k0);
        // The clicked card is now on screen.
        const cx = tx + (box.x + box.w / 2) * k;
        const cy = ty + (box.y + box.h / 2) * k;
        expect(cx).toBeGreaterThan(0);
        expect(cx).toBeLessThan(PANEL_W);
        expect(cy).toBeGreaterThan(0);
        expect(cy).toBeLessThan(PANEL_H);
    });

    it('L1: the bead zooms the camera in onto that step', async () => {
        render('1');
        await settle();
        const [, , k0] = transform();
        const bead = await clickLast('circle');
        const [tx, ty, k] = transform();
        expect(k).toBeGreaterThan(k0);
        const cx = tx + bead.x * k;
        const cy = ty + bead.y * k;
        expect(cx).toBeGreaterThan(0);
        expect(cx).toBeLessThan(PANEL_W);
        expect(cy).toBeGreaterThan(0);
        expect(cy).toBeLessThan(PANEL_H);
    });

    it('takes no onStepFocus — a step click never leaves the canvas', () => {
        const onStepFocus = vi.fn();
        const payload = composedFixture({
            epics: [{ id: 5, title: 'Build', pipeline_fk: 2, sort_order: 1 }],
            steps: [step(10, 'Only')],
        });
        const container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
        act(() => {
            root.render(
                <QueryClientProvider client={new QueryClient()}>
                    <MemoryRouter>
                        <PipelinePlanVisualizer plan={adaptComposedPipeline(payload)}
                                                model={buildPlanModel(payload)} levelPref="3"
                                                pipeline={payload.pipeline} timezone="UTC"
                                                onStepFocus={onStepFocus} />
                    </MemoryRouter>
                </QueryClientProvider>
            );
        });
        for (const b of document.querySelectorAll('[data-act]')) act(() => { b.click(); });
        expect(onStepFocus).not.toHaveBeenCalled();
    });
});
