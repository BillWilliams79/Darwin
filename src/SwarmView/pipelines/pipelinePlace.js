// pipelinePlace.js — "where I was in the pipelines area, last time" (req #3431).
//
// > *"It should recall that you had last selected a pipeline and had a
// > particular view port open. so if you navigate away you would hours later
// > when coming back, go straight that spot. a feature saved to local storage
// > only."*
//
// ── TWO FACTS, ONE RECORD ──────────────────────────────────────────────────
// `{ at, pipelineId }`, and the split matters:
//
//   at          'plan' or 'list' — WHERE the reader was. This is the only field
//               the resume gate consults, and it is why coming back after
//               deliberately walking back out to the list shows the LIST. A
//               reader whose last act was to leave a plan did not ask to be put
//               back into it.
//   pipelineId  the last plan OPENED, which survives an `at: 'list'` visit.
//               One record rather than two, because they are answers to one
//               question asked at two grains — and because the list marks that
//               row (req #3311's visible half) whether or not it would resume
//               to it.
//
// A THIRD FIELD, `era`, IS GONE (req #3356). req #3463 added it because 1.0 and
// 2.0 had disjoint id spaces with no translation between them, so an id alone
// was not an address — a record naming plan 7 was a 2.0 address or a 1.0
// not-found depending entirely on that field, and without it the record was a
// channel carrying an id from one era's page to the other era's route. Pipeline
// 1.0 is eradicated, so there is one id space and an id IS an address again.
//
// ── THE PANEL IS DELIBERATELY NOT HERE (frontend-architect review) ─────────
// A third field, `mode`, was in the first cut of this design and is gone. The
// requirement's "view port" plainly includes which panel was open, so the
// omission needs a reason, and there are three:
//
//   1. IT IS ALREADY DURABLE. `PIPELINE_DETAIL_MODE_STORAGE_KEY` goes through
//      `useViewPreference`, which writes localStorage on every change and seeds
//      a new tab from it. The reader lands in the panel they left whether or
//      not this record says so — a second copy buys behaviour that already
//      exists, and gives one fact two authorities.
//   2. THE ONLY WAY TO REPLAY IT IS `?mode=`, AND THAT CHANNEL MEANS SOMETHING
//      ELSE. Rule R9 and this page's own doctrine are explicit: a query
//      parameter is a LINK asking to see one thing once, never the reader's own
//      standing state. A resume is the reader's own state.
//   3. THE URL WOULD LIE. `handleModeChange` clears the override but cannot
//      clear the query string, so a resumed reader who then picks Table keeps
//      `?mode=plan` in the address bar — and that is the URL they copy.
//
// What would be lost is the case where the panel on screen was itself a
// transient override (a bead click forcing the Table, a `?mode=plan` link).
// Replaying THAT is the bug, not the feature.
//
// ── IT REPLACES `darwin-swarm-pipelines-last-opened` ───────────────────────
// That key (req #3311) was written by ONE call site: the list page's own click
// handler. So a plan reached by a `?step=` deep link, by Back, or by the swarm
// session page's "view the plan" link was never recorded — the reader had
// obviously last selected it and the app disagreed. Writing from the DETAIL
// page instead records every arrival without enumerating any of them, which is
// the same argument `viewportMemory.js` makes about return paths. There is no
// migration: the old key held an id and no `at`, so a reader's very first visit
// re-establishes the record at the cost of nothing they can perceive.
//
// ── localStorage, AS ASKED, AND THE CAMERA'S FINGERPRINT IS NOT NEEDED ─────
// `viewportMemory.js` reverses to localStorage under this same requirement and
// documents what that costs. This record is smaller and safer than a camera: it
// names ONE plan, and that plan is re-validated against the live list before
// anything is done with it — a plan that no longer exists is refused and the
// record pruned. There is nothing here that can land a reader somewhere
// unrecognisable, which is the failure a fingerprint exists to prevent.
//
// ── ONE COST, AND IT MOVES THE READER (code review) ────────────────────────
// `viewportMemory.js` enumerates what durability costs a CAMERA; this record
// has its own, and it is sharper because the failure relocates somebody rather
// than changing a drawing. Two tabs share one record, last writer wins: tab A
// sits on the list while tab B opens a plan, and a reload of tab A now resumes
// to tab B's plan. Recoverable in one click — the nav rail's Pipelines item,
// which after that arrival records `at: 'list'` — and not worth a tab identity
// this feature would otherwise have no use for. Named because it is the one
// behaviour a reader cannot derive from the feature's description.
//
// NO JSX and no React: a pure module vitest exercises without a DOM, and a
// component file with non-component exports drops out of Fast Refresh — the
// rule `pipelineStepLink.js`, `pipelineEpicLink.js` and `pipelineDetailModes.js`
// are all written to.

