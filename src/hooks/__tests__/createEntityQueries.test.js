// Req #2593 — pure-data tests for the createEntityQueries factory.
// React-bound hook behavior (useQuery wiring, context reads) is covered
// indirectly by the parity test against the legacy hand-written hooks and by
// the E2E suite which exercises every consuming page.

import { describe, it, expect } from 'vitest';
import { createEntityQueries } from '../factory/createEntityQueries';

describe('createEntityQueries — required config', () => {
    it('throws when entity is missing', () => {
        expect(() => createEntityQueries({})).toThrow(/entity is required/);
    });
});

describe('createEntityQueries — key factories (default config)', () => {
    const e = createEntityQueries({ entity: 'widgets' });

    it('all() partitions by creator', () => {
        expect(e.keys.all('alice')).toEqual(['widgets', 'alice']);
        expect(e.keys.all('alice')).not.toEqual(e.keys.all('bob'));
    });

    it('byId() defaults to creator-scoped shape', () => {
        expect(e.keys.byId('alice', 42)).toEqual(['widgets', 'alice', { id: 42 }]);
    });

    it('byId() is prefix-compatible with all() for invalidation', () => {
        const allKey = e.keys.all('alice');
        const byIdKey = e.keys.byId('alice', 42);
        expect(byIdKey.slice(0, allKey.length)).toEqual(allKey);
    });

    it('no foreign-key hooks when foreignKeys is empty', () => {
        expect(e.useBySession).toBeUndefined();
        expect(Object.keys(e.keys).sort()).toEqual(['all', 'byId']);
    });
});

describe('createEntityQueries — byIdCreatorScoped: false', () => {
    const e = createEntityQueries({ entity: 'widgets', byIdCreatorScoped: false });

    it('byId() omits the creator and produces the legacy 2-tuple shape', () => {
        expect(e.keys.byId(42)).toEqual(['widgets', { id: 42 }]);
    });

    it('produces a hook with the same name regardless of scoping', () => {
        expect(typeof e.useById).toBe('function');
    });
});

describe('createEntityQueries — foreignKeys', () => {
    const e = createEntityQueries({
        entity: 'widgets',
        foreignKeys: [
            { field: 'session_fk', as: 'session', creatorScoped: false },
            { field: 'pipeline_fk', as: 'pipeline' },                    // creator-scoped by default
            { field: 'session_fk', as: 'sessionLegacy', creatorScoped: false, keyParam: 'sessionId' },
        ],
    });

    it('generates by<Name> key fns for each foreign key', () => {
        expect(typeof e.keys.bySession).toBe('function');
        expect(typeof e.keys.byPipeline).toBe('function');
        expect(typeof e.keys.bySessionLegacy).toBe('function');
    });

    it('non-creator-scoped fk keys default to SQL-column object-key', () => {
        expect(e.keys.bySession(99)).toEqual(['widgets', { session_fk: 99 }]);
    });

    it('creator-scoped fk keys include creator before the filter object', () => {
        expect(e.keys.byPipeline('alice', 7)).toEqual(['widgets', 'alice', { pipeline_fk: 7 }]);
    });

    it('keyParam preserves a legacy object-key name (e.g. sessionId)', () => {
        expect(e.keys.bySessionLegacy(99)).toEqual(['widgets', { sessionId: 99 }]);
    });

    it('generates a useBy<Name> hook for each foreign key', () => {
        expect(typeof e.useBySession).toBe('function');
        expect(typeof e.useByPipeline).toBe('function');
        expect(typeof e.useBySessionLegacy).toBe('function');
    });
});

describe('createEntityQueries — return shape', () => {
    it('always returns keys/useAll/useById regardless of foreignKeys', () => {
        const e = createEntityQueries({ entity: 'widgets' });
        expect(typeof e.useAll).toBe('function');
        expect(typeof e.useById).toBe('function');
        expect(typeof e.keys).toBe('object');
    });
});
