// @vitest-environment jsdom
//
// Req #3646 — an empty pipeline shows a prominent "+" that places the first
// step in an epic, in both the canvas and the table.
// Req #3773 — with no epic at all (every freshly created pipeline), the same
// "+" creates the first epic and its first step.

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('react-konva', () => {
    const Stub = ({ children }) => <div>{children}</div>;
    return { Stage: Stub, Layer: Stub, Group: Stub, Rect: () => null, Line: () => null,
        Text: () => null, Path: () => null, Circle: () => null, Shape: () => null };
});
vi.mock('konva', () => ({ default: { Animation: class { start() {} stop() {} } } }));

const createStep = vi.fn(() => Promise.resolve({ id: 900 }));
vi.mock('../../../Steps/stepsApi', async (orig) => ({
    ...(await orig()),
    createStep: (...a) => createStep(...a),
}));

const createEpic = vi.fn(() => Promise.resolve([{ id: 77 }]));
vi.mock('../../../Epics/epicsApi', async (orig) => ({
    ...(await orig()),
    createEpic: (...a) => createEpic(...a),
}));

let categories = [];
vi.mock('../../../hooks/useDataQueries', async (orig) => ({
    ...(await orig()),
    useAllCategories: () => ({ data: categories }),
}));

import { composedFixture } from './pipelineComposedFixture';
import { adaptComposedPipeline, buildPlanModel } from '../pipelineAdapter';
import PipelinePlanVisualizer from '../PipelinePlanVisualizer';
import PipelinePlanTable from '../PipelinePlanTable';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
if (!globalThis.ResizeObserver) {
    globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
}

let root;
beforeEach(() => {
    createStep.mockClear();
    createEpic.mockClear();
    categories = [
        { id: 3, category_name: 'Zeta', sort_order: 2, closed: 0 },
        { id: 1, category_name: 'Swarm', sort_order: 1, closed: 0 },
        { id: 9, category_name: 'Old', sort_order: 0, closed: 1 },
    ];
});
afterEach(() => {
    if (root) act(() => { root.unmount(); });
    root = null;
    document.body.innerHTML = '';
});

function render(Component, epics, pipelineFields = {}) {
    const payload = composedFixture({ epics, steps: [], stepDeps: [] });
    Object.assign(payload.pipeline, pipelineFields);
    const container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
        root.render(
            <QueryClientProvider client={new QueryClient()}>
                <MemoryRouter>
                    <Component plan={adaptComposedPipeline(payload)} model={buildPlanModel(payload)}
                               pipeline={payload.pipeline} timezone="UTC" />
                </MemoryRouter>
            </QueryClientProvider>
        );
    });
}
const q = (id) => document.querySelector(`[data-testid="${id}"]`);
const setInput = (el, value) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    act(() => { setter.call(el, value); el.dispatchEvent(new Event('input', { bubbles: true })); });
};

const ONE_EPIC = [{ id: 5, title: 'Build', pipeline_fk: 2, sort_order: 1 }];

describe.each([
    ['canvas', PipelinePlanVisualizer, 'pipeline-plan-viz-empty'],
    ['table', PipelinePlanTable, 'pipeline-plan-empty'],
])('empty plan add-step (%s)', (_name, Component, panelId) => {
    it('shows the "+" in the empty panel', () => {
        render(Component, ONE_EPIC);
        expect(q(panelId)).not.toBeNull();
        expect(q('pipeline-empty-add-step')).not.toBeNull();
        expect(q('pipeline-empty-add-step').disabled).toBe(false);
    });

    it('creates the first step in the chosen epic (a lone epic is preselected)', async () => {
        render(Component, ONE_EPIC);
        act(() => { q('pipeline-empty-add-step').click(); });
        setInput(q('pipeline-empty-add-step-title'), '  First  ');
        await act(async () => { q('pipeline-empty-add-step-create').click(); });
        expect(createStep).toHaveBeenCalledTimes(1);
        expect(createStep.mock.calls[0][2]).toEqual({ epic_fk: 5, title: 'First' });
    });

    it('does not preselect when there are several epics, and refuses to create without one', async () => {
        render(Component, [...ONE_EPIC, { id: 6, title: 'Ship', pipeline_fk: 2, sort_order: 2 }]);
        act(() => { q('pipeline-empty-add-step').click(); });
        await act(async () => { q('pipeline-empty-add-step-create').click(); });
        expect(createStep).not.toHaveBeenCalled();
        expect(q('pipeline-empty-add-step-dialog')).not.toBeNull();
    });

    it('keeps the dialog open when the create fails', async () => {
        createStep.mockImplementationOnce(() => Promise.reject(new Error('boom')));
        render(Component, ONE_EPIC);
        act(() => { q('pipeline-empty-add-step').click(); });
        await act(async () => { q('pipeline-empty-add-step-create').click(); });
        expect(createStep).toHaveBeenCalledTimes(1);
        expect(q('pipeline-empty-add-step-title')).not.toBeNull();
    });

    it('keeps the "+" live when the pipeline has no epic, and says what it will do', () => {
        render(Component, []);
        expect(q('pipeline-empty-add-step').disabled).toBe(false);
        expect(q('pipeline-empty-add-step-no-epics')).not.toBeNull();
    });

    it('creates the first epic in the first open category, then its first step', async () => {
        render(Component, []);
        act(() => { q('pipeline-empty-add-step').click(); });
        expect(q('pipeline-empty-add-step-epic')).toBeNull();
        expect(q('pipeline-empty-add-step-category').value).toBe('1');
        setInput(q('pipeline-empty-add-step-title'), '  Foundations  ');
        await act(async () => { q('pipeline-empty-add-step-create').click(); });
        expect(createEpic).toHaveBeenCalledTimes(1);
        expect(createEpic.mock.calls[0][2]).toEqual(
            { pipeline_fk: 2, title: 'Foundations', category_fk: 1 });
        expect(createStep).toHaveBeenCalledTimes(1);
        expect(createStep.mock.calls[0][2]).toEqual({ epic_fk: 77, title: 'New step' });
    });

    it('creates no step when the epic is written but not read back', async () => {
        createEpic.mockImplementationOnce(() => Promise.resolve(null));
        render(Component, []);
        act(() => { q('pipeline-empty-add-step').click(); });
        await act(async () => { q('pipeline-empty-add-step-create').click(); });
        expect(createEpic).toHaveBeenCalledTimes(1);
        expect(createStep).not.toHaveBeenCalled();
    });

    it('refuses to create the first epic with no open category', async () => {
        categories = [];
        render(Component, []);
        act(() => { q('pipeline-empty-add-step').click(); });
        expect(q('pipeline-empty-add-step-create').disabled).toBe(true);
        expect(q('pipeline-empty-add-step-no-categories')).not.toBeNull();
        await act(async () => { q('pipeline-empty-add-step-create').click(); });
        expect(createEpic).not.toHaveBeenCalled();
    });

    it('disables the "+" on a locked plan and says why', () => {
        render(Component, [], { locked: 1 });
        expect(q('pipeline-empty-add-step').disabled).toBe(true);
        expect(q('pipeline-empty-add-step-locked')).not.toBeNull();
        expect(q('pipeline-empty-add-step-no-epics')).toBeNull();
    });
});