import { SCROLL_STORAGE_PREFIX, VIEWPORT_STORAGE_PREFIX } from '../../utils/viewportMemory';
import {
    planDetailPath, planDetailPathPattern, planStorageNamespace,
} from './planEra';

export const PIPELINE_PLACE_STORAGE_KEY = 'darwin-swarm-pipelines-place';

// req #3311's key, replaced by the record above. Removed on the first prune
// rather than left to rot: `useViewPreference` wrote it to localStorage as well
// as sessionStorage, so unlike the per-tab state this feature used to keep, it
// is a value that would otherwise survive forever with no reader.
const RETIRED_LAST_OPENED_KEY = 'darwin-swarm-pipelines-last-opened';

// Every per-plan key this feature owns, as `<prefix><id>`. Enumerated rather
// than pattern-matched over the whole of localStorage: a prune that deletes by
// resemblance is one typo away from eating another feature's state, and these
// three are written by files in this directory (`PipelinePlanVisualizer.jsx`,
// `PipelinePlanTable.jsx`) so the list has one owner.
//
// `darwin-scroll-pipelines-list` is deliberately ABSENT — it carries no plan id
// (one list, one position) and matches none of these prefixes, which is what
// keeps it out of the sweep.
//
// req #3463 derived these PER ERA, so that a 1.0 list judging liveness against
// the 1.0 read could not delete every 2.0 camera on sight ("not in my list" and
// "does not exist" being the same value again). req #3356 collapsed that: one
// era, one namespace, one prefix set.
const perPlanPrefixes = () => {
    const ns = planStorageNamespace();
    return [
        `${VIEWPORT_STORAGE_PREFIX}${ns}-`,
        `${SCROLL_STORAGE_PREFIX}${ns}-table-`,
        `${SCROLL_STORAGE_PREFIX}${ns}-table-x-`,
    ];
};

// Bumped only if the record's SHAPE changes. A mismatch DROPS the record rather
// than migrating it — the same call `VIEWPORT_SCHEMA_VERSION` makes, and for the
// same reason: re-establishing this costs the reader one click on a plan they
// were about to open anyway, and a migration branch for a convenience feature
// lives forever.
//
// v1 was the original two-field record; v2 (req #3463) added `era`. Both are
// DROPPED at v3.
//
// ── WHY v2 IS DROPPED RATHER THAN MIGRATED (req #3356) ─────────────────────
// A v2 record could be read: strip `era` and the remaining two fields are
// exactly v3's. It is dropped anyway, and the reason is that migrating it is
// not free of judgement — a v2 record carrying `era: 1` names a plan in an id
// space that NO LONGER EXISTS, and its id may well collide with a live plan of
// the surviving era. Reading it forward would resume the reader into a
// DIFFERENT plan than the one they left, confidently. Telling the two apart
// means keeping the era vocabulary alive inside a module that no longer has
// eras, to serve a convenience feature, forever.
//
// THE COST IS NAMED because it is user-visible: on first load after this ships,
// every reader's remembered plan is forgotten once and the Pipelines list opens
// instead of the plan they last had up. It costs one click, on a plan they were
// about to open anyway, and it happens exactly once. The per-plan cameras and
// scroll offsets are orphaned in the same act (the storage namespace changed —
// see `planEra.js`); `prunePipelineStorage` collects them.
export const PIPELINE_PLACE_SCHEMA_VERSION = 3;

const PLACES = ['plan', 'list'];

