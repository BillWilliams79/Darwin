import { describe, it, expect } from 'vitest';
import {
    PHASE_BUCKETS,
    TOKEN_TYPES,
    tokenPhaseKey,
    parsePhaseTokens,
    sumPhaseTokens,
    bucketTokens,
    formatTokens,
} from '../sessionPhases';

// --- tokenPhaseKey -----------------------------------------------------------
describe('tokenPhaseKey', () => {
    it('strips _secs suffix from all PHASE_BUCKETS keys', () => {
        expect(tokenPhaseKey('implementing_secs')).toBe('implementing');
        expect(tokenPhaseKey('starting_secs')).toBe('starting');
        expect(tokenPhaseKey('planning_secs')).toBe('planning');
        expect(tokenPhaseKey('review_secs')).toBe('review');
        expect(tokenPhaseKey('completion_secs')).toBe('completion');
        expect(tokenPhaseKey('waiting_secs')).toBe('waiting');
        expect(tokenPhaseKey('paused_secs')).toBe('paused');
    });

    it('handles the legacy_secs key (strips _secs)', () => {
        expect(tokenPhaseKey('legacy_secs')).toBe('legacy');
    });

    it('returns key unchanged when no _secs suffix', () => {
        expect(tokenPhaseKey('implementing')).toBe('implementing');
    });
});

// --- parsePhaseTokens --------------------------------------------------------
describe('parsePhaseTokens', () => {
    it('returns null for null/undefined', () => {
        expect(parsePhaseTokens(null)).toBeNull();
        expect(parsePhaseTokens(undefined)).toBeNull();
    });

    it('returns the object directly for an already-decoded object', () => {
        const obj = { planning: { input: 10 } };
        expect(parsePhaseTokens(obj)).toBe(obj);
    });

    it('returns null for an empty string', () => {
        expect(parsePhaseTokens('')).toBeNull();
        expect(parsePhaseTokens('   ')).toBeNull();
    });

    it('parses a valid JSON string', () => {
        const str = JSON.stringify({ implementing: { input: 5, output: 10 } });
        const result = parsePhaseTokens(str);
        expect(result).toEqual({ implementing: { input: 5, output: 10 } });
    });

    it('returns null for garbage/unparseable strings', () => {
        expect(parsePhaseTokens('not-json')).toBeNull();
        expect(parsePhaseTokens('{bad')).toBeNull();
    });

    it('returns null for a JSON string that parses to a non-object', () => {
        expect(parsePhaseTokens('"hello"')).toBeNull();
        expect(parsePhaseTokens('42')).toBeNull();
        expect(parsePhaseTokens('true')).toBeNull();
    });

    it('returns null for a number input', () => {
        expect(parsePhaseTokens(123)).toBeNull();
    });

    it('returns null for a boolean input', () => {
        expect(parsePhaseTokens(true)).toBeNull();
    });

    it('returns the array for an array input (typeof === object)', () => {
        // Arrays are objects in JS — parsePhaseTokens returns them as-is.
        const arr = [1, 2, 3];
        expect(parsePhaseTokens(arr)).toBe(arr);
    });
});

// --- sumPhaseTokens ----------------------------------------------------------
describe('sumPhaseTokens', () => {
    it('sums all four token types', () => {
        expect(sumPhaseTokens({ input: 10, cache_write: 20, cache_read: 30, output: 40 })).toBe(100);
    });

    it('returns 0 for null/undefined/non-object', () => {
        expect(sumPhaseTokens(null)).toBe(0);
        expect(sumPhaseTokens(undefined)).toBe(0);
        expect(sumPhaseTokens('string')).toBe(0);
        expect(sumPhaseTokens(42)).toBe(0);
    });

    it('treats missing keys as 0', () => {
        expect(sumPhaseTokens({ input: 50 })).toBe(50);
        expect(sumPhaseTokens({})).toBe(0);
    });

    it('coerces non-numeric values to 0 (NaN → 0 via Number||0)', () => {
        expect(sumPhaseTokens({ input: 'bad', cache_write: null, cache_read: undefined, output: 10 })).toBe(10);
    });
});

