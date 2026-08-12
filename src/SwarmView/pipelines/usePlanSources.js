// usePlanSources.js — the plan page's fetch head (req #3463; collapsed to ONE
// head by req #3356).
//
// ── WHAT THIS FILE IS ──────────────────────────────────────────────────────
// `PipelineDetail.jsx` renders one plan. Everything below its header — the
// table, the visualizer, the toolbar, the deep-link handshakes — consumes four
// values and nothing else:
//
//     { pipeline, model, plan, diagnostic }
//
// How those four are OBTAINED was entirely different in the two eras, and that
// difference was the whole of this file:
//
//   1.0  SEVEN bounded list reads (pipelines, steps, step requirements, step
//        deps, requirements, features, epics) joined and derived IN THE BROWSER.
//   2.0  ONE composed read (`pipeline2_compose`, req #3367) — the join AND the
//        derivation both already ran server-side — reshaped by
//        `pipeline2Adapter.js`.
//
// ── WHAT req #3356 REMOVED, AND WHY THE DISPATCHER WENT WITH IT ────────────
// Pipeline 1.0 is eradicated, so `usePlan1Sources` and its seven-hook fetch head
// are deleted outright and `usePlanSources(era, …)` is deleted with them. The
// dispatcher existed only to pick between two heads while both eras were live —
// it called BOTH unconditionally (React's rules of hooks forbid calling one
// conditionally) and disabled the inactive one at the query layer. With one head
// left, that machinery is pure cost: `PipelineDetail.jsx` calls
// `usePlan2Sources` directly.
//
// A one-line `usePlanSources` wrapper was considered and rejected — it would be
// a second name for one function, and the next reader would have to establish
// that the two are the same thing before trusting either.
//
// NOTE FOR THE READER CHASING req #3462: the outage that produced this file was
// #3381 re-pointing the 1.0 ROUTE at the 2.0 read while every surface producing
// ids was still 1.0. That failure is now structurally unreachable — there is one
// id space, one table and one route.

import { useMemo } from 'react';

import {
    useAllPipelines2,
    useComposedPipeline2,
} from '../../hooks/useDataQueries';
import {
    adaptComposedPipeline2,
    buildPlan2Model,
    deriveDiagnostic,
} from './pipeline2Adapter';

// A SHARED frozen empty array, for the same reason `PipelineDetail.jsx` keeps
// one: a `= []` default literal mints a NEW array on every render, which is a
// new dependency identity for every memo downstream of it.
const EMPTY = Object.freeze([]);

/**
 * Pipeline 2.0's fetch head — ONE composed read, reshaped.
 *
 * @param {?number} pipelineId
 * @param {?string} creatorFk
 * @param {{enabled?: boolean, machines?: Array, costIndex?: Object}} options
 * @returns {{pipeline: ?Object, model: ?Object, plan: ?Object,
 *            diagnostic: ?Object, isLoading: boolean, dictionaryError: boolean,
 *            knownIds: ?Array<number>}}
 */
export function usePlan2Sources(pipelineId, creatorFk,
    { enabled = true, machines = EMPTY, costIndex } = {}) {
    const { data: composed, isLoading: composedLoading } =
        useComposedPipeline2(pipelineId, { enabled });

    // req #3463 Guard B — the 2.0 plan INDEX, and it is fetched ONLY on the
    // miss path. This is the read that would have made req #3462 visible during
    // its own verification: #3381's dev server hit the composed route 80 times
    // against an EMPTY `darwin_dev.pipeline2_pipelines` and every 404 rendered
    // as a tidy "No pipeline with id 79", indistinguishable from a plan that had
    // simply been deleted. With this, an empty table says so in as many words.
    //
    // `composed === null` is precisely the 404 (`useComposedPipeline2` maps it);
    // `undefined` is still loading and must not fire a second request.
    //
    // AND IT IS GATED ON `isSuccess` (code review), for the reason the alert
    // itself gives: while this read is in flight `data` is undefined, the
    // `= EMPTY` default makes it `[]`, and `[]` is the value that renders "this
    // table holds NO plans at all". That sentence would then appear on EVERY
    // 2.0 miss for the length of one round trip, and permanently if the read
    // 5xxes — a confident false claim about the data, which is worse than the
    // uninformative message this whole guard replaced.
    const missed = enabled && composed === null;
    const { data: known = EMPTY, isSuccess: knownSettled } =
        useAllPipelines2(creatorFk, { enabled: missed });

    const isLoading = enabled && composedLoading;

    // req #3381 item 3 — A WITHHELD OR DEGRADED `derived` BLOCK IS A HARD STOP,
    // NOT AN EMPTY RENDER. `null` (nothing withheld) means proceed; any other
    // value is one of the four regimes (`derivation_failed` /
    // `budget_derived_only` / `budget_rows_truncated` / wholly absent) and the
    // page renders it as a diagnostic INSTEAD OF attempting a partial draw from
    // rows with no derived state.
    const diagnostic = useMemo(
        () => (enabled && composed ? deriveDiagnostic(composed) : null),
        [enabled, composed]);

    const pipeline = enabled ? (composed?.pipeline ?? null) : null;
    const canBuild = !!pipeline && !diagnostic;

    const model = useMemo(
        () => (canBuild ? buildPlan2Model(composed, machines) : null),
        [canBuild, composed, machines]);

    const plan = useMemo(
        () => (canBuild ? adaptComposedPipeline2(composed, { machines, costIndex }) : null),
        [canBuild, composed, machines, costIndex]);

    const knownIds = useMemo(
        () => (missed && knownSettled ? known.map((p) => p.id) : null),
        [missed, knownSettled, known]);

    return {
        pipeline,
        model,
        plan,
        diagnostic,
        isLoading,
        // The composed payload carries its own epic labels, so the dictionary
        // failure 1.0's browser-side join could suffer cannot happen here. The
        // page's `machines` read is separate and is reported by the page itself.
        // Kept as an explicit `false` rather than omitted: the page destructures
        // this field, and an absent key would read as `undefined` at a gate that
        // means "a label dictionary failed".
        dictionaryError: false,
        knownIds,
    };
}
