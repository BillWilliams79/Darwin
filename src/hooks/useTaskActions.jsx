import { createContext, useContext, useMemo, useRef } from 'react';

export const TaskActionsContext = createContext(null);
export const useTaskActions = () => useContext(TaskActionsContext);

const HANDLERS = ['priorityClick', 'doneClick', 'descriptionChange', 'descriptionKeyDown',
                  'descriptionOnBlur', 'deleteClick'];

/**
 * A TaskActionsContext value whose identity changes only when the DATA does
 * (req #3662). A card's handlers are new closures every render, and a card
 * re-renders on every pointer move of a drag (its own sortable hook reads
 * dnd-kit's context); handing the rows a fresh context object each time
 * re-rendered every row — and every row's auto-sizing text field measures its
 * own layout when it renders. The handlers here forward to the latest ones
 * through a ref, so they are never stale and never change identity.
 */
export function useStableTaskActions(actions) {
    const latest = useRef(actions);
    latest.current = actions;
    const forwarders = useMemo(() => Object.fromEntries(HANDLERS.map(name =>
        [name, (...args) => latest.current[name]?.(...args)])), []);
    const { tasksArray, setTasksArray, sortMode, disableStrikethrough } = actions;
    return useMemo(() => ({ ...forwarders, tasksArray, setTasksArray, sortMode, disableStrikethrough }),
        [forwarders, tasksArray, setTasksArray, sortMode, disableStrikethrough]);
}
