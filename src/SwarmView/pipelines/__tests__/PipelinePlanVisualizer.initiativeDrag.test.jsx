// @vitest-environment jsdom
//
// req #3861 — "allow the user to drag and drop the initiatives. use the drag
// behavior on the initiative name bar just like how requirement works (press and
// drag, press, long press, doubleclick)". The initiative chip is HTML, so the
// gesture is driven with real pointer events; react-konva is stubbed inert.

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
        Text: () => null, Path: () => null, Shape: () => null,
    };
});

vi.mock('konva', () => ({
    default: { Animation: class { start() {} stop() {} } },
}));

const reorderInitiatives = vi.fn(() => Promise.resolve(null));
vi.mock('../../../Initiatives/initiativesApi', async (orig) => ({
    ...(await orig()),
    reorderInitiatives: (...a) => reorderInitiatives(...a),
}));

import { composedFixture } from './pipelineComposedFixture';
import { adaptComposedPipeline, buildPlanModel } from '../pipelineAdapter';
import { LONG_PRESS_MS } from '../planPressGesture';
import PipelinePlanVisualizer from '../PipelinePlanVisualizer';
import { useSnackBarStore } from '../../../stores/useSnackBarStore';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
if (!globalThis.ResizeObserver) {
    globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
}

let root;
let restoreSize;

beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    reorderInitiatives.mockClear();
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

const epic = (id, initiative_fk, title) => ({
    id, initiative_fk, title, run: 'auto', notes: null, not_before: null,
});

function render({ locked = 0 } = {}) {
    const payload = composedFixture({
        initiatives: [
            { id: 5, title: 'Build', pipeline_fk: 2, sort_order: 1, locked },
            { id: 6, title: 'Ship', pipeline_fk: 2, sort_order: 2 },
        ],
        epics: [epic(10, 5, 'Design'), epic(11, 6, 'Release')],
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
                </MemoryRouter>
            </QueryClientProvider>
        );
    });
}

const q = (id) => document.querySelector(`[data-testid="${id}"]`);
const panel = () => document.querySelector('[data-initiative-dragging]');
const wait = (ms) => act(() => new Promise((r) => { setTimeout(r, ms); }));
const ptr = (type, x, y, extra = {}) => new PointerEvent(type, {
    bubbles: true, button: 0, buttons: type === 'pointerup' ? 0 : 1,
    isPrimary: true, pointerId: 1, pointerType: 'mouse', clientX: x, clientY: y, ...extra,
});
const chipTop = (key) => parseFloat(q(`pipeline-viz-initiative-${key}`).style.top
    || getComputedStyle(q(`pipeline-viz-initiative-${key}`)).top);

