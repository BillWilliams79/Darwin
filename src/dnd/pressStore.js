// pressStore.js — which item is being pressed toward a lift (req #3662).
//
// A store, not context: each item subscribes to "am I the pressed one?", so a
// press re-renders the one item being pressed and nothing else.

import { create } from 'zustand';

export const usePressStore = create((set, get) => ({
    pressedId: null,
    press: (id) => { if (get().pressedId !== id) set({ pressedId: id }); },
    release: () => { if (get().pressedId !== null) set({ pressedId: null }); },
}));
