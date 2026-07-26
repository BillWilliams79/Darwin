// Mutation utilities for Agent Context Telemetry captures (req #3062).
// Pattern mirrors src/Customers/customersApi.js — call_rest_api directly,
// callers handle TanStack Query cache invalidation via queryClient.invalidateQueries.
//
// `agent_telemetry_runs` is in Lambda-Rest CREATOR_FK_TABLES, so the DELETE is
// scoped server-side to the authenticated user. `agent_telemetry_rows.run_fk`
// is `ON DELETE CASCADE`, so deleting a run removes its per-agent rows too —
// no separate row cleanup call needed here.

import call_rest_api from '../../RestApi/RestApi';

const isOk = (status) => status === 200 || status === 201 || status === 204;

function assertOk(result, action) {
    const status = result.httpStatus?.httpStatus;
    if (!isOk(status)) {
        const msg = result.httpStatus?.httpMessage || 'unknown';
        throw new Error(`${action} failed: HTTP ${status} ${msg}`);
    }
    return result.data;
}

export async function deleteAgentTelemetryRun(darwinUri, idToken, id) {
    const r = await call_rest_api(`${darwinUri}/agent_telemetry_runs`, 'DELETE',
        { id }, idToken);
    return assertOk(r, 'deleteAgentTelemetryRun');
}

export async function updateAgentTelemetryRun(darwinUri, idToken, id, fields) {
    const r = await call_rest_api(`${darwinUri}/agent_telemetry_runs`, 'PUT',
        [{ id, ...fields }], idToken);
    return assertOk(r, 'updateAgentTelemetryRun');
}
