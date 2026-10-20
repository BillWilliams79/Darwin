// req #3662 — what a drop on the Plan view means, pinned without a browser.

import { describe, it, expect } from 'vitest';
import {
    reorderTasksInCard, insertTaskIntoHandCard, appendTaskToCard, reorderPriorityRows,
    reorderAreas, moveAreaToDomain, reorderDomains, withPlacement,
} from '../planMoves';
import { markClosedHistory } from '../closedTasks';

const task = (id, extra = {}) => ({ id, description: `t${id}`, priority: 0, done: 0, area_fk: 1, sort_order: id, ...extra });
const template = { id: '', description: '', priority: 0, done: 0, area_fk: 1, sort_order: null };
const closed = (id) => markClosedHistory(task(id, { done: 1, sort_order: 50 + id }));

describe('reorderTasksInCard', () => {
    it('moves a row and renumbers only the live rows', () => {
        const rows = [task(1), task(2), task(3), template, closed(9)];
        const r = reorderTasksInCard(rows, 0, 2);
        expect(r.tasks.map(t => t.id)).toEqual([2, 3, 1, '', 9]);
        expect(r.bulk).toEqual([{ id: 2, sort_order: 0 }, { id: 3, sort_order: 1 }, { id: 1, sort_order: 2 }]);
        // history keeps its stored position
        expect(r.tasks[4].sort_order).toBe(59);
    });

    it('returns null when nothing moved', () => {
        expect(reorderTasksInCard([task(1), task(2)], 1, 1)).toBeNull();
    });

    it('never mutates the input records (they may be the query cache)', () => {
        const rows = [task(1), task(2)];
        const frozen = rows.map(r => Object.freeze({ ...r }));
        expect(() => reorderTasksInCard(frozen, 0, 1)).not.toThrow();
    });
});

describe('insertTaskIntoHandCard', () => {
    it('inserts at the position among live rows and carries the new area', () => {
        const target = [task(4, { area_fk: 2 }), task(5, { area_fk: 2 }), template, closed(8)];
        const r = insertTaskIntoHandCard(target, task(1), 1, '2');
        expect(r.tasks.map(t => t.id)).toEqual([4, 1, 5, '', 8]);
        expect(r.bulk).toEqual([
            { id: 4, sort_order: 0 }, { id: 1, sort_order: 1, area_fk: 2 }, { id: 5, sort_order: 2 },
        ]);
        expect(r.tasks[1].area_fk).toBe(2);
    });

    it('clamps an index past the end to the end of the live rows', () => {
        const r = insertTaskIntoHandCard([task(4), template], task(1), 99, '2');
        expect(r.tasks.map(t => t.id)).toEqual([4, 1, '']);
    });
});

describe('appendTaskToCard', () => {
    it('takes the next sort_order and lets the card sort it', () => {
        const target = [task(4, { sort_order: 3 }), task(5, { sort_order: 7 }), template];
        const sortRows = (rows) => [...rows].sort((a, b) => (a.id === '' ? 1 : b.id === '' ? -1 : 0));
        const r = appendTaskToCard(target, task(1), '2', sortRows);
        expect(r.bulk).toEqual([{ id: 1, area_fk: 2, sort_order: 8 }]);
        expect(r.tasks.map(t => t.id)).toEqual([4, 5, 1, '']);
    });
});

describe('reorderPriorityRows', () => {
    it('returns the live order to persist, never a history row', () => {
        const r = reorderPriorityRows([task(1), task(2), closed(3)], 0, 1);
        expect(r.live.map(t => t.id)).toEqual([2, 1]);
    });
});

describe('area cards', () => {
    const area = (id, extra = {}) => ({ id, area_name: `a${id}`, domain_fk: 1, sort_order: id, ...extra });
    const areaTemplate = { id: '', area_name: '', domain_fk: 1 };

    it('reorders within a domain, renumbering real cards only', () => {
        const r = reorderAreas([area(1), area(2), area(3), areaTemplate], 2, 0);
        expect(r.areas.map(a => a.id)).toEqual([3, 1, 2, '']);
        expect(r.bulk).toEqual([{ id: 3, sort_order: 0 }, { id: 1, sort_order: 1 }, { id: 2, sort_order: 2 }]);
    });

    it('moves a card to another domain in ONE payload covering both sides', () => {
        const src = [area(1), area(2), areaTemplate];
        const tgt = [area(7, { domain_fk: 2 }), { ...areaTemplate, domain_fk: 2 }];
        const r = moveAreaToDomain(src, tgt, area(1), 0, '2');
        expect(r.sourceAreas.map(a => a.id)).toEqual([2, '']);
        expect(r.targetAreas.map(a => a.id)).toEqual([1, 7, '']);
        expect(r.bulk).toEqual([
            { id: 2, sort_order: 0 },
            { id: 1, sort_order: 0, domain_fk: 2 }, { id: 7, sort_order: 1 },
        ]);
    });
});

describe('reorderDomains', () => {
    it('renumbers and follows the active tab to its new index', () => {
        const d = [{ id: 10 }, { id: 11 }, { id: 12 }];
        const r = reorderDomains(d, 0, 2, 0);
        expect(r.domains.map(x => x.id)).toEqual([11, 12, 10]);
        expect(r.bulk).toEqual([{ id: 11, sort_order: 0 }, { id: 12, sort_order: 1 }, { id: 10, sort_order: 2 }]);
        expect(r.activeIndex).toBe(2);
    });
});

describe('withPlacement — what a list renders mid-drag', () => {
    const isTarget = (r) => r.id !== '';
    const moving = task(1);
    const session = { active: { row: moving, origin: 'A' }, placement: { containerId: 'B', index: 1 } };

    it('the origin list no longer shows the carried item', () => {
        expect(withPlacement([moving, task(2), template], 'A', session, isTarget).map(t => t.id)).toEqual([2, '']);
    });

    it('the target list shows it at its placement, before the template', () => {
        expect(withPlacement([task(4), task(5), template], 'B', session, isTarget).map(t => t.id)).toEqual([4, 1, 5, '']);
        const far = { ...session, placement: { containerId: 'B', index: 9 } };
        expect(withPlacement([task(4), template], 'B', far, isTarget).map(t => t.id)).toEqual([4, 1, '']);
    });

    it('every other list, and every list with no placement, is untouched', () => {
        const rows = [task(6)];
        expect(withPlacement(rows, 'C', session, isTarget)).toBe(rows);
        expect(withPlacement(rows, 'A', { active: session.active, placement: null }, isTarget)).toBe(rows);
    });
});
