// usePlanEngineOverlay.js — the reads and the one write behind the plan view's
// engine overlay (req #3762).
//
// WHICH ENGINE. The plan view is the whole plan, so the engine is the whole-plan
// scope (`initiative_fk` NULL) on THIS machine — the browser's own machine
// (`resolveThisMachineId`), or the one the reader picked when the browser
// cannot tell which it is on (an unregistered Mac, two of one platform).
//
// WHICH RECORD.
//   · switched ON and published — the newest record of that scope, as it is;
//   · otherwise — the first-cycle prediction (`enginePredict.js`) over the
//     composed read, this machine's capacity and the live claims. Switched on
//     but not yet published ("coming up") is a prediction too, and says so.
//
// Reads are the engine view's (`useEngineView.js`) — the data contract's tables
// through the query factory, polled — plus the plan page's own reads it is
// handed. A full record is content-addressed, so it is cached for good.

import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useQueries, useQueryClient } from '@tanstack/react-query';

import AppContext from '../../Context/AppContext';
import AuthContext from '../../Context/AuthContext';
import { ENGINE_RECORD_FULL_FIELDS } from '../../hooks/factory/devopsQueries';
import { fetchEntity } from '../../hooks/factory/createEntityQueries';
import {
    useComposedPipeline, useEngineDecisionRecords,
    useEngineHeartbeats, useEngineStates,
} from '../../hooks/useDataQueries';
import { pipelineComposeKeys } from '../../hooks/useQueryKeys';
import { isStale } from '../pipelines/orchestrationHolder';
import { resolveThisMachineId } from '../terminalFocus';
import { assembleEngines, outcomesByRequirement, parseJsonColumn, parseUtc } from './engineModel';
import {
    SOURCE_ENGINE, SOURCE_PREDICTED, flightFromRecords, planOverlay, predictionCapacity, predictionClaims,
} from './engineOverlay';
import { predictRecord } from './enginePredict';
import { DESIRED_OFF, DESIRED_ON, setEngineDesiredState } from './engineSwitchApi';
import { HEALTH_DEGRADED, HEALTH_OK } from './engineVocabulary';
import { POLL_MS, useEngineRecord, useNow } from './useEngineView';

// While the switch and the supervisor disagree, read every few seconds so the
// reader sees the engine come up (or go down) rather than waiting a full poll.
export const TRANSITION_POLL_MS = 3000;
// The plan page's query parameter naming the reader's machine for the engine
// overlay — `/swarm/pipeline/617?mode=plan&engineMachine=10505`.
export const ENGINE_MACHINE_PARAM = 'engineMachine';
const NOW_TICK_MS = 30000;

const FRESH = new Set([HEALTH_OK, HEALTH_DEGRADED]);
const asArray = (v) => (Array.isArray(v) ? v : []);

// How long after a switch the overlay keeps reading fast while it waits for
// the engine's first beat — past this, a silent engine is simply `missing`.
const COME_UP_WINDOW_MS = 5 * 60 * 1000;

/**
 * Is the engine still on its way to what the switch says? An assembled
 * engine (`assembleEngines`): ON is reached when the supervisor reports it
 * running AND it beats; OFF when the supervisor reports it stopped.
 */
export function engineTransitioning(engine, now = new Date()) {
    if (!engine) return false;
    const { state } = engine;
    const moving = state.desired_state === DESIRED_ON
        ? state.actual_state !== 'running' || !FRESH.has(engine.health)
        : !['stopped', 'crashed'].includes(state.actual_state);
    if (!moving) return false;
    // Only for a while after the switch: a supervisor that never answers is a
    // fact the strip states, not a reason to read every few seconds forever.
    const at = parseUtc(state.desired_at);
    return !!at && now.getTime() - at.getTime() < COME_UP_WINDOW_MS;
}

/**
 * Is `row` (a light record row) the engine's record for its CURRENT run — a
 * cycle published since it was last switched on? A record from an earlier run
 * is history, never what a just-switched-on engine decided.
 */
export function recordOfThisRun(row, state) {
    if (!row || !state) return false;
    const on = parseUtc(state.desired_at);
    if (!on) return true;
    const at = parseUtc(row.cycle_at || row.create_ts);
    return !!at && at.getTime() >= on.getTime();
}

/**
 * The other engines' latest records as the prediction reads them (req #3984).
 * Each new cycle of another engine is a new query, pending for a round trip;
 * until it lands, that engine's LAST loaded record stands — as this plan's own
 * engine record does between cycles. Read as unknown, every cycle of every
 * other engine flashed the whole plan CAPACITY-UNKNOWN red. An engine with no
 * record read yet, or whose read failed, is still unknown.
 *
 * @param {Object[]} queries  `useQueries` results, one per engine in `others`
 * @param {Object[]} others   the assembled engines they read, each with `key`
 * @param {Map} last          engine key -> its last loaded row; updated here
 * @returns {{rows: Array<?Object>, known: boolean}}
 */
