import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// Global toggle for the Swarm-Start Card in the Roadmap view.
// Data is cross-category (all swarm_ready requirements), so a single show flag suffices.
export const useSwarmStartCardStore = create(
    persist(
        (set, get) => ({
            show: false,
            toggle: () => set({ show: !get().show }),
        }),
        { name: 'darwin_swarm_start_card' }
    )
);
