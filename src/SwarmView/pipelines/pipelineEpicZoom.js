// pipelineEpicZoom.js — the epic name's two-state zoom (req #3297, re-pointed
// at the STEP by req #3371).
//
// The epic name on the plan visualizer is a PROGRESSIVE-DISCLOSURE control, not
// a one-shot fit. It answers two questions, in the order a reader asks them:
//
//   level 1 (req #3204)  "where is this epic?"        → the whole band
//   level 2 (req #3297)  "what does it launch next?"  → its next launch STEP
//
// and a third click returns to level 1, so the same input reverses the move and
// there is no dead end. Everything here is the SELECTION half — which step, and
// which level the next activation lands on. The GEOMETRY half is
// `stepFocusTransform` in pipelinePlanLayout.js, and the camera move itself is
// `applyFocus` in PipelinePlanVisualizer.jsx, which exists exactly once.
//
// ── WHY THE STEP IS THE UNIT (req #3371) ────────────────────────────────────
// Req #3297 chose a multi-step launch grouping here and rejected the step in
// these words: *"a STEP is a fragment of a launch: zooming to one member of a
// group of four shows a reader part of a command and calls it the next thing to
// happen."* In Pipeline 2.0 that sentence is false — the step IS the command,
// carrying its own `/swarm-start` argument list — so the objection evaporates
// and the step becomes the correct unit by #3297's own test: the smallest thing
// on this surface the reader can act on. One command, one wave, one decision.
//
// NO JSX and no React, for `pipelineEpicLink.js`'s reasons: the cycle is the part
// of this feature most worth pinning in vitest, and the panel it lives in is
// react-konva, which jsdom cannot render. A pure module is how the rules below
// are reachable by a test at all.

// What an activation of the epic name should do next. TWO answers, and there is
// deliberately no third — a "do nothing at all" answer existed here for one
// review round and is documented at `nextEpicZoom` as the thing that must not
// come back.
export const EPIC_ZOOM_BAND = 'band';
export const EPIC_ZOOM_STEP = 'step';

/**
 * The identity the cycle is keyed on.
 *
 * The same expression `placeEpicChips` writes inline for its own `key`
 * (`pipelinePlanLayout.js`), so the chip the reader clicks and the state this
 * module holds cannot disagree. **It MIRRORS that expression rather than
 * replacing it** — the layout module is pure geometry and importing this one
 * into it to save four characters would be the wrong direction — so the
 * agreement is a convention two files keep, asserted in
 * `pipelineEpicZoom.test.js` against a real layout rather than enforced by
 * construction. Change one and the other needs changing.
 *
 * `band.key` is null for the "No epic" band, which is a real, clickable,
 * focusable band like any other (req #3204 made every band focusable); 'none'
 * is its name, not a rejection.
 *
 * @param {?Object} band  a `layout.bands` entry
 * @returns {string|number} a Map-safe key
 */
export function epicCycleKey(band) {
    const k = band == null ? null : band.key;
    return k == null ? 'none' : k;
}

/**
 * The identity the CYCLE STATE is held under — the same epic key, qualified by
 * the plan it was clicked on.
 *
 * `PipelineDetail` renders on a route PARAMETER, so `/swarm/pipeline/2` →
 * `/swarm/pipeline/7` re-renders the same component instance instead of
 * remounting it, and a ref survives the move (code review). An epic seated in
 * both plans would otherwise carry its level across: the reader's very first
 * click in the new plan lands on a step of a plan they have not looked at.
 * `epicFocusAppliedRef` folds `pipeline?.id` into its own key for exactly this
 * reason and this is the same fold.
 *
 * NOT used for the `nextLaunchStepByEpic` lookup, which is keyed by
 * `epicCycleKey` alone so it matches what `placeEpicChips` publishes as the
 * chip's `key`. Two keys, two questions: which chip is this, and which plan's
 * cycle am I in.
 *
 * @param {?number} pipelineId
 * @param {?Object} band
 * @returns {string}
 */
export function epicZoomStateKey(pipelineId, band) {
    return `${pipelineId == null ? 'none' : pipelineId}:${epicCycleKey(band)}`;
}

