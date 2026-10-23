// pipelineEpicLink.js — the addressable-epic contract (req #3140).
//
// ONE epic of a plan, named by URL: `<plan detail route>?mode=plan&epic=<sid>`
// (`epicPlanLinkTo`, which also pins the level).
// The route half comes from `planEra.js` (2.0 by default since req #3356);
// this module owns the `?epic=` / `?level=` half.
//
// WHY BOTH HALVES LIVE IN ONE MODULE. The writer is the Epics editor
// (`src/Epics/EpicsPage.jsx`) and the reader is the plan page
// (`PipelineDetail.jsx`) — two files in two directories that must agree on a
// query-string key exactly. A builder in one and a `searchParams.get('epic')` in
// the other is a contract with no single definition, and the failure mode is a
// link that navigates to the right plan and silently highlights nothing. Putting
// the key in one place makes a rename a compile-time-shaped edit rather than a
// grep.
//
// The link seeds `focusEpicId`, and the plan visualizer centres and zooms on
// that epic (req #3253's handshake). A second builder, `epicLinkTo`, named
// `mode=table&epic=` — the Table scrolled to and highlighted the epic's ROW,
// and a bead click pushed that link to get there. Req #3641 withdrew the Table
// (user directive: the visualizer is the only way to look at a pipeline), the
// canvas now frames a clicked epic itself, and `epicLinkTo` was deleted with
// its only caller; restoring the Table means restoring it from git too. Both
// parameters seed a TRANSIENT override — a link asks to see one thing once and
// must never rewrite the reader's own default view (the `normalizeView`
// doctrine).
//
// NO JSX and no React: a pure module vitest can exercise without a DOM, and a
// component file with non-component exports drops out of Fast Refresh (the
// instructionSort.js lesson).

// ONE import, and it is the level VOCABULARY (req #3253). `readLevelParam`
// below validates address-bar text against the set of levels the canvas
// actually defines, and a local copy of that set is the drift this file's whole
// design exists to prevent — it owns both halves of a contract precisely so the
// writer and the reader cannot disagree. The module's "no JSX, no React" rule is
// unaffected: `pipelinePlanLayout` is pure arithmetic with one import of its
// own (`pipelineModel`), so this file still runs under vitest with no DOM, which
// its own test suite exercises.
import { isColorKey, isPlanLevelPref } from './pipelinePlanLayout';
// TWO imports now (req #3463). The route itself is no longer this module's to
// spell: `planEra.js` owns the era↔route binding, and a builder here that
// interpolated the plan route directly is exactly what let a 2.0 id reach a
// 1.0 route in production. This module still owns the QUERY-STRING half of the
// contract — which is what it was always for — and asks planEra for the path.
//
// ── THERE IS NO ERA TO CHOOSE (req #3356) ──────────────────────────────────
// These builders briefly took an `era` argument, defaulting to 2.0 while both
// plan surfaces stood: the producer of the ids `epicPlanLinkTo` receives
// (`useOrchestrationIndex`, the requirement page's Orchestration box) was
// already 2.0, so defaulting to 1.0 would have put a 2.0 id on a 1.0 route —
// req #3462, the outage `planEra.js` exists to prevent, arriving through the
// one door it left open.
//
// Pipeline 1.0 is eradicated, so the argument is GONE rather than defaulted. A
// surviving one would be a way to ask for a route that does not exist, which is
// the same failure wearing a parameter.
import { planDetailPath } from './planEra';

export const FOCUS_EPIC_PARAM = 'epic';

