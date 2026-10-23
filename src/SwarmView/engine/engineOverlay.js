// engineOverlay.js — the plan view's engine overlay, as a model (req #3762).
// Pure: a decision record in, what the plan canvas draws out. No React, no fetch.
//
// THE RECORD IS THE ENGINE'S WHEN THERE IS ONE. With the engine for this scope
// on this machine switched on and publishing, the overlay is its latest record,
// drawn as the engine view draws it (`recordView`, rule R2): the same queue
// order, the same cut, the same codes in the same plain words — so the badges
// on the plan and the engine view's decision panel cannot disagree. With the
// engine off, the record is `enginePredict.js`'s first-cycle prediction over
// the same inputs, and the overlay says it is a prediction.
//
// WHAT IT ADDS TO THE RECORD:
//   · one BADGE per epic the record speaks for — the queue positions of its
//     launches (`1`, `2,3`, `4–6`) or, with none, its hold's short label — and
//     whether the cut falls on it;
//   · the MACHINE each launch would run on: the requirement's pinned machine,
//     else whoever leads that initiative (this engine, or another machine's
//     engine named by the live claims — the role rule, `resolveRoles`).

import { ROLE_LEAD, ROLE_REFUSED, ROLE_SUBSCRIBER, resolveRoles } from '../pipelines/orchestrationHolder';
import { recordView } from './engineModel';
import { OUTCOME_PENDING } from './engineVocabulary';

export const SOURCE_ENGINE = 'engine';
export const SOURCE_PREDICTED = 'predicted';

const asArray = (v) => (Array.isArray(v) ? v : []);

/** `[1, 2, 3, 5]` → `1–3,5`: queue positions as a badge reads them. */
export function positionsText(positions) {
    const xs = [...positions].sort((a, b) => a - b);
    const runs = [];
    for (const x of xs) {
        const last = runs[runs.length - 1];
        if (last && x === last[1] + 1) last[1] = x;
        else runs.push([x, x]);
    }
    return runs.map(([a, b]) => (a === b ? `${a}` : b === a + 1 ? `${a},${b}` : `${a}–${b}`)).join(',');
}

/**
 * The machine that leads initiative `initiativeId`'s Any-machine work, as the
 * claim `ownClaimId` sees it — null when the claims cannot say.
 *
 * @param {Object[]} liveClaims  claim rows (`id`, `pipeline_fk`, `initiative_fk`,
 *                               `machine_fk`) — live ones only
 */
export function leadMachineOf(initiativeId, { liveClaims, ownClaimId, ownMachineId, role }) {
    const byId = new Map(asArray(liveClaims).map((c) => [c.id, c]));
    const machineOfClaim = (id) => (byId.has(id) ? byId.get(id).machine_fk ?? null : null);
    const verdict = ownClaimId != null ? resolveRoles(liveClaims).get(ownClaimId) : null;
    if (!verdict) return role === ROLE_LEAD ? ownMachineId ?? null : null;
    if (verdict.role === ROLE_LEAD) {
        const defer = asArray(verdict.defers).find((d) => (d.initiative_fk ?? null) === (initiativeId ?? null));
        return defer ? machineOfClaim(defer.lead_id) : ownMachineId ?? null;
    }
    if (verdict.role === ROLE_SUBSCRIBER) return machineOfClaim(verdict.lead_id);
    if (verdict.role === ROLE_REFUSED) return machineOfClaim(verdict.blocker_id);
    return null;
}

/**
 * Where one queue item would run: the machine it is pinned to, else the lead
 * of its initiative. A MACHINE_PIN item's detail names its machine directly
 * ('Any' — another engine leads it).
 */
export function launchMachineOf(item, { requirements, epicInitiative, lead }) {
    const initiativeId = epicInitiative.get(item.epicId) ?? null;
    if (item.code === 'MACHINE_PIN' && item.rawDetail) {
        const to = item.rawDetail.pinned_to;
        if (to !== 'Any' && to != null) return to;
        return lead(initiativeId);
    }
    const pin = (requirements.get(item.requirementId) || {}).machine_fk ?? null;
    return pin != null ? pin : lead(initiativeId);
}

/**
 * The overlay for one record.
 *
 * @param {Object} record        an engine decision record (or a prediction)
 * @param {Object} ctx
 * @param {string} ctx.source    SOURCE_ENGINE | SOURCE_PREDICTED
 * @param {Object} [ctx.payload] the composed read — requirement pins and epic initiatives
 * @param {Object[]} [ctx.liveClaims]  the live claim rows the role rule reads
 * @param {Map} [ctx.outcomes]   executor outcomes by requirement (engine records only)
 */
