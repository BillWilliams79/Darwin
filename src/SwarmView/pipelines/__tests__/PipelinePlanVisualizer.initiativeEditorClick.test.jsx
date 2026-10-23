// @vitest-environment jsdom
//
// req #3742 — "single click of initiative and step to take you to the single editor".
// A quick click on an initiative's NAME opens the shared initiative dialog OVER the canvas
// ("popup over the visualizer instead of switch to the card view"), through
// the canvas's shared press tracker (the dnd press timeline): the click is
// owed once the double-click window has closed, a
// double click still zooms, and a long press still renames in place. The
// status light keeps the quick-click zoom. react-konva is stubbed inert: the
// initiative chip is HTML.

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { MemoryRouter, useLocation } from 'react-router-dom';
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
import { DOUBLE_CLICK_MS, LONG_PRESS_MS } from '../planPressGesture';
import PipelinePlanVisualizer from '../PipelinePlanVisualizer';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
if (!globalThis.ResizeObserver) {
    globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
}

let root;
let restoreSize;
let currentLocation = null;
function LocationProbe() {
    currentLocation = useLocation();
    return null;
}

beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
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

function render() {
    const payload = composedFixture({
        initiatives: [{ id: 5, title: 'Build', pipeline_fk: 2, sort_order: 1 }],
        steps: [step(10, 5, 'Design'), step(11, 5, 'Implement')],
        stepDeps: [{ id: 1, step_fk: 11, dep_step_fk: 10 }],
    });
    const container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
        root.render(
            <QueryClientProvider client={new QueryClient()}>
                <MemoryRouter initialEntries={['/swarm/pipeline/2?mode=plan']}>
                    <PipelinePlanVisualizer plan={adaptComposedPipeline(payload)}
                                            model={buildPlanModel(payload)} levelPref="3"
                                            pipeline={payload.pipeline} timezone="UTC" />
                    <LocationProbe />
                </MemoryRouter>
            </QueryClientProvider>
        );
    });
}

const q = (id) => document.querySelector(`[data-testid="${id}"]`);
const wait = (ms) => act(() => new Promise((r) => { setTimeout(r, ms); }));
const press = (el) => act(() => {
    el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }));
    el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0 }));
});

describe('a single click on an initiative opens its single editor (req #3742)', () => {
    it('a quick click on the name opens the initiative\'s editor over the canvas', async () => {
        render();
        press(q('pipeline-viz-initiative-name-5'));
        // Owed once the double-click window closes — not before.
        expect(q('initiative-edit-dialog')).toBeNull();
        await wait(DOUBLE_CLICK_MS + 50);
        expect(q('initiative-edit-dialog')).not.toBeNull();
        expect(q('initiative-title-input').value).toBe('Build');
        expect(currentLocation.pathname).toBe('/swarm/pipeline/2');
    });

    it('Enter on the name opens the editor too; F2 still renames in place', () => {
        render();
        const name = q('pipeline-viz-initiative-name-5');
        act(() => { name.dispatchEvent(new KeyboardEvent('keydown', { key: 'F2', bubbles: true })); });
        expect(q('pipeline-viz-initiative-edit-5')).not.toBeNull();
        expect(currentLocation.pathname).toBe('/swarm/pipeline/2');
        act(() => { root.unmount(); });
        root = null;
        document.body.innerHTML = '';
        render();
        act(() => {
            q('pipeline-viz-initiative-name-5')
                .dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        });
        expect(q('initiative-edit-dialog')).not.toBeNull();
    });

    it('a double click on the name zooms instead, and leaves the page alone', async () => {
        render();
        const name = q('pipeline-viz-initiative-name-5');
        press(name);
        press(name);
        await wait(DOUBLE_CLICK_MS + 50);
        expect(q('initiative-edit-dialog')).toBeNull();
    });

    it('a long press on the name still opens the in-place rename', async () => {
        render();
        const name = q('pipeline-viz-initiative-name-5');
        act(() => { name.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 })); });
        await wait(LONG_PRESS_MS + 50);
        expect(q('pipeline-viz-initiative-edit-5')).not.toBeNull();
        expect(currentLocation.pathname).toBe('/swarm/pipeline/2');
    });

    it('the status light keeps the zoom — it never opens the editor', async () => {
        render();
        press(q('pipeline-viz-initiative-pause-5'));
        await wait(DOUBLE_CLICK_MS + 50);
        expect(q('initiative-edit-dialog')).toBeNull();
    });
});
