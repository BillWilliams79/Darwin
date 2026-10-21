import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// The Plan visualizer's "Active" box (req #3721) — a viewport-docked
// AnchoredPanel drawn over the plan, like the Dev Servers dashboard.
//   • `open` — its list is expanded (its ▾ head; folded, the panel is the head).
//   • `small` — the small view: each row is its id and pills, no title.
//   • `dock` — where it sits and its shape (see anchoredPanelGeometry.js); null =
//     home. Written once per move or reshape, on release.
// Persisted per browser: where the reader parks it is a viewer convenience.
export const usePlanActiveBoxStore = create(
    persist(
        (set, get) => ({
            open: true,
            small: false,
            dock: null,
            toggleOpen: () => set({ open: !get().open }),
            toggleSmall: () => set({ small: !get().small }),
            setDock: (dock) => set({ dock }),
        }),
        { name: 'darwin_plan_active_box', version: 1 }
    )
);
