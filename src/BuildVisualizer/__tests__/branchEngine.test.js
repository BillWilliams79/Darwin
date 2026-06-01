import { describe, it, expect } from 'vitest';
import {
    CREATABLE_TYPES,
    allowedChildTypes,
    canCreate,
    creationGate,
    needsBranchNumberPrompt,
    GATE_PROCEED,
} from '../branchEngine';

// All fixtures below reproduce the RATIFIED branch-creation matrix from
// memory/build-visualizer-design.md section 4.7.  The engine is correct iff it
// reproduces them exactly.

// ---------------------------------------------------------------------------
// CREATABLE_TYPES — canonical ordering
// ---------------------------------------------------------------------------
describe('CREATABLE_TYPES', () => {
    it('contains exactly six types in display order', () => {
        expect(CREATABLE_TYPES).toEqual([
            'sample-release',
            'release',
            'csr',
            'development',
            'hotfix',
            'bootleg',
        ]);
    });

    it('does not include main — main is the trunk and never creatable', () => {
        expect(CREATABLE_TYPES).not.toContain('main');
    });
});

// ---------------------------------------------------------------------------
// ALLOWED_CHILDREN matrix — allowedChildTypes (returns ordered array)
// ---------------------------------------------------------------------------
describe('allowedChildTypes — section 4.7 matrix', () => {
    it('main allows all six creatable types', () => {
        expect(allowedChildTypes('main')).toEqual([
            'sample-release', 'release', 'csr', 'development', 'hotfix', 'bootleg',
        ]);
    });

    it('release allows all six creatable types (release->release IS allowed)', () => {
        expect(allowedChildTypes('release')).toEqual([
            'sample-release', 'release', 'csr', 'development', 'hotfix', 'bootleg',
        ]);
    });

    it('sample-release allows hotfix, bootleg, development only', () => {
        expect(allowedChildTypes('sample-release')).toEqual([
            'development', 'hotfix', 'bootleg',
        ]);
    });

    it('csr allows hotfix, bootleg, development only', () => {
        expect(allowedChildTypes('csr')).toEqual([
            'development', 'hotfix', 'bootleg',
        ]);
    });

    it('hotfix allows hotfix, bootleg, development only', () => {
        expect(allowedChildTypes('hotfix')).toEqual([
            'development', 'hotfix', 'bootleg',
        ]);
    });

    it('bootleg allows bootleg, development only', () => {
        expect(allowedChildTypes('bootleg')).toEqual([
            'development', 'bootleg',
        ]);
    });

    it('development allows bootleg, development only', () => {
        expect(allowedChildTypes('development')).toEqual([
            'development', 'bootleg',
        ]);
    });

    it('unknown parent type returns empty array', () => {
        expect(allowedChildTypes('nonexistent')).toEqual([]);
    });
});

// ---------------------------------------------------------------------------
// canCreate — boolean cell checks
// ---------------------------------------------------------------------------
describe('canCreate — representative matrix cells', () => {
    // main is NEVER creatable as a child, regardless of parent
    it.each([
        'main', 'release', 'sample-release', 'csr', 'hotfix', 'bootleg', 'development',
    ])('canCreate(%s, "main") is false — main is never creatable', (parent) => {
        const result = canCreate(parent, 'main');
        expect(result.allowed).toBe(false);
        expect(result.reason).toMatch(/main/i);
    });

    // bootleg is allowed from every parent type
    it.each([
        'main', 'release', 'sample-release', 'csr', 'hotfix', 'bootleg', 'development',
    ])('canCreate(%s, "bootleg") is true — bootleg allowed everywhere', (parent) => {
        expect(canCreate(parent, 'bootleg').allowed).toBe(true);
    });

    // development is allowed from every parent type
    it.each([
        'main', 'release', 'sample-release', 'csr', 'hotfix', 'bootleg', 'development',
    ])('canCreate(%s, "development") is true — development allowed everywhere', (parent) => {
        expect(canCreate(parent, 'development').allowed).toBe(true);
    });

    // release->release IS allowed (important design decision)
    it('release->release is allowed', () => {
        expect(canCreate('release', 'release').allowed).toBe(true);
    });

    // hotfix->hotfix chain IS allowed
    it('hotfix->hotfix chaining is allowed', () => {
        expect(canCreate('hotfix', 'hotfix').allowed).toBe(true);
    });

    // sample-release CANNOT create release or csr
    it('sample-release cannot create release', () => {
        expect(canCreate('sample-release', 'release').allowed).toBe(false);
    });
    it('sample-release cannot create csr', () => {
        expect(canCreate('sample-release', 'csr').allowed).toBe(false);
    });
    it('sample-release cannot create sample-release', () => {
        expect(canCreate('sample-release', 'sample-release').allowed).toBe(false);
    });

    // Leaf-tier types (bootleg, development) can only make bootleg/development
    it('bootleg cannot create release', () => {
        expect(canCreate('bootleg', 'release').allowed).toBe(false);
    });
    it('bootleg cannot create hotfix', () => {
        expect(canCreate('bootleg', 'hotfix').allowed).toBe(false);
    });
    it('development cannot create release', () => {
        expect(canCreate('development', 'release').allowed).toBe(false);
    });
    it('development cannot create hotfix', () => {
        expect(canCreate('development', 'hotfix').allowed).toBe(false);
    });
    it('development cannot create csr', () => {
        expect(canCreate('development', 'csr').allowed).toBe(false);
    });

    // canCreate returns an empty reason string on success
    it('allowed result has empty reason', () => {
        expect(canCreate('main', 'release').reason).toBe('');
    });

    // canCreate returns a descriptive reason on failure
    it('disallowed result has a non-empty reason', () => {
        const result = canCreate('bootleg', 'csr');
        expect(result.allowed).toBe(false);
        expect(result.reason.length).toBeGreaterThan(0);
    });
});