/**
 * The remembered place, or null.
 *
 * VALIDATED, NEVER TRUSTED. This is JSON out of web storage — it can be
 * anything an older build wrote, anything a reader typed into devtools, or
 * anything a colliding key holds. Its `pipelineId` is interpolated into a route
 * this module then NAVIGATES to, so a junk value is not a cosmetic problem: it
 * is `/swarm/pipeline/undefined`, a page whose not-found alert reads as a
 * defect in the data. The same discipline `readViewport` applies for the same
 * reason.
 *
 * A record written by ANY older schema version is dropped — see the version
 * block above for why v2 is not read forward.
 *
 * @returns {?{at: string, pipelineId: ?number}}
 */
export function readPipelinePlace() {
    try {
        const raw = localStorage.getItem(PIPELINE_PLACE_STORAGE_KEY);
        if (raw == null) return null;
        const rec = JSON.parse(raw);
        // `typeof null === 'object'`, and a stored `"7"` parses to a number —
        // both sail past a bare truthiness check straight into `rec.at`.
        if (!rec || typeof rec !== 'object' || Array.isArray(rec)) return null;
        if (rec.v !== PIPELINE_PLACE_SCHEMA_VERSION) return null;
        if (!PLACES.includes(rec.at)) return null;
        return { at: rec.at, pipelineId: normalizeId(rec.pipelineId) };
    } catch {
        // Storage unavailable (Safari private mode) or unparseable JSON. There
        // is no remembered place — the state a first-ever visit is already in.
        return null;
    }
}

/**
 * Remember `place`.
 *
 * A `pipelineId` of null is a real value here and means "no plan has been
 * opened yet"; it is NOT the same as omitting the field on an `at: 'list'`
 * write, which is why callers merge rather than overwrite (see
 * `pipelinePlaceAtList`).
 *
 * @param {{at: string, pipelineId?: ?number}} place
 */
export function writePipelinePlace(place) {
    if (!place || !PLACES.includes(place.at)) return;
    try {
        localStorage.setItem(PIPELINE_PLACE_STORAGE_KEY, JSON.stringify({
            v: PIPELINE_PLACE_SCHEMA_VERSION,
            at: place.at,
            pipelineId: normalizeId(place.pipelineId),
        }));
    } catch {
        // Safari private mode / quota exceeded. The app still works; the reader
        // just lands on the list next time. Never worth surfacing — this is a
        // convenience, and a convenience that fails loudly is worse than one
        // that fails.
    }
}

/** Forget the remembered place. */
export function clearPipelinePlace() {
    try {
        localStorage.removeItem(PIPELINE_PLACE_STORAGE_KEY);
    } catch {
        // See writePipelinePlace.
    }
}

/**
 * The record for "the reader is on the LIST now", keeping whichever plan they
 * last opened.
 *
 * A helper rather than an inline literal at the call site because the merge is
 * the whole subtlety: writing a bare `{at: 'list'}` would drop `pipelineId` and
 * silently un-mark the row the list is supposed to be marking. Two callers
 * would each have to remember that.
 *
 * @param {?{pipelineId: ?number}} previous the record as read
 */
export const pipelinePlaceAtList = (previous) => ({
    at: 'list',
    pipelineId: previous ? previous.pipelineId : null,
});

/**
 * The route that lands the reader back on `place`, or null if it names no plan.
 *
 * Null rather than a best-effort path, so a caller navigates nowhere instead of
 * to `/swarm/pipeline/undefined` — the "omit rather than render a dead link"
 * rule `pipelineStepLink.js` and `pipelineEpicLink.js` both apply.
 *
 * NO QUERY STRING, EVER — see the header. The detail page reads the reader's
 * stored mode preference, exactly as it does when they click a card, and a
 * `?mode=` here would be a link channel carrying standing state.
 *
 * @param {?{pipelineId: ?number}} place
 * @returns {?string}
 */
export function pipelinePlacePath(place) {
    if (!place) return null;
    return planDetailPath(place.pipelineId);
}

// ── THE ROUTE, STATED ONCE — AND NOT HERE ANY MORE (req #3463) ─────────────
// The builder above and the matcher below are the same fact — what a plan's URL
// looks like — and stating it twice is how a route rename breaks the GUARD
// while the builder keeps working. That failure is silent and it is the
// catastrophic one: a matcher that stops recognising a plan page turns the
// resume back on for a reader walking out to the list, and the list becomes
// unreachable.
//
// req #3463 finished the argument this comment started: both the builder and
// the matcher come from `planEra.js`, which is the single place either route is
// spelled. That survives req #3356's collapse to one era unchanged — the count
// of eras was never what made the indirection worth having.
const DETAIL_PATTERN = planDetailPathPattern();

