// dropPolicy.js — what a drop zone takes, and the one collision rule that reads it
// (req #3662).
//
// react-dnd expressed "where may this land" as drag TYPES plus a hover handler
// on every row plus sentinel drop results (`{task: null}` meant cancel). Here a
// drop zone instead carries a POLICY object, and one collision detection reads
// every policy on the page:
//
//   accepts          the draggable types this zone takes
//   orientation      'vertical' | 'horizontal' | 'grid' — the sortable strategy
//   reorderAllowed   (sortMode) => does this zone honour a POSITION? If so its
//                    rows are targets and siblings slide aside; if not, the zone
//                    highlights as a whole and a drop appends.
//   isTarget         (row) => may this row be a drop position (history rows,
//                    template rows: never)
//   hoverSwitchFor   draggable types for which this zone is a hover-to-switch
//                    target (a domain tab, for a task or an area card) rather
//                    than a place to land
//   persist          the surface's write for a resolved move
//
// Every droppable registered through useDarwinDrag / useDarwinDropZone carries
//   { kind: 'item' | 'container', type, containerId, policy, sortMode, row }
// in its dnd-kit `data`, which is all the collision rule below needs.

import { closestCenter, pointerWithin } from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';

/**
 * How far past its edge the list an item is IN still counts as under the
 * pointer. Dragging "elevator style" overshoots a card's bottom at every turn;
 * without this the list read as left, every row snapped home, and the turn
 * jumped (req #3662 review). Further out than this, a release still cancels.
 */
export const LIST_EDGE_GRACE_PX = 48;

const noReorder = () => false;
const anyRow = () => true;

/**
 * @param {Object} p
 * @param {string[]} p.accepts
 * @param {'vertical'|'horizontal'|'grid'} [p.orientation]
 * @param {(sortMode?: string) => boolean} [p.reorderAllowed]
 * @param {(row: any) => boolean} [p.isTarget]
 * @param {string[]} [p.hoverSwitchFor]
 * @param {Function} [p.persist]
 */
export function defineDropPolicy({
    accepts, orientation = 'vertical', reorderAllowed = noReorder,
    isTarget = anyRow, hoverSwitchFor = [], persist = null,
}) {
    return Object.freeze({
        accepts: Object.freeze([...accepts]), orientation, reorderAllowed,
        isTarget, hoverSwitchFor: Object.freeze([...hoverSwitchFor]), persist,
    });
}

/** Does a zone carrying `data` take a draggable of `type` at all? */
export function policyAccepts(data, type) {
    return !!data?.policy && data.policy.accepts.includes(type);
}

/** Is this droppable a hover-to-switch target for the dragged `type`? */
export function isHoverSwitch(data, type) {
    return !!data?.policy && data.policy.hoverSwitchFor.includes(type);
}

/** Does the zone honour a drop POSITION for its current sort mode? */
export function honoursPosition(data) {
    return !!data?.policy && data.policy.reorderAllowed(data.sortMode);
}

/** May the item carrying `data` be a drop position for a draggable of `type`? */
export function isRowTarget(data, type) {
    return data?.kind === 'item'
        && policyAccepts(data, type)
        && !isHoverSwitch(data, type)
        && honoursPosition(data)
        && data.policy.isTarget(data.row);
}

const hasArea = (rect) => !!rect && rect.width > 0 && rect.height > 0;

/**
 * Builds the page's collision detection. Stateful only for the
 * multi-container guard: right after the dragged item is re-homed into another
 * list, the layout under the pointer has just changed, and re-deciding on that
 * same frame flips it straight back (dnd-kit's documented oscillation). For one
 * frame after `noteContainerChange()` the last answer stands.
 */
