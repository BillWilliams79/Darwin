import { describe, it, expect } from 'vitest';
import { swarmStartKeys } from '../useQueryKeys';

describe('swarmStartKeys (req #2422)', () => {
    it('all() partitions cache by creator_fk', () => {
        expect(swarmStartKeys.all('alice')).toEqual(['swarm_starts', 'alice']);
        expect(swarmStartKeys.all('bob')).toEqual(['swarm_starts', 'bob']);
        expect(swarmStartKeys.all('alice'))
            .not.toEqual(swarmStartKeys.all('bob'));
    });

    it('byId() includes id in the key', () => {
        const k = swarmStartKeys.byId('alice', 42);
        expect(k).toEqual(['swarm_starts', 'alice', { id: 42 }]);
    });

    it('byId is prefix-compatible with all() for invalidation', () => {
        // TanStack Query's prefix-match: invalidating swarmStartKeys.all() should
        // also invalidate swarmStartKeys.byId() because the latter starts with
        // the same prefix.
        const allKey = swarmStartKeys.all('alice');
        const byIdKey = swarmStartKeys.byId('alice', 42);
        expect(byIdKey.slice(0, allKey.length)).toEqual(allKey);
    });
});
