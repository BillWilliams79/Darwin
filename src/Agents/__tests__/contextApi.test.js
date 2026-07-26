// Req #3062 — delete mutation for Agent Context Telemetry captures.
// Req #3065 — update mutation (editable Description).

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../RestApi/RestApi', () => ({ default: vi.fn() }));

import call_rest_api from '../../RestApi/RestApi';
import { deleteAgentTelemetryRun, updateAgentTelemetryRun } from '../actions/contextApi';

const URI = 'https://api.test/darwin_dev';
const TOKEN = 'id-token';

const ok = (status = 200, data = null) =>
    ({ data, httpStatus: { httpStatus: status, httpMessage: 'OK' } });

beforeEach(() => {
    call_rest_api.mockReset();
});

describe('deleteAgentTelemetryRun', () => {
    it('DELETEs the run by id', async () => {
        call_rest_api.mockResolvedValue(ok(200));

        await deleteAgentTelemetryRun(URI, TOKEN, 42);

        expect(call_rest_api).toHaveBeenCalledWith(
            `${URI}/agent_telemetry_runs`, 'DELETE', { id: 42 }, TOKEN);
    });

    it('resolves with the response data on success', async () => {
        call_rest_api.mockResolvedValue(ok(200, { affected: 1 }));

        await expect(deleteAgentTelemetryRun(URI, TOKEN, 42))
            .resolves.toEqual({ affected: 1 });
    });

    it('throws when the delete fails', async () => {
        call_rest_api.mockResolvedValue(
            { data: null, httpStatus: { httpStatus: 404, httpMessage: 'NOT FOUND' } });

        await expect(deleteAgentTelemetryRun(URI, TOKEN, 999))
            .rejects.toThrow('deleteAgentTelemetryRun failed: HTTP 404 NOT FOUND');
    });
});

describe('updateAgentTelemetryRun', () => {
    it('PUTs an array body carrying id + the changed fields', async () => {
        call_rest_api.mockResolvedValue(ok(200));

        await updateAgentTelemetryRun(URI, TOKEN, 42, { source_note: 'Baseline run' });

        expect(call_rest_api).toHaveBeenCalledWith(
            `${URI}/agent_telemetry_runs`, 'PUT',
            [{ id: 42, source_note: 'Baseline run' }], TOKEN);
    });

    it('resolves with the response data on success', async () => {
        call_rest_api.mockResolvedValue(ok(200, { affected: 1 }));

        await expect(updateAgentTelemetryRun(URI, TOKEN, 42, { source_note: null }))
            .resolves.toEqual({ affected: 1 });
    });

    it('throws when the write fails', async () => {
        call_rest_api.mockResolvedValue(
            { data: null, httpStatus: { httpStatus: 500, httpMessage: 'SERVER ERROR' } });

        await expect(updateAgentTelemetryRun(URI, TOKEN, 42, { source_note: 'x' }))
            .rejects.toThrow('updateAgentTelemetryRun failed: HTTP 500 SERVER ERROR');
    });
});
