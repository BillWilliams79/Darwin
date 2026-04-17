import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// Global state for the Swarm-Start Card in the Roadmap view.
//   • `show`           — visibility toggle (RocketLaunch icon in SwarmView header)
//   • `selectedStatus` — which requirement_status the card is aggregating (one-at-a-time;
//                        card shows all requirements with that status across all categories).
//                        Default 'swarm_ready' preserves the card's original behavior for
//                        existing users whose persisted state pre-dates this field.
export const useSwarmStartCardStore = create(
    persist(
        (set, get) => ({
            show: false,
            toggle: () => set({ show: !get().show }),

            selectedStatus: 'swarm_ready',
            setSelectedStatus: (status) => set({ selectedStatus: status }),
        }),
        { name: 'darwin_swarm_start_card' }
    )
);