export function planOverlay(record, { source, payload = null, liveClaims = [], outcomes } = {}) {
    if (!record) return null;
    const view = recordView(record, { outcomes: outcomes || new Map() });
    if (!view) return null;
    const rawQueue = asArray(record.queue);
    const requirements = new Map(asArray(payload && payload.requirements).map((r) => [r.id, r]));
    const epicInitiative = new Map();
    for (const row of asArray(payload && payload.derived && payload.derived.rows)) {
        epicInitiative.set(row.id, row.initiative_id ?? null);
    }
    for (const e of view.epics) epicInitiative.set(e.epicId, e.initiativeId);
    const location = record.location || {};
    const leadCache = new Map();
    const lead = (initiativeId) => {
        const key = initiativeId ?? null;
        if (!leadCache.has(key)) {
            leadCache.set(key, leadMachineOf(key, { liveClaims, ownClaimId: location.claim_id,
                ownMachineId: location.machine_fk, role: location.role }));
        }
        return leadCache.get(key);
    };

    const queue = view.queue.map((item) => {
        const withRaw = { ...item, rawDetail: (rawQueue[item.index] || {}).detail || null };
        const machineId = launchMachineOf(withRaw, { requirements, epicInitiative, lead });
        // A prediction has no executor to wait on; only a published admission does.
        const outcome = source === SOURCE_PREDICTED ? null : item.outcome;
        return { ...item, machineId, outcome };
    });

    const byEpic = new Map();
    for (const item of queue) {
        if (!byEpic.has(item.epicId)) byEpic.set(item.epicId, []);
        byEpic.get(item.epicId).push(item);
    }
    const badges = new Map();
    const badgeFor = (epicId, epic) => {
        const items = byEpic.get(epicId) || [];
        const positions = items.map((i) => i.position);
        const code = epic ? epic.code : (items[0] ? items[0].code : null);
        return {
            epicId,
            initiativeId: epicInitiative.get(epicId) ?? null,
            code,
            label: epic ? epic.label : (items[0] ? items[0].label : ''),
            words: epic ? epic.words : (items[0] ? items[0].words : ''),
            detail: epic ? epic.detail : (items[0] ? items[0].detail : ''),
            held: code !== 'ADMITTED',
            positions,
            text: positions.length ? positionsText(positions) : (epic ? epic.label : ''),
            // Every launch of this epic falls after the cut.
            belowCut: items.length > 0 && items.every((i) => i.belowCut),
            // The cut line falls immediately before one of this epic's launches.
            cutBefore: view.cutShown && items.some((i) => i.index === view.cut),
            items,
        };
    };
    for (const e of view.epics) badges.set(e.epicId, badgeFor(e.epicId, e));
    for (const epicId of byEpic.keys()) if (!badges.has(epicId)) badges.set(epicId, badgeFor(epicId, null));

    const l = view.limits;
    return {
        source,
        recordId: view.id,
        seq: view.seq,
        now: view.now,
        verdict: view.verdict,
        verdictDetail: view.verdictDetail,
        ok: view.ok,
        role: location.role ?? null,
        machineId: location.machine_fk ?? null,
        limits: l,
        limitsKnown: l.ceiling != null && l.live != null,
        queue,
        cut: view.cut,
        cutShown: view.cutShown,
        admittedCount: view.admittedCount,
        badges,
        events: view.events,
    };
}

/** True when an engine-sourced admission is still waiting on the executor. */
export const isPendingOutcome = (item) => !!item.outcome && item.outcome.state === OUTCOME_PENDING;

/**
 * The capacity reading a FIRST cycle on `machineId` would get (R8, I9): the
 * machine's ceiling, its live sessions, and what OTHER engines on it hold in
 * flight. Null members are unknown, which the prediction answers with
 * CAPACITY-UNKNOWN exactly as the engine would.
 *
 * @param {Object[]} sessions          rows with `machine_fk`, `swarm_status`
 * @param {number[]} inFlightElsewhere requirement ids other fresh engines on the machine hold
 */
export const LIVE_SESSION_STATUSES = ['starting', 'waiting', 'planning', 'active', 'review', 'completing'];
export function predictionCapacity({ machine, sessions, sessionsKnown = true, inFlightElsewhere = [] }) {
    const ceiling = machine && Number.isInteger(machine.max_live_sessions) ? machine.max_live_sessions : null;
    const live = sessionsKnown && machine
        ? asArray(sessions).filter((s) => s.machine_fk === machine.id
            && LIVE_SESSION_STATUSES.includes(s.swarm_status)).length
        : null;
    return { ceiling, live, reserved_elsewhere: new Set(inFlightElsewhere).size };
}

/**
 * The claims input of a FIRST cycle for the whole-plan scope on `machineId`:
 * every live claim but this engine's own (an engine that is off holds none),
 * plus the one it would take — the next id, so it ranks after every holder.
 *
 * @param {Object[]} claimRows  orchestration_claims rows, each with `stale`
 */
export function predictionClaims({ claimRows, pipelineId, machineId }) {
    const live = asArray(claimRows).map((c) => ({
        id: c.id, pipeline_fk: c.pipeline_fk ?? null, initiative_fk: c.initiative_fk ?? null,
        machine_fk: c.machine_fk ?? null, stale: !!c.stale,
    }));
    const wouldBe = Math.max(0, ...live.map((c) => c.id)) + 1;
    live.push({ id: wouldBe, pipeline_fk: pipelineId, initiative_fk: null, machine_fk: machineId,
        stale: false });
    return {
        own: { claim_id: wouldBe, machine_fk: machineId, terminal_pid: null, engine_pid: null,
            pipeline_id: pipelineId, initiative_id: null },
        live,
        proven: true,
    };
}
