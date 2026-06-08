import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { localDateStr } from '../utils/dateFormat';

export const useSwarmVisualizerStore = create(
    persist(
        (set) => ({
            viewType: 'day',             // 'day' | 'week'
            currentDate: localDateStr(), // YYYY-MM-DD
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
            version: 4,
            migrate: (persisted, version) => ({
                ...persisted,
                // v1 → v2: req #2383 elevatorOn, req #2382 dataKey.
                elevatorOn: persisted.elevatorOn ?? false,
                dataKey: persisted.dataKey === 'coordination' ? 'coordination' : 'category',
                // v2 → v3: req #2556 titlesOn.
                titlesOn: persisted.titlesOn ?? false,
                // v3 → v4: req #2790 completesOn (off by default).
                completesOn: persisted.completesOn ?? false,
            }),
        }
    )
);
