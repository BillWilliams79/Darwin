// pipelineUnseated.js — the pure half of the Plan visualizer's "swarm-ready,
// not orchestrated" box (req #3583).
//
// The box lists every requirement that is READY TO RUN but sits on no step of
// any plan, so the reader can drag it onto a step card and seat it there. It is
// the source end of the visualizer's drag-and-drop (req #3581 moves a
// requirement BETWEEN steps; this puts one ON a step for the first time).
//
// What lives here is every DECISION that gesture makes — which rows the box
// lists, which step a point lands on, whether that step may take new work, and
// where a step's card sits on screen — so a test can reach them. The DOM side
// (the dnd-kit drag, the highlight overlay, the write) is in
// `PipelinePlanVisualizer.jsx` and `UnorchestratedReqBox.jsx`.
//
// ── "NOT ORCHESTRATED" IS THE JUNCTION, NOTHING ELSE ───────────────────────
// A requirement is orchestrated exactly when a `pipeline_step_requirements`
// row names it — the SAME read `useRequirementVisibility` hides by and the
// requirement page's Orchestration box reads. The junction keys on
// `requirement_fk` alone (one step per requirement, req #3336), so a requirement
// absent from it is seated NOWHERE and seating it is a plain INSERT — no
// unseat, no move.

import { CARD_FONT, CARD_FRAME_W, stepsAcrossScale } from './pipelinePlanLayout';

// ── NEVER BIGGER THAN AT SIX STEPS ACROSS (req #3648, user directive) ──────
// "Orchestrables shouldn't get any bigger than it is at size six window widths.
// any bigger is no good." The box follows the zoom as the sections below say,
// but the zoom it follows is capped at the scale the "6" steps-across button
// lands on, so zooming further in leaves the box where it was.
export const UNSEATED_MAX_STEPS_ACROSS = 6;

/**
 * The zoom the box is sized at: the live `k`, but never past six steps across.
 *
 * @param {number} k          the live zoom scale
 * @param {number} viewportW  the panel's width, screen px
 * @param {number} colPitch   the plan's column pitch, world px (`layout.colPitch`)
 */
export function unseatedBoxZoom(k, viewportW, colPitch) {
    const cap = stepsAcrossScale(UNSEATED_MAX_STEPS_ACROSS, viewportW, colPitch);
    return cap && Number.isFinite(k) && k > cap ? cap : k;
}

/** The box's type size bounds, screen px (user ruling: "match, within 9–16px"). */
export const UNSEATED_FONT_MIN = 9;
export const UNSEATED_FONT_MAX = 16;

/**
 * The box's type size at zoom `k`: the requirement ids' own on-screen size —
 * the card font `CARD_FONT.req` (world px) through the zoom — clamped so the
 * box stays legible zoomed far out and never swallows the canvas zoomed in.
 * Between the bounds it tracks the ids exactly.
 *
 * @param {number} k  the live zoom scale
 */
export function unseatedBoxFontPx(k) {
    const px = CARD_FONT.req * (Number.isFinite(k) && k > 0 ? k : 1);
    return Math.min(UNSEATED_FONT_MAX, Math.max(UNSEATED_FONT_MIN, px));
}

/** The box's narrowest width, in em of its own type: room for the whole title
 *  bar — the ▾, the count badge and "Orchestrables" — and an id plus a slice
 *  of title. Under the base card's own ~21.4em (req #3693's narrower requirement
 *  type), so at Step Width 4 and up it binds only once the type is held at its
 *  9px floor; a Step Width 3 card (0.75x, ~16.4em, req #3648) is narrower than the title bar itself, so there
 *  the box is held at this width rather than mirroring the card. */
export const UNSEATED_MIN_WIDTH_EM = 18;

/**
 * The box's width at zoom `k`, screen px (req #3620, user directive: "whatever
 * the step width, the box will mirror its width. it's too narrow"): the step
 * card's drawn frame — `frameW`, world px, which follows the Step Width rung —
 * through the zoom. The same width the seat-target outline draws around a card
 * (`screenRectOf`), so the box and the card it feeds read as one size.
 *
 * FLOORED SO ITS TITLE BAR FITS. Zoomed out, a card is a few dozen px wide —
 * plan 7 opens at k≈0.04–0.08, a 21–31px card — and a box that narrow clips its
 * own ▾ and title away. So it never goes below
 * `UNSEATED_MIN_WIDTH_EM` of its own type, which is narrower than every rung's
 * card at any zoom where the type tracks the ids: the box is exactly the card
 * everywhere except zoomed out past the type's 9px floor (162px there). The
 * pane caps it on the far side (`maxWidth` in the component).
 *
 * @param {number} frameW  the card frame width, world px (`layout.cardFrameW`)
 * @param {number} k       the live zoom scale
 */
