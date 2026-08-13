// pipelineEpicZoom.test.js — the epic name's two-state zoom, SELECTION half
// (req #3297, re-pointed at the STEP by req #3371). The geometry half is
// `stepFocusTransform`, pinned in pipelinePlanLayout.test.js § "step focus
// geometry (req #3253)".
//
// This is where the click cycle lives as a testable thing at all: the control
// is a chip inside a react-konva panel jsdom cannot render, so the rules —
// which step, which level, what the label promises — are a pure module, and
// the component does nothing with them but call `applyFocus`.

import { describe, it, expect } from 'vitest';

// req #3356 — the plan fixture is minted by `planFixtureEngine.js`, this
// directory's TEST-ONLY copy of Pipeline 1.0's derivation engine. Pipeline 2.0
// derives server-side (`pipeline2_derive.py`), so there is no JS derivation left
// in `src/` for a layout test to run; that file's header carries the full
// reasoning and how it is retired. The module under test
// (`../pipelineEpicZoom.js`) is era-neutral — it reads `PlanRow`s and cares
// nothing about who built them — so the fixture's provenance does not weaken
// what these cases assert.
import { buildPipelineModel, orderedPlan } from './planFixtureEngine';
import { computePlanLayout, placeEpicChips } from '../pipelinePlanLayout';
import {
    epicCycleKey, epicZoomStateKey, epicWorkStepIds, nextEpicZoom,
    epicZoomHint, epicZoomHintSuffix, epicSeatedHint, gestureMovedCamera,
    EPIC_ZOOM_CLICK_SLOP, EPIC_ZOOM_BAND, EPIC_ZOOM_STEP,
} from '../pipelineEpicZoom';
import { EPIC_ZOOM_READS, EPIC_ZOOM_PIPELINE, EPIC_ZOOM_NOW } from './epicZoomFixture';

const plan = orderedPlan(
    buildPipelineModel({ pipeline: EPIC_ZOOM_PIPELINE, ...EPIC_ZOOM_READS }),
    { now: EPIC_ZOOM_NOW },
);
const layout = computePlanLayout(plan.rows);
const eligible = plan.eligibleStepIds;

const bandOf = (key) => layout.bands.find((b) => epicCycleKey(b) === key);
const LAUNCH_BAND = bandOf(11);     // six steps, several of them eligible
const SOLO_BAND = bandOf(12);       // one step, eligible
const DONE_BAND = bandOf('none');   // the completed gate step — no second stop

describe('the fixture is the plan these rules are about', () => {
    it('carries a band with several eligible steps, one with one, and one with none', () => {
        expect(LAUNCH_BAND).toBeTruthy();
        expect(SOLO_BAND).toBeTruthy();
        expect(DONE_BAND).toBeTruthy();
        // Display order, so "earliest in the band" has something to decide.
        expect(LAUNCH_BAND.stepIds.filter((id) => eligible.has(id)).length)
            .toBeGreaterThan(1);
        expect(SOLO_BAND.stepIds.filter((id) => eligible.has(id))).toHaveLength(1);
        expect(DONE_BAND.stepIds.some((id) => eligible.has(id))).toBe(false);
    });
});

describe('epicCycleKey', () => {
    it('is the epic id where there is one', () => {
        expect(epicCycleKey(LAUNCH_BAND)).toBe(11);
    });

    // The "No epic" band is a real, clickable, focusable band (req #3204), and
    // its key is null — which is a legal Map key but not a legal `data-testid`
    // and not what `placeEpicChips` publishes. One expression, in one module.
    // THE MIRROR, ASSERTED (code review). `placeEpicChips` writes the same
    // expression inline in the layout module — this one does not replace it, so
    // nothing but this case stops the two drifting. A mismatch would be silent
    // and total: every `nextLaunchByEpic.get(e.key)` would miss, so no chip
    // would ever name its step and no second click would ever reach one.
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
        expect(DONE_BAND.key).toBeNull();
        expect(epicCycleKey(DONE_BAND)).toBe('none');
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
        expect(epicZoomStateKey(2, LAUNCH_BAND)).not.toBe(epicZoomStateKey(7, LAUNCH_BAND));
    });

    it('is stable for the same (plan, band), and names an id-less plan', () => {
        expect(epicZoomStateKey(2, LAUNCH_BAND)).toBe(epicZoomStateKey(2, LAUNCH_BAND));
        expect(epicZoomStateKey(null, DONE_BAND)).toBe('none:none');
        expect(epicZoomStateKey(undefined, LAUNCH_BAND)).toBe('none:11');
    });

    // Two bands of ONE plan must still be distinct, or the reset rule (item 2)
    // would silently stop resetting.
    it('separates two bands of the same plan', () => {
        expect(epicZoomStateKey(2, LAUNCH_BAND)).not.toBe(epicZoomStateKey(2, SOLO_BAND));
        expect(epicZoomStateKey(2, SOLO_BAND)).not.toBe(epicZoomStateKey(2, DONE_BAND));
    });
});

