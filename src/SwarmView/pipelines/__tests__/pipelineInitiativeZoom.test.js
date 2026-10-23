// pipelineInitiativeZoom.test.js — the initiative name's two-state zoom, SELECTION half
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
// (`../pipelineInitiativeZoom.js`) is era-neutral — it reads `PlanRow`s and cares
// nothing about who built them — so the fixture's provenance does not weaken
// what these cases assert.
import { buildPipelineModel, orderedPlan } from './planFixtureEngine';
import { computePlanLayout, placeInitiativeChips } from '../pipelinePlanLayout';
import {
    initiativeCycleKey, initiativeZoomStateKey, initiativeWorkStepIds, nextInitiativeZoom,
    initiativeZoomHint, initiativeZoomHintSuffix, initiativeSeatedHint, gestureMovedCamera,
    INITIATIVE_ZOOM_CLICK_SLOP, INITIATIVE_ZOOM_BAND, INITIATIVE_ZOOM_STEP,
} from '../pipelineInitiativeZoom';
import { INITIATIVE_ZOOM_READS, INITIATIVE_ZOOM_PIPELINE, INITIATIVE_ZOOM_NOW } from './initiativeZoomFixture';

const plan = orderedPlan(
    buildPipelineModel({ pipeline: INITIATIVE_ZOOM_PIPELINE, ...INITIATIVE_ZOOM_READS }),
    { now: INITIATIVE_ZOOM_NOW },
);
const layout = computePlanLayout(plan.rows);
const eligible = plan.eligibleStepIds;

const bandOf = (key) => layout.bands.find((b) => initiativeCycleKey(b) === key);
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

describe('initiativeCycleKey', () => {
    it('is the initiative id where there is one', () => {
        expect(initiativeCycleKey(LAUNCH_BAND)).toBe(11);
    });

    // The "No initiative" band is a real, clickable, focusable band (req #3204), and
    // its key is null — which is a legal Map key but not a legal `data-testid`
    // and not what `placeInitiativeChips` publishes. One expression, in one module.
    // THE MIRROR, ASSERTED (code review). `placeInitiativeChips` writes the same
    // expression inline in the layout module — this one does not replace it, so
    // nothing but this case stops the two drifting. A mismatch would be silent
    // and total: every `nextLaunchByInitiative.get(e.key)` would miss, so no chip
    // would ever name its step and no second click would ever reach one.
    it('matches the key `placeInitiativeChips` publishes, band for band', () => {
        const chips = placeInitiativeChips({
            bands: layout.bands,
            transform: { x: 0, y: 0, k: 1 },
            viewport: { w: 2000, h: 2000 },
            worldWidth: layout.width,
        });
        expect(chips.length).toBeGreaterThan(0);
        for (const chip of chips) expect(chip.key).toBe(initiativeCycleKey(chip.band));
    });

    it("names the 'No initiative' band rather than rejecting it", () => {
        expect(DONE_BAND.key).toBeNull();
        expect(initiativeCycleKey(DONE_BAND)).toBe('none');
        expect(initiativeCycleKey(null)).toBe('none');
        expect(initiativeCycleKey(undefined)).toBe('none');
        expect(initiativeCycleKey({})).toBe('none');
    });
});

describe('initiativeZoomStateKey', () => {
    // `PipelineDetail` renders on a route PARAMETER, so moving between plans
    // re-renders rather than remounts and a ref survives the move. An initiative
    // seated in two plans must not carry its level across (code review).
    it('separates the same initiative seated in two plans', () => {
        expect(initiativeZoomStateKey(2, LAUNCH_BAND)).not.toBe(initiativeZoomStateKey(7, LAUNCH_BAND));
    });

    it('is stable for the same (plan, band), and names an id-less plan', () => {
        expect(initiativeZoomStateKey(2, LAUNCH_BAND)).toBe(initiativeZoomStateKey(2, LAUNCH_BAND));
        expect(initiativeZoomStateKey(null, DONE_BAND)).toBe('none:none');
        expect(initiativeZoomStateKey(undefined, LAUNCH_BAND)).toBe('none:11');
    });

    // Two bands of ONE plan must still be distinct, or the reset rule (item 2)
    // would silently stop resetting.
    it('separates two bands of the same plan', () => {
        expect(initiativeZoomStateKey(2, LAUNCH_BAND)).not.toBe(initiativeZoomStateKey(2, SOLO_BAND));
        expect(initiativeZoomStateKey(2, SOLO_BAND)).not.toBe(initiativeZoomStateKey(2, DONE_BAND));
    });
});

