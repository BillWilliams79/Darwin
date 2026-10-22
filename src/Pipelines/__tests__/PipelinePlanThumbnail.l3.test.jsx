// @vitest-environment jsdom
//
// req #3641 — the card thumbnail draws the plan's L3 formation (cards with
// their step names and requirement TITLES), not L1 beads, across the full
// width of the card. react-konva is stubbed so the drawn text is observable.

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';

import { composedFixture } from '../../SwarmView/pipelines/__tests__/pipelineComposedFixture';

const drawnRects = vi.hoisted(() => []);
vi.mock('react-konva', () => {
    const Stub = ({ children }) => <div>{children}</div>;
    return {
        Stage: ({ children, width }) => <div data-testid="thumb-stage" data-width={width}>{children}</div>,
        Layer: Stub, Group: Stub,
        Rect: (props) => { drawnRects.push(props); return null; },
        Line: () => null, Path: () => null,
        Text: ({ text }) => <span data-testid="thumb-text">{text}</span>,
    };
});

let composed = null;
vi.mock('../../hooks/useDataQueries', () => ({
    useComposedPipeline: () => ({ data: composed, isLoading: false, isError: false }),
}));

import PipelinePlanThumbnail from '../PipelinePlanThumbnail';
import { CARD_STATE_BAR_W, PLAN_VIZ_PALETTE } from '../../SwarmView/pipelines/pipelinePlanLayout';

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
    drawnRects.length = 0;
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

    // req #3775 — "have the color bar always be the same color as the
    // perimeter of the step": a done, a running and a pending card's bar each
    // take their own frame's colour, never a state fill.
    it('draws every card state bar in its own frame colour', () => {
        composed = composedFixture({
            id: 7,
            epics: [{ id: 1, pipeline_fk: 7, title: 'Polish', sort_order: 1 }],
            steps: [
                { id: 10, epic_fk: 1, title: 'Done', run: 'auto', checkpoint: 0,
                    notes: null, not_before: null },
                { id: 11, epic_fk: 1, title: 'Running', run: 'manual',
                    notes: null, not_before: null },
                { id: 12, epic_fk: 1, title: 'Pending', run: 'auto', checkpoint: 1,
                    notes: null, not_before: null },
            ],
            requirements: [
                { id: 501, title: 'a', requirement_status: 'met', tracking: 0 },
                { id: 502, title: 'b', requirement_status: 'development', tracking: 0 },
                { id: 503, title: 'c', requirement_status: 'swarm_ready', tracking: 0 },
            ],
            stepRequirements: [
                { step_fk: 10, requirement_fk: 501 },
                { step_fk: 11, requirement_fk: 502 },
                { step_fk: 12, requirement_fk: 503 },
            ],
            stepDeps: [{ id: 1, step_fk: 11, dep_step_fk: 10 },
                { id: 2, step_fk: 12, dep_step_fk: 11 }],
        });
        act(() => root.render(<PipelinePlanThumbnail pipelineId={7} />));

        const frames = drawnRects.filter((r) => r.fill === PLAN_VIZ_PALETTE.panel && r.stroke);
        const bars = drawnRects.filter((r) => r.width === CARD_STATE_BAR_W && !r.stroke);
        expect(frames).toHaveLength(3);
        expect(bars).toHaveLength(3);
        for (const bar of bars) {
            // The frame stands just right of its bar (CARD_BAR_GAP), same row.
            const frame = frames
                .filter((f) => f.y === bar.y && f.height === bar.height && f.x > bar.x)
                .sort((f1, f2) => f1.x - f2.x)[0];
            expect(frame, `frame beside the bar at y=${bar.y}`).toBeTruthy();
            expect(bar.fill).toBe(frame.stroke);
        }
        expect(new Set(bars.map((b) => b.fill))).toEqual(new Set([
            PLAN_VIZ_PALETTE.stepWillRun, PLAN_VIZ_PALETTE.stepManual,
            PLAN_VIZ_PALETTE.stepBarrier]));
    });

    it('renders a quiet empty frame for a plan with no steps', () => {
        composed = composedFixture({ id: 8, steps: [] });
        act(() => root.render(<PipelinePlanThumbnail pipelineId={8} />));
        const thumb = container.querySelector('[data-testid="pipelines-card-thumb-8"]');
        expect(thumb.getAttribute('data-thumb-state')).toBe('empty');
        expect(container.querySelector('[data-testid="thumb-stage"]')).toBeNull();
    });
});
