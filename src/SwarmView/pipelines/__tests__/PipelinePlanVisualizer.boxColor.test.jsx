// @vitest-environment jsdom
//
// Req #3702 — the Orchestrables box's ids follow the reader's colour key. The
// visualizer hands the box an `idStyleOf` built from the SAME registry, theme
// and resolver as the canvas ids. react-konva, the box and its data hook are
// stubbed: the stub box captures the props the visualizer passes it.

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
        Rect: () => null, Line: () => null, Text: () => null, Path: () => null,
        Circle: () => null, Shape: () => null,
    };
});
vi.mock('konva', () => ({
    default: { Animation: class { start() {} stop() {} } },
}));

let boxItems = [];
let boxProps = null;
vi.mock('../useUnorchestratedRequirements', () => ({
    useUnorchestratedRequirements: () => ({ items: boxItems, isLoading: false, isError: false }),
}));
vi.mock('../UnorchestratedReqBox', async (orig) => ({
    ...(await orig()),
    default: (props) => { boxProps = props; return <div data-testid="box-stub" />; },
}));

import { composedFixture } from './pipelineComposedFixture';
import { adaptComposedPipeline, buildPlanModel } from '../pipelineAdapter';
import PipelinePlanVisualizer from '../PipelinePlanVisualizer';
import { planPalette as palOf, DEFAULT_PLAN_PALETTE, PLAN_VIZ_PALETTE, MACHINE_ANY_COLOR } from '../pipelinePlanLayout';

// The theme the visualizer DRAWS by default — never the no-arg palette (req #3503).

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
    boxItems = [
        // String ids, as the REST read may deliver them.
        { id: '11', title: 'a', requirement_status: 'swarm_ready', coordination_type: 'discuss', machine_fk: null },
        { id: '12', title: 'b', requirement_status: 'swarm_ready', coordination_type: 'deployed', machine_fk: 3 },
    ];
    boxProps = null;
});

afterEach(() => {
    if (root) act(() => { root.unmount(); });
    root = null;
    restoreSize?.();
    document.body.innerHTML = '';
});

function render(props = {}) {
    const payload = composedFixture({
        initiatives: [{ id: 5, title: 'Build', pipeline_fk: 2, sort_order: 1 }],
        steps: [{ id: 10, initiative_fk: 5, title: 'Design', run: 'auto', notes: null,
            not_before: null }],
    });
    const plan = adaptComposedPipeline(payload);
    const model = buildPlanModel(payload, [
        { id: 2, title: 'Mac', platform: 'darwin' },
        { id: 3, title: 'Win', platform: 'wsl' },
    ]);
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

describe('Orchestrables ids follow the colour key (req #3702)', () => {
    it('state: every row paints the theme\'s swarm-ready colour, bold', () => {
        render({ colorKey: 'state' });
        const pal = palOf(DEFAULT_PLAN_PALETTE);
        expect(boxProps.idStyleOf(11)).toEqual({ fill: pal.status.swarm_ready, bold: true });
    });

    it('autonomy: rows paint their own coordination type', () => {
        render({ colorKey: 'autonomy' });
        const pal = palOf(DEFAULT_PLAN_PALETTE);
        expect(boxProps.idStyleOf(11).fill).toBe(pal.autonomy.discuss);
        expect(boxProps.idStyleOf(12).fill).toBe(pal.autonomy.deployed);
    });

    it('machine: a pinned row paints its machine, an unpinned one Any', () => {
        render({ colorKey: 'machine' });
        expect(boxProps.idStyleOf(11).fill).toBe(MACHINE_ANY_COLOR);
        expect(boxProps.idStyleOf(12).fill).not.toBe(MACHINE_ANY_COLOR);
    });

    it('session: reads the page\'s session index, "no session" when absent', () => {
        render({ colorKey: 'session', sessionStatus: new Map([[12, 'active']]) });
        const pal = palOf(DEFAULT_PLAN_PALETTE);
        expect(boxProps.idStyleOf(12).fill).toBe(pal.session.active);
        expect(boxProps.idStyleOf(11).fill).toBe(pal.session.no_session);
    });

    it('none: plain text, regular weight', () => {
        render({ colorKey: 'none' });
        expect(boxProps.idStyleOf(11)).toEqual({ fill: PLAN_VIZ_PALETTE.text, bold: false });
    });
});
