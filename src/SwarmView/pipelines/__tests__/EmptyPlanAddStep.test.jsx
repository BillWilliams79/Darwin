// @vitest-environment jsdom
//
// Req #3646 — an empty pipeline shows a prominent "+" that places the first
// step in an epic, in both the canvas and the table.

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

import { composedFixture } from './pipelineComposedFixture';
import { adaptComposedPipeline, buildPlanModel } from '../pipelineAdapter';
import PipelinePlanVisualizer from '../PipelinePlanVisualizer';
import PipelinePlanTable from '../PipelinePlanTable';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
if (!globalThis.ResizeObserver) {
    globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
}

let root;
beforeEach(() => createStep.mockClear());
afterEach(() => {
    if (root) act(() => { root.unmount(); });
    root = null;
    document.body.innerHTML = '';
});

function render(Component, epics) {
    const payload = composedFixture({ epics, steps: [], stepDeps: [] });
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

    it('disables the "+" and says why when the pipeline has no epic', () => {
        render(Component, []);
        expect(q('pipeline-empty-add-step').disabled).toBe(true);
        expect(q('pipeline-empty-add-step-no-epics')).not.toBeNull();
    });
});
