// engineSwitchApi.js — the plan overlay's engine switch, written through the
// lifecycle contract (req #3762; rule R6, interface I4, action A21).
//
// THE ONE WRITE THE BROWSER MAKES TO THE ENGINE TABLES. `engine_states` holds
// one row per scope per machine (uq_engine_states_scope); `desired_state` is
// the switch the UI flips, `actual_state` is the supervisor's answer. The UI
// never touches a process (R6): it writes the wish and reads back what the
// supervisor makes of it.
//
// THIS IS darwin-mcp `set_engine_desired_state`, over Lambda-Rest. The browser
// reaches the gateway, never the daemon, so the service's steps are repeated
// here in its order (memory/engine-2-data-contract.md):
//   0. turning a scope ON reads the plan first and REFUSES a terminal one
//      (met, won't fix, deferred) before anything is written (req #3965);
//   1. get-or-create the scope's row — a concurrent create loses the unique
//      key (409), and the loser re-reads the winner's row and updates it;
//   2. write `desired_state`, `desired_reason`, `desired_at`;
//   3. the PLAN'S STATUS follows the switch (req #3965) — the engine never
//      writes the plan (R5), so the writer of the switch does:
//        ON  — a plan not yet `orchestrating` becomes `orchestrating`;
//        OFF — when no `engine_states` row of the plan (any initiative scope,
//              any machine) is still desired `on`, an `orchestrating` plan
//              becomes `orchestration_ready`.
//      The status is written ALONE: the gateway derives started_at /
//      completed_at from it (Lambda-Rest pipeline_lifecycle.py);
//   4. read the row back and refuse an echo that did not take (req #2828).

import call_rest_api from '../../RestApi/RestApi';
import { sqlNow } from '../../Epics/epicsApi';
import {
    ORCHESTRATING_STATUS, isTerminalPipelineStatus, pipelineStatusLabel,
} from '../pipelines/pipelineChipStyles';

// What an orchestrating plan becomes when the last engine on it is switched off.
export const STOPPED_PLAN_STATUS = 'orchestration_ready';

export const DESIRED_ON = 'on';
export const DESIRED_OFF = 'off';
// `desired_reason` — who flipped it. The supervisor writes 'drained'; a person
// at the plan view is the user.
export const DESIRED_REASON_USER = 'user';

const isOk = (status) => status === 200 || status === 201 || status === 204;

function assertOk(result, action) {
    const status = result.httpStatus?.httpStatus;
    if (!isOk(status)) {
        const error = new Error(`${action} failed: HTTP ${status} ${result.httpStatus?.httpMessage || ''}`.trim());
        error.httpStatus = result.httpStatus;
        throw error;
    }
    return result.data;
}

const STATE_FIELDS = 'id,pipeline_fk,initiative_fk,machine_fk,desired_state,desired_reason,desired_at,'
    + 'actual_state,actual_detail,actual_at,create_ts,update_ts';

/** The whole-plan scope's row on `machineId`, or null. A GET that finds nothing is a 404. */
export async function readWholePlanState(darwinUri, idToken, pipelineId, machineId) {
    try {
        const r = await call_rest_api(
            `${darwinUri}/engine_states?pipeline_fk=${pipelineId}&machine_fk=${machineId}&fields=${STATE_FIELDS}`,
            'GET', '', idToken);
        const rows = assertOk(r, 'readEngineState');
        return (Array.isArray(rows) ? rows : []).find((row) => row.initiative_fk == null) || null;
    } catch (error) {
        if (error?.httpStatus?.httpStatus === 404) return null;
        throw error;
    }
}

async function readStateById(darwinUri, idToken, id) {
    const r = await call_rest_api(`${darwinUri}/engine_states?id=${id}&fields=${STATE_FIELDS}`,
        'GET', '', idToken);
    const rows = assertOk(r, 'readEngineState');
    return (Array.isArray(rows) ? rows : [])[0] || null;
}

async function readPlan(darwinUri, idToken, pipelineId) {
    const r = await call_rest_api(
        `${darwinUri}/pipelines?id=${pipelineId}&fields=id,pipeline_status`, 'GET', '', idToken);
    const rows = assertOk(r, 'readPlan');
    const plan = (Array.isArray(rows) ? rows : [])[0];
    if (!plan) throw new Error(`plan ${pipelineId} was not found`);
    return plan;
}

async function writePlanStatus(darwinUri, idToken, pipelineId, status) {
    assertOk(await call_rest_api(`${darwinUri}/pipelines`, 'PUT',
        [{ id: pipelineId, pipeline_status: status }], idToken), 'setPlanStatus');
}

/** Whether any engine_states row of the plan — any scope, any machine — still wants the engine on. */
async function anyEngineWantedOn(darwinUri, idToken, pipelineId) {
    try {
        const r = await call_rest_api(
            `${darwinUri}/engine_states?pipeline_fk=${pipelineId}&desired_state=${DESIRED_ON}&fields=id,desired_state`,
            'GET', '', idToken);
        const rows = assertOk(r, 'readEngineStates');
        return (Array.isArray(rows) ? rows : []).some((row) => row.desired_state === DESIRED_ON);
    } catch (error) {
        if (error?.httpStatus?.httpStatus === 404) return false;
        throw error;
    }
}

