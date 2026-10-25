// @vitest-environment jsdom
//
// req #3804 — press and drag to scroll, like the map and 3D views.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';

import useGrabScroll, { GRAB_THRESHOLD_PX, scrollParentOf } from '../useGrabScroll';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// jsdom has no PointerEvent: a MouseEvent carrying the pointer fields is what
// the hook reads.
const pointer = (type, target, { x = 0, y = 0, pointerType = 'mouse', button = 0,
    buttons = type === 'pointermove' ? 1 : 0 } = {}) => {
    const e = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y,
        button, buttons });
    Object.defineProperty(e, 'pointerType', { value: pointerType });
    act(() => { target.dispatchEvent(e); });
    return e;
};

function Surface({ onClick }) {
    const { ref } = useGrabScroll();
    return (
        <div ref={ref} data-testid="surface" onClick={onClick}>
            <div data-testid="body">card</div>
            <input data-testid="field" />
            <span data-drag-handle="true" data-testid="grip">⋮</span>
        </div>
    );
}

let container;
let root;
let scroller;
beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    scroller = document.scrollingElement || document.documentElement;
    scroller.scrollTop = 0;
    scroller.scrollLeft = 0;
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 0);
});
afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
});

const q = (id) => container.querySelector(`[data-testid="${id}"]`);

describe('useGrabScroll', () => {
    it('scrolls the page by the distance dragged, and swallows the click that ends the pan', () => {
        const onClick = vi.fn();
        act(() => root.render(<Surface onClick={onClick} />));
        const writes = [];
        Object.defineProperty(scroller, 'scrollTop', {
            configurable: true, get: () => writes.at(-1) ?? 0, set: (v) => writes.push(v) });
        pointer('pointerdown', q('body'), { x: 100, y: 200 });
        pointer('pointermove', window, { x: 100, y: 160 });
        pointer('pointerup', window, { x: 100, y: 160 });
        expect(writes.at(-1)).toBe(40);
        pointer('click', q('body'));
        expect(onClick).not.toHaveBeenCalled();
        delete scroller.scrollTop;
    });

    it('leaves a click alone below the threshold', () => {
        const onClick = vi.fn();
        act(() => root.render(<Surface onClick={onClick} />));
        pointer('pointerdown', q('body'), { x: 10, y: 10 });
        pointer('pointermove', window, { x: 10, y: 10 + GRAB_THRESHOLD_PX - 1 });
        pointer('pointerup', window);
        pointer('click', q('body'));
        expect(onClick).toHaveBeenCalledTimes(1);
    });

    it('never grabs from a field, a drag grip, or a touch', () => {
        act(() => root.render(<Surface />));
        const writes = [];
        Object.defineProperty(scroller, 'scrollTop', {
            configurable: true, get: () => 0, set: (v) => writes.push(v) });
        for (const [el, opts] of [[q('field'), {}], [q('grip'), {}], [q('body'), { pointerType: 'touch' }]]) {
            pointer('pointerdown', el, { x: 0, y: 100, ...opts });
            pointer('pointermove', window, { x: 0, y: 20 });
            pointer('pointerup', window);
        }
        expect(writes).toEqual([]);
        delete scroller.scrollTop;
    });

    it('ends a pan whose pointerup it never heard, and restores the body', () => {
        act(() => root.render(<Surface />));
        const writes = [];
        Object.defineProperty(scroller, 'scrollTop', {
            configurable: true, get: () => 0, set: (v) => writes.push(v) });
        pointer('pointerdown', q('body'), { x: 0, y: 100 });
        pointer('pointermove', window, { x: 0, y: 60 });
        expect(document.body.style.cursor).toBe('grabbing');
        // Button released where a descendant swallowed the pointerup.
        pointer('pointermove', window, { x: 0, y: 20, buttons: 0 });
        pointer('pointermove', window, { x: 0, y: 0 });
        expect(writes).toHaveLength(1);
        expect(document.body.style.cursor).toBe('');
        expect(document.body.style.userSelect).toBe('');
        delete scroller.scrollTop;
    });

    it('stops a text selection while a press is held, and not otherwise', () => {
        act(() => root.render(<Surface />));
        const select = () => {
            const e = new Event('selectstart', { bubbles: true, cancelable: true });
            act(() => { q('body').dispatchEvent(e); });
            return e.defaultPrevented;
        };
        expect(select()).toBe(false);
        pointer('pointerdown', q('body'), { x: 0, y: 0 });
        expect(select()).toBe(true);
        pointer('pointerup', window);
        expect(select()).toBe(false);
    });

    it('leaves body styles it did not set alone on unmount', () => {
        act(() => root.render(<Surface />));
        document.body.style.cursor = 'grabbing';     // a drag in progress set this
        act(() => root.unmount());
        expect(document.body.style.cursor).toBe('grabbing');
        document.body.style.cursor = '';
        root = createRoot(container);
    });

    it('finds the page when nothing nearer scrolls', () => {
        const el = document.createElement('div');
        document.body.appendChild(el);
        expect(scrollParentOf(el)).toBe(document.scrollingElement || document.documentElement);
        el.remove();
    });
});
