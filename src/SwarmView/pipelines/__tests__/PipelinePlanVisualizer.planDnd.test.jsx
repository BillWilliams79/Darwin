// @vitest-environment jsdom
//
// Req #3665 — the plan canvas on the shared press timeline.
//
//   the requirement marks   pointer events, so a finger drives them: held still
//                           it lifts (a haptic tick), moved first it is d3's pan,
//                           lifted it moves to another step; the lifted finger's
//                           touchmove never reaches d3 and its touchend is no tap
//   the Orchestrables rows  a dnd-kit drag whose collision detection is the
//                           canvas's own step hit test
//
// jsdom has no canvas: react-konva is stubbed, and the Stage exposes the two
// calls the gesture makes — `getIntersection` answers a requirement mark over
// one small rectangle — so the press is real DOM input against a fake scene.
// Where a drop lands is pinned (`dropOn` / `seatOn`), since the layout's card
// frames are not reachable from outside.

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act, forwardRef, useImperativeHandle } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// The requirement mark: client (100..140, 100..114) on the panel at the origin.
const MARK = { x: 100, y: 100, w: 40, h: 14 };
const markNode = {
    getAttr: (k) => ({ dragReqId: 900, dragStepId: 10 })[k],
    getStage: () => true,
    getParent: () => null,
    toDataURL: () => 'data:image/png;base64,',
    getClientRect: () => ({ x: MARK.x, y: MARK.y, width: MARK.w, height: MARK.h }),
    fire: () => {},
};