// --- bucketTokens ------------------------------------------------------------
describe('bucketTokens', () => {
    const parsed = {
        implementing: { input: 10, cache_write: 20, cache_read: 30, output: 40 },
        review: { input: 1, cache_write: 1, cache_read: 1, output: 1 },
    };

    it('returns the sum for a present bucket', () => {
        expect(bucketTokens(parsed, 'implementing_secs')).toBe(100);
        expect(bucketTokens(parsed, 'review_secs')).toBe(4);
    });

    it('returns 0 for a bucket not present in phase_tokens', () => {
        expect(bucketTokens(parsed, 'planning_secs')).toBe(0);
    });

    it('returns 0 when parsedTokens is null', () => {
        expect(bucketTokens(null, 'implementing_secs')).toBe(0);
    });

    it('returns 0 when parsedTokens is undefined', () => {
        expect(bucketTokens(undefined, 'implementing_secs')).toBe(0);
    });

    it('handles legacy_secs correctly (maps to "legacy" which is unlikely to exist)', () => {
        // legacy_secs → tokenPhaseKey → "legacy" → not in phase_tokens → 0
        expect(bucketTokens(parsed, 'legacy_secs')).toBe(0);
        // But if someone explicitly sets a "legacy" key, it works.
        const withLegacy = { ...parsed, legacy: { input: 5, cache_write: 0, cache_read: 0, output: 5 } };
        expect(bucketTokens(withLegacy, 'legacy_secs')).toBe(10);
    });
});

// --- formatTokens ------------------------------------------------------------
describe('formatTokens', () => {
    it('formats >= 1M with one decimal', () => {
        expect(formatTokens(1500000)).toBe('1.5M');
        expect(formatTokens(1000000)).toBe('1.0M');
        expect(formatTokens(12345678)).toBe('12.3M');
    });

    it('formats >= 1k with one decimal', () => {
        expect(formatTokens(1500)).toBe('1.5k');
        expect(formatTokens(1000)).toBe('1.0k');
        expect(formatTokens(45600)).toBe('45.6k');
        expect(formatTokens(999999)).toBe('1000.0k');
    });

    it('formats < 1k with locale string', () => {
        expect(formatTokens(0)).toBe('0');
        expect(formatTokens(789)).toBe('789');
        expect(formatTokens(999)).toBe('999');
    });

    it('returns dash for null/undefined', () => {
        expect(formatTokens(null)).toBe('—');
        expect(formatTokens(undefined)).toBe('—');
    });

    it('returns dash for non-finite numbers (NaN, Infinity)', () => {
        expect(formatTokens(NaN)).toBe('—');
        expect(formatTokens(Infinity)).toBe('—');
        expect(formatTokens(-Infinity)).toBe('—');
    });

    it('coerces a numeric string', () => {
        expect(formatTokens('5000')).toBe('5.0k');
    });

    it('returns dash for a non-numeric string', () => {
        expect(formatTokens('abc')).toBe('—');
    });
});

// --- TOKEN_TYPES constant ----------------------------------------------------
describe('TOKEN_TYPES', () => {
    it('has exactly four members', () => {
        expect(TOKEN_TYPES).toHaveLength(4);
    });

    it('contains the four canonical types', () => {
        expect(TOKEN_TYPES).toEqual(['input', 'cache_write', 'cache_read', 'output']);
    });
});

// --- PHASE_BUCKETS parity with backend (cross-check) -------------------------
describe('PHASE_BUCKETS', () => {
    it('has 8 entries (7 real + legacy)', () => {
        expect(PHASE_BUCKETS).toHaveLength(8);
    });

    it('every bucket has key/label/group/color', () => {
        for (const b of PHASE_BUCKETS) {
            expect(b).toHaveProperty('key');
            expect(b).toHaveProperty('label');
            expect(b).toHaveProperty('group');
            expect(b).toHaveProperty('color');
        }
    });

    it('tokenPhaseKey works on every bucket key', () => {
        for (const b of PHASE_BUCKETS) {
            const phase = tokenPhaseKey(b.key);
            expect(phase).toBeTruthy();
            expect(phase).not.toContain('_secs');
        }
    });
});
