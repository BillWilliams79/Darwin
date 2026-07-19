import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// Per-browser color customization for ChipFilter options (req #2992).
//
// The standard palette in components/ChipFilter/filterPalette.js supplies a
// deterministic default for every option. This store holds the exceptions: a
// user who wants their laptop always shown in green pins it here and every
// ChipFilter over the machine dimension picks it up.
//
// Keyed by dimension ("machine", "project", ...) then by option value, so two
// dimensions that happen to share an id space never collide.
//
// No settings UI ships with #2992 — the plumbing is here and the store is
// writable from the console. A color-picker is a separate requirement.
export const useFilterColorStore = create(
    persist(
        (set) => ({
            // { [dimension]: { [value]: { bg, fg } } }
            overrides: {},

            setFilterColor: (dimension, value, color) =>
                set((state) => ({
                    overrides: {
                        ...state.overrides,
                        [dimension]: { ...state.overrides[dimension], [value]: color },
                    },
                })),

            clearFilterColor: (dimension, value) =>
                set((state) => {
                    const dim = { ...state.overrides[dimension] };
                    delete dim[value];
                    return { overrides: { ...state.overrides, [dimension]: dim } };
                }),

            resetFilterColors: (dimension) =>
                set((state) => {
                    if (!dimension) return { overrides: {} };
                    const next = { ...state.overrides };
                    delete next[dimension];
                    return { overrides: next };
                }),
        }),
        {
            name: 'darwin_filter_colors',
            version: 1,
        }
    )
);

// Non-reactive read, for chip-props helpers called outside React render.
// Components that need to re-render on an override change should subscribe with
// the hook instead.
export const getFilterOverrides = (dimension) =>
    useFilterColorStore.getState().overrides?.[dimension];
