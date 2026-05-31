import { describe, it, expect } from 'vitest';
import { STAR_COLORS, DEFAULT_STAR_COLOR, starColorFor } from '../starColors';

describe('STAR_COLORS map', () => {
    it('has entries for 5 branch types', () => {
        expect(Object.keys(STAR_COLORS)).toHaveLength(5);
    });

    it('maps release to gold', () => {
        expect(STAR_COLORS.release.fill).toBe('#fbbf24');
        expect(STAR_COLORS.release.stroke).toBe('#b45309');
    });

    it('maps sample-release to gold', () => {
        expect(STAR_COLORS['sample-release']).toEqual(STAR_COLORS.release);
    });

    it('maps csr to gold', () => {
        expect(STAR_COLORS.csr).toEqual(STAR_COLORS.release);
    });

    it('maps hotfix to silver', () => {
        expect(STAR_COLORS.hotfix.fill).toBe('#d4d4d8');
        expect(STAR_COLORS.hotfix.stroke).toBe('#71717a');
    });

    it('maps bootleg to red', () => {
        expect(STAR_COLORS.bootleg.fill).toBe('#ef4444');
        expect(STAR_COLORS.bootleg.stroke).toBe('#991b1b');
    });
});

describe('DEFAULT_STAR_COLOR', () => {
    it('is gold', () => {
        expect(DEFAULT_STAR_COLOR.fill).toBe('#fbbf24');
        expect(DEFAULT_STAR_COLOR.stroke).toBe('#b45309');
    });
});

describe('starColorFor', () => {
    it('returns gold for release', () => {
        expect(starColorFor('release')).toEqual({ fill: '#fbbf24', stroke: '#b45309' });
    });

    it('returns gold for sample-release', () => {
        expect(starColorFor('sample-release')).toEqual({ fill: '#fbbf24', stroke: '#b45309' });
    });

    it('returns gold for csr', () => {
        expect(starColorFor('csr')).toEqual({ fill: '#fbbf24', stroke: '#b45309' });
    });

    it('returns silver for hotfix', () => {
        expect(starColorFor('hotfix')).toEqual({ fill: '#d4d4d8', stroke: '#71717a' });
    });

    it('returns red for bootleg', () => {
        expect(starColorFor('bootleg')).toEqual({ fill: '#ef4444', stroke: '#991b1b' });
    });

    it('defaults to gold for unknown branch types', () => {
        expect(starColorFor('development')).toEqual(DEFAULT_STAR_COLOR);
    });

    it('defaults to gold for main', () => {
        expect(starColorFor('main')).toEqual(DEFAULT_STAR_COLOR);
    });

    it('defaults to gold for undefined/null', () => {
        expect(starColorFor(undefined)).toEqual(DEFAULT_STAR_COLOR);
        expect(starColorFor(null)).toEqual(DEFAULT_STAR_COLOR);
    });
});
