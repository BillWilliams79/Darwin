// The plan overlay's engine switch writes through the lifecycle contract
// (req #3762; R6, I4, A21): darwin-mcp `set_engine_desired_state`'s steps,
// over Lambda-Rest, in its order — and refuses an echo that did not take.
// req #3965: the plan's status follows the switch (ON → orchestrating, refused
// on a terminal plan; OFF with no engine left wanted on → orchestration_ready).

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../RestApi/RestApi', () => ({ default: vi.fn() }));

import call_rest_api from '../../../RestApi/RestApi';
import { setEngineDesiredState } from '../engineSwitchApi';

const ok = (data, status = 200) => ({ data, httpStatus: { httpStatus: status } });
const fail = (status) => ({ data: null, httpStatus: { httpStatus: status, httpMessage: `HTTP ${status}` } });

/** A gateway over `tables` that records every call. */
function gateway(tables) {
    const calls = [];
    call_rest_api.mockImplementation(async (url, method, body) => {
        calls.push({ url, method, body });
        const u = new URL(url);
        const table = u.pathname.split('/').pop();
        const rows = tables[table] || [];
        if (method === 'GET') {
            let out = rows;
            for (const [k, v] of u.searchParams) {
                if (k !== 'fields') out = out.filter((r) => String(r[k]) === v);
            }
            if (!out.length) throw fail(404);
            return ok(out);
        }
        if (method === 'POST') {
            if (table === 'engine_states' && tables.conflict) {
                tables.engine_states.push({ id: 77, pipeline_fk: body.pipeline_fk, initiative_fk: null,
                    machine_fk: body.machine_fk, desired_state: 'off', actual_state: 'stopped' });
                throw fail(409);
            }
            const row = { id: 50 + rows.length, initiative_fk: null, actual_state: 'stopped', ...body };
            rows.push(row);
            tables[table] = rows;
            return ok([row], 201);
        }
        if (method === 'PUT') {
            for (const change of body) {
                const row = rows.find((r) => r.id === change.id);
                if (row && !tables.ignorePut) Object.assign(row, change);
            }
            return ok(body);
        }
        throw new Error(`unexpected ${method}`);
    });
    return calls;
}

const uri = 'https://api.example/darwin_dev';

