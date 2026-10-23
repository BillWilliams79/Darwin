// @vitest-environment jsdom
//
// Req #3586 — the plan visualizer's "+" marks open the add-epic dialog and
// write through the right epicsApi call. jsdom has no canvas, so react-konva
// is stubbed: the marks' one Shape publishes each mark's world point, and the
// test clicks the stage canvas there — the visualizer resolves the mark by
// geometry in its native click handler, exactly as on a real stage.

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('react-konva', () => {
    const Stub = ({ children }) => <div>{typeof children === 'function' ? null : children}</div>;
    return {
        // A real <canvas>, so the visualizer's native click test accepts the event.
        Stage: ({ children }) => <div><canvas data-testid="stage-canvas" />{children}</div>,
        Layer: Stub, Group: Stub,
        Rect: () => null, Line: () => null, Text: () => null, Path: () => null,
        Circle: () => null,
        // The add-epic marks are ONE shape; publish each mark's world point so
        // the test can click exactly where it is drawn.
        Shape: ({ geom }) => (geom ? geom.marks.map((m) => (
            <i key={m.key} data-insert={m.key} data-x={m.x} data-y={m.y} />)) : null),
    };
});

vi.mock('konva', () => ({
    default: { Animation: class { start() {} stop() {} } },
}));

const createInitiative = vi.fn(() => Promise.resolve({ id: 77 }));
vi.mock('../../../Initiatives/initiativesApi', async (orig) => ({
    ...(await orig()),
    createInitiative: (...a) => createInitiative(...a),
}));
const createEpic = vi.fn(() => Promise.resolve({ id: 903 }));
// No network in jsdom: the categories the add-initiative dialog offers are stubbed.
vi.mock('../../../hooks/useDataQueries', async (orig) => ({
    ...(await orig()),
    useAllCategories: () => ({ data: [
        { id: 3, category_name: 'Core', sort_order: 1, closed: 0 },
        { id: 4, category_name: 'Infra', sort_order: 2, closed: 0 },
    ] }),
}));

const insertEpicOnEdge = vi.fn(() => Promise.resolve({ id: 900 }));
const addDependentEpic = vi.fn(() => Promise.resolve({ id: 901 }));
const precedeEpicWith = vi.fn(() => Promise.resolve({ id: 902 }));
vi.mock('../../../Epics/epicsApi', async (orig) => ({
    ...(await orig()),
    insertEpicOnEdge: (...a) => insertEpicOnEdge(...a),
    addDependentEpic: (...a) => addDependentEpic(...a),
    precedeEpicWith: (...a) => precedeEpicWith(...a),
    createEpic: (...a) => createEpic(...a),
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
    // A real panel size, so the stage (and its marks) mount at all.
    const w = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
    const h = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight');
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 1200 });
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 700 });
    restoreSize = () => {
        if (w) Object.defineProperty(HTMLElement.prototype, 'clientWidth', w);
        if (h) Object.defineProperty(HTMLElement.prototype, 'clientHeight', h);
    };
    insertEpicOnEdge.mockClear();
    addDependentEpic.mockClear();
    precedeEpicWith.mockClear();
    createInitiative.mockClear();
    createEpic.mockClear();
});

afterEach(() => {
    if (root) act(() => { root.unmount(); });
    root = null;
    restoreSize?.();
    document.body.innerHTML = '';
});

const epic = (id, initiative_fk, title) => ({
    id, initiative_fk, title, run: 'auto', notes: null, not_before: null,
});

function render(levelPref = '3') {
    const payload = composedFixture({
        initiatives: [{ id: 5, title: 'Build', pipeline_fk: 2, sort_order: 1, category_fk: 3 },
            { id: 6, title: 'Ship', pipeline_fk: 2, sort_order: 2, category_fk: 4 }],
        epics: [epic(10, 5, 'Design'), epic(11, 5, 'Implement')],
        epicDeps: [{ id: 1, epic_fk: 11, dep_epic_fk: 10 }],
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

const viz = () => document.querySelector('[data-insert-edges]');
// Click the canvas where a mark is drawn: world -> screen through the
// container's published transform (jsdom rects sit at the origin).
const clickMark = (key) => {
    const m = document.querySelector(`[data-insert="${key}"]`);
    const [tx, ty, k] = viz().getAttribute('data-transform').split(',').map(Number);
    const clientX = tx + Number(m.dataset.x) * k;
    const clientY = ty + Number(m.dataset.y) * k;
    const canvas = document.querySelector('[data-testid="stage-canvas"]');
    act(() => {
        canvas.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX, clientY }));
    });
};
const setInput = (el, value) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    act(() => {
        setter.call(el, value);
        el.dispatchEvent(new Event('input', { bubbles: true }));
    });
};

