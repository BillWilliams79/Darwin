import { describe, it, expect } from 'vitest';
import {
    BRANCH_TYPES,
    branchTypeChipProps,
    branchTypeLabel,
} from '../branchTypeChipStyles';

describe('BRANCH_TYPES', () => {
    it('lists the six non-main branch types in REGISTRY (Topology/build-visualizer/app.js)', () => {
        expect(BRANCH_TYPES).toEqual([
            'release',
            'sample-release',
            'hotfix',
            'bootleg',
            'csr',
            'development',
        ]);
    });
    it('has no duplicates', () => {
        expect(new Set(BRANCH_TYPES).size).toBe(BRANCH_TYPES.length);
    });
    it('does not include "main" — main is always visible and not a chip', () => {
        expect(BRANCH_TYPES).not.toContain('main');
    });
});

describe('branchTypeChipProps', () => {
    it.each(BRANCH_TYPES)('returns a coloured sx for type %s', (type) => {
        const props = branchTypeChipProps(type);
        expect(props.sx).toBeDefined();
        expect(props.sx.bgcolor).toMatch(/^#[0-9a-f]{6}$/i);
        expect(props.sx.color).toMatch(/^#[0-9a-f]{3}$/i);
    });
    it('returns a default fallback for unknown types', () => {
        expect(branchTypeChipProps('not-a-type')).toEqual({ color: 'default' });
    });
});

describe('branchTypeLabel', () => {
    it.each([
        ['release',         'Release'],
        ['sample-release',  'Sample Release'],
        ['hotfix',          'Hot Fix'],
        ['bootleg',         'Bootleg'],
        ['csr',             'CSR'],
        ['development',     'Development'],
    ])('formats %s as %s', (type, expected) => {
        expect(branchTypeLabel(type)).toBe(expected);
    });
    it('returns the raw type for unknown values', () => {
        expect(branchTypeLabel('mystery')).toBe('mystery');
    });
});
