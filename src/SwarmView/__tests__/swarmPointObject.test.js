// Req #4158 — what the swarm visualizer's Konva canvas names at a point, for
// the Requirement Filer's pushpin: the shapes carry `filerObject`; the resolver
// walks from getIntersection's shape up to the first that says.

import { describe, it, expect } from 'vitest';

import { chipObject, konvaObjectAt } from '../swarmPointObject';

describe('swarm canvas point objects (req #4158)', () => {
    it('chipObject: a bead is its requirement; an undone one its undo; an estimated anchor its swarm-start', () => {
        expect(chipObject({ id: 4158, title: 'Filer' })).toEqual({ kind: 'requirement', id: 4158, title: 'Filer' });
        expect(chipObject({ id: 1, isUndone: true, undo: { id: 9 }, title: 'x' })).toEqual({ kind: 'swarm undo', id: 9, title: 'x' });
        expect(chipObject({ swarmStartId: 77 })).toEqual({ kind: 'swarm start', id: 77, title: null });
        expect(chipObject({})).toBeNull();
        expect(chipObject(null)).toBeNull();
    });

    it('konvaObjectAt resolves the shape under the point, or the day its row Group carries', () => {
        // A Konva node's surface as the resolver reads it: attrs, parent, client rect.
        const node = (attrs, parent, rect) => ({
            getAttr: (k) => attrs[k], getParent: () => parent,
            getClientRect: () => rect,
        });
        const day = node({ filerObject: { kind: 'day', id: '2026-11-01', title: '3 completions' } }, null,
            { x: 0, y: 0, width: 400, height: 200 });
        const bead = node({ filerObject: { kind: 'requirement', id: 4158, title: 'Filer' } }, day,
            { x: 90, y: 90, width: 20, height: 20 });
        const grid = node({}, day, { x: 50, y: 0, width: 1, height: 200 });
        const stage = { getIntersection: ({ x, y }) => (Math.hypot(x - 100, y - 100) <= 10 ? bead : grid) };
        expect(konvaObjectAt(stage, 100, 100)).toEqual({ kind: 'requirement', id: 4158, title: 'Filer',
            rect: { left: 90, top: 90, width: 20, height: 20 } });
        // Grid lines carry nothing: the row's day answers, with the row's box.
        expect(konvaObjectAt(stage, 300, 50)).toEqual({ kind: 'day', id: '2026-11-01', title: '3 completions',
            rect: { left: 0, top: 0, width: 400, height: 200 } });
        expect(konvaObjectAt({ getIntersection: () => null }, 1, 1)).toBeNull();
        expect(konvaObjectAt(null, 1, 1)).toBeNull();
    });
});
