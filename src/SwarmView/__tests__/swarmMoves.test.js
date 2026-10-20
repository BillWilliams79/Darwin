// req #3663 — what a drop on the Swarm cards view MEANS, as pure functions.

import { describe, it, expect } from 'vitest';
import {
    reorderRequirementsInCard, insertRequirementIntoHandCard, appendRequirementToCard,
    routeRequirementSlice, reorderCategories, moveCategoryToProject,
} from '../swarmMoves';

const req = (id, category, extra = {}) => ({ id, title: `r${id}`, category_fk: category, sort_order: id, ...extra });
const template = (category) => ({ id: '', title: '', category_fk: category });
const cat = (id, project, extra = {}) => ({ id, category_name: `c${id}`, project_fk: project, sort_order: id, ...extra });

describe('reorderRequirementsInCard', () => {
    it('renumbers every real row by position and never writes the template', () => {
        const out = reorderRequirementsInCard([req(1, 5), req(2, 5), req(3, 5), template(5)], 0, 2);
        expect(out.rows.map(r => r.id)).toEqual([2, 3, 1, '']);
        expect(out.bulk).toEqual([
            { id: 2, sort_order: 0 }, { id: 3, sort_order: 1 }, { id: 1, sort_order: 2 },
        ]);
    });

    it('is null when nothing moved', () => {
        expect(reorderRequirementsInCard([req(1, 5), template(5)], 0, 0)).toBeNull();
        expect(reorderRequirementsInCard([req(1, 5)], -1, 0)).toBeNull();
    });

    it('does not mutate the rows it was given (they may be the cache\'s)', () => {
        const rows = [req(1, 5), req(2, 5)];
        reorderRequirementsInCard(rows, 0, 1);
        expect(rows[0]).toEqual(req(1, 5));
    });
});

describe('insertRequirementIntoHandCard', () => {
    it('hand → hand across cards: category_fk AND the target\'s whole sort_order', () => {
        const out = insertRequirementIntoHandCard([req(7, 6), req(8, 6), template(6)], req(1, 5), 1, '6');
        expect(out.rows.map(r => r.id)).toEqual([7, 1, 8, '']);
        expect(out.rows[1].category_fk).toBe(6);
        expect(out.bulk).toEqual([
            { id: 7, sort_order: 0 }, { id: 1, sort_order: 1, category_fk: 6 }, { id: 8, sort_order: 2 },
        ]);
    });

    it('a row already in the card (aggregator → its own card) is a reorder: no category write', () => {
        const out = insertRequirementIntoHandCard([req(7, 6), req(8, 6), template(6)], req(8, 6), 0, 6);
        expect(out.rows.map(r => r.id)).toEqual([8, 7, '']);
        expect(out.bulk).toEqual([{ id: 8, sort_order: 0 }, { id: 7, sort_order: 1 }]);
    });

    it('clamps the index into the real rows', () => {
        expect(insertRequirementIntoHandCard([req(7, 6), template(6)], req(1, 5), 99, 6).rows.map(r => r.id))
            .toEqual([7, 1, '']);
    });
});

describe('appendRequirementToCard', () => {
    it('into a process/reverse card: category_fk only, placed by the card\'s comparator, template last', () => {
        const byId = (rows) => [...rows].sort((a, b) => a.id - b.id);
        const out = appendRequirementToCard([req(7, 6), req(9, 6), template(6)], req(8, 5), 6, byId);
        expect(out.rows.map(r => r.id)).toEqual([7, 8, 9, '']);
        expect(out.bulk).toEqual([{ id: 8, category_fk: 6 }]);
        expect(out.rows[1].sort_order).toBe(8);   // untouched
    });
});

describe('routeRequirementSlice — the cache write-through', () => {
    const bulk = [{ id: 1, sort_order: 1, category_fk: 6 }, { id: 7, sort_order: 0 }];
    const moved = { row: req(1, 5), from: 5, to: 6 };

    it('the source category\'s slice loses the moved row', () => {
        const next = routeRequirementSlice([req(1, 5), req(2, 5)], 5, bulk, moved);
        expect(next.map(r => r.id)).toEqual([2]);
    });

    it('the target category\'s slice gains it, with its new fields', () => {
        const next = routeRequirementSlice([req(7, 6)], 6, bulk, moved);
        expect(next).toEqual([{ ...req(7, 6), sort_order: 0 }, { ...req(1, 5), sort_order: 1, category_fk: 6 }]);
    });

    it('a status slice (the aggregator\'s) keeps the row in place with its new category', () => {
        const next = routeRequirementSlice([req(3, 9), req(1, 5)], undefined, bulk, moved);
        expect(next.map(r => r.id)).toEqual([3, 1]);
        expect(next[1].category_fk).toBe(6);
    });

    it('an unrelated slice is returned AS IS, so it does not re-render', () => {
        const old = [req(4, 9)];
        expect(routeRequirementSlice(old, 9, bulk, moved)).toBe(old);
        expect(routeRequirementSlice(undefined, 9, bulk, moved)).toBeUndefined();
    });

    it('a reorder (no move) only renumbers', () => {
        const next = routeRequirementSlice([req(1, 5), req(7, 5)], 5, [{ id: 1, sort_order: 1 }, { id: 7, sort_order: 0 }], null);
        expect(next.map(r => [r.id, r.sort_order])).toEqual([[1, 1], [7, 0]]);
    });
});

describe('category cards', () => {
    it('reorder renumbers the real cards; the template is never written', () => {
        const out = reorderCategories([cat(1, 2), cat(2, 2), cat(3, 2), cat('', 2)], 2, 0);
        expect(out.categories.map(c => c.id)).toEqual([3, 1, 2, '']);
        expect(out.bulk).toEqual([
            { id: 3, sort_order: 0 }, { id: 1, sort_order: 1 }, { id: 2, sort_order: 2 },
        ]);
    });

    it('a move to another project renumbers BOTH sides in ONE payload', () => {
        const out = moveCategoryToProject([cat(1, 2), cat(2, 2), cat('', 2)], [cat(7, 3), cat('', 3)],
            cat(1, 2), 1, '3');
        expect(out.sourceCategories.map(c => c.id)).toEqual([2, '']);
        expect(out.targetCategories.map(c => c.id)).toEqual([7, 1, '']);
        expect(out.targetCategories[1].project_fk).toBe(3);
        expect(out.bulk).toEqual([
            { id: 2, sort_order: 0 },
            { id: 7, sort_order: 0 }, { id: 1, sort_order: 1, project_fk: 3 },
        ]);
    });
});
