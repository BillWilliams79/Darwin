// A multiline GhostTextField that sits COLLAPSED in a list (req #3572).
//
// The edit-in-place field renders its whole value, which for a 25,000-character
// instruction makes one card taller than the screen and buries the chips and
// counts the card exists to show. This wrapper caps the field at `collapsedRows`
// until the user asks for more, by either of two gestures:
//
//   * CLICKING INTO THE FIELD expands it for as long as it holds focus — nobody
//     edits prose through a four-line slot — and it re-collapses on blur.
//   * THE TOGGLE pins it open (or shut) independently of focus, for reading.
//
// A WRAPPER, NOT A GhostTextField PROP. Nothing here touches the commit contract:
// it only drives `maxRows` and listens to `onEditingChange`, so every guarantee
// GhostTextField documents (revert on reject, no clobber mid-edit, Escape) holds
// unchanged. Clicking into a field just to read it and back out writes nothing,
// because an untouched blur is a no-op there.
//
// While collapsed the textarea's own scrollbar is suppressed: a scrollable slot
// inside a scrolling page is a wheel trap, and the toggle is the affordance.
//
// A POINTER BLUR COLLAPSES ONLY AFTER ITS CLICK. The field blurs on MOUSEDOWN of
// whatever the user clicked next — an agent chip under it, a table header below
// it. Collapsing right then shrinks the field before MOUSEUP, the target slides
// up out from under the pointer, mousedown and mouseup land on different
// elements, and the browser dispatches the click to neither (measured in
// Chromium). So while the field is focused a capture-phase `pointerdown` is
// watched, and a blur it caused waits until just after that gesture's click. A
// keyboard blur (Tab, Escape, Enter) collapses at once.

import { useEffect, useRef, useState } from 'react';

import Box from '@mui/material/Box';

import CollapseToggle from '../Collapsible/CollapseToggle';
import GhostTextField from './GhostTextField';

const CollapsibleGhostField = ({
    collapsedRows = 4,
    defaultExpanded = false,
    onEditingChange,
    inputRef,
    maxRows,
    sx = {},
    ...fieldProps
}) => {
    const [pinned, setPinned] = useState(defaultExpanded);
    const [editing, setEditing] = useState(false);
    const expanded = pinned || editing;

    const inputEl = useRef(null);
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

    const testId = fieldProps.testId;

    return (
        <Box>
            {/* Always present, above the field (see CollapseToggle). */}
            <CollapseToggle
                expanded={expanded}
                onToggle={toggle}
                testId={testId ? `${testId}-toggle` : undefined}
            />
            <GhostTextField
                {...fieldProps}
                maxRows={expanded ? maxRows : collapsedRows}
                inputRef={attachInput}
                onEditingChange={(on) => {
                    if (on) setEditing(true); else endEditing();
                    onEditingChange?.(on);
                }}
                sx={{
                    ...sx,
                    ...(!expanded && { '& textarea': { overflow: 'hidden !important' } }),
                }}
            />
        </Box>
    );
};

export default CollapsibleGhostField;