/** The refusal an ON switch gives a finished plan, in the contract's words. */
export function terminalPlanRefusal(status) {
    const error = new Error(`plan is ${pipelineStatusLabel(status)} — set it back to a non-terminal status first`);
    error.terminalPlan = true;
    return error;
}

/**
 * Switch the whole-plan engine of `pipelineId` on `machineId` on or off.
 * Returns `{state, created, planStatus}` — `planStatus` is the status the plan
 * was moved to, or null when it was left alone; throws when any step fails or
 * the read-back does not show the switch, and refuses (writing nothing) to
 * switch ON a plan whose status is terminal.
 */
export async function setEngineDesiredState(darwinUri, idToken,
    { pipelineId, machineId, desired, reason = DESIRED_REASON_USER }) {
    if (desired !== DESIRED_ON && desired !== DESIRED_OFF) {
        throw new Error(`desired_state must be '${DESIRED_ON}' or '${DESIRED_OFF}'`);
    }
    if (!Number.isInteger(pipelineId) || !Number.isInteger(machineId)) {
        throw new Error('an engine switch needs a plan and a machine');
    }
    // Step 0 — a finished plan is not switched on; nothing is written.
    let plan = null;
    if (desired === DESIRED_ON) {
        plan = await readPlan(darwinUri, idToken, pipelineId);
        if (isTerminalPipelineStatus(plan.pipeline_status)) throw terminalPlanRefusal(plan.pipeline_status);
    }
    // Step 0b — ON writes the plan's status BEFORE the switch (code review,
    // req #3965), so a status write that fails leaves nothing switched on.
    let planStatus = null;
    if (desired === DESIRED_ON && plan.pipeline_status !== ORCHESTRATING_STATUS) {
        await writePlanStatus(darwinUri, idToken, pipelineId, ORCHESTRATING_STATUS);
        planStatus = ORCHESTRATING_STATUS;
    }
    const change = { desired_state: desired, desired_reason: reason, desired_at: sqlNow() };
    let row = await readWholePlanState(darwinUri, idToken, pipelineId, machineId);
    let created = false;
    if (!row) {
        try {
            assertOk(await call_rest_api(`${darwinUri}/engine_states`, 'POST',
                { pipeline_fk: pipelineId, machine_fk: machineId, ...change }, idToken), 'createEngineState');
            created = true;
        } catch (error) {
            // Lost the unique key to a concurrent writer: its row is the scope's.
            if (error?.httpStatus?.httpStatus !== 409) throw error;
        }
        row = await readWholePlanState(darwinUri, idToken, pipelineId, machineId);
        if (!row) throw new Error(`the engine state for plan ${pipelineId} on machine ${machineId} could not be created`);
    }
    if (!created) {
        assertOk(await call_rest_api(`${darwinUri}/engine_states`, 'PUT', [{ id: row.id, ...change }], idToken),
            'setEngineDesiredState');
    }
    try {
        if (desired === DESIRED_ON) {
            // Re-read AFTER the switch is written, as the OFF branch does: a
            // concurrent last-OFF that ran between Step 0 and the write saw no
            // engine on and set the plan `orchestration_ready`, and acting on
            // the Step 0 read would leave this engine on a plan that launches
            // nothing. A plan finished meanwhile is left as it is.
            plan = await readPlan(darwinUri, idToken, pipelineId);
            if (plan.pipeline_status !== ORCHESTRATING_STATUS
                    && !isTerminalPipelineStatus(plan.pipeline_status)) {
                await writePlanStatus(darwinUri, idToken, pipelineId, ORCHESTRATING_STATUS);
                planStatus = ORCHESTRATING_STATUS;
            }
        } else if (!(await anyEngineWantedOn(darwinUri, idToken, pipelineId))) {
            const now = await readPlan(darwinUri, idToken, pipelineId);
            if (now.pipeline_status === ORCHESTRATING_STATUS) {
                await writePlanStatus(darwinUri, idToken, pipelineId, STOPPED_PLAN_STATUS);
                planStatus = STOPPED_PLAN_STATUS;
            }
        }
    } catch (error) {
        // The switch is already written; only the plan's status failed to follow it.
        const wrapped = new Error(`the engine was switched ${desired}, but the plan's status could not `
            + `be set: ${error?.message || error?.httpStatus?.httpMessage || error}`);
        wrapped.httpStatus = error?.httpStatus;
        throw wrapped;
    }
    const state = await readStateById(darwinUri, idToken, row.id);
    if (!state || state.desired_state !== desired) {
        throw new Error(`engine state ${row.id} did not take desired_state=${desired} `
            + `(read back ${state ? state.desired_state : 'nothing'})`);
    }
    return { state, created, planStatus };
}
