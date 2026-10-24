// @vitest-environment jsdom
//
// Req #3853 — the plan title's zoom (user directive: "I want the zoom from
// pipeline title to active epics view. so we identify the epics with active
// work and frame zoom that."). The header hands the canvas a `titleZoom`
// nonce; the first activation frames the plan's ACTIVE epics, the next the
// whole plan (the landing / Reset view), and a `deep` one (the title's double
// click) always the active epics.
//
// jsdom has no canvas, so react-konva is stubbed and the camera is read off the
// container's published `data-transform` (the epic-click test's harness).

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('react-konva', () => {
    const Stub = ({ children }) => <div>{typeof children === 'function' ? null : children}</div>;
    return {
        Stage: ({ children }) => <div><canvas data-testid="stage-canvas" />{children}</div>,
        Layer: Stub, Group: Stub,
        Rect: () => null, Circle: () => null,
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

// A chain long enough that the whole plan does not fit at the scale one epic is
// framed at, with ONE running epic (#15 holds a requirement in development).
const IDS = [10, 11, 12, 13, 14, 15, 16, 17];
const RUNNING = 15;
const payload = composedFixture({
    initiatives: [{ id: 5, title: 'Build', pipeline_fk: 2, sort_order: 1 }],
    epics: IDS.map((id) => ({
        id, initiative_fk: 5, title: `Epic ${id}`, run: 'auto', notes: null, not_before: null,
    })),
    epicDeps: IDS.slice(1).map((id, i) => ({ id: i + 1, epic_fk: id, dep_epic_fk: IDS[i] })),
    requirements: [
        { id: 900, title: 'Live work', requirement_status: 'development', tracking: 0 },
        { id: 901, title: 'Done work', requirement_status: 'met', tracking: 0 },
    ],
    epicRequirements: [
        { epic_fk: RUNNING, requirement_fk: 900 },
        { epic_fk: 11, requirement_fk: 901 },
    ],
});
const plan = adaptComposedPipeline(payload);
const model = buildPlanModel(payload);

function render(props) {
    act(() => {
        root.render(
            <QueryClientProvider client={new QueryClient()}>
                <MemoryRouter initialEntries={['/swarm/pipeline/2?mode=plan']}>
                    <PipelinePlanVisualizer plan={plan} model={model} levelPref="auto"
                                            pipeline={payload.pipeline} timezone="UTC"
                                            {...props} />
                </MemoryRouter>
            </QueryClientProvider>
        );
    });
}
function mount(props = {}) {
    const container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    render(props);
}
function unmount() {
    act(() => { root.unmount(); });
    root = null;
    document.body.innerHTML = '';
    localStorage.clear();
    sessionStorage.clear();
}

const transform = () => document.querySelector('[data-testid="pipeline-plan-visualizer"]')
    .getAttribute('data-transform').split(',').map(Number);
// The focus transition is a 420ms d3 transition; let it run to its end.
const settle = () => act(() => new Promise((r) => { setTimeout(r, 800); }));
const close = (a, b) => a.every((v, i) => Math.abs(v - b[i]) < 0.5);

// The camera a `?epic=15` landing puts the reader on — the single-epic frame
// the title's first stop must equal (one active epic is framed as one card).
async function epicFrame() {
    mount({ focusEpicId: RUNNING });
    await settle();
    const t = transform();
    unmount();
    return t;
}

describe('the plan title zooms to the active epics (req #3853)', () => {
    it('first click frames the running epic, the next the whole plan, then back', async () => {
        const expected = await epicFrame();
        mount({ titleZoom: { deep: false, nonce: 0 } });
        await settle();
        const landing = transform();
        expect(close(landing, expected)).toBe(false);   // a real move, not the landing

        render({ titleZoom: { deep: false, nonce: 1 } });
        await settle();
        expect(close(transform(), expected)).toBe(true);

        render({ titleZoom: { deep: false, nonce: 2 } });
        await settle();
        expect(close(transform(), landing)).toBe(true);

        render({ titleZoom: { deep: false, nonce: 3 } });
        await settle();
        expect(close(transform(), expected)).toBe(true);
    });

    it('a deep activation (double click) always lands on the active epics', async () => {
        const expected = await epicFrame();
        mount({ titleZoom: { deep: false, nonce: 0 } });
        await settle();
        render({ titleZoom: { deep: true, nonce: 1 } });
        await settle();
        expect(close(transform(), expected)).toBe(true);
        render({ titleZoom: { deep: true, nonce: 2 } });
        await settle();
        expect(close(transform(), expected)).toBe(true);
    });

    it('a nonzero nonce present at mount does not move the camera', async () => {
        mount({ titleZoom: { deep: false, nonce: 0 } });
        await settle();
        const landing = transform();
        unmount();
        // A panel remounted under a nonce the header already advanced lands as
        // usual — it is only a CHANGE of nonce that is a click.
        mount({ titleZoom: { deep: false, nonce: 5 } });
        await settle();
        expect(close(transform(), landing)).toBe(true);
    });
});
