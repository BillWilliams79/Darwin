import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { localDateStr } from '../utils/dateFormat';

// `currentDate` is NAVIGATION state, not a saved preference (req #2799). It must
// reset to today on every fresh page load. Persisting it was the source of the
// "late-May affinity": navigation calls setCurrentDate as the canvas pans, which
// wrote whatever date the view landed on to localStorage, and the next page load
// rehydrated that stale date instead of today. partialize drops it from what gets
// written; migrate strips any date a pre-#2799 build already persisted so existing
// users also reset to today. Exported for unit-test coverage.
export const persistPartialize = (state) => {
    // currentDate is navigation state (req #2799); viewResetTick is a transient
    // "Today/view-reset" signal — neither is a saved preference.
    const { currentDate, viewResetTick, ...rest } = state;
    return rest;
};

// Forward-migrate persisted state to the current schema. Always strips
// `currentDate` (req #2799) plus the fields retired along the way, and back-fills
// the surviving fields with their defaults so an old blob upgrades cleanly.
// Exported for unit-test coverage.
export const migrateVisualizerState = (persisted) => {
    // Strip fields removed over the schema's lifetime:
    //   • currentDate — navigation state, never persisted (req #2799).
    //   • vizKey      — bead/swarm mode selector, removed when swarm became the
    //                   only visualization (req #2806).
    //   • konvaOn / viewType / beadWindow / sidewalkOn / elevatorOn — the Classic
    //                   SVG/DOM TimeSeriesView and its Day/Week + Sidewalk +
    //                   Elevator + sub-day bead modes were retired; the Konva
    //                   canvas is the only substrate (req #2844).
    const {
        currentDate, vizKey,
        konvaOn, viewType, beadWindow, sidewalkOn, elevatorOn,
        ...rest
    } = persisted || {};
    return {
        ...rest,
        // req #2382 dataKey.
        dataKey: rest.dataKey === 'coordination' ? 'coordination' : 'category',
        // req #2556 titlesOn.
        titlesOn: rest.titlesOn ?? false,
        // req #2790 completesOn (off by default).
        completesOn: rest.completesOn ?? false,
        // req #2823 phasesOn (off by default) — segment the duration line by
        // session phase-duration buckets.
        phasesOn: rest.phasesOn ?? false,
        // req #2841 konvaWide (ON by default) — the 36h noon-centered window for
        // the Konva canvas's mid zoom (toggled by the 36h button).
        konvaWide: rest.konvaWide ?? true,
        // v9 → v10: req #2846 costOn (off by default) — size each bead by its
        // session's token cost so expensive work stands out at a glance.
        costOn: rest.costOn ?? false,
    };
};

export const useSwarmVisualizerStore = create(
    persist(
        (set) => ({
            currentDate: localDateStr(), // YYYY-MM-DD — navigation state, NOT persisted (req #2799)
            dataKey: 'category',         // 'category' | 'coordination' — req #2382
            titlesOn: false,             // show requirement title to right of bubble — req #2556
            completesOn: false,          // show completion-terminus badge — req #2790 (off by default)
            phasesOn: false,             // segment duration line by session phase buckets — req #2823 (off by default)
            konvaWide: true,             // 36h noon-centered window for the Konva canvas mid zoom — req #2841
            costOn: false,               // size each bead by its session token cost — req #2846 (off by default)
            viewResetTick: 0,            // bumped by "Today" to reset the canvas view (req #2841) — not persisted

            setCurrentDate: (currentDate) => set({ currentDate }),
            setDataKey: (key) =>
                set({ dataKey: key === 'coordination' ? 'coordination' : 'category' }),
            setTitlesOn: (on) => set({ titlesOn: !!on }),
            setCompletesOn: (on) => set({ completesOn: !!on }),
            setPhasesOn: (on) => set({ phasesOn: !!on }),
            setKonvaWide: (on) => set({ konvaWide: !!on }),
            setCostOn: (on) => set({ costOn: !!on }),
            resetView: () => set((s) => ({ viewResetTick: s.viewResetTick + 1 })),
        }),
        {
            name: 'darwin_swarm_visualizer',
            // v4 → v5 (req #2799): currentDate no longer persisted.
            // v5 → v6 (req #2806): vizKey (bead/swarm mode) removed.
            // v6 → v7 (req #2823): phasesOn added; migrate back-fills it to false.
            // v7 → v8 (req #2841): konvaOn added (Konva canvas default substrate).
            // v8 → v9 (req #2841): konvaWide added; back-fills to true (36h mid zoom).
            // v9 → v10 (req #2844): Classic TimeSeriesView retired — konvaOn,
            //   viewType, beadWindow, sidewalkOn, elevatorOn removed. Bumping the
            //   version forces migrate to run once for existing users so those
            //   stale fields (and any persisted currentDate) are stripped on load.
            // v10 → v11 (req #2846): costOn added; migrate back-fills it to false
            //   (bead sizing by token cost is off by default).
            version: 11,
            // Never write currentDate (req #2799) — it stays a today-default each load.
            partialize: persistPartialize,
            migrate: migrateVisualizerState,
        }
    )
);
