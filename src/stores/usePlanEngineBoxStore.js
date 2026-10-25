import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// The Plan visualizer's "Engine" box (req #3935; was the canvas-corner strip,
// req #3762) — a viewport-docked AnchoredPanel drawn over the plan, like the
// Active box.
//   • `open` — its rows are expanded (its ▾ head; folded, the panel is the head).
//     Open by default: the order and the cut are what the overlay exists to show.
//   • `dock` — where it sits and its shape (see anchoredPanelGeometry.js); null =
//     home. Written once per move or reshape, on release.
// Persisted per browser: where the reader parks it is a viewer convenience.
export const usePlanEngineBoxStore = create(
    persist(
        (set, get) => ({
            open: true,
            dock: null,
            toggleOpen: () => set({ open: !get().open }),
            setDock: (dock) => set({ dock }),
        }),
        { name: 'darwin_plan_engine_box', version: 1,
            partialize: (s) => ({ open: s.open, dock: s.dock }) }
    )
);