vi.mock('react-konva', () => {
    const Stub = ({ children }) => <div>{typeof children === 'function' ? null : children}</div>;
    const Stage = forwardRef(function StageStub({ children }, ref) {
        useImperativeHandle(ref, () => ({
            getIntersection: (p) => (p.x >= MARK.x && p.x <= MARK.x + MARK.w
                && p.y >= MARK.y && p.y <= MARK.y + MARK.h ? markNode : null),
            container: () => document.querySelector('[data-testid="stage-canvas"]')?.parentElement,
        }));
        return <div><canvas data-testid="stage-canvas" />{children}</div>;
    });
    return {
        Stage, Layer: Stub, Group: Stub,
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

let boxItems = [];
let boxProps = null;
vi.mock('../useUnorchestratedRequirements', () => ({
    useUnorchestratedRequirements: () => ({ items: boxItems, isLoading: false, isError: false }),
}));
vi.mock('../UnorchestratedReqBox', async (orig) => ({
    ...(await orig()),
    default: (props) => { boxProps = props; return <div data-testid="box-stub" />; },
}));

// The drag surface's props, so the box-row tests can drive its handlers.
let dndProps = null;
vi.mock('../../../dnd', async (orig) => ({
    ...(await orig()),
    DarwinDndContext: (props) => { dndProps = props; return props.children; },
}));

let dropOverride = null;
vi.mock('../pipelineReqDrag', async (orig) => {
    const actual = await orig();
    return {
        ...actual,
        dropTargetAt: (nodes, p) => (dropOverride ? dropOverride(p) : actual.dropTargetAt(nodes, p)),
    };
});
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
import { UNSEATED_DRAG_TYPE } from '../pipelineUnseated';
import {
    LIFT_DELAY_MS, LIFT_VIBRATE_MS, LONG_PRESS_MS, TOUCH_TOLERANCE_PX,
} from '../../../dnd/pressTimeline';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
if (!globalThis.ResizeObserver) {
    globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
}

let root;
let restoreSize;
let canvas;
let panel;
let vibrate;
let hadVibrate;

const step = (id, title, locked = 0) => ({
    id, initiative_fk: 5, title, run: 'auto', notes: null, locked, not_before: null,
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
    dropOverride = null;
    seatOverride = null;
    boxItems = [{ id: 11, title: 'First thing', requirement_status: 'swarm_ready' }];
    boxProps = null;
    dndProps = null;
    vibrate = vi.fn();
    hadVibrate = Object.getOwnPropertyDescriptor(navigator, 'vibrate');
    Object.defineProperty(navigator, 'vibrate', { configurable: true, value: vibrate });
    localStorage.clear();
    sessionStorage.clear();
});

afterEach(() => {
    if (root) act(() => { root.unmount(); });
    root = null;
    restoreSize?.();
    if (hadVibrate) Object.defineProperty(navigator, 'vibrate', hadVibrate);
    else delete navigator.vibrate;
    document.elementsFromPoint = undefined;
    document.body.innerHTML = '';
});

function render() {
    const payload = composedFixture({
        initiatives: [{ id: 5, title: 'Build', pipeline_fk: 2, sort_order: 1 }],
        steps: [step(10, 'Design'), step(11, 'Frozen', 1), step(12, 'Implement')],
        stepDeps: [{ id: 1, step_fk: 11, dep_step_fk: 10 }, { id: 2, step_fk: 12, dep_step_fk: 11 }],
        requirements: [{ id: 900, title: 'Move me', requirement_status: 'swarm_ready', tracking: 0 }],
        stepRequirements: [{ step_fk: 10, requirement_fk: 900 }],
    });
    const container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
        root.render(
            <QueryClientProvider client={new QueryClient()}>
                <MemoryRouter>
                    <PipelinePlanVisualizer plan={adaptComposedPipeline(payload)}
                                            model={buildPlanModel(payload)} levelPref="3"
                                            pipeline={payload.pipeline} timezone="UTC" />
                </MemoryRouter>
            </QueryClientProvider>
        );
    });
    canvas = document.querySelector('[data-testid="stage-canvas"]');
    panel = document.querySelector('[data-insert-edges]');
    panel.getBoundingClientRect = () => ({
        left: 0, top: 0, right: 1200, bottom: 700, width: 1200, height: 700,
    });
    document.elementsFromPoint = () => [canvas];
}

// A pointer event as the browser sends it — jsdom has no PointerEvent.
const pointer = (type, x, y, { pointerType = 'touch', pointerId = 1, buttons = 1, isPrimary = true } = {}) => {
    const ev = new MouseEvent(type, {
        bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, buttons,
    });
    Object.defineProperty(ev, 'pointerType', { value: pointerType });
    Object.defineProperty(ev, 'pointerId', { value: pointerId });
    Object.defineProperty(ev, 'isPrimary', { value: isPrimary });
    act(() => { canvas.dispatchEvent(ev); });
    return ev;
};
const touchEvent = (type) => {
    const ev = new Event(type, { bubbles: true, cancelable: true });
    ev.touches = [];
    act(() => { canvas.dispatchEvent(ev); });
    return ev;
};
const wait = (ms) => act(async () => { await new Promise((r) => { setTimeout(r, ms); }); });
const inFlight = () => panel.getAttribute('data-req-drag');
const dropStep = () => panel.getAttribute('data-drop-step');
const dropOn = (stepId) => { dropOverride = () => stepId; };

describe('a requirement mark on the press timeline, by touch (req #3665)', () => {
    it('held still, it lifts with a haptic tick; moved, it carries; released on a step, it moves', async () => {
        render();
        pointer('pointerdown', 110, 105);
        await wait(LIFT_DELAY_MS - 150);
        expect(inFlight()).toBe('');
        await wait(190);
        expect(inFlight()).toBe('900');
        expect(vibrate).toHaveBeenCalledWith(LIFT_VIBRATE_MS);
        expect(document.querySelector('[data-testid="pipeline-viz-req-drag-preview"]')).not.toBeNull();
        dropOn(12);
        pointer('pointermove', 500, 300);
        expect(dropStep()).toBe('12');
        pointer('pointerup', 500, 300, { buttons: 0 });
        expect(inFlight()).toBe('');
        expect(moveStepRequirement).toHaveBeenCalledTimes(1);
        expect(moveStepRequirement.mock.calls[0][2])
            .toEqual({ requirementId: 900, fromStepId: 10, toStepId: 12 });
    });

    it('moved before the lift, it is a pan: nothing lifts, nothing moves', async () => {
        render();
        pointer('pointerdown', 110, 105);
        pointer('pointermove', 110 + TOUCH_TOLERANCE_PX + 3, 105);
        pointer('pointermove', 300, 200);
        await wait(LIFT_DELAY_MS + 60);
        expect(inFlight()).toBe('');
        expect(vibrate).not.toHaveBeenCalled();
        pointer('pointerup', 300, 200, { buttons: 0 });
        expect(moveStepRequirement).not.toHaveBeenCalled();
    });

    it('a resting fingertip within the tolerance still lifts', async () => {
        render();
        pointer('pointerdown', 110, 105);
        pointer('pointermove', 113, 107);
        await wait(LIFT_DELAY_MS + 40);
        expect(inFlight()).toBe('900');
    });

    it('a locked step refuses the drop (req #3649 — a step has no state, req #3750)', async () => {
        render();
        pointer('pointerdown', 110, 105);
        await wait(LIFT_DELAY_MS + 40);
        dropOn(11);
        pointer('pointermove', 500, 300);
        expect(dropStep()).toBe('');
        pointer('pointerup', 500, 300, { buttons: 0 });
        expect(moveStepRequirement).not.toHaveBeenCalled();
    });

    it('lifted, the finger is the requirement\'s: d3 never sees it move, and its release is no tap', async () => {
        render();
        const panSeen = vi.fn();
        panel.addEventListener('touchmove', panSeen);
        // Before the lift the pan is d3's.
        pointer('pointerdown', 110, 105);
        expect(touchEvent('touchmove').defaultPrevented).toBe(false);
        expect(panSeen).toHaveBeenCalledTimes(1);
        await wait(LIFT_DELAY_MS + 40);
        const moved = touchEvent('touchmove');
        expect(panSeen).toHaveBeenCalledTimes(1);
        expect(moved.defaultPrevented).toBe(true);
        pointer('pointerup', 110, 105, { buttons: 0 });
        expect(touchEvent('touchend').defaultPrevented).toBe(true);
        // ...once: the next tap is a tap.
        pointer('pointerdown', 110, 105);
        pointer('pointerup', 110, 105, { buttons: 0 });
        expect(touchEvent('touchend').defaultPrevented).toBe(false);
    });

    it('a second finger puts the requirement back — the pinch is d3\'s', async () => {
        render();
        pointer('pointerdown', 110, 105);
        await wait(LIFT_DELAY_MS + 40);
        expect(inFlight()).toBe('900');
        pointer('pointerdown', 400, 400, { pointerId: 2, isPrimary: false });
        expect(inFlight()).toBe('');
        // The pinch's moves reach d3 (review finding: they were withheld).
        const pinchSeen = vi.fn();
        panel.addEventListener('touchmove', pinchSeen);
        expect(touchEvent('touchmove').defaultPrevented).toBe(false);
        expect(pinchSeen).toHaveBeenCalledTimes(1);
        dropOn(12);
        pointer('pointermove', 500, 300);
        pointer('pointerup', 500, 300, { buttons: 0 });
        expect(moveStepRequirement).not.toHaveBeenCalled();
    });

    it('a hold slow to start moving is still a drag, never the title edit (the reported defect)', async () => {
        render();
        pointer('pointerdown', 110, 105);
        await wait(LONG_PRESS_MS + 250);
        expect(inFlight()).toBe('900');
        dropOn(12);
        pointer('pointermove', 500, 300);
        pointer('pointerup', 500, 300, { buttons: 0 });
        expect(document.querySelector('[data-testid="pipeline-viz-req-edit-900"]')).toBeNull();
        expect(moveStepRequirement.mock.calls[0][2])
            .toEqual({ requirementId: 900, fromStepId: 10, toStepId: 12 });
    });

    it('held past the long press and let go in place, it opens the title editor', async () => {
        render();
        pointer('pointerdown', 110, 105);
        await wait(LONG_PRESS_MS + 100);
        expect(document.querySelector('[data-testid="pipeline-viz-req-edit-900"]')).toBeNull();
        pointer('pointerup', 111, 106, { buttons: 0 });
        expect(document.querySelector('[data-testid="pipeline-viz-req-edit-900"]')).not.toBeNull();
        expect(inFlight()).toBe('');
        expect(touchEvent('touchend').defaultPrevented).toBe(true);
        expect(moveStepRequirement).not.toHaveBeenCalled();
    });

    it('a touch the system cancels leaves no swallowed tap behind', async () => {
        render();
        pointer('pointerdown', 110, 105);
        await wait(LIFT_DELAY_MS + 40);
        expect(inFlight()).toBe('900');
        pointer('pointercancel', 110, 105, { buttons: 0 });
        touchEvent('touchcancel');
        expect(inFlight()).toBe('');
        // The next tap, anywhere, is a tap.
        expect(touchEvent('touchend').defaultPrevented).toBe(false);
        expect(moveStepRequirement).not.toHaveBeenCalled();
    });

    it('a quick tap lifts nothing', async () => {
        render();
        pointer('pointerdown', 110, 105);
        pointer('pointerup', 110, 105, { buttons: 0 });
        await wait(LIFT_DELAY_MS + 40);
        expect(inFlight()).toBe('');
        expect(vibrate).not.toHaveBeenCalled();
    });
});

describe('a requirement mark by mouse — desktop unchanged (req #3665)', () => {
    it('a move past the slop lifts at once, with no haptic tick', () => {
        render();
        pointer('pointerdown', 110, 105, { pointerType: 'mouse' });
        pointer('pointermove', 118, 105, { pointerType: 'mouse' });
        expect(inFlight()).toBe('900');
        expect(vibrate).not.toHaveBeenCalled();
        dropOn(12);
        pointer('pointermove', 500, 300, { pointerType: 'mouse' });
        pointer('pointerup', 500, 300, { pointerType: 'mouse', buttons: 0 });
        expect(moveStepRequirement.mock.calls[0][2])
            .toEqual({ requirementId: 900, fromStepId: 10, toStepId: 12 });
    });

    it('Escape puts a lifted requirement back; the release is neither a drop nor a click', () => {
        render();
        pointer('pointerdown', 110, 105, { pointerType: 'mouse' });
        pointer('pointermove', 118, 105, { pointerType: 'mouse' });
        expect(inFlight()).toBe('900');
        act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); });
        expect(inFlight()).toBe('');
        dropOn(12);
        pointer('pointerup', 500, 300, { pointerType: 'mouse', buttons: 0 });
        expect(moveStepRequirement).not.toHaveBeenCalled();
    });
});

