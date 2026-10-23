// enginePredict.js — what Orchestration Engine 2 WOULD decide, with no engine
// running (req #3762). Pure: the composed read, a capacity reading and the
// live claims in; a decision record out.
//
// ONE COPY FOR THE BROWSER, LIKE THE VOCABULARY. The authority is
// `scripts/swarm/engine2/core.py` `decide()`. The plan overlay draws the
// engine's own latest record whenever the engine for this scope is on and has
// published one — that record is never re-decided here (rule R2). With the
// engine OFF there is no record, and the plan overlay still has to say what
// would launch, in what order and where the slots run out. That answer is
// decide() over the same inputs the engine would be handed on its first cycle:
// the composed read (whose `derived.launch_queue` is computed server-side by
// Lambda-Rest, so the ORDER is never the browser's), the machine's capacity,
// the live claims plus the claim this engine would take, and no prior record.
//
// The browser cannot run Python, so this file is decide()'s queue, cut, epic
// and limit logic, transcribed. `__tests__/planOverlayFixture.json` holds
// decide()'s own answer over every cycle of the scenario corpus
// (scripts/swarm/engine2/overlay_fixture.py, held current by
// tests/engine/test_overlay_fixture.py) and `enginePredict.test.js` fails on
// any difference. Do not "simplify" this away from core.py; change both, then
// regenerate.
//
// WHAT A FIRST CYCLE CANNOT HAVE: no prior record, so no IN_FLIGHT item, no
// debounce, no executor outcomes and no events. Everything else is decide().

import { ROLE_LEAD, ROLE_SUBSCRIBER, resolveRoles } from '../pipelines/orchestrationHolder';

export const SCHEMA = 'engine2.decision_record/1';
export const VERDICT_OK = 'OK';
// The derivation's double-seat violation (core.SEAT_VIOLATION).
const SEAT_VIOLATION = 'one-epic-per-requirement';

// core.py WITHHELD_VERDICTS.
const WITHHELD_VERDICTS = {
    derivation_failed: 'DERIVATION-FAILED',
    budget_derived_only: 'BUDGET-DERIVED-ONLY',
    budget_rows_truncated: 'BUDGET-ROWS-TRUNCATED',
};

const isDict = (v) => v != null && typeof v === 'object' && !Array.isArray(v);
const isInt = (v) => typeof v === 'number' && Number.isInteger(v);
const asList = (v) => (Array.isArray(v) ? v : []);

// Python's str() and repr() for the values a verdict detail interpolates, so
// the sentence matches core.py's byte for byte.
const pyStr = (v) => {
    if (v === null || v === undefined) return 'None';
    if (v === true) return 'True';
    if (v === false) return 'False';
    return String(v);
};
const pyRepr = (v) => (typeof v === 'string' ? `'${v}'` : pyStr(v));

/** core.py `_utc_text` + `parse_time`: a stamp as a Date, or null. */
export function parseTime(value) {
    if (typeof value !== 'string' || !value) return null;
    let text = value.trim();
    if (!text.endsWith('Z') && !text.slice(10).includes('+')) text = `${text}Z`;
    const ms = Date.parse(text.replace(' ', 'T'));
    return Number.isNaN(ms) ? null : new Date(ms);
}

const formatTime = (d) => `${d.toISOString().slice(0, 19)}Z`;

function declaredEpicCount(payload, initiativeId) {
    if (initiativeId == null) return (payload.pipeline || {}).epic_count;
    for (const ini of asList(payload.initiatives)) {
        if (isDict(ini) && ini.id === initiativeId) return ini.epic_count;
    }
    return null;
}

