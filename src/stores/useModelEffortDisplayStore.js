import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// Global display preferences for the Model + Effort row columns (req #3029).
//
// The Model and Effort columns render inside the aggregator (Swarm-Start) card
// and, when opted in, on every CategoryCard row. These preferences control the
// user-facing options:
//
//   • `showOnAllCards` — promote the columns onto every CategoryCard row too, not
//                        just the aggregator. Default false (aggregator only).
//   • `displayMode`    — how each value is drawn:
//        'pill'    → full semantic-colored chip (e.g. "Opus", "XHigh")   [default]
//        'compact' → single-letter colored chip ("O", "X") for Model/Effort and
//                    the small icons for Status/Autonomy — the horizontal-space saver
//   • `columnOrder`    — arrangement of the five value columns (Req# always follows
//                        the aggregator color-bar):
//        'standard'   → Req# · Status · Autonomy · Model · Effort   [default]
//        'meFirst'    → Model · Effort · Req# · Status · Autonomy
//        'meAfterReq' → Req# · Model · Effort · Status · Autonomy
//   • `wideAggregator` — on wide viewports let the aggregator card span two grid
//                        tracks so its extra columns fit. Default true; off keeps
//                        it the same width as every other card.
//
// Persisted so the choice survives reloads, mirroring useSwarmStartCardStore.

export const MODEL_EFFORT_DISPLAY_MODES = ['pill', 'compact'];
export const MODEL_EFFORT_COLUMN_ORDERS = ['standard', 'meFirst', 'meAfterReq'];

export const useModelEffortDisplayStore = create(
    persist(
        (set, get) => ({
            showOnAllCards: false,
            toggleShowOnAllCards: () => set({ showOnAllCards: !get().showOnAllCards }),
            setShowOnAllCards: (value) => set({ showOnAllCards: Boolean(value) }),

            displayMode: 'pill',
            // Guard against a stale/invalid persisted value re-pointing at the default.
            setDisplayMode: (mode) => set({
                displayMode: MODEL_EFFORT_DISPLAY_MODES.includes(mode) ? mode : 'pill',
            }),

            columnOrder: 'standard',
            setColumnOrder: (order) => set({
                columnOrder: MODEL_EFFORT_COLUMN_ORDERS.includes(order) ? order : 'standard',
            }),

            wideAggregator: true,
            toggleWideAggregator: () => set({ wideAggregator: !get().wideAggregator }),
        }),
        {
            name: 'darwin_model_effort_display',
            // Coerce stale persisted enums (e.g. a retired 'clean'/'text' displayMode,
            // or the pre-3-way `modelEffortFirst` boolean) back to valid defaults so a
            // removed option can never leave the UI in an unselectable state.
            merge: (persisted, current) => {
                const p = persisted || {};
                return {
                    ...current,
                    ...p,
                    displayMode: MODEL_EFFORT_DISPLAY_MODES.includes(p.displayMode)
                        ? p.displayMode : current.displayMode,
                    columnOrder: MODEL_EFFORT_COLUMN_ORDERS.includes(p.columnOrder)
                        ? p.columnOrder : current.columnOrder,
                };
            },
        }
    )
);
