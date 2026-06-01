import { describe, it, expect } from 'vitest';
import { PROD_BASE_URL, prodRequirementUrl } from '../prodUrl';

describe('PROD_BASE_URL', () => {
    it('is the canonical production darwin.one origin', () => {
        expect(PROD_BASE_URL).toBe('https://www.darwin.one');
    });
});

describe('prodRequirementUrl', () => {
    it('builds an absolute production requirement URL', () => {
        expect(prodRequirementUrl(2757)).toBe('https://www.darwin.one/swarm/requirement/2757');
    });

    it('always points at production, never a relative/local path', () => {
        const url = prodRequirementUrl(42);
        expect(url.startsWith('https://www.darwin.one/')).toBe(true);
        expect(url.startsWith('/')).toBe(false);
    });

    it('accepts string ids unchanged', () => {
        expect(prodRequirementUrl('2757')).toBe('https://www.darwin.one/swarm/requirement/2757');
    });
});
