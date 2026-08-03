// pipelineEpicZoom.js — the epic name's two-state zoom (req #3297).
//
// The epic name on the plan visualizer is a PROGRESSIVE-DISCLOSURE control, not
// a one-shot fit. It answers two questions, in the order a reader asks them:
//
//   level 1 (req #3204)  "where is this epic?"        → the whole band
//   level 2 (req #3297)  "what does it launch next?"  → its next launch batch
//
// and a third click returns to level 1, so the same input reverses the move and
// there is no dead end. Everything here is the SELECTION half — which batch, and
// which level the next activation lands on. The GEOMETRY half is
// `batchFocusTransform` in pipelinePlanLayout.js, and the camera move itself is
// `applyFocus` in PipelinePlanVisualizer.jsx, which exists exactly once.
//
// NO JSX and no React, for `pipelineEpicLink.js`'s reasons: the cycle is the part
// of this feature most worth pinning in vitest, and the panel it lives in is
// react-konva, which jsdom cannot render. A pure module is how the rules below
// are reachable by a test at all.

import { STEP_DONE } from './pipelineModel';

// What an activation of the epic name should do next. TWO answers, and there is
// deliberately no third — a "do nothing at all" answer existed here for one
// review round and is documented at `nextEpicZoom` as the thing that must not
// come back.
export const EPIC_ZOOM_BAND = 'band';
export const EPIC_ZOOM_BATCH = 'batch';

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
 * click in the new plan lands inside a batch of a plan they have not looked at.
 * `epicFocusAppliedRef` folds `pipeline?.id` into its own key for exactly this
 * reason and this is the same fold.
 *
 * NOT used for the `nextBatchByEpic` lookup, which is keyed by
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
 * WHICH BATCH a second click on this band zooms to — the lowest-lettered launch
 * batch the band still has to launch, or null when it has none.
 *
 * "Lowest-lettered" is read off `batches` IN ORDER and never by sorting the
 * letters: `launchBatches` assigns them in display order, where A launches
 * first, and past batch 26 the letters go AA, AB — which sorts BEFORE 'B'
 * lexically and after it in the plan. The engine already owns this ordering
 * (design rule 3), so this reads it rather than restating it.
 *
 * Two filters, and both are load-bearing for a different reason:
 *
 *   · A DRAWN BOX. `layout.batchBoxes` is the gate, not `batches`, because the
 *     thing being zoomed to is the box: a batch whose members did not make it
 *     onto this layout has no rectangle, and "focus the batch" has no meaning.
 *     This is also what makes requirement item 6's "a band with no lettered
 *     batch" answerable at all, rather than a null-transform accident.
 *   · AT LEAST ONE NON-DONE STEP. Today this cannot subtract anything —
 *     `launchBatches` only ever groups `STEP_PENDING` rows, so every batch it
 *     emits is entirely un-launched. It is written anyway because the
 *     requirement states the rule and because the alternative is a silent
 *     dependency on another module's internals: if a batch ever carries a
 *     finished member, "next" must still mean the next one that has work left.
 *
 * AND NOT ON `eligibleStepIds`, which requirement item 3 names — because the
 * ordering it also names ALREADY encodes it. `plan.batches` is emitted in
 * display order, and design rule 3 bands that order by state, so the launchable
 * batch is the low letter; filtering on eligibility as well would be the second
 * ordering rule item 3 forbids. It would also answer the wrong question in the
 * one case where the two differ: every batch of the band gated, where an
 * eligibility filter returns NOTHING and the reader — who asked what launches
 * next, not what launches now — is shown their own band again.
 *
 * @param {Object[]} batches   `plan.batches` — engine order, A launches first
 * @param {Object} layout      computePlanLayout output
 * @param {Object} band        a `layout.bands` entry
 * @param {Map} rowById        plan rows by id, for step state
 * @returns {?string} the batch letter, or null when this band has no next batch
 */
