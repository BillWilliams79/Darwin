// engineModel.js — Orchestration Engine 2's published rows, as a reader sees
// them (req #3760). Pure: rows in, view models out, no React, no fetch.
//
// WHAT IT READS. The req #3756 data contract and nothing else
// (memory/engine-2-data-contract.md):
//   engine_states            desired on/off + the supervisor's actual state
//   engine_heartbeats        location (R7) + health JSON (R4), `beat_at` DB-stamped
//   engine_decision_records  one per cycle per scope; `record` is the decision
//   engine_outcomes          the executor's pending / landed / failed per admission
//
// HEALTH IS DERIVED, NEVER STORED — `engineHealth` below is the browser's copy
// of `engine_health` in darwin-mcp/services/engine2.py, for the reason
// orchestrationHolder.js gives for its own copy: the browser reaches
// Lambda-Rest, not the daemon, so it gets raw columns and derives the same
// fact here. THE AGE IS THE ANSWER: a silent engine reads `missing` because its
// last beat is old, never because a row is absent — the beat row survives, so
// the page can say how long it has been quiet.
//
// A RECORD IS RENDERED AS IT IS (rule R2): the queue in its own order, the cut
// where the record put it, each code in the vocabulary's words. Nothing here
// re-decides anything.

import { humanDuration, parseUtc } from '../pipelines/orchestrationHolder';
import {
    HEALTH_DEGRADED, HEALTH_MISSING, HEALTH_OK, HEALTH_STOPPED, MISSING_AFTER_SECONDS,
    OUTCOME_PENDING, VERDICT_OK, codeLabel, detailText, eventText, plainWords,
} from './engineVocabulary';

export { humanDuration, parseUtc };

const asArray = (v) => (Array.isArray(v) ? v : []);
const numOrNull = (v) => (v == null || v === '' || Number.isNaN(Number(v)) ? null : Number(v));

/** JSON columns arrive as objects from Lambda-Rest's JSON_OBJECT; tolerate a string. */
export function parseJsonColumn(value) {
    if (value == null) return null;
    if (typeof value === 'object') return value;
    try {
        return JSON.parse(value);
    } catch {
        return null;
    }
}

/** `p:10|i:-|m:3` — one engine is one scope on one machine (uq_engine_states_scope). */
export function scopeKey(pipelineFk, initiativeFk, machineFk) {
    return `p:${pipelineFk ?? '-'}|i:${initiativeFk ?? '-'}|m:${machineFk ?? '-'}`;
}

const ageSeconds = (stamp, now) => {
    const at = parseUtc(stamp);
    if (!at) return null;
    // Floored, as darwin-mcp's `int(total_seconds())` is: a beat 180.6 s old is
    // fresh there, so it is fresh here.
    return Math.max(0, Math.floor((now.getTime() - at.getTime()) / 1000));
};

/**
 * `{health, ageSeconds}` for one engine — darwin-mcp `engine_health`, verbatim
 * in precedence:
 *   fresh beat                 'degraded' if it counts failed cycles, else 'ok'
 *   no fresh beat, desired off 'stopped' (off is never 'missing')
 *   no fresh beat, desired on  'missing'
 * `ageSeconds` is null only when there never was a readable beat.
 */
export function engineHealth(state, beat, now = new Date()) {
    let age = null;
    if (beat) age = ageSeconds(beat.beat_at, now) ?? ageSeconds(beat.create_ts, now);
    const fresh = age != null && age <= MISSING_AFTER_SECONDS;
    if (fresh) {
        const health = parseJsonColumn(beat.health) || {};
        const degraded = health.degraded_count;
        return { health: Number.isInteger(degraded) && degraded > 0 ? HEALTH_DEGRADED : HEALTH_OK,
            ageSeconds: age };
    }
    if ((state || {}).desired_state === 'off') return { health: HEALTH_STOPPED, ageSeconds: age };
    return { health: HEALTH_MISSING, ageSeconds: age };
}

/**
 * When an engine that is OFF stopped: the supervisor's report of `stopped`
 * when there is one, else the moment it was switched off, else its last beat.
 */
export function stoppedAt(state, beat) {
    if (!state) return null;
    if (state.actual_state === 'stopped' && state.actual_at) return state.actual_at;
    return state.desired_at || (beat && beat.beat_at) || null;
}

/** Records in cycle order: id is insertion order, the one order retention keeps. */
export function sortRecordRows(rows) {
    return asArray(rows).slice().sort((a, b) => (a.id ?? 0) - (b.id ?? 0));
}

/**
 * Every engine the rows describe: one per `engine_states` row, joined to its
 * heartbeat and to the record rows of its scope. Records with no state row
 * (impossible through `publish_engine_cycle`, which adopts a scope first) are
 * not shown as engines.
 */
