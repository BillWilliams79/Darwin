// planViewSettings.js — every remembered setting of the plan page, in ONE table
// (req #3651).
//
// THE DEFECT THIS EXISTS FOR. The colour key's +/− (a bottom panel until req
// #3722 made it a popup, which is not remembered) was component state, so every
// way of leaving the canvas — the Plan|Table toggle, an epic card into the Table
// and Back, a requirement and "Back to Plan", a reload — re-mounted it collapsed:
// *"I had popped out the text color help at the bottom and it closed that on
// me. let's keep that setting and all the UI popout/popin settings for all
// these transitions."* The unseated box's list and the Table's Time / Tokens
// toggle had the same shape. Meanwhile the colour scale, the level and the Epic
// Width each called `useViewPreference` with a key and a default spelled at the
// call site. Two kinds of setting, one fact about both: a reader's choice about
// how this page looks, which every transition must hand back unchanged.
//
// SO THEY ARE ONE DEFINITION EACH, HERE. A new popout is one row below and a
// `usePlanViewSetting('<name>')` at its site — no storage key, no default and no
// boolean encoding spelled anywhere else, and nothing to enumerate per
// transition: the setting is read when the component mounts, which is where
// every transition arrives.
//
// WHAT DOES NOT BELONG HERE:
//   · the Table|Plan MODE — `pipelineDetailModes.js` owns its key and default
//     because it owns the vocabulary the value is validated against;
//   · the CAMERA and the table SCROLL — a position in one artifact, not a way of
//     looking at every plan (`utils/viewportMemory.js` says why that differs);
//   · the unseated box's dragged POSITION — `UnorchestratedReqBox` has stored it
//     since req #3608 as a JSON record, which a string preference cannot carry.
//
// Storage is `useViewPreference`'s (per-tab, seeded from localStorage for a new
// tab), so a popout behaves exactly like the colour scale beside it. Defaults
// are the ones each control had as local state, so a reader who never touched
// one sees nothing change — and an E2E run, which starts with empty storage,
// still opens the unseated list as before.

import { useCallback, useRef } from 'react';

import { useViewPreference } from '../../hooks/useViewPreference';
import {
    DEFAULT_COLOR_KEY, DEFAULT_PLAN_LEVEL_PREF, DEFAULT_PLAN_EPIC_WIDTH,
} from './pipelinePlanLayout';

// `flag` settings are booleans stored as '1' / '0'; `value` settings are the
// strings their consumer validates (each consumer normalizes — the value came
// out of web storage).
export const PLAN_VIEW_SETTINGS = Object.freeze({
    // ── View preferences (each predates this table; keys unchanged so every
    //    stored choice survives the move) ───────────────────────────────────
    colorKey: { kind: 'value', storageKey: 'darwin-pipeline-viz-color-key',
        default: DEFAULT_COLOR_KEY },
    // A NEW key since req #3648: the value is now a rung in quarters of the
    // base card (6 5 4 3), and a level stored under the old key (1-4, where 1
    // was the base card) would read as a different width.
    epicWidth: { kind: 'value', storageKey: 'darwin-pipeline-viz-epic-width-q',
        default: String(DEFAULT_PLAN_EPIC_WIDTH) },
    level: { kind: 'value', storageKey: 'darwin-pipeline-viz-level',
        default: DEFAULT_PLAN_LEVEL_PREF },
    // req #3686 — the plan's closed requirements (met / deferred / wontfix),
    // and the dashed line above them, hidden from every epic card. Off until asked for.
    hideClosed: { kind: 'flag', storageKey: 'darwin-pipeline-viz-hide-closed', default: false },
    // req #3708 — the machines the reader has DESELECTED in the toolbar's
    // machine filter, as `planMachineFilter.js` encodes them. Nothing hidden
    // until asked for.
    hiddenMachines: { kind: 'value', storageKey: 'darwin-pipeline-viz-hidden-machines',
        default: '' },
    // ── Popouts (req #3651 — were component state, reset on every mount) ───
    // (The canvas's colour key had a row here until req #3722 turned it into a
    // button-local popup: an open popup is transient, not a remembered choice.)
    // The swarm-ready, not-orchestrated box's list: open, it exists to be seen
    // next to the plan it feeds (req #3583).
    unseatedOpen: { kind: 'flag', storageKey: 'darwin-pipeline-viz-unseated-open',
        default: true },
    // The Table's Time / Tokens columns: off until asked for (req #3117).
    showCost: { kind: 'flag', storageKey: 'darwin-pipeline-show-cost', default: false },
    // The initiative bands and epic cards folded by their own collapse heads (req
    // #3650): a list of tokens `planCollapse.js` owns. Nothing folded until the
    // reader folds it.
    collapsed: { kind: 'value', storageKey: 'darwin-pipeline-viz-collapsed-v2', default: '' },
});

// A flag is stored as '1' / '0'. Decoding is anchored on the DEFAULT: only the
// opposite state's exact string flips it, so anything unrecognised in storage
// reads as default.
const encode = (def, v) => (def.kind === 'flag' ? (v ? '1' : '0') : v);
const decode = (def, raw) => {
    if (def.kind !== 'flag') return raw;
    return def.default ? raw !== '0' : raw === '1';
};

/**
 * One remembered setting of the plan page, by its name in `PLAN_VIEW_SETTINGS`.
 *
 * @param {keyof PLAN_VIEW_SETTINGS} name
 * @returns {[any, function(any | function(any): any): void]} the value (a
 *   boolean for a flag) and a setter that also takes an updater, so a toggle is
 *   `set((v) => !v)` exactly as it was with `useState`.
 */
export function usePlanViewSetting(name) {
    const def = PLAN_VIEW_SETTINGS[name];
    if (!def) throw new Error(`usePlanViewSetting: unknown setting "${name}"`);
    const [raw, setRaw] = useViewPreference(def.storageKey, encode(def, def.default));
    const value = decode(def, raw);
    // The LATEST value, not this render's: `useViewPreference`'s setter takes a
    // value, so an updater must be resolved here — and two in one batch must
    // compose, as they would with `useState`. Also keeps `set` identity-stable.
    const latestRef = useRef(value);
    latestRef.current = value;
    const set = useCallback((next) => {
        const v = typeof next === 'function' ? next(latestRef.current) : next;
        if (v === null || v === undefined) return;
        latestRef.current = v;
        setRaw(encode(def, v));
    }, [def, setRaw]);
    return [value, set];
}