/**
 * Drop every stored position belonging to a plan that no longer exists.
 *
 * ── WHY THIS EXISTS AT ALL (frontend-architect review) ─────────────────────
 * Until req #3431 these keys were in sessionStorage, so THE TAB WAS THE
 * COLLECTOR — closing it took every camera and every scroll offset with it, and
 * a deleted plan's leftovers with them. Durability removed the collector and
 * nothing replaced it, so a record for a plan deleted months ago would sit in
 * localStorage for the life of the browser profile. The leak is small (a few
 * dozen bytes per plan ever opened) and it is still a leak this requirement
 * created, which is what "harden and build all the facilities" is asking about.
 *
 * ── IT DELETES BY OWNERSHIP, NEVER BY RESEMBLANCE ──────────────────────────
 * Only the three prefixes this directory writes, only where the tail is an
 * integer id, and only where that id is absent from the live set. A key it does
 * not recognise is left alone — the sweep must be incapable of touching another
 * feature's state even if that feature later chooses a similar name.
 *
 * ── AN EMPTY `liveIds` IS REFUSED ──────────────────────────────────────────
 * "No plans exist" and "the plans have not arrived yet" are the same value and
 * opposite instructions, and acting on the second wipes every position the
 * reader has. The caller gates on its own loading flag; this refuses anyway,
 * because a sweep is the one operation here that cannot be undone by using the
 * app normally.
 *
 * @param {Iterable<number>} liveIds ids of the plans that currently exist
 */
export function prunePipelineStorage(liveIds) {
    const live = new Set(liveIds ?? []);
    if (live.size === 0) return;
    try {
        localStorage.removeItem(RETIRED_LAST_OPENED_KEY);
        sessionStorage.removeItem(RETIRED_LAST_OPENED_KEY);
    } catch {
        // See writePipelinePlace. A retired key that cannot be removed is inert.
    }
    try {
        const doomed = [];
        for (let i = 0; i < localStorage.length; i += 1) {
            const key = localStorage.key(i);
            const id = perPlanId(key);
            if (id != null && !live.has(id)) doomed.push(key);
        }
        // Collected first, deleted after: `localStorage.key(i)` indexes a list
        // that RESHUFFLES on every removal, so deleting inside the loop skips
        // the key that slides into the freed slot — the classic mutate-while-
        // enumerating bug, and here it would silently leave half the orphans.
        doomed.forEach((key) => localStorage.removeItem(key));
    } catch {
        // Storage unavailable. Nothing was collected; nothing is broken.
    }
}

// The plan id a per-plan key names, or null if this is not one of ours.
//
// LONGEST PREFIX FIRST, which is not a micro-optimisation: the horizontal
// table scroll (`…-table-x-2`) also starts with the vertical one's prefix
// (`…-table-`), so testing in declaration order would read its id as `x-2`,
// fail the integer test, and quietly exempt every horizontal offset from the
// sweep forever.
function perPlanId(key) {
    if (typeof key !== 'string') return null;
    const prefix = perPlanPrefixes()
        .filter((p) => key.startsWith(p))
        .sort((a, b) => b.length - a.length)[0];
    if (!prefix) return null;
    const tail = key.slice(prefix.length);
    return /^\d+$/.test(tail) ? Number(tail) : null;
}

/**
 * True when `pathname` is a plan detail page.
 *
 * The resume gate's anti-bounce test: a reader arriving at the list FROM a plan
 * asked for the list, and redirecting them back is the one way this feature can
 * make the page unreachable.
 *
 * @param {?string} pathname
 */
export const isPipelineDetailPath = (pathname) =>
    typeof pathname === 'string' && DETAIL_PATTERN.test(pathname);

// NULLISH AND EMPTY ARE REJECTED BEFORE `Number` SEES THEM — `Number(null)` and
// `Number('')` are both 0, and 0 is a perfectly good integer, so a record whose
// id never resolved would produce a confident navigation to a plan that does not
// exist. The identical guard `pipelineStepLink.js` documents.
function normalizeId(value) {
    if (value == null || value === '') return null;
    const n = Number(value);
    return Number.isInteger(n) ? n : null;
}
