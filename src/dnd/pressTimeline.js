// pressTimeline.js — THE press timeline, one set of numbers for every surface
// (req #3662, design req #3645 "Hold to lift").
//
// One press means the same thing everywhere in Darwin:
//
//   touch   moved before LIFT_DELAY_MS ........ a SCROLL — never stolen
//           held still to LIFT_DELAY_MS ........ the item LIFTS (shadow, scale, haptic tick)
//           lifted, then moved ................. a DRAG
//           still held at LONG_PRESS_MS ........ long-press EDIT fires while held, on the
//                                                surfaces that have one (domain tabs)
//   mouse   moved MOUSE_ACTIVATION_PX .......... a DRAG at once
//           held still to LIFT_DELAY_MS ........ the item LIFTS, as with touch
//   keys    Space lifts, arrows move, Space drops, Esc cancels
//
// Every number lives here and nowhere else — `SwarmView/pipelines/planPressGesture.js`
// imports its long-press / slop / double-click values from this file, so the
// plan canvas and the drag surfaces cannot drift apart.

/**
 * Hold still this long and the item lifts — touch, and a long mouse click.
 * 375 ms: the user's ruling at the req #3662 review, 25% longer than the
 * first 300 ms, so a press meant as a click is not taken for a pickup.
 */
export const LIFT_DELAY_MS = 375;

/**
 * Touch: how far the finger may wander during the hold before the press is
 * read as a scroll and the lift is abandoned. Generous enough to absorb the
 * jitter of a resting fingertip, small enough that any deliberate swipe scrolls.
 */
export const TOUCH_TOLERANCE_PX = 6;

/** Mouse / pen: travel that turns a press into a drag. */
export const MOUSE_ACTIVATION_PX = 4;

/** Held still this long, a press is a long press (fires while still held). */
export const LONG_PRESS_MS = 500;

/** Movement that turns a press into a pan / drag rather than a click or long press. */
export const PRESS_SLOP_PX = 4;

/** Two releases on the same target within this window are a double click. */
export const DOUBLE_CLICK_MS = 260;

/** Dragging over a domain tab for this long switches to it. */
export const TAB_HOVER_SWITCH_MS = 500;

/**
 * While a press is building toward a lift, the item sinks a little (scale +
 * shade), so the hold is visibly "charging"; it starts after this pause so a
 * plain tap or a quick swipe does not flicker.
 */
export const PRESS_CUE_DELAY_MS = 70;

/** Haptic tick on a touch lift, where the platform supports `navigator.vibrate`. */
export const LIFT_VIBRATE_MS = 10;
