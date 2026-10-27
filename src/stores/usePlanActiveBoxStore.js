import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// The Plan visualizer's "Active" box (req #3721) — a viewport-docked
// AnchoredPanel drawn over the plan, like the Dev Servers dashboard.
//   • `open` — its list is expanded (its ▾ head; folded, the panel is the head).
//   • `dock` — where it sits and its shape (see anchoredPanelGeometry.js); null =
//     home. Written once per move or reshape, on release.
// Persisted per browser: where the reader parks it is a viewer convenience.
//
// One store per box (req #3978): the Pipelines page's "All Active" box is the
// same component, parked on its own page, so it remembers its own place.
export function createActiveBoxStore(name) {
    return create(
        persist(
            (set, get) => ({
                open: true,
                dock: null,
                toggleOpen: () => set({ open: !get().open }),
                setDock: (dock) => set({ dock }),
            }),
            // Only what it reads: a pre-#3741 `small` key is dropped on the next write.
            { name, version: 1,
                partialize: (s) => ({ open: s.open, dock: s.dock }) }
        )
    );
}

export const usePlanActiveBoxStore = createActiveBoxStore('darwin_plan_active_box');

// req #3978 — the Pipelines page's "All Active" box.
export const useAllActiveBoxStore = createActiveBoxStore('darwin_pipelines_all_active_box');
