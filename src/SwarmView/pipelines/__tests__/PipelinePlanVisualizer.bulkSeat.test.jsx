// @vitest-environment jsdom
//
// Req #3614 (follow-on to #3608) — the WRITING half of the whole-box drop: the
// confirm dialog opens with the box's snapshot, a locked step writes nothing,
// the seat writes run capped, a partial failure names each id with its own
// status, the dropped rows stay hidden through the write and are released after
// the refetch, the dialog cannot be dismissed mid-write, and a release outside
// the plan panel is never a seat. react-konva, the box and the data hooks are
// stubbed: the stub box hands the test the visualizer's own callbacks.

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

const moveStepRequirement = vi.fn(() => Promise.resolve());
vi.mock('../../../Steps/stepsApi', async (orig) => ({
    ...(await orig()),
    moveStepRequirement: (...a) => moveStepRequirement(...a),
}));

// The box's rows, and the props the visualizer hands the box on its last render.
let boxItems = [];
let boxProps = null;
vi.mock('../useUnorchestratedRequirements', () => ({
    useUnorchestratedRequirements: () => ({ items: boxItems, isLoading: false, isError: false }),
}));
vi.mock('../UnorchestratedReqBox', async (orig) => ({
    ...(await orig()),
    default: (props) => { boxProps = props; return <div data-testid="box-stub" />; },
}));

// Real geometry, except where a test pins the step a drop lands on.
let seatOverride = null;
const resolveSeatDropSpy = vi.fn();
vi.mock('../pipelineUnseated', async (orig) => {
    const actual = await orig();
    return {
        ...actual,
        resolveSeatDrop: (args) => {
            resolveSeatDropSpy(args);
            return seatOverride ? seatOverride(args) : actual.resolveSeatDrop(args);
        },
    };
});

import { composedFixture } from './pipelineComposedFixture';
import { adaptComposedPipeline, buildPlanModel } from '../pipelineAdapter';
import PipelinePlanVisualizer from '../PipelinePlanVisualizer';
import { UNSEATED_FLOAT_Z } from '../UnorchestratedReqBox';
import { rulerExcessY } from '../pipelinePlanLayout';
import { useSnackBarStore } from '../../../stores/useSnackBarStore';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
if (!globalThis.ResizeObserver) {
    globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
}

let root;
let restoreSize;
let canvas;

const row = (id, title) => ({ id, title, requirement_status: 'swarm_ready' });
const step = (id, initiative_fk, title, locked = 0) => ({
    id, initiative_fk, title, run: 'auto', notes: null, locked, not_before: null,
});

beforeEach(() => {
    const w = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
    const h = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight');
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 1200 });
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 700 });
    restoreSize = () => {
        if (w) Object.defineProperty(HTMLElement.prototype, 'clientWidth', w);
        if (h) Object.defineProperty(HTMLElement.prototype, 'clientHeight', h);
    };
    moveStepRequirement.mockReset();
    moveStepRequirement.mockImplementation(() => Promise.resolve());
    resolveSeatDropSpy.mockClear();
    seatOverride = null;
    boxItems = [row(11, 'First thing'), row(12, 'Second thing')];
    boxProps = null;
    useSnackBarStore.setState({ open: false, message: '' });
});

afterEach(() => {
    if (root) act(() => { root.unmount(); });
    root = null;
    restoreSize?.();
    document.elementsFromPoint = undefined;
    document.body.innerHTML = '';
});

function render() {
    const payload = composedFixture({
        initiatives: [{ id: 5, title: 'Build', pipeline_fk: 2, sort_order: 1 }],
        steps: [step(10, 5, 'Design'), step(11, 5, 'Implement', 1)],
        stepDeps: [{ id: 1, step_fk: 11, dep_step_fk: 10 }],
    });
    const plan = adaptComposedPipeline(payload);
    const model = buildPlanModel(payload);
    const container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
        root.render(
            <QueryClientProvider client={new QueryClient()}>
                <MemoryRouter>
                    <PipelinePlanVisualizer plan={plan} model={model} levelPref="3"
                                            pipeline={payload.pipeline} timezone="UTC" />
                </MemoryRouter>
            </QueryClientProvider>
        );
    });
    canvas = document.querySelector('[data-testid="stage-canvas"]');
    // jsdom lays nothing out: pin the panel to 1200x700 at the origin, and put
    // the canvas under every point (the box itself is excluded by the visualizer).
    const panel = document.querySelector('[data-insert-edges]');
    panel.getBoundingClientRect = () => ({
        left: 0, top: 0, right: 1200, bottom: 700, width: 1200, height: 700,
    });
    document.elementsFromPoint = () => [canvas];
}

