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
//   1. get-or-create the scope's row — a concurrent create loses the unique
//      key (409), and the loser re-reads the winner's row and updates it;
//   2. write `desired_state`, `desired_reason`, `desired_at`;
//   3. turning a scope ON activates a `draft` plan in the same act (A21) —
//      the engine never writes the plan (R5), so the writer of the switch does,
//      with `_derive_timestamps2`'s `active` rule: `started_at` stamped if
//      unset, `completed_at` cleared;
//   4. read the row back and refuse an echo that did not take (req #2828).

import call_rest_api from '../../RestApi/RestApi';
import { REST_NULL, sqlNow } from '../../Epics/epicsApi';

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

/** A21 — a `draft` plan goes `active` when its engine is switched on. */
async function activateDraftPlan(darwinUri, idToken, pipelineId) {
    const r = await call_rest_api(
        `${darwinUri}/pipelines?id=${pipelineId}&fields=id,pipeline_status,started_at,completed_at`,
        'GET', '', idToken);
    const rows = assertOk(r, 'readPlan');
    const plan = (Array.isArray(rows) ? rows : [])[0];
    if (!plan || plan.pipeline_status !== 'draft') return false;
    const fields = { pipeline_status: 'active' };
    if (plan.started_at == null) fields.started_at = sqlNow();
    if (plan.completed_at != null) fields.completed_at = REST_NULL;
    assertOk(await call_rest_api(`${darwinUri}/pipelines`, 'PUT', [{ id: pipelineId, ...fields }], idToken),
        'activatePlan');
    return true;
}

/**
 * Switch the whole-plan engine of `pipelineId` on `machineId` on or off.
 * Returns `{state, created, planActivated}`; throws when any step fails or the
 * read-back does not show the switch.
 */
export async function setEngineDesiredState(darwinUri, idToken,
    { pipelineId, machineId, desired, reason = DESIRED_REASON_USER }) {
    if (desired !== DESIRED_ON && desired !== DESIRED_OFF) {
        throw new Error(`desired_state must be '${DESIRED_ON}' or '${DESIRED_OFF}'`);
    }
    if (!Number.isInteger(pipelineId) || !Number.isInteger(machineId)) {
        throw new Error('an engine switch needs a plan and a machine');
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
    let planActivated = false;
    if (desired === DESIRED_ON) {
        try {
            planActivated = await activateDraftPlan(darwinUri, idToken, pipelineId);
        } catch (error) {
            // The switch is already written; only the plan's activation failed.
            const wrapped = new Error(`the engine was switched on, but the draft plan could not be `
                + `activated: ${error?.message || error?.httpStatus?.httpMessage || error}`);
            wrapped.httpStatus = error?.httpStatus;
            throw wrapped;
        }
    }
    const state = await readStateById(darwinUri, idToken, row.id);
    if (!state || state.desired_state !== desired) {
        throw new Error(`engine state ${row.id} did not take desired_state=${desired} `
            + `(read back ${state ? state.desired_state : 'nothing'})`);
    }
    return { state, created, planActivated };
}
