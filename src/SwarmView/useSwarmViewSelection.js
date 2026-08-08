import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useViewPreference } from '../hooks/useViewPreference';
import { normalizeView } from '../Components/ViewerHeader/normalizeView';
import { SWARM_VIEWS, SWARM_VIEW_STORAGE_KEY, DEFAULT_SWARM_VIEW, readViewParam } from './swarmViewLink';

// `normalizeView`'s shape. Every entry is enabled — `/swarm` has no not-yet-built
// view, so V1's disabled-button case does not arise here.
const VIEW_ENTRIES = SWARM_VIEWS.map(value => ({ value }));

/**
 * Which panel `/swarm` shows, and the three ways it can change (req #3302).
 *
 * ITS OWN MODULE because the rules below are STATEFUL, and a stateful rule that
 * lives inside a 900-line page component is a rule no test can reach — the
 * `instructionSort.js` lesson, and req #3246's "prose an LLM must interpret is
 * not a mechanism" applied to a component. `SwarmView` needs a Router, both
 * Contexts, a QueryClient and a DnD provider to mount; this hook needs a Router.
 *
 * The contract is R9's (`memory/view-switchable-pages.md`), whose reference
 * instance is `PipelineDetail.jsx`'s `?mode=`:
 *
 *  - `?view=` is a TRANSIENT OVERRIDE and is NEVER written to the persisted
 *    preference. A link asks to see one thing once; it must not redefine the
 *    reader's default.
 *  - A MANUAL PICK clears the override and persists, so the link goes inert from
 *    that moment even though the query string is still in the address bar.
 *  - A CROSS-VIEW HANDSHAKE (`showTransiently`) sets the override and persists
 *    NOTHING. Drilling from a chart bar into the table is not a request to make
 *    Table the default in every tab forever.
 *  - The param is VALIDATED, never trusted, and so is the STORED value: both can
 *    name a view this page does not have, and an unmatched ToggleButtonGroup
 *    value selects nothing while every `view === '…'` branch goes false — a
 *    header row over an empty body, with no error.
 *
 * @returns {{view: string, setView: (v: string|null) => void,
 *            showTransiently: (v: string) => void, linkView: string|null}}
 */
export function useSwarmViewSelection() {
    const [storedView, setStoredView] = useViewPreference(SWARM_VIEW_STORAGE_KEY, DEFAULT_SWARM_VIEW);
    const [searchParams] = useSearchParams();
    const linkView = readViewParam(searchParams);

    // Re-seeded when the LINK changes, exactly as `PipelineDetail` re-seeds on a
    // new link or record id: navigating in place from one `?view=` to another must
    // not be answered by the previous link's already-cleared override. `linkView`
    // is a primitive, so a manual pick — which changes no query param — leaves the
    // dependency identical and the effect does not re-fire against it.
    const [override, setOverride] = useState(linkView);
    useEffect(() => { setOverride(linkView); }, [linkView]);

    const view = normalizeView(override || storedView, VIEW_ENTRIES);

    const setView = useCallback((newView) => {
        // The hook's own null-guard would cover the stored write, but not the
        // override: an exclusive ToggleButtonGroup sends `null` when the
        // already-selected button is clicked, and clearing the override there
        // would drop the reader from the linked view back to their stored one on
        // a click that means "no change" (§ G pitfall 6, from the other side).
        if (newView === null || newView === undefined) return;
        setOverride(null);
        setStoredView(newView);
    }, [setStoredView]);

    const showTransiently = useCallback((newView) => {
        if (!SWARM_VIEWS.includes(newView)) return;
        setOverride(newView);
    }, []);

    return { view, setView, showTransiently, linkView };
}

export default useSwarmViewSelection;