/** core.py `validate_payload`: null when the payload is whole, else [verdict, detail]. */
export function validatePayload(payload, pipelineId, initiativeId) {
    if (!isDict(payload)) return ['FATAL', 'no plan payload'];
    const marker = Object.keys(payload).find((k) => k.startsWith('_trunc'));
    if (marker) return ['BUDGET-ROWS-TRUNCATED', `payload carries ${marker}`];
    if (initiativeId != null) {
        const actual = (payload.pipeline || {}).id;
        if (actual != null && actual !== pipelineId) {
            return ['SCOPE-MISMATCH', `initiative ${pyStr(initiativeId)} belongs to plan `
                + `${pyStr(actual)}, not ${pyStr(pipelineId)}`];
        }
    }
    const epics = asList(payload.epics);
    const declared = declaredEpicCount(payload, initiativeId);
    if (declared != null && declared !== epics.length) {
        return ['BUDGET-ROWS-TRUNCATED', `epic_count=${pyStr(declared)} but ${epics.length} epics`];
    }
    const derived = payload.derived;
    if (!isDict(derived)) return ['NO-DERIVATION', 'the composed read carries no derived block'];
    if (derived.withheld) {
        const code = derived.withheld_reason;
        return [WITHHELD_VERDICTS[code] || 'DERIVATION-WITHHELD',
            `${code || 'no reason code'}: ${pyStr(derived.reason).slice(0, 200)}`];
    }
    if (derived.rows_complete === false) {
        return ['BUDGET-ROWS-TRUNCATED', 'derived block declares rows_complete=false'];
    }
    const rows = derived.rows;
    const distinct = new Set(epics.filter(isDict).map((s) => s.id ?? null)).size;
    if (!Array.isArray(rows) || rows.length !== distinct) {
        return ['DERIVATION-SHORTFALL', `${distinct} epics, `
            + `${Array.isArray(rows) ? rows.length : 'no'} derived rows`];
    }
    if (rows.some((row) => !isDict(row) || !('id' in row))) {
        return ['DERIVATION-SHORTFALL', 'a derived row carries no id'];
    }
    const order = derived.display_order;
    const sortedText = (xs) => xs.map((x) => pyStr(x)).sort();
    if (!Array.isArray(order)
        || JSON.stringify(sortedText(order)) !== JSON.stringify(sortedText(rows.map((r) => r.id)))) {
        return ['ORDER-SHORTFALL', 'display_order does not name exactly the derived rows'];
    }
    if (!isDict(derived.pause)) return ['NO-PAUSE-DERIVATION', 'the derived block carries no pause state'];
    if (!isDict(derived.serial)) return ['NO-SERIAL-DERIVATION', 'the derived block carries no serial state'];
    if (!Array.isArray(derived.launch_queue)) {
        return ['NO-LAUNCH-QUEUE', 'the derived block carries no launch_queue'];
    }
    const stale = rows.filter((row) => !Array.isArray(row.open_req_ids)).map((row) => row.id);
    if (stale.length) {
        return ['NO-OPEN-WORK', `rows without open_req_ids, first: epic ${pyStr(stale[0])}`];
    }
    return null;
}

/** core.py `_claim_verdict`: [verdict, detail, roleVerdict]. */
function claimVerdict(claims) {
    const own = claims.own || {};
    if (claims.proven !== true) return ['RESERVATION-UNPROVEN', 'the claim could not be proven alive', null];
    const live = asList(claims.live).filter((r) => isDict(r) && !r.stale);
    const mine = live.find((r) => r.id === own.claim_id);
    if (!mine) {
        return ['RESERVATION-LOST', `claim ${pyStr(own.claim_id)} is not among the live claims`, null];
    }
    const pipelineId = own.pipeline_id;
    if ((mine.pipeline_fk ?? null) !== (pipelineId ?? null)
        || (mine.initiative_fk ?? null) !== (own.initiative_id ?? null)) {
        return ['RESERVATION-LOST', `claim ${pyStr(own.claim_id)} holds a different scope`, null];
    }
    const roles = resolveRoles(live.filter((r) => (r.pipeline_fk ?? null) === (pipelineId ?? null)));
    return [null, null, roles.get(own.claim_id) || null];
}

/** core.py `_capacity_verdict`. */
function capacityVerdict(capacity) {
    if (!isDict(capacity)) return ['CAPACITY-UNKNOWN', 'no capacity reading'];
    for (const field of ['ceiling', 'live']) {
        const value = capacity[field];
        if (!isInt(value) || value < 0) return ['CAPACITY-UNKNOWN', `${field} is ${pyRepr(value)}`];
    }
    return [null, null];
}

/** core.py `epic_hold`: [code, detail] for the first epic-level code that applies, or [null, null]. */
export function epicHold(row, serial, derivedNow) {
    const by = asList(row.suppressed_by);
    const paused = by.filter((s) => s === 'pipeline' || s === 'initiative')
        .map((s) => (s === 'pipeline' ? 'plan' : 'initiative'));
    if (paused.length) return ['PAUSED', { by: paused }];
    if (by.includes('turn')) return ['SERIAL_TURN', { live_initiative_id: serial.live_initiative_id ?? null }];
    if (asList(row.checkpoint_blocked_by).length) {
        return ['BARRIER', { barrier_epic_ids: [...row.checkpoint_blocked_by] }];
    }
    const launchIds = [...asList(row.launch_req_ids)];
    const start = parseTime(row.not_before);
    if ((launchIds.length && !row.launch_candidate)
        || (start && derivedNow && start.getTime() > derivedNow.getTime())) {
        return ['NOT_BEFORE', { not_before: row.not_before ?? null }];
    }
    if (!launchIds.length) return ['NO_WORK', { reason: row.no_launch_reason ?? null }];
    if (row.run === 'manual') return ['MANUAL', { requirement_ids: launchIds }];
    return [null, null];
}

