import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export const useAppModeStore = create(
    persist(
        (set) => ({
            appMode: null,

            setAppMode: (mode) => set({ appMode: mode }),

            clearAppMode: () => set({ appMode: null }),
        }),
        {
            name: 'darwin_app_mode',
        }
    )
);
