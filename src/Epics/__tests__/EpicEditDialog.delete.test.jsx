// @vitest-environment jsdom
//
// Req #3867 — the epic editor's Delete: offered only when the caller passes
// `deletion`, confirmed inline with the consequence spelled out, and disabled
// with the reason when a lock would refuse it.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';

const deleteEpicFreeingDependents = vi.fn(() => Promise.resolve());
vi.mock('../epicsApi', async (orig) => ({
    ...(await orig()),
    deleteEpicFreeingDependents: (...a) => deleteEpicFreeingDependents(...a),
}));
const showError = vi.fn();
vi.mock('../../stores/useSnackBarStore', () => ({
    useSnackBarStore: (sel) => sel({ showError }),
}));

import EpicEditDialog, { deleteConsequence } from '../EpicEditDialog';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let root;
afterEach(() => {
    if (root) act(() => { root.unmount(); });
    root = null;
    document.body.innerHTML = '';
    deleteEpicFreeingDependents.mockClear();
    showError.mockClear();
});

const EPIC = { id: 5, initiative_fk: 2, title: 'Drain', run: 'auto', locked: false };
const DELETION = { reqCount: 2, dependents: [{ id: 7, locked: false }] };

function render(props) {
    const onSaved = vi.fn(() => Promise.resolve());
    const onClose = vi.fn();
    const container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
        root.render(<EpicEditDialog open epic={EPIC} initiativeOptions={[{ id: 2, title: 'I' }]}
                                    onClose={onClose} onSaved={onSaved} {...props} />);
    });
    return { onSaved, onClose };
}
const q = (id) => document.querySelector(`[data-testid="${id}"]`);

describe('EpicEditDialog delete (req #3867)', () => {
    it('is not offered without `deletion`', () => {
        render({});
        expect(q('epic-delete')).toBeNull();
    });

    it('is not offered when creating', () => {
        render({ epic: null, deletion: DELETION });
        expect(q('epic-delete')).toBeNull();
    });

    it('confirms with the consequence, then deletes, re-reads and closes', async () => {
        const { onSaved, onClose } = render({ deletion: DELETION });
        act(() => { q('epic-delete').click(); });
        expect(q('epic-delete-consequence').textContent).toBe(
            'Delete epic 5 "Drain"? This cannot be undone. Its 2 requirements become '
            + 'un-orchestrated — the requirements themselves are not deleted. Epic 7 waits on it '
            + 'and will be freed of that dependency.');
        act(() => { q('epic-delete-confirm').click(); });
        await act(async () => { await Promise.resolve(); await Promise.resolve(); });
        expect(deleteEpicFreeingDependents).toHaveBeenCalledWith(undefined, undefined, 5, [7]);
        expect(onSaved).toHaveBeenCalled();
        expect(onClose).toHaveBeenCalled();
    });

    it('Keep epic backs out without writing', () => {
        render({ deletion: DELETION });
        act(() => { q('epic-delete').click(); });
        act(() => { q('epic-delete-keep').click(); });
        expect(q('epic-delete-consequence')).toBeNull();
        expect(q('epic-save')).not.toBeNull();
        expect(deleteEpicFreeingDependents).not.toHaveBeenCalled();
    });

    it('a failed delete reports, re-reads and keeps the editor open', async () => {
        deleteEpicFreeingDependents.mockImplementationOnce(() => Promise.reject(new Error('409')));
        const { onSaved, onClose } = render({ deletion: DELETION });
        act(() => { q('epic-delete').click(); });
        act(() => { q('epic-delete-confirm').click(); });
        await act(async () => { await Promise.resolve(); await Promise.resolve(); });
        expect(showError).toHaveBeenCalledWith(expect.any(Error), 'Could not delete epic');
        expect(onSaved).toHaveBeenCalled();
        expect(onClose).not.toHaveBeenCalled();
    });

    it('is disabled, with the reason, for a locked epic', () => {
        render({ epic: { ...EPIC, locked: true }, deletion: DELETION });
        expect(q('epic-delete').disabled).toBe(true);
        expect(q('epic-delete').getAttribute('aria-label')).toMatch(/Locked/);
    });

    it('is disabled when an epic waiting on it is locked', () => {
        render({ deletion: { ...DELETION, dependents: [{ id: 7, locked: true }] } });
        expect(q('epic-delete').disabled).toBe(true);
        expect(q('epic-delete').getAttribute('aria-label')).toBe(
            'Epic 7 waits on it and is locked — unlock to delete this epic.');
    });

    it('is disabled when its initiative holds the lock', () => {
        render({ epic: { ...EPIC, locked: true, lockedBy: 'initiative' }, deletion: DELETION });
        expect(q('epic-delete').getAttribute('aria-label')).toMatch(/Locked by its initiative/);
    });
});

describe('deleteConsequence', () => {
    it('names every dependent freed, and says nothing of requirements it does not hold', () => {
        expect(deleteConsequence({ id: 5, title: 'T' },
            { reqCount: 0, dependents: [{ id: 7 }, { id: 8 }] }))
            .toBe('Delete epic 5 "T"? This cannot be undone. Epics 7, 8 wait on it and will '
                + 'be freed of that dependency.');
    });

    it('an epic nobody waits on and holding nothing is the bare question', () => {
        expect(deleteConsequence({ id: 5, title: 'T' }, { reqCount: 0, dependents: [] }))
            .toBe('Delete epic 5 "T"? This cannot be undone.');
    });
});
