// @vitest-environment jsdom
//
// The plan visualizer's colour help is a HOVER popup on the toolbar's chips
// (req #3722), no longer a +/- panel parked on the canvas bottom (req
// #3168..#3651) nor a `?` button. The page hands the hovered chip down as
// `keyHover`; nothing is drawn without one.
//
// jsdom has no canvas, so react-konva is stubbed with inert elements: the key
// is plain MUI chrome over the canvas and never depends on what Konva draws.

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
        Text: () => null, Path: () => null,
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

function render(props = {}) {
    if (root) { act(() => { root.unmount(); }); root = null; }
    document.querySelectorAll('[data-rendered]').forEach((n) => n.remove());
    const payload = composedFixture();
    const plan = adaptComposedPipeline(payload);
    const model = buildPlanModel(payload);
    const container = document.createElement('div');
    container.setAttribute('data-rendered', '1');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
        root.render(
            // The visualizer calls `useQueryClient` (req #3581) — mount it inside one.
            <QueryClientProvider client={new QueryClient()}>
                <MemoryRouter>
                    <PipelinePlanVisualizer plan={plan} model={model}
                                            pipeline={payload.pipeline} timezone="UTC" {...props} />
                </MemoryRouter>
            </QueryClientProvider>
        );
    });
}

beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
});

afterEach(() => {
    if (root) act(() => { root.unmount(); });
    root = null;
    document.body.innerHTML = '';
});

const legend = () => document.querySelector('[data-testid="pipeline-viz-legend"]');
const words = () => [...document.querySelectorAll('[data-testid="pipeline-viz-legend-word"]')]
    .map((w) => w.textContent);

// The chip the pointer is on, as the page hands it down: a connected element.
function chip() {
    const el = document.createElement('button');
    document.body.appendChild(el);
    return el;
}

describe('the colour help is a hover popup on the toolbar chips (req #3722)', () => {
    it('draws nothing, and no ? button, until a chip is hovered', () => {
        render();
        expect(legend()).toBeNull();
        expect(document.querySelector('[data-testid="pipeline-viz-legend-toggle"]')).toBeNull();
    });

    it('shows ONLY the hovered colour scale, even when it is not the active one', () => {
        render({ colorKey: 'state', keyHover: { key: 'machine', el: chip() } });
        expect(legend()).not.toBeNull();
        expect(legend().getAttribute('data-key')).toBe('machine');
        expect(words().length).toBeGreaterThan(0);
        const machineWords = words();
        // The active scale ('state') is a different list.
        render({ colorKey: 'state', keyHover: { key: 'state', el: chip() } });
        expect(words()).not.toEqual(machineWords);
        expect(legend().getAttribute('data-key')).toBe('state');
    });

    it('shows the step marks for the Step chip, and no requirement scale', () => {
        render({ keyHover: { key: 'step', el: chip() } });
        const text = legend().textContent;
        for (const m of ['Manual', 'Scheduled', 'Running', 'Complete', 'Up Next',
            'Barrier', 'Locked']) {
            expect(text).toContain(m);
        }
        expect(document.querySelector('[data-testid="pipeline-viz-legend-reqscale"]')).toBeNull();
        // req #3742 — Locked is the card's red perimeter now, not a padlock.
        const swatch = document.querySelector('[data-testid="pipeline-viz-legend-locked-frame"]');
        expect(swatch).not.toBeNull();
        expect(swatch.closest('[data-testid="pipeline-viz-legend-icon"]').textContent)
            .toContain('Locked');
        expect(swatch.closest('[data-testid="pipeline-viz-legend-icon"]')
            .querySelector('[data-lock]')).toBeNull();
    });

    it('does not hide the app from assistive technology (non-modal)', () => {
        const el = chip();
        render({ keyHover: { key: 'step', el } });
        expect(document.querySelector('[data-rendered]').getAttribute('aria-hidden')).toBeNull();
        expect(el.getAttribute('aria-hidden')).toBeNull();
    });

    it('draws nothing while maximized (the header and its chips are hidden)', () => {
        render({ maximized: true, keyHover: { key: 'step', el: chip() } });
        expect(legend()).toBeNull();
    });

    it('closes when the hover ends', () => {
        render({ keyHover: { key: 'step', el: chip() } });
        expect(legend()).not.toBeNull();
        render({ keyHover: null });
        expect(legend()).toBeNull();
    });

    it('never takes the pointer from its chip', () => {
        render({ keyHover: { key: 'step', el: chip() } });
        expect(getComputedStyle(legend().closest('.MuiPopper-root')).pointerEvents).toBe('none');
    });
});
