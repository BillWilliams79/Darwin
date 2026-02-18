import { create } from 'zustand';
import { persist } from 'zustand/middleware';

const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;

export const useWorkingDomainStore = create(
    persist(
        (set, get) => ({
            domainId: null,
            timestamp: null,

            setWorkingDomain: (id) => {
                if (id == null) return;
                set({ domainId: String(id), timestamp: Date.now() });
            },

            getWorkingDomain: () => {
                const { domainId, timestamp } = get();
                if (!domainId || !timestamp) return null;
                if (Date.now() - timestamp > NINETY_DAYS_MS) {
                    set({ domainId: null, timestamp: null });
                    return null;
                }
                return domainId;
            },

            clearWorkingDomain: () => set({ domainId: null, timestamp: null }),
        }),
        {
            name: 'darwin_working_domain',
        }
    )
);
