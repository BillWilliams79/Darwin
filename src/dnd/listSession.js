// listSession.js — the drag SESSION every list-of-cards surface shares
// (req #3663; lifted out of the Plan view's planDnd / usePlanDnd, req #3662).
//
// A surface keeps each list's records where they always lived — a card's local
// array, seeded from the query and backing every inline edit — and registers
// `{getItems, setItems, ready, sortMode, ...}` under the list's container id.
// The page's ONE onDragEnd then resolves a drop against those registrations,
// applies it to BOTH lists and fires one write.
//
// Mid-drag, the session says where the item is:
//
//   active     { id, type, row, origin, keepsMovedRows } — what lifted, the list it
//              came from, and whether that list keeps a row moved out of it (read
//              from the ORIGIN's policy at lift: once the item is carried into
//              another list, dnd-kit's `active.data` is that list's)
//   placement  { containerId, index } — carried into ANOTHER list that honours a
//              position; that list renders it there and its rows slide aside
//   highlight  the list that would take the drop as a whole (it does not honour
//              a position), lit while hovered
//
// All of it is derived for rendering (`withPlacement`), never written into a
// list's state, so a cancel has nothing to undo.

import { createContext, useContext, useLayoutEffect, useRef } from 'react';
import { create } from 'zustand';
import { arrayMove } from '@dnd-kit/sortable';
import { isHoverSwitch, policyAccepts, honoursPosition } from './dropPolicy';

// ── The session store ───────────────────────────────────────────────────────

/** One store per surface (a page has one drag in flight at a time). */
export function createDragSession() {
    return create((set) => ({
        active: null,
        placement: null,
        highlight: null,
        begin: (active) => set({ active, placement: null, highlight: null }),
        place: (placement) => set({ placement }),
        setHighlight: (highlight) => set({ highlight }),
        end: () => set({ active: null, placement: null, highlight: null }),
    }));
}

/**
 * The session as ONE list sees it: `{active, placement}` only while the item
 * has been carried out of, or into, this list — otherwise nulls, so a drag
 * re-renders the two lists it touches and not every card on the page.
 * (Separate selectors returning store objects: zustand v5 compares by
 * identity, and an object literal would re-render forever.)
 */
export function useListSession(useStore, containerId) {
    const involved = (s) => !!s.placement
        && (s.active?.origin === containerId || s.placement.containerId === containerId);
    const active = useStore(s => (involved(s) ? s.active : null));
    const placement = useStore(s => (involved(s) ? s.placement : null));
    return { active, placement };
}

// ── The registry ────────────────────────────────────────────────────────────

export const DarwinListRegistry = createContext(null);

/**
 * Register a list's local state with the page. `entry` is re-read on every
 * render (a ref, not a dependency), so the page always sees current arrays
 * and handlers without re-registering. A null `containerId` registers nothing.
 */
export function useRegisterList(containerId, entry) {
    const registry = useContext(DarwinListRegistry);
    const ref = useRef(entry);
    ref.current = entry;
    useLayoutEffect(() => {
        if (!registry || !containerId) return undefined;
        const handle = { get current() { return ref.current; } };
        registry.set(containerId, handle);
        return () => {
            if (registry.get(containerId) === handle) registry.delete(containerId);
        };
    }, [registry, containerId]);
}

// ── What a list renders during a drag ───────────────────────────────────────

export const removeRecord = (items, id) => items.filter(r => r.id !== id);

/**
 * The list a container RENDERS during a drag. An item dragged out of its own
 * list into one that honours a position is shown in the new list at its
 * placement (so that list's siblings slide aside) and not in its old one.
 *
 * @param {object[]} items      the container's own records
 * @param {string}   containerId
 * @param {{active: ?object, placement: ?object}} session
 * @param {(row: object) => boolean} isTarget  rows that count as positions
 */
export function withPlacement(items, containerId, session, isTarget) {
    const { active, placement } = session;
    if (!items || !active || !placement || placement.containerId === active.origin) return items;
    const isActive = (r) => r.id === active.row.id;
    if (containerId === active.origin) return items.filter(r => !isActive(r));
    if (containerId !== placement.containerId) return items;
    const rest = items.filter(r => !isActive(r));
    const positions = rest.filter(isTarget).length;
    const at = Math.max(0, Math.min(placement.index, positions));
    const out = [...rest];
    out.splice(at, 0, active.row);
    return out;
}