describe('a long click by mouse is the title edit, while held (req #3665 review)', () => {
    const editor = () => document.querySelector('[data-testid="pipeline-viz-req-edit-900"]');

    it('a mouse held still never lifts the requirement', async () => {
        render();
        pointer('pointerdown', 110, 105, { pointerType: 'mouse' });
        await wait(LIFT_DELAY_MS + 60);
        expect(inFlight()).toBe('');
    });

    it('held still to the long press, the editor opens under the held pointer, focused', async () => {
        render();
        pointer('pointerdown', 110, 105, { pointerType: 'mouse' });
        await wait(LONG_PRESS_MS + 60);
        expect(editor()).not.toBeNull();
        expect(document.activeElement).toBe(editor());
        // A caret, not the title selected (user directive: "should not select
        // all the text but rather insert the cursor blinking at the point
        // clicked"). jsdom has no layout, so WHERE is the E2E's to prove.
        expect(window.getSelection().isCollapsed).toBe(true);
        // The release that follows is neither a drop nor the click that opens
        // the requirement page.
        dropOn(12);
        pointer('pointerup', 110, 105, { pointerType: 'mouse', buttons: 0 });
        expect(editor()).not.toBeNull();
        expect(moveStepRequirement).not.toHaveBeenCalled();
    });

    it('a press moved before the long press is a drag, and opens no editor', async () => {
        render();
        pointer('pointerdown', 110, 105, { pointerType: 'mouse' });
        await wait(LIFT_DELAY_MS);
        dropOn(12);
        pointer('pointermove', 500, 300, { pointerType: 'mouse' });
        await wait(LONG_PRESS_MS);
        pointer('pointerup', 500, 300, { pointerType: 'mouse', buttons: 0 });
        expect(editor()).toBeNull();
        expect(moveStepRequirement).toHaveBeenCalledTimes(1);
    });
});

