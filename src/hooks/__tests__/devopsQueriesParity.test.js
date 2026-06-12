// Req #2593 — parity test asserting that the factory-generated devops keys
// and hooks match the legacy hand-written shapes byte-for-byte. This is what
// guarantees the refactor is observably a no-op for every existing consumer
// (incl. SwarmSessionDetail.jsx's `queryClient.invalidateQueries({ queryKey:
// sessionKeys.byId(id) })`).

import { describe, it, expect } from 'vitest';
import {
    devServerKeys,
    sessionKeys,
    swarmStartKeys,
    swarmStartSessionKeys,
    swarmUndoKeys,
} from '../useQueryKeys';
import {
    useDevServers,
    useDevServersBySession,
    useSessions,
    useSession,
    useAllSwarmStarts,
    useSwarmStartById,
    useAllSwarmStartSessions,
    useAllSwarmUndos,
    useSwarmUndoById,
} from '../useDataQueries';

describe('devServerKeys parity', () => {
    it('all(creator) → ["dev_servers", creator]', () => {
        expect(devServerKeys.all('alice')).toEqual(['dev_servers', 'alice']);
    });
    it('bySession(sessionId) → ["dev_servers", { sessionId }]  (legacy object-key)', () => {
        expect(devServerKeys.bySession(5)).toEqual(['dev_servers', { sessionId: 5 }]);
    });
});

describe('sessionKeys parity', () => {
    it('all(creator) → ["swarm_sessions", creator]', () => {
        expect(sessionKeys.all('alice')).toEqual(['swarm_sessions', 'alice']);
    });
    it('byId(sessionId) → ["swarm_sessions", { id: sessionId }]  (no creator — legacy shape)', () => {
        expect(sessionKeys.byId(5)).toEqual(['swarm_sessions', { id: 5 }]);
    });
});

describe('swarmStartKeys parity', () => {
    it('all(creator) → ["swarm_starts", creator]', () => {
        expect(swarmStartKeys.all('alice')).toEqual(['swarm_starts', 'alice']);
    });
    it('byId(creator, id) → ["swarm_starts", creator, { id }]', () => {
        expect(swarmStartKeys.byId('alice', 42)).toEqual(['swarm_starts', 'alice', { id: 42 }]);
    });
    it('byId is prefix-compatible with all() for invalidation', () => {
        const allKey = swarmStartKeys.all('alice');
        const byIdKey = swarmStartKeys.byId('alice', 42);
        expect(byIdKey.slice(0, allKey.length)).toEqual(allKey);
    });
});

describe('swarmStartSessionKeys parity', () => {
    it('all(creator) → ["swarm_start_sessions", creator]', () => {
        expect(swarmStartSessionKeys.all('alice')).toEqual(['swarm_start_sessions', 'alice']);
    });
});

// Req #2719 — swarm_undos key + hook shape matches the existing devops factory
// outputs (swarmStarts pattern, fields-in-key, defaultSort:undone_at).
// Routes through darwinUri (dev/prod split) — as do all ops blocks since
// req #2827 dropped the req #2697 `ops: true` pin from the four original
// ops tables. See devopsQueries.js comment.
describe('swarmUndoKeys parity', () => {
    it('all(creator) → ["swarm_undos", creator]', () => {
        expect(swarmUndoKeys.all('alice')).toEqual(['swarm_undos', 'alice']);
    });
    it('byId(creator, id) → ["swarm_undos", creator, { id }]', () => {
        expect(swarmUndoKeys.byId('alice', 7)).toEqual(['swarm_undos', 'alice', { id: 7 }]);
    });
    it('byId is prefix-compatible with all() for invalidation', () => {
        const allKey = swarmUndoKeys.all('alice');
        const byIdKey = swarmUndoKeys.byId('alice', 7);
        expect(byIdKey.slice(0, allKey.length)).toEqual(allKey);
    });
});

describe('devops hook exports', () => {
    it('every legacy hook name is exported as a function', () => {
        expect(typeof useDevServers).toBe('function');
        expect(typeof useDevServersBySession).toBe('function');
        expect(typeof useSessions).toBe('function');
        expect(typeof useSession).toBe('function');
        expect(typeof useAllSwarmStarts).toBe('function');
        expect(typeof useSwarmStartById).toBe('function');
        expect(typeof useAllSwarmStartSessions).toBe('function');
        expect(typeof useAllSwarmUndos).toBe('function');
        expect(typeof useSwarmUndoById).toBe('function');
    });
});
