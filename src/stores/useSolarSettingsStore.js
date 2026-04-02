import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export const useSolarSettingsStore = create(
    persist(
        (set) => ({
            ratePerKwh: 0.30,
            setRatePerKwh: (rate) => set({ ratePerKwh: rate }),
        }),
        { name: 'darwin_solar_settings' }
    )
);
