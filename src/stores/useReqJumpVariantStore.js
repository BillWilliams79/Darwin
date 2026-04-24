/* UI-OPTION: req #2409 — remove this file after variant is chosen */
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

export const useReqJumpVariantStore = create(
    persist(
        (set) => ({
            variant: 'A',
            setVariant: (variant) => set({ variant }),
        }),
        {
            name: 'darwin-req-jump-variant',
            storage: createJSONStorage(() => localStorage),
        }
    )
);