describe('setEngineDesiredState', () => {
    // A block body: a function returned from beforeEach is run as its teardown.
    beforeEach(() => { call_rest_api.mockReset(); });

    it('creates the scope\'s row when there is none, and sets the plan orchestrating', async () => {
        const tables = { engine_states: [],
            pipelines: [{ id: 9, pipeline_status: 'authoring', started_at: null, completed_at: null }] };
        const calls = gateway(tables);
        const out = await setEngineDesiredState(uri, 'tok', { pipelineId: 9, machineId: 1, desired: 'on' });
        expect(out.created).toBe(true);
        expect(out.planStatus).toBe('orchestrating');
        expect(out.state).toMatchObject({ pipeline_fk: 9, machine_fk: 1, desired_state: 'on',
            desired_reason: 'user' });
        const post = calls.find((c) => c.method === 'POST');
        expect(post.body).toMatchObject({ pipeline_fk: 9, machine_fk: 1, desired_state: 'on',
            desired_reason: 'user' });
        expect(post.body.desired_at).toMatch(/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/);
        const planPut = calls.find((c) => c.method === 'PUT' && c.url.endsWith('/pipelines'));
        // req #3965 — the status ALONE: the gateway derives the timestamps.
        expect(planPut.body).toEqual([{ id: 9, pipeline_status: 'orchestrating' }]);
    });

    it('ON writes the plan status before the switch, so a failed status write switches nothing on', async () => {
        const tables = { engine_states: [], pipelines: [{ id: 9, pipeline_status: 'authoring' }] };
        const calls = gateway(tables);
        const inner = call_rest_api.getMockImplementation();
        call_rest_api.mockImplementation(async (url, method, body) => {
            if (method === 'PUT' && url.endsWith('/pipelines')) throw fail(500);
            return inner(url, method, body);
        });
        await expect(setEngineDesiredState(uri, 'tok', { pipelineId: 9, machineId: 1, desired: 'on' }))
            .rejects.toBeTruthy();
        expect(calls.filter((c) => c.url.includes('/engine_states') && c.method !== 'GET')).toEqual([]);
        expect(tables.engine_states).toEqual([]);
    });

    it('ON decides the plan status from a read taken after the switch is written', async () => {
        // A concurrent last-OFF ran between ON's first read and its write: it saw
        // no engine on and set the plan orchestration_ready.
        const plan = { id: 9, pipeline_status: 'orchestrating' };
        const tables = { engine_states: [{ id: 4, pipeline_fk: 9, initiative_fk: null, machine_fk: 1,
            desired_state: 'off', actual_state: 'stopped' }], pipelines: [plan] };
        const calls = gateway(tables);
        const inner = call_rest_api.getMockImplementation();
        call_rest_api.mockImplementation(async (url, method, body) => {
            const out = await inner(url, method, body);
            if (method === 'PUT' && url.endsWith('/engine_states')) plan.pipeline_status = 'orchestration_ready';
            return out;
        });
        const out = await setEngineDesiredState(uri, 'tok', { pipelineId: 9, machineId: 1, desired: 'on' });
        expect(out.planStatus).toBe('orchestrating');
        expect(plan.pipeline_status).toBe('orchestrating');
        expect(calls.filter((c) => c.method === 'PUT' && c.url.endsWith('/pipelines')))
            .toHaveLength(1);
    });

    it.each(['authorized', 'orchestration_ready'])('ON moves a %s plan to orchestrating', async (from) => {
        const tables = { engine_states: [], pipelines: [{ id: 9, pipeline_status: from }] };
        gateway(tables);
        const out = await setEngineDesiredState(uri, 'tok', { pipelineId: 9, machineId: 1, desired: 'on' });
        expect(out.planStatus).toBe('orchestrating');
        expect(tables.pipelines[0].pipeline_status).toBe('orchestrating');
    });

    it('ON leaves an orchestrating plan alone', async () => {
        const tables = { engine_states: [], pipelines: [{ id: 9, pipeline_status: 'orchestrating' }] };
        const calls = gateway(tables);
        const out = await setEngineDesiredState(uri, 'tok', { pipelineId: 9, machineId: 1, desired: 'on' });
        expect(out.planStatus).toBeNull();
        expect(calls.some((c) => c.method === 'PUT' && c.url.endsWith('/pipelines'))).toBe(false);
    });

    it.each(['met', 'wontfix', 'deferred'])('ON refuses a %s plan visibly, writing nothing', async (status) => {
        const tables = { engine_states: [], pipelines: [{ id: 9, pipeline_status: status }] };
        const calls = gateway(tables);
        await expect(setEngineDesiredState(uri, 'tok', { pipelineId: 9, machineId: 1, desired: 'on' }))
            .rejects.toThrow(/plan is .+ — set it back to a non-terminal status first/);
        expect(calls.filter((c) => c.method !== 'GET')).toEqual([]);
        expect(tables.engine_states).toEqual([]);
    });

    it('OFF sets an orchestrating plan orchestration_ready when no engine of it is still wanted on', async () => {
        const tables = {
            engine_states: [{ id: 3, pipeline_fk: 9, initiative_fk: null, machine_fk: 1,
                desired_state: 'on', actual_state: 'running' },
            { id: 4, pipeline_fk: 9, initiative_fk: 70, machine_fk: 2, desired_state: 'off' }],
            pipelines: [{ id: 9, pipeline_status: 'orchestrating' }],
        };
        const calls = gateway(tables);
        const out = await setEngineDesiredState(uri, 'tok', { pipelineId: 9, machineId: 1, desired: 'off' });
        expect(out).toMatchObject({ created: false, planStatus: 'orchestration_ready' });
        expect(out.state.id).toBe(3);
        const planPut = calls.find((c) => c.method === 'PUT' && c.url.endsWith('/pipelines'));
        expect(planPut.body).toEqual([{ id: 9, pipeline_status: 'orchestration_ready' }]);
    });

    it('OFF leaves the plan orchestrating while another scope or machine still wants its engine on', async () => {
        const tables = {
            engine_states: [{ id: 3, pipeline_fk: 9, initiative_fk: null, machine_fk: 1,
                desired_state: 'on', actual_state: 'running' },
            { id: 4, pipeline_fk: 9, initiative_fk: 70, machine_fk: 1, desired_state: 'on' }],
            pipelines: [{ id: 9, pipeline_status: 'orchestrating' }],
        };
        const calls = gateway(tables);
        const out = await setEngineDesiredState(uri, 'tok', { pipelineId: 9, machineId: 1, desired: 'off' });
        expect(out).toMatchObject({ created: false, planStatus: null });
        expect(tables.engine_states[1].desired_state).toBe('on');        // the initiative scope is untouched
        expect(calls.filter((c) => c.method === 'PUT').map((c) => c.url)).toEqual([`${uri}/engine_states`]);
    });

    it('OFF leaves a plan that is not orchestrating alone', async () => {
        const tables = {
            engine_states: [{ id: 3, pipeline_fk: 9, initiative_fk: null, machine_fk: 1, desired_state: 'on' }],
            pipelines: [{ id: 9, pipeline_status: 'met' }],
        };
        const calls = gateway(tables);
        const out = await setEngineDesiredState(uri, 'tok', { pipelineId: 9, machineId: 1, desired: 'off' });
        expect(out.planStatus).toBeNull();
        expect(calls.some((c) => c.method === 'PUT' && c.url.endsWith('/pipelines'))).toBe(false);
    });

    it('takes the winner\'s row when a concurrent create wins the unique key', async () => {
        const tables = { engine_states: [], conflict: true, pipelines: [{ id: 9, pipeline_status: 'orchestrating' }] };
        const calls = gateway(tables);
        const out = await setEngineDesiredState(uri, 'tok', { pipelineId: 9, machineId: 1, desired: 'on' });
        expect(out.created).toBe(false);
        expect(out.state).toMatchObject({ id: 77, desired_state: 'on' });
        expect(calls.filter((c) => c.method === 'PUT' && c.url.endsWith('/engine_states'))).toHaveLength(1);
    });

    it('refuses an echo that did not take', async () => {
        const tables = { engine_states: [{ id: 3, pipeline_fk: 9, initiative_fk: null, machine_fk: 1,
            desired_state: 'off' }], ignorePut: true, pipelines: [{ id: 9, pipeline_status: 'orchestrating' }] };
        gateway(tables);
        await expect(setEngineDesiredState(uri, 'tok', { pipelineId: 9, machineId: 1, desired: 'on' }))
            .rejects.toThrow(/did not take desired_state=on \(read back off\)/);
    });

    it('says the switch took when only the plan\'s status failed to follow it', async () => {
        const tables = { engine_states: [{ id: 3, pipeline_fk: 9, initiative_fk: null, machine_fk: 1,
            desired_state: 'on' }], pipelines: [] };      // OFF: the plan's read 404s and throws
        gateway(tables);
        await expect(setEngineDesiredState(uri, 'tok', { pipelineId: 9, machineId: 1, desired: 'off' }))
            .rejects.toThrow(/switched off, but the plan's status could not be set/);
        expect(tables.engine_states[0].desired_state).toBe('off');
    });

    it('refuses a switch with no machine', async () => {
        await expect(setEngineDesiredState(uri, 'tok', { pipelineId: 9, machineId: null, desired: 'on' }))
            .rejects.toThrow(/needs a plan and a machine/);
        expect(call_rest_api).not.toHaveBeenCalled();
    });
});
