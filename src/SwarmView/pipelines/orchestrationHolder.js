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
// A SCOPE IS (pipeline_fk, epic_fk) AND NOTHING ELSE. `epic_fk` null means
// the WHOLE PLAN, which owns every step in it — so a plan with a whole-plan
// reservation is orchestrated even though none of its epics carries one. Every
// consumer asks through `claimForPipeline` rather than filtering inline,
// because getting that null case wrong reads as "nobody is orchestrating this"
// on the one surface built to answer the opposite.
//
// req #3356 removed the 1.0 accessors (`claimForPipeline`, `claimsForEpic`) with
// the pages that called them. `scopeLabel` below still reads BOTH column pairs:
// the `orchestration_claims` rows themselves are not this requirement's to
// change (its item 4 drops the 1.0 columns, schema-side), so a row written
// before that drop must still print a label rather than `pipeline:null`.

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
 * The reservation covering a whole PLAN — `epic_fk` null, `pipeline_fk`
 * matching (req #3381).
 *
 * There was a TWIN of this function until req #3356, because
 * `orchestration_claims` carried two scope pairs: a 1.0 `pipeline_fk`/`epic_fk`
 * and a 2.0 `pipeline2_fk`/`epic2_fk`, each NULL on the other era's rows. The
 * migration dropped the 1.0 columns and renamed the 2.0 pair into their names,
 * so there is one pair, one function, and no era to disambiguate.
 */
export function claimForPipeline(claims, pipelineId) {
    if (pipelineId == null) return null;
    return asArray(claims).find(
        (c) => c.pipeline_fk === pipelineId && c.epic_fk == null) || null;
}

// ── req #3678 — MACHINE-AWARE ORCHESTRATION: one lead per epic, any subscribers
//
// Several machines may hold claims on one plan. LEADERSHIP IS PER EPIC: for
// every epic, the lowest-id live claim covering it (a whole-plan claim, or that
// epic's own) LEADS it — the first machine in — and launches requirements
// pinned to "Any" and to itself there. Every other machine covering it is a
// SUBSCRIBER and launches only requirements pinned to it. The role is DERIVED
// from the rows, never stored, by `resolve_roles` in
// darwin-mcp/services/orchestration_claims.py — mirrored here for the same
// reason `isStale` is: the browser reaches Lambda-Rest, a passthrough with no
// derivation layer, so it gets raw rows. `__tests__/claimRolesCorpus.json`,
// generated from the service, holds this copy to the same answers.

export const ROLE_LEAD = 'lead';
export const ROLE_SUBSCRIBER = 'subscriber';
export const ROLE_REFUSED = 'refused';

const nullish = (v) => (v === undefined ? null : v);
const idKey = (c) => (Number.isInteger(c.id) ? c.id : Infinity);

function claimsConflict(aEpic, bEpic) {
    return aEpic == null || bEpic == null || aEpic === bEpic;
}

/**
 * `Map<claimId, { role, lead_id, blocker_id, defers, refusal? }>` for LIVE
 * claims — the browser's copy of `resolve_roles`, same keys. Walked in id order
 * per plan: an overlap with an accepted claim on the SAME machine (or where
 * either has no machine) → REFUSED; no overlap → LEAD; an epic claim, or a
 * whole-plan claim under an earlier whole-plan claim → SUBSCRIBER of the
 * lowest-id claim covering it; a whole-plan claim under earlier EPIC claims
 * only → LEAD that `defers` those epics to them.
 */
export function resolveRoles(claims) {
    const out = new Map();
    const accepted = new Map();
    const sorted = asArray(claims).slice().sort((a, b) => idKey(a) - idKey(b));
    for (const row of sorted) {
        const pid = nullish(row.pipeline_fk);
        const epic = nullish(row.epic_fk);
        const mine = nullish(row.machine_fk);
        if (!accepted.has(pid)) accepted.set(pid, []);
        const prior = accepted.get(pid);
        const overlapping = prior.filter((c) => claimsConflict(nullish(c.epic_fk), epic));
        const blocker = overlapping.find((c) => mine == null
            || nullish(c.machine_fk) == null || nullish(c.machine_fk) === mine);
        let verdict;
        if (blocker) {
            verdict = {
                role: ROLE_REFUSED, lead_id: null, blocker_id: blocker.id, defers: [],
                refusal: mine != null && nullish(blocker.machine_fk) === mine
                    ? 'same-machine' : 'no-machine',
            };
        } else if (!overlapping.length) {
            verdict = { role: ROLE_LEAD, lead_id: row.id, blocker_id: null, defers: [] };
        } else if (epic != null) {
            verdict = { role: ROLE_SUBSCRIBER, lead_id: overlapping[0].id,
                        blocker_id: null, defers: [] };
        } else {
            const whole = overlapping.filter((c) => nullish(c.epic_fk) == null);
            if (whole.length) {
                verdict = { role: ROLE_SUBSCRIBER, lead_id: whole[0].id,
                            blocker_id: null, defers: [] };
            } else {
                const defers = new Map();
                for (const c of overlapping) {
                    if (!defers.has(c.epic_fk)) defers.set(c.epic_fk, c.id);
                }
                verdict = {
                    role: ROLE_LEAD, lead_id: row.id, blocker_id: null,
                    defers: [...defers.keys()].sort((x, y) => x - y)
                        .map((e) => ({ epic_fk: e, lead_id: defers.get(e) })),
                };
            }
        }
        out.set(row.id, verdict);
        if (verdict.role !== ROLE_REFUSED) prior.push(row);
    }
    return out;
}

/**
 * Who is orchestrating a whole PLAN, machine-aware (req #3678): the whole-plan
 * LEAD, plus every OTHER machine holding a live claim on the plan — each a
 * subscriber, or the lead of an epic the whole-plan lead defers to it.
 * `{ ...holderView(lead), role, subscribers: [holderView + role] }` or null.
 *
 * No live whole-plan lead falls back to `claimForPipeline` — a STALE claim is
 * still worth showing (the orchestrator is gone and the scope reclaimable),
 * which is the pre-#3678 behaviour this keeps.
 */
export function orchestrationView(claims, pipelineId, machines, now = new Date()) {
    if (pipelineId == null) return null;
    const onPlan = asArray(claims).filter((c) => c.pipeline_fk === pipelineId);
    const live = onPlan.filter((c) => !isStale(c, now));
    const roles = resolveRoles(live);
    const lead = live.slice().sort((a, b) => idKey(a) - idKey(b))
        .find((c) => c.epic_fk == null && roles.get(c.id)?.role === ROLE_LEAD);
    if (!lead) {
        const fallback = holderView(claimForPipeline(onPlan, pipelineId), machines, now);
        return fallback && { ...fallback, role: null, subscribers: [] };
    }
    const base = holderView(lead, machines, now);
    const subscribers = live
        .filter((c) => c.id !== lead.id && roles.get(c.id)?.role !== ROLE_REFUSED)
        .sort((a, b) => idKey(a) - idKey(b))
        .map((c) => ({ ...holderView(c, machines, now), role: roles.get(c.id).role }));
    const deferred = roles.get(lead.id).defers || [];
    const leadSentence = `${base.machine} LEADS — it launches requirements pinned to Any `
        + `and to ${base.machine}${deferred.length
            ? ` everywhere except ${deferred.map((d) => `epic ${d.epic_fk}`).join(', ')}`
            : ''}`;
    const describe = (s) => (s.role === ROLE_LEAD
        ? `${s.machine} (${scopeLabel(s.claim)}) LEADS that epic — it was there first`
        : `${s.machine} (${scopeLabel(s.claim)}) subscribes — launches ONLY requirements `
            + 'pinned to its own machine');
    const others = subscribers.length
        ? ` Also orchestrating: ${subscribers.map((s) => `${describe(s)}, ${
            s.heldSeconds == null ? 'held since an unknown time'
                : `held ${humanDuration(s.heldSeconds)}`}`).join('; ')}.`
        : ' No other machine has joined, so work pinned to another machine waits '
            + 'until that machine runs /pipeline-start on this plan.';
    return {
        ...base,
        role: ROLE_LEAD,
        subscribers,
        label: subscribers.length
            ? `${base.label} + ${subscribers.map((s) => s.machine).join(', ')}`
            : base.label,
        title: `${base.title} ${leadSentence}.${others}`,
    };
}

// ── req #3809 — ORCHESTRATION AS A BADGE beside the plan's name ─────────────
//
// User directive: "if you are being orchestrated you get a circular badge to the
// right of your pipeline name — Green master, Orange secondary — Mac or WSL
// inside", replacing the "Orchestrated by …" chip at the title bar's right edge.
// ONE BADGE PER MACHINE, because the machine is what the badge prints; a
// machine holding two epic claims on one plan is one orchestrator, not two.

export const BADGE_LEAD = 'lead';
export const BADGE_SUBSCRIBER = 'subscriber';
export const BADGE_STALE = 'stale';

const PLATFORM_LABELS = { darwin: 'Mac', wsl: 'WSL', linux: 'Linux' };

/** `Mac` / `WSL` / `Linux` — the word printed inside a badge; `?` when unknown. */
export function machinePlatformLabel(machine) {
    return (machine && PLATFORM_LABELS[machine.platform]) || '?';
}

/**
 * The plan header's orchestration badges, master first:
 * `[{ key, machineFk, text, tone, title }]`, empty when nobody orchestrates.
 *
 * MASTER (`lead`, green) is the whole-plan LEAD — the first machine in. With no
 * live whole-plan claim, an epic-scoped LEAD is the master of its own epic, so it
 * is green too. Every other live machine on the plan is SECONDARY (`subscriber`,
 * orange): a subscriber, or an earlier epic claim the whole-plan lead defers to.
 * A REFUSED claim launches nothing and gets no badge. With nothing live, a STALE
 * whole-plan claim still shows (grey, `stale`) — the orchestrator is gone and the
 * scope reclaimable, which is what the chip this replaced said too.
 */
export function orchestrationBadges(claims, pipelineId, machines, now = new Date()) {
    if (pipelineId == null) return [];
    const onPlan = asArray(claims).filter((c) => c.pipeline_fk === pipelineId);
    const live = onPlan.filter((c) => !isStale(c, now))
        .sort((a, b) => idKey(a) - idKey(b));
    const roles = resolveRoles(live);
    const accepted = live.filter((c) => roles.get(c.id)?.role !== ROLE_REFUSED);
    const machineOf = (c) => asArray(machines).find((m) => m.id === c.machine_fk) || null;

    if (!accepted.length) {
        const stale = claimForPipeline(onPlan, pipelineId);
        if (!stale) return [];
        const view = holderView(stale, machines, now);
        return [{
            key: `m${stale.machine_fk ?? 'none'}`,
            machineFk: stale.machine_fk ?? null,
            text: machinePlatformLabel(machineOf(stale)),
            tone: BADGE_STALE,
            title: view.title,
        }];
    }

    const planLead = accepted.find(
        (c) => c.epic_fk == null && roles.get(c.id).role === ROLE_LEAD);
    const isMaster = (c) => (planLead
        ? c.id === planLead.id
        : roles.get(c.id).role === ROLE_LEAD);
    const describe = (c, view) => {
        if (c === planLead) {
            return `${view.machine} is the MASTER — it leads this plan and launches `
                + `requirements pinned to Any and to ${view.machine}`;
        }
        if (isMaster(c)) {
            return `${view.machine} is the MASTER of ${scopeLabel(c)} — it leads that `
                + `epic and launches requirements pinned to Any and to ${view.machine} there`;
        }
        if (roles.get(c.id).role === ROLE_LEAD) {
            return `${view.machine} is SECONDARY here — it leads ${scopeLabel(c)}, `
                + 'which it reached first';
        }
        return `${view.machine} is SECONDARY — it subscribes (${scopeLabel(c)}) and `
            + 'launches ONLY requirements pinned to its own machine';
    };

    const byMachine = new Map();
    for (const c of accepted) {
        const key = `m${c.machine_fk ?? 'none'}`;
        const view = holderView(c, machines, now);
        const sentence = `${describe(c, view)}. ${view.title}`;
        const prior = byMachine.get(key);
        if (prior) {
            prior.master = prior.master || isMaster(c);
            prior.sentences.push(sentence);
        } else {
            byMachine.set(key, {
                key, machineFk: c.machine_fk ?? null,
                text: machinePlatformLabel(machineOf(c)),
                master: isMaster(c), sentences: [sentence],
            });
        }
    }
    return [...byMachine.values()]
        .sort((a, b) => Number(b.master) - Number(a.master))
        .map(({ master, sentences, ...rest }) => ({
            ...rest,
            tone: master ? BADGE_LEAD : BADGE_SUBSCRIBER,
            title: sentences.join(' '),
        }));
}

// `claimsForEpic` — every reservation covering an EPIC's work, its own plus any
// whole-plan reservation on a plan the epic sat in — was DELETED by req #3356
// with its only caller, the 1.0 `/swarm/epics` page.
//
// NOTHING REPLACED IT, and that is a real feature-parity gap rather than a
// tidy-up: `/swarm/epics` shows no "who is orchestrating this epic" chip, so an
// epic whose work is being launched right now — by an epic-scoped engine or by
// a whole-plan one — reads on that page exactly like an idle epic. The plan
// HEADER still names a whole-plan holder (`claimForPipeline` above), so the
// fact is not unreachable, only absent from the epic surface. Whatever restores
// it must union BOTH scopes: an epics page showing only epic-scoped claims
// would report "not orchestrated" for an epic a whole-plan engine owns.

/**
 * `pipeline:2` for a whole-plan claim, `epic:7@2` for an epic-scoped one.
 *
 * THIS NO LONGER MATCHES WHAT THE ENGINE PRINTS, and the divergence is stated
 * here rather than left to be discovered. The Python side still emits the
 * era-suffixed form — `darwin-mcp/services/orchestration_claims.py`,
 * `scripts/swarm/pipeline_reservation.py`, `scripts/swarm/pipeline2_engine.py`
 * — and two of those PARSE the `pipeline2:` prefix, so it cannot be changed
 * from this side. A reservation therefore reads `pipeline:6` in the browser and
 * `pipeline2:6` in the heartbeat. Nothing breaks (the browser never feeds this
 * label back), but the two halves disagree until the Python half drops the
 * marker too. Do not "fix" this by restoring the suffix here: req #3356's whole
 * point is that no UI string carries it.
 *
 * ONE BRANCH, because there is one column pair (req #3356). This had two, one
 * per era, testing the 2.0 pair FIRST because `pipeline_fk` was NULL on a 2.0
 * row and testing it first would have printed `pipeline:null`. After the
 * migration renamed the 2.0 pair into the plain names, both branches tested the
 * same column and the 2.0-labelled one always won — so every claim rendered as
 * `pipeline2:` while the era-free branch below it was unreachable.
 *
 * A claim carrying NO pipeline at all returns '' rather than `pipeline:null`:
 * the scope is the plan, so a claim without one is not a scope this can name.
 */
export function scopeLabel(claim) {
    if (!claim || claim.pipeline_fk == null) return '';
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
