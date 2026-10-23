// @vitest-environment jsdom
//
// req #3650 — every initiative chip and every step card on the plan canvas carries
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
    // A real panel size, so the initiative chips and the cards mount at all.
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

const step = (id, initiative_fk, title) => ({
    id, initiative_fk, title, run: 'auto', notes: null, not_before: null,
});

function render(props = {}) {
    const payload = composedFixture({
        initiatives: [{ id: 5, title: 'Build', pipeline_fk: 2, sort_order: 1 },
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
const initiativeHead = (id) => q(`pipeline-viz-initiative-collapse-${id}`);
const click = (el) => act(() => { el.click(); });

describe('per-box collapse heads on the plan canvas (req #3650)', () => {
    it('gives every step card and every initiative chip its own head, open, TPU-styled', () => {
        render();
        for (const id of [10, 11, 12]) {
            const h = stepHead(id);
            expect(h, `step ${id}`).not.toBeNull();
            expect(h.tagName).toBe('BUTTON');
            expect(h.getAttribute('aria-expanded')).toBe('true');
            // The chevron alone since req #3648 — no "Reqs" word.
            expect(h.textContent).toBe('▾');
        }
        for (const id of [5, 6]) {
            const h = initiativeHead(id);
            expect(h, `initiative ${id}`).not.toBeNull();
            expect(h.getAttribute('aria-expanded')).toBe('true');
            // The chevron alone since req #3648 — no "Steps" word.
            expect(h.textContent).toBe('▾');
            // It LEADS the chip — the chip's upper-left.
            expect(h.parentElement.firstElementChild).toBe(h);
        }
    });

    it('folds ONLY the step that was clicked', () => {
        render();
        click(stepHead(10));
        expect(stepHead(10).getAttribute('aria-expanded')).toBe('false');
        expect(stepHead(10).getAttribute('title')).toBe('Expand Requirements of step 10');
        expect(stepHead(11).getAttribute('aria-expanded')).toBe('true');
        expect(stepHead(12).getAttribute('aria-expanded')).toBe('true');
        expect(initiativeHead(5).getAttribute('aria-expanded')).toBe('true');
        click(stepHead(10));
        expect(stepHead(10).getAttribute('aria-expanded')).toBe('true');
    });

    it('folds ONLY the initiative that was clicked, taking its cards with it', () => {
        render();
        click(initiativeHead(5));
        expect(initiativeHead(5).getAttribute('aria-expanded')).toBe('false');
        expect(stepHead(10)).toBeNull();
        expect(stepHead(11)).toBeNull();
        expect(initiativeHead(6).getAttribute('aria-expanded')).toBe('true');
        expect(stepHead(12)).not.toBeNull();
        click(initiativeHead(5));
        expect(stepHead(10)).not.toBeNull();
    });

    it('keeps the folds across a re-mount (req #3651 — every transition re-mounts)', () => {
        render();
        click(stepHead(12));
        click(initiativeHead(5));
        act(() => { root.unmount(); });
        document.body.innerHTML = '';
        render();
        expect(initiativeHead(5).getAttribute('aria-expanded')).toBe('false');
        expect(stepHead(10)).toBeNull();
        expect(stepHead(12).getAttribute('aria-expanded')).toBe('false');
    });

    it('a link to a folded step inside a folded initiative unfolds both, and nothing else', () => {
        localStorage.setItem('darwin-pipeline-viz-collapsed', 'i5 i6 s10 s11');
        render({ focusStepId: 10 });
        expect(initiativeHead(5).getAttribute('aria-expanded')).toBe('true');
        expect(stepHead(10).getAttribute('aria-expanded')).toBe('true');
        expect(stepHead(11).getAttribute('aria-expanded')).toBe('false');
        expect(initiativeHead(6).getAttribute('aria-expanded')).toBe('false');
        expect(sessionStorage.getItem('darwin-pipeline-viz-collapsed')).toBe('i6 s11');
        expect(q('pipeline-viz-step-not-on-plan')).toBeNull();
    });

    it('unfolds ONCE per link: the reader can still fold the linked box afterwards', () => {
        render({ focusStepId: 12, focusInitiativeId: 5 });
        click(initiativeHead(6));
        expect(initiativeHead(6).getAttribute('aria-expanded')).toBe('false');
        click(initiativeHead(5));
        expect(initiativeHead(5).getAttribute('aria-expanded')).toBe('false');
    });

    // The NAME opens the initiative's editor since req #3742; the status light keeps
    // the zoom, and on a folded initiative that zoom unfolds it.
    it('the status light of a folded initiative unfolds it rather than doing nothing', () => {
        render();
        click(initiativeHead(5));
        const light = q('pipeline-viz-initiative-pause-5');
        act(() => { light.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
        expect(initiativeHead(5).getAttribute('aria-expanded')).toBe('true');
    });

    it('names each head with its visible label first (WCAG 2.5.3)', () => {
        render();
        expect(stepHead(10).getAttribute('aria-label')).toBe('Requirements of step 10');
        expect(initiativeHead(5).getAttribute('aria-label')).toBe('Steps of initiative Build');
    });
});

// req #3695 — the fold ANIMATES. jsdom has no `matchMedia`, which the canvas
// reads as "do not animate" (every test above relies on that); these tests
// give it one that allows motion, and drive the frames by hand.
describe('the initiative fold animates, and a folded initiative is a title bar (req #3695)', () => {
    let frames;
    let clock;
    let restore;
    beforeEach(() => {
        frames = [];
        clock = 1000;
        const saved = {
            matchMedia: window.matchMedia,
            raf: globalThis.requestAnimationFrame,
            caf: globalThis.cancelAnimationFrame,
        };
        window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
        globalThis.requestAnimationFrame = (cb) => { frames.push(cb); return frames.length; };
        globalThis.cancelAnimationFrame = () => {};
        const nowSpy = vi.spyOn(performance, 'now').mockImplementation(() => clock);
        restore = () => {
            window.matchMedia = saved.matchMedia;
            globalThis.requestAnimationFrame = saved.raf;
            globalThis.cancelAnimationFrame = saved.caf;
            nowSpy.mockRestore();
        };
    });
    afterEach(() => restore());

    // Advance the clock and run the frame the canvas asked for.
    const frame = (ms) => act(() => {
        clock += ms;
        const run = frames.splice(0);
        for (const cb of run) cb(clock);
    });
    const opacityOf = (el) => Number(el.style.opacity === '' ? 1 : el.style.opacity);

    it('folding: the chevron answers at once, the cards fade out with the box, then are gone', () => {
        render();
        click(initiativeHead(5));
        expect(initiativeHead(5).getAttribute('aria-expanded')).toBe('false');
        // Still drawn on the first frame — the box has not started to move.
        expect(stepHead(10)).not.toBeNull();
        frame(230);
        const mid = stepHead(10);
        expect(mid).not.toBeNull();
        expect(opacityOf(mid)).toBeLessThan(1);
        expect(mid.style.pointerEvents).toBe('none');
        frame(300);
        expect(stepHead(10)).toBeNull();
        expect(stepHead(11)).toBeNull();
        expect(frames).toHaveLength(0);
        // The other initiative was never touched.
        expect(stepHead(12)).not.toBeNull();
        expect(opacityOf(stepHead(12))).toBe(1);
    });

    it('unfolding: the cards arrive as the box grows, fully present when it lands', () => {
        localStorage.setItem('darwin-pipeline-viz-collapsed', 'i5');
        render();
        expect(stepHead(10)).toBeNull();
        click(initiativeHead(5));
        expect(initiativeHead(5).getAttribute('aria-expanded')).toBe('true');
        frame(380);
        const mid = stepHead(10);
        expect(mid).not.toBeNull();
        expect(opacityOf(mid)).toBeGreaterThan(0);
        expect(opacityOf(mid)).toBeLessThan(1);
        frame(200);
        expect(opacityOf(stepHead(10))).toBe(1);
        expect(stepHead(10).style.pointerEvents).not.toBe('none');
        expect(frames).toHaveLength(0);
    });

    it('a folded initiative\'s chip is a title bar; an open one is not', () => {
        localStorage.setItem('darwin-pipeline-viz-collapsed', 'i5');
        render();
        expect(q('pipeline-viz-initiative-5').getAttribute('data-bar')).toBe('1.00');
        expect(q('pipeline-viz-initiative-6').hasAttribute('data-bar')).toBe(false);
        click(initiativeHead(5));
        frame(600);
        expect(q('pipeline-viz-initiative-5').hasAttribute('data-bar')).toBe(false);
    });
});
