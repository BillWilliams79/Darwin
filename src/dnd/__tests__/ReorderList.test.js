// req #3664 — a ReorderList drop resolves to one move, or to nothing.

import { describe, it, expect } from 'vitest';
import { defineDropPolicy } from '../dropPolicy';
import { resolveReorder, slideDuration } from '../ReorderList';

const POLICY = defineDropPolicy({
    accepts: ['area'], reorderAllowed: () => true, isTarget: (r) => r.closed === 0 && r.id !== '',
});
const ids = ['area:1', 'area:2', 'area:3', 'area:9', 'area:template'];
const rows = {
    'area:1': { id: 1, closed: 0 }, 'area:2': { id: 2, closed: 0 }, 'area:3': { id: 3, closed: 0 },
    'area:9': { id: 9, closed: 1 }, 'area:template': { id: '', closed: 0 },
};
const item = (id, containerId = 'areas') => ({
    id, data: { current: { kind: 'item', type: 'area', containerId, policy: POLICY, row: rows[id] } },
});
const drop = (activeId, over) => resolveReorder(ids, 'areas', 'area', { active: { id: activeId }, over });

describe('resolveReorder', () => {
    it('a drop on another open row moves to its index', () => {
        expect(drop('area:3', item('area:1'))).toEqual({ from: 2, to: 0 });
        expect(drop('area:1', item('area:2'))).toEqual({ from: 0, to: 1 });
    });

    it('a release in place, outside, or on the list itself moves nothing', () => {
        expect(drop('area:2', item('area:2'))).toBeNull();
        expect(drop('area:2', null)).toBeNull();
        expect(drop('area:2', { id: 'areas', data: { current: { kind: 'container', containerId: 'areas', policy: POLICY } } })).toBeNull();
    });

    it('closed rows and the template are never positions', () => {
        expect(drop('area:1', item('area:9'))).toBeNull();
        expect(drop('area:1', item('area:template'))).toBeNull();
    });

    it('a row of another list is not a position', () => {
        expect(drop('area:1', item('area:2', 'other'))).toBeNull();
    });
});

// req #3804 review — a slide's time grows with the distance it covers.
describe('slideDuration', () => {
    const motion = { duration: 360, perPx: 0.6, maxDuration: 1100 };
    it('adds time per pixel, so a long reach is slower than a short one', () => {
        expect(slideDuration(0, motion)).toBe(360);
        expect(slideDuration(420, motion)).toBe(612);
        expect(slideDuration(1000, motion)).toBe(960);
    });
    it('caps at maxDuration and is the base without perPx', () => {
        expect(slideDuration(5000, motion)).toBe(1100);
        expect(slideDuration(800, { duration: 250 })).toBe(250);
    });
});
