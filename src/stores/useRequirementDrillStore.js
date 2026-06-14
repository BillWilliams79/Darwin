import { create } from 'zustand';

// Transient "click-to-zoom" drill filter for the Swarm Requirements views (req #2850).
//
// Clicking a bar/segment in the Trends view sets a drill describing a single time
// bucket (+ optional category); the view switches to Table, which renders a
// dismissible pill and shows only the requirements Met in that bucket. Clicking the
// pill away clears the drill. It is intentionally NOT persisted — a drill is a
// momentary zoom, not a saved preference (cf. the Maps savable views it loosely
// mirrors), so a reload returns to the unfiltered table.
//
// drill shape: { bucketKey, timeframe, label, categoryIds, categoryName, includeClosed } | null
//   - bucketKey   : aggregator bucket key, e.g. "2026-06-08" / "2026-W24" / "2026-06"
//   - timeframe   : 'day' | 'week' | 'month' (the timeframe active when clicked)
//   - label       : human label shown on the pill (e.g. "Jun 8 2026")
//   - categoryIds : array of category ids the clicked bar represented (a split
//                   segment → one id; a narrowed chip selection → that subset), or
//                   null = all visible categories in that bucket
//   - categoryName: pill label fragment — the category name (one) / "N categories"
//                   (many) / null (all)
//   - includeClosed : whether closed-category requirements were visible in the chart,
//                   so the Table reproduces the same row set when categoryIds is null
export const useRequirementDrillStore = create((set) => ({
    drill: null,
    setDrill: (drill) => set({ drill }),
    clearDrill: () => set({ drill: null }),
}));
