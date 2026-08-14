import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// req #3506 — the Tasks page's "Closed" title option.
//
// `closedWindow` names how far back closed (done) tasks are pulled into the
// area cards: '1h', '24h', 'all', or `null` for the default OFF state, which is
// the behaviour the page had before this option existed — open tasks only.
//
// GLOBAL, not per-domain, deliberately. The priority card is per-domain because
// it is a card that belongs to a domain; this is a lens on how the whole page
// reads, and a lens that changed meaning as you moved between domain tabs would
// be a surprise rather than a feature.
//
// The window is a NAME here, never a resolved timestamp pair. "Closed in the
// last hour" has to mean the hour before you look at it, so the bounds are
// computed at fetch time (`useTasksClosed`) from `closedWindowRange` — storing
// them would freeze the window at whatever moment the button was pressed.
export const CLOSED_WINDOW_OFF = null;

export const useClosedTasksStore = create(
    persist(
        (set) => ({
            closedWindow: CLOSED_WINDOW_OFF,

            // MUI's exclusive ToggleButtonGroup sends `null` when the selected
            // button is clicked again, so passing its onChange value straight
            // through is what makes clicking the active button turn the option
            // off. Callers never need a separate "clear" action.
            setClosedWindow: (closedWindow) => set({ closedWindow: closedWindow ?? CLOSED_WINDOW_OFF }),
        }),
        {
            name: 'darwin_closed_tasks',
            version: 1,
        }
    )
);

export default useClosedTasksStore;