export function otherRecordReads(queries, others, last) {
    // Only between consecutive cycles: an engine that left and came back is
    // read afresh, never from a record it published before it went quiet.
    const present = new Set(others.map((e) => e.key));
    for (const key of [...last.keys()]) if (!present.has(key)) last.delete(key);
    let known = true;
    const rows = queries.map((q, i) => {
        const key = others[i] ? others[i].key : null;
        if (q.isSuccess) {
            last.set(key, q.data);
            return q.data;
        }
        if (!q.isError && last.has(key)) return last.get(key);
        known = false;
        return null;
    });
    return { rows, known };
}

/**
 * The overlay's whole state for plan `pipelineId` on the reader's machine.
 *
 * @param {Object} args
 * @param {?number} args.pipelineId
 * @param {Object[]} args.machines      the machine registry
 * @param {Object[]} args.claims        orchestration_claims rows
 * @param {?Object[]} args.sessions     session rows with machine_fk + swarm_status (undefined = unread)
 * @param {?number} args.machineOverride the reader's pick, when the browser cannot tell
 * @param {boolean} args.enabled
 */
export function usePlanEngineOverlay({ pipelineId, machines, claims, sessions, machineOverride = null,
    enabled = true }) {
    const { darwinUri } = useContext(AppContext);
    const { profile, idToken } = useContext(AuthContext);
    const creatorFk = profile?.userName;
    const queryClient = useQueryClient();
    // Coarse: ages and claim staleness are minutes-scale facts, and every tick
    // re-renders the plan page this hook lives in.
    const now = useNow(NOW_TICK_MS);

    const resolvedMachineId = useMemo(() => resolveThisMachineId(machines), [machines]);
    const openMachines = useMemo(() => asArray(machines).filter((m) => !m.closed), [machines]);
    const machineId = (machineOverride != null && openMachines.some((m) => m.id === machineOverride))
        ? machineOverride : resolvedMachineId;
    const machine = useMemo(() => asArray(machines).find((m) => m.id === machineId) || null,
        [machines, machineId]);

    // ── the engine tables ────────────────────────────────────────────────────
    const [fastPoll, setFastPoll] = useState(false);
    const poll = { refetchInterval: fastPoll ? TRANSITION_POLL_MS : POLL_MS, enabled };
    const states = useEngineStates(creatorFk, poll);
    const beats = useEngineHeartbeats(creatorFk, poll);
    // Machine-wide (light rows only): what OTHER engines on this machine hold in
    // flight is part of this one's capacity (R8), whichever plan they run.
    const records = useEngineDecisionRecords(creatorFk, poll);
    const engines = useMemo(() => assembleEngines({ states: states.data, heartbeats: beats.data,
        records: records.data, now }), [states.data, beats.data, records.data, now]);
    const engine = useMemo(() => engines.find((e) => e.pipelineId === pipelineId
        && e.initiativeId == null && e.machineId === machineId) || null,
    [engines, pipelineId, machineId]);
    const transitioning = engineTransitioning(engine, now);
    useEffect(() => { setFastPoll(transitioning); }, [transitioning]);

    const engineOn = !!engine && engine.state.desired_state === DESIRED_ON;
    const latestRowId = enabled && engineOn && recordOfThisRun(engine.latest, engine.state)
        ? engine.latest.id : null;
    const current = useEngineRecord(latestRowId, { live: true });
    // While the next cycle's record loads, the last one stays on screen: with the
    // engine on, the overlay never falls back to a prediction between cycles.
    const shown = useRef(null);
    if (latestRowId == null) shown.current = null;
    else if (current.record) {
        const was = shown.current;
        const sameOutcomes = was && (was.outcomes === current.outcomes
            || (was.outcomes.length === 0 && current.outcomes.length === 0));
        if (!was || was.rowId !== latestRowId || was.record !== current.record || !sameOutcomes) {
            shown.current = { rowId: latestRowId, record: current.record, outcomes: current.outcomes };
        }
    }
    const engineRecord = latestRowId != null ? shown.current : null;

    // ── the prediction's inputs ──────────────────────────────────────────────
    const composed = useComposedPipeline(pipelineId, { enabled: enabled && pipelineId != null });
    const payload = composed.data || null;
    const others = useMemo(() => engines.filter((e) => e !== engine && e.machineId === machineId
        && FRESH.has(e.health) && e.latest), [engines, engine, machineId]);
    const otherRecords = useQueries({
        queries: others.map((e) => ({
            queryKey: ['engine_decision_records', creatorFk, { id: e.latest.id, fields: ENGINE_RECORD_FULL_FIELDS }],
            queryFn: async () => {
                const rows = await fetchEntity(
                    `${darwinUri}/engine_decision_records?id=${e.latest.id}&fields=${ENGINE_RECORD_FULL_FIELDS}`,
                    idToken);
                return Array.isArray(rows) && rows.length ? rows[0] : null;
            },
            enabled: enabled && !!creatorFk && !!idToken,
            staleTime: Infinity,
        })),
    });
    // What the other engines hold in flight and their limits for the fair share
    // (req #3807). Keyed by value: `useQueries` hands back a new array every render.
    // Only an engine that can use a slot contends (darwin-mcp list_engine_in_flight):
    // a degraded or switched-off one still reserves what it has in flight.
    const lastOtherRows = useRef(new Map());
    const otherReads = otherRecordReads(otherRecords, others, lastOtherRows.current);
    const flightKey = JSON.stringify(otherReads.rows.map((row, i) => {
        const rec = row ? parseJsonColumn(row.record) : null;
        const other = others[i];
        return rec ? { location: rec.location, limits: rec.limits,
            contends: !!other && other.health === HEALTH_OK
                && other.state.desired_state !== DESIRED_OFF } : null;
    }).filter(Boolean));
    const flight = useMemo(() => flightFromRecords(JSON.parse(flightKey)), [flightKey]);
    const otherRecordsKnown = otherReads.known;

    // Claims as the role rule reads them: stale ones carry `stale`. The claim
    // this scope's own engine last beat on is not counted against its
    // prediction — an engine switched off releases it, and until that lands it
    // would read as a second engine on this machine and refuse the first.
    // While it comes up, the engine has taken its claim before its first beat
    // names it: with the switch on, a live whole-plan claim of this plan on
    // this machine is that engine's own.
    const ownClaimFk = engine && engine.beat ? engine.beat.claim_fk : null;
    const isOwnClaim = (c) => c.id === ownClaimFk || (engineOn && c.machine_fk === machineId
        && c.pipeline_fk === pipelineId && c.initiative_fk == null);
    const claimRows = useMemo(() => asArray(claims).map((c) => ({ ...c, stale: isStale(c, now) })),
        [claims, now]);

    const overlay = useMemo(() => {
        if (!enabled || !payload) return null;
        if (engineRecord) {
            return planOverlay(engineRecord.record, {
                source: SOURCE_ENGINE, payload,
                liveClaims: claimRows.filter((c) => !c.stale),
                outcomes: outcomesByRequirement(engineRecord.outcomes, engineRecord.rowId),
            });
        }
        // The engine's current record exists but has not loaded (or failed):
        // say so rather than drawing a prediction in its place.
        if (latestRowId != null || machineId == null) return null;
        const capacity = predictionCapacity({ machine, sessions,
            sessionsKnown: sessions !== undefined && otherRecordsKnown, flight, pipelineId });
        const claimsIn = predictionClaims({
            claimRows: claimRows.filter((c) => !isOwnClaim(c)), pipelineId, machineId });
        const predicted = predictRecord(payload, capacity, claimsIn, { now: now.toISOString() });
        return planOverlay(predicted, {
            source: SOURCE_PREDICTED, payload,
            liveClaims: claimsIn.live.filter((c) => !c.stale),
        });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- isOwnClaim reads only deps listed
    }, [enabled, payload, engineRecord, latestRowId, claimRows, machineId, machine, sessions,
        otherRecordsKnown, flight, ownClaimFk, engineOn, pipelineId, now]);

    // ── the switch ───────────────────────────────────────────────────────────
    const [pending, setPending] = useState(null);
    const [error, setError] = useState(null);
    const toggle = useCallback(async () => {
        if (pipelineId == null || machineId == null || pending) return;
        const desired = engineOn ? DESIRED_OFF : DESIRED_ON;
        setPending(desired);
        setError(null);
        try {
            const { planActivated } = await setEngineDesiredState(darwinUri, idToken,
                { pipelineId, machineId, desired });
            // The switch, and what answers it: the supervisor's state, the
            // engine's beat, its first record and the claim it takes or releases.
            await Promise.all(['engine_states', 'engine_heartbeats', 'engine_decision_records',
                'orchestration_claims']
                .map((t) => queryClient.invalidateQueries({ queryKey: [t] })));
            if (planActivated) {
                queryClient.invalidateQueries({ queryKey: pipelineComposeKeys.byId(pipelineId) });
                queryClient.invalidateQueries({ queryKey: ['pipelines'] });
            }
        } catch (e) {
            setError(e?.message || e?.httpStatus?.httpMessage || String(e));
        } finally {
            setPending(null);
        }
    }, [pipelineId, machineId, pending, engineOn, darwinUri, idToken, queryClient]);

    return {
        overlay,
        engine,
        engineOn,
        machineId,
        machine,
        machineResolved: resolvedMachineId != null,
        openMachines,
        publishedYet: !!engineRecord,
        recordLoading: latestRowId != null && current.isLoading,
        recordError: current.isError,
        readErrors: [
            states.isError && 'engine states',
            beats.isError && 'engine heartbeats',
            records.isError && 'decision records',
            composed.isError && 'the plan',
        ].filter(Boolean),
        pending,
        error,
        toggle,
        now,
    };
}
