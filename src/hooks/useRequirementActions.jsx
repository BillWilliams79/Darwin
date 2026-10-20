import { createContext, useContext, useMemo, useRef } from 'react';

export const RequirementActionsContext = createContext(null);
export const useRequirementActions = () => useContext(RequirementActionsContext);

const HANDLERS = ['statusClick', 'coordinationClick', 'titleChange', 'titleKeyDown',
                  'titleOnBlur', 'deleteClick'];

/**
 * A RequirementActionsContext value whose identity changes only when the DATA
 * does (req #3663, the requirement rows' copy of `useStableTaskActions`). A
 * card's handlers are new closures every render, and a card re-renders on
 * every pointer move of a drag (its own sortable hook reads dnd-kit's
 * context); a fresh context object each time would re-render every row — and
 * every row's auto-sizing title field measures its layout when it renders. The
 * handlers forward to the latest ones through a ref, so they are never stale
 * and never change identity.
 */
export function useStableRequirementActions(actions) {
    const latest = useRef(actions);
    latest.current = actions;
    const forwarders = useMemo(() => Object.fromEntries(HANDLERS.map(name =>
        [name, (...args) => latest.current[name]?.(...args)])), []);
    const { requirementsArray, setRequirementsArray, sessionStatusMap, categoryColorMap,
        orchestratedIds, strikethroughMet } = actions;
    return useMemo(() => ({
        ...forwarders, requirementsArray, setRequirementsArray, sessionStatusMap, categoryColorMap,
        orchestratedIds, ...(strikethroughMet === undefined ? {} : { strikethroughMet }),
    }), [forwarders, requirementsArray, setRequirementsArray, sessionStatusMap, categoryColorMap,
        orchestratedIds, strikethroughMet]);
}
