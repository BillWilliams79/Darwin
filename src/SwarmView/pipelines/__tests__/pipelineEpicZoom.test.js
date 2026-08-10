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

// req #3462 (production outage) restored `orderedPlan` to pipelineViewModel.js
// itself, so the req #3381 workaround this file used — importing
// `buildTestOrderedPlan as orderedPlan` from the now-deleted `testOrderedPlan.js`
// shim — is gone with it; import the real thing again.
import { buildPipelineModel, orderedPlan } from '../pipelineViewModel';
import { computePlanLayout, placeEpicChips } from '../pipelinePlanLayout';
import {
    epicCycleKey, epicZoomStateKey, nextLaunchStep, nextEpicZoom,
    epicZoomHint, epicZoomHintSuffix, gestureMovedCamera, EPIC_ZOOM_CLICK_SLOP,
    EPIC_ZOOM_BAND, EPIC_ZOOM_STEP,
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

describe('nextLaunchStep — which step a second click goes to', () => {
    // "Earliest in DISPLAY ORDER", never a re-sort and never the lowest id:
    // `displayOrder` is design rule 3's output, so the first eligible row of a
    // band IS the next thing that band launches.
    it('is the eligible step earliest in display order within the band', () => {
        const first = plan.rows.find((r) => LAUNCH_BAND.stepIds.includes(r.id)
            && eligible.has(r.id));
        expect(nextLaunchStep(plan.rows, layout, LAUNCH_BAND, eligible)).toBe(first.id);
    });

    // THE ORDERING IS THE POINT, and an id sort could pass the case above by
    // luck. Feeding the same rows in a DIFFERENT order must move the answer.
    it('reads the row order it is given, never a sort of the ids', () => {
        const reversed = [...plan.rows].reverse();
        const forward = nextLaunchStep(plan.rows, layout, LAUNCH_BAND, eligible);
        const backward = nextLaunchStep(reversed, layout, LAUNCH_BAND, eligible);
        expect(backward).not.toBe(forward);
        expect(LAUNCH_BAND.stepIds).toContain(backward);
    });

    it('is the single step of a one-step band when that step is eligible', () => {
        expect(nextLaunchStep(plan.rows, layout, SOLO_BAND, eligible))
            .toBe(SOLO_BAND.stepIds[0]);
    });

    // Requirement item 6, first half: a band with nothing eligible has no
    // second stop, and must say so rather than hand back a step whose fit would
    // put the reader somewhere they did not ask to go.
    it('is null for a band with no eligible step', () => {
        expect(nextLaunchStep(plan.rows, layout, DONE_BAND, eligible)).toBeNull();
    });

    // req #3223 keeps "eligible" and "will actually launch" apart on purpose: a
    // paused scope's steps stay eligible and are HELD. Naming a held step as
    // the next launch would promise a launch the plan is holding.
    it('skips a suppressed step and takes the next eligible one', () => {
        const inBand = plan.rows.filter((r) => LAUNCH_BAND.stepIds.includes(r.id)
            && eligible.has(r.id));
        expect(inBand.length).toBeGreaterThan(1);
        const held = plan.rows.map((r) => (r.id === inBand[0].id
            ? { ...r, launchSuppressed: true } : r));
        expect(nextLaunchStep(held, layout, LAUNCH_BAND, eligible)).toBe(inBand[1].id);
    });

    it('is null when every eligible step of the band is suppressed', () => {
        const held = plan.rows.map((r) => ({ ...r, launchSuppressed: true }));
        expect(nextLaunchStep(held, layout, LAUNCH_BAND, eligible)).toBeNull();
    });

    // A DRAWN BEAD is the gate: the thing being zoomed to is the bead, and a
    // step absent from this layout has no rectangle to fit.
    it('is null when the eligible step is not on this layout', () => {
        const empty = computePlanLayout([]);
        expect(nextLaunchStep(plan.rows, empty, LAUNCH_BAND, eligible)).toBeNull();
    });

    it('is null on empty or unusable input rather than throwing', () => {
        expect(nextLaunchStep([], layout, LAUNCH_BAND, eligible)).toBeNull();
        expect(nextLaunchStep(null, layout, LAUNCH_BAND, eligible)).toBeNull();
        expect(nextLaunchStep(plan.rows, null, LAUNCH_BAND, eligible)).toBeNull();
        expect(nextLaunchStep(plan.rows, layout, null, eligible)).toBeNull();
        expect(nextLaunchStep(plan.rows, layout, { stepIds: [] }, eligible)).toBeNull();
        // No eligibility set is not a licence to guess: nothing was read that
        // said any of these steps can launch.
        expect(nextLaunchStep(plan.rows, layout, LAUNCH_BAND, new Set())).toBeNull();
        expect(nextLaunchStep(plan.rows, layout, LAUNCH_BAND, null)).toBeNull();
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
    it('names the second stop, and the step it will go to', () => {
        expect(epicZoomHint(4)).toBe('Zoom pipeline epic — click again for launch step 4');
        expect(epicZoomHintSuffix(71)).toBe(' — click again for launch step 71');
    });

    it('promises no zoom that cannot happen', () => {
        expect(epicZoomHint(null)).toBe('Zoom pipeline epic');
        expect(epicZoomHint(undefined)).toBe('Zoom pipeline epic');
        expect(epicZoomHintSuffix(null)).toBe('');
    });

    // A step id of 0 is not a legal `pipeline_steps.id`, but `stepId ? …` would
    // silently drop it and the suffix would promise nothing while the click
    // still moved. Guarded on `!= null` for that reason, and pinned here so a
    // "simplification" back to a truthiness check fails.
    it('announces a falsy-but-real step id rather than swallowing it', () => {
        expect(epicZoomHintSuffix(0)).toBe(' — click again for launch step 0');
    });

    // The promise and the behaviour read the SAME lookup, so a band that has a
    // second stop always announces one and a band that does not never can.
    it('agrees with the selector on every band of the plan', () => {
        for (const band of layout.bands) {
            const stepId = nextLaunchStep(plan.rows, layout, band, eligible);
            const announced = epicZoomHint(stepId).includes('click again');
            expect(announced).toBe(stepId != null);
            if (stepId != null) expect(epicZoomHint(stepId)).toContain(String(stepId));
        }
    });
});
