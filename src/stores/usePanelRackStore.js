import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import { rackInsert, rackRemove } from '../Components/AnchoredPanel/panelRack';

// The panel rack (req #3720) — the Darwin navbar as a drop zone for any
// AnchoredPanel that names a `rackId` (see Components/AnchoredPanel/panelRack.js).
//   • `racked` — the ids locked into the navbar, top to bottom. Persisted per
//     browser: where the reader keeps a panel is a viewer convenience.
//   • `slot` — `{ node, width }`: the navbar's rack element and its width,
//     published by the navbar while it is drawn. null = no rack here (mobile),
//     so a racked panel floats at its dock instead.
//   • `drag` — `{ id, over, index, fromRack, color }` while a rackable panel is
//     being moved: `over` = the pointer is on the navbar, `index` = where in the
//     stack it would land, `color` = the panel's frame. The navbar glows in it
//     while `over` (req #3728).
export const usePanelRackStore = create(
    persist(
        (set, get) => ({
            racked: [],
            slot: null,
            drag: null,
            rack: (id, index) => set({ racked: rackInsert(get().racked, id, index) }),
            unrack: (id) => set({ racked: rackRemove(get().racked, id) }),
            setSlot: (slot) => set({ slot }),
            setDrag: (drag) => set({ drag }),
        }),
        {
            name: 'darwin_panel_rack',
            version: 1,
            partialize: (s) => ({ racked: s.racked }),
            merge: (persisted, current) => ({
                ...current,
                racked: Array.isArray(persisted?.racked)
                    ? persisted.racked.filter(x => typeof x === 'string') : [],
            }),
        }
    )
);
