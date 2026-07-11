// Req #2943 — machines query factory shape: keys + hook exports. Mirrors the
// devopsQueriesParity pattern for the newest devops entity.

import { describe, it, expect } from 'vitest';
import { machines } from '../factory/devopsQueries';
import { useMachines, useMachine, machineKeys } from '../useDataQueries';

describe('machineKeys', () => {
    it('all(creator) → ["machines", creator]', () => {
        expect(machineKeys.all('alice')).toEqual(['machines', 'alice']);
    });
    it('byId(creator, id) → ["machines", creator, { id }]', () => {
        expect(machineKeys.byId('alice', 3)).toEqual(['machines', 'alice', { id: 3 }]);
    });
    it('byId is prefix-compatible with all() for invalidation', () => {
        const allKey = machineKeys.all('alice');
        const byIdKey = machineKeys.byId('alice', 3);
        expect(byIdKey.slice(0, allKey.length)).toEqual(allKey);
    });
});

describe('machines hook exports', () => {
    it('useMachines / useMachine are functions', () => {
        expect(typeof useMachines).toBe('function');
        expect(typeof useMachine).toBe('function');
    });
    it('factory exposes keys.all and keys.byId', () => {
        expect(typeof machines.keys.all).toBe('function');
        expect(typeof machines.keys.byId).toBe('function');
    });
});
