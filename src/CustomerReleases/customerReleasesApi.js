// Mutation utilities for customer_releases (req #2606).
// Mirrors src/Customers/customersApi.js — call_rest_api + assertOk; callers
// invalidate TanStack Query keys via queryClient.invalidateQueries.

import call_rest_api from '../RestApi/RestApi';

const isOk = (status) => status === 200 || status === 201 || status === 204;

function assertOk(result, action) {
    const status = result.httpStatus?.httpStatus;
    if (!isOk(status)) {
        const msg = result.httpStatus?.httpMessage || 'unknown';
        throw new Error(`${action} failed: HTTP ${status} ${msg}`);
    }
    return result.data;
}

export async function createCustomerRelease(darwinUri, idToken, { customer_fk, build_fk, release_notes = null }) {
    const r = await call_rest_api(`${darwinUri}/customer_releases`, 'POST',
        { customer_fk, build_fk, release_notes }, idToken);
    return assertOk(r, 'createCustomerRelease');
}

export async function updateCustomerRelease(darwinUri, idToken, id, fields) {
    const r = await call_rest_api(`${darwinUri}/customer_releases`, 'PUT',
        [{ id, ...fields }], idToken);
    return assertOk(r, 'updateCustomerRelease');
}

export async function deleteCustomerRelease(darwinUri, idToken, id) {
    const r = await call_rest_api(`${darwinUri}/customer_releases`, 'DELETE',
        { id }, idToken);
    return assertOk(r, 'deleteCustomerRelease');
}