export function nextBatchLetter(batches, layout, band, rowById) {
    if (!Array.isArray(batches) || !batches.length) return null;
    if (!layout || !Array.isArray(layout.batchBoxes) || !band) return null;
    const ids = new Set(band.stepIds || []);
    if (!ids.size) return null;
    // The letters this band actually draws a box for.
    const drawn = new Set();
    for (const box of layout.batchBoxes) {
        if ((box.stepIds || []).some((id) => ids.has(id))) drawn.add(box.letter);
    }
    for (const b of batches) {
        if (!b || !drawn.has(b.letter)) continue;
        const unfinished = (b.stepIds || []).some((id) => {
            const row = rowById && rowById.get ? rowById.get(id) : null;
            return row != null && row.state !== STEP_DONE;
        });
        if (unfinished) return b.letter;
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
// band → batch step would work only for a perfectly still hand, i.e.
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
 *      A's batch and then clicks epic B is asking "where is B", not "what does
 *      B launch next", and answering the second question would drop them into a
 *      corner of a band they have never seen.
 *   2. From the band, the batch — IF there is one. Where there is not, the
 *      answer stays the band, which is the control's own pre-#3297 behaviour;
 *      see the ruling below for why that is not the "do nothing" it looks like
 *      it should be.
 *   3. From the batch, back to the band. The same input reverses the move, so
 *      the control is never a dead end and the reader never has to find another
 *      way out of the zoom it put them in.
 *
 * `state` is whatever this function last returned, paired with the epic it was
 * returned for — and it is also what a `?epic=` LANDING seeds (requirement item
 * 4): a deep link leaves the reader at band focus, so it counts as click 1 and
 * their first manual click on that same name goes to the batch rather than
 * re-fitting the band they are already looking at.
 *
 * ── NO BATCH MEANS THE CONTROL IS UNCHANGED, NOT DISABLED (code review) ─────
 * The first cut returned a third answer here — do nothing at all — reading
 * requirement item 6's "the second click leaves the camera exactly where it is"
 * literally. **It made the epic name a ONE-SHOT control on every batch-less
 * band, permanently, for the rest of the visit.** Measured: the E2E's own plan
 * derives NO launch batches, so that was every chip on it; PIPE-14 drags the
 * canvas and clicks the same name expecting to come back, and got nothing. An
 * epic mid-flight has no batch either, so it reached production shapes too, and
 * a `?epic=` landing on a batch-less epic burned the reader's FIRST click.
 *
 * That is req #3204 deleted on the majority of bands, in the name of a
 * requirement whose own item 1 says "no dead-end state" — and it is a bigger
 * change than the one being asked for. So: **a band with no second stop keeps
 * exactly the behaviour it had before this requirement.** Item 6 is still
 * honoured where it bites — no batch transform is computed, nothing half-zooms,
 * no fallback to single-step focus is invented — and a reader who clicks twice
 * without moving lands on the identical transform, which IS the camera left
 * exactly where it was. Do not reintroduce the third answer.
 *
 * @param {?{key: (string|number), level: string}} state  last applied, or null
 * @param {string|number} key           the epic being activated
 * @param {boolean} hasNextBatch        does this band have a next batch?
 * @returns {'band'|'batch'}
 */
export function nextEpicZoom(state, key, hasNextBatch) {
    if (!state || state.key !== key) return EPIC_ZOOM_BAND;
    if (state.level === EPIC_ZOOM_BATCH) return EPIC_ZOOM_BAND;
    return hasNextBatch ? EPIC_ZOOM_BATCH : EPIC_ZOOM_BAND;
}

// ── WHAT THE CONTROL SAYS IT DOES (requirement item 7) ──────────────────────
// A control that promises a zoom it will not perform is the defect req #3213
// closed on this very tooltip, from the other side: it described the old
// navigate-away behaviour long after the click had become a fit. So the second
// stop is announced only where the band HAS a second stop, and it names the
// letter it will actually go to — the caller passes the value of
// `nextBatchLetter`, so what the label promises and what the click does are one
// lookup and cannot disagree.
//
// The letter is spelled out ("launch batch A") rather than shown bare: on the
// canvas the letter rides its own dashed box and the association is visual, and
// a tooltip or a screen reader reading "A" alone has none of that context.
const EPIC_ZOOM_HINT = 'Zoom pipeline epic';

/**
 * The clause naming the second stop, or '' when there is not one.
 * @param {?string} letter  `nextBatchLetter`'s answer for this band
 */
export function epicZoomHintSuffix(letter) {
    return letter ? ` — click again for launch batch ${letter}` : '';
}

/**
 * The chip's `title`. The aria-label is NOT this string plus the epic name —
 * it interleaves the name and the pause clause — so the two are composed from
 * the shared suffix above rather than one being built out of the other.
 * @param {?string} letter  `nextBatchLetter`'s answer for this band
 */
export function epicZoomHint(letter) {
    return EPIC_ZOOM_HINT + epicZoomHintSuffix(letter);
}