// ── The SAME epic, seen on the PLAN instead of in the table (req #3253) ──────
// The requirement page's "view on plan" link used to name the whole INITIATIVE, and
// `?initiative=` fits the entire band — which on a large initiative IS a zoomed-out view.
// The link means "show me where this requirement lives", so it names the EPIC.
//
// The SAME `?epic=` parameter the Table's `epicLinkTo` used — deliberately not
// a third landing mode — with `mode=plan` and a `?level=` pin. (`epicLinkTo`
// went with the Table in req #3641.)
export const FOCUS_LEVEL_PARAM = 'level';
// L3 — `PLAN_LEVEL_BY_PREF['3'] === 'in'`. Written as the PREF value the page
// already speaks rather than the canvas's 'in', because that is what the
// receiving `levelPref` state holds and what `normalizePlanLevelPref` validates.
//
// IT WAS L2 UNTIL REQ #3498, AND THE REASON EXPIRED RATHER THAN BEING OVERRULED.
// Req #3253 pinned L2 because L3 "would draw every requirement TITLE — an
// unreadable wall of prose at the exact moment the reader wanted to find one
// bead", and on that canvas it was true: a requirement title was a free-floating
// label beside a bead, so N of them at once WAS a wall, with nothing to say which
// title belonged to which epic. #3498 put the requirements INSIDE the epic's
// card — bounded, wrapped, ruled off under the epic's own name — which is the
// entire feature. The titles are now the card's contents rather than prose over
// the plan, and the link lands on the one card the reader asked for at a scale
// where it fills a fifth of the panel (`EPIC_FOCUS_EPICS_ACROSS`).
//
// User directive, 2026-08-13: *"requirement single epic zoom should not be L2
// and be L3 all the details"*.
export const EPIC_PLAN_LINK_LEVEL = '3';

/**
 * The route an epic's location ON THE PLAN links to (req #3253).
 *
 * Null rather than a dead link when either id is unusable (`toId`);
 * the only differences are the mode and the pinned level.
 *
 * @param {?number} pipelineId
 * @param {?number} epicId
 * @param {number} [era] the era `pipelineId` was READ from (req #3463).
 *        Defaults to 2.0 since req #3356 — see the module header.
 * @returns {?string}
 */
export function epicPlanLinkTo(pipelineId, epicId) {
    const sid = toId(epicId);
    if (sid == null) return null;
    return planDetailPath(pipelineId,
        `mode=plan&${FOCUS_EPIC_PARAM}=${sid}`
        + `&${FOCUS_LEVEL_PARAM}=${EPIC_PLAN_LINK_LEVEL}`);
}

/**
 * The semantic-level preference a `?level=` parameter names, or null.
 *
 * VALIDATED against the level vocabulary itself, never trusted — and null on
 * anything unrecognised rather than `normalizePlanLevelPref`'s 'auto', because
 * the two answers differ: 'auto' would PIN the reader to auto and silently
 * discard the level they have stored, while null leaves their stored preference
 * in charge. That is the same rule `?mode=xyz` already follows.
 *
 * @param {{get: function(string): ?string}} searchParams
 * @returns {?string} 'auto' | '1' | '2' | '3'
 */
export function readLevelParam(searchParams) {
    const raw = searchParams && typeof searchParams.get === 'function'
        ? searchParams.get(FOCUS_LEVEL_PARAM) : null;
    return isPlanLevelPref(raw) ? String(raw) : null;
}

// ── `?color=` PICKS THE REQUIREMENT COLOUR KEY FOR ONE LANDING (req #3636) ──
// The colour key was reachable only through the toolbar and localStorage, so no
// link could open the plan on the Session key — the one view where a session
// colour (review's attention red) is compared against every other state. Same
// contract as `?level=`: held transiently, never written to the stored
// preference, and null on an unrecognised value so the stored key stays in
// charge.
export const FOCUS_COLOR_PARAM = 'color';

/**
 * The requirement colour key a `?color=` parameter names, or null.
 *
 * @param {{get: function(string): ?string}} searchParams
 * @returns {?string} one of REQ_COLOR_KEYS
 */
export function readColorParam(searchParams) {
    const raw = searchParams && typeof searchParams.get === 'function'
        ? searchParams.get(FOCUS_COLOR_PARAM) : null;
    return isColorKey(raw) ? raw : null;
}

