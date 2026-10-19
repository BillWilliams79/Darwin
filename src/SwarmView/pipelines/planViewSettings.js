// planViewSettings.js — every remembered setting of the plan page, in ONE table
// (req #3651).
//
// THE DEFECT THIS EXISTS FOR. The colour key's +/− was component state, so every
// way of leaving the canvas — the Plan|Table toggle, a step card into the Table
// and Back, a requirement and "Back to Plan", a reload — re-mounted it collapsed:
// *"I had popped out the text color help at the bottom and it closed that on
// me. let's keep that setting and all the UI popout/popin settings for all
// these transitions."* The unseated box's list and the Table's Time / Tokens
// toggle had the same shape. Meanwhile the colour scale, the level and the Step
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
// still opens the key collapsed (req #3633).

import { useCallback, useRef } from 'react';

import { useViewPreference } from '../../hooks/useViewPreference';
import {
    DEFAULT_COLOR_KEY, DEFAULT_PLAN_LEVEL_PREF, DEFAULT_STEP_WIDTH_LEVEL,
} from './pipelinePlanLayout';

// `flag` settings are booleans stored as '1' / '0'; `value` settings are the
// strings their consumer validates (each consumer normalizes — the value came
// out of web storage).
export const PLAN_VIEW_SETTINGS = Object.freeze({
    // ── View preferences (each predates this table; keys unchanged so every
    //    stored choice survives the move) ───────────────────────────────────
    colorKey: { kind: 'value', storageKey: 'darwin-pipeline-viz-color-key',
        default: DEFAULT_COLOR_KEY },
    stepWidth: { kind: 'value', storageKey: 'darwin-pipeline-viz-step-width',
        default: String(DEFAULT_STEP_WIDTH_LEVEL) },
    level: { kind: 'value', storageKey: 'darwin-pipeline-viz-level',
        default: DEFAULT_PLAN_LEVEL_PREF },
    // ── Popouts (req #3651 — were component state, reset on every mount) ───
    // The canvas's colour key: collapsed until the reader opens it (req #3633).
    keyOpen: { kind: 'flag', storageKey: 'darwin-pipeline-viz-key-open', default: false },
    // The swarm-ready, not-orchestrated box's list: open, it exists to be seen
    // next to the plan it feeds (req #3583).
    unseatedOpen: { kind: 'flag', storageKey: 'darwin-pipeline-viz-unseated-open',
        default: true },
    // The Table's Time / Tokens columns: off until asked for (req #3117).
    showCost: { kind: 'flag', storageKey: 'darwin-pipeline-show-cost', default: false },
    // The header's ONE fold for both modes' options (req #3650). Persisted from
    // the day it shipped, as 'open' / 'collapsed' — `on`/`off` keep that
    // encoding so every stored choice reads back unchanged.
    controlsOpen: { kind: 'flag', storageKey: 'darwin-swarm-pipeline-detail-controls',
        default: true, on: 'open', off: 'collapsed' },
});

// A flag is stored as its `on` / `off` string ('1' / '0' unless the row names
// its own). Decoding is anchored on the DEFAULT: only the opposite state's
// exact string flips it, so anything unrecognised in storage reads as default.
const onOf = (def) => def.on ?? '1';
const offOf = (def) => def.off ?? '0';
const encode = (def, v) => (def.kind === 'flag' ? (v ? onOf(def) : offOf(def)) : v);
const decode = (def, raw) => {
    if (def.kind !== 'flag') return raw;
    return def.default ? raw !== offOf(def) : raw === onOf(def);
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