/**
 * WHICH STEP a second click on this band zooms to — the ELIGIBLE, UNSUPPRESSED
 * step earliest in DISPLAY ORDER within the band, or null when it has none.
 *
 * "Earliest in display order" is read off `rows` IN ORDER and never re-sorted:
 * `displayOrder` is design rule 3's output — topological, then state bands, then
 * execution streams — so the first eligible row of a band IS the next thing that
 * band launches. The engine already owns that ordering; this reads it rather
 * than restating it.
 *
 * Three filters, each load-bearing for a different reason:
 *
 *   · A DRAWN BEAD. `layout.nodes` is the gate, because the thing being zoomed
 *     to is the bead: a step that did not make it onto this layout has no
 *     rectangle, and "focus the step" has no meaning. This is also what makes
 *     "a band with no next launch step" answerable at all, rather than a
 *     null-transform accident.
 *   · ELIGIBLE. The question the second click answers is *what launches next*,
 *     and eligibility is the engine's own answer to it — every gate satisfied,
 *     work still to do. Without it the "next" step of a band deep in its own
 *     backlog would be one nothing can start.
 *   · UNSUPPRESSED. A step whose scope is PAUSED is genuinely eligible and will
 *     not go out (req #3223 keeps the two facts apart deliberately), so naming
 *     it as the next launch would promise a launch the plan is holding.
 *
 * @param {Object[]} rows   `plan.rows` — DISPLAY order, the first match wins
 * @param {Object} layout   computePlanLayout output
 * @param {Object} band     a `layout.bands` entry
 * @param {?Set} eligibleStepIds  `plan.eligibleStepIds`
 * @returns {?number} the step id, or null when this band has no next launch step
 */
export function nextLaunchStep(rows, layout, band, eligibleStepIds) {
    if (!Array.isArray(rows) || !rows.length) return null;
    if (!layout || !layout.nodes || typeof layout.nodes.has !== 'function') return null;
    if (!band) return null;
    const ids = new Set(band.stepIds || []);
    if (!ids.size) return null;
    const eligible = eligibleStepIds instanceof Set ? eligibleStepIds : null;
    if (!eligible || !eligible.size) return null;
    for (const row of rows) {
        if (!row || !ids.has(row.id)) continue;
        if (!eligible.has(row.id)) continue;
        if (row.launchSuppressed) continue;
        if (!layout.nodes.has(row.id)) continue;
        return row.id;
    }
    return null;
}

// ── CLICK OR DRAG? (code review round 2) ────────────────────────────────────
// The px a gesture may move the camera and still be a CLICK rather than a pan.
// It is d3-zoom's own `clickDistance` value, and this module owns it so the
// visualizer's `.clickDistance()` call and the cycle's own test read ONE
// number: they are answering the same question about the same gesture, and two
// copies of it would drift into disagreeing about what a click is.
//
// It exists because the epic chip is a DESCENDANT of the element d3-zoom is
// bound to, so a mousedown on the name starts a pan gesture and every pixel of
// hand-jitter between down and up emits a real zoom event that translates the
// world. Treating any such event as "the reader moved the camera" would clear
// the cycle level on the very click that is supposed to advance it — the
// band → step step would work only for a perfectly still hand, i.e.
// intermittently, which is worse than not working.
//
// TWO PRECISIONS ON "ONE NUMBER", so the next reader is not misled by it:
//
//   · d3 measures POINTER delta; this measures TRANSFORM delta. They are equal
//     for an unclamped pan and diverge at the `constrain` boundary, where the
//     pointer can travel 50px against a world that will not move. Benign in
//     both directions there — d3 suppresses the click, so no activation reaches
//     the cycle at all — but they are the same number, not the same
//     measurement.
//   · d3 consults `clickDistance` in `mousedowned` ONLY; there is no touch
//     equivalent. A finger tap drifts further than a mouse click, so on a
//     touchscreen this threshold is the mouse's number applied to a gesture it
//     was not measured on. Darwin is desktop-first, so it is stated rather than
//     solved — a touch slop would be a second number with no measurement behind
//     it, which is worse than a known limit.
export const EPIC_ZOOM_CLICK_SLOP = 5;

/**
 * Did this gesture MOVE the camera, or was it the jitter inside a click?
 *
 * Any change of SCALE counts, whatever its size: a wheel is unambiguously the
 * reader taking the camera, and there is no such thing as accidental zoom
 * during a click.
 *
 * ONE KNOWN GAP, priced and accepted (code review). d3-zoom keeps a wheel's
 * gesture alive for `wheelDelay` (150 ms) after the last wheel event, and
 * `Gesture.event(undefined)` does not clear an inherited `sourceEvent` — so a
 * focus transition STARTED inside that window emits its own tween ticks
 * carrying the wheel's event, at a scale that differs from the wheel's
 * baseline, and this returns true for what was really the control's own move.
 * Unreachable by mouse (a mousedown takes d3's `clean` path, which replaces the
 * gesture), so it needs the reader to wheel the canvas and then press Enter on
 * a focused chip within 150 ms. The cost is ONE wasted keypress — the level
 * self-corrects on the next activation — and the alternative is to stop
 * trusting `sourceEvent` entirely and diff the camera against the transform
 * `applyFocus` last applied, which is more machinery than the defect is worth.
 *
 * @param {?{x:number,y:number,k:number}} from  transform at gesture start
 * @param {?{x:number,y:number,k:number}} to    transform now
 * @returns {boolean} true when the cycle level must be dropped
 */
