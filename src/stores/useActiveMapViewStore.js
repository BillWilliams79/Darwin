import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export const useActiveMapViewStore = create(
    persist(
        (set) => ({
            activeViewId: null, // null = "All" (no filter)
            setActiveViewId: (id) => set({ activeViewId: id }),
        }),
        {
            name: 'darwin_active_map_view',
        }
    )
);