export function unseatedBoxWidthPx(frameW, k) {
    const w = Number.isFinite(frameW) && frameW > 0 ? frameW : CARD_FRAME_W;
    const card = w * (Number.isFinite(k) && k > 0 ? k : 1);
    return Math.max(card, UNSEATED_MIN_WIDTH_EM * unseatedBoxFontPx(k));
}

// ── STRETCHED BY THE READER, IN THREE TEXT SIZES (req #3654) ─────────────
// On top of the zoom sizing above, the reader may drag the box's corner to
// make it wider or narrower and taller or shorter. Its type then steps ONE
// size bigger or ONE size smaller as the box crosses a threshold, and never
// further (user directive: "no more or no less, just those three sizes").
//
// The stretch is stored RELATIVE to the zoom size — width as a multiple of the
// zoom width, list height in em of the zoom type — so a stretched box keeps
// scaling with the zoom exactly as an unstretched one does.

/** One text size step: the ratio between neighbouring sizes. */
export const UNSEATED_TEXT_RATIO = 1.25;
/** Width scale at or below which the type is one size smaller, and at or
 *  above which it is one size bigger: the box has shrunk or grown by a full
 *  text step before its text follows. */
export const UNSEATED_SMALLER_AT = 1 / UNSEATED_TEXT_RATIO;
export const UNSEATED_BIGGER_AT = UNSEATED_TEXT_RATIO;
/** The list's shortest stretched height, em of the zoom type: room for one
 *  title wrapped to its two lines (req #3684), or about three short rows. */
export const UNSEATED_MIN_LIST_EM = 4.5;

/**
 * The text step for a width scale (stretched width ÷ zoom width): −1, 0 or +1.
 * Anything not a positive number is the unstretched box.
 *
 * @param {number} scale
 */
export function unseatedTextStep(scale) {
    if (!Number.isFinite(scale) || scale <= 0) return 0;
    if (scale <= UNSEATED_SMALLER_AT + 1e-9) return -1;
    if (scale >= UNSEATED_BIGGER_AT - 1e-9) return 1;
    return 0;
}

/**
 * The narrowest the reader may stretch the box, screen px: room for its whole
 * title bar in the SMALLER type — the size it is drawn in once that narrow. A
 * box stretched narrower than its zoom size but not yet a full step is held at
 * its title bar's width in the zoom type, so it never clips the title.
 *
 * @param {number} fontPx  the zoom type size (`unseatedBoxFontPx`)
 */
export function unseatedMinStretchPx(fontPx) {
    return UNSEATED_MIN_WIDTH_EM * (fontPx / UNSEATED_TEXT_RATIO);
}

/** A stretch is a ratio, so its px come back as 440.00000000000006 — drawn,
 *  and remembered, to the hundredth. */
const hundredths = (v) => Math.round(v * 100) / 100;

/**
 * The box as drawn, given its zoom size and the reader's stretch.
 *
 * `size` is `null` (never stretched) or `{ws, hEm}`: `ws` the width as a
 * multiple of `widthPx`, `hEm` the list height in em of `fontPx` (or `null`
 * when only the width was stretched — the list then keeps its natural height).
 *
 * @param {number} widthPx  the zoom width (`unseatedBoxWidthPx`)
 * @param {number} fontPx   the zoom type size (`unseatedBoxFontPx`)
 * @param {?{ws: number, hEm: ?number}} size
 * @returns {{widthPx: number, fontPx: number, step: number, listHeightPx: ?number}}
 */
