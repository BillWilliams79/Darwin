// @vitest-environment jsdom
//
// Req #3067 — the DataGrid cell wrapper's event contract.
//
// THIS IS THE HIGHEST-VALUE TEST OF THE NEW COMPONENTS, and it looks trivial,
// which is the problem it guards against. The wrapper's whole job is two
// `stopPropagation` calls, and the keydown one is easy to "clean up" as redundant
// because nothing in the component's own render depends on it.
//
// It is not redundant. Verified against the installed @mui/x-data-grid@8.27.3:
// `GridCell` publishes `cellKeyDown` from its own `onKeyDown` with no
// input-target guard, and `keyboardUtils.isNavigationKey` classifies the SPACE
// CHARACTER as a navigation key — so `useGridKeyboardNavigation` answers a space
// with `goToCell()` + `preventDefault()`. Without the stop, a space cannot be typed
// into an edit-in-place cell AT ALL, and an arrow key blurs the field mid-edit
// (which commits it). The existing Maps editors stop click but not keydown and are
// believed to carry exactly this defect; it is filed as a follow-up.
//
// The test asserts the events do not REACH a listener on an ancestor, which is what
// the grid is.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';

import GhostCell from '../GhostCell';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container;
let root;

beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
});

afterEach(() => {
    act(() => root.unmount());
    container.remove();
});

/** Stands in for the DataGrid cell that would otherwise receive the event. */
const renderInGrid = (handlers) => {
    act(() => {
        root.render(
            <div {...handlers}>
                <GhostCell>
                    <input data-testid="inner" />
                </GhostCell>
            </div>);
    });
    return container.querySelector('[data-testid="inner"]');
};

describe('GhostCell — what it keeps away from the grid', () => {
    it('stops a click from reaching the row', () => {
        // Row click navigation, row selection and column sort all live above the
        // cell. A click inside an editable cell means "edit this" and nothing else.
        const onClick = vi.fn();
        const input = renderInGrid({ onClick });
        act(() => input.dispatchEvent(new MouseEvent('click', { bubbles: true })));
        expect(onClick).not.toHaveBeenCalled();
    });

    it('stops SPACE from reaching the grid — otherwise it cannot be typed', () => {
        const onKeyDown = vi.fn();
        const input = renderInGrid({ onKeyDown });
        act(() => input.dispatchEvent(
            new KeyboardEvent('keydown', { key: ' ', bubbles: true })));
        expect(onKeyDown).not.toHaveBeenCalled();
    });

    it('stops the arrow keys — otherwise they blur the field and commit it', () => {
        const onKeyDown = vi.fn();
        const input = renderInGrid({ onKeyDown });
        for (const key of ['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight']) {
            act(() => input.dispatchEvent(
                new KeyboardEvent('keydown', { key, bubbles: true })));
        }
        expect(onKeyDown).not.toHaveBeenCalled();
    });

    it('stops Home/End/PageUp/PageDown and Tab', () => {
        const onKeyDown = vi.fn();
        const input = renderInGrid({ onKeyDown });
        for (const key of ['Home', 'End', 'PageUp', 'PageDown', 'Tab']) {
            act(() => input.dispatchEvent(
                new KeyboardEvent('keydown', { key, bubbles: true })));
        }
        expect(onKeyDown).not.toHaveBeenCalled();
    });

    it('does NOT stop mousedown or mouseup', () => {
        // Deliberate, and load-bearing: `useGridFocus` registers its document
        // handler on mouseup and `cellMouseDown` records the last-clicked cell —
        // and the grid keeps the FOCUSED cell rendered even when it falls outside
        // the render context. Stopping these would forfeit that for nothing.
        const onMouseDown = vi.fn();
        const onMouseUp = vi.fn();
        const input = renderInGrid({ onMouseDown, onMouseUp });
        act(() => {
            input.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
            input.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
        });
        expect(onMouseDown).toHaveBeenCalledTimes(1);
        expect(onMouseUp).toHaveBeenCalledTimes(1);
    });

    it('lets the inner field see the keystroke it stopped from bubbling', () => {
        // The stop happens on the way UP. A handler on the input itself — which is
        // where GhostTextField's Enter/Escape handling lives — must still fire.
        const onKeyDown = vi.fn();
        act(() => {
            root.render(
                <GhostCell>
                    <input data-testid="inner" onKeyDown={onKeyDown} />
                </GhostCell>);
        });
        const input = container.querySelector('[data-testid="inner"]');
        act(() => input.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
        expect(onKeyDown).toHaveBeenCalledTimes(1);
    });
});
