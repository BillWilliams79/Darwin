import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// Global display preference for the Model + Effort row columns (req #3029;
// trimmed to just this one toggle in req #3064 — the display-mode
// (pill/compact) and column-order options were removed in req #3043, and
// `wideAggregator` was retired in req #3064: the aggregator card is now always
// the same (usual) width as every other card, so there's nothing left to toggle).
//
// The Model and Effort columns render inside the aggregator (Swarm-Start) card
// and, when opted in, on every CategoryCard row. `showOnAllCards` promotes the
// columns onto every CategoryCard row too, not just the aggregator. Default
// false (aggregator only). Persisted so the choice survives reloads, mirroring
// useSwarmStartCardStore.

export const useModelEffortDisplayStore = create(
    persist(
        (set, get) => ({
            showOnAllCards: false,
            toggleShowOnAllCards: () => set({ showOnAllCards: !get().showOnAllCards }),
            setShowOnAllCards: (value) => set({ showOnAllCards: Boolean(value) }),
        }),
        {
            name: 'darwin_model_effort_display',
            // Strip retired keys (`displayMode`/`columnOrder` removed in req #3043;
            // `wideAggregator` removed in req #3064) out of any stale persisted
            // value so they can never resurrect a removed option in state.
            merge: (persisted, current) => {
                const { displayMode, columnOrder, wideAggregator, ...rest } = persisted || {};
                return { ...current, ...rest };
            },
        }
    )
);
