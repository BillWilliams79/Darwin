import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export const usePriorityCardStore = create(
    persist(
        (set, get) => ({
            priorityCards: {},

            togglePriorityCard: (domainId) => {
                const key = String(domainId);
                const current = get().priorityCards[key] || { show: false, sortMode: 'created' };
                set({
                    priorityCards: {
                        ...get().priorityCards,
                        [key]: { ...current, show: !current.show },
                    },
                });
            },

            setSortMode: (domainId, mode) => {
                const key = String(domainId);
                const current = get().priorityCards[key] || { show: false, sortMode: 'created' };
                set({
                    priorityCards: {
                        ...get().priorityCards,
                        [key]: { ...current, sortMode: mode },
                    },
                });
            },

            getPriorityCardState: (domainId) => {
                const key = String(domainId);
                return get().priorityCards[key] || { show: false, sortMode: 'created' };
            },
        }),
        {
            name: 'darwin_priority_card',
        }
    )
);
