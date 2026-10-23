// stepSeatLock.js — may a NEW requirement be seated on this step right now?
//
// The requirement page's "+"-opened draft (req #3582) re-reads the step LIVE
// before it creates anything: the requirement is POSTed first and seated
// second, so a seat the gateway would refuse must be caught BEFORE the POST or
// the new requirement is stranded unseated.
//
// A step has no state (req #3750) — finished work never closes it. What does
// refuse a seat is a LOCK (req #3649), and the lock CASCADES: a step under a
// locked initiative or a locked plan is as frozen as one locked itself, and the
// gateway (`plan_lock.py`) answers 423 for all three. So the check walks the
// whole chain — step -> its initiative -> its plan — three narrow reads, each
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
 * The live effective lock on a step.
 *
 * @param {string} darwinUri
 * @param {string} idToken
 * @param {number} stepId
 * @returns {Promise<{ok: true, lockedBy: ?('pipeline'|'initiative'|'step')}
 *                  |{ok: false, read: ?Object}>}
 *          `ok: false` when any read in the chain failed or found nothing —
 *          "cannot check" is never "not locked". `lockedBy` names the
 *          OUTERMOST lock (plan, then initiative, then step), the one to lift —
 *          the same precedence the plan view uses (`pipelineAdapter.js`).
 */
export async function readStepSeatLock(darwinUri, idToken, stepId) {
    const step = await readOne(
        `${darwinUri}/pipeline_steps?id=${stepId}&fields=id,locked,initiative_fk`, idToken);
    if (!step.row) return { ok: false, read: step.read };
    const initiative = await readOne(
        `${darwinUri}/initiatives?id=${step.row.initiative_fk}&fields=id,locked,pipeline_fk`, idToken);
    if (!initiative.row) return { ok: false, read: initiative.read };
    const plan = await readOne(
        `${darwinUri}/pipelines?id=${initiative.row.pipeline_fk}&fields=id,locked`, idToken);
    if (!plan.row) return { ok: false, read: plan.read };
    const lockedBy = isFlagOn(plan.row.locked, false) ? 'pipeline'
        : isFlagOn(initiative.row.locked, false) ? 'initiative'
            : isFlagOn(step.row.locked, false) ? 'step' : null;
    return { ok: true, lockedBy };
}

/** The refusal sentence for a locked chain, naming which lock to lift. */
export function seatLockMessage(stepId, lockedBy) {
    const what = lockedBy === 'pipeline' ? `Step ${stepId}'s plan is locked`
        : lockedBy === 'initiative' ? `Step ${stepId}'s initiative is locked`
            : `Step ${stepId} is locked`;
    return `${what} — it takes no new work; nothing was created`;
}