// ── The handlers' shared steps ──────────────────────────────────────────────

/** The list a droppable belongs to: a container is its own list. */
export const listIdOf = (over) => {
    const data = over?.data.current;
    if (!data) return null;
    return data.kind === 'container' ? over.id : data.containerId;
};

export const indexOfId = (items, id) => items.findIndex(r => r.id === id);

/** Is the dragged item's centre below the hovered row's centre? */
const isBelow = (active, over) => {
    const dragged = active.rect.current.translated;
    if (!dragged || !over.rect) return false;
    return dragged.top + dragged.height / 2 > over.rect.top + over.rect.height / 2;
};

/** Start a session from dnd-kit's onDragStart. */
export function beginSession(store, { active }) {
    const data = active.data.current;
    store.getState().begin({
        id: active.id, type: data.type, row: data.row, origin: data.containerId,
        keepsMovedRows: !!data.policy?.keepsMovedRows,
    });
}

/**
 * onDragOver's whole job: which foreign list the item has been carried into
 * (so that list shows it in place and its siblings slide aside), or which list
 * would take it as a whole (highlighted).
 *
 * @param {Function} store   a `createDragSession()` store
 * @param {(id: string) => ?object} listOf  container id → registered entry
 */
export function trackPlacement(store, listOf, { active, over }) {
    const state = store.getState();
    const session = state.active;
    if (!session) return;
    const data = over?.data.current;
    if (!data || isHoverSwitch(data, session.type) || !policyAccepts(data, session.type)) {
        state.setHighlight(null);
        return;
    }
    const target = listIdOf(over);
    if (target === session.origin) {
        if (state.placement) state.place(null);
        state.setHighlight(null);
        return;
    }
    if (!honoursPosition(data)) {
        // Takes the drop as a whole: the item stays home, the list lights up.
        state.setHighlight(target);
        if (state.placement) state.place(null);
        return;
    }
    // Honours a position: its siblings slide aside — that IS the feedback.
    state.setHighlight(null);
    if (state.placement?.containerId === target) return;   // already carried here
    const list = listOf(target);
    if (!list?.ready) return;                               // still loading: not a place yet

    const positions = list.getItems().filter(data.policy.isTarget);
    // The list may already hold a copy of the item (the aggregator's row
    // carried into its own category card); `withPlacement` drops that copy
    // before placing, so an index past it is one less.
    const own = indexOfId(positions, session.row.id);
    let index = own >= 0 ? positions.length - 1 : positions.length;
    if (data.kind === 'item') {
        const at = indexOfId(positions, data.row.id);
        if (at >= 0) {
            index = at + (isBelow(active, over) ? 1 : 0);
            if (own >= 0 && own < index) index -= 1;
        }
    }
    state.place({ containerId: target, index });
}

/** End the session, returning what it was at the drop. */
export function endSession(store) {
    const state = store.getState();
    const session = { active: state.active, placement: state.placement };
    state.end();
    return session;
}

/**
 * The final order of a list the item was carried into: where it was placed,
 * then moved among that list's rows by the sortable.
 */
export function settledOrder(list, containerId, session, policy, over) {
    const rendered = withPlacement(list.getItems(), containerId, session, policy.isTarget);
    const data = over.data.current;
    if (data.kind !== 'item' || data.containerId !== containerId) return rendered;
    const from = indexOfId(rendered, session.active.row.id);
    const to = indexOfId(rendered, data.row.id);
    return from < 0 || to < 0 ? rendered : arrayMove(rendered, from, to);
}

/**
 * Apply a resolved drop to its lists, then write it through the policy.
 * Success runs `refresh` (a card can REMOUNT mid-drag and seed from the
 * cache, so the cache must not be left on the old order); failure puts every
 * list back exactly as it was, then refreshes.
 *
 * @param {Array<[object, object[]]>} changes  [registered list, its new items]
 */
export function commitDrop(policy, writeCtx, changes, payload, refresh) {
    const before = changes.map(([list]) => [list, list.getItems()]);
    changes.forEach(([list, next]) => list.setItems(next));
    policy.persist(writeCtx, payload, {
        onSaved: refresh,
        onFailed: () => {
            before.forEach(([list, items]) => list.setItems(items));
            refresh?.();
        },
    });
}
