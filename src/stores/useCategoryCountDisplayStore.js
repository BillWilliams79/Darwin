import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// req #3505 — global display preference for showing each category card's
// requirement count in its title, e.g. "Swarm (17)". Deliberately excludes
// the aggregator (Swarm-Start) card — that card is a different component
// (TaskPlanView/SwarmStartCard.jsx) that this store's consumer never touches.
// Default false (off) so existing card titles are unchanged until the user
// opts in. Persisted so the choice survives reloads, mirroring
// useModelEffortDisplayStore.

export const useCategoryCountDisplayStore = create(
    persist(
        (set, get) => ({
            showCount: false,
            toggleShowCount: () => set({ showCount: !get().showCount }),
            setShowCount: (value) => set({ showCount: Boolean(value) }),
        }),
        {
            name: 'darwin_category_count_display',
        }
    )
);
