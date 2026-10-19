// @vitest-environment jsdom
//
// req #3650 — every epic chip and every step card on the plan canvas carries
// its OWN collapse head, and a click folds that box and nothing else. The
// heads are HTML over the canvas (like the run pill), so jsdom can click them;
// react-konva is stubbed inert because nothing here depends on what it draws.
// Storage is cleared before each test: the folds are a remembered setting.

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('react-konva', () => {
    const Stub = ({ children }) => <div>{typeof children === 'function' ? null : children}</div>;
    return {
        Stage: Stub, Layer: Stub, Group: Stub,
        Rect: () => null, Circle: () => null, Line: () => null,
        Text: () => null, Path: () => null, Shape: () => null,
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

let root;
let restoreSize;

beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    // A real panel size, so the epic chips and the cards mount at all.
    const w = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
    const h = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight');
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 1200 });
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 700 });
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

const step = (id, epic_fk, title) => ({
    id, epic_fk, title, run: 'auto', notes: null, completed_at: null, not_before: null,
});

function render(props = {}) {
    const payload = composedFixture({
        epics: [{ id: 5, title: 'Build', pipeline_fk: 2, sort_order: 1 },
            { id: 6, title: 'Ship', pipeline_fk: 2, sort_order: 2 }],
        steps: [step(10, 5, 'Design'), step(11, 5, 'Implement'), step(12, 6, 'Release')],
        stepDeps: [{ id: 1, step_fk: 11, dep_step_fk: 10 }],
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
                    <PipelinePlanVisualizer plan={plan} model={model} levelPref="3"
                                            pipeline={payload.pipeline} timezone="UTC"
                                            {...props} />
                </MemoryRouter>
            </QueryClientProvider>
        );
    });
}

const q = (id) => document.querySelector(`[data-testid="${id}"]`);
const stepHead = (id) => q(`pipeline-viz-step-collapse-${id}`);
const epicHead = (id) => q(`pipeline-viz-epic-collapse-${id}`);
const click = (el) => act(() => { el.click(); });

describe('per-box collapse heads on the plan canvas (req #3650)', () => {
    it('gives every step card and every epic chip its own head, open, TPU-styled', () => {
        render();
        for (const id of [10, 11, 12]) {
            const h = stepHead(id);
            expect(h, `step ${id}`).not.toBeNull();
            expect(h.tagName).toBe('BUTTON');
            expect(h.getAttribute('aria-expanded')).toBe('true');
            expect(h.textContent).toBe('▾Reqs');
        }
        for (const id of [5, 6]) {
            const h = epicHead(id);
            expect(h, `epic ${id}`).not.toBeNull();
            expect(h.getAttribute('aria-expanded')).toBe('true');
            expect(h.textContent).toBe('▾Steps');
            // It LEADS the chip — the chip's upper-left.
            expect(h.parentElement.firstElementChild).toBe(h);
        }
    });

    it('folds ONLY the step that was clicked', () => {
        render();
        click(stepHead(10));
        expect(stepHead(10).getAttribute('aria-expanded')).toBe('false');
        expect(stepHead(10).getAttribute('title')).toBe('Expand Reqs of step 10');
        expect(stepHead(11).getAttribute('aria-expanded')).toBe('true');
        expect(stepHead(12).getAttribute('aria-expanded')).toBe('true');
        expect(epicHead(5).getAttribute('aria-expanded')).toBe('true');
        click(stepHead(10));
        expect(stepHead(10).getAttribute('aria-expanded')).toBe('true');
    });

    it('folds ONLY the epic that was clicked, taking its cards with it', () => {
        render();
        click(epicHead(5));
        expect(epicHead(5).getAttribute('aria-expanded')).toBe('false');
        expect(stepHead(10)).toBeNull();
        expect(stepHead(11)).toBeNull();
        expect(epicHead(6).getAttribute('aria-expanded')).toBe('true');
        expect(stepHead(12)).not.toBeNull();
        click(epicHead(5));
        expect(stepHead(10)).not.toBeNull();
    });

    it('keeps the folds across a re-mount (req #3651 — every transition re-mounts)', () => {
        render();
        click(stepHead(12));
        click(epicHead(5));
        act(() => { root.unmount(); });
        document.body.innerHTML = '';
        render();
        expect(epicHead(5).getAttribute('aria-expanded')).toBe('false');
        expect(stepHead(10)).toBeNull();
        expect(stepHead(12).getAttribute('aria-expanded')).toBe('false');
    });

    it('a link to a folded step inside a folded epic unfolds both, and nothing else', () => {
        localStorage.setItem('darwin-pipeline-viz-collapsed', 'e5 e6 s10 s11');
        render({ focusStepId: 10 });
        expect(epicHead(5).getAttribute('aria-expanded')).toBe('true');
        expect(stepHead(10).getAttribute('aria-expanded')).toBe('true');
        expect(stepHead(11).getAttribute('aria-expanded')).toBe('false');
        expect(epicHead(6).getAttribute('aria-expanded')).toBe('false');
        expect(sessionStorage.getItem('darwin-pipeline-viz-collapsed')).toBe('e6 s11');
        expect(q('pipeline-viz-step-not-on-plan')).toBeNull();
    });

    it('unfolds ONCE per link: the reader can still fold the linked box afterwards', () => {
        render({ focusStepId: 12, focusEpicId: 5 });
        click(epicHead(6));
        expect(epicHead(6).getAttribute('aria-expanded')).toBe('false');
        click(epicHead(5));
        expect(epicHead(5).getAttribute('aria-expanded')).toBe('false');
    });

    it('the name of a folded epic unfolds it rather than doing nothing', () => {
        render();
        click(epicHead(5));
        const name = q('pipeline-viz-epic-name-5');
        act(() => {
            name.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }));
            name.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0 }));
        });
        act(() => { name.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
        expect(epicHead(5).getAttribute('aria-expanded')).toBe('true');
    });

    it('names each head with its visible label first (WCAG 2.5.3)', () => {
        render();
        expect(stepHead(10).getAttribute('aria-label')).toBe('Reqs of step 10');
        expect(epicHead(5).getAttribute('aria-label')).toBe('Steps of epic Build');
    });
});
