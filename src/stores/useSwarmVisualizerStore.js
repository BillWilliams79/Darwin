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
            sidewalkOn: false,

            setViewType: (viewType) => set({ viewType }),
            setCurrentDate: (currentDate) => set({ currentDate }),
            setVizKey: (vizKey) => set({ vizKey }),
            setBeadWindow: (beadWindow) => set({ beadWindow }),
            setSidewalkOn: (on) => set({ sidewalkOn: !!on }),
        }),
        {
            name: 'darwin_swarm_visualizer',
            version: 1,
        }
    )
);