describe('initiativeWorkStepIds — what a second click frames (req #3365)', () => {
    // ACTIVE AND PENDING: every step of the band the plan has not finished.
    it('is every unfinished step of the band, in display order', () => {
        const ids = initiativeWorkStepIds(plan.rows, layout, LAUNCH_BAND);
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
        const forward = initiativeWorkStepIds(plan.rows, layout, LAUNCH_BAND);
        const backward = initiativeWorkStepIds(reversed, layout, LAUNCH_BAND);
        expect(backward).toEqual([...forward].reverse());
    });

    // ELIGIBILITY IS NOT THE PREDICATE, and that is the whole change. A band
    // whose work is blocked or already running has nothing eligible — which is
    // why the old second click did nothing there — and still has work to frame.
    it('frames work that is not eligible, and work that is suppressed', () => {
        const held = plan.rows.map((r) => ({ ...r, launchSuppressed: true }));
        expect(initiativeWorkStepIds(held, layout, LAUNCH_BAND))
            .toEqual(initiativeWorkStepIds(plan.rows, layout, LAUNCH_BAND));
    });

    it('is empty for a band with nothing left to do', () => {
        expect(initiativeWorkStepIds(plan.rows, layout, DONE_BAND)).toEqual([]);
    });

    it('is the single step of a one-step band while that step is unfinished', () => {
        const ids = initiativeWorkStepIds(plan.rows, layout, SOLO_BAND);
        expect(ids).toEqual([SOLO_BAND.stepIds[0]]);
    });

    // A DRAWN BEAD is the gate: the thing being framed is the bead, and a step
    // absent from this layout has no rectangle to fit.
    it('skips a step that is not on this layout', () => {
        const empty = computePlanLayout([]);
        expect(initiativeWorkStepIds(plan.rows, empty, LAUNCH_BAND)).toEqual([]);
    });

    it('is empty on unusable input rather than throwing', () => {
        expect(initiativeWorkStepIds([], layout, LAUNCH_BAND)).toEqual([]);
        expect(initiativeWorkStepIds(null, layout, LAUNCH_BAND)).toEqual([]);
        expect(initiativeWorkStepIds(plan.rows, null, LAUNCH_BAND)).toEqual([]);
        expect(initiativeWorkStepIds(plan.rows, layout, null)).toEqual([]);
        expect(initiativeWorkStepIds(plan.rows, layout, { stepIds: [] })).toEqual([]);
    });
});

describe('nextInitiativeZoom — the cycle', () => {
    it('starts at the work (req #3681)', () => {
        expect(nextInitiativeZoom(null, 11, true)).toBe(INITIATIVE_ZOOM_STEP);
    });

    it('goes step → band → step on the same initiative', () => {
        let state = null;
        const click = (key, hasStep) => {
            const next = nextInitiativeZoom(state, key, hasStep);
            state = { key, level: next };
            return next;
        };
        expect(click(11, true)).toBe(INITIATIVE_ZOOM_STEP);
        expect(click(11, true)).toBe(INITIATIVE_ZOOM_BAND);
        expect(click(11, true)).toBe(INITIATIVE_ZOOM_STEP);
        expect(click(11, true)).toBe(INITIATIVE_ZOOM_BAND);
    });

    // Requirement item 2. The state is per-initiative: a reader who has drilled into
    // initiative 11's next launch and clicks initiative 12 is asking where 12 is, not what
    // it launches next.
    it('resets to the work on a different initiative', () => {
        expect(nextInitiativeZoom({ key: 11, level: INITIATIVE_ZOOM_BAND }, 12, true))
            .toBe(INITIATIVE_ZOOM_STEP);
        expect(nextInitiativeZoom({ key: 11, level: INITIATIVE_ZOOM_STEP }, 'none', true))
            .toBe(INITIATIVE_ZOOM_STEP);
    });

    // Requirement item 4. A `?initiative=` landing leaves the reader at band focus and
    // seeds exactly this state, so their FIRST manual click on that name goes
    // one level deeper instead of re-fitting the band already on screen.
    it('treats a deep-link landing as click 1', () => {
        const seeded = { key: 11, level: INITIATIVE_ZOOM_BAND };
        expect(nextInitiativeZoom(seeded, 11, true)).toBe(INITIATIVE_ZOOM_STEP);
    });

    // Requirement item 6, and THE REGRESSION THIS RULE EXISTS TO PREVENT (code
    // review of req #3297). The first cut returned a third "do nothing" answer
    // here, which made the initiative name a ONE-SHOT control on every band with no
    // second stop — and it went dead for the rest of the visit. A level that
    // does not exist takes nothing away from the level below it: the control
    // keeps doing exactly what req #3204 made it do.
    it('keeps fitting the band, forever, when there is no next launch step', () => {
        let state = null;
        for (let n = 0; n < 5; n++) {
            const next = nextInitiativeZoom(state, 'none', false);
            expect(next).toBe(INITIATIVE_ZOOM_BAND);
            state = { key: 'none', level: next };
        }
    });

    // AND THE NO-OP IS A TRUE NO-OP: the level the cycle reports is the level
    // it was already on, so nothing about the control's state changes.
    it('leaves the state exactly as it was on a band with no second stop', () => {
        const state = { key: 'none', level: INITIATIVE_ZOOM_BAND };
        expect(nextInitiativeZoom(state, 'none', false)).toBe(state.level);
    });

    it('still lets a band with no second stop be focused for the first time', () => {
        expect(nextInitiativeZoom(null, 'none', false)).toBe(INITIATIVE_ZOOM_BAND);
        expect(nextInitiativeZoom({ key: 11, level: INITIATIVE_ZOOM_STEP }, 'none', false))
            .toBe(INITIATIVE_ZOOM_BAND);
    });

    // The way back out never depends on there being a next step — a reader
    // parked at level 2 must be able to leave whatever the plan has since
    // become.
    it('returns to the band from the step even if the step has vanished', () => {
        expect(nextInitiativeZoom({ key: 11, level: INITIATIVE_ZOOM_STEP }, 11, false))
            .toBe(INITIATIVE_ZOOM_BAND);
    });
});

