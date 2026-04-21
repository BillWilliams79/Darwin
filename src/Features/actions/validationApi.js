// Mutation utilities for the Features & Test Cases registry (req #2380).
// All mutations use call_rest_api directly; callers handle TanStack Query cache
// invalidation via queryClient.invalidateQueries({ queryKey: ... }).
//
// Key contracts:
// - POST body: single object
// - PUT body: array of row updates, each with `id`
// - DELETE body: { id } or { feature_fk, test_case_fk } (junction tables use composite key)
// - Junction tables (feature_test_cases, test_plan_cases) have NO id column and
//   NO PUT support. Link = POST; Unlink = DELETE; Reorder = DELETE-all + POST-all
//   at new sort_orders (see reorderTestPlanCases below).
//
// REST status handling:
// - POST on content tables returns 200 + the inserted row
// - POST on junction tables returns 201 without body (no LAST_INSERT_ID possible)
// - PUT returns 204 on success
// - DELETE returns 200 on success, 404 if no rows matched

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

// ----- features -----

export async function createFeature(darwinUri, idToken, { title, description, feature_status = 'draft', category_fk, sort_order = null }) {
    const r = await call_rest_api(`${darwinUri}/features`, 'POST',
        { title, description, feature_status, category_fk, sort_order }, idToken);
    return assertOk(r, 'createFeature');
}

export async function updateFeature(darwinUri, idToken, id, fields) {
    const r = await call_rest_api(`${darwinUri}/features`, 'PUT', [{ id, ...fields }], idToken);
    return assertOk(r, 'updateFeature');
}

export async function deleteFeature(darwinUri, idToken, id) {
    const r = await call_rest_api(`${darwinUri}/features`, 'DELETE', { id }, idToken);
    return assertOk(r, 'deleteFeature');
}

// ----- test_cases -----

export async function createTestCase(darwinUri, idToken,
    { title, preconditions = null, steps, expected, test_type = 'manual',
      tags = null, category_fk, sort_order = null }) {
    const r = await call_rest_api(`${darwinUri}/test_cases`, 'POST',
        { title, preconditions, steps, expected, test_type, tags, category_fk, sort_order }, idToken);
    return assertOk(r, 'createTestCase');
}

export async function updateTestCase(darwinUri, idToken, id, fields) {
    const r = await call_rest_api(`${darwinUri}/test_cases`, 'PUT', [{ id, ...fields }], idToken);
    return assertOk(r, 'updateTestCase');
}

export async function deleteTestCase(darwinUri, idToken, id) {
    const r = await call_rest_api(`${darwinUri}/test_cases`, 'DELETE', { id }, idToken);
    return assertOk(r, 'deleteTestCase');
}

// ----- feature_test_cases (junction — DELETE+POST pattern) -----

export async function linkFeatureTestCase(darwinUri, idToken, feature_fk, test_case_fk) {
    const r = await call_rest_api(`${darwinUri}/feature_test_cases`, 'POST',
        { feature_fk, test_case_fk }, idToken);
    // Junction tables return 201 without body (no id column to read back).
    return assertOk(r, 'linkFeatureTestCase');
}

export async function unlinkFeatureTestCase(darwinUri, idToken, feature_fk, test_case_fk) {
    const r = await call_rest_api(`${darwinUri}/feature_test_cases`, 'DELETE',
        { feature_fk, test_case_fk }, idToken);
    return assertOk(r, 'unlinkFeatureTestCase');
}

// ----- test_plans -----

export async function createTestPlan(darwinUri, idToken,
    { title, description = null, category_fk, sort_order = null }) {
    const r = await call_rest_api(`${darwinUri}/test_plans`, 'POST',
        { title, description, category_fk, sort_order }, idToken);
    return assertOk(r, 'createTestPlan');
}

export async function updateTestPlan(darwinUri, idToken, id, fields) {
    const r = await call_rest_api(`${darwinUri}/test_plans`, 'PUT', [{ id, ...fields }], idToken);
    return assertOk(r, 'updateTestPlan');
}

export async function deleteTestPlan(darwinUri, idToken, id) {
    const r = await call_rest_api(`${darwinUri}/test_plans`, 'DELETE', { id }, idToken);
    return assertOk(r, 'deleteTestPlan');
}

// ----- test_plan_cases (junction with sort_order) -----

export async function addTestCaseToPlan(darwinUri, idToken, test_plan_fk, test_case_fk, sort_order) {
    const r = await call_rest_api(`${darwinUri}/test_plan_cases`, 'POST',
        { test_plan_fk, test_case_fk, sort_order }, idToken);
    return assertOk(r, 'addTestCaseToPlan');
}

