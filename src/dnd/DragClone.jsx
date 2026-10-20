// DragClone.jsx — the default drag preview: a faithful copy of the very node
// being dragged (req #3662, absorbs req #3524).
//
// The react-dnd previews were hand-built look-alikes — a task row rebuilt from
// its fields at 67% scale with a tilt, and nothing at all for a priority-card
// row or an area card. A look-alike drifts from the real thing every time the
// real thing changes. Copying the live DOM node cannot: it is the row, the
// card, the tab, exactly as it was on screen when it lifted, at its own width
// (DragOverlay sizes its wrapper to the source rect).
//
// What a plain cloneNode gets wrong, and is fixed here:
//   - form state lives in properties, not attributes: a textarea's typed value,
//     a checkbox's checked state — copied across explicitly;
//   - ids and test ids would duplicate the source's — stripped, so neither a
//     label lookup nor an E2E locator can resolve to the preview by accident;
//   - the copy is decorative — aria-hidden and inert;
//   - the press itself left marks on the source — a MUI ripple, a focus ring —
//     that belong to the press, not the item: removed.

import React, { useLayoutEffect, useRef } from 'react';

const FORM_FIELDS = 'input, textarea, select';

/**
 * The node a drag lifted, found from the event that lifted it: the innermost
 * draggable around the press (useDarwinDrag makes every item its own keyboard
 * activator, so a keyboard lift's target IS the node).
 */
export function liftedNode(activatorEvent) {
    const target = activatorEvent?.target;
    return target && typeof target.closest === 'function'
        ? target.closest('[aria-roledescription]')
        : null;
}

/**
 * Copy `node` for the preview. Must run BEFORE React commits the lift: the
 * source then re-renders as its placeholder (dimmed, tinted), and those styles
 * live in classes a later copy would carry along.
 */
export function cloneForPreview(node) {
    if (!node) return null;
    const copy = node.cloneNode(true);
    const sourceFields = node.querySelectorAll(FORM_FIELDS);
    const copyFields = copy.querySelectorAll(FORM_FIELDS);
    sourceFields.forEach((field, i) => {
        const twin = copyFields[i];
        if (!twin) return;
        if (field.type === 'checkbox' || field.type === 'radio') twin.checked = field.checked;
        else twin.value = field.value;
    });
    [copy, ...copy.querySelectorAll('[id], [data-testid], [tabindex]')].forEach(el => {
        el.removeAttribute('id');
        el.removeAttribute('data-testid');
        el.removeAttribute('tabindex');
    });
    copy.querySelectorAll('.MuiTouchRipple-root').forEach(el => el.replaceChildren());
    [copy, ...copy.querySelectorAll('.Mui-focusVisible, .Mui-focused')]
        .forEach(el => el.classList.remove('Mui-focusVisible', 'Mui-focused'));
    // Sortable styles applied to the source (transform, a placeholder tint)
    // describe the SLOT, not the item — the preview starts from neutral.
    copy.style.transform = '';
    copy.style.transition = '';
    copy.style.opacity = '';
    copy.style.margin = '0';
    copy.style.width = '100%';
    copy.style.height = '100%';
    copy.style.boxSizing = 'border-box';
    return copy;
}

/** Mounts a copy taken at lift (`cloneForPreview`) into the overlay. */
export default function DragClone({ copy }) {
    const hostRef = useRef(null);

    useLayoutEffect(() => {
        const host = hostRef.current;
        if (!host || !copy) return undefined;
        host.replaceChildren(copy);
        return () => host.replaceChildren();
    }, [copy]);

    return (
        <div ref={hostRef} aria-hidden="true" inert=""
             data-testid="drag-overlay-clone"
             style={{ width: '100%', height: '100%', pointerEvents: 'none' }} />
    );
}
