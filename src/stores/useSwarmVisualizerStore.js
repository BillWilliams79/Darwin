import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { localDateStr } from '../utils/dateFormat';

// `currentDate` is NAVIGATION state, not a saved preference (req #2799). It must
// reset to today on every fresh page load. Persisting it was the source of the
// "late-May affinity": the elevator/sidewalk/chevrons call setCurrentDate as they
// scroll, which wrote whatever date the strip landed on (e.g. a dense late-May
// day) to localStorage, and the next page load rehydrated that stale date instead
// of today. partialize drops it from what gets written; migrate strips any date a
// pre-#2799 build already persisted so existing users also reset to today.
// Exported for unit-test coverage.
export const persistPartialize = (state) => {
    const { currentDate, ...rest } = state;
    return rest;
};

// Forward-migrate persisted state to the current schema. Always strips
// `currentDate` (req #2799) and back-fills the fields added since v1 with their
// defaults so an old blob upgrades cleanly. Exported for unit-test coverage.
export const migrateVisualizerState = (persisted) => {
    const { currentDate, ...rest } = persisted || {};   // drop stale persisted date (req #2799)
    return {
        ...rest,
        // v1 → v2: req #2383 elevatorOn, req #2382 dataKey.
        elevatorOn: rest.elevatorOn ?? false,
        dataKey: rest.dataKey === 'coordination' ? 'coordination' : 'category',
        // v2 → v3: req #2556 titlesOn.
        titlesOn: rest.titlesOn ?? false,
        // v3 → v4: req #2790 completesOn (off by default).
        completesOn: rest.completesOn ?? false,
    };
};

export const useSwarmVisualizerStore = create(
    persist(
        (set) => ({
            viewType: 'day',             // 'day' | 'week'
            currentDate: localDateStr(), // YYYY-MM-DD — navigation state, NOT persisted (req #2799)
            vizKey: 'bead',              // 'bead' | 'swarm'
            beadWindow: '24h',           // '24h' | '36h'
            sidewalkOn: false,           // horizontal 21-day strip (day view)
            elevatorOn: false,           // vertical 21-day strip (week view) — req #2383
            dataKey: 'category',         // 'category' | 'coordination' — req #2382
            titlesOn: false,             // show requirement title to right of bubble — req #2556
            completesOn: false,          // show completion-terminus badge — req #2790 (off by default)

            setViewType: (viewType) => set({ viewType }),
            setCurrentDate: (currentDate) => set({ currentDate }),
            setVizKey: (vizKey) => set({ vizKey }),
            setBeadWindow: (beadWindow) => set({ beadWindow }),
            setSidewalkOn: (on) => set({ sidewalkOn: !!on }),
            setElevatorOn: (on) => set({ elevatorOn: !!on }),
            setDataKey: (key) =>
                set({ dataKey: key === 'coordination' ? 'coordination' : 'category' }),
            setTitlesOn: (on) => set({ titlesOn: !!on }),
            setCompletesOn: (on) => set({ completesOn: !!on }),
        }),
        {
            name: 'darwin_swarm_visualizer',
            // v4 → v5 (req #2799): currentDate no longer persisted. Bumping the
            // version forces migrate to run once for existing users so a stale
            // date already in localStorage is stripped on first load.
            version: 5,
            // Never write currentDate (req #2799) — it stays a today-default each load.
            partialize: persistPartialize,
            migrate: migrateVisualizerState,
        }
    )
);
