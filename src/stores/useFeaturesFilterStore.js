import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

// Shared filter state across /swarm/features, /swarm/testcases, /swarm/testplans,
// /swarm/testruns (req #2380). Category chip selection and coverage/status filters
// apply consistently to every page in the Features & Test Cases flow.
//
// Null / 'all' means "no filter" for the corresponding field.
//   categoryFilter: null | <category id>  (null = all categories)
//   statusFilter:   'all' | 'draft' | 'active' | 'deprecated'  (features only)
//   coverageFilter: 'all' | 'covered' | 'uncovered'            (features only)

export const useFeaturesFilterStore = create(
    persist(
        (set) => ({
            categoryFilter: null,
            statusFilter: 'all',
            coverageFilter: 'all',
            setCategoryFilter: (categoryId) => set({ categoryFilter: categoryId }),
            setStatusFilter: (status) => set({ statusFilter: status }),
            setCoverageFilter: (coverage) => set({ coverageFilter: coverage }),
            reset: () => set({ categoryFilter: null, statusFilter: 'all', coverageFilter: 'all' }),
        }),
        {
            name: 'darwin-swarm-features-filter',
            storage: createJSONStorage(() => localStorage),
        }
    )
);
