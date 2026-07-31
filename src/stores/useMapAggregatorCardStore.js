import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// Global state for the Aggregate Map Card in the Maps cards view.
//   • `show` — visibility toggle (TravelExplore icon in the MapsPage header row).
// Same shape and persistence approach as useSwarmStartCardStore — the two cards
// are the canonical instances of the aggregator-card pattern
// (memory/aggregator-card-pattern.md).
export const useMapAggregatorCardStore = create(
    persist(
        (set, get) => ({
            show: false,
            toggle: () => set({ show: !get().show }),
        }),
        { name: 'darwin_map_aggregator_card' }
    )
);
