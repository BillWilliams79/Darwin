// @vitest-environment jsdom
//
// req #3804 review — the card preview is the WHOLE plan as an L1/L2 overview:
// every initiative band, every epic as a bead carrying its requirement-count
// badge, condensed to the frame. react-konva is stubbed so what is drawn is
// observable.

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';

import { composedFixture } from '../../SwarmView/pipelines/__tests__/pipelineComposedFixture';

const drawn = vi.hoisted(() => ({ circles: [], rects: [], paths: [], wedges: [] }));
vi.mock('react-konva', () => {
    const Stub = ({ children }) => <div>{children}</div>;
    return {
        Stage: ({ children, width, height }) => (
            <div data-testid="thumb-stage" data-width={width} data-height={height}>{children}</div>),
        Layer: Stub, Group: Stub,
        Rect: (props) => { drawn.rects.push(props); return null; },
        Circle: (props) => { drawn.circles.push(props); return null; },
        Path: (props) => { drawn.paths.push(props); return null; },
        Wedge: (props) => { drawn.wedges.push(props); return null; },
        Line: () => null,
        Text: ({ text }) => <span data-testid="thumb-text">{text}</span>,
    };
});

let composed = null;
vi.mock('../../hooks/useDataQueries', () => ({
    useComposedPipeline: () => ({ data: composed, isLoading: false, isError: false }),
}));

import PipelinePlanThumbnail, { THUMB_H } from '../PipelinePlanThumbnail';
import { PERCENT_NONE_COLOR } from '../previewColor';

const FRAME_W = 420;
let container;
let root;

beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    globalThis.ResizeObserver = class { observe() {} disconnect() {} };
    Object.defineProperty(HTMLElement.prototype, 'clientWidth',
        { configurable: true, get: () => FRAME_W });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
});

afterEach(() => {
    act(() => root.unmount());
    container.remove();
    delete HTMLElement.prototype.clientWidth;
    composed = null;
    drawn.circles.length = 0;
    drawn.rects.length = 0;
    drawn.paths.length = 0;
    drawn.wedges.length = 0;
});

const plan = () => composedFixture({
    id: 7,
    initiatives: [{ id: 1, pipeline_fk: 7, title: 'Polish', sort_order: 1 },
        { id: 2, pipeline_fk: 7, title: 'Cards', sort_order: 2 }],
    epics: [
        { id: 10, initiative_fk: 1, title: 'A', run: 'auto', notes: null, not_before: null },
        { id: 11, initiative_fk: 1, title: 'B', run: 'auto', notes: null, not_before: null },
        { id: 12, initiative_fk: 2, title: 'C', run: 'auto', notes: null, not_before: null },
    ],
    requirements: [
        { id: 501, title: 'x', requirement_status: 'met', tracking: 0 },
        { id: 502, title: 'y', requirement_status: 'development', tracking: 0 },
        { id: 503, title: 'z', requirement_status: 'swarm_ready', tracking: 0 },
    ],
    epicRequirements: [
        { epic_fk: 10, requirement_fk: 501 },
        { epic_fk: 11, requirement_fk: 502 },
        { epic_fk: 11, requirement_fk: 503 },
    ],
    epicDeps: [{ id: 1, epic_fk: 11, dep_epic_fk: 10 }],
});

describe('PipelinePlanThumbnail — whole-plan overview (req #3804)', () => {
    it('draws every epic as a bead with its requirement-count badge, and no titles', () => {
        composed = plan();
        act(() => root.render(<PipelinePlanThumbnail pipelineId={7} />));
        const thumb = container.querySelector('[data-testid="pipelines-card-thumb-7"]');
        expect(thumb.getAttribute('data-thumb-state')).toBe('drawn');
        const stage = container.querySelector('[data-testid="thumb-stage"]');
        expect(stage.getAttribute('data-width')).toBe(String(FRAME_W));
        expect(stage.getAttribute('data-height')).toBe(String(THUMB_H));

        const texts = [...container.querySelectorAll('[data-testid="thumb-text"]')]
            .map((n) => n.textContent).sort();
        expect(texts).toEqual(['0', '1', '2']);     // the three badges, nothing else

        // Every bead and badge lies inside the frame — the WHOLE plan fits.
        const beads = drawn.circles.filter((c) => c.fill);
        expect(beads).toHaveLength(3);
        for (const c of beads) {
            expect(c.x - c.radius).toBeGreaterThanOrEqual(0);
            expect(c.x + c.radius).toBeLessThanOrEqual(FRAME_W);
            expect(c.y - c.radius).toBeGreaterThanOrEqual(0);
            expect(c.y + c.radius).toBeLessThanOrEqual(THUMB_H);
        }
        expect(drawn.paths).toHaveLength(1);         // the one dependency
    });

    it('renders a quiet empty frame for a plan with no epics', () => {
        composed = composedFixture({ id: 8, epics: [] });
        act(() => root.render(<PipelinePlanThumbnail pipelineId={8} />));
        const thumb = container.querySelector('[data-testid="pipelines-card-thumb-8"]');
        expect(thumb.getAttribute('data-thumb-state')).toBe('empty');
        expect(container.querySelector('[data-testid="thumb-stage"]')).toBeNull();
    });

    it('colours beads by progress by default: dark red at 0%, dark green at 100%, a mix between', () => {
        composed = plan();
        act(() => root.render(<PipelinePlanThumbnail pipelineId={7} />));
        const fills = drawn.circles.filter((c) => c.fill).map((c) => c.fill).sort();
        // A: 1/1 closed -> dark green. B: 0/2 closed -> dark red. C: no work -> neutral.
        expect(fills).toEqual([PERCENT_NONE_COLOR, '#14692b', '#a31515'].sort());
        expect(container.querySelector('[data-testid="pipelines-card-thumb-7"]')
            .getAttribute('data-color-mode')).toBe('percent');
    });

    it('draws a scale mode as a pie of the epic\'s requirements', () => {
        composed = plan();
        act(() => root.render(<PipelinePlanThumbnail pipelineId={7} colorMode="state" />));
        // Epic B holds a development and a swarm_ready requirement: two slices.
        expect(drawn.wedges).toHaveLength(2);
        expect(drawn.wedges.reduce((n, w) => n + w.angle, 0)).toBeCloseTo(360);
    });

    it('keeps the original flag colouring behind the Flags mode', () => {
        composed = plan();
        act(() => root.render(<PipelinePlanThumbnail pipelineId={7} colorMode="flags" />));
        expect(drawn.wedges).toHaveLength(0);
        expect(drawn.circles.filter((c) => c.fill)).toHaveLength(3);
    });
});
