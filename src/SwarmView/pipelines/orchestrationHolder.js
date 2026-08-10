// orchestrationHolder.js — rendering a durable orchestration reservation (req #3224).
//
// One row of `orchestration_claims` says: THIS SCOPE is being orchestrated, from
// THAT machine, in THAT terminal, since THEN. This module turns that row into
// the three things every surface needs — a label, a tone, and a tooltip — so the
// plans table, the plans cards, the plan header and the epics grid all say the
// same thing in the same words.
//
// WHY THE DERIVATION LIVES IN THE CLIENT AND NOT ON THE ROW. `stale` and
// `heartbeat_age_s` are computed by `darwin-mcp/services/orchestration_claims.py`
// for the ENGINE's consumers, which reach the daemon. The browser reaches
// Lambda-Rest — a generic passthrough with no derivation layer — so it gets the
// raw columns and computes the same two facts here. That is the identical split
// `pipelineModel.js` and `pipeline_derive.py` already live with (the browser
// cannot import the daemon's code), and the shared constant below is what keeps
// the two answers the same.
//
// A SCOPE IS (pipeline_fk, epic_fk) AND NOTHING ELSE. `epic_fk` null means the
// WHOLE PLAN, which owns every step in it — so a plan with a whole-plan
// reservation is orchestrated even though none of its epics carries one. Every
// consumer asks through `claimForPipeline` / `claimForEpic` rather than filtering
// inline, because getting that null case wrong reads as "nobody is orchestrating
// this" on the one surface built to answer the opposite.

// Seconds after which a reservation whose holder has stopped heartbeating is
// RECLAIMABLE. Must equal `STALE_AFTER_SECONDS` in
// darwin-mcp/services/orchestration_claims.py — the two derive the same fact for
// different consumers, and a UI that called a claim live while the engine called
// it reclaimable would be worse than showing nothing.
export const STALE_AFTER_SECONDS = 600;

function asArray(value) {
    return Array.isArray(value) ? value : [];
}

/**
 * Parse a MySQL datetime as UTC.
 *
 * Lambda-Rest returns `YYYY-MM-DD HH:MM:SS` with no zone, and RDS runs in UTC.
 * `new Date('2026-08-01 10:00:00')` is parsed as LOCAL time by every browser, so
 * an eight-hour-offset user would read every fresh reservation as eight hours
 * stale — reported as "held 8h", and past the threshold, so shown as dead. The
 * `T`+`Z` normalization is what makes the age real.
 */
