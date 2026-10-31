// The collapse behaviour of an EDITABLE multiline field (req #3572), shared by
// CollapsibleGhostField and the pipeline card's goal (req #3945) so every
// editable collapse surface behaves the same. The caller renders the
// CollapseToggle and its own field; this owns when that field is expanded:
//
//   * FOCUS expands it for as long as it holds focus — nobody edits prose
//     through a few-line slot — and it re-collapses on blur.
//   * THE TOGGLE pins it open (or shut) independently of focus, for reading.
//
// A POINTER BLUR COLLAPSES ONLY AFTER ITS CLICK. The field blurs on MOUSEDOWN of
// whatever the user clicked next — an agent chip under it, a table header below
// it. Collapsing right then shrinks the field before MOUSEUP, the target slides
// up out from under the pointer, mousedown and mouseup land on different
// elements, and the browser dispatches the click to neither (measured in
// Chromium). So while the field is focused a capture-phase `pointerdown` is
// watched, and a blur it caused waits until just after that gesture's click. A
// keyboard blur (Tab, Escape, Enter) collapses at once.
//
// THE TOGGLE ONLY EXISTS WHEN IT WOULD DO SOMETHING (req #4144): `showToggle` is
// true only when the collapsed field really hides text (measured on the
// textarea, re-measured on resize and whenever `deps` change — pass the value).
// A short goal that already fits has nothing to show more of, so the caller
// renders no toggle. A field pinned open cannot be measured (an
// expanded box never overflows), so it keeps its toggle until it is collapsed.
//
// Returns `attachInput` (the field's inputRef, forwarding to `inputRef`),
// `setFocused(on)` (call from the field's focus/blur), `toggle` (the toggle's
// onToggle) and `collapsedSx` (merge into the field's sx: while collapsed the
// textarea's own scrollbar is suppressed — a scrollable slot inside a scrolling
// page is a wheel trap, and the toggle is the affordance).

import { useEffect, useRef, useState } from 'react';

import { useOverflow } from './useOverflow';

export const useCollapsibleField = ({ defaultExpanded = false, inputRef, deps = [] } = {}) => {
    const [pinned, setPinned] = useState(defaultExpanded);
    const [editing, setEditing] = useState(false);
    const expanded = pinned || editing;

    const inputEl = useRef(null);
    const overflowing = useOverflow(inputEl, !expanded, deps);
    const showToggle = overflowing || pinned;
    const attachInput = (el) => {
        inputEl.current = el;
        if (typeof inputRef === 'function') inputRef(el);
        else if (inputRef) inputRef.current = el;
    };

    // Is a pointer press in progress? Watched only while the field holds focus,
    // because that is the only time a press can blur it. Cleared on pointerup too,
    // so a press INSIDE the field (moving the caret) cannot leave it set and defer
    // a later keyboard blur.
    const pointerDown = useRef(false);
    useEffect(() => {
        if (!editing) return undefined;
        const down = () => { pointerDown.current = true; };
        const up = () => { pointerDown.current = false; };
        window.addEventListener('pointerdown', down, true);
        window.addEventListener('pointerup', up, true);
        window.addEventListener('pointercancel', up, true);
        return () => {
            window.removeEventListener('pointerdown', down, true);
            window.removeEventListener('pointerup', up, true);
            window.removeEventListener('pointercancel', up, true);
        };
    }, [editing]);

    const endEditing = () => {
        if (!pointerDown.current) { setEditing(false); return; }
        // The click is dispatched after pointerup in the same task, so a timeout
        // queued from pointerup runs once the click has landed on its target.
        const release = () => {
            window.removeEventListener('pointerup', release, true);
            window.removeEventListener('pointercancel', release, true);
            setTimeout(() => {
                // Refocused in the meantime — still editing, stay open.
                if (document.activeElement !== inputEl.current) setEditing(false);
            }, 0);
        };
        window.addEventListener('pointerup', release, true);
        window.addEventListener('pointercancel', release, true);
    };

    const setFocused = (on) => {
        if (on) setEditing(true); else endEditing();
    };

    // Collapsing shows the BEGINNING of the text, not wherever the caret left it.
    useEffect(() => {
        if (!expanded && inputEl.current) inputEl.current.scrollTop = 0;
    }, [expanded]);

    const toggle = () => {
        if (expanded) {
            setPinned(false);
            // Collapsing a field that holds focus means leaving it — the same
            // blur, and therefore the same commit, as clicking anywhere else.
            if (editing) inputEl.current?.blur();
        } else {
            setPinned(true);
        }
    };

    const collapsedSx = expanded ? {} : { '& textarea': { overflow: 'hidden !important' } };

    return { expanded, showToggle, toggle, attachInput, setFocused, collapsedSx };
};