describe('dragging an initiative\'s name bar re-orders the plan (req #3861)', () => {
    it('the name bar is the handle, and a press-and-drag lifts it', () => {
        render();
        const name = q('pipeline-viz-initiative-name-6');
        expect(q('pipeline-viz-initiative-6').getAttribute('data-initiative-drag')).toBe('true');
        act(() => { name.dispatchEvent(ptr('pointerdown', 50, 400)); });
        expect(q('pipeline-viz-initiative-drag-preview')).toBeNull();
        act(() => { window.dispatchEvent(ptr('pointermove', 50, 380)); });
        const preview = q('pipeline-viz-initiative-drag-preview');
        expect(preview).not.toBeNull();
        expect(preview.textContent).toBe('Ship');
        expect(panel().getAttribute('data-initiative-dragging')).toBe('6');
        expect(q('pipeline-viz-initiative-6').getAttribute('data-dragging')).toBe('true');
    });

    it('dropped above the first band, it is written first — the whole plan renumbered', async () => {
        render();
        act(() => { q('pipeline-viz-initiative-name-6').dispatchEvent(ptr('pointerdown', 50, 400)); });
        act(() => { window.dispatchEvent(ptr('pointermove', 50, 1)); });
        expect(q('pipeline-viz-initiative-drop-line')).not.toBeNull();
        expect(panel().getAttribute('data-initiative-drop')).toBe('0');
        await act(async () => { window.dispatchEvent(ptr('pointerup', 50, 1)); });
        expect(reorderInitiatives).toHaveBeenCalledTimes(1);
        expect(reorderInitiatives.mock.calls[0][2]).toEqual([
            { id: 6, sort_order: 1 }, { id: 5, sort_order: 2 }]);
        expect(q('pipeline-viz-initiative-drag-preview')).toBeNull();
        // The stack redraws on the drop, before any refetch: Ship now sits on top.
        expect(chipTop(6)).toBeLessThan(chipTop(5));
    });

    it('dropped below the last band, the top initiative is written last (code review C1)', async () => {
        render();
        act(() => { q('pipeline-viz-initiative-name-5').dispatchEvent(ptr('pointerdown', 50, 100)); });
        // The panel's foot: below the middle of the last band, inside the panel.
        act(() => { window.dispatchEvent(ptr('pointermove', 50, 690)); });
        expect(panel().getAttribute('data-initiative-drop')).toBe('2');
        await act(async () => { window.dispatchEvent(ptr('pointerup', 50, 690)); });
        expect(reorderInitiatives.mock.calls[0][2]).toEqual([
            { id: 5, sort_order: 2 }, { id: 6, sort_order: 1 }].sort((a, b) => b.id - a.id));
        expect(chipTop(6)).toBeLessThan(chipTop(5));
    });

    it('Escape, then a release over the chip, is no click (code review W1)', async () => {
        render();
        const open = q('pipeline-viz-initiative-open-6');
        const clicked = vi.fn();
        open.addEventListener('click', clicked);
        act(() => { open.dispatchEvent(ptr('pointerdown', 50, 400)); });
        act(() => { window.dispatchEvent(ptr('pointermove', 50, 1)); });
        expect(q('pipeline-viz-initiative-drag-preview')).not.toBeNull();
        act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); });
        act(() => {
            open.dispatchEvent(ptr('pointerup', 50, 400));
            open.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        });
        expect(clicked).not.toHaveBeenCalled();
    });

    it('a drop back where it came from writes nothing', async () => {
        render();
        // The top band, carried to the top slot — the gap it already fills.
        act(() => { q('pipeline-viz-initiative-name-5').dispatchEvent(ptr('pointerdown', 50, 100)); });
        act(() => { window.dispatchEvent(ptr('pointermove', 50, 1)); });
        expect(q('pipeline-viz-initiative-drag-preview')).not.toBeNull();
        expect(q('pipeline-viz-initiative-drop-line')).toBeNull();
        await act(async () => { window.dispatchEvent(ptr('pointerup', 50, 1)); });
        expect(reorderInitiatives).not.toHaveBeenCalled();
    });

    it('Escape puts it back', async () => {
        render();
        act(() => { q('pipeline-viz-initiative-name-6').dispatchEvent(ptr('pointerdown', 50, 400)); });
        act(() => { window.dispatchEvent(ptr('pointermove', 50, 1)); });
        act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); });
        expect(q('pipeline-viz-initiative-drag-preview')).toBeNull();
        await act(async () => { window.dispatchEvent(ptr('pointerup', 50, 1)); });
        expect(reorderInitiatives).not.toHaveBeenCalled();
    });

    it('a mouse held still is still the long-press rename, and never lifts', async () => {
        render();
        act(() => { q('pipeline-viz-initiative-name-6').dispatchEvent(ptr('pointerdown', 50, 400)); });
        await wait(LONG_PRESS_MS + 50);
        expect(q('pipeline-viz-initiative-edit-6')).not.toBeNull();
        act(() => { window.dispatchEvent(ptr('pointermove', 50, 1)); });
        expect(q('pipeline-viz-initiative-drag-preview')).toBeNull();
    });

    it('a locked sibling keeps its place, and the dragged one is numbered around it', async () => {
        render({ locked: 1 });
        act(() => { q('pipeline-viz-initiative-name-6').dispatchEvent(ptr('pointerdown', 50, 400)); });
        act(() => { window.dispatchEvent(ptr('pointermove', 50, 1)); });
        await act(async () => { window.dispatchEvent(ptr('pointerup', 50, 1)); });
        // Build (locked) stays at 1; Ship goes just above it, at 0.
        expect(reorderInitiatives.mock.calls[0][2]).toEqual([{ id: 6, sort_order: 0 }]);
    });

    it('a locked initiative does not lift, and says why', () => {
        const showError = vi.spyOn(useSnackBarStore.getState(), 'showError');
        render({ locked: 1 });
        act(() => { q('pipeline-viz-initiative-name-5').dispatchEvent(ptr('pointerdown', 50, 100)); });
        act(() => { window.dispatchEvent(ptr('pointermove', 50, 600)); });
        expect(q('pipeline-viz-initiative-drag-preview')).toBeNull();
        expect(reorderInitiatives).not.toHaveBeenCalled();
        expect(String(showError.mock.calls[0]?.[0])).toMatch(/locked/);
        showError.mockRestore();
    });
});
