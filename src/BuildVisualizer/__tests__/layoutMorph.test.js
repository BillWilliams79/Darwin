import { describe, it, expect } from 'vitest';
import {
    easeCubicOut, lerp, lerpPath, interpolateLayout, layoutSignature,
} from '../layoutMorph';

describe('easeCubicOut', () => {
    it('pins the endpoints and clamps out-of-range', () => {
        expect(easeCubicOut(0)).toBe(0);
        expect(easeCubicOut(1)).toBe(1);
        expect(easeCubicOut(-0.5)).toBe(0);
        expect(easeCubicOut(2)).toBe(1);
    });
    it('is ahead of linear (ease-OUT) at the midpoint', () => {
        expect(easeCubicOut(0.5)).toBeGreaterThan(0.5);
    });
});

describe('lerp', () => {
    it('interpolates linearly', () => {
        expect(lerp(0, 10, 0)).toBe(0);
        expect(lerp(0, 10, 1)).toBe(10);
        expect(lerp(0, 10, 0.5)).toBe(5);
    });
});

describe('lerpPath', () => {
    it('interpolates matching M/L structure, adding dy to prev y only', () => {
        // prev y = 0 shifted by dy=10 → 10; next y = 20; p=0.5 → 15. x untouched.
        const out = lerpPath('M 0 0 L 5 0', 'M 0 20 L 5 20', 0.5, 10);
        expect(out).toBe('M 0 15 L 5 15');
    });
    it('interpolates cubic C control points component-wise', () => {
        const out = lerpPath('M 0 0 C 1 0 2 0 3 0', 'M 0 10 C 1 10 2 10 3 10', 0.5, 0);
        expect(out).toBe('M 0 5 C 1 5 2 5 3 5');
    });
    it('snaps to next when command structure differs', () => {
        expect(lerpPath('M 0 0 L 1 1', 'M 0 0 C 1 1 2 2 3 3', 0.5, 0))
            .toBe('M 0 0 C 1 1 2 2 3 3');
    });
    it('returns next at p=1 (endpoints exact)', () => {
        expect(lerpPath('M 0 0 L 5 0', 'M 0 20 L 5 20', 1, 10)).toBe('M 0 20 L 5 20');
    });
    it('handles null inputs gracefully', () => {
        expect(lerpPath(null, 'M 0 0', 0.5)).toBe('M 0 0');
        expect(lerpPath('M 0 0', null, 0.5)).toBe('M 0 0');
    });
});

describe('layoutSignature', () => {
    const base = {
        mainY: 100, width: 800,
        builds: [{ id: 'b1', x: 10, y: 100, radius: 5, version: '1.0.1' }],
        branches: [{ id: 'br1', labelX: 4, labelY: 100 }],
        strata: [], connectors: [],
    };

    it('is identical for geometrically-identical layouts that differ only in non-geometry fields', () => {
        // A releases-query resolution rebuilds `layout` as a new object and can
        // change non-geometry fields (dotColor, releaseCustomers) without moving
        // anything — must produce the SAME signature so no redundant morph fires.
        const a = base;
        const b = {
            ...base,
            builds: [{ id: 'b1', x: 10, y: 100, radius: 5, version: '1.0.1', dotColor: 'green', releaseCustomers: ['ACME'] }],
        };
        expect(layoutSignature(a)).toBe(layoutSignature(b));
    });

    it('differs when a build moves', () => {
        const moved = { ...base, builds: [{ ...base.builds[0], y: 130 }] };
        expect(layoutSignature(base)).not.toBe(layoutSignature(moved));
    });

    it('differs when a build is added (build execution)', () => {
        const added = { ...base, builds: [...base.builds, { id: 'b2', x: 40, y: 100, radius: 5 }] };
        expect(layoutSignature(base)).not.toBe(layoutSignature(added));
    });

    it('differs when a connector path changes (reflow)', () => {
        const a = { ...base, connectors: [{ branchId: 'br1', curveD: 'M 0 0 C 1 0 2 0 3 0', lineD: 'M 3 0 L 9 0' }] };
        const b = { ...base, connectors: [{ branchId: 'br1', curveD: 'M 0 30 C 1 30 2 30 3 30', lineD: 'M 3 30 L 9 30' }] };
        expect(layoutSignature(a)).not.toBe(layoutSignature(b));
    });

    it('handles null/empty', () => {
        expect(layoutSignature(null)).toBe('');
        expect(typeof layoutSignature({})).toBe('string');
    });
});

describe('interpolateLayout', () => {
    const prev = {
        mainY: 100,
        width: 800,
        builds: [{ id: 'b1', x: 10, y: 100, radius: 5, version: '1.0.1' }],
        branches: [{ id: 'br1', labelX: 4, labelY: 100, name: 'x' }],
        strata: [],
        connectors: [],
    };
    const next = {
        mainY: 130, // trunk moved down 30 in world (a release opened a clearance band)
        width: 800,
        builds: [
            { id: 'b1', x: 10, y: 130, radius: 5, version: '1.0.1', releaseCustomers: ['ACME'] },
            { id: 'b2', x: 40, y: 130, radius: 5, version: '1.0.2' }, // new build
        ],
        branches: [{ id: 'br1', labelX: 4, labelY: 130, name: 'x' }],
        strata: [],
        connectors: [],
    };

    it('returns next unchanged when prev is null or p>=1', () => {
        expect(interpolateLayout(null, next, 0.5, 0)).toBe(next);
        expect(interpolateLayout(prev, next, 1, -30)).toBe(next);
    });

    it('pins the trunk: with dy = mainYdelta, a build that only moved with the trunk holds still at p=0', () => {
        // dy = nextMainY - prevMainY = 30. At p=0 the morphed world-y should equal
        // prevY + dy = 100 + 30 = 130 = nextY → the build never moves on screen
        // (the instant trunk-pin already shifted the transform by the same 30).
        const at0 = interpolateLayout(prev, next, 0, 30);
        expect(at0.builds.find(b => b.id === 'b1').y).toBe(130);
    });

    it('carries the new release info + new nodes through from next', () => {
        const mid = interpolateLayout(prev, next, 0.5, 30);
        const b1 = mid.builds.find(b => b.id === 'b1');
        expect(b1.releaseCustomers).toEqual(['ACME']); // non-geometry from next
        expect(mid.builds.find(b => b.id === 'b2')).toBeTruthy(); // appears at final
        expect(mid.builds.find(b => b.id === 'b2').y).toBe(130);
    });

    it('interpolates x plainly (no dy) and y with dy', () => {
        const prevX = { ...prev, builds: [{ id: 'b1', x: 0, y: 0 }] };
        const nextX = { ...next, mainY: 0, builds: [{ id: 'b1', x: 100, y: 50 }] };
        const mid = interpolateLayout(prevX, nextX, 0.5, 0);
        const b1 = mid.builds[0];
        expect(b1.x).toBe(50); // lerp(0,100,.5)
        expect(b1.y).toBe(25); // lerp(0,50,.5)
    });
});