export function unseatedResizedBox(widthPx, fontPx, size) {
    const ws = Number.isFinite(size?.ws) && size.ws > 0 ? size.ws : 1;
    const step = unseatedTextStep(ws);
    const hEm = Number.isFinite(size?.hEm) && size.hEm > 0
        ? Math.max(UNSEATED_MIN_LIST_EM, size.hEm) : null;
    const drawnFont = step > 0 ? fontPx * UNSEATED_TEXT_RATIO
        : (step < 0 ? fontPx / UNSEATED_TEXT_RATIO : fontPx);
    return {
        // Never narrower than the title bar in the type it is drawn in.
        widthPx: hundredths(Math.max(widthPx * ws, UNSEATED_MIN_WIDTH_EM * drawnFont)),
        fontPx: drawnFont,
        step,
        listHeightPx: hEm == null ? null : hundredths(hEm * fontPx),
    };
}

/** The dnd-kit draggable type a box row carries (req #3665), so the canvas's
 *  collision detection answers for a box row and nothing else. */
export const UNSEATED_DRAG_TYPE = 'unseated-req';

/** A box row's dnd-kit id — unique on the page, whatever else drags there. */
export function unseatedDragId(reqId) {
    return `unseated:${reqId}`;
}

/**
 * Swarm-ready requirements with no step seat, ascending by id.
 *
 * Filters on `requirement_status` itself rather than trusting the read's query
 * string, so a cache entry shared with a wider projection can never leak a
 * non-swarm-ready row into the box.
 *
 * @param {Object[]} requirements   requirement rows (`id`, `requirement_status`, …)
 * @param {Object[]} stepRequirements  `pipeline_step_requirements` rows
 * @returns {Object[]}
 */
export function unorchestratedSwarmReady(requirements, stepRequirements) {
    if (!Array.isArray(requirements) || !requirements.length) return [];
    const seated = new Set((Array.isArray(stepRequirements) ? stepRequirements : [])
        .map((r) => Number(r.requirement_fk)));
    return requirements
        .filter((r) => r && r.requirement_status === 'swarm_ready'
            && !seated.has(Number(r.id)))
        .sort((a, b) => Number(a.id) - Number(b.id));
}

/**
 * May this step take a NEW requirement? Always, unless it is effectively LOCKED
 * (req #3649 — the step, its initiative or its plan): the gateway refuses the link
 * with a 423. A step has no state (req #3750), so the work it already holds
 * being finished never closes it to more.
 *
 * @param {?Object} row  the step's plan row
 */
export function stepAcceptsNewWork(row) {
    return !!row && !row.effectiveLocked;
}

/**
 * The step whose CARD FRAME contains a world point, and whether it may take the
 * requirement. The frame is the layout's own box — the one the card is painted
 * into — and it exists at every semantic level, so a drop resolves the same
 * way whether the card is drawn or only its bead is.
 *
 * @param {Map<number, Object>} nodes   `computePlanLayout(...).nodes`
 * @param {Map<number, Object>} rowById plan rows by step id
 * @param {{x: number, y: number}} p    world coordinates
 * @returns {?{stepId: number, ok: boolean}}
 */
export function seatTargetAt(nodes, rowById, p) {
    if (!nodes || !p) return null;
    for (const [stepId, n] of nodes) {
        if (p.x >= n.frameLeft && p.x <= n.frameLeft + n.frameW
            && p.y >= n.top && p.y <= n.top + n.h) {
            return { stepId, ok: stepAcceptsNewWork(rowById?.get(stepId)) };
        }
    }
    return null;
}

/**
 * Where a drop at a panel-relative screen point lands — the whole decision,
 * so it is testable without a DOM. A point over CHROME (the box, the key, an
 * initiative chip) or over the sticky time ruler lands nowhere: those overlays hide
 * the card beneath them, and seating a step the reader cannot see is wrong.
 *
 * @param {Object} args
 * @param {{x: number, y: number}} args.point  panel-relative screen point
 * @param {boolean} [args.overChrome]  the event target sits inside chrome
 * @param {number} [args.rulerBottom]  screen y of the sticky ruler's bottom edge
 * @param {{x: number, y: number, k: number}} args.t  the live transform
 * @param {Map} args.nodes
 * @param {Map} args.rowById
 * @returns {?{stepId: number, ok: boolean}}
 */
export function resolveSeatDrop({ point, overChrome = false, rulerBottom = 0, t, nodes, rowById }) {
    if (overChrome || !point || point.y < rulerBottom) return null;
    return seatTargetAt(nodes, rowById, screenToWorld(point, t));
}

/** A panel-relative screen point to world coordinates through the transform. */
export function screenToWorld(pt, t) {
    if (!pt || !t || !(t.k > 0)) return null;
    return { x: (pt.x - t.x) / t.k, y: (pt.y - t.y) / t.k };
}