/**
 * decide() for a FIRST cycle (no prior record): the decision record an engine
 * started now would publish, minus the fields only a prior can fill.
 *
 * @param {Object} payload   the composed read, verbatim
 * @param {?Object} capacity {ceiling, live, reserved_elsewhere}
 * @param {Object} claims    {own, live, proven} — core.py's claims input
 * @param {{now: string}} clock
 */
export function predictRecord(payload, capacity, claims, clock) {
    claims = claims || {};
    const own = claims.own || {};
    const pipelineId = own.pipeline_id ?? null;
    const initiativeId = own.initiative_id ?? null;
    const now = parseTime((clock || {}).now);

    let [verdict, verdictDetail, roleVerdict] = claimVerdict(claims);
    const payloadProblem = validatePayload(payload, pipelineId, initiativeId);
    if (verdict == null && payloadProblem) [verdict, verdictDetail] = payloadProblem;
    if (verdict == null && now == null) [verdict, verdictDetail] = ['FATAL', 'clock.now is not a timestamp'];
    if (verdict == null) [verdict, verdictDetail] = capacityVerdict(capacity);
    verdict = verdict || VERDICT_OK;
    const payloadOk = payloadProblem == null;

    const role = (roleVerdict || {}).role ?? null;
    const defers = new Set(asList((roleVerdict || {}).defers).map((d) => d.initiative_fk ?? null));

    // -- the scope's rows, in display order ---------------------------------
    let derived = isDict(payload) ? payload.derived : null;
    derived = isDict(derived) ? derived : {};
    const rawRows = Array.isArray(derived.rows) ? derived.rows : [];
    const byId = new Map();
    for (const row of rawRows) if (isDict(row) && 'id' in row) byId.set(row.id, row);
    const order = payloadOk ? derived.display_order : [...byId.keys()];
    const inScope = asList(order).filter((s) => byId.has(s)).map((s) => byId.get(s))
        .filter((row) => initiativeId == null || row.initiative_id === initiativeId);
    const scopeIds = new Set(inScope.map((row) => row.id));
    const serial = isDict(derived.serial) ? derived.serial : {};
    const derivedNow = parseTime(derived.now);
    const requirements = new Map();
    if (isDict(payload)) {
        for (const req of asList(payload.requirements)) {
            if (isDict(req) && 'id' in req) requirements.set(req.id, req);
        }
    }

    const candidates = inScope.filter((row) => Array.isArray(row.open_req_ids) && row.open_req_ids.length);
    const rawQueue = Array.isArray(derived.launch_queue) ? derived.launch_queue : [];
    // A REQUIREMENT SEATED ON TWO EPICS IS NEVER ADMITTED — core.decide()'s rule
    // (req #3757 review): each seat named by a `one-epic-per-requirement`
    // violation is an ENGINE_HOLD item, taking no slot; any other repeat in the
    // queue keeps its first entry only.
    const doubleSeated = new Map();
    for (const v of payloadOk ? asList(derived.violations) : []) {
        if (isDict(v) && v.invariant === SEAT_VIOLATION) {
            doubleSeated.set(v.requirement_id ?? null, asList(v.epic_ids).slice());
        }
    }
    const queueIn = [];
    const queuedUnder = new Set();
    for (const q of rawQueue) {
        if (!isDict(q) || !scopeIds.has(q.epic_id)) continue;
        const rid = q.requirement_id ?? null;
        if (queuedUnder.has(rid) && !doubleSeated.has(rid)) continue;
        queuedUnder.add(rid);
        queueIn.push(q);
    }

    // -- epic-level codes ----------------------------------------------------
    const epicCode = new Map();
    for (const row of candidates) {
        epicCode.set(row.id, verdict !== VERDICT_OK
            ? ['ENGINE_HOLD', { verdict }] : epicHold(row, serial, derivedNow));
    }

    const machine = own.machine_fk ?? null;
    const pinnedAway = (rid, row) => {
        const pin = (requirements.get(rid) || {}).machine_fk ?? null;
        if (role !== ROLE_LEAD && role !== ROLE_SUBSCRIBER) return pin == null ? 'Any' : pin;
        if (pin == null) {
            const leads = role === ROLE_LEAD && !defers.has(row.initiative_id ?? null);
            return leads ? null : 'Any';
        }
        return machine != null && pin === machine ? null : pin;
    };

    // -- item-level codes over the launch queue ------------------------------
    const items = queueIn.map((q) => {
        let [code, detail] = epicCode.get(q.epic_id) || [null, null];
        if (verdict !== VERDICT_OK) [code, detail] = ['ENGINE_HOLD', { verdict }];
        return { epic_id: q.epic_id, requirement_id: q.requirement_id ?? null, code, detail };
    });
    for (const item of items) {
        if (item.code != null) continue;
        if (doubleSeated.has(item.requirement_id)) {
            item.code = 'ENGINE_HOLD';
            item.detail = { violation: SEAT_VIOLATION, epic_ids: doubleSeated.get(item.requirement_id) };
            continue;
        }
        const away = pinnedAway(item.requirement_id, byId.get(item.epic_id));
        if (away != null) {
            item.code = 'MACHINE_PIN';
            item.detail = { pinned_to: away, role };
        }
    }

    // -- limits (no prior: nothing of this engine's is reserved) -------------
    const limits = { ceiling: null, live: null, reserved: null, free: null };
    if (isDict(capacity) && capacityVerdict(capacity)[0] == null) {
        const reserved = Math.trunc(Number(capacity.reserved_elsewhere) || 0);
        limits.ceiling = capacity.ceiling;
        limits.live = capacity.live;
        limits.reserved = reserved;
        limits.free = Math.max(0, capacity.ceiling - capacity.live - reserved);
    }

    let slots = limits.free || 0;
    let cut = null;
    items.forEach((item, index) => {
        if (item.code != null) return;
        const row = byId.get(item.epic_id);
        if (slots > 0) {
            item.code = 'ADMITTED';
            item.detail = null;
            slots -= 1;
            return;
        }
        if (cut == null) cut = index;
        if (row.gate_open === false) {
            const waiting = asList(row.dep_ids).filter((d) => !byId.has(d)
                || asList(byId.get(d).open_req_ids).length > 0);
            item.code = 'DEP_PRIORITY';
            item.detail = { waiting_on_epic_ids: waiting };
        } else {
            item.code = 'CAPACITY';
            item.detail = null;
        }
    });
    if (cut == null) cut = items.length;

    const admitted = items.filter((i) => i.code === 'ADMITTED').map((i) => i.requirement_id);
    limits.in_flight_req_ids = [...new Set(admitted)].sort((a, b) => a - b);

    // -- epic rollup (R2) ----------------------------------------------------
    const itemsByEpic = new Map();
    for (const item of items) {
        if (!itemsByEpic.has(item.epic_id)) itemsByEpic.set(item.epic_id, []);
        itemsByEpic.get(item.epic_id).push(item);
    }
    const epics = candidates.map((row) => {
        let [code, detail] = epicCode.get(row.id);
        const mine = itemsByEpic.get(row.id) || [];
        if (code == null) {
            if (mine.some((i) => i.code === 'ADMITTED')) {
                code = 'ADMITTED';
            } else {
                const launchable = mine.filter((i) => i.code !== 'MACHINE_PIN');
                if (launchable.length) [code, detail] = [launchable[0].code, launchable[0].detail];
                else if (mine.length) [code, detail] = ['MACHINE_PIN', mine[0].detail];
                else [code, detail] = ['NO_WORK', { reason: 'launch-ready work absent from launch_queue' }];
            }
        }
        return {
            epic_id: row.id,
            initiative_id: row.initiative_id ?? null,
            code,
            detail,
            items: mine.map((i) => ({ requirement_id: i.requirement_id, code: i.code })),
        };
    });

    return {
        schema: SCHEMA,
        id: null,
        prior_id: null,
        predicted: true,
        location: {
            machine_fk: machine,
            terminal_pid: null,
            engine_pid: null,
            scope: { pipeline_id: pipelineId, initiative_id: initiativeId },
            role,
            claim_id: own.claim_id ?? null,
        },
        cycle: {
            seq: null,
            now: now ? formatTime(now) : null,
            verdict,
            verdict_detail: verdictDetail ?? null,
        },
        limits,
        queue: items,
        cut,
        epics,
        events: [],
    };
}
