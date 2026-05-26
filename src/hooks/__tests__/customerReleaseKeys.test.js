import { describe, it, expect } from 'vitest';
import { customerReleaseKeys } from '../useQueryKeys';

describe('customerReleaseKeys (req #2606)', () => {
    it('all() partitions cache by creator_fk', () => {
        expect(customerReleaseKeys.all('alice')).toEqual(['customer_releases', 'alice']);
        expect(customerReleaseKeys.all('bob')).toEqual(['customer_releases', 'bob']);
        expect(customerReleaseKeys.all('alice'))
            .not.toEqual(customerReleaseKeys.all('bob'));
    });

    it('byBuild() includes buildId in the key', () => {
        const k = customerReleaseKeys.byBuild('alice', 42);
        expect(k).toEqual(['customer_releases', 'alice', { buildId: 42 }]);
    });

    it('byCustomer() and byBuild() are prefix-compatible with all() for invalidation', () => {
        // TanStack Query prefix-match: invalidating customerReleaseKeys.all()
        // also invalidates byBuild() and byCustomer() because both start
        // with all() as a prefix.
        const allKey = customerReleaseKeys.all('alice');
        const byBuildKey = customerReleaseKeys.byBuild('alice', 42);
        const byCustomerKey = customerReleaseKeys.byCustomer('alice', 3);
        expect(byBuildKey.slice(0, allKey.length)).toEqual(allKey);
        expect(byCustomerKey.slice(0, allKey.length)).toEqual(allKey);
    });
});