describe('epicWorkStepIds — what a second click frames (req #3365)', () => {
    // ACTIVE AND PENDING: every step of the band the plan has not finished.
    it('is every unfinished step of the band, in display order', () => {
        const ids = epicWorkStepIds(plan.rows, layout, LAUNCH_BAND);
        const expected = plan.rows
            .filter((r) => LAUNCH_BAND.stepIds.includes(r.id) && r.state !== 'done')
            .map((r) => r.id);
        expect(ids).toEqual(expected);
        expect(ids.length).toBeGreaterThan(1);
    });

    // THE ORDERING IS THE ROWS', never a sort of the ids — the same property
    // the deleted `nextLaunchStep` suite pinned, for the same reason: display
    // order is design rule 3's output and this must not quietly re-derive it.
    it('reads the row order it is given', () => {
        const reversed = [...plan.rows].reverse();
        const forward = epicWorkStepIds(plan.rows, layout, LAUNCH_BAND);
        const backward = epicWorkStepIds(reversed, layout, LAUNCH_BAND);
        expect(backward).toEqual([...forward].reverse());
    });

    // ELIGIBILITY IS NOT THE PREDICATE, and that is the whole change. A band
    // whose work is blocked or already running has nothing eligible — which is
    // why the old second click did nothing there — and still has work to frame.
    it('frames work that is not eligible, and work that is suppressed', () => {
        const held = plan.rows.map((r) => ({ ...r, launchSuppressed: true }));
        expect(epicWorkStepIds(held, layout, LAUNCH_BAND))
            .toEqual(epicWorkStepIds(plan.rows, layout, LAUNCH_BAND));
    });

    it('is empty for a band with nothing left to do', () => {
        expect(epicWorkStepIds(plan.rows, layout, DONE_BAND)).toEqual([]);
    });

    it('is the single step of a one-step band while that step is unfinished', () => {
        const ids = epicWorkStepIds(plan.rows, layout, SOLO_BAND);
        expect(ids).toEqual([SOLO_BAND.stepIds[0]]);
    });

    // A DRAWN BEAD is the gate: the thing being framed is the bead, and a step
    // absent from this layout has no rectangle to fit.
    it('skips a step that is not on this layout', () => {
        const empty = computePlanLayout([]);
        expect(epicWorkStepIds(plan.rows, empty, LAUNCH_BAND)).toEqual([]);
    });

    it('is empty on unusable input rather than throwing', () => {
        expect(epicWorkStepIds([], layout, LAUNCH_BAND)).toEqual([]);
        expect(epicWorkStepIds(null, layout, LAUNCH_BAND)).toEqual([]);
        expect(epicWorkStepIds(plan.rows, null, LAUNCH_BAND)).toEqual([]);
        expect(epicWorkStepIds(plan.rows, layout, null)).toEqual([]);
        expect(epicWorkStepIds(plan.rows, layout, { stepIds: [] })).toEqual([]);
    });
});

