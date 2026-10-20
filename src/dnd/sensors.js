// sensors.js — the three ways a press becomes a drag (req #3662).
//
// Every number comes from `pressTimeline.js`. The sensors differ from dnd-kit's
// stock ones in exactly the ways the press timeline needs:
//
//   DarwinPointerSensor  mouse and pen only. A touch pointer is the touch
//                        sensor's, so a finger never arms two sensors at once.
//                        Lifts on a small move OR a held press (the long click).
//   DarwinTouchSensor    hold-to-lift with a movement tolerance (moving first is
//                        a scroll). Two deliberate departures from stock:
//                        - it does NOT cancel on window `resize`. On a phone the
//                          browser chrome collapses while the page auto-scrolls,
//                          which resizes the viewport mid-drag; stock behaviour
//                          drops the item the moment you scroll. Rects are
//                          re-measured continuously (DarwinDndContext), which is
//                          what the stock cancel was protecting.
//                        - a lifted touch that ends swallows its `touchend`, so a
//                          hold-and-release on a text field does not then focus it
//                          and throw up the keyboard.
//   KeyboardSensor       stock, configured: Space lifts, arrows move, Space or
//                        Enter drops, Esc cancels. It only arms when the
//                        draggable ITSELF is focused (useDarwinDrag registers the
//                        node as the activator), never from a keystroke typed in
//                        a field inside it.
//
// A press that only reached the draggable through a React PORTAL (a menu or a
// dialog the item renders) is not a press on the item: React bubbles synthetic
// events through the component tree, so without this a slightly-moved click in
// a card's menu would lift the card.
//
// A press inside a text field that ALREADY has focus is editing, not a lift:
// the caret moves and text selects as in any input. The first press on an
// unfocused field lifts like the rest of the row — the whole row is the grip.

import { PointerSensor, TouchSensor, KeyboardSensor } from '@dnd-kit/core';
import {
    LIFT_DELAY_MS, TOUCH_TOLERANCE_PX, MOUSE_ACTIVATION_PX,
} from './pressTimeline';

const EDITABLE = 'input, textarea, select, [contenteditable="true"], [contenteditable=""]';

/** True when the press landed in the draggable's own DOM, not in a portal it renders. */
export function isOwnPress(syntheticEvent) {
    const { currentTarget, target } = syntheticEvent;
    return !currentTarget || typeof currentTarget.contains !== 'function'
        || currentTarget.contains(target);
}

/** True when the press began inside a text field the user is already editing. */
export function isEditingField(target) {
    if (!target || typeof target.closest !== 'function') return false;
    const field = target.closest(EDITABLE);
    if (!field) return false;
    const doc = field.ownerDocument;
    return !!doc && doc.activeElement === field;
}

// ── The focus a lift takes away ─────────────────────────────────────────────
// A mouse press on an unfocused text field focuses it (that is how a quick
// click places the caret) before anyone knows the press will become a drag.
// When it does, the lift blurs that field — and its owner must not treat the
// blur as "editing finished, save": nothing was typed, the focus came from
// this very press (a field that was ALREADY focused never lifts, above).
// Owners check `isLiftBlur(event)` in their onBlur.

const liftBlurred = new WeakSet();

/**
 * At lift, settle the focus inside the lifted item. The field this press
 * focused is blurred marked (its onBlur skips saving). A DIFFERENT field in
 * the item that already had focus holds a real edit — it is blurred plainly,
 * so its onBlur saves before the item moves (a row carried into another card
 * remounts there, and an unmount never fires onBlur).
 */
export function releaseLiftFocus(pressTarget, liftedItem = null) {
    const doc = pressTarget?.ownerDocument;
    const field = doc?.activeElement;
    if (!field || typeof field.matches !== 'function' || !field.matches(EDITABLE)) return;
    if (field === pressTarget || field.contains(pressTarget)) {
        liftBlurred.add(field);
        try { field.blur(); } finally { liftBlurred.delete(field); }
    } else if (liftedItem?.contains(field)) {
        field.blur();
    }
}

/**
 * Where a mouse long-click lifted an item from inside one of its text fields:
 * the item, the field and the caret the click placed. After the drop the
 * cursor goes back there (user ruling, req #3662 review: a long click on text
 * that turned into a drag still meant "I'm working on this text"). Touch is
 * excluded on purpose — focusing a field after a touch drag throws up the
 * phone keyboard.
 */