/** A layout node's card frame in panel-relative screen pixels. */
export function screenRectOf(n, t) {
    if (!n || !t) return null;
    return {
        left: n.frameLeft * t.k + t.x,
        top: n.top * t.k + t.y,
        width: n.frameW * t.k,
        height: n.h * t.k,
    };
}

/**
 * The confirm dialog's request when the WHOLE box is dropped on a step (req
 * #3608): every requirement the box lists at the moment of the drop, bound for
 * that step. Null when there is nothing to ask — no step under the pointer, or
 * an empty box. A locked step still yields a request with `ok: false`, so the
 * caller can say why nothing will be written rather than letting the gesture
 * pass silently as a relocation.
 *
 * The ids are a SNAPSHOT: the box can refetch while the dialog is open, and the
 * reader approves the list they were shown, not whatever the box holds later.
 *
 * @param {Object[]} items   the box's rows (`id`, `title`)
 * @param {?{stepId: number, ok: boolean}} target  `resolveSeatDrop`'s answer
 * @param {Map<number, Object>} rowById  plan rows by step id
 * @returns {?{stepId: number, stepTitle: string, ok: boolean,
 *            reqs: Array<{id: number, title: string}>}}
 */
export function bulkSeatRequest(items, target, rowById) {
    if (!target || !Array.isArray(items) || !items.length) return null;
    const reqs = items
        .map((r) => ({ id: Number(r.id), title: r.title || '' }))
        .filter((r) => Number.isFinite(r.id) && r.id > 0);
    if (!reqs.length) return null;
    return {
        stepId: target.stepId,
        stepTitle: rowById?.get(target.stepId)?.title || `step ${target.stepId}`,
        ok: !!target.ok,
        reqs,
    };
}

/** Is a client point inside a DOM rect (edges inclusive)? Null rect → false. */
export function pointInRect(x, y, rect) {
    return !!rect && Number.isFinite(x) && Number.isFinite(y)
        && x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

/**
 * May the pointer, released at a client point, mean a SEAT (req #3614)? Only
 * when it is inside the plan panel and something other than the box lies
 * beneath it. Pointer capture keeps delivering events past the window edge,
 * where `elementsFromPoint` answers `[]` — "nothing beneath" is not "the open
 * canvas", it is "not on the canvas at all", so it is chrome, never a card.
 *
 * @param {number} x  client x
 * @param {number} y  client y
 * @param {?{left: number, right: number, top: number, bottom: number}} panelRect
 * @param {?Element} beneath  first element under the point that is not the box
 */
export function pointerCanSeat(x, y, panelRect, beneath) {
    return pointInRect(x, y, panelRect) && !!beneath;
}

/**
 * Seat every id with `seat(id)`, at most `concurrency` writes in flight; one
 * failing never stops the rest. Resolves to the failures, `{id, error}` each,
 * in completion order.
 *
 * @param {number[]} ids
 * @param {(id: number) => Promise<*>} seat
 * @param {number} concurrency
 */
export async function runBulkSeat(ids, seat, concurrency) {
    const failed = [];
    const queue = ids.slice();
    const worker = async () => {
        while (queue.length) {
            const id = queue.shift();
            try {
                await seat(id);
            } catch (error) {
                failed.push({ id, error });
            }
        }
    };
    await Promise.all(Array.from(
        { length: Math.min(Math.max(1, Math.floor(concurrency) || 1), ids.length) }, worker));
    return failed;
}

/**
 * The snackbar line for a bulk seat that did not fully land (req #3614): each
 * failed id with its OWN HTTP status — `11 (409), 12 (500)` — never one
 * status stamped on a list. Null when nothing failed.
 *
 * @param {number} total  how many were attempted
 * @param {Array<{id: number, error: *}>} failed
 */
export function bulkSeatFailureMessage(total, failed) {
    if (!failed?.length) return null;
    const which = failed
        .slice().sort((a, b) => a.id - b.id)
        .map((f) => {
            const status = f.error?.httpStatus?.httpStatus;
            return status ? `${f.id} (${status})` : String(f.id);
        })
        .join(', ');
    return failed.length === total
        ? `Unable to add ${which} to the step`
        : `Added ${total - failed.length} of ${total}; unable to add ${which}`;
}
