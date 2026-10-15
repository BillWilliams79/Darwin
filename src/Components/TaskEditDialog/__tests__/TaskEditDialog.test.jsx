// @vitest-environment jsdom
//
// Req #3525 — the calendar's Edit Task dialog must show the LIVE task row.
//
// taskEditInfo.task is a snapshot taken when the dialog opens. Since req #2747
// useCrudCallbacks.fieldChange updates the tasks array immutably, so the snapshot
// no longer follows typing: the controlled description input snapped back to the
// old text on every keystroke (cursor jumped to the end, edits discarded).

import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';

vi.mock('../../TaskEdit/TaskEdit', () => ({
    default: ({ task, taskIndex }) => (
        <div data-testid="edit" data-index={taskIndex}>{task.description}</div>
    ),
}));
vi.mock('../../TaskDeleteDialog/TaskDeleteDialog', () => ({ default: () => null }));

import TaskEditDialog from '../TaskEditDialog';
import { TaskActionsContext } from '../../../hooks/useTaskActions';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const render = (root, tasksArray, taskEditInfo) => act(() => {
    root.render(
        <TaskActionsContext.Provider value={{ tasksArray }}>
            <TaskEditDialog taskEditDialogOpen setTaskEditDialogOpen={() => {}}
                            taskEditInfo={taskEditInfo} setTaskEditInfo={() => {}} />
        </TaskActionsContext.Provider>
    );
});

describe('TaskEditDialog — live task (req #3525)', () => {
    it('shows the edited row from tasksArray, not the open-time snapshot', () => {
        const container = document.createElement('div');
        document.body.appendChild(container);
        const root = createRoot(container);

        const snapshot = { id: 5, description: 'before' };
        const info = { task: snapshot, taskIndex: 1 };

        render(root, [{ id: 4, description: 'x' }, snapshot], info);
        expect(document.querySelector('[data-testid="edit"]').textContent).toBe('before');

        // immutable edit, as useCrudCallbacks.fieldChange does
        render(root, [{ id: 4, description: 'x' }, { ...snapshot, description: 'before!' }], info);
        const el = document.querySelector('[data-testid="edit"]');
        expect(el.textContent).toBe('before!');
        expect(el.dataset.index).toBe('1');

        act(() => root.unmount());
        container.remove();
    });

    it('renders no editor when the row is no longer in tasksArray (stale index would hit another row)', () => {
        const container = document.createElement('div');
        document.body.appendChild(container);
        const root = createRoot(container);
        render(root, [{ id: 1, description: 'other' }], { task: { id: 9, description: 'gone' }, taskIndex: 0 });
        expect(document.querySelector('[data-testid="edit"]')).toBeNull();
        act(() => root.unmount());
        container.remove();
    });
});
