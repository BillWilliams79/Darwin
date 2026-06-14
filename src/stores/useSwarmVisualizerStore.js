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
    // currentDate is navigation state (req #2799); viewResetTick is a transient
    // "Today/view-reset" signal — neither is a saved preference.
    const { currentDate, viewResetTick, ...rest } = state;
    return rest;
};

// Forward-migrate persisted state to the current schema. Always strips
// `currentDate` (req #2799) and back-fills the fields added since v1 with their
// defaults so an old blob upgrades cleanly. Exported for unit-test coverage.
export const migrateVisualizerState = (persisted) => {
    // drop stale persisted date (req #2799); drop the removed vizKey (req #2806 —
    // the bead/swarm mode selector is gone, swarm is the only visualization).
    const { currentDate, vizKey, ...rest } = persisted || {};
    return {
        ...rest,
        // v1 → v2: req #2383 elevatorOn, req #2382 dataKey.
        elevatorOn: rest.elevatorOn ?? false,
        dataKey: rest.dataKey === 'coordination' ? 'coordination' : 'category',
        // v2 → v3: req #2556 titlesOn.
        titlesOn: rest.titlesOn ?? false,
        // v3 → v4: req #2790 completesOn (off by default).
        completesOn: rest.completesOn ?? false,
        // v6 → v7: req #2823 phasesOn (off by default) — segment the duration
        // line by session phase-duration buckets.
        phasesOn: rest.phasesOn ?? false,
        // v7 → v8: req #2841 konvaOn (ON by default) — the Konva canvas redesign
        // is the new default visualizer substrate; "Classic" falls back to the
        // SVG/DOM TimeSeriesView baseline (req #2840) for comparison.
        konvaOn: rest.konvaOn ?? true,
        // v8 → v9: req #2841 konvaWide (ON by default) — the 36h noon-centered
        // window for the Konva canvas's mid zoom (toggled by the 36h button).
        konvaWide: rest.konvaWide ?? true,
        // v9 → v10: req #2846 costOn (off by default) — size each bead by its
        // session's token cost so expensive work stands out at a glance.
        costOn: rest.costOn ?? false,
    };
};

export const useSwarmVisualizerStore = create(
    persist(
        (set) => ({
            viewType: 'day',             // 'day' | 'week'
            currentDate: localDateStr(), // YYYY-MM-DD — navigation state, NOT persisted (req #2799)
            beadWindow: '24h',           // '24h' | '36h'
            sidewalkOn: false,           // horizontal 21-day strip (day view)
            elevatorOn: false,           // vertical 21-day strip (week view) — req #2383
            dataKey: 'category',         // 'category' | 'coordination' — req #2382
            titlesOn: false,             // show requirement title to right of bubble — req #2556
            completesOn: false,          // show completion-terminus badge — req #2790 (off by default)
            phasesOn: false,             // segment duration line by session phase buckets — req #2823 (off by default)
            konvaOn: true,               // Konva canvas redesign as default substrate — req #2841 (Classic = SVG baseline)
            konvaWide: true,             // 36h noon-centered window for the Konva canvas mid zoom — req #2841
            costOn: false,               // size each bead by its session token cost — req #2846 (off by default)
            viewResetTick: 0,            // bumped by "Today" to reset the canvas view (req #2841) — not persisted

            setViewType: (viewType) => set({ viewType }),
            setCurrentDate: (currentDate) => set({ currentDate }),
            setBeadWindow: (beadWindow) => set({ beadWindow }),
            setSidewalkOn: (on) => set({ sidewalkOn: !!on }),
            setElevatorOn: (on) => set({ elevatorOn: !!on }),
            setDataKey: (key) =>
                set({ dataKey: key === 'coordination' ? 'coordination' : 'category' }),
            setTitlesOn: (on) => set({ titlesOn: !!on }),
            setCompletesOn: (on) => set({ completesOn: !!on }),
            setPhasesOn: (on) => set({ phasesOn: !!on }),
            setKonvaOn: (on) => set({ konvaOn: !!on }),
            setKonvaWide: (on) => set({ konvaWide: !!on }),
            setCostOn: (on) => set({ costOn: !!on }),
            resetView: () => set((s) => ({ viewResetTick: s.viewResetTick + 1 })),
        }),
        {
            name: 'darwin_swarm_visualizer',
            // v4 → v5 (req #2799): currentDate no longer persisted.
            // v5 → v6 (req #2806): vizKey (bead/swarm mode) removed. Bumping the
            // version forces migrate to run once for existing users so a stale
            // date OR a persisted vizKey already in localStorage is stripped on
            // first load.
            // v6 → v7 (req #2823): phasesOn added; migrate back-fills it to false.
            // v7 → v8 (req #2841): konvaOn added; migrate back-fills it to true
            // (the Konva canvas is the new default visualizer substrate).
            // v8 → v9 (req #2841): konvaWide added; back-fills to true (36h mid zoom).
            // v9 → v10 (req #2846): costOn added; migrate back-fills it to false
            // (bead sizing by token cost is off by default).
            version: 10,
            // Never write currentDate (req #2799) — it stays a today-default each load.
            partialize: persistPartialize,
            migrate: migrateVisualizerState,
        }
    )
);
