import { useState, useCallback } from 'react';

// View selection persisted per-tab (sessionStorage) with a cross-tab default
// fallback (localStorage) for newly opened tabs. See memory/view-switchable-pages.md
// § "Per-tab view memory" for the rationale (req #2651).
export function useViewPreference(key, defaultValue) {
    const [view, setView] = useState(() => {
        try {
            const tabView = sessionStorage.getItem(key);
            if (tabView !== null) return tabView;
            const fallback = localStorage.getItem(key) || defaultValue;
            sessionStorage.setItem(key, fallback);
            return fallback;
        } catch {
            return defaultValue;
        }
    });

    const changeView = useCallback((newView) => {
        if (newView === null || newView === undefined) return;
        setView((prev) => {
            if (newView === prev) return prev;
            try {
                sessionStorage.setItem(key, newView);
                localStorage.setItem(key, newView);
            } catch {
                // Safari private mode / quota exceeded — in-memory state still updates.
            }
            return newView;
        });
    }, [key]);

    return [view, changeView];
}
