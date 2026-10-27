import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// The navbar's Dev Server panel (req #3727) — dev builds only, racked in the
// navbar by default (usePanelRackStore.seed); these are its floating state.
//   • `open` — its body is expanded (its ▾ head; folded, the panel is the head).
//   • `dock` — where it sits floating, and its shape (anchoredPanelGeometry.js);
//     null = home. Written once per move or reshape, on release.
//   • `titleLock` — `{ side, x }`: it is LOCKED INTO THE PAGE'S TITLE BAR where
//     the reader dropped it (req #3961, titleBarLock.js); null = it floats.
// Persisted per browser — and so per dev server, since each is its own origin.
export const useDevServerInfoStore = create(
    persist(
        (set, get) => ({
            open: true,
            dock: null,
            toggleOpen: () => set({ open: !get().open }),
            setDock: (dock) => set({ dock }),
            titleLock: null,
            setTitleLock: (titleLock) => set({ titleLock }),
        }),
        { name: 'darwin_devserver_info', version: 1 }
    )
);
