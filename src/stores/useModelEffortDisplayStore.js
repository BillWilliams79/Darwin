import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// Global display preferences for the Model + Effort row columns (req #3029;
// trimmed to just these two toggles in req #3043 — the display-mode
// (pill/compact) and column-order options were removed, leaving pill
// rendering and the standard column order as the only (hardcoded) behavior).
//
// The Model and Effort columns render inside the aggregator (Swarm-Start) card
// and, when opted in, on every CategoryCard row. These preferences control the
// user-facing options:
//
//   • `showOnAllCards` — promote the columns onto every CategoryCard row too, not
//                        just the aggregator. Default false (aggregator only).
//   • `wideAggregator` — on wide viewports let the aggregator card span two grid
//                        tracks so its extra columns fit. Default true; off keeps
//                        it the same width as every other card.
//
// Persisted so the choice survives reloads, mirroring useSwarmStartCardStore.

export const useModelEffortDisplayStore = create(
    persist(
        (set, get) => ({
            showOnAllCards: false,
            toggleShowOnAllCards: () => set({ showOnAllCards: !get().showOnAllCards }),
            setShowOnAllCards: (value) => set({ showOnAllCards: Boolean(value) }),

            wideAggregator: true,
            toggleWideAggregator: () => set({ wideAggregator: !get().wideAggregator }),
        }),
        {
            name: 'darwin_model_effort_display',
            // Strip retired keys (`displayMode`/`columnOrder`, removed in req #3043)
            // out of any stale persisted value so they can never resurrect a
            // removed option in state.
            merge: (persisted, current) => {
                const { displayMode, columnOrder, ...rest } = persisted || {};
                return { ...current, ...rest };
            },
        }
    )
);
