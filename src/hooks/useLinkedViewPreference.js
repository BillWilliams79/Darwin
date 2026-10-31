import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useViewPreference } from './useViewPreference';

// `useViewPreference` plus a `?view=<value>` deep link (req #4107 — so a link,
// and the dev server, can open /swarm/swarm-starts or /swarm/swarm-completes
// on its Stats view). The R9 contract of `memory/view-switchable-pages.md`,
// whose `/swarm` instance is `SwarmView/useSwarmViewSelection.js`:
//  - the link is a TRANSIENT override, validated against `views` and never
//    written to the persisted preference;
//  - it is re-seeded when the LINK changes, so navigating in place between the
//    bare route and `?view=` (sidebar link, Back/Forward) follows the URL;
//  - a manual pick clears it and persists, as before.
export function useLinkedViewPreference(key, defaultValue, views) {
    const [storedView, setStoredView] = useViewPreference(key, defaultValue);
    const [searchParams] = useSearchParams();
    const requested = searchParams.get('view');
    const linkView = views.includes(requested) ? requested : null;

    // `linkView` is a primitive: a manual pick changes no query param, so the
    // effect does not re-fire and re-impose the link it just cleared.
    const [override, setOverride] = useState(linkView);
    useEffect(() => { setOverride(linkView); }, [linkView]);

    const setView = useCallback((newView) => {
        if (newView === null || newView === undefined) return;
        setOverride(null);
        setStoredView(newView);
    }, [setStoredView]);

    const view = override || (views.includes(storedView) ? storedView : defaultValue);
    return [view, setView];
}
