import { create } from 'zustand';

/**
 * Global scan store — shared between RouteCard buttons, PhotoSettingsView, and PhotoBrowser.
 * Not persisted (FileSystemDirectoryHandle is not serializable).
 */
const useScanStore = create((set) => ({
    dirHandle: null,
    folderName: '',
    index: [],
    scanState: 'idle',      // 'idle' | 'scanning' | 'complete' | 'error'
    scanProgress: { scanned: 0 },
    scanElapsed: 0,         // seconds since scan started
    scanError: null,
    scanDiag: '',           // diagnostic log lines for debugging
    selectedPaths: new Set(),

    setDirHandle: (handle, name = '') => set({ dirHandle: handle, folderName: name }),
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
