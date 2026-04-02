import { create } from 'zustand';

/**
 * Global scan store — shared between PhotoSettingsView and PhotoBrowser.
 * Not persisted (refreshes reset state to idle).
 */
const useScanStore = create((set) => ({
    index: [],
    scanState: 'idle',      // 'idle' | 'scanning' | 'complete' | 'error'
    scanProgress: { scanned: 0 },
    scanElapsed: 0,         // seconds since scan started
    scanError: null,
    scanDiag: '',           // diagnostic log lines for debugging
    selectedPaths: new Set(),

    setIndex: (index) => set({ index }),
    setScanState: (scanState) => set({ scanState }),
    setScanProgress: (scanProgress) => set({ scanProgress }),
    setScanElapsed: (scanElapsed) => set({ scanElapsed }),
    setScanError: (scanError) => set({ scanError }),
    appendDiag: (line) => set((s) => ({ scanDiag: s.scanDiag + line + '\n' })),
    clearDiag: () => set({ scanDiag: '' }),

    toggleSelection: (path) => set((state) => {
        const next = new Set(state.selectedPaths);
        if (next.has(path)) {
            next.delete(path);
        } else {
            next.add(path);
        }
        return { selectedPaths: next };
    }),

    clearSelection: () => set({ selectedPaths: new Set() }),

    selectAll: (paths) => set({ selectedPaths: new Set(paths) }),
}));

export default useScanStore;