export function createDarwinCollisionDetection() {
    let lastOverId = null;
    let frozen = false;

    const detect = (args) => {
        const { active, droppableContainers, droppableRects, pointerCoordinates } = args;
        const activeData = active?.data?.current;
        if (!activeData) return closestCenter(args);
        const { type } = activeData;

        if (frozen && lastOverId != null) return [{ id: lastOverId }];

        const live = droppableContainers.filter(c =>
            hasArea(droppableRects.get(c.id)) && policyAccepts(c.data.current, type));

        const answer = (collisions) => {
            lastOverId = collisions[0]?.id ?? null;
            return collisions;
        };

        // Keyboard: no pointer — move among the rows of the list the item is in.
        if (!pointerCoordinates) {
            const rows = live.filter(c =>
                c.data.current.containerId === activeData.containerId
                && isRowTarget(c.data.current, type));
            return answer(rows.length ? closestCenter({ ...args, droppableContainers: rows }) : []);
        }

        // 1. A hover-switch target (a domain tab) under the pointer wins outright
        //    — but only where it is SHOWN: a strip clips the tabs that do not fit,
        //    and their rects run on underneath whatever sits beside the strip.
        const shown = (c) => {
            const strip = droppableRects.get(c.data.current.containerId);
            const { x, y } = pointerCoordinates;
            return !strip || (x >= strip.left && x <= strip.right && y >= strip.top && y <= strip.bottom);
        };
        const switches = live.filter(c => isHoverSwitch(c.data.current, type) && shown(c));
        const onSwitch = pointerWithin({ ...args, droppableContainers: switches });
        if (onSwitch.length) return answer(onSwitch.slice(0, 1));

        // 2. The container under the pointer: its rows if it honours a
        //    position, else the container itself (highlight + append). Failing
        //    that, the list the item is already in, within a grace margin.
        const containers = live.filter(c => c.data.current.kind === 'container');
        let inContainer = pointerWithin({ ...args, droppableContainers: containers });
        if (!inContainer.length) {
            const home = containers.find(c => c.id === activeData.containerId);
            const r = home && droppableRects.get(home.id);
            const { x, y } = pointerCoordinates;
            const g = LIST_EDGE_GRACE_PX;
            if (r && x >= r.left - g && x <= r.right + g && y >= r.top - g && y <= r.bottom + g) {
                inContainer = [{ id: home.id }];
            }
        }
        if (inContainer.length) {
            const container = droppableContainers.find(c => c.id === inContainer[0].id);
            const rows = live.filter(c =>
                c.data.current.containerId === container.id
                && isRowTarget(c.data.current, type));
            if (honoursPosition(container.data.current) && rows.length) {
                return answer(closestCenter({ ...args, droppableContainers: rows }));
            }
            return answer([{ id: container.id }]);
        }

        // 3. Outside every container. A dragged list item (a tab strip, a card
        //    grid) keeps sorting against its own list so a drifting hand does
        //    not drop the reorder; a dragged row is simply over nothing, and
        //    releasing there cancels.
        if (activeData.sortsOutside) {
            const rows = live.filter(c =>
                c.data.current.containerId === activeData.containerId
                && isRowTarget(c.data.current, type));
            return answer(rows.length ? closestCenter({ ...args, droppableContainers: rows }) : []);
        }
        return answer([]);
    };

    detect.noteContainerChange = () => {
        frozen = true;
        requestAnimationFrame(() => { frozen = false; });
    };
    detect.reset = () => { lastOverId = null; frozen = false; };
    return detect;
}

/**
 * Arrow keys move only among the rows of the dragged item's own list — the
 * stock getter would happily steer the item into a tab or a neighbouring card.
 */
export const darwinKeyboardCoordinates = (event, args) => {
    const { active, droppableContainers } = args.context;
    const activeData = active?.data?.current;
    if (!activeData) return sortableKeyboardCoordinates(event, args);
    const rows = droppableContainers.getEnabled().filter(c =>
        c.id === active.id
        || (c.data.current?.containerId === activeData.containerId
            && isRowTarget(c.data.current, activeData.type)));
    const scoped = {
        getEnabled: () => rows,
        get: (id) => droppableContainers.get(id),
    };
    return sortableKeyboardCoordinates(event, {
        ...args, context: { ...args.context, droppableContainers: scoped },
    });
};