export function captureLiftFocus(activatorEvent, liftedItem) {
    if (!liftedItem || typeof TouchEvent !== 'undefined' && activatorEvent instanceof TouchEvent) return null;
    if (activatorEvent?.type && !activatorEvent.type.startsWith('pointer')) return null;
    const field = activatorEvent?.target?.closest?.(EDITABLE);
    const item = liftedItem.getAttribute('data-testid');
    const name = field?.getAttribute('name');
    if (!field || !item || !name || !liftedItem.contains(field)) return null;
    const caret = pressCaret.has(field) ? pressCaret.get(field)
        : typeof field.selectionStart === 'number' ? field.selectionStart : null;
    return { item, name, caret };
}

/** Put the cursor back in the field `captureLiftFocus` recorded, wherever its item now is. */
export function restoreLiftFocus(spot, doc = document) {
    if (!spot) return;
    const field = doc.querySelector(`[data-testid="${spot.item}"] [name="${spot.name}"]`);
    if (!field) return;
    field.focus();
    if (spot.caret != null && typeof field.setSelectionRange === 'function') {
        const at = Math.min(spot.caret, field.value.length);
        field.setSelectionRange(at, at);
    }
}

/** True for the blur `releaseLiftFocus` caused — not an edit ending. */
export function isLiftBlur(event) {
    return !!event?.target && liftBlurred.has(event.target);
}

// dnd-kit clears the page's text selection at the instant of the lift, which
// also collapses a focused field's caret to 0 — so the caret the click placed
// is read here, just before that happens.
const pressCaret = new WeakMap();

export class DarwinPointerSensor extends PointerSensor {
    static activators = [{
        eventName: 'onPointerDown',
        handler: (synthetic, { onActivation }) => {
            const event = synthetic.nativeEvent;
            if (event.pointerType === 'touch') return false;
            if (!isOwnPress(synthetic)) return false;
            if (!event.isPrimary || event.button !== 0) return false;
            if (isEditingField(event.target)) return false;
            onActivation?.({ event });
            return true;
        },
    }];

    // With BOTH a distance and a delay, dnd-kit arms the delay's timer at the
    // press and does not clear it when the distance starts the drag first — so
    // the timer fired a SECOND start mid-drag, which re-began the drag from
    // wherever the item had been carried (caught by DND-06). One start only.
    handleStart() {
        if (this.activated) return;
        if (this.timeoutId !== null) {
            clearTimeout(this.timeoutId);
            this.timeoutId = null;
        }
        const field = this.props.event?.target?.closest?.(EDITABLE);
        if (field && typeof field.selectionStart === 'number') pressCaret.set(field, field.selectionStart);
        super.handleStart();
    }
}

export class DarwinTouchSensor extends TouchSensor {
    static activators = [{
        eventName: 'onTouchStart',
        handler: (synthetic, { onActivation }) => {
            const event = synthetic.nativeEvent;
            if (event.touches.length > 1) return false;
            if (!isOwnPress(synthetic)) return false;
            if (isEditingField(event.target)) return false;
            onActivation?.({ event });
            return true;
        },
    }];

    attach() {
        super.attach();
        const win = this.windowListeners;
        win.listeners = win.listeners.filter(([name, handler, options]) => {
            if (name !== 'resize') return true;
            win.target?.removeEventListener(name, handler, options);
            return false;
        });
    }

    handleEnd(event) {
        if (this.activated && event?.cancelable) event.preventDefault();
        super.handleEnd(event);
    }
}

export const KEYBOARD_CODES = {
    start: ['Space'],
    cancel: ['Escape'],
    end: ['Space', 'Enter'],
};

// Mouse: lifts on a 4 px move OR on a hold of LIFT_DELAY_MS, whichever comes
// first — so a long click visibly picks the item up, exactly like a finger.
// (dnd-kit runs both constraints when both are given; `tolerance: Infinity`
// keeps a long move from being read as a cancelled press.)
export const POINTER_SENSOR_OPTIONS = {
    activationConstraint: { distance: MOUSE_ACTIVATION_PX, delay: LIFT_DELAY_MS, tolerance: Infinity },
};

export const TOUCH_SENSOR_OPTIONS = {
    activationConstraint: { delay: LIFT_DELAY_MS, tolerance: TOUCH_TOLERANCE_PX },
};

export { KeyboardSensor };
