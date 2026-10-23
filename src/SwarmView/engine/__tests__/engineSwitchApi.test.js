// The plan overlay's engine switch writes through the lifecycle contract
// (req #3762; R6, I4, A21): darwin-mcp `set_engine_desired_state`'s steps,
// over Lambda-Rest, in its order — and refuses an echo that did not take.

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

    it('creates the scope\'s row when there is none, and activates a draft plan (A21)', async () => {
        const tables = { engine_states: [],
            pipelines: [{ id: 9, pipeline_status: 'draft', started_at: null, completed_at: null }] };
        const calls = gateway(tables);
        const out = await setEngineDesiredState(uri, 'tok', { pipelineId: 9, machineId: 1, desired: 'on' });
        expect(out.created).toBe(true);
        expect(out.planActivated).toBe(true);
        expect(out.state).toMatchObject({ pipeline_fk: 9, machine_fk: 1, desired_state: 'on',
            desired_reason: 'user' });
        const post = calls.find((c) => c.method === 'POST');
        expect(post.body).toMatchObject({ pipeline_fk: 9, machine_fk: 1, desired_state: 'on',
            desired_reason: 'user' });
        expect(post.body.desired_at).toMatch(/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/);
        const planPut = calls.find((c) => c.method === 'PUT' && c.url.endsWith('/pipelines'));
        expect(planPut.body[0]).toMatchObject({ id: 9, pipeline_status: 'active' });
        expect(planPut.body[0].started_at).toMatch(/^\d{4}-/);
        expect(planPut.body[0]).not.toHaveProperty('completed_at');
    });

    it('updates an existing row and leaves an active plan alone', async () => {
        const tables = {
            engine_states: [{ id: 3, pipeline_fk: 9, initiative_fk: null, machine_fk: 1,
                desired_state: 'on', actual_state: 'running' },
            { id: 4, pipeline_fk: 9, initiative_fk: 70, machine_fk: 1, desired_state: 'on' }],
            pipelines: [{ id: 9, pipeline_status: 'active' }],
        };
        const calls = gateway(tables);
        const out = await setEngineDesiredState(uri, 'tok', { pipelineId: 9, machineId: 1, desired: 'off' });
        expect(out).toMatchObject({ created: false, planActivated: false });
        expect(out.state.id).toBe(3);
        expect(tables.engine_states[1].desired_state).toBe('on');        // the initiative scope is untouched
        expect(calls.filter((c) => c.method === 'PUT').map((c) => c.url)).toEqual([`${uri}/engine_states`]);
        expect(calls.some((c) => c.url.includes('/pipelines'))).toBe(false);   // off never touches the plan
    });

    it('takes the winner\'s row when a concurrent create wins the unique key', async () => {
        const tables = { engine_states: [], conflict: true, pipelines: [{ id: 9, pipeline_status: 'active' }] };
        const calls = gateway(tables);
        const out = await setEngineDesiredState(uri, 'tok', { pipelineId: 9, machineId: 1, desired: 'on' });
        expect(out.created).toBe(false);
        expect(out.state).toMatchObject({ id: 77, desired_state: 'on' });
        expect(calls.filter((c) => c.method === 'PUT' && c.url.endsWith('/engine_states'))).toHaveLength(1);
    });

    it('refuses an echo that did not take', async () => {
        const tables = { engine_states: [{ id: 3, pipeline_fk: 9, initiative_fk: null, machine_fk: 1,
            desired_state: 'off' }], ignorePut: true, pipelines: [{ id: 9, pipeline_status: 'active' }] };
        gateway(tables);
        await expect(setEngineDesiredState(uri, 'tok', { pipelineId: 9, machineId: 1, desired: 'on' }))
            .rejects.toThrow(/did not take desired_state=on \(read back off\)/);
    });

    it('says the switch took when only the plan activation failed', async () => {
        const tables = { engine_states: [{ id: 3, pipeline_fk: 9, initiative_fk: null, machine_fk: 1,
            desired_state: 'off' }] };       // no plan row: its read 404s and throws
        gateway(tables);
        await expect(setEngineDesiredState(uri, 'tok', { pipelineId: 9, machineId: 1, desired: 'on' }))
            .rejects.toThrow(/switched on, but the draft plan could not be activated/);
        expect(tables.engine_states[0].desired_state).toBe('on');
    });

    it('refuses a switch with no machine', async () => {
        await expect(setEngineDesiredState(uri, 'tok', { pipelineId: 9, machineId: null, desired: 'on' }))
            .rejects.toThrow(/needs a plan and a machine/);
        expect(call_rest_api).not.toHaveBeenCalled();
    });
});