export async function removeTestCaseFromPlan(darwinUri, idToken, test_plan_fk, test_case_fk) {
    const r = await call_rest_api(`${darwinUri}/test_plan_cases`, 'DELETE',
        { test_plan_fk, test_case_fk }, idToken);
    return assertOk(r, 'removeTestCaseFromPlan');
}

/**
 * Reorder the cases in a plan. Because test_plan_cases has composite PK (no id)
 * and the generic passthrough doesn't support PUT on composite-key tables, we
 * DELETE every row for this plan and re-POST all rows with new sort_order.
 *
 * @param {number[]} orderedCaseIds — test_case_fk values in the new order.
 */
export async function reorderTestPlanCases(darwinUri, idToken, test_plan_fk, orderedCaseIds) {
    // Delete existing rows for this plan (composite-key DELETE filters by test_plan_fk alone)
    const del = await call_rest_api(`${darwinUri}/test_plan_cases`, 'DELETE',
        { test_plan_fk }, idToken);
    // DELETE returns 200 on rows matched, 404 on empty plan — both are fine for reorder.
    if (![200, 404].includes(del.httpStatus?.httpStatus)) {
        throw new Error(`reorderTestPlanCases (delete phase) failed: HTTP ${del.httpStatus?.httpStatus}`);
    }
    // Re-insert in new order. Sort_order is 1-indexed to match existing domain/area convention.
    for (let i = 0; i < orderedCaseIds.length; i++) {
        await addTestCaseToPlan(darwinUri, idToken, test_plan_fk, orderedCaseIds[i], i + 1);
    }
}

// ----- test_runs -----

/**
 * Create a run and bulk-INSERT test_results rows for every case in the plan
 * (all with result_status='not_run'). Two-phase: POST the run, then read the
 * plan's cases, then bulk POST test_results.
 *
 * Returns { run, seeded_count }.
 */
export async function startTestRun(darwinUri, idToken, test_plan_fk) {
    const runResp = await call_rest_api(`${darwinUri}/test_runs`, 'POST',
        { test_plan_fk, run_status: 'in_progress' }, idToken);
    const run = assertOk(runResp, 'startTestRun (run)');
    const runId = run.id;

    // Fetch the plan's cases
    const casesResp = await call_rest_api(
        `${darwinUri}/test_plan_cases?test_plan_fk=${test_plan_fk}&fields=test_case_fk,sort_order&sort=sort_order:asc`,
        'GET', '', idToken);
    if (casesResp.httpStatus?.httpStatus === 404) {
        return { run, seeded_count: 0 };
    }
    if (!isOk(casesResp.httpStatus?.httpStatus)) {
        throw new Error(`startTestRun (fetch cases) failed: HTTP ${casesResp.httpStatus?.httpStatus}`);
    }
    const cases = casesResp.data || [];
    let seeded_count = 0;
    for (const c of cases) {
        const r = await call_rest_api(`${darwinUri}/test_results`, 'POST',
            { test_run_fk: runId, test_case_fk: c.test_case_fk, result_status: 'not_run' },
            idToken);
        if (isOk(r.httpStatus?.httpStatus)) seeded_count += 1;
    }
    return { run, seeded_count };
}

export async function completeTestRun(darwinUri, idToken, id) {
    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
    const r = await call_rest_api(`${darwinUri}/test_runs`, 'PUT',
        [{ id, run_status: 'completed', completed_at: now }], idToken);
    return assertOk(r, 'completeTestRun');
}

export async function abortTestRun(darwinUri, idToken, id) {
    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
    const r = await call_rest_api(`${darwinUri}/test_runs`, 'PUT',
        [{ id, run_status: 'aborted', completed_at: now }], idToken);
    return assertOk(r, 'abortTestRun');
}

// ----- test_results (per-case outcome) -----

/**
 * Record a test_result by updating the existing (run, case) row (created at
 * Start Run time as not_run). The generic PUT can't filter by a composite key,
 * so the caller must pass the result row's own `id` — read it from the
 * useTestResultsByRun hook first.
 */
export async function recordTestResult(darwinUri, idToken, id,
    { result_status, actual = null, notes = null }) {
    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
    const r = await call_rest_api(`${darwinUri}/test_results`, 'PUT',
        [{ id, result_status, actual, notes, executed_at: now }], idToken);
    return assertOk(r, 'recordTestResult');
}
