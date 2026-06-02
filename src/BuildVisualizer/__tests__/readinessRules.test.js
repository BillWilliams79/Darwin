import { describe, it, expect } from 'vitest';
import {
    readinessFor,
    readinessLabelFor,
    releaseTypeFor,
    READINESS_BY_TYPE,
    DEFAULT_READINESS,
} from '../readinessRules';

// req #2772 mapping:
//   Production Ready / Production : main, release, csr
//   Sample Ready     / Sample     : development, sample-release
//   Debug Ready      / Debug      : bootleg
//   Hot Fix Ready    / Hot Fix    : hotfix

describe('readinessRules — branch-type → label + release type', () => {
    const cases = [
        ['main',           'Production Ready', 'Production'],
        ['release',        'Production Ready', 'Production'],
        ['csr',            'Production Ready', 'Production'],
        ['development',    'Sample Ready',     'Sample'],
        ['sample-release', 'Sample Ready',     'Sample'],
        ['bootleg',        'Debug Ready',      'Debug'],
        ['hotfix',         'Hot Fix Ready',    'Hot Fix'],
    ];

    it.each(cases)('%s → label "%s", releaseType "%s"', (type, label, releaseType) => {
        expect(readinessLabelFor(type)).toBe(label);
        expect(releaseTypeFor(type)).toBe(releaseType);
        expect(readinessFor(type)).toEqual({ label, releaseType });
    });

    it('covers every REGISTRY branch type exactly once', () => {
        // All 7 Build Visualizer branch types must be mapped — no gaps.
        const mapped = Object.keys(READINESS_BY_TYPE).sort();
        expect(mapped).toEqual(
            ['bootleg', 'csr', 'development', 'hotfix', 'main', 'release', 'sample-release'],
        );
    });

    it('hotfix is its OWN release type, NOT Production (req #2772 correction)', () => {
        expect(releaseTypeFor('hotfix')).toBe('Hot Fix');
        expect(releaseTypeFor('hotfix')).not.toBe('Production');
    });

    it('falls back to Production Ready for an unknown branch type', () => {
        expect(readinessFor('does-not-exist')).toEqual(DEFAULT_READINESS);
        expect(readinessLabelFor(undefined)).toBe('Production Ready');
        expect(releaseTypeFor(null)).toBe('Production');
    });
});