// NULLISH AND EMPTY ARE REJECTED BEFORE `Number` SEES THEM, which is the whole
// reason this is a function and not an inline `Number.isInteger(Number(x))`:
// `Number(null)` and `Number('')` are both 0, and 0 is a perfectly good integer.
// An epic whose `pipeline_fk` did not resolve would have produced a confident link
// to plan 0 — a plan that does not exist, rendering the page's not-found alert
// as though the data were at fault.
//
// It survives for the EPIC id only (req #3463). The PIPELINE id is normalized
// by `planEra.js::normalizePlanId`, which is this same guard hoisted to the
// module that owns the route — the two must stay identical, and the way to
// guarantee that is for there to be one of them on the path-building side.
function toId(value) {
    if (value == null || value === '') return null;
    const n = Number(value);
    return Number.isInteger(n) ? n : null;
}

/**
 * The epic id a `?epic=` parameter names, or null.
 *
 * VALIDATED, never trusted. The value is user-editable address-bar text handed
 * to a `[data-testid="pipeline-epic-row-<id>"]` selector and compared against
 * `row.id`; `Number('12abc')` is NaN and `Number('')` is 0, and both would
 * produce a focus id that matches no row while suppressing nothing. An id that
 * names no epic in this plan is not an error — the plan simply renders with
 * nothing highlighted, exactly as it does with no parameter at all.
 *
 * Accepts anything with a `.get(key)` — a URLSearchParams, or React Router's
 * wrapper around one — so the reader can be tested without a router.
 *
 * @param {{get: function(string): ?string}} searchParams
 * @returns {?number}
 */
export function readFocusEpicParam(searchParams) {
    const raw = searchParams && typeof searchParams.get === 'function'
        ? searchParams.get(FOCUS_EPIC_PARAM) : null;
    if (raw == null || String(raw).trim() === '') return null;
    const id = Number(raw);
    return Number.isInteger(id) ? id : null;
}

// ── FILING A NEW REQUIREMENT INTO A EPIC (req #3582) ────────────────────────
// An epic's "+" (plan visualizer card, plan table row) opens the requirement
// editor in "new" mode (`/swarm/requirement/new`, req #2414) carrying the epic
// to seat it on. Router STATE, not a query string: like the aggregator
// template's typed title it belongs to one navigation, not to an address a
// reader could bookmark or share. Writer and reader live here
// together for this module's own reason — two files that must agree on a key.
//
// `from`/`pipelineId`/`mode` are the provenance every plan exit already
// carries (req #3119/#3252), so the editor's Back returns to the plan. Back no
// longer re-targets the epic (req #3637): the reader clicked its "+", so it was
// on screen, and the restored camera / table scroll puts them back exactly
// there, where a `?epic=` link would have moved the view. `backEpicId` still
// records which epic it was.
//
// (Router state lives in `history.state`, so a reload of the draft keeps the
// seat — harmless: the draft itself is rebuilt from the same state.)
export const SEAT_EPIC_STATE_KEY = 'seatEpicId';
export const SEAT_EPIC_NAME_STATE_KEY = 'seatEpicName';
export const BACK_EPIC_STATE_KEY = 'backEpicId';
export const BACK_LEVEL_STATE_KEY = 'level';

export function newRequirementSeatState(pipelineId, mode, row) {
    const epicId = Number(row?.id);
    if (!Number.isInteger(epicId) || epicId <= 0) return undefined;
    const state = {
        [SEAT_EPIC_STATE_KEY]: epicId,
        [SEAT_EPIC_NAME_STATE_KEY]: typeof row?.title === 'string' && row.title.trim()
            ? row.title : null,
    };
    if (pipelineId != null) {
        Object.assign(state, planExitState(pipelineId, mode),
            { [BACK_EPIC_STATE_KEY]: epicId });
    }
    return state;
}

// ── THE VIEW A RETURN CARRIES BACK — ONE LIST (req #3651) ──────────────────
// The transient `?…=` overrides that say how an entry LOOKS (never where it is
// focused): a return to the plan must hand each one back, or "Back to Plan"
// lands on a different view than the browser's Back to the same entry would.
// It carried `level` alone (req #3637) and so dropped a `?color=` (req #3636)
// the reader was looking at. A new view param is one row here, and every exit
// and every return reads this list — none spells a param of its own.
// The router-state key IS the param name: `level` is `BACK_LEVEL_STATE_KEY`.
export const PLAN_VIEW_PARAMS = Object.freeze([
    { param: FOCUS_LEVEL_PARAM, isValid: isPlanLevelPref },
    { param: FOCUS_COLOR_PARAM, isValid: isColorKey },
]);

