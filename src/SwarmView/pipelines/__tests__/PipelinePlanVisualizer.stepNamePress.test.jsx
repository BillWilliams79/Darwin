// @vitest-environment jsdom
//
// req #3742 — a quick click on a step's NAME opens the step's single editor,
// over the canvas, through the canvas's own pointer listeners and the shared press tracker
// (`planPressGesture.js`, on the dnd press timeline): the name is a Konva
// shape carrying `pressStepId`, found by `stage.getIntersection`. The click is
// owed once the double-click window has closed, and fires exactly once.
//
// jsdom has no canvas, so react-konva is stubbed: the Stage exposes a
// `getIntersection` that answers the step name's hit node for every point.

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { forwardRef, useImperativeHandle } from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const HIT_STEP = 11;
const fired = [];
vi.mock('react-konva', () => {
    const Stub = ({ children }) => <div>{typeof children === 'function' ? null : children}</div>;
    const Stage = forwardRef(function StageStub({ children }, ref) {
        useImperativeHandle(ref, () => ({
            container: () => null,
            getIntersection: () => ({
                getAttr: (k) => (k === 'pressStepId' ? HIT_STEP : undefined),
                fire: (name) => fired.push(name),
            }),
        }));
        return <div><canvas data-testid="stage-canvas" />{children}</div>;
    });
    return {
        Stage, Layer: Stub, Group: Stub,
        Rect: () => null, Circle: () => null, Line: () => null,
        Text: () => null, Path: () => null, Shape: () => null,
    };
});

vi.mock('konva', () => ({
    default: { Animation: class { start() {} stop() {} } },
}));

import { composedFixture } from './pipelineComposedFixture';
import { adaptComposedPipeline, buildPlanModel } from '../pipelineAdapter';
import { DOUBLE_CLICK_MS } from '../planPressGesture';
import PipelinePlanVisualizer from '../PipelinePlanVisualizer';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
if (!globalThis.ResizeObserver) {
    globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
}

let root;
let restoreSize;
const locations = [];
function LocationProbe() {
    const loc = useLocation();
    if (locations[locations.length - 1]?.key !== loc.key) locations.push(loc);
    return null;
}

beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    locations.length = 0;
    fired.length = 0;
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

const step = (id, title) => ({
    id, initiative_fk: 5, title, run: 'auto', notes: null, not_before: null,
});

function render() {
    const payload = composedFixture({
        initiatives: [{ id: 5, title: 'Build', pipeline_fk: 2, sort_order: 1 }],
        steps: [step(10, 'Design'), step(11, 'Implement')],
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

const wait = (ms) => act(() => new Promise((r) => { setTimeout(r, ms); }));
const pointer = (type) => new PointerEvent(type, {
    bubbles: true, button: 0, isPrimary: true, clientX: 300, clientY: 200,
});

describe('a quick click on a step NAME opens its single editor (req #3742)', () => {
    it('opens the step\'s editor over the canvas once the double-click window closes, exactly once', async () => {
        render();
        const canvas = document.querySelector('[data-testid="stage-canvas"]');
        act(() => {
            canvas.dispatchEvent(pointer('pointerdown'));
            canvas.dispatchEvent(pointer('pointerup'));
            // The native click a real press also produces lands on the same
            // hit node, which carries no `activate` handler of its own.
            canvas.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 300, clientY: 200 }));
        });
        expect(locations[locations.length - 1].pathname).toBe('/swarm/pipeline/2');
        await wait(DOUBLE_CLICK_MS + 50);
        const dialogs = document.querySelectorAll('[data-testid="step2-edit-dialog"]');
        expect(dialogs).toHaveLength(1);
        expect(dialogs[0].textContent).toContain(`Edit step ${HIT_STEP}`);
        expect(locations.every((l) => l.pathname === '/swarm/pipeline/2')).toBe(true);
    });

    it('a double click on the name never opens the editor', async () => {
        render();
        const canvas = document.querySelector('[data-testid="stage-canvas"]');
        act(() => {
            canvas.dispatchEvent(pointer('pointerdown'));
            canvas.dispatchEvent(pointer('pointerup'));
            canvas.dispatchEvent(pointer('pointerdown'));
            canvas.dispatchEvent(pointer('pointerup'));
        });
        await wait(DOUBLE_CLICK_MS + 50);
        expect(document.querySelector('[data-testid="step2-edit-dialog"]')).toBeNull();
    });
});