const seatOn = (stepId, ok = true) => { seatOverride = () => ({ stepId, ok }); };
const drop = (x = 300, y = 300) => {
    let seated;
    act(() => { seated = boxProps.onMoveDrop(x, y); });
    return seated;
};
const dialog = () => document.querySelector('[data-testid="pipeline-viz-bulk-seat-dialog"]');
const confirm = () => document.querySelector('[data-testid="pipeline-viz-bulk-seat-confirm"]');
const cancel = () => document.querySelector('[data-testid="pipeline-viz-bulk-seat-cancel"]');
const listText = () => document.querySelector('[data-testid="pipeline-viz-bulk-seat-list"]')?.textContent;
const settle = (ms = 0) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
const snackbar = () => useSnackBarStore.getState().message;
const deferred = () => {
    let resolve; let reject;
    const promise = new Promise((a, b) => { resolve = a; reject = b; });
    return { promise, resolve, reject };
};

describe('whole-box drop — the confirm dialog', () => {
    it('opens with the box as it stood at the drop, and a later refetch does not change it', () => {
        render();
        seatOn(10);
        expect(drop()).toBe(true);
        expect(dialog()).not.toBeNull();
        expect(document.body.textContent).toContain('Move these 2 requirements?');
        expect(document.querySelector('[data-testid="pipeline-viz-bulk-seat-summary"]').textContent)
            .toContain('"Design"');
        expect(listText()).toContain('First thing');
        expect(listText()).toContain('Second thing');
        // The box refetches while the dialog is open: the approved list stands.
        boxItems = [row(11, 'First thing'), row(12, 'Second thing'), row(13, 'Late arrival')];
        act(() => { boxProps.onMoveOver(300, 300); });
        expect(listText()).not.toContain('Late arrival');
        expect(moveStepRequirement).not.toHaveBeenCalled();
    });

    // req #3750 — a step has no state; what refuses work is a LOCK (req #3649).
    it('a locked step takes no work: a snackbar, no dialog, nothing written', () => {
        render();
        seatOn(11, false);
        expect(drop()).toBe(true);
        expect(dialog()).toBeNull();
        expect(snackbar()).toBe('"Implement" is locked — it takes no new work');
        expect(moveStepRequirement).not.toHaveBeenCalled();
    });

    it('keeps its title and list while it closes, then empties', async () => {
        render();
        seatOn(10);
        drop();
        act(() => { cancel().click(); });
        // The exit transition is running: the content is still the request.
        expect(document.body.textContent).toContain('Move these 2 requirements?');
        expect(listText()).toContain('First thing');
        await settle(800);
        expect(dialog()).toBeNull();
        expect(moveStepRequirement).not.toHaveBeenCalled();
    });
});

