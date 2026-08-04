import { describe, it, expect } from 'vitest';
import { swarmStartTokenTotal } from '../tokenTotals';

describe('swarmStartTokenTotal', () => {
    it('returns null when every token field is null/undefined', () => {
        expect(swarmStartTokenTotal({
            tokens_input: null, tokens_cache_write: null,
            tokens_cache_read: null, tokens_output: undefined,
        })).toBeNull();
    });

    it('sums all four factors', () => {
        expect(swarmStartTokenTotal({
            tokens_input: 100, tokens_cache_write: 200,
            tokens_cache_read: 300, tokens_output: 400,
        })).toBe(1000);
    });

    it('treats a partially-populated row as tracked — missing factors contribute 0', () => {
        expect(swarmStartTokenTotal({
            tokens_input: 100, tokens_cache_write: null,
            tokens_cache_read: null, tokens_output: null,
        })).toBe(100);
    });

    it('treats an all-zero row as a real, tracked total of 0 (not the null/untracked case)', () => {
        expect(swarmStartTokenTotal({
            tokens_input: 0, tokens_cache_write: 0,
            tokens_cache_read: 0, tokens_output: 0,
        })).toBe(0);
    });

    it('coerces string token counts (as the API returns them) the same as numbers', () => {
        expect(swarmStartTokenTotal({
            tokens_input: '100', tokens_cache_write: '200',
            tokens_cache_read: '300', tokens_output: '400',
        })).toBe(1000);
    });
});
