// Mutation utilities for the customers data type (req #2604).
// Pattern mirrors src/Features/actions/validationApi.js — call_rest_api directly,
// callers handle TanStack Query cache invalidation via queryClient.invalidateQueries.

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

export async function createCustomer(darwinUri, idToken, { customer_name, description = null, sort_order = null }) {
    const r = await call_rest_api(`${darwinUri}/customers`, 'POST',
        { customer_name, description, sort_order }, idToken);
    return assertOk(r, 'createCustomer');
}

export async function updateCustomer(darwinUri, idToken, id, fields) {
    const r = await call_rest_api(`${darwinUri}/customers`, 'PUT', [{ id, ...fields }], idToken);
    return assertOk(r, 'updateCustomer');
}

export async function deleteCustomer(darwinUri, idToken, id) {
    const r = await call_rest_api(`${darwinUri}/customers`, 'DELETE', { id }, idToken);
    return assertOk(r, 'deleteCustomer');
}
