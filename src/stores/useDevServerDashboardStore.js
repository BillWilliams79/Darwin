import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// The Dev Servers dashboard (req #3643) — a viewport-docked box on every page.
//   • `show` — the box is drawn at all (× on the box hides it; the Dev Servers
//     page header's "Show dashboard" chip brings it back).
//   • `open` — its list is expanded (its ▾ head; folded, the panel is the head).
//   • `dock` — where it sits and its shape (see anchoredPanelGeometry.js); null =
//     home. Written once per move or reshape, on release.
//   • `titleLock` — `{ side, x }`: it is LOCKED INTO THE PAGE'S TITLE BAR where
//     the reader dropped it (req #3961, titleBarLock.js); null = it floats.
// Persisted per browser: where the reader parks it is a viewer convenience.
export const useDevServerDashboardStore = create(
    persist(
        (set, get) => ({
            show: true,
            open: true,
            dock: null,
            toggleShow: () => set({ show: !get().show }),
            setShow: (show) => set({ show }),
            toggleOpen: () => set({ open: !get().open }),
            setDock: (dock) => set({ dock }),
            titleLock: null,
            setTitleLock: (titleLock) => set({ titleLock }),
        }),
        {
            name: 'darwin_devserver_dashboard',
            // v2: the panel is content-sized on BOTH axes until reshaped
            // (`dock.w`/`dock.ht` null — user directive: minimal by default).
            // v0 saved a width from every move (the old fixed 320px) and v1 a
            // height from every grip drag, so neither ever shrank: drop both,
            // keep the spot. From v2 a size is only ever one the reader drew,
            // on the axis they drew it.
            version: 2,
            migrate: (state, version) => (version < 2 && state?.dock
                ? { ...state, dock: { ...state.dock, w: null, ht: null } }
                : state),
        }
    )
);
