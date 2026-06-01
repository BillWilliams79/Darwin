// @vitest-environment jsdom
//
// Unit tests for the standalone Build Visualizer data adapter (req #2743).
// Exercises the drop-in call_rest_api / fetchEntity replacement against
// jsdom's localStorage: content-hash seeding (re-seed when the bundle's data
// changes, persist edits when it doesn't — the file:// shared-localStorage
// staleness fix), URL parsing (equality, IN-clause, combined filters),
// monotonic POST ids, PUT, and the build_projects → branches → builds →
// customer_releases delete cascade.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const P = 'bv.standalone.';
const SEEDVER_KEY = `${P}seedVersion.v1`;

const SEED = {
    build_projects: [{ id: 1, title: 'P1', trunk_branch_fk: 10 }, { id: 2, title: 'P2' }],
    branches: [
        { id: 10, external_id: 'main', project_fk: 1, branch_type: 'main' },
        { id: 11, external_id: 'dev', project_fk: 1, branch_type: 'development' },
        { id: 20, external_id: 'main', project_fk: 2, branch_type: 'main' },
    ],
    builds: [
        { id: 100, external_id: 'b1', branch_fk: 10, position: 0 },
        { id: 101, external_id: 'b2', branch_fk: 11, position: 0 },
        { id: 200, external_id: 'b1', branch_fk: 20, position: 0 },
    ],
    customer_releases: [{ id: 300, customer_fk: 1, build_fk: 100 }],
    customers: [{ id: 1, customer_name: 'HP' }],
};

function installSeed(obj = SEED) {
    document.body.innerHTML =
        `<script id="bv-standalone-seed" type="application/json">${JSON.stringify(obj)}</script>`;
}

// Fresh module instance each call (resets the module-level seed promise so the
// content-hash check re-runs, exactly as a browser reload would).
async function loadApi() {
    vi.resetModules();
    return import('../../../standalone/standaloneApi.js');
}

const table = (t) => JSON.parse(window.localStorage.getItem(P + t) || '[]');

beforeEach(() => {
    window.localStorage.clear();
    installSeed();
});

describe('content-hash seeding', () => {
    it('seeds from the inline element on a fresh origin', async () => {
        const { fetchEntity } = await loadApi();
        const rows = await fetchEntity('local/build_projects');
        expect(rows.map(r => r.id).sort()).toEqual([1, 2]);
        expect(window.localStorage.getItem(SEEDVER_KEY)).toBeTruthy();
    });

    it('RE-SEEDS when stale data from a prior bundle sits in shared localStorage', async () => {
        // Simulate a previously-opened bundle: a different seed version + its rows.
        window.localStorage.setItem(SEEDVER_KEY, 'vSTALE');
        window.localStorage.setItem(`${P}build_projects`,
            JSON.stringify([{ id: 99, title: 'STALE Sample Project' }]));
        const { fetchEntity } = await loadApi();
        const rows = await fetchEntity('local/build_projects');
        expect(rows.map(r => r.id).sort()).toEqual([1, 2]);           // fresh seed wins
        expect(rows.some(r => r.title === 'STALE Sample Project')).toBe(false); // stale gone
    });

    it('PERSISTS edits across a reload of the SAME bundle (hash unchanged)', async () => {
        const a1 = await loadApi();
        await a1.fetchEntity('local/customers');                       // triggers seed
        const edited = table('customers').concat({ id: 999, customer_name: 'Edited' });
        window.localStorage.setItem(`${P}customers`, JSON.stringify(edited));
        // Reload same bundle (same inline seed → same hash → no re-seed).
        const a2 = await loadApi();
        const rows = await a2.fetchEntity('local/customers');
        expect(rows.some(c => c.id === 999)).toBe(true);
    });
});

describe('GET filtering', () => {
    it('filters by a single foreign key', async () => {
        const { fetchEntity } = await loadApi();
        expect((await fetchEntity('local/branches?project_fk=1')).map(r => r.id).sort()).toEqual([10, 11]);
    });

    it('handles the IN-clause (csv) syntax', async () => {
        const { fetchEntity } = await loadApi();
        expect((await fetchEntity('local/builds?branch_fk=(10,11)')).map(r => r.id).sort()).toEqual([100, 101]);
    });

    it('ANDs an IN-clause with an equality filter (the release-resolve query)', async () => {
        const { fetchEntity } = await loadApi();
        const rows = await fetchEntity('local/builds?branch_fk=(10,11,20)&external_id=b2');
        expect(rows).toHaveLength(1);
        expect(rows[0].id).toBe(101);
    });

    it('unknown table → fetchEntity returns [] (404)', async () => {
        const { fetchEntity } = await loadApi();
        expect(await fetchEntity('local/widgets')).toEqual([]);
    });
});

describe('POST', () => {
    it('assigns a monotonic id (max seed id + 1), returns [row], persists', async () => {
        const { default: call_rest_api } = await loadApi();
        const res = await call_rest_api('local/branches', 'POST',
            { project_fk: 1, external_id: 'rel', branch_type: 'release' });
        expect(res.httpStatus.httpStatus).toBe(200);
        expect(res.data[0].id).toBe(301);                 // max seed id (300) + 1
        expect(res.data[0].create_ts).toBeTruthy();
        const res2 = await call_rest_api('local/builds', 'POST', { branch_fk: 301 });
        expect(res2.data[0].id).toBe(302);
    });
});

describe('PUT', () => {
    it('updates matching rows by id and stamps update_ts', async () => {
        const { default: call_rest_api } = await loadApi();
        await call_rest_api('local/builds', 'PUT', [{ id: 100, approved_for_release: 1 }]);
        const row = table('builds').find(b => b.id === 100);
        expect(row.approved_for_release).toBe(1);
        expect(row.update_ts).toBeTruthy();
    });
});

describe('DELETE cascade', () => {
    it('deleting a build removes its customer_releases', async () => {
        const { default: call_rest_api } = await loadApi();
        await call_rest_api('local/builds', 'DELETE', { id: 100 });
        expect(table('builds').some(b => b.id === 100)).toBe(false);
        expect(table('customer_releases').some(r => r.build_fk === 100)).toBe(false);
    });

    it('deleting a branch removes its builds (and their releases)', async () => {
        const { default: call_rest_api } = await loadApi();
        await call_rest_api('local/branches', 'DELETE', { id: 10 });
        expect(table('builds').some(b => b.branch_fk === 10)).toBe(false);
        expect(table('customer_releases').some(r => r.build_fk === 100)).toBe(false);
    });

    it('deleting a project cascades branches → builds → customer_releases', async () => {
        const { default: call_rest_api } = await loadApi();
        await call_rest_api('local/build_projects', 'DELETE', { id: 1 });
        expect(table('build_projects').map(p => p.id)).toEqual([2]);
        expect(table('branches').map(b => b.id)).toEqual([20]);
        expect(table('builds').map(b => b.id)).toEqual([200]);
        expect(table('customer_releases')).toHaveLength(0);
    });
});