export function parseUtc(stamp) {
    if (!stamp) return null;
    if (stamp instanceof Date) return Number.isNaN(stamp.getTime()) ? null : stamp;
    const text = String(stamp).trim().replace(' ', 'T');
    const iso = /[zZ]$|[+-]\d{2}:?\d{2}$/.test(text) ? text : `${text}Z`;
    const parsed = new Date(iso);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Seconds since a claim last proved it was alive, or null when it cannot be told.
 *
 * `update_ts` is the DB-stamped heartbeat instant and is NULL until the first
 * heartbeat lands, so `claimed_at` is the fallback — a claim taken four seconds
 * ago has proved itself four seconds ago whether or not it has beat yet.
 *
 * NULL IS NOT ZERO AND NOT INFINITY. It means "cannot say", and `isStale` treats
 * it as NOT stale, matching the server: calling a claim dead on an unreadable
 * timestamp is how a live orchestrator's scope gets taken.
 */
export function heartbeatAgeSeconds(claim, now = new Date()) {
    if (!claim) return null;
    const stamp = parseUtc(claim.update_ts) || parseUtc(claim.claimed_at);
    if (!stamp) return null;
    return Math.max(0, Math.round((now.getTime() - stamp.getTime()) / 1000));
}

export function isStale(claim, now = new Date()) {
    const age = heartbeatAgeSeconds(claim, now);
    return age != null && age > STALE_AFTER_SECONDS;
}

/** `43s` / `7m` / `2h 05m` / `3d 4h`. */
export function humanDuration(seconds) {
    const total = Math.max(0, Math.round(seconds || 0));
    if (total < 60) return `${total}s`;
    if (total < 3600) return `${Math.floor(total / 60)}m`;
    if (total < 86400) {
        return `${Math.floor(total / 3600)}h ${String(Math.floor((total % 3600) / 60)).padStart(2, '0')}m`;
    }
    return `${Math.floor(total / 86400)}d ${Math.floor((total % 86400) / 3600)}h`;
}

/** How long this scope has been held, from the DB-stamped claim instant. */
export function heldForSeconds(claim, now = new Date()) {
    const stamp = parseUtc(claim && claim.claimed_at);
    if (!stamp) return null;
    return Math.max(0, Math.round((now.getTime() - stamp.getTime()) / 1000));
}

/**
 * The reservation covering a whole PLAN — `epic_fk` null, `pipeline_fk` matching.
 */
export function claimForPipeline(claims, pipelineId) {
    if (pipelineId == null) return null;
    return asArray(claims).find(
        (c) => c.pipeline_fk === pipelineId && c.epic_fk == null) || null;
}

/**
 * The 2.0 counterpart of `claimForPipeline` (req #3381) — `pipeline2_fk`/
 * `epic2_fk` are the SEPARATE columns a 2.0-scoped claim carries (NULL on a
 * 1.0 row, and vice versa — CLAUDE.md § Session orchestration attribution's
 * pairing pattern, reused here for claims). `claimForPipeline` itself is NOT
 * era-aware and must not become so: `PipelinesTableView.jsx`/
 * `PipelineCardsView.jsx` (the 1.0 list page) still call it against 1.0
 * pipeline ids and must keep matching on `pipeline_fk`.
 */
export function claimForPipeline2(claims, pipeline2Id) {
    if (pipeline2Id == null) return null;
    return asArray(claims).find(
        (c) => c.pipeline2_fk === pipeline2Id && c.epic2_fk == null) || null;
}

/**
 * Every reservation covering an EPIC's work — its own, plus any whole-plan
 * reservation on a plan the epic is seated in.
 *
 * BOTH, because a whole-plan scope owns every step in its plan (design rule 10
 * gives a step exactly one dominant label, so step→orchestrator is a function).
 * An epics page that showed only epic-scoped claims would report "not
 * orchestrated" for an epic whose work is being launched right now by a
 * whole-plan engine — precisely the confusion the shared reservation exists to
 * remove.
 *
 * `pipelineIds` is the set of plans the epic appears in; pass an empty list when
 * that is not known and only the epic's own reservation is considered.
 */
export function claimsForEpic(claims, epicId, pipelineIds = []) {
    if (epicId == null) return [];
    const plans = new Set(asArray(pipelineIds));
    return asArray(claims).filter(
        (c) => c.epic_fk === epicId || (c.epic_fk == null && plans.has(c.pipeline_fk)));
}

/** `pipeline:2` / `epic:7@2` for a 1.0 claim, `pipeline2:5` / `epic2:9@5` for
 * a 2.0 one — the same words the engine and its edges use, on whichever pair
 * of columns this claim actually carries (req #3381: `pipeline_fk` is NULL
 * on a 2.0 row, so testing it first would print `pipeline:null`). */
export function scopeLabel(claim) {
    if (!claim) return '';
    if (claim.pipeline2_fk != null) {
        return claim.epic2_fk == null
            ? `pipeline2:${claim.pipeline2_fk}`
            : `epic2:${claim.epic2_fk}@${claim.pipeline2_fk}`;
    }
    return claim.epic_fk == null
        ? `pipeline:${claim.pipeline_fk}`
        : `epic:${claim.epic_fk}@${claim.pipeline_fk}`;
}

function machineName(machineFk, machines) {
    if (machineFk == null) return 'an unnamed machine';
    const hit = asArray(machines).find((m) => m.id === machineFk);
    if (!hit) return `machine ${machineFk}`;
    return hit.title || hit.hostname || `machine ${machineFk}`;
}

/**
 * The display model for one reservation: `{ label, machine, held, stale, title }`.
 *
 * `label` is the chip text and is deliberately SHORT — a table cell and a card
 * line both have to hold it. `title` is the full sentence for the tooltip, and
 * it is where machine, terminal, engine and age all appear, because that is the
 * half of this requirement that exists for a human rather than for the engine.
 */
export function holderView(claim, machines, now = new Date()) {
    if (!claim) return null;
    const machine = machineName(claim.machine_fk, machines);
    const held = heldForSeconds(claim, now);
    const age = heartbeatAgeSeconds(claim, now);
    const stale = isStale(claim, now);

    const parts = [`${scopeLabel(claim)} is being orchestrated from ${machine}`];
    if (claim.terminal_pid) parts.push(`terminal pid ${claim.terminal_pid}`);
    if (claim.engine_pid) parts.push(`engine pid ${claim.engine_pid}`);
    parts.push(held == null ? 'held since an unknown time' : `held for ${humanDuration(held)}`);
    parts.push(age == null
        ? 'last alive UNKNOWN — its heartbeat stamp is unreadable'
        : `last alive ${humanDuration(age)} ago`);
    if (stale) {
        // Say what a stale claim MEANS, not just that it is old. "Stale" alone
        // reads as a warning about the display; the fact worth knowing is that
        // the orchestrator is gone and the scope can be taken.
        parts.push(`its heartbeat is past the ${humanDuration(STALE_AFTER_SECONDS)} `
            + 'threshold, so its orchestrator is gone and any machine may reclaim this scope');
    }

    return {
        claim,
        machine,
        stale,
        heldSeconds: held,
        ageSeconds: age,
        label: stale
            ? `${machine} (stale)`
            : `${machine} · ${held == null ? '—' : humanDuration(held)}`,
        title: `${parts.join(', ')}.`,
    };
}