describe('gestureMovedCamera — the reader taking the camera, vs click jitter', () => {
    const at = (x, y, k = 1) => ({ x, y, k });

    // THE DEFECT THIS EXISTS FOR: the initiative chip is a descendant of the element
    // d3-zoom is bound to, so a mousedown on the NAME starts a pan and every
    // pixel of hand-jitter inside the click emits a real zoom event that
    // translates the world. Clearing the cycle on any of those would break the
    // band → step move for anyone whose hand moves — intermittently, which is
    // worse than not working at all.
    it('is false for the jitter inside a click', () => {
        expect(gestureMovedCamera(at(100, 100), at(100, 100))).toBe(false);
        expect(gestureMovedCamera(at(100, 100), at(103, 103))).toBe(false);
        expect(gestureMovedCamera(at(100, 100), at(100 + INITIATIVE_ZOOM_CLICK_SLOP, 100)))
            .toBe(false);
    });

    it('is true for a pan past the slop', () => {
        expect(gestureMovedCamera(at(100, 100), at(100 + INITIATIVE_ZOOM_CLICK_SLOP + 1, 100)))
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
        // req #3365 re-pointed level 2 from ONE launch step to the initiative's
        // unfinished work, so the promise names the SUBJECT rather than a step
        // id — a control that named one step while framing nine would be worse
        // than one that names none.
        expect(initiativeZoomHint([4, 5, 6]))
            .toBe('Zoom pipeline initiative — click again to toggle unfinished work / whole initiative');
        expect(initiativeZoomHintSuffix([71]))
            .toBe(' — click again to toggle unfinished work / whole initiative');
    });

    it('promises no zoom that cannot happen', () => {
        expect(initiativeZoomHint([])).toBe('Zoom pipeline initiative');
        expect(initiativeZoomHint(null)).toBe('Zoom pipeline initiative');
        expect(initiativeZoomHint(undefined)).toBe('Zoom pipeline initiative');
        expect(initiativeZoomHintSuffix(null)).toBe('');
    });

    // The falsy-id hazard the id-based suffix had is GONE with the id — what
    // replaced it is a COUNT, where 0 legitimately means "nothing to frame".
    // Pinned because the two look alike and the guard is the opposite one: an
    // empty list must say nothing, and anything that is not a list must too.
    it('says nothing for an empty or malformed work list', () => {
        expect(initiativeZoomHintSuffix([])).toBe('');
        expect(initiativeZoomHintSuffix(null)).toBe('');
        expect(initiativeZoomHintSuffix(undefined)).toBe('');
        expect(initiativeZoomHintSuffix(7)).toBe('');
    });

    // The promise and the behaviour read the SAME lookup, so a band that has a
    // second stop always announces one and a band that does not never can.
    it('agrees with the selector on every band of the plan', () => {
        for (const band of layout.bands) {
            const workIds = initiativeWorkStepIds(plan.rows, layout, band);
            const announced = initiativeZoomHint(workIds).includes('click again');
            expect(announced).toBe(workIds.length > 0);
        }
    });
});

// req #3373 — the met/total suffix's denominator, named on hover.
describe('initiativeSeatedHint — the count is requirements SEATED, not by feature', () => {
    it('names the denominator only when a count is actually showing', () => {
        expect(initiativeSeatedHint(true))
            .toBe(' — the count is requirements seated under this initiative');
    });

    it('says nothing when there is no count to explain', () => {
        expect(initiativeSeatedHint(false)).toBe('');
    });
});