describe('an Orchestrables row seats through the shared drag surface (req #3665)', () => {
    const rowDrag = (type = UNSEATED_DRAG_TYPE, id = 11) => ({
        id: `unseated:${id}`, data: { current: { kind: 'item', type, row: { id } } },
    });
    const collide = (x = 500, y = 300, active = rowDrag()) => {
        let out;
        act(() => { out = dndProps.collisionDetection({ active, pointerCoordinates: { x, y } }); });
        return out;
    };

    it('the collision detection is the canvas step hit test, through the live camera', () => {
        render();
        seatOverride = (args) => ({ stepId: 12, ok: true, args });
        const hits = collide(500, 300);
        expect(hits).toHaveLength(1);
        expect(hits[0].data.target).toMatchObject({ stepId: 12, ok: true });
        const args = resolveSeatDropSpy.mock.calls.at(-1)[0];
        expect(args.point).toEqual({ x: 500, y: 300 });
        expect(args.overChrome).toBe(false);
        expect(args.t).toEqual(expect.objectContaining({ k: expect.any(Number) }));
    });

    it('answers nothing for another drag, or with no pointer', () => {
        render();
        seatOverride = () => ({ stepId: 12, ok: true });
        expect(collide(500, 300, rowDrag('task'))).toEqual([]);
        let out;
        act(() => { out = dndProps.collisionDetection({ active: rowDrag(), pointerCoordinates: null }); });
        expect(out).toEqual([]);
    });

    it('looks through the drag preview riding the pointer, never through the box', () => {
        render();
        const overlay = document.createElement('div');
        const overlayBox = document.createElement('div');
        overlayBox.setAttribute('data-testid', 'drag-overlay');
        const clone = document.createElement('span');
        overlayBox.appendChild(clone);
        overlay.appendChild(overlayBox);
        document.body.appendChild(overlay);
        document.elementsFromPoint = () => [clone, overlayBox, overlay, canvas];
        collide(500, 300);
        expect(resolveSeatDropSpy.mock.calls.at(-1)[0].overChrome).toBe(false);

        const box = document.createElement('div');
        box.setAttribute('data-viz-unseated', '');
        const row = document.createElement('div');
        box.appendChild(row);
        document.body.appendChild(box);
        document.elementsFromPoint = () => [clone, overlayBox, overlay, row, box, canvas];
        expect(collide(500, 300)).toEqual([]);
        expect(resolveSeatDropSpy.mock.calls.at(-1)[0].overChrome).toBe(true);
    });

    it('outlines the step while moving, and a drop seats the requirement there', async () => {
        render();
        seatOverride = () => ({ stepId: 12, ok: true });
        const collisions = collide(500, 300);
        act(() => { dndProps.onDragMove({ active: rowDrag(), collisions }); });
        const outline = document.querySelector('[data-testid="pipeline-viz-seat-target"]');
        expect(outline?.getAttribute('data-step-id')).toBe('12');
        let land;
        moveStepRequirement.mockImplementation(() => new Promise((r) => { land = r; }));
        act(() => { dndProps.onDragEnd({ active: rowDrag(), collisions }); });
        expect(document.querySelector('[data-testid="pipeline-viz-seat-target"]')).toBeNull();
        expect(moveStepRequirement).toHaveBeenCalledTimes(1);
        expect(moveStepRequirement.mock.calls[0][2]).toEqual({ requirementId: 11, toStepId: 12 });
        // Hidden from the box at once, so it never shows snapping back.
        expect(boxProps.items.map((r) => r.id)).not.toContain(11);
        await act(async () => { land(); });
    });

    it('a locked step, or a cancel, writes nothing', async () => {
        render();
        seatOverride = () => ({ stepId: 11, ok: false });
        const refused = collide(500, 300);
        act(() => { dndProps.onDragMove({ active: rowDrag(), collisions: refused }); });
        expect(document.querySelector('[data-testid="pipeline-viz-seat-target"]')
            ?.getAttribute('data-ok')).toBe('0');
        await act(async () => { dndProps.onDragEnd({ active: rowDrag(), collisions: refused }); });
        act(() => { dndProps.onDragCancel(); });
        expect(moveStepRequirement).not.toHaveBeenCalled();
        expect(document.querySelector('[data-testid="pipeline-viz-seat-target"]')).toBeNull();
    });
});
