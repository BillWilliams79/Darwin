// swarmMoves.js — what a drop on the Swarm cards view MEANS, as pure functions
// (req #3663).
//
// Each resolver takes the lists as they stand plus the drop and returns the
// new lists AND the one bulk payload that persists them. Records are never
// mutated in place: a card's local array is seeded from the query cache by
// shallow copy, so a row object here may BE the cached one.

import { arrayMove } from '@dnd-kit/sortable';

const isRealRow = (row) => row.id !== '';
const sameIndex = (from, to) => from === to || from < 0 || to < 0;

// ── Requirements ────────────────────────────────────────────────────────────

/**
 * Reorder within one hand-sorted card: every real row is renumbered by its
 * position; the template row stays where it is and is never written.
 * @returns {{rows: object[], bulk: object[]} | null} null when nothing moved
 */
export function reorderRequirementsInCard(rows, fromIndex, toIndex) {
    if (sameIndex(fromIndex, toIndex)) return null;
    const bulk = [];
    const renumbered = arrayMove(rows, fromIndex, toIndex).map((row, idx) => {
        if (!isRealRow(row)) return row;
        bulk.push({ id: row.id, sort_order: idx });
        return { ...row, sort_order: idx };
    });
    return { rows: renumbered, bulk };
}

/**
 * Place a requirement in a HAND-sorted card at `insertIndex` among its real
 * rows. The card's real rows are renumbered 0..n; the moved row also carries
 * its new category when it changed. The template row is re-appended.
 */
export function insertRequirementIntoHandCard(targetRows, row, insertIndex, categoryId) {
    const category = parseInt(categoryId);
    const crosses = parseInt(row.category_fk) !== category;
    const real = targetRows.filter(r => isRealRow(r) && r.id !== row.id);
    const template = targetRows.find(r => !isRealRow(r));
    const at = Math.max(0, Math.min(insertIndex, real.length));
    real.splice(at, 0, { ...row, category_fk: category });
    const bulk = [];
    const renumbered = real.map((r, idx) => {
        const update = { id: r.id, sort_order: idx };
        if (r.id === row.id && crosses) update.category_fk = category;
        bulk.push(update);
        return { ...r, sort_order: idx };
    });
    return { rows: template ? [...renumbered, template] : renumbered, bulk };
}

/**
 * Move a requirement into a card that honours no position (process /
 * reverse): only its category changes — its sort_order is left alone — and
 * the card's own comparator places it. The template stays last.
 */
export function appendRequirementToCard(targetRows, row, categoryId, sortRows = (rows) => rows) {
    const category = parseInt(categoryId);
    const moved = { ...row, category_fk: category };
    const real = targetRows.filter(r => isRealRow(r) && r.id !== row.id);
    const template = targetRows.find(r => !isRealRow(r));
    const sorted = sortRows([...real, moved]);
    return {
        rows: template ? [...sorted, template] : sorted,
        bulk: [{ id: row.id, category_fk: category }],
    };
}

/**
 * One requirement cache slice after a move (req #2381 write-through). Every
 * row the bulk names takes its new fields wherever it appears; a moved row
 * additionally leaves its old category's slice and joins its new one's.
 * Cross-category slices (by status, done, all) keep the row in place — the
 * aggregator lists from them, and a moved requirement still has its status.
 * Returns `old` itself when nothing changed, so untouched slices do not
 * re-render.
 *
 * @param {any} old                    the slice's data
 * @param {number|undefined} sliceCategoryId  the category the slice is scoped to
 * @param {object[]} bulk              the move's PUT body
 * @param {{row: object, from: number, to: number}|null} moved
 */
export function routeRequirementSlice(old, sliceCategoryId, bulk, moved) {
    if (!Array.isArray(old)) return old;
    const updates = new Map(bulk.map(({ id, ...fields }) => [id, fields]));
    let changed = false;
    let next = old.map(r => {
        const update = updates.get(r.id);
        if (!update) return r;
        changed = true;
        return { ...r, ...update };
    });
    if (moved && sliceCategoryId !== undefined && moved.from !== moved.to) {
        const id = moved.row.id;
        const has = next.some(r => r.id === id);
        if (sliceCategoryId === moved.from && has) {
            next = next.filter(r => r.id !== id);
            changed = true;
        } else if (sliceCategoryId === moved.to && !has) {
            next = [...next, { ...moved.row, ...updates.get(id), category_fk: moved.to }];
            changed = true;
        }
    }
    return changed ? next : old;
}

// ── Category cards ──────────────────────────────────────────────────────────

const renumberCategories = (categories, extra = () => ({})) => {
    const bulk = [];
    let next = 0;
    const out = categories.map(c => {
        if (!isRealRow(c)) return c;
        const sort_order = next++;
        bulk.push({ id: c.id, sort_order, ...extra(c) });
        return { ...c, sort_order };
    });
    return { categories: out, bulk };
};

/** Reorder category cards within one project. */
export function reorderCategories(categories, fromIndex, toIndex) {
    if (sameIndex(fromIndex, toIndex)) return null;
    return renumberCategories(arrayMove(categories, fromIndex, toIndex));
}

/**
 * Move a category card to another project at `insertIndex` among its real
 * cards. BOTH projects are renumbered, in one bulk payload — one write.
 */
export function moveCategoryToProject(sourceCategories, targetCategories, category, insertIndex, projectId) {
    const project = parseInt(projectId);
    const source = renumberCategories(sourceCategories.filter(c => c.id !== category.id));
    const real = targetCategories.filter(c => isRealRow(c) && c.id !== category.id);
    const template = targetCategories.find(c => !isRealRow(c));
    const at = Math.max(0, Math.min(insertIndex, real.length));
    real.splice(at, 0, { ...category, project_fk: project });
    const target = renumberCategories(template ? [...real, template] : real,
        (c) => (c.id === category.id ? { project_fk: project } : {}));
    return {
        sourceCategories: source.categories,
        targetCategories: target.categories,
        bulk: [...source.bulk, ...target.bulk],
    };
}
