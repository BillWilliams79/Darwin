import { describe, it, expect } from 'vitest';
import { customerKeys } from '../useQueryKeys';

describe('customerKeys (req #2604)', () => {
    it('all() partitions cache by creator_fk', () => {
        expect(customerKeys.all('alice')).toEqual(['customers', 'alice']);
        expect(customerKeys.all('bob')).toEqual(['customers', 'bob']);
        expect(customerKeys.all('alice'))
            .not.toEqual(customerKeys.all('bob'));
    });

    it('byId() includes id in the key', () => {
        const k = customerKeys.byId('alice', 7);
        expect(k).toEqual(['customers', 'alice', { id: 7 }]);
    });

    it('byId is prefix-compatible with all() for invalidation', () => {
        // TanStack Query prefix-match: invalidating customerKeys.all() also
        // invalidates customerKeys.byId() because byId starts with all() as
        // a prefix.
        const allKey = customerKeys.all('alice');
        const byIdKey = customerKeys.byId('alice', 7);
        expect(byIdKey.slice(0, allKey.length)).toEqual(allKey);
    });
});