describe('whole-box drop — the writes', () => {
    it('seats every id onto the step with moveStepRequirement, capped in flight', async () => {
        boxItems = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => row(100 + n, `Req ${n}`));
        render();
        seatOn(10);
        drop();
        let inflight = 0;
        let peak = 0;
        moveStepRequirement.mockImplementation(async () => {
            inflight += 1;
            peak = Math.max(peak, inflight);
            await new Promise((r) => setTimeout(r, 10));
            inflight -= 1;
        });
        await act(async () => { confirm().click(); });
        await settle(200);
        expect(moveStepRequirement).toHaveBeenCalledTimes(8);
        for (const call of moveStepRequirement.mock.calls) {
            expect(call[2].toStepId).toBe(10);
            expect(call[2].fromStepId).toBeUndefined();
        }
        expect(moveStepRequirement.mock.calls.map((c) => c[2].requirementId).sort())
            .toEqual([101, 102, 103, 104, 105, 106, 107, 108]);
        expect(peak).toBeGreaterThan(1);
        expect(peak).toBeLessThanOrEqual(4);
        expect(snackbar()).toBe('');
    });

    it('hides the dropped ids from the box during the write and releases them after', async () => {
        render();
        seatOn(10);
        drop();
        expect(boxProps.items.map((r) => r.id)).toEqual([11, 12]);
        const gate = deferred();
        moveStepRequirement.mockImplementation(() => gate.promise);
        await act(async () => { confirm().click(); });
        expect(boxProps.items).toEqual([]);
        await act(async () => { gate.resolve(); });
        await settle(50);
        // Written, refetched: the (stub) hook's rows are the box's again.
        expect(boxProps.items.map((r) => r.id)).toEqual([11, 12]);
    });

    it('cannot be cancelled, escaped or clicked away while writing', async () => {
        render();
        seatOn(10);
        drop();
        const gate = deferred();
        moveStepRequirement.mockImplementation(() => gate.promise);
        await act(async () => { confirm().click(); });
        expect(cancel().disabled).toBe(true);
        expect(confirm().disabled).toBe(true);
        expect(confirm().textContent).toBe('Moving…');

        act(() => { cancel().click(); });
        const dlg = document.querySelector('[role="dialog"]');
        act(() => {
            dlg.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        });
        const container = document.querySelector('.MuiDialog-container');
        act(() => {
            container.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
            container.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        });
        await settle(400);
        expect(document.querySelector('[data-testid="pipeline-viz-bulk-seat-list"]')).not.toBeNull();
        expect(document.querySelector('[role="dialog"]')).not.toBeNull();

        await act(async () => { gate.resolve(); });
        await settle(800);
        expect(dialog()).toBeNull();
    });

    it('a second Move click while the dialog is closing writes nothing more', async () => {
        render();
        seatOn(10);
        drop();
        await act(async () => { confirm().click(); });
        // Writes done, dialog fading out: the buttons are still in the DOM.
        const calls = moveStepRequirement.mock.calls.length;
        expect(calls).toBe(2);
        const btn = confirm();
        if (btn) act(() => { btn.click(); });
        await settle(800);
        expect(moveStepRequirement).toHaveBeenCalledTimes(calls);
        expect(snackbar()).toBe('');
    });

    it('names each failed id with its own status on a partial failure', async () => {
        boxItems = [row(11, 'a'), row(12, 'b'), row(13, 'c')];
        render();
        seatOn(10);
        drop();
        moveStepRequirement.mockImplementation(async (_u, _t, { requirementId }) => {
            if (requirementId === 12) throw { httpStatus: { httpStatus: 409 } };
            if (requirementId === 13) throw { httpStatus: { httpStatus: 500 } };
        });
        await act(async () => { confirm().click(); });
        await settle(50);
        expect(snackbar()).toBe('Added 1 of 3; unable to add 12 (409), 13 (500)');
    });

    it('says plainly when every write failed', async () => {
        render();
        seatOn(10);
        drop();
        moveStepRequirement.mockImplementation(async () => { throw { httpStatus: { httpStatus: 409 } }; });
        await act(async () => { confirm().click(); });
        await settle(50);
        expect(snackbar()).toBe('Unable to add 11 (409), 12 (409) to the step');
        // The failed rows are not stranded hidden.
        expect(boxProps.items.map((r) => r.id)).toEqual([11, 12]);
    });
});

describe('whole-box drop — only on the plan panel', () => {
    it('a release with nothing beneath it (past the window edge) is no seat', () => {
        render();
        document.elementsFromPoint = () => [];
        expect(drop(300, 300)).toBe(false);
        expect(dialog()).toBeNull();
        expect(resolveSeatDropSpy).toHaveBeenLastCalledWith(
            expect.objectContaining({ overChrome: true }));
        expect(moveStepRequirement).not.toHaveBeenCalled();
    });

    it('a release outside the panel rect is no seat even over an element', () => {
        render();
        expect(drop(1500, 300)).toBe(false);
        expect(drop(300, -40)).toBe(false);
        expect(dialog()).toBeNull();
        expect(resolveSeatDropSpy).toHaveBeenLastCalledWith(
            expect.objectContaining({ overChrome: true }));
    });

    it('inside the panel, over the canvas, the point is judged by geometry', () => {
        render();
        drop(300, 300);
        expect(resolveSeatDropSpy).toHaveBeenLastCalledWith(
            expect.objectContaining({ overChrome: false, point: { x: 300, y: 300 } }));
    });
});

