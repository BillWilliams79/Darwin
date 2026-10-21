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
//   • `seeded` — the ids of panels that are racked BY DEFAULT (req #3727 — the
//     navbar's Dev Server panel) and have been racked once already. `seed(id)`
//     racks such a panel the first time it mounts in this browser, at the
//     bottom of the stack; after that where it sits is the reader's, so one
//     dragged off the navbar stays floating. Persisted with `racked`.
//   • `covered` — a page is drawn OVER the navbar (the Plan page maximized,
//     req #3735): the navbar is still mounted underneath, so the rack is
//     SUSPENDED for every window — no drop zone, a racked window floats —
//     rather than portalling windows into a navbar nobody can see. Published
//     by the covering page while it covers; live only, never persisted.
const ids = (v) => (Array.isArray(v) ? v.filter(x => typeof x === 'string') : []);

export const usePanelRackStore = create(
    persist(
        (set, get) => ({
            racked: [],
            slot: null,
            drag: null,
            seeded: [],
            covered: false,
            seed: (id) => {
                const { seeded, racked } = get();
                if (seeded.includes(id)) return;
                set({ seeded: [...seeded, id], racked: rackInsert(racked, id, racked.length) });
            },
            rack: (id, index) => set({ racked: rackInsert(get().racked, id, index) }),
            unrack: (id) => set({ racked: rackRemove(get().racked, id) }),
            setSlot: (slot) => set({ slot }),
            setDrag: (drag) => set({ drag }),
            setCovered: (covered) => set({ covered: !!covered }),
        }),
        {
            name: 'darwin_panel_rack',
            version: 1,
            partialize: (s) => ({ racked: s.racked, seeded: s.seeded }),
            merge: (persisted, current) => ({
                ...current,
                racked: ids(persisted?.racked),
                seeded: ids(persisted?.seeded),
            }),
        }
    )
);
