// Req #3720 — the panel rack's pure half: the stack order, where a drop lands,
// and the CSS order the navbar draws the stack and its placeholder with.

import { describe, it, expect } from 'vitest';

import {
    placeholderOrder, pointInRect, rackDropIndex, rackInsert, rackOrder, rackRemove,
} from '../panelRack';

describe('panelRack (req #3720)', () => {
    it('rackInsert places an id among the others, clamped, never twice', () => {
        expect(rackInsert([], 'a', 0)).toEqual(['a']);
        expect(rackInsert(['a', 'b'], 'c', 1)).toEqual(['a', 'c', 'b']);
        expect(rackInsert(['a', 'b'], 'c', 99)).toEqual(['a', 'b', 'c']);
        expect(rackInsert(['a', 'b'], 'c', -3)).toEqual(['c', 'a', 'b']);
        expect(rackInsert(['a', 'b'], 'c', null)).toEqual(['a', 'b', 'c']);
        // Re-racking an already racked id moves it.
        expect(rackInsert(['a', 'b', 'c'], 'a', 2)).toEqual(['b', 'c', 'a']);
        expect(rackInsert(['a', 'b', 'c'], 'c', 0)).toEqual(['c', 'a', 'b']);
    });

    it('rackRemove drops the id only', () => {
        expect(rackRemove(['a', 'b', 'c'], 'b')).toEqual(['a', 'c']);
        expect(rackRemove(['a'], 'z')).toEqual(['a']);
    });

    it('rackDropIndex lands above the first drawn panel whose midpoint is below the pointer', () => {
        const mids = new Map([['a', 100], ['b', 200]]);
        expect(rackDropIndex(['a', 'b'], mids, 50)).toBe(0);
        expect(rackDropIndex(['a', 'b'], mids, 150)).toBe(1);
        expect(rackDropIndex(['a', 'b'], mids, 250)).toBe(2);
        expect(rackDropIndex([], new Map(), 10)).toBe(0);
        // A hidden racked panel (no midpoint) never decides the slot.
        expect(rackDropIndex(['h', 'b'], new Map([['b', 200]]), 50)).toBe(1);
    });

    it('below the stack, a panel from off the navbar lands first; a reorder goes to the bottom (req #3729)', () => {
        const mids = new Map([['a', 100], ['b', 200]]);
        // The stack (a, b, the placeholder) ends at 250.
        // Pointed into it: where the pointer is, either way.
        expect(rackDropIndex(['a', 'b'], mids, 150, 250)).toBe(1);
        expect(rackDropIndex(['a', 'b'], mids, 240, 250)).toBe(2);
        expect(rackDropIndex(['a', 'b'], mids, 240, 250, true)).toBe(2);
        // Above it (the nav buttons): the top, either way.
        expect(rackDropIndex(['a', 'b'], mids, 20, 250)).toBe(0);
        expect(rackDropIndex(['a', 'b'], mids, 20, 250, true)).toBe(0);
        // Below it: first in, at the top — unless it is a racked panel being
        // dragged down the stack, which goes to the bottom.
        expect(rackDropIndex(['a', 'b'], mids, 600, 250)).toBe(0);
        expect(rackDropIndex(['a', 'b'], mids, 600, 250, true)).toBe(2);
        // Nothing drawn: the top — even pointed above a placeholder that has
        // already drawn (only hidden panels racked on this page).
        expect(rackDropIndex(['h'], new Map(), 600, -Infinity)).toBe(0);
        expect(rackDropIndex(['h'], new Map(), 20, 250)).toBe(0);
    });

    it('stack orders are even, the placeholder the odd slot before its panel', () => {
        expect(rackOrder(0)).toBe(0);
        expect(rackOrder(2)).toBe(4);
        // Dragging 'x' (not racked) over a stack of a, b.
        expect(placeholderOrder(['a', 'b'], 'x', 0)).toBe(-1);
        expect(placeholderOrder(['a', 'b'], 'x', 1)).toBe(1);
        expect(placeholderOrder(['a', 'b'], 'x', 2)).toBe(5);
        // Dragging racked 'a' itself: indexes count the others only.
        expect(placeholderOrder(['a', 'b', 'c'], 'a', 1)).toBe(3);
        expect(placeholderOrder(['a', 'b', 'c'], 'a', 0)).toBe(1);
    });

    it('pointInRect includes edges and refuses no rect', () => {
        const r = { left: 0, top: 0, right: 180, bottom: 1000 };
        expect(pointInRect(0, 0, r)).toBe(true);
        expect(pointInRect(180, 500, r)).toBe(true);
        expect(pointInRect(181, 500, r)).toBe(false);
        expect(pointInRect(10, 10, null)).toBe(false);
    });
});
