// Req #2697 / #2827 — URL routing guard for the entity-queries factory.
//
// Req #2697 introduced an `ops: true` flag: it makes the factory pick
// `darwinOpsUri` (always `/darwin`) from AppContext instead of `darwinUri`
// (which honors the dev/prod split). The first describe block below still
// exercises that flag directly — it remains a generic factory capability.
//
// Req #2827 REMOVED `ops: true` from the four original ops tables
// (`dev_servers`, `swarm_sessions`, `swarm_starts`, `swarm_start_sessions`):
// pinning their reads to production `darwin` defeated dev/prod separation for
// TESTING (you could not seed viewable test data without polluting
// production). They now route through `darwinUri` like every other ops block.
// The "wired devops blocks" describe at the bottom locks in that new behavior:
// in a dev-mode build (darwinUri ends in `/darwin_dev`) those reads hit
// `darwin_dev`, not production.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// vi.mock factories are hoisted above imports, so the mock fn must be
// declared via vi.hoisted() (also hoisted) to be in scope.
const { callRestApiMock } = vi.hoisted(() => ({
    callRestApiMock: vi.fn().mockResolvedValue({
        data: [],
        httpStatus: { httpStatus: 200 },
    }),
}));
vi.mock('../../RestApi/RestApi', () => ({
    default: callRestApiMock,
}));

// Stub useQuery so it fires queryFn synchronously when enabled.
vi.mock('@tanstack/react-query', () => ({
    useQuery: ({ queryFn, enabled }) => {
        if (enabled) queryFn();
        return { data: null, isLoading: false };
    },
}));

// Stub useContext so it returns the right context value for each Context.
// The factory uses default-export AppContext + AuthContext as the keys.
const TEST_DARWIN_URI    = 'https://api.test/eng/darwin_dev';
const TEST_DARWIN_OPS_URI = 'https://api.test/eng/darwin';

// Identity-based context registry. We populate it after the production
// modules import their AppContext/AuthContext defaults so we can map
// each context to the test value the factory should see.
const { ctxRegistry } = vi.hoisted(() => ({ ctxRegistry: new Map() }));

vi.mock('react', async () => {
    const actual = await vi.importActual('react');
    return {
        ...actual,
        useContext: (ctx) => ctxRegistry.get(ctx) || {},
    };
});

// Imports must come AFTER vi.mock declarations so they bind to the stubs.
import AppContext from '../../Context/AppContext';
import AuthContext from '../../Context/AuthContext';
import { createEntityQueries } from '../factory/createEntityQueries';

ctxRegistry.set(AppContext, { darwinUri: TEST_DARWIN_URI, darwinOpsUri: TEST_DARWIN_OPS_URI });
ctxRegistry.set(AuthContext, { idToken: 'test-token' });

beforeEach(() => {
    callRestApiMock.mockClear();
});

describe('createEntityQueries — ops:true routes URLs to darwinOpsUri', () => {
    it('useAll uses darwinOpsUri when ops:true', () => {
        const e = createEntityQueries({ entity: 'dev_servers', ops: true });
        e.useAll('alice');
        expect(callRestApiMock).toHaveBeenCalledTimes(1);
        const url = callRestApiMock.mock.calls[0][0];
        expect(url).toContain(`${TEST_DARWIN_OPS_URI}/dev_servers`);
        expect(url).not.toContain('darwin_dev');
    });

    it('useById uses darwinOpsUri when ops:true', () => {
        const e = createEntityQueries({ entity: 'swarm_sessions', ops: true, byIdCreatorScoped: false });
        e.useById(42);
        const url = callRestApiMock.mock.calls[0][0];
        expect(url).toContain(`${TEST_DARWIN_OPS_URI}/swarm_sessions?id=42`);
        expect(url).not.toContain('darwin_dev');
    });

    it('useBy<FK> uses darwinOpsUri when ops:true', () => {
        const e = createEntityQueries({
            entity: 'dev_servers',
            ops: true,
            foreignKeys: [{ field: 'session_fk', as: 'session', creatorScoped: false }],
        });
        e.useBySession(7);
        const url = callRestApiMock.mock.calls[0][0];
        expect(url).toContain(`${TEST_DARWIN_OPS_URI}/dev_servers?session_fk=7`);
        expect(url).not.toContain('darwin_dev');
    });
});

