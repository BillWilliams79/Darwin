// @vitest-environment jsdom
//
// The plan visualizer's KEY opens COLLAPSED (req #3633, reversing req #3585's
// expanded default) and, once opened, STAYS open across a re-mount (req #3651 —
// every transition re-mounts the canvas). The default is one row of
// `planViewSettings.js`, so nothing else in the suite would notice it flipping
// back — this pins it. Storage is cleared before each test: the setting is
// remembered, so a test that opens the key would otherwise leak into the next.
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

function render() {
    const payload = composedFixture();
    const plan = adaptComposedPipeline(payload);
    const model = buildPlanModel(payload);
    const container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
        root.render(
            // The visualizer calls `useQueryClient` (req #3581) — mount it inside one.
            <QueryClientProvider client={new QueryClient()}>
                <MemoryRouter>
                    <PipelinePlanVisualizer plan={plan} model={model}
                                            pipeline={payload.pipeline} timezone="UTC" />
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

describe('the plan key opens collapsed (req #3633)', () => {
    it('renders no key content on first mount, with the toggle reading collapsed', () => {
        render();
        const toggle = document.querySelector('[data-testid="pipeline-viz-legend-toggle"]');
        expect(toggle).not.toBeNull();
        expect(toggle.getAttribute('aria-expanded')).toBe('false');
        expect(toggle.getAttribute('aria-label')).toBe('Expand the key');
        expect(toggle.textContent).toBe('+');
        expect(document.querySelector('[data-testid="pipeline-viz-legend-reqscale"]')).toBeNull();
    });

    it('still expands on a click', () => {
        render();
        const toggle = document.querySelector('[data-testid="pipeline-viz-legend-toggle"]');
        act(() => { toggle.click(); });
        expect(toggle.getAttribute('aria-expanded')).toBe('true');
        expect(toggle.textContent).toBe('−');
        expect(document.querySelector('[data-testid="pipeline-viz-legend-reqscale"]')).not.toBeNull();
    });

    it('stays open across a re-mount once the reader has opened it (req #3651)', () => {
        render();
        act(() => {
            document.querySelector('[data-testid="pipeline-viz-legend-toggle"]').click();
        });
        act(() => { root.unmount(); });
        document.body.innerHTML = '';
        render();                            // Back, a mode switch, a reload: a mount
        const toggle = document.querySelector('[data-testid="pipeline-viz-legend-toggle"]');
        expect(toggle.getAttribute('aria-expanded')).toBe('true');
        expect(document.querySelector('[data-testid="pipeline-viz-legend-reqscale"]')).not.toBeNull();
    });
});