/**
 * The router state every exit from a plan surface carries, so the far page's
 * "Back to Plan" can return to the SAME view (req #3637): the panel, and each
 * `PLAN_VIEW_PARAMS` override the reader was looking at. The camera, the table
 * scroll and the popouts come back from storage on their own — Back goes to the
 * plain plan URL, never to a `?epic=`/`?initiative=` link that would move them.
 *
 * Read off `window.location` at click time, the one place both the plan's own
 * panels and their callers agree on, and validated like the URL itself.
 */
export function planExitState(pipelineId, mode) {
    const state = { from: 'pipeline', pipelineId, mode };
    let params = null;
    try {
        params = new URLSearchParams(window.location.search);
    } catch {
        params = null;
    }
    for (const { param, isValid } of PLAN_VIEW_PARAMS) {
        const v = params?.get(param);
        if (isValid(v)) state[param] = String(v);
    }
    return state;
}

/**
 * The `PLAN_VIEW_PARAMS` entries of a `planExitState` record — what a page that
 * re-writes its own router state (the requirement editor's first save) must
 * forward so its Back still returns to the same view.
 */
export function planViewCarry(state) {
    const carry = {};
    for (const { param, isValid } of PLAN_VIEW_PARAMS) {
        if (isValid(state?.[param])) carry[param] = String(state[param]);
    }
    return carry;
}

/**
 * The query "Back to Plan" lands with, from a `planExitState` record: `mode=`
 * and every usable `PLAN_VIEW_PARAMS` override. Null when none is usable. All
 * are validated — this comes from router state, and is interpolated into a URL.
 */
export function backToPlanQuery(state) {
    const parts = [];
    const mode = state?.mode;
    if (typeof mode === 'string' && /^[a-z]{1,16}$/.test(mode)) parts.push(`mode=${mode}`);
    for (const [param, v] of Object.entries(planViewCarry(state))) parts.push(`${param}=${v}`);
    return parts.length ? parts.join('&') : null;
}

/**
 * The plan a page was opened FROM, out of its router state: `{ id, mode }` when
 * the state is a `planExitState` record (`from: 'pipeline'` and a usable plan
 * id), else null. `mode` is charset-checked, not validated against the panel
 * list — the receiving page owns that vocabulary and falls back on anything it
 * does not recognise; all this end needs is that the value cannot corrupt the
 * URL it is interpolated into. Moved here from EpicsPage by req #3742 so the
 * Initiatives and Epics editors read it identically.
 */
export function planOriginOf(state) {
    if (state?.from !== 'pipeline') return null;
    const id = Number(state?.pipelineId);
    if (!Number.isFinite(id) || id <= 0) return null;
    const raw = state?.mode;
    return { id, mode: typeof raw === 'string' && /^[a-z]{1,16}$/.test(raw) ? raw : null };
}

/**
 * Where "Back to Plan" goes from a page opened with `state`: the plan's own
 * path with every view override the exit carried, or null when the page was
 * not opened from a plan (req #3742 — the editors' close uses it too).
 */
export function planReturnPath(state) {
    const origin = planOriginOf(state);
    return origin ? planDetailPath(origin.id, backToPlanQuery(state)) : null;
}

/** The epic a new requirement is to be seated on, or null when the state names
 * none (or names something that is not an epic id). */
export function readNewRequirementSeat(state) {
    const epicId = Number(state?.[SEAT_EPIC_STATE_KEY]);
    if (!Number.isInteger(epicId) || epicId <= 0) return null;
    const rawName = state?.[SEAT_EPIC_NAME_STATE_KEY];
    return { epicId, epicName: typeof rawName === 'string' && rawName.trim() ? rawName : null };
}
