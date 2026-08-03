import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// Global state for the Map Aggregator Card in the /maps cards view (req #3158).
//   • `show` — visibility toggle (Map icon in the MapsPage header, cards view only).
// Same pattern as useSwarmStartCardStore: persisted so the toggle survives reloads.
export const useMapAggregatorCardStore = create(
    persist(
        (set, get) => ({
            show: false,
            toggle: () => set({ show: !get().show }),
        }),
        { name: 'darwin_map_aggregator_card' }
    )
);
