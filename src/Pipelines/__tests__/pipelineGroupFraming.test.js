// req #4131 — double-click framing boxes + camera fit distance.
import { describe, it, expect } from 'vitest';
import { GROUP, columnBox, bandBox, epicBox, reqBox, frameDistance } from '../pipelineGroupModel';

const p = { x: 10, z: 20 };

describe('double-click frames (req #4131)', () => {
    it('frames a requirement cube tightly around its centre', () => {
        const b = reqBox(p, { x: 2, z: 3, y: 1 });
        expect(b.minX).toBeCloseTo(12 - GROUP.cube / 2);
        expect(b.maxZ).toBeCloseTo(23 + GROUP.cube / 2);
    });
    it('an epic box holds its pedestal and every requirement', () => {
        const e = { x: 5, z: 5, height: 2, reqs: [{ x: 5, z: 5, y: 1 }, { x: 8, z: 6, y: 1 }] };
        const b = epicBox(p, e);
        expect(b.minX).toBeLessThanOrEqual(p.x + 5 - GROUP.pedestal / 2);
        expect(b.maxX).toBeGreaterThanOrEqual(p.x + 8 + GROUP.cube / 2);
    });
    it('a band box starts in its name margin', () => {
        const b = bandBox(p, { w: 9, z: 4, d: 3 });
        expect(b.minZ).toBeCloseTo(p.z + 4 - GROUP.bandHead);
        expect(b.maxX).toBe(19);
    });
    it('a column box includes its header strip', () => {
        const b = columnBox({ x: 0, w: 10, z: 8, d: 20 });
        expect(b.minZ).toBe(8 - GROUP.header);
        expect(b.maxZ).toBe(28);
    });
    it('a smaller box stands the camera closer, never inside the floor', () => {
        const small = frameDistance(reqBox(p, { x: 1, z: 1, y: 0.5 }), 45, 1.6, { min: 3 });
        const big = frameDistance(columnBox({ x: 0, w: 40, z: 0, d: 40 }), 45, 1.6);
        expect(small).toBeGreaterThanOrEqual(3);
        expect(big).toBeGreaterThan(small);
    });
});