describe('nextEpicZoom — the cycle', () => {
    it('starts at the band', () => {
        expect(nextEpicZoom(null, 11, true)).toBe(EPIC_ZOOM_BAND);
    });

    it('goes band → step → band on the same epic', () => {
        let state = null;
        const click = (key, hasStep) => {
            const next = nextEpicZoom(state, key, hasStep);
            state = { key, level: next };
            return next;
        };
        expect(click(11, true)).toBe(EPIC_ZOOM_BAND);
        expect(click(11, true)).toBe(EPIC_ZOOM_STEP);
        expect(click(11, true)).toBe(EPIC_ZOOM_BAND);
        expect(click(11, true)).toBe(EPIC_ZOOM_STEP);
    });

    // Requirement item 2. The state is per-epic: a reader who has drilled into
    // epic 11's next launch and clicks epic 12 is asking where 12 is, not what
    // it launches next.
    it('resets to the band on a different epic', () => {
        expect(nextEpicZoom({ key: 11, level: EPIC_ZOOM_STEP }, 12, true))
            .toBe(EPIC_ZOOM_BAND);
        expect(nextEpicZoom({ key: 11, level: EPIC_ZOOM_BAND }, 'none', true))
            .toBe(EPIC_ZOOM_BAND);
    });

    // Requirement item 4. A `?epic=` landing leaves the reader at band focus and
    // seeds exactly this state, so their FIRST manual click on that name goes
    // one level deeper instead of re-fitting the band already on screen.
    it('treats a deep-link landing as click 1', () => {
        const seeded = { key: 11, level: EPIC_ZOOM_BAND };
        expect(nextEpicZoom(seeded, 11, true)).toBe(EPIC_ZOOM_STEP);
    });

    // Requirement item 6, and THE REGRESSION THIS RULE EXISTS TO PREVENT (code
    // review of req #3297). The first cut returned a third "do nothing" answer
    // here, which made the epic name a ONE-SHOT control on every band with no
    // second stop — and it went dead for the rest of the visit. A level that
    // does not exist takes nothing away from the level below it: the control
    // keeps doing exactly what req #3204 made it do.
    it('keeps fitting the band, forever, when there is no next launch step', () => {
        let state = null;
        for (let n = 0; n < 5; n++) {
            const next = nextEpicZoom(state, 'none', false);
            expect(next).toBe(EPIC_ZOOM_BAND);
            state = { key: 'none', level: next };
        }
    });

    // AND THE NO-OP IS A TRUE NO-OP: the level the cycle reports is the level
    // it was already on, so nothing about the control's state changes.
    it('leaves the state exactly as it was on a band with no second stop', () => {
        const state = { key: 'none', level: EPIC_ZOOM_BAND };
        expect(nextEpicZoom(state, 'none', false)).toBe(state.level);
    });

    it('still lets a band with no second stop be focused for the first time', () => {
        expect(nextEpicZoom(null, 'none', false)).toBe(EPIC_ZOOM_BAND);
        expect(nextEpicZoom({ key: 11, level: EPIC_ZOOM_STEP }, 'none', false))
            .toBe(EPIC_ZOOM_BAND);
    });

    // The way back out never depends on there being a next step — a reader
    // parked at level 2 must be able to leave whatever the plan has since
    // become.
    it('returns to the band from the step even if the step has vanished', () => {
        expect(nextEpicZoom({ key: 11, level: EPIC_ZOOM_STEP }, 11, false))
            .toBe(EPIC_ZOOM_BAND);
    });
});

describe('gestureMovedCamera — the reader taking the camera, vs click jitter', () => {
    const at = (x, y, k = 1) => ({ x, y, k });

    // THE DEFECT THIS EXISTS FOR: the epic chip is a descendant of the element
    // d3-zoom is bound to, so a mousedown on the NAME starts a pan and every
    // pixel of hand-jitter inside the click emits a real zoom event that
    // translates the world. Clearing the cycle on any of those would break the
    // band → step move for anyone whose hand moves — intermittently, which is
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
    it('names the second stop, and how much work it will frame', () => {
        // req #3365 re-pointed level 2 from ONE launch step to the epic's
        // unfinished work, so the promise names the SUBJECT rather than a step
        // id — a control that named one step while framing nine would be worse
        // than one that names none.
        expect(epicZoomHint([4, 5, 6]))
            .toBe('Zoom pipeline epic — click again to frame its 3 unfinished steps');
        expect(epicZoomHintSuffix([71]))
            .toBe(' — click again to frame its 1 unfinished step');
    });

    it('promises no zoom that cannot happen', () => {
        expect(epicZoomHint([])).toBe('Zoom pipeline epic');
        expect(epicZoomHint(null)).toBe('Zoom pipeline epic');
        expect(epicZoomHint(undefined)).toBe('Zoom pipeline epic');
        expect(epicZoomHintSuffix(null)).toBe('');
    });

    // The falsy-id hazard the id-based suffix had is GONE with the id — what
    // replaced it is a COUNT, where 0 legitimately means "nothing to frame".
    // Pinned because the two look alike and the guard is the opposite one: an
    // empty list must say nothing, and anything that is not a list must too.
    it('says nothing for an empty or malformed work list', () => {
        expect(epicZoomHintSuffix([])).toBe('');
        expect(epicZoomHintSuffix(null)).toBe('');
        expect(epicZoomHintSuffix(undefined)).toBe('');
        expect(epicZoomHintSuffix(7)).toBe('');
    });

    // The promise and the behaviour read the SAME lookup, so a band that has a
    // second stop always announces one and a band that does not never can.
    it('agrees with the selector on every band of the plan', () => {
        for (const band of layout.bands) {
            const workIds = epicWorkStepIds(plan.rows, layout, band);
            const announced = epicZoomHint(workIds).includes('click again');
            expect(announced).toBe(workIds.length > 0);
            if (workIds.length) {
                expect(epicZoomHint(workIds)).toContain(String(workIds.length));
            }
        }
    });
});

// req #3373 — the met/total suffix's denominator, named on hover.
describe('epicSeatedHint — the count is requirements SEATED, not by feature', () => {
    it('names the denominator only when a count is actually showing', () => {
        expect(epicSeatedHint(true))
            .toBe(' — the count is requirements seated under this epic');
    });

    it('says nothing when there is no count to explain', () => {
        expect(epicSeatedHint(false)).toBe('');
    });
});