// req #3648 — the landing (= Default) camera pulls the plan down by the ruler's
// screen excess, so the pinned date strip never covers the top band's header.
describe('the base view clears the ruler (req #3648)', () => {
    it('lands with y equal to the ruler excess at its scale', () => {
        // A short panel, so the vertical fit lands below k = 1 where the
        // excess is non-zero (at 700px this plan lands at k ≈ 1.02, excess 0).
        Object.defineProperty(HTMLElement.prototype, 'clientHeight',
            { configurable: true, get: () => 200 });
        // First visit: no camera remembered by an earlier test to restore.
        window.localStorage.clear();
        window.sessionStorage.clear();
        render();
        const panel = document.querySelector('[data-insert-edges]');
        const [x, y, k] = panel.getAttribute('data-transform').split(',').map(Number);
        expect(k).toBeLessThan(1);
        expect(rulerExcessY(k)).toBeGreaterThan(1);
        expect(x).toBe(0);
        expect(y).toBeCloseTo(rulerExcessY(k), 1);
    });
});

describe('whole-box drop — the outline while carrying', () => {
    const outline = () => document.querySelector('[data-testid="pipeline-viz-seat-target"]');

    // A carried box is a placed one, fixed in the window at UNSEATED_FLOAT_Z
    // (req #3687).
    it('is drawn above the box (zIndex over the placed box\'s) only while the box is carried', () => {
        render();
        seatOn(10);
        act(() => { boxProps.onMoveOver(300, 300); });
        expect(outline()).not.toBeNull();
        expect(outline().getAttribute('data-step-id')).toBe('10');
        expect(getComputedStyle(outline()).zIndex).toBe('1');
        act(() => { boxProps.onCarryingChange(true); });
        expect(Number(getComputedStyle(outline()).zIndex)).toBeGreaterThan(UNSEATED_FLOAT_Z);
        act(() => { boxProps.onCarryingChange(false); });
        expect(getComputedStyle(outline()).zIndex).toBe('1');
    });

    it('re-resolves from the last pointer when the transform changes mid-carry', () => {
        render();
        // The step under a FIXED pointer depends on the live zoom.
        const panel = document.querySelector('[data-insert-edges]');
        const k0 = Number(panel.getAttribute('data-transform').split(',')[2]);
        seatOverride = ({ t }) => ({ stepId: t.k > k0 + 0.01 ? 11 : 10, ok: true });
        act(() => { boxProps.onCarryingChange(true); });
        act(() => { boxProps.onMoveOver(300, 300); });
        expect(outline().getAttribute('data-step-id')).toBe('10');
        const before = panel.getAttribute('data-transform');
        act(() => {
            panel.dispatchEvent(new WheelEvent('wheel', {
                deltaY: -400, clientX: 300, clientY: 300, bubbles: true, cancelable: true,
            }));
        });
        expect(panel.getAttribute('data-transform')).not.toBe(before);
        expect(outline().getAttribute('data-step-id')).toBe('11');
    });

    it('does not re-resolve once the carry has ended', () => {
        render();
        seatOn(10);
        act(() => { boxProps.onCarryingChange(true); });
        act(() => { boxProps.onMoveOver(300, 300); });
        act(() => { boxProps.onMoveOver(null, null); });
        expect(outline()).toBeNull();
        const calls = resolveSeatDropSpy.mock.calls.length;
        const panel = document.querySelector('[data-insert-edges]');
        act(() => {
            panel.dispatchEvent(new WheelEvent('wheel', {
                deltaY: -400, clientX: 300, clientY: 300, bubbles: true, cancelable: true,
            }));
        });
        expect(resolveSeatDropSpy.mock.calls.length).toBe(calls);
        expect(outline()).toBeNull();
    });
});
