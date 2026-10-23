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
// debounce, no executor outcomes and no events. Everything else is decide() —
// the fair share included (req #3807): other engines on the machine with work
// waiting are owed their part of the free slots.

import { ROLE_LEAD, ROLE_SUBSCRIBER, resolveRoles } from '../pipelines/orchestrationHolder';

export const SCHEMA = 'engine2.decision_record/1';
export const VERDICT_OK = 'OK';
// The derivation's double-seat violation (core.py SEAT_VIOLATION).
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
        if (!isInt(value) || value < 0) {
            const why = capacity.error ? ` — ${capacity.error}` : '';
            return ['CAPACITY-UNKNOWN', `${field} is ${pyRepr(value)}${why}`];
        }
    }
    return [null, null];
}

/** core.py `scope_label`: a scope in words. */
export const scopeLabel = (pipelineId, initiativeId) => (initiativeId == null
    ? `plan ${pyStr(pipelineId)}` : `initiative ${pyStr(initiativeId)} of plan ${pyStr(pipelineId)}`);

/** core.py `scope_key`: the fair share's last tie-break. */
export const scopeKey = (pipelineId, initiativeId) =>
    `${pyStr(pipelineId)}:${initiativeId == null ? '' : pyStr(initiativeId)}`;

const byIdThenText = (a, b) => {
    const ai = isInt(a);
    const bi = isInt(b);
    if (ai && bi) return a - b;
    if (ai !== bi) return ai ? -1 : 1;
    return pyStr(a) < pyStr(b) ? -1 : pyStr(a) > pyStr(b) ? 1 : 0;
};

/**
 * core.py `compose_capacity`: decide()'s capacity input from the machine's
 * reading and the in-flight read (`in_flight` items, `engines` with each live
 * engine's published limits). A peer's holding is recounted against what is
 * live or in flight now.
 */
export function composeCapacity(reading, flight, pipelineId, initiativeId) {
    const ownKey = scopeKey(pipelineId, initiativeId);
    const liveIds = new Set(asList(reading.live_req_ids));
    const inFlight = new Map();
    for (const item of asList(flight.in_flight)) {
        const key = scopeKey(item.pipeline_fk ?? null, item.initiative_fk ?? null);
        if (!inFlight.has(key)) inFlight.set(key, new Set());
        inFlight.get(key).add(item.requirement_id ?? null);
    }
    const elsewhere = new Set();
    for (const [key, ids] of inFlight) {
        if (key === ownKey) continue;
        for (const rid of ids) if (!liveIds.has(rid)) elsewhere.add(rid);
    }
    const peers = [];
    for (const engine of asList(flight.engines)) {
        const p = engine.pipeline_fk ?? null;
        const i = engine.initiative_fk ?? null;
        const waiting = engine.waiting;
        if (scopeKey(p, i) === ownKey || !isInt(waiting) || waiting <= 0) continue;
        const flying = inFlight.get(scopeKey(p, i)) || new Set();
        const holding = new Set(asList(engine.holding_req_ids)
            .filter((rid) => liveIds.has(rid) || flying.has(rid))).size;
        peers.push({ pipeline_id: p, initiative_id: i, holding, waiting,
            last_admitted_at: engine.last_admitted_at ?? null });
    }
    peers.sort((a, b) => {
        const ka = scopeKey(a.pipeline_id, a.initiative_id);
        const kb = scopeKey(b.pipeline_id, b.initiative_id);
        return ka < kb ? -1 : ka > kb ? 1 : 0;
    });
    return {
        ceiling: reading.ceiling,
        live: reading.live,
        reserved_elsewhere: elsewhere.size,
        live_req_ids: [...liveIds].sort(byIdThenText),
        peers,
    };
}

/**
 * core.py `fair_share`: [share, owedKeys]. Free slots go one at a time to the
 * contender with demand left holding fewest; ties to the oldest last admission
 * (null = never), then the lower scope key.
 */