describe('createEntityQueries — default (ops:false) still uses darwinUri', () => {
    it('useAll uses darwinUri (dev_dev schema honored) when ops flag omitted', () => {
        const e = createEntityQueries({ entity: 'widgets' });
        e.useAll('alice');
        const url = callRestApiMock.mock.calls[0][0];
        expect(url).toContain(`${TEST_DARWIN_URI}/widgets`);
    });
});

describe('createEntityQueries — wired devops blocks follow dev/prod split (req #2827)', () => {
    // Imported here so vi.mock declarations above are in effect.
    // Req #2827 removed ops:true from these four blocks — a dev-mode build
    // (darwinUri == /darwin_dev) now reads them from darwin_dev, never prod.
    it('devServers.useAll reads from darwinUri (darwin_dev in dev mode)', async () => {
        const { devServers } = await import('../factory/devopsQueries');
        devServers.useAll('alice');
        const url = callRestApiMock.mock.calls[0][0];
        expect(url).toContain(`${TEST_DARWIN_URI}/dev_servers`);
    });

    it('sessions.useAll reads from darwinUri (darwin_dev in dev mode)', async () => {
        const { sessions } = await import('../factory/devopsQueries');
        sessions.useAll('alice');
        const url = callRestApiMock.mock.calls[0][0];
        expect(url).toContain(`${TEST_DARWIN_URI}/swarm_sessions`);
    });

    // Req #2834 — the sessions LIST query must project a `fields=` whitelist that
    // EXCLUDES the four heavy TEXT columns. Without this, the unfiltered all-rows
    // response grew past AWS Lambda's 6 MB synchronous response limit (~6.06 MB at
    // 668 rows) → the Lambda failed → API Gateway 502 → the /swarm/sessions page
    // hung on an infinite spinner. This guards against silently dropping the
    // projection and reintroducing the regression.
    it('sessions.useAll projects fields and EXCLUDES the heavy TEXT columns (req #2834)', async () => {
        const { sessions } = await import('../factory/devopsQueries');
        sessions.useAll('alice');
        const url = callRestApiMock.mock.calls[0][0];
        const fieldsMatch = /[?&]fields=([^&]+)/.exec(url);
        expect(fieldsMatch).not.toBeNull();
        // Match whole CSV tokens, not substrings — 'plan' is a substring of the KEPT
        // column 'planning_secs', so a naive url.includes('plan') would false-positive.
        const projected = fieldsMatch[1].split(',');
        for (const heavy of ['telemetry', 'plan', 'start_summary', 'complete_summary']) {
            expect(projected).not.toContain(heavy);
        }
        // Sanity: the projection still includes the columns the list/cards/visualizer render.
        for (const kept of ['swarm_status', 'source_ref', 'title', 'implementing_secs']) {
            expect(projected).toContain(kept);
        }
    });

    it('swarmStarts.useAll reads from darwinUri (darwin_dev in dev mode)', async () => {
        const { swarmStarts } = await import('../factory/devopsQueries');
        swarmStarts.useAll('alice');
        const url = callRestApiMock.mock.calls[0][0];
        expect(url).toContain(`${TEST_DARWIN_URI}/swarm_starts`);
    });

    it('swarmStartSessions.useAll reads from darwinUri (darwin_dev in dev mode)', async () => {
        const { swarmStartSessions } = await import('../factory/devopsQueries');
        swarmStartSessions.useAll('alice');
        const url = callRestApiMock.mock.calls[0][0];
        expect(url).toContain(`${TEST_DARWIN_URI}/swarm_start_sessions`);
    });
});
