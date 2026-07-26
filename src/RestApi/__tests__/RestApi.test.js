// req #3059 — how call_rest_api unpacks an error response.
//
// Lambda-Rest answers an integrity violation with 409 and a structured CONFLICT
// OBJECT; every other error status still sends a bare JSON STRING. Six call
// sites interpolate `httpStatus.httpMessage` straight into user-facing or log
// text, so the split matters: httpMessage stays a string in both cases, and the
// object is exposed separately on `httpDetail` for the one consumer that wants
// the fields (agentRegistryUtils.restErrorMessage).
//
// Getting this wrong is quiet, not loud — the snackbar would read
// "[object Object]" and nothing would throw.

import { describe, it, expect, vi, afterEach } from 'vitest';
import call_rest_api from '../RestApi';

const CONFLICT = {
    error: 'CONFLICT',
    errno: 1062,
    constraint: 'uq_instructions_name',
    table: 'instructions',
    message: "HTTP PUT SQL FAILED: 1062 Duplicate entry 'x' for key "
        + "'instructions.uq_instructions_name'",
};

/** Stub `fetch` with one canned response. `body` is the PARSED JSON. */
const respondWith = (status, body) => {
    global.fetch = vi.fn().mockResolvedValue({
        status,
        json: async () => body,
    });
};

afterEach(() => { vi.restoreAllMocks(); delete global.fetch; });

describe('call_rest_api error unpacking', () => {

    it('splits a 409 CONFLICT object into httpDetail plus a string httpMessage', async () => {
        respondWith(409, CONFLICT);

        const err = await call_rest_api('/darwin/instructions', 'PUT', [{ id: 1 }])
            .then(() => null, e => e);

        expect(err.httpStatus.httpStatus).toBe(409);
        expect(err.httpStatus.httpDetail).toEqual(CONFLICT);
        expect(err.httpStatus.httpMessage).toBe(CONFLICT.message);
        expect(typeof err.httpStatus.httpMessage).toBe('string');
    });

    it('leaves a plain-string error body exactly as it was', async () => {
        // The 500 contract is unchanged — nothing about it may shift.
        respondWith(500, 'HTTP PUT SQL FAILED: 1054 Unknown column');

        const err = await call_rest_api('/darwin/instructions', 'PUT', [{ id: 1 }])
            .then(() => null, e => e);

        expect(err.httpStatus.httpMessage).toBe('HTTP PUT SQL FAILED: 1054 Unknown column');
        expect(err.httpStatus.httpDetail).toBeNull();
    });

    it('falls back to the serialized object when a structured body has no message', async () => {
        // Defensive: an object body with nothing to read must not silently
        // become the string "undefined" in a snackbar.
        respondWith(409, { error: 'CONFLICT', errno: 1451 });

        const err = await call_rest_api('/darwin/areas', 'DELETE', { id: 1 })
            .then(() => null, e => e);

        expect(err.httpStatus.httpMessage).toBe('{"error":"CONFLICT","errno":1451}');
        expect(err.httpStatus.httpDetail.errno).toBe(1451);
    });

    it('does not mistake a null body for a structured one', async () => {
        // typeof null === 'object' — the guard that stops httpDetail becoming null
        // by way of the object branch and httpMessage becoming "null".
        respondWith(404, null);

        const err = await call_rest_api('/darwin/areas', 'DELETE', { id: 1 })
            .then(() => null, e => e);

        expect(err.httpStatus.httpDetail).toBeNull();
        expect(err.httpStatus.httpMessage).toBeNull();
    });

    it('leaves the success path untouched — no httpDetail, data returned', async () => {
        respondWith(200, [{ id: 7 }]);

        const r = await call_rest_api('/darwin/instructions', 'GET', null);

        expect(r.data).toEqual([{ id: 7 }]);
        expect(r.httpStatus.httpMessage).toBe('OK');
        expect(r.httpStatus.httpDetail).toBeNull();
    });
});
