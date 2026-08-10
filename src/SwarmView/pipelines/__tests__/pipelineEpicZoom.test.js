// pipelineEpicZoom.test.js — the epic name's two-state zoom, SELECTION half
// (req #3297). The geometry half is pinned in pipelinePlanLayout.test.js
// (`batchFitRect` / `batchFocusTransform`) against the same fixture.
//
// This is where the click cycle lives as a testable thing at all: the control
// is a chip inside a react-konva panel jsdom cannot render, so the rules —
// which batch, which level, what the label promises — are a pure module, and
// the component does nothing with them but call `applyFocus`.

import { describe, it, expect } from 'vitest';

import { buildPipelineModel } from '../pipelineViewModel';
import { computePlanLayout, placeEpicChips, STEP_DONE } from '../pipelinePlanLayout';
import {
    epicCycleKey, epicZoomStateKey, nextBatchLetter, nextEpicZoom,
    epicZoomHint, epicZoomHintSuffix, gestureMovedCamera, EPIC_ZOOM_CLICK_SLOP,
    EPIC_ZOOM_BAND, EPIC_ZOOM_BATCH,
} from '../pipelineEpicZoom';
import { EPIC_ZOOM_READS, EPIC_ZOOM_PIPELINE, EPIC_ZOOM_NOW } from './epicZoomFixture';
// req #3381 — `orderedPlan` was deleted from pipelineViewModel.js; see
// testOrderedPlan.js's header for why this file still needs a `plan` fixture.
import { buildTestOrderedPlan as orderedPlan } from './testOrderedPlan';

const plan = orderedPlan(
    buildPipelineModel({ pipeline: EPIC_ZOOM_PIPELINE, ...EPIC_ZOOM_READS }),
    { now: EPIC_ZOOM_NOW },
);
const layout = computePlanLayout(plan.rows, plan.batches);
const rowById = new Map(plan.rows.map((r) => [r.id, r]));

const bandOf = (key) => layout.bands.find((b) => epicCycleKey(b) === key);
const BATCH_BAND = bandOf(11);      // two batches, A spanning two columns
const PLAIN_BAND = bandOf(12);      // one step, no batch
const NO_EPIC_BAND = bandOf('none');

describe('the fixture is the plan these rules are about', () => {
    it('derives two batches, three box segments, and two batch-less bands', () => {
        expect(plan.batches.map((b) => b.letter)).toEqual(['A', 'B']);
        expect(layout.batchBoxes).toHaveLength(3);
        expect(BATCH_BAND).toBeTruthy();
        expect(PLAIN_BAND).toBeTruthy();
        expect(NO_EPIC_BAND).toBeTruthy();
    });
});

describe('epicCycleKey', () => {
    it('is the epic id where there is one', () => {
        expect(epicCycleKey(BATCH_BAND)).toBe(11);
    });

    // The "No epic" band is a real, clickable, focusable band (req #3204), and
    // its key is null — which is a legal Map key but not a legal `data-testid`
    // and not what `placeEpicChips` publishes. One expression, in one module.
    // THE MIRROR, ASSERTED (code review). `placeEpicChips` writes the same
    // expression inline in the layout module — this one does not replace it, so
    // nothing but this case stops the two drifting. A mismatch would be silent
    // and total: every `nextBatchByEpic.get(e.key)` would miss, so no chip would
    // ever name its batch and no second click would ever reach one.
    it('matches the key `placeEpicChips` publishes, band for band', () => {
        const chips = placeEpicChips({
            bands: layout.bands,
            transform: { x: 0, y: 0, k: 1 },
            viewport: { w: 2000, h: 2000 },
            worldWidth: layout.width,
        });
        expect(chips.length).toBeGreaterThan(0);
        for (const chip of chips) expect(chip.key).toBe(epicCycleKey(chip.band));
    });

    it("names the 'No epic' band rather than rejecting it", () => {
        expect(NO_EPIC_BAND.key).toBeNull();
        expect(epicCycleKey(NO_EPIC_BAND)).toBe('none');
        expect(epicCycleKey(null)).toBe('none');
        expect(epicCycleKey(undefined)).toBe('none');
        expect(epicCycleKey({})).toBe('none');
    });
});

describe('epicZoomStateKey', () => {
    // `PipelineDetail` renders on a route PARAMETER, so moving between plans
    // re-renders rather than remounts and a ref survives the move. An epic
    // seated in two plans must not carry its level across (code review).
    it('separates the same epic seated in two plans', () => {
        expect(epicZoomStateKey(2, BATCH_BAND)).not.toBe(epicZoomStateKey(7, BATCH_BAND));
    });

    it('is stable for the same (plan, band), and names an id-less plan', () => {
        expect(epicZoomStateKey(2, BATCH_BAND)).toBe(epicZoomStateKey(2, BATCH_BAND));
        expect(epicZoomStateKey(null, NO_EPIC_BAND)).toBe('none:none');
        expect(epicZoomStateKey(undefined, BATCH_BAND)).toBe('none:11');
    });

    // Two bands of ONE plan must still be distinct, or the reset rule (item 2)
    // would silently stop resetting.
    it('separates two bands of the same plan', () => {
        expect(epicZoomStateKey(2, BATCH_BAND)).not.toBe(epicZoomStateKey(2, PLAIN_BAND));
        expect(epicZoomStateKey(2, PLAIN_BAND)).not.toBe(epicZoomStateKey(2, NO_EPIC_BAND));
    });
});

