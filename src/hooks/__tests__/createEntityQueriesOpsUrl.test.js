// Req #2697 — regression guard for the operational-table URL routing.
//
// Pre-#2697: a dev-mode build pointing AppContext.database at `darwin_dev`
// caused every operational-table read (`dev_servers`, `swarm_sessions`,
// `swarm_starts`, `swarm_start_sessions`) to silently return 0 rows because
// the MCP daemon writes them exclusively to the production `darwin` schema.
//
// The fix: `ops: true` in the entity config makes the factory pick
// `darwinOpsUri` (always `/darwin`) from AppContext instead of `darwinUri`
// (which honors the dev/prod split). These tests assert the actual REST URL
// every factory hook builds depending on the `ops` flag.

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

describe('createEntityQueries — wired devops blocks route correctly', () => {
    // Imported here so vi.mock declarations above are in effect.
    it('devServers.useAll hits the production darwin schema', async () => {
        const { devServers } = await import('../factory/devopsQueries');
        devServers.useAll('alice');
        const url = callRestApiMock.mock.calls[0][0];
        expect(url).toContain(`${TEST_DARWIN_OPS_URI}/dev_servers`);
        expect(url).not.toContain('darwin_dev');
    });

    it('sessions.useAll hits the production darwin schema', async () => {
        const { sessions } = await import('../factory/devopsQueries');
        sessions.useAll('alice');
        const url = callRestApiMock.mock.calls[0][0];
        expect(url).toContain(`${TEST_DARWIN_OPS_URI}/swarm_sessions`);
        expect(url).not.toContain('darwin_dev');
    });

    it('swarmStarts.useAll hits the production darwin schema', async () => {
        const { swarmStarts } = await import('../factory/devopsQueries');
        swarmStarts.useAll('alice');
        const url = callRestApiMock.mock.calls[0][0];
        expect(url).toContain(`${TEST_DARWIN_OPS_URI}/swarm_starts`);
        expect(url).not.toContain('darwin_dev');
    });

    it('swarmStartSessions.useAll hits the production darwin schema', async () => {
        const { swarmStartSessions } = await import('../factory/devopsQueries');
        swarmStartSessions.useAll('alice');
        const url = callRestApiMock.mock.calls[0][0];
        expect(url).toContain(`${TEST_DARWIN_OPS_URI}/swarm_start_sessions`);
        expect(url).not.toContain('darwin_dev');
    });
});
