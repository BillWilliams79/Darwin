import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { localDateStr } from '../utils/dateFormat';

// Cap on how far the scroll-up auto-extend (req #2859) will widen the fetch
// window backward. ~2 years comfortably predates any Darwin swarm data, so the
// canvas can scroll up to the project's origin while a hard ceiling prevents a
// runaway fetch window if a pan gesture somehow keeps triggering.
export const MAX_PAST_EXTRA_DAYS = 730;

// Pure reducer for the scroll-up extension counter (req #2859): add `days` of
// history (ignoring non-positive deltas), clamped to [0, MAX_PAST_EXTRA_DAYS].
// Exported for unit-test coverage.
export const nextPastExtraDays = (current, days) =>
    Math.min(MAX_PAST_EXTRA_DAYS, (current || 0) + (days > 0 ? days : 0));

// `currentDate` is NAVIGATION state, not a saved preference (req #2799). It must
// reset to today on every fresh page load. Persisting it was the source of the
// "late-May affinity": navigation calls setCurrentDate as the canvas pans, which
// wrote whatever date the view landed on to localStorage, and the next page load
// rehydrated that stale date instead of today. partialize drops it from what gets
// written; migrate strips any date a pre-#2799 build already persisted so existing
// users also reset to today. Exported for unit-test coverage.
export const persistPartialize = (state) => {
    // currentDate is navigation state (req #2799); viewResetTick is a transient
    // "Today/view-reset" signal; pastExtraDays is the transient scroll-up
    // extension counter (req #2859) — none are saved preferences.
    const { currentDate, viewResetTick, pastExtraDays, ...rest } = state;
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
        // req #2556 titlesOn — ON by default since req #2856.
        titlesOn: rest.titlesOn ?? true,
        // req #2790 completesOn (off by default).
        completesOn: rest.completesOn ?? false,
        // req #2823 phasesOn (off by default) — segment the duration line by
        // session phase-duration buckets.
        phasesOn: rest.phasesOn ?? false,
        // req #2841 konvaWide — the 36h noon-centered window for the Konva canvas's
        // mid zoom (toggled by the 36h button). OFF by default since req #2856 (the
        // default window is 24h).
        konvaWide: rest.konvaWide ?? false,
        // v9 → v10: req #2846 costOn (off by default) — size each bead by its
        // session's token cost so expensive work stands out at a glance.
        costOn: rest.costOn ?? false,
        // v11 → v12: req #2857 devServersOn (ON by default) — overlay a port pill
        // on beads whose session has an active, associated dev server.
        devServersOn: rest.devServersOn ?? true,
    };
};

export const useSwarmVisualizerStore = create(
    persist(
        (set) => ({
            currentDate: localDateStr(), // YYYY-MM-DD — navigation state, NOT persisted (req #2799)
            dataKey: 'category',         // 'category' | 'coordination' — req #2382
            titlesOn: true,              // show requirement title to right of bubble — req #2556 (ON by default since req #2856)
            completesOn: false,          // show completion-terminus badge — req #2790 (off by default)
            phasesOn: false,             // segment duration line by session phase buckets — req #2823 (off by default)
            konvaWide: false,            // 36h noon-centered window for the Konva canvas mid zoom — req #2841 (OFF by default = 24h since req #2856)
            costOn: false,               // size each bead by its session token cost — req #2846 (off by default)
            devServersOn: true,          // overlay active dev-server port pill on beads — req #2857 (on by default)
            viewResetTick: 0,            // bumped by "Today" to reset the canvas view (req #2841) — not persisted
            pastExtraDays: 0,            // extra days of history fetched by scroll-up auto-extend — req #2859 (transient, NOT persisted)

            // Date navigation (Prev/Next/toolbar) starts a fresh window, so the
            // scroll-up extension resets to 0 (req #2859) — otherwise an old
            // extension would keep an over-wide fetch range after jumping weeks.
            setCurrentDate: (currentDate) => set({ currentDate, pastExtraDays: 0 }),
            setDataKey: (key) =>
                set({ dataKey: key === 'coordination' ? 'coordination' : 'category' }),
            setTitlesOn: (on) => set({ titlesOn: !!on }),
            setCompletesOn: (on) => set({ completesOn: !!on }),
            setPhasesOn: (on) => set({ phasesOn: !!on }),
            setKonvaWide: (on) => set({ konvaWide: !!on }),
            setCostOn: (on) => set({ costOn: !!on }),
            setDevServersOn: (on) => set({ devServersOn: !!on }),
            // Scroll-up auto-extend (req #2859) — widen the fetch window backward
            // by `days`, clamped to [0, MAX_PAST_EXTRA_DAYS]. Called by the canvas
            // when the user pans near the oldest loaded day.
            extendPast: (days) => set((s) => ({
                pastExtraDays: nextPastExtraDays(s.pastExtraDays, days),
            })),
            // "Today" / view reset also returns to a fresh, un-extended window
            // (req #2859) so the canvas snaps back to the default ~8-week range.
            resetView: () => set((s) => ({ viewResetTick: s.viewResetTick + 1, pastExtraDays: 0 })),
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
            // req #2856: default UI changed (no version bump — only fresh/reset
            //   state is affected; explicit persisted prefs still win): titlesOn
            //   now defaults ON and konvaWide defaults OFF (24h window). The migrate
            //   back-fills match so a blob missing either field adopts the new
            //   default.
            // v11 → v12 (req #2857): devServersOn added; migrate back-fills it to
            //   true (active dev-server port pill overlay is on by default).
            version: 12,
            // Never write currentDate (req #2799) — it stays a today-default each load.
            partialize: persistPartialize,
            migrate: migrateVisualizerState,
        }
    )
);
