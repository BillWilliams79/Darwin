import { create } from 'zustand';

export const useSwarmTabStore = create((set, get) => ({
    activeTab: 0,
    preDragTab: null,
    switchBlocked: false,

    setActiveTab: (tab) => set({ activeTab: tab }),

    onDragTabSwitch: (projectIndex) => {
        if (get().switchBlocked) return;
        set(state => ({
            activeTab: projectIndex,
            preDragTab: state.preDragTab === null ? state.activeTab : state.preDragTab,
        }));
    },

    revertDragTabSwitch: () => {
        const { preDragTab } = get();
        set({
            switchBlocked: true,
            activeTab: preDragTab !== null ? preDragTab : get().activeTab,
            preDragTab: null,
        });
        requestAnimationFrame(() => { set({ switchBlocked: false }); });
    },

    clearDragTabSwitch: () => {
        set({ switchBlocked: true, preDragTab: null });
        requestAnimationFrame(() => { set({ switchBlocked: false }); });
    },
}));