export function assembleEngines({ states, heartbeats, records, now = new Date() }) {
    const beatByState = new Map(asArray(heartbeats).map((b) => [b.engine_state_fk, b]));
    const recordsByScope = new Map();
    for (const r of sortRecordRows(records)) {
        const k = scopeKey(r.pipeline_fk, r.initiative_fk, r.machine_fk);
        if (!recordsByScope.has(k)) recordsByScope.set(k, []);
        recordsByScope.get(k).push(r);
    }
    return asArray(states).map((state) => {
        const beat = beatByState.get(state.id) || null;
        const key = scopeKey(state.pipeline_fk, state.initiative_fk, state.machine_fk);
        const history = recordsByScope.get(key) || [];
        const { health, ageSeconds: beatAge } = engineHealth(state, beat, now);
        const off = state.desired_state === 'off';
        return {
            key,
            id: state.id,
            state,
            beat,
            healthJson: beat ? parseJsonColumn(beat.health) : null,
            health,
            beatAgeSeconds: beatAge,
            off,
            stoppedAt: off ? stoppedAt(state, beat) : null,
            pipelineId: state.pipeline_fk,
            initiativeId: state.initiative_fk ?? null,
            machineId: state.machine_fk,
            history,
            latest: history.length ? history[history.length - 1] : null,
        };
    }).sort((a, b) => (a.machineId ?? 0) - (b.machineId ?? 0)
        || (a.pipelineId ?? 0) - (b.pipelineId ?? 0)
        || (a.initiativeId ?? 0) - (b.initiativeId ?? 0));
}

/** Engines whose scope is in plan `pipelineId` — the plan page's Engine mode. */
export function enginesForPipeline(engines, pipelineId) {
    return asArray(engines).filter((e) => e.pipelineId === pipelineId);
}

/** `{requirementId: outcome row}` for the record row `recordRowId`. */
export function outcomesByRequirement(outcomeRows, recordRowId) {
    const out = new Map();
    for (const row of asArray(outcomeRows)) {
        if (recordRowId != null && row.record_fk !== recordRowId) continue;
        out.set(row.requirement_fk, {
            state: row.outcome_state || OUTCOME_PENDING,
            sessionIds: asArray(parseJsonColumn(row.session_ids)),
            reason: row.reason || null,
            updatedAt: row.update_ts || row.create_ts || null,
        });
    }
    return out;
}

/**
 * One decision record as a reader reads it.
 *
 * `queue` keeps the record's order; `cut` is the record's own index of the
 * first item no slot was left for (`queue.length` when every item had one or
 * none needed one), so the line is drawn BEFORE `queue[cut]` and nowhere else.
 * Items after the cut may still read IN_FLIGHT or MACHINE_PIN — the cut is the
 * slots running out, not a partition of the codes.
 *
 * An ADMITTED item carries the executor's answer for THIS record's admission
 * (`outcomes`, from `engine_outcomes`); an IN_FLIGHT item carries the outcome
 * the record itself saw when it decided (`detail.outcome`).
 *
 * `names` (`{ epics, initiatives }` Maps, optional) puts titles on the epics
 * and initiatives the details and events mention (req #3878).
 */
export function recordView(record, { outcomes = new Map(), names = null } = {}) {
    if (!record || typeof record !== 'object') return null;
    const cycle = record.cycle || {};
    const queueIn = asArray(record.queue);
    const cut = Number.isInteger(record.cut) ? record.cut : queueIn.length;
    const queue = queueIn.map((item, index) => {
        let outcome = null;
        if (item.code === 'ADMITTED') {
            outcome = outcomes.get(item.requirement_id)
                || { state: OUTCOME_PENDING, sessionIds: [], reason: null, updatedAt: null };
        } else if (item.code === 'IN_FLIGHT' && item.detail && item.detail.outcome) {
            outcome = { state: item.detail.outcome, sessionIds: [], reason: null, updatedAt: null };
        }
        return {
            index,
            position: index + 1,
            epicId: item.epic_id,
            requirementId: item.requirement_id,
            code: item.code,
            label: codeLabel(item.code),
            words: plainWords(item.code),
            detail: detailText(item.code, item.detail, names),
            belowCut: index >= cut,
            outcome,
        };
    });
    const epics = asArray(record.epics).map((e) => ({
        epicId: e.epic_id,
        initiativeId: e.initiative_id ?? null,
        code: e.code,
        label: codeLabel(e.code),
        words: plainWords(e.code),
        detail: detailText(e.code, e.detail, names),
        requirementIds: asArray(e.items).map((i) => i.requirement_id),
    }));
    const events = asArray(record.events).map((ev) => ({ code: ev.code, label: codeLabel(ev.code),
        text: eventText(ev, names) }));
    const limits = record.limits || {};
    return {
        id: record.id,
        seq: cycle.seq ?? null,
        now: cycle.now ?? null,
        verdict: cycle.verdict || null,
        verdictDetail: cycle.verdict_detail || null,
        ok: cycle.verdict === VERDICT_OK,
        location: record.location || {},
        limits: {
            ceiling: numOrNull(limits.ceiling),
            live: numOrNull(limits.live),
            reserved: numOrNull(limits.reserved),
            free: numOrNull(limits.free),
            // This engine's part of the free slots (req #3807); null on a record
            // from before the fair share, which took them all.
            share: numOrNull(limits.share),
        },
        queue,
        cut,
        cutShown: queue.length > 0 && cut < queue.length,
        admittedCount: queue.filter((q) => q.code === 'ADMITTED').length,
        epics,
        events,
    };
}

