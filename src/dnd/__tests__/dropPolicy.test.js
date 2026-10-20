// req #3662 — the one collision rule, read off drop policies.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    defineDropPolicy, policyAccepts, isHoverSwitch, honoursPosition, isRowTarget,
    createDarwinCollisionDetection,
} from '../dropPolicy';

const TASKS = defineDropPolicy({
    accepts: ['task'], reorderAllowed: (m) => m === 'hand', isTarget: (r) => r.id !== '' && !r.history,
});
const TABS = defineDropPolicy({
    accepts: ['tab', 'task'], orientation: 'horizontal', reorderAllowed: () => true, hoverSwitchFor: ['task'],
});

// A dnd-kit droppable container, as the collision detection receives it.
const zone = (id, rect, data) => ({ id, data: { current: data }, rect: { current: rect } });
const rect = (left, top, width, height) => ({ left, top, width, height, right: left + width, bottom: top + height });

function args(active, containers, pointer) {
    const droppableRects = new Map(containers.map(c => [c.id, c.rect.current]));
    const ar = droppableRects.get(active.id) ?? rect(0, 0, 100, 20);
    const collisionRect = pointer ? rect(pointer.x - 50, pointer.y - 10, 100, 20) : ar;
    return { active, collisionRect, droppableRects, droppableContainers: containers, pointerCoordinates: pointer ?? null };
}

beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', (fn) => setTimeout(fn, 0));
});

describe('policy predicates', () => {
    it('accepts / hover-switch / honours position', () => {
        expect(policyAccepts({ policy: TASKS }, 'task')).toBe(true);
        expect(policyAccepts({ policy: TASKS }, 'area')).toBe(false);
        expect(isHoverSwitch({ policy: TABS }, 'task')).toBe(true);
        expect(isHoverSwitch({ policy: TABS }, 'tab')).toBe(false);
        expect(honoursPosition({ policy: TASKS, sortMode: 'hand' })).toBe(true);
        expect(honoursPosition({ policy: TASKS, sortMode: 'priority' })).toBe(false);
    });

    it('a history row, the template and any row of a priority card are never positions', () => {
        const item = (row, sortMode = 'hand') => ({ kind: 'item', policy: TASKS, sortMode, row });
        expect(isRowTarget(item({ id: 1 }), 'task')).toBe(true);
        expect(isRowTarget(item({ id: 1, history: true }), 'task')).toBe(false);
        expect(isRowTarget(item({ id: '' }), 'task')).toBe(false);
        expect(isRowTarget(item({ id: 1 }, 'priority'), 'task')).toBe(false);
    });
});

describe('createDarwinCollisionDetection', () => {
    const active = { id: 'task:1', data: { current: { kind: 'item', type: 'task', containerId: 'A' } } };
    const cardA = zone('A', rect(0, 100, 300, 200), { kind: 'container', containerId: 'A', policy: TASKS, sortMode: 'hand' });
    const cardB = zone('B', rect(400, 100, 300, 200), { kind: 'container', containerId: 'B', policy: TASKS, sortMode: 'priority' });
    const rowA1 = zone('task:1', rect(0, 120, 300, 30), { kind: 'item', containerId: 'A', policy: TASKS, sortMode: 'hand', row: { id: 1 } });
    const rowA2 = zone('task:2', rect(0, 160, 300, 30), { kind: 'item', containerId: 'A', policy: TASKS, sortMode: 'hand', row: { id: 2 } });
    const rowB1 = zone('task:5', rect(400, 120, 300, 30), { kind: 'item', containerId: 'B', policy: TASKS, sortMode: 'priority', row: { id: 5 } });
    const tab = zone('tab:9', rect(0, 0, 100, 40), { kind: 'item', containerId: 'tabs', policy: TABS, row: { id: 9 } });
    const hidden = zone('task:7', rect(0, 0, 0, 0), { kind: 'item', containerId: 'H', policy: TASKS, sortMode: 'hand', row: { id: 7 } });
    const all = [cardA, cardB, rowA1, rowA2, rowB1, tab, hidden];

    it('a hover-switch tab under the pointer wins', () => {
        const detect = createDarwinCollisionDetection();
        expect(detect(args(active, all, { x: 50, y: 20 }))[0].id).toBe('tab:9');
    });

    it('inside a hand-sorted card: the closest row', () => {
        const detect = createDarwinCollisionDetection();
        expect(detect(args(active, all, { x: 150, y: 175 }))[0].id).toBe('task:2');
    });

    it('inside a priority-sorted card: the card itself, never its rows', () => {
        const detect = createDarwinCollisionDetection();
        expect(detect(args(active, all, { x: 550, y: 135 }))[0].id).toBe('B');
    });

    it('outside every container a row is over nothing (release = cancel)', () => {
        const detect = createDarwinCollisionDetection();
        expect(detect(args(active, all, { x: 1000, y: 900 }))).toEqual([]);
    });

    it('just past the edge of the list it is in, a row still sorts there (elevator overshoot)', () => {
        const detect = createDarwinCollisionDetection();
        // card A spans y 100-300; 30 px below its bottom is inside the grace margin
        expect(detect(args(active, all, { x: 150, y: 330 }))[0].id).toBe('task:2');
        // well past it, the row is over nothing and a release cancels
        expect(detect(args(active, all, { x: 150, y: 400 }))).toEqual([]);
    });

    it('a list item that sorts outside keeps sorting against its own list', () => {
        const detect = createDarwinCollisionDetection();
        const sorter = { id: 'task:1', data: { current: { ...active.data.current, sortsOutside: true } } };
        expect(detect(args(sorter, all, { x: 150, y: 400 }))[0].id).toBe('task:2');
    });

    it('a zero-size (hidden panel) droppable never collides', () => {
        const detect = createDarwinCollisionDetection();
        const onlyHidden = [zone('H', rect(0, 0, 0, 0), { kind: 'container', containerId: 'H', policy: TASKS, sortMode: 'hand' }), hidden];
        expect(detect(args(active, onlyHidden, { x: 0, y: 0 }))).toEqual([]);
    });

    it('keyboard (no pointer) moves only among rows of the item\'s own list', () => {
        const detect = createDarwinCollisionDetection();
        const ids = detect(args(active, all, null)).map(c => c.id);
        expect(ids.every(id => id === 'task:1' || id === 'task:2')).toBe(true);
    });

    it('for one frame after a container change, the last answer stands', async () => {
        const detect = createDarwinCollisionDetection();
        expect(detect(args(active, all, { x: 150, y: 175 }))[0].id).toBe('task:2');
        detect.noteContainerChange();
        expect(detect(args(active, all, { x: 550, y: 135 }))[0].id).toBe('task:2');
        await new Promise(r => setTimeout(r, 5));
        expect(detect(args(active, all, { x: 550, y: 135 }))[0].id).toBe('B');
    });
});
