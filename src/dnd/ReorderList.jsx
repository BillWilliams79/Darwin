// ReorderList / useReorderItem — one hand-ordered list on a drag surface of its
// own (req #3664): the Area, Domain, Category and Project editors' tables, the
// Maps view bar, a test plan's cases.
//
// Each of those is a single list whose records reorder among themselves and go
// nowhere else, so the multi-list session (listSession.js) has nothing to do
// there. What they share with every other surface is everything about the
// press: the timeline, the whole-row grip, the clone, sibling reflow, edge
// auto-scroll, the keyboard — all of it DarwinDndContext's.
//
// The list renders EVERY row inside the one drop zone — closed rows and the
// template included. What may be a position is the policy's `isTarget`: a row
// it rejects neither lifts nor takes a drop, and the keyboard steps over it,
// so a closed row can never be reordered into the open ones.
//
// A drop resolves to `onReorder(fromIndex, toIndex)` over `ids` — arrayMove
// semantics — and only when something actually moved: a cancel, a release
// outside the list, or a release back in place writes nothing.
//
// THE LOOK IS THESE ROWS' OWN, NOT THE PLAN VIEW'S (user ruling, req #3664
// review): the lifted row is the row itself on a paper background with a
// light shadow at 90% opacity — no scale, no pop — and the slot it will land
// in is an empty gap. That is exactly what the rows looked like before the
// foundation; the Plan view's pickup, on a full-width editor row, threw the
// row tens of pixels sideways at every lift.

import React, { createContext, useCallback, useContext, useMemo } from 'react';
import Box from '@mui/material/Box';
import { CSS } from '@dnd-kit/utilities';
import DarwinDndContext from './DarwinDndContext';
import DarwinSortableList from './DarwinSortableList';
import { useDarwinDrag, useDarwinDropZone } from './useDarwinDrag';
import { defineDropPolicy, isRowTarget } from './dropPolicy';

const ReorderContext = createContext(null);

const always = () => true;
const anyRow = () => true;

// A non-target row: a droppable the collision rule asks (and the policy turns
// down), never a draggable.
const FIXED = { draggable: true, droppable: false };

/**
 * The drop resolved: which index moved where, or null when nothing did.
 * Exported for its unit test.
 */
export function resolveReorder(ids, listId, type, { active, over }) {
    if (!active || !over || over.id === active.id) return null;
    const data = over.data?.current;
    if (data?.containerId !== listId || !isRowTarget(data, type)) return null;
    const from = ids.indexOf(active.id);
    const to = ids.indexOf(over.id);
    if (from < 0 || to < 0 || from === to) return null;
    return { from, to };
}

/**
 * @param {Object} p
 * @param {string}   p.id           the list's container id, unique on the page
 * @param {string}   p.type         the draggable type of its rows
 * @param {string[]} p.ids          every row's item id, in rendered order
 * @param {(row: any) => boolean} [p.isTarget]  rows that lift and take a drop
 * @param {'vertical'|'horizontal'|'grid'|'flow'} [p.orientation]
 * @param {boolean}  [p.sortsOutside] keep sorting when the pointer leaves the
 *                                  list (a chip strip); a table cancels instead
 * @param {(from: number, to: number) => void} p.onReorder
 * @param {Object}   [p.liftSx]     the lifted item's look (default ROW_LIFT_SX)
 * @param {Object}   [p.sx]         the list box's own layout
 */
/** The lifted row: paper, MUI shadow 3, 90% opacity, square to the row. */
export const ROW_LIFT_SX = { bgcolor: 'background.paper', boxShadow: 3, opacity: 0.9, borderRadius: 1 };

export default function ReorderList({
    id, type, ids, isTarget = anyRow, orientation = 'vertical', sortsOutside = false,
    onReorder, liftSx = ROW_LIFT_SX, sx, children, ...boxProps
}) {
    const policy = useMemo(() => defineDropPolicy({
        accepts: [type], orientation, reorderAllowed: always, isTarget,
    }), [type, orientation, isTarget]);

    const onDragEnd = useCallback((event) => {
        const move = resolveReorder(ids, id, type, event);
        if (move) onReorder(move.from, move.to);
    }, [ids, id, type, onReorder]);

    const ctx = useMemo(() => ({ containerId: id, type, policy, sortsOutside }),
        [id, type, policy, sortsOutside]);

    return (
        <DarwinDndContext onDragEnd={onDragEnd} overlaySx={liftSx}>
            <ReorderContext.Provider value={ctx}>
                <DarwinSortableList id={id} items={ids} policy={policy}>
                    <ReorderZone id={id} policy={policy} sx={sx} {...boxProps}>
                        {children}
                    </ReorderZone>
                </DarwinSortableList>
            </ReorderContext.Provider>
        </DarwinDndContext>
    );
}

const ReorderZone = ({ id, policy, children, ...boxProps }) => {
    const { setNodeRef } = useDarwinDropZone({ id, policy });
    return <Box ref={setNodeRef} {...boxProps}>{children}</Box>;
};

/**
 * One row of the enclosing ReorderList. Spread `attributes` + `listeners` and
 * set `ref` + `style` on the row's root; `draggable` is false for a row the
 * policy rejects (spread nothing then — it is not a grip).
 *
 * @param {string} id   the row's item id (as listed in the ReorderList's `ids`)
 * @param {any}    row  the row's record, handed to the policy's `isTarget`
 */
export function useReorderItem(id, row) {
    const { containerId, type, policy, sortsOutside } = useContext(ReorderContext);
    const draggable = policy.isTarget(row);
    const drag = useDarwinDrag({
        id, type, containerId, policy, row, sortsOutside, disabled: draggable ? false : FIXED,
    });
    // No press cue: these rows never sank while held, and on a full-width row
    // the cue's scale pulls both edges in by tens of pixels.
    const { transform, transition } = drag;
    const style = useMemo(() => ({ transform: CSS.Translate.toString(transform), transition }),
        [transform, transition]);
    return { ...drag, style, draggable };
}

/**
 * The row look every ReorderList row shares: a grab cursor and a keyboard
 * focus ring on a draggable row, and — while it is lifted — an empty gap where
 * it will land, its neighbours sliding aside to open it.
 */
export function reorderRowSx(theme, { draggable, isDragging }) {
    return {
        ...(draggable && {
            cursor: 'grab',
            '&:focus-visible': { outline: `2px solid ${theme.palette.primary.main}`, outlineOffset: -2 },
        }),
        ...(isDragging && { visibility: 'hidden' }),
    };
}