/**
 * What changed from `prev` to `next` (two records of one scope), in sentences
 * — the history strip's answer to "what changed and when". Empty when nothing
 * a reader would see moved.
 */
export function recordChanges(prev, next, names = null) {
    if (!next) return [];
    if (!prev) return ['first record in the history shown'];
    const out = [];
    const pc = prev.cycle || {};
    const nc = next.cycle || {};
    if (pc.verdict !== nc.verdict) out.push(`verdict ${pc.verdict} → ${nc.verdict}`);
    const pl = prev.limits || {};
    const nl = next.limits || {};
    for (const k of ['ceiling', 'live', 'reserved', 'free', 'share']) {
        if (pl[k] !== nl[k]) out.push(`${k} ${pl[k] ?? '—'} → ${nl[k] ?? '—'}`);
    }
    const before = new Map(asArray(prev.queue).map((i) => [i.requirement_id, i]));
    const after = new Map(asArray(next.queue).map((i) => [i.requirement_id, i]));
    for (const [rid, item] of after) {
        const was = before.get(rid);
        if (!was) out.push(`requirement ${rid} joined the queue as ${codeLabel(item.code)}`);
        else if (was.code !== item.code) {
            out.push(`requirement ${rid}: ${codeLabel(was.code)} → ${codeLabel(item.code)}`);
        }
    }
    for (const rid of before.keys()) {
        if (!after.has(rid)) out.push(`requirement ${rid} left the queue`);
    }
    if (prev.cut !== next.cut && after.size) out.push(`the cut moved ${prev.cut} → ${next.cut}`);
    for (const ev of asArray(next.events)) out.push(eventText(ev, names));
    return out;
}

/** One history-strip cell per light record row, oldest first. */
export function historyCells(rows) {
    return sortRecordRows(rows).map((r) => ({
        id: r.id,
        seq: r.seq,
        at: r.cycle_at || r.create_ts || null,
        verdict: r.verdict,
        ok: r.verdict === VERDICT_OK,
        admitted: Number(r.admitted_count) || 0,
        queued: Number(r.queue_count) || 0,
        cut: Number(r.cut) || 0,
    }));
}

/**
 * `whole plan Darwin` / `initiative Engine of plan Darwin` — the title names
 * the plan and the initiative; the id stands in only when no title is known
 * (req #3878).
 */
export function scopeText(pipelineId, initiativeId, { pipelineTitle, initiativeTitle } = {}) {
    const plan = `plan ${pipelineTitle || pipelineId}`;
    if (initiativeId == null) return `whole ${plan}`;
    return `initiative ${initiativeTitle || initiativeId} of ${plan}`;
}

/** `43s ago` / `—` for a nullable age. */
export function agoText(seconds) {
    return seconds == null ? 'never' : `${humanDuration(seconds)} ago`;
}

/**
 * How often the supervisor restarted this engine — the heartbeat's
 * `health.restarts` (req #3869), worded as `run.py status` words it. `null` is
 * an engine the supervisor did not start; an absent key is a beat from an
 * engine that predates the field.
 */
export function restartsText(health) {
    if (!health || !('restarts' in health)) return '—';
    const n = health.restarts;
    if (n == null) return 'not supervised';
    if (n === 0) return 'not restarted';
    return `restarted ${n} time${n === 1 ? '' : 's'}`;
}

/** A UTC stamp in the reader's zone, or '—'. */
export function stampText(stamp, timezone) {
    const at = parseUtc(stamp);
    if (!at) return '—';
    try {
        return at.toLocaleString(undefined, {
            ...(timezone ? { timeZone: timezone } : {}),
            month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit',
        });
    } catch {
        return at.toISOString();
    }
}