export function gestureMovedCamera(from, to) {
    if (!from || !to) return true;      // unknown start = assume they moved
    if (from.k !== to.k) return true;
    return Math.hypot(to.x - from.x, to.y - from.y) > EPIC_ZOOM_CLICK_SLOP;
}

/**
 * THE CYCLE. What the next activation of `key`'s epic name should do, given
 * where the camera was last put by this control.
 *
 * Three rules, and they are the whole of it:
 *
 *   1. A DIFFERENT epic always starts at the band (requirement item 2). The
 *      state is per-epic and never global — a reader who has drilled into epic
 *      A's next launch and then clicks epic B is asking "where is B", not "what
 *      does B launch next", and answering the second question would drop them
 *      into a corner of a band they have never seen.
 *   2. From the band, the next launch STEP — IF there is one. Where there is
 *      not, the answer stays the band, which is the control's own pre-#3297
 *      behaviour; see the ruling below for why that is not the "do nothing" it
 *      looks like it should be.
 *   3. From the step, back to the band. The same input reverses the move, so
 *      the control is never a dead end and the reader never has to find another
 *      way out of the zoom it put them in.
 *
 * `state` is whatever this function last returned, paired with the epic it was
 * returned for — and it is also what a `?epic=` LANDING seeds (requirement item
 * 4): a deep link leaves the reader at band focus, so it counts as click 1 and
 * their first manual click on that same name goes to the step rather than
 * re-fitting the band they are already looking at.
 *
 * ── NO NEXT STEP MEANS THE CONTROL IS UNCHANGED, NOT DISABLED (code review) ──
 * The first cut returned a third answer here — do nothing at all — reading
 * requirement item 6's "the second click leaves the camera exactly where it is"
 * literally. **It made the epic name a ONE-SHOT control on every band with no
 * second stop, permanently, for the rest of the visit** — and that is the
 * common case: an epic whose work is all finished, or all gated, has no next
 * launch, and PIPE-14 drags the canvas and clicks the same name expecting to
 * come back.
 *
 * That is req #3204 deleted on the majority of bands, in the name of a
 * requirement whose own item 1 says "no dead-end state". So: **a band with no
 * second stop keeps exactly the behaviour it had before this requirement.**
 * Item 6 is still honoured where it bites — no step transform is computed,
 * nothing half-zooms, no fallback is invented — and a reader who clicks twice
 * without moving lands on the identical transform, which IS the camera left
 * exactly where it was. Do not reintroduce the third answer.
 *
 * @param {?{key: (string|number), level: string}} state  last applied, or null
 * @param {string|number} key           the epic being activated
 * @param {boolean} hasNextStep         does this band have a next launch step?
 * @returns {'band'|'step'}
 */
export function nextEpicZoom(state, key, hasNextStep) {
    if (!state || state.key !== key) return EPIC_ZOOM_BAND;
    if (state.level === EPIC_ZOOM_STEP) return EPIC_ZOOM_BAND;
    return hasNextStep ? EPIC_ZOOM_STEP : EPIC_ZOOM_BAND;
}

// ── WHAT THE CONTROL SAYS IT DOES (requirement item 7) ──────────────────────
// A control that promises a zoom it will not perform is the defect req #3213
// closed on this very tooltip, from the other side: it described the old
// navigate-away behaviour long after the click had become a fit. So the second
// stop is announced only where the band HAS a second stop, and it names the
// step it will actually go to — the caller passes the value of
// `nextLaunchStep`, so what the label promises and what the click does are one
// lookup and cannot disagree.
//
// The id is spelled out ("launch step 71") rather than shown bare: on the
// canvas a bare number beside an epic name is indistinguishable from a count,
// and a screen reader reading "71" alone has no context at all.
const EPIC_ZOOM_HINT = 'Zoom pipeline epic';

/**
 * The clause naming the second stop, or '' when there is not one.
 * @param {?number} stepId  `nextLaunchStep`'s answer for this band
 */
export function epicZoomHintSuffix(stepId) {
    return stepId != null ? ` — click again for launch step ${stepId}` : '';
}

/**
 * The chip's `title`. The aria-label is NOT this string plus the epic name —
 * it interleaves the name and the pause clause — so the two are composed from
 * the shared suffix above rather than one being built out of the other.
 * @param {?number} stepId  `nextLaunchStep`'s answer for this band
 */
export function epicZoomHint(stepId) {
    return EPIC_ZOOM_HINT + epicZoomHintSuffix(stepId);
}
