// @vitest-environment jsdom
//
// Req #3867 — the epic editor's Delete: offered only when the caller passes
// `deletion`, confirmed inline with the consequence spelled out, and disabled
// with the reason when a lock would refuse it.
// Req #3967 — the confirmation offers to delete the epic's requirements too,
// unticked by default, and only after the epic itself is gone.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';

const deleteEpicFreeingDependents = vi.fn(() => Promise.resolve());
const deleteRequirements = vi.fn(() => Promise.resolve());
vi.mock('../epicsApi', async (orig) => ({
    ...(await orig()),
    deleteEpicFreeingDependents: (...a) => deleteEpicFreeingDependents(...a),
    deleteRequirements: (...a) => deleteRequirements(...a),
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
    deleteRequirements.mockClear();
    showError.mockClear();
});

const EPIC = { id: 5, initiative_fk: 2, title: 'Drain', run: 'auto', locked: false };
const DELETION = { reqIds: [11, 12], dependents: [{ id: 7, locked: false }] };

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
            'Delete epic 5 "Drain"? This is permanent — there is no undo. Its 2 requirements are '
            + 'kept — un-orchestrated, not deleted. Epic 7 waits on it '
            + 'and will be freed of that dependency.');
        expect(q('epic-delete-requirements').checked).toBe(false);
        act(() => { q('epic-delete-confirm').click(); });
        await act(async () => { await Promise.resolve(); await Promise.resolve(); });
        expect(deleteEpicFreeingDependents).toHaveBeenCalledWith(undefined, undefined, 5, [7]);
        expect(deleteRequirements).not.toHaveBeenCalled();
        expect(onSaved).toHaveBeenCalledWith({ deleted: true, requirementsDeleted: false });
        expect(onClose).toHaveBeenCalled();
    });

    it('ticking the box deletes its requirements too — after the epic', async () => {
        const order = [];
        deleteEpicFreeingDependents.mockImplementationOnce(() => { order.push('epic'); return Promise.resolve(); });
        deleteRequirements.mockImplementationOnce(() => { order.push('reqs'); return Promise.resolve(); });
        const { onSaved, onClose } = render({ deletion: DELETION });
        act(() => { q('epic-delete').click(); });
        act(() => { q('epic-delete-requirements').click(); });
        expect(q('epic-delete-consequence').textContent).toContain(
            'Its 2 requirements (11, 12) are deleted too.');
        act(() => { q('epic-delete-confirm').click(); });
        await act(async () => { for (let i = 0; i < 4; i += 1) await Promise.resolve(); });
        expect(deleteRequirements).toHaveBeenCalledWith(undefined, undefined, [11, 12]);
        expect(order).toEqual(['epic', 'reqs']);
        expect(onSaved).toHaveBeenCalledWith({ deleted: true, requirementsDeleted: true });
        expect(onClose).toHaveBeenCalled();
    });

    it('a refused epic delete never touches its requirements', async () => {
        deleteEpicFreeingDependents.mockImplementationOnce(() => Promise.reject(new Error('423')));
        const { onClose } = render({ deletion: DELETION });
        act(() => { q('epic-delete').click(); });
        act(() => { q('epic-delete-requirements').click(); });
        act(() => { q('epic-delete-confirm').click(); });
        await act(async () => { for (let i = 0; i < 4; i += 1) await Promise.resolve(); });
        expect(deleteRequirements).not.toHaveBeenCalled();
        expect(showError).toHaveBeenCalledWith(expect.any(Error), 'Could not delete epic');
        expect(onClose).not.toHaveBeenCalled();
    });

    it('a failed requirement delete says the epic is gone, and closes', async () => {
        deleteRequirements.mockImplementationOnce(() => Promise.reject(new Error('500')));
        const { onClose } = render({ deletion: DELETION });
        act(() => { q('epic-delete').click(); });
        act(() => { q('epic-delete-requirements').click(); });
        act(() => { q('epic-delete-confirm').click(); });
        await act(async () => { for (let i = 0; i < 4; i += 1) await Promise.resolve(); });
        expect(showError).toHaveBeenCalledWith(expect.any(Error),
            'Epic 5 was deleted, but its requirements could not be');
        expect(onClose).toHaveBeenCalled();
    });

    it('offers no requirement box for an epic holding none', () => {
        render({ deletion: { reqIds: [], dependents: [] } });
        act(() => { q('epic-delete').click(); });
        expect(q('epic-delete-requirements')).toBeNull();
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
            .toBe('Delete epic 5 "T"? This is permanent — there is no undo. Epics 7, 8 wait on it and will '
                + 'be freed of that dependency.');
    });

    it('an epic nobody waits on and holding nothing is the bare question', () => {
        expect(deleteConsequence({ id: 5, title: 'T' }, { reqCount: 0, dependents: [] }))
            .toBe('Delete epic 5 "T"? This is permanent — there is no undo.');
    });

    it('states the requirement count whether they go or stay', () => {
        const d = { reqIds: [3], dependents: [] };
        expect(deleteConsequence({ id: 5, title: 'T' }, d, false)).toBe('Delete epic 5 "T"? '
            + 'This is permanent — there is no undo. Its 1 requirement is kept — un-orchestrated, not deleted.');
        expect(deleteConsequence({ id: 5, title: 'T' }, d, true)).toBe('Delete epic 5 "T"? '
            + 'This is permanent — there is no undo. Its 1 requirement (3) is deleted too.');
    });
});
