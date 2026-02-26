import { create } from 'zustand';
import { persist } from 'zustand/middleware';

const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;

export const useWorkingProjectStore = create(
    persist(
        (set, get) => ({
            projectId: null,
            timestamp: null,

            setWorkingProject: (id) => {
                if (id == null) return;
                set({ projectId: String(id), timestamp: Date.now() });
            },

            getWorkingProject: () => {
                const { projectId, timestamp } = get();
                if (!projectId || !timestamp) return null;
                if (Date.now() - timestamp > NINETY_DAYS_MS) {
                    set({ projectId: null, timestamp: null });
                    return null;
                }
                return projectId;
            },

            clearWorkingProject: () => set({ projectId: null, timestamp: null }),
        }),
        {
            name: 'darwin_working_project',
        }
    )
);
