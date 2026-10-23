// epicSeatLock.js — may a NEW requirement be seated on this epic right now?
//
// The requirement page's "+"-opened draft (req #3582) re-reads the epic LIVE
// before it creates anything: the requirement is POSTed first and seated
// second, so a seat the gateway would refuse must be caught BEFORE the POST or
// the new requirement is stranded unseated.
//
// An epic has no state (req #3750) — finished work never closes it. What does
// refuse a seat is a LOCK (req #3649), and the lock CASCADES: an epic under a
// locked initiative or a locked plan is as frozen as one locked itself, and the
// gateway (`plan_lock.py`) answers 423 for all three. So the check walks the
// whole chain — epic -> its initiative -> its plan — three narrow reads, each
// naming only the columns it needs. It runs once per "+" create, never on a
// render, so three round trips is the cheapest CORRECT answer: the page's
// cached orchestration index could answer for free, but a cache up to 30 s
// old is the stale view this re-read exists to replace.

import call_rest_api from '../../RestApi/RestApi';
import { isFlagOn } from '../pipelines/pipelineAdapter';

async function readOne(url, idToken) {
    const r = await call_rest_api(url, 'GET', '', idToken).catch(() => null);
    const row = r?.httpStatus?.httpStatus === 200 ? r.data?.[0] : null;
    return { read: r, row: row || null };
}

/**
 * The live effective lock on an epic.
 *
 * @param {string} darwinUri
 * @param {string} idToken
 * @param {number} epicId
 * @returns {Promise<{ok: true, lockedBy: ?('pipeline'|'initiative'|'epic')}
 *                  |{ok: false, read: ?Object}>}
 *          `ok: false` when any read in the chain failed or found nothing —
 *          "cannot check" is never "not locked". `lockedBy` names the
 *          OUTERMOST lock (plan, then initiative, then epic), the one to lift —
 *          the same precedence the plan view uses (`pipelineAdapter.js`).
 */
export async function readEpicSeatLock(darwinUri, idToken, epicId) {
    const epic = await readOne(
        `${darwinUri}/epics?id=${epicId}&fields=id,locked,initiative_fk`, idToken);
    if (!epic.row) return { ok: false, read: epic.read };
    const initiative = await readOne(
        `${darwinUri}/initiatives?id=${epic.row.initiative_fk}&fields=id,locked,pipeline_fk`, idToken);
    if (!initiative.row) return { ok: false, read: initiative.read };
    const plan = await readOne(
        `${darwinUri}/pipelines?id=${initiative.row.pipeline_fk}&fields=id,locked`, idToken);
    if (!plan.row) return { ok: false, read: plan.read };
    const lockedBy = isFlagOn(plan.row.locked, false) ? 'pipeline'
        : isFlagOn(initiative.row.locked, false) ? 'initiative'
            : isFlagOn(epic.row.locked, false) ? 'epic' : null;
    return { ok: true, lockedBy };
}

/** The refusal sentence for a locked chain, naming which lock to lift. */
export function seatLockMessage(epicId, lockedBy) {
    const what = lockedBy === 'pipeline' ? `Epic ${epicId}'s plan is locked`
        : lockedBy === 'initiative' ? `Epic ${epicId}'s initiative is locked`
            : `Epic ${epicId} is locked`;
    return `${what} — it takes no new work; nothing was created`;
}