describe('nextBatchLetter — which batch a second click goes to', () => {
    it('is the lowest-lettered batch of the clicked band', () => {
        expect(nextBatchLetter(plan.batches, layout, BATCH_BAND, rowById)).toBe('A');
    });

    // Requirement item 6, first half: a band that draws no lettered box has no
    // second stop, and must say so rather than hand back a letter whose fit
    // would come back null.
    it('is null for a band with no lettered batch', () => {
        expect(nextBatchLetter(plan.batches, layout, PLAIN_BAND, rowById)).toBeNull();
        expect(nextBatchLetter(plan.batches, layout, NO_EPIC_BAND, rowById)).toBeNull();
    });

    // Requirement item 6, second half. `launchBatches` only ever groups pending
    // rows, so this cannot arise from the engine today — which is exactly why it
    // is asserted here rather than assumed away: the rule must survive the
    // engine changing its mind.
    it('skips a batch whose every step is done, and takes the next one', () => {
        const done = new Map(plan.rows.map((r) => [r.id, r]));
        for (const id of [4, 5, 2, 3]) done.set(id, { ...done.get(id), state: STEP_DONE });
        expect(nextBatchLetter(plan.batches, layout, BATCH_BAND, done)).toBe('B');
    });

    it('is null when every batch of the band is done', () => {
        const done = new Map(plan.rows.map((r) => [r.id, { ...r, state: STEP_DONE }]));
        expect(nextBatchLetter(plan.batches, layout, BATCH_BAND, done)).toBeNull();
    });

    // The reason this reads `batches` IN ORDER instead of sorting the letters:
    // past batch 26 the engine emits AA, which sorts BEFORE 'B' and launches
    // long after it. A lexical sort passes every test above and fails this one.
    it('reads the engine order, never a lexical sort of the letters', () => {
        const twoBoxes = {
            ...layout,
            batchBoxes: [
                { ...layout.batchBoxes[0], letter: 'B' },
                { ...layout.batchBoxes[2], letter: 'AA' },
            ],
        };
        const batches = [
            { letter: 'B', stepIds: [4, 5] },
            { letter: 'AA', stepIds: [6, 7] },
        ];
        expect(nextBatchLetter(batches, twoBoxes, BATCH_BAND, rowById)).toBe('B');
    });

    it('is null on empty or unusable input rather than throwing', () => {
        expect(nextBatchLetter([], layout, BATCH_BAND, rowById)).toBeNull();
        expect(nextBatchLetter(null, layout, BATCH_BAND, rowById)).toBeNull();
        expect(nextBatchLetter(plan.batches, null, BATCH_BAND, rowById)).toBeNull();
        expect(nextBatchLetter(plan.batches, layout, null, rowById)).toBeNull();
        expect(nextBatchLetter(plan.batches, layout, { stepIds: [] }, rowById)).toBeNull();
        // A row set that cannot answer "is this done?" is not a licence to
        // guess: no row, no claim that the batch has work left.
        expect(nextBatchLetter(plan.batches, layout, BATCH_BAND, new Map())).toBeNull();
        expect(nextBatchLetter(plan.batches, layout, BATCH_BAND, null)).toBeNull();
    });
});

