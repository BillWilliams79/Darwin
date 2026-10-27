// @vitest-environment jsdom
//
// req #3804 — a ReorderList's optional `motion` sets how siblings slide
// (useSortable `transition`) and how the dropped item settles (DragOverlay
// `dropAnimation`); left out, every list keeps dnd-kit's slide and the house
// drop. dnd-kit's two hooks/components are spied so the wiring is observable.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';

const seen = vi.hoisted(() => ({ sortable: [], overlay: [], answer: null }));
vi.mock('@dnd-kit/sortable', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        useSortable: (args) => {
            seen.sortable.push(args);
            const real = actual.useSortable(args);
            return seen.answer ? { ...real, ...seen.answer } : real;
        },
    };
});
vi.mock('@dnd-kit/core', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        DragOverlay: (props) => { seen.overlay.push(props.dropAnimation); return null; },
    };
});

import ReorderList, { useReorderItem, NO_SLIDE } from '../ReorderList';

let lastItem = null;
function Row({ id }) {
    const item = useReorderItem(id, { id });
    lastItem = item;
    return <div ref={item.ref} style={item.style}>{id}</div>;
}

let container;
let root;
beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    seen.sortable.length = 0;
    seen.overlay.length = 0;
    seen.answer = null;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

const render = (motion, handle) => act(() => root.render(
    <ReorderList id="l" type="t" ids={['a', 'b']} onReorder={() => {}} motion={motion}
                 handle={handle}>
        <Row id="a" /><Row id="b" />
    </ReorderList>));

describe('ReorderList handle (req #3804)', () => {
    it('with a grip: the grip gets the press and keyboard, minus the sortable marker; the row is marked for the preview', () => {
        render(undefined, true);
        expect(lastItem.handleProps).toBeTruthy();
        expect(lastItem.handleProps.role).toBe('button');
        expect(lastItem.handleProps).not.toHaveProperty('aria-roledescription');
        expect(typeof lastItem.handleProps.onPointerDown).toBe('function');
        expect(typeof lastItem.handleProps.ref).toBe('function');
        expect(lastItem.rowProps).toEqual({ 'data-darwin-drag': 'true' });
    });

    it('without one: the row is its own grip, as before', () => {
        render(undefined, false);
        expect(lastItem.handleProps).toBeNull();
        expect(lastItem.rowProps).toBeNull();
        expect(lastItem.handleRef).toBeUndefined();
        expect(lastItem.attributes['aria-roledescription']).toBe('sortable');
    });
});

describe('ReorderList motion (req #3804)', () => {
    it('hands the motion to every sibling and to the drop', () => {
        const motion = { duration: 420, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' };
        render(motion);
        expect(seen.sortable.every((a) => a.transition === motion)).toBe(true);
        expect(seen.overlay.at(-1)).toMatchObject({ duration: 420, easing: motion.easing });
    });

    it('left out, passes no transition and keeps the house drop', () => {
        render(undefined);
        expect(seen.sortable.every((a) => !('transition' in a))).toBe(true);
        expect(seen.overlay.at(-1)).toMatchObject({ duration: 180, easing: 'cubic-bezier(0.2, 0, 0, 1)' });
    });
});

describe('ReorderList slide timing (req #3966)', () => {
    const motion = { duration: 360, perPx: 0.6, maxDuration: 1100, easing: 'ease-out' };

    it('times a slide by its distance', () => {
        seen.answer = { transform: { x: 100, y: 0, scaleX: 1, scaleY: 1 },
            transition: 'transform 360ms ease-out' };
        render(motion);
        expect(lastItem.style.transition).toBe('transform 420ms ease-out');
    });

    // The frame a dropped list's new order replaces its preview offsets: a
    // slide there sends the card across its new slot from its old offset.
    it('passes dnd-kit\'s 0ms frame through untouched', () => {
        seen.answer = { transform: { x: 400, y: 0, scaleX: 1, scaleY: 1 }, transition: NO_SLIDE };
        render(motion);
        expect(NO_SLIDE).toBe('transform 0ms linear');
        expect(lastItem.style.transition).toBe(NO_SLIDE);
    });
});
