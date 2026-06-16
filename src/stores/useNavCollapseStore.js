import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// req #2870: the desktop sidebar collapse/expand control was a floating edge tab
// rendered in the view pane (position:fixed at the sidebar's right edge), where it
// overlapped visualizers. The control now lives INSIDE the navbar, and this store
// persists which of the two in-navbar representations the user prefers.
//
//   'header' — a chevron icon button in the sidebar header row.
//   'footer' — a full-width collapse row pinned at the bottom of the sidebar.
export const PLACEMENTS = ['header', 'footer'];
export const DEFAULT_PLACEMENT = 'header';

// Pure helper (exported for testing): coerce any persisted/unknown value to a
// valid placement so a corrupt localStorage blob can never wedge the navbar.
export const normalizePlacement = (value) =>
    PLACEMENTS.includes(value) ? value : DEFAULT_PLACEMENT;

export const useNavCollapseStore = create(
    persist(
        (set) => ({
            placement: DEFAULT_PLACEMENT,
            setPlacement: (value) => set({ placement: normalizePlacement(value) }),
        }),
        {
            name: 'darwin_nav_collapse',
            // Guard against an unknown persisted value (e.g. a future/renamed
            // placement that was rolled back) reaching the render path.
            merge: (persisted, current) => ({
                ...current,
                ...persisted,
                placement: normalizePlacement(persisted?.placement),
            }),
        }
    )
);
