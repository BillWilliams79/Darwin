import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

// Shared filter state across /swarm/testcases, /swarm/testplans, /swarm/testruns
// (req #2380; the retired middle tier's browsable catalog page these once
// also served was retired by req #3357).
// Category chip selection applies consistently across the test catalog.
//
// Null means "no filter".
//   categoryFilter: null | <category id>  (null = all categories)
//
// `statusFilter`/`coverageFilter` (enums scoped to that retired tier alone)
// were retired with its browsable catalog page — req #3357 item 2.

export const useTestCatalogFilterStore = create(
    persist(
        (set) => ({
            categoryFilter: null,
            setCategoryFilter: (categoryId) => set({ categoryFilter: categoryId }),
            reset: () => set({ categoryFilter: null }),
        }),
        {
            name: 'darwin-swarm-testcatalog-filter',
            storage: createJSONStorage(() => localStorage),
        }
    )
);