describe('add-epic marks (req #3586)', () => {
    it('draws one edge "+" per dependency and one dependent "+" per epic at the card level', () => {
        render('3');
        expect(viz().getAttribute('data-insert-edges')).toBe('1');
        expect(viz().getAttribute('data-insert-dependents')).toBe('2');
        expect(document.querySelector('[data-insert="edge-10-11"]')).not.toBeNull();
        expect(document.querySelector('[data-insert="dependent-10"]')).not.toBeNull();
    });

    it('draws a precede "+" only on the epic with no dependency on its left (req #3617)', () => {
        render('3');
        expect(viz().getAttribute('data-insert-precedes')).toBe('1');
        expect(document.querySelector('[data-insert="precede-10"]')).not.toBeNull();
        expect(document.querySelector('[data-insert="precede-11"]')).toBeNull();
    });

    it('the precede "+" adds an epic the clicked epic then waits on, in its initiative by default', async () => {
        render('3');
        clickMark('precede-10');
        expect(document.querySelector('[data-testid="pipeline-viz-insert-summary"]').textContent)
            .toBe('"Design" will wait on the new epic.');
        setInput(document.querySelector('[data-testid="pipeline-viz-insert-title"]'), 'Research');
        await act(async () => {
            document.querySelector('[data-testid="pipeline-viz-insert-create"]').click();
        });
        expect(precedeEpicWith).toHaveBeenCalledTimes(1);
        expect(precedeEpicWith.mock.calls[0][2]).toEqual({
            toEpicId: 10, initiative_fk: 5, title: 'Research',
        });
        expect(addDependentEpic).not.toHaveBeenCalled();
        expect(insertEpicOnEdge).not.toHaveBeenCalled();
    });

    it('draws none at L1, where an epic is a bead and not a card', () => {
        render('1');
        expect(viz().getAttribute('data-insert-edges')).toBe('0');
        expect(viz().getAttribute('data-insert-dependents')).toBe('0');
        expect(viz().getAttribute('data-insert-precedes')).toBe('0');
    });

    it('the edge "+" splits the edge: dialog names both epics, Create calls insertEpicOnEdge', async () => {
        render('3');
        clickMark('edge-10-11');
        const summary = document.querySelector('[data-testid="pipeline-viz-insert-summary"]');
        expect(summary.textContent).toContain('"Design"');
        expect(summary.textContent).toContain('"Implement"');
        setInput(document.querySelector('[data-testid="pipeline-viz-insert-title"]'), '  Review  ');
        await act(async () => {
            document.querySelector('[data-testid="pipeline-viz-insert-create"]').click();
        });
        expect(insertEpicOnEdge).toHaveBeenCalledTimes(1);
        expect(insertEpicOnEdge.mock.calls[0][2]).toEqual({
            fromEpicId: 10, toEpicId: 11, initiative_fk: 5, title: 'Review',
        });
        expect(addDependentEpic).not.toHaveBeenCalled();
    });

    it('the dependent "+" adds an epic gated on that epic alone, in its initiative by default', async () => {
        render('3');
        clickMark('dependent-11');
        await act(async () => {
            document.querySelector('[data-testid="pipeline-viz-insert-create"]').click();
        });
        expect(addDependentEpic).toHaveBeenCalledTimes(1);
        expect(addDependentEpic.mock.calls[0][2]).toEqual({
            fromEpicId: 11, initiative_fk: 5, title: 'New epic',
        });
        expect(insertEpicOnEdge).not.toHaveBeenCalled();
    });

    // req #3647 — the right-side "+" makes an epic that DEPENDS on the clicked
    // one; the dialog says so ("parallel" was the wrong word for it).
    it.each([
        ['dependent-11', 'Add a dependent epic'],
        ['edge-10-11', 'Insert an epic'],
        ['precede-10', 'Add an epic before'],
    ])('the %s mark opens a dialog titled "%s"', (key, title) => {
        render('3');
        clickMark(key);
        expect(document.querySelector('[data-testid="pipeline-viz-insert-heading"]').textContent)
            .toBe(title);
    });

    it('a click on open canvas away from every mark opens nothing', () => {
        render('3');
        const canvas = document.querySelector('[data-testid="stage-canvas"]');
        act(() => {
            canvas.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 1, clientY: 1 }));
        });
        expect(document.querySelector('[data-testid="pipeline-viz-insert-title"]')).toBeNull();
    });

    it('a blank title cannot be created', () => {
        render('3');
        clickMark('dependent-10');
        setInput(document.querySelector('[data-testid="pipeline-viz-insert-title"]'), '   ');
        expect(document.querySelector('[data-testid="pipeline-viz-insert-create"]').disabled).toBe(true);
    });
});

// req #3719 — the add-initiative "+" right under the bottom of the last initiative.
describe('add-initiative mark (req #3719)', () => {
    it('draws one add-initiative "+" at the card level, below every band', () => {
        render('3');
        expect(viz().getAttribute('data-insert-initiatives')).toBe('1');
        const m = document.querySelector('[data-insert="initiative-add"]');
        expect(m).not.toBeNull();
        const [, worldH] = viz().getAttribute('data-world').split(',').map(Number);
        expect(Number(m.dataset.y)).toBeLessThan(worldH);
    });

    it('draws none at L1, with the other marks', () => {
        render('1');
        expect(viz().getAttribute('data-insert-initiatives')).toBe('0');
    });

    it('the "+" opens the dialog on the category of the initiative it sits under; Create adds the initiative and its first epic', async () => {
        render('3');
        clickMark('initiative-add');
        expect(document.querySelector('[data-testid="pipeline-viz-initiative-add-dialog"]')).not.toBeNull();
        expect(document.querySelector('[data-testid="pipeline-viz-initiative-add-category"]').value).toBe('3');
        setInput(document.querySelector('[data-testid="pipeline-viz-initiative-add-title"]'), '  Launch  ');
        await act(async () => {
            document.querySelector('[data-testid="pipeline-viz-initiative-add-create"]').click();
        });
        expect(createInitiative).toHaveBeenCalledTimes(1);
        expect(createInitiative.mock.calls[0][2]).toEqual({
            pipeline_fk: 2, title: 'Launch', category_fk: 3,
        });
        expect(createEpic).toHaveBeenCalledTimes(1);
        expect(createEpic.mock.calls[0][2]).toEqual({ initiative_fk: 77, title: 'New epic' });
        expect(insertEpicOnEdge).not.toHaveBeenCalled();
    });
});