describe('nextEpicZoom — the cycle', () => {
    it('starts at the band', () => {
        expect(nextEpicZoom(null, 11, true)).toBe(EPIC_ZOOM_BAND);
    });

    it('goes band → batch → band on the same epic', () => {
        let state = null;
        const step = (key, hasBatch) => {
            const next = nextEpicZoom(state, key, hasBatch);
            state = { key, level: next };
            return next;
        };
        expect(step(11, true)).toBe(EPIC_ZOOM_BAND);
        expect(step(11, true)).toBe(EPIC_ZOOM_BATCH);
        expect(step(11, true)).toBe(EPIC_ZOOM_BAND);
        expect(step(11, true)).toBe(EPIC_ZOOM_BATCH);
    });

    // Requirement item 2. The state is per-epic: a reader who has drilled into
    // epic 11's batch and clicks epic 12 is asking where 12 is, not what it
    // launches next.
    it('resets to the band on a different epic', () => {
        expect(nextEpicZoom({ key: 11, level: EPIC_ZOOM_BATCH }, 12, true))
            .toBe(EPIC_ZOOM_BAND);
        expect(nextEpicZoom({ key: 11, level: EPIC_ZOOM_BAND }, 'none', true))
            .toBe(EPIC_ZOOM_BAND);
    });

    // Requirement item 4. A `?epic=` landing leaves the reader at band focus and
    // seeds exactly this state, so their FIRST manual click on that name goes
    // one level deeper instead of re-fitting the band already on screen.
    it('treats a deep-link landing as click 1', () => {
        const seeded = { key: 11, level: EPIC_ZOOM_BAND };
        expect(nextEpicZoom(seeded, 11, true)).toBe(EPIC_ZOOM_BATCH);
    });

    // Requirement item 6, and THE REGRESSION THIS RULE EXISTS TO PREVENT (code
    // review). The first cut returned a third "do nothing" answer here, which
    // made the epic name a ONE-SHOT control on every batch-less band — and
    // batch-less is the common case, so most chips answered one click and then
    // went dead. A level that does not exist takes nothing away from the level
    // below it: the control keeps doing exactly what req #3204 made it do.
    it('keeps fitting the band, forever, when there is no next batch', () => {
        let state = null;
        for (let click = 0; click < 5; click++) {
            const next = nextEpicZoom(state, 12, false);
            expect(next).toBe(EPIC_ZOOM_BAND);
            state = { key: 12, level: next };
        }
    });

    it('still lets a batch-less epic be focused for the first time', () => {
        expect(nextEpicZoom(null, 12, false)).toBe(EPIC_ZOOM_BAND);
        expect(nextEpicZoom({ key: 11, level: EPIC_ZOOM_BATCH }, 12, false))
            .toBe(EPIC_ZOOM_BAND);
    });

    // The way back out never depends on there being a batch — a reader parked at
    // level 2 must be able to leave whatever the plan has since become.
    it('returns to the band from the batch even if the batch has vanished', () => {
        expect(nextEpicZoom({ key: 11, level: EPIC_ZOOM_BATCH }, 11, false))
            .toBe(EPIC_ZOOM_BAND);
    });
});

describe('gestureMovedCamera — the reader taking the camera, vs click jitter', () => {
    const at = (x, y, k = 1) => ({ x, y, k });

    // THE DEFECT THIS EXISTS FOR: the epic chip is a descendant of the element
    // d3-zoom is bound to, so a mousedown on the NAME starts a pan and every
    // pixel of hand-jitter inside the click emits a real zoom event that
    // translates the world. Clearing the cycle on any of those would break the
    // band → batch step for anyone whose hand moves — intermittently, which is
    // worse than not working at all.
    it('is false for the jitter inside a click', () => {
        expect(gestureMovedCamera(at(100, 100), at(100, 100))).toBe(false);
        expect(gestureMovedCamera(at(100, 100), at(103, 103))).toBe(false);
        expect(gestureMovedCamera(at(100, 100), at(100 + EPIC_ZOOM_CLICK_SLOP, 100)))
            .toBe(false);
    });

    it('is true for a pan past the slop', () => {
        expect(gestureMovedCamera(at(100, 100), at(100 + EPIC_ZOOM_CLICK_SLOP + 1, 100)))
            .toBe(true);
        expect(gestureMovedCamera(at(100, 100), at(10, 50))).toBe(true);
    });

    // A wheel is unambiguous — there is no accidental zoom inside a click — so
    // ANY scale change counts however small the translation.
    it('is true for any change of scale, however small', () => {
        expect(gestureMovedCamera(at(100, 100, 1), at(100, 100, 1.0001))).toBe(true);
    });

    it('assumes the reader moved when the baseline is unknown', () => {
        expect(gestureMovedCamera(null, at(100, 100))).toBe(true);
        expect(gestureMovedCamera(at(100, 100), null)).toBe(true);
    });
});

describe('what the control says it does (item 7)', () => {
    it('names the second stop, and the letter it will go to', () => {
        expect(epicZoomHint('A')).toBe('Zoom pipeline epic — click again for launch batch A');
        expect(epicZoomHintSuffix('B')).toBe(' — click again for launch batch B');
    });

    it('promises no zoom that cannot happen', () => {
        expect(epicZoomHint(null)).toBe('Zoom pipeline epic');
        expect(epicZoomHint(undefined)).toBe('Zoom pipeline epic');
        expect(epicZoomHintSuffix(null)).toBe('');
    });

    // The promise and the behaviour read the SAME lookup, so a band that has a
    // second stop always announces one and a band that does not never can.
    it('agrees with the selector on every band of the plan', () => {
        for (const band of layout.bands) {
            const letter = nextBatchLetter(plan.batches, layout, band, rowById);
            const announced = epicZoomHint(letter).includes('click again');
            expect(announced).toBe(letter != null);
            if (letter) expect(epicZoomHint(letter)).toContain(letter);
        }
    });
});