// ---------------------------------------------------------------------------
// creationGate — always GATE_PROCEED (no gates currently defined)
// ---------------------------------------------------------------------------
describe('creationGate — no gates currently defined', () => {
    it('returns GATE_PROCEED for any type', () => {
        const types = ['sample-release', 'release', 'csr', 'development', 'hotfix', 'bootleg'];
        for (const childType of types) {
            const result = creationGate(childType, { major: 1, minor: 0, build: 5, branchNumber: 0 });
            expect(result.action).toBe(GATE_PROCEED);
            expect(result.message).toBe('');
        }
    });

    it('returns GATE_PROCEED even with no arguments', () => {
        const result = creationGate();
        expect(result.action).toBe(GATE_PROCEED);
    });

    it('GATE_PROCEED export equals "proceed"', () => {
        expect(GATE_PROCEED).toBe('proceed');
    });
});

// ---------------------------------------------------------------------------
// needsBranchNumberPrompt — §4.4 Branch# collision gate (req #2742)
// ---------------------------------------------------------------------------
describe('needsBranchNumberPrompt', () => {
    it('true for sample-release child + release parent', () => {
        expect(needsBranchNumberPrompt({ childType: 'sample-release', parentBranchType: 'release' })).toBe(true);
    });

    it('false for sample-release child + main parent', () => {
        expect(needsBranchNumberPrompt({ childType: 'sample-release', parentBranchType: 'main' })).toBe(false);
    });

    it('false for release child + release parent (release has distinct create path)', () => {
        expect(needsBranchNumberPrompt({ childType: 'release', parentBranchType: 'release' })).toBe(false);
    });

    it('false for hotfix child + release parent', () => {
        expect(needsBranchNumberPrompt({ childType: 'hotfix', parentBranchType: 'release' })).toBe(false);
    });

    it('false for csr child + release parent', () => {
        expect(needsBranchNumberPrompt({ childType: 'csr', parentBranchType: 'release' })).toBe(false);
    });

    it('false for development child + release parent', () => {
        expect(needsBranchNumberPrompt({ childType: 'development', parentBranchType: 'release' })).toBe(false);
    });

    it('false for bootleg child + release parent', () => {
        expect(needsBranchNumberPrompt({ childType: 'bootleg', parentBranchType: 'release' })).toBe(false);
    });

    it('false for sample-release child + sample-release parent (not allowed but still false)', () => {
        expect(needsBranchNumberPrompt({ childType: 'sample-release', parentBranchType: 'sample-release' })).toBe(false);
    });

    it('false for sample-release child + hotfix parent', () => {
        expect(needsBranchNumberPrompt({ childType: 'sample-release', parentBranchType: 'hotfix' })).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// allowedChildTypes ordering — subset of CREATABLE_TYPES order
// ---------------------------------------------------------------------------
describe('allowedChildTypes ordering', () => {
    it('returns types in CREATABLE_TYPES order (subset, no reordering)', () => {
        // For each parent type, the returned array must be a subsequence of CREATABLE_TYPES
        const parents = ['main', 'release', 'sample-release', 'csr', 'hotfix', 'bootleg', 'development'];
        for (const parent of parents) {
            const allowed = allowedChildTypes(parent);
            let lastIdx = -1;
            for (const t of allowed) {
                const idx = CREATABLE_TYPES.indexOf(t);
                expect(idx).toBeGreaterThan(lastIdx);
                lastIdx = idx;
            }
        }
    });
});