export function fairShare(free, own, peers) {
    const contenders = [{ ...own }, ...peers.filter((p) => (p.demand || 0) > 0).map((p) => ({ ...p }))];
    if (contenders.length === 1) return [free, []];
    const got = new Map(contenders.map((c) => [c.key, 0]));
    const rank = (c) => [c.holding, c.last || '', c.key];
    const before = (a, b) => {
        const [x, y] = [rank(a), rank(b)];
        for (let k = 0; k < 3; k += 1) {
            if (x[k] < y[k]) return true;
            if (x[k] > y[k]) return false;
        }
        return false;
    };
    for (let n = 0; n < free; n += 1) {
        const open = contenders.filter((c) => c.demand > 0);
        if (!open.length) break;
        const pick = open.reduce((best, c) => (before(c, best) ? c : best));
        pick.holding += 1;
        pick.demand -= 1;
        got.set(pick.key, got.get(pick.key) + 1);
    }
    const owed = [...got].filter(([k, v]) => k !== own.key && v > 0).map(([k]) => k).sort();
    return [got.get(own.key), owed];
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
 * @param {?Object} capacity {ceiling, live, reserved_elsewhere, live_req_ids, peers}
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
    // A REQUIREMENT SEATED ON TWO EPICS IS NEVER ADMITTED (core.py, req #3757
    // review): every seat the derivation reports as a `one-epic-per-requirement`
    // violation is an ENGINE_HOLD item naming it. Any other repeat keeps its
    // first entry only.
    const doubleSeated = new Map();
    for (const violation of payloadOk ? asList(derived.violations) : []) {
        if (isDict(violation) && violation.invariant === SEAT_VIOLATION) {
            doubleSeated.set(violation.requirement_id ?? null, asList(violation.epic_ids));
        }
    }
    const queueIn = [];
    const queuedUnder = new Map();
    for (const q of rawQueue) {
        if (!isDict(q) || !scopeIds.has(q.epic_id)) continue;
        const rid = q.requirement_id ?? null;
        if (queuedUnder.has(rid) && !doubleSeated.has(rid)) continue;
        if (!queuedUnder.has(rid)) queuedUnder.set(rid, q.epic_id);
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
    const known = isDict(capacity) && capacityVerdict(capacity)[0] == null;
    const limits = { ceiling: null, live: null, reserved: null, free: null, share: null };
    if (known) {
        const reserved = Math.trunc(Number(capacity.reserved_elsewhere) || 0);
        limits.ceiling = capacity.ceiling;
        limits.live = capacity.live;
        limits.reserved = reserved;
        limits.free = Math.max(0, capacity.ceiling - capacity.live - reserved);
    }

    // -- the fair share (req #3807) — with no prior, what this engine holds is
    // its scope's live sessions only.
    const liveIds = new Set(known ? asList(capacity.live_req_ids) : []);
    const holdingIds = new Set();
    for (const row of inScope) for (const rid of asList(row.req_ids)) if (liveIds.has(rid)) holdingIds.add(rid);
    const launchable = items.filter((i) => i.code == null);
    const labels = new Map();
    const peers = (known ? asList(capacity.peers) : []).map((peer) => {
        const key = scopeKey(peer.pipeline_id ?? null, peer.initiative_id ?? null);
        labels.set(key, scopeLabel(peer.pipeline_id ?? null, peer.initiative_id ?? null));
        return { key, holding: peer.holding || 0, demand: peer.waiting || 0,
            last: peer.last_admitted_at ?? null };
    });
    const [share, owed] = fairShare(limits.free || 0, {
        key: scopeKey(pipelineId, initiativeId), holding: holdingIds.size,
        demand: launchable.length, last: null }, peers);
    const owedTo = owed.map((key) => labels.get(key));
    if (known) limits.share = share;

    let slots = share;
    let cut = null;
    let rank = -1;
    items.forEach((item, index) => {
        if (item.code != null) return;
        rank += 1;
        const row = byId.get(item.epic_id);
        if (slots > 0) {
            item.code = 'ADMITTED';
            item.detail = null;
            slots -= 1;
            return;
        }
        if (cut == null) cut = index;
        const owedHere = owedTo.length && rank < (limits.free || 0) ? { owed_to: owedTo } : null;
        if (row.gate_open === false) {
            const waiting = asList(row.dep_ids).filter((d) => !byId.has(d)
                || asList(byId.get(d).open_req_ids).length > 0);
            item.code = 'DEP_PRIORITY';
            item.detail = { waiting_on_epic_ids: waiting, ...(owedHere || {}) };
        } else {
            item.code = 'CAPACITY';
            item.detail = owedHere;
        }
    });
    if (cut == null) cut = items.length;

    const admittedItems = items.filter((i) => i.code === 'ADMITTED');
    const admitted = admittedItems.map((i) => i.requirement_id);
    limits.in_flight_req_ids = [...new Set(admitted)].sort((a, b) => a - b);
    limits.holding_req_ids = [...new Set([...holdingIds, ...admitted])].sort(byIdThenText);
    limits.holding = limits.holding_req_ids.length;
    limits.waiting = items.filter((i) => i.code === 'CAPACITY' || i.code === 'DEP_PRIORITY').length;
    limits.last_admitted_at = admitted.length && now ? formatTime(now) : null;
    // The cycle's ONE launch unit (core.launch_unit, req #3865): a first cycle
    // has no prior, so every id is on its first announcement.
    const launch = admittedItems.length ? {
        requirement_ids: admitted,
        items: admittedItems.map((i) => ({ requirement_id: i.requirement_id, epic_id: i.epic_id, attempt: 1 })),
    } : null;

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
                else {
                    const elsewhere = [...new Set(asList(row.launch_req_ids)
                        .filter((r) => queuedUnder.has(r) && queuedUnder.get(r) !== row.id)
                        .map((r) => queuedUnder.get(r)))].sort((a, b) => a - b);
                    [code, detail] = ['NO_WORK', { reason: elsewhere.length
                        ? `its launch-ready work is queued under epic ${elsewhere.join(', ')}`
                        : 'launch-ready work absent from launch_queue' }];
                }
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
        launch,
        epics,
        events: [],
    };
}
