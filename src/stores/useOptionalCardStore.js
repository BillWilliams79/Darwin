import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// Unified store for optional per-domain cards in TaskPlanView.
// Each card type has its own settings object under the domain key.
// priority: { show: bool, sortMode: 'hand' | 'created' }
//
// To add a new domain-scoped optional card: add a type, toggle call, and render in AreaTabPanel.
// For global optional cards (not domain-scoped), use a dedicated store (e.g. useSwarmStartCardStore).

const DEFAULT_PRIORITY = { show: false, sortMode: 'hand' };

export const useOptionalCardStore = create(
    persist(
        (set, get) => ({
            cards: {},

            toggleCard: (domainId, type) => {
                const key = String(domainId);
                const current = get().cards[key] || {};
                const cardCurrent = current[type] || DEFAULT_PRIORITY;
                set({
                    cards: {
                        ...get().cards,
                        [key]: {
                            ...current,
                            [type]: { ...cardCurrent, show: !cardCurrent.show },
                        },
                    },
                });
            },

            setSortMode: (domainId, mode) => {
                const key = String(domainId);
                const current = get().cards[key] || {};
                const priority = current.priority || DEFAULT_PRIORITY;
                set({
                    cards: {
                        ...get().cards,
                        [key]: {
                            ...current,
                            priority: { ...priority, sortMode: mode },
                        },
                    },
                });
            },
        }),
        {
            name: 'darwin_optional_cards',
            // Note: new key (was 'darwin_priority_card') — existing priority card show/sortMode
            // states are not migrated (minor: users re-click the toggle). darwin_priority_card
            // entry in localStorage is orphaned and can be cleared manually.
        }
    )
);
