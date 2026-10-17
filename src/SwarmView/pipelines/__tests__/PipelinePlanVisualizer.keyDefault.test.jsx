// @vitest-environment jsdom
//
// The plan visualizer's KEY opens EXPANDED (req #3585, reversing req #3309's
// collapsed default). The default is one `useState` literal, so nothing else
// in the suite would notice it flipping back — this pins it.
//
// jsdom has no canvas, so react-konva is stubbed with inert elements: the key
// is plain MUI chrome over the canvas and never depends on what Konva draws.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { MemoryRouter } from 'react-router-dom';

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
            <MemoryRouter>
                <PipelinePlanVisualizer plan={plan} model={model}
                                        pipeline={payload.pipeline} timezone="UTC" />
            </MemoryRouter>
        );
    });
}

afterEach(() => {
    if (root) act(() => { root.unmount(); });
    root = null;
    document.body.innerHTML = '';
});

describe('the plan key opens expanded (req #3585)', () => {
    it('renders the key content on first mount, with the toggle reading expanded', () => {
        render();
        const toggle = document.querySelector('[data-testid="pipeline-viz-legend-toggle"]');
        expect(toggle).not.toBeNull();
        expect(toggle.getAttribute('aria-expanded')).toBe('true');
        expect(toggle.getAttribute('aria-label')).toBe('Collapse the key');
        expect(toggle.textContent).toBe('−');
    });

    it('still collapses on a click', () => {
        render();
        const toggle = document.querySelector('[data-testid="pipeline-viz-legend-toggle"]');
        act(() => { toggle.click(); });
        expect(toggle.getAttribute('aria-expanded')).toBe('false');
        expect(toggle.textContent).toBe('+');
    });
});
