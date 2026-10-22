// @vitest-environment jsdom
//
// req #3641 — the card thumbnail draws the plan's L3 formation (cards with
// their step names and requirement TITLES), not L1 beads, across the full
// width of the card. react-konva is stubbed so the drawn text is observable.

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';

import { composedFixture } from '../../SwarmView/pipelines/__tests__/pipelineComposedFixture';

vi.mock('react-konva', () => {
    const Stub = ({ children }) => <div>{children}</div>;
    return {
        Stage: ({ children, width }) => <div data-testid="thumb-stage" data-width={width}>{children}</div>,
        Layer: Stub, Group: Stub,
        Rect: () => null, Line: () => null, Path: () => null,
        Text: ({ text }) => <span data-testid="thumb-text">{text}</span>,
    };
});

let composed = null;
vi.mock('../../hooks/useDataQueries', () => ({
    useComposedPipeline: () => ({ data: composed, isLoading: false, isError: false }),
}));

import PipelinePlanThumbnail from '../PipelinePlanThumbnail';

const FRAME_W = 420;
let container;
let root;
let restoreWidth;

beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    globalThis.ResizeObserver = class { observe() {} disconnect() {} };
    // jsdom lays nothing out, so every clientWidth is 0; shadow it on
    // HTMLElement (jsdom defines it on Element) and drop the shadow after.
    Object.defineProperty(HTMLElement.prototype, 'clientWidth',
        { configurable: true, get: () => FRAME_W });
    restoreWidth = () => { delete HTMLElement.prototype.clientWidth; };
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
});

afterEach(() => {
    act(() => root.unmount());
    container.remove();
    restoreWidth();
    composed = null;
});

describe('PipelinePlanThumbnail — L3 crop (req #3641)', () => {
    it('draws step names and requirement titles across the full card width', () => {
        composed = composedFixture({
            id: 7,
            epics: [{ id: 1, pipeline_fk: 7, title: 'Polish', sort_order: 1 }],
            steps: [
                { id: 10, epic_fk: 1, title: 'Visualizer Polish', run: 'auto',
                    notes: null, not_before: null },
                { id: 11, epic_fk: 1, title: 'Cards Polish', run: 'manual',
                    notes: null, not_before: null },
            ],
            requirements: [
                { id: 501, title: 'Brighter arcs', requirement_status: 'met', tracking: 0 },
                { id: 502, title: 'Preview at L3', requirement_status: 'development', tracking: 0 },
            ],
            stepRequirements: [
                { step_fk: 10, requirement_fk: 501 },
                { step_fk: 11, requirement_fk: 502 },
            ],
            stepDeps: [{ id: 1, step_fk: 11, dep_step_fk: 10 }],
        });
        act(() => root.render(<PipelinePlanThumbnail pipelineId={7} />));

        const thumb = container.querySelector('[data-testid="pipelines-card-thumb-7"]');
        expect(thumb.getAttribute('data-thumb-state')).toBe('drawn');
        // The Stage spans the card, not a drawing-hugging sub-box.
        expect(container.querySelector('[data-testid="thumb-stage"]')
            .getAttribute('data-width')).toBe(String(FRAME_W));

        const text = [...container.querySelectorAll('[data-testid="thumb-text"]')]
            .map((n) => n.textContent.replace(/\s+/g, ' ')).join(' | ');
        expect(text).toContain('Visualizer Polish');
        expect(text).toContain('Brighter arcs');
        expect(text).toContain('Preview at L3');
    });

    it('renders a quiet empty frame for a plan with no steps', () => {
        composed = composedFixture({ id: 8, steps: [] });
        act(() => root.render(<PipelinePlanThumbnail pipelineId={8} />));
        const thumb = container.querySelector('[data-testid="pipelines-card-thumb-8"]');
        expect(thumb.getAttribute('data-thumb-state')).toBe('empty');
        expect(container.querySelector('[data-testid="thumb-stage"]')).toBeNull();
    });
});
