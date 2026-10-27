// @vitest-environment jsdom
//
// Req #3967 — the initiative editor's Delete: it reads what the delete touches,
// then confirms with every count and three choices — epics deleted by default
// (or moved), requirements kept by default — and says the delete is permanent.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const PLANNED = {
    initiative: { id: 40, title: 'Doomed', pipeline_fk: 7, locked: 0 },
    epics: [{ id: 500, title: 'A' }, { id: 501, title: 'B' }],
    reqIds: [9001, 9002, 9003],
    epicEdges: [{ id: 12, epic_fk: 600, dep_epic_fk: 501 }],
    outsideDependents: [600],
    waitingEdges: [{ id: 3, initiative_fk: 42, dep_initiative_fk: 40 }],
    moveTargets: [{ id: 41, title: 'Keeper' }],
    blocked: null,
};
let planned = PLANNED;
const planInitiativeDelete = vi.fn(() => Promise.resolve(planned));
const deleteInitiativeWithOptions = vi.fn(() => Promise.resolve({}));
vi.mock('../initiativesApi', async (orig) => ({
    ...(await orig()),
    planInitiativeDelete: (...a) => planInitiativeDelete(...a),
    deleteInitiativeWithOptions: (...a) => deleteInitiativeWithOptions(...a),
}));
vi.mock('../../hooks/useDataQueries', async (orig) => ({
    ...(await orig()),
    useAllCategories: () => ({ data: [{ id: 1, category_name: 'Cat', closed: 0 }] }),
}));
const showError = vi.fn();
vi.mock('../../stores/useSnackBarStore', () => ({
    useSnackBarStore: (sel) => sel({ showError }),
}));

import InitiativeEditDialog, { initiativeDeleteConsequence } from '../InitiativeEditDialog';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let root;
afterEach(() => {
    if (root) act(() => { root.unmount(); });
    root = null;
    document.body.innerHTML = '';
    planned = PLANNED;
    planInitiativeDelete.mockClear();
    deleteInitiativeWithOptions.mockClear();
    showError.mockClear();
});

const INITIATIVE = { id: 40, title: 'Doomed', pipeline_fk: 7, category_fk: 1, initiative_status: 'active' };

function render(props = {}) {
    const onSaved = vi.fn(() => Promise.resolve());
    const onClose = vi.fn();
    const container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
        root.render(
            <QueryClientProvider client={new QueryClient()}>
                <InitiativeEditDialog open initiative={INITIATIVE}
                                      pipelineOptions={[{ id: 7, title: 'Plan' }]}
                                      onClose={onClose} onSaved={onSaved} {...props} />
            </QueryClientProvider>);
    });
    return { onSaved, onClose };
}
const q = (id) => document.querySelector(`[data-testid="${id}"]`);
const flush = () => act(async () => { for (let i = 0; i < 6; i += 1) await Promise.resolve(); });

describe('InitiativeEditDialog delete (req #3967)', () => {
    it('is not offered when creating', () => {
        render({ initiative: null });
        expect(q('initiative-delete')).toBeNull();
    });

    it('reads the plan, then shows every count with the defaults: epics go, requirements stay', async () => {
        render();
        act(() => { q('initiative-delete').click(); });
        await flush();
        expect(planInitiativeDelete).toHaveBeenCalledWith(undefined, undefined, 40);
        expect(q('initiative-delete-epics').checked).toBe(true);
        expect(q('initiative-delete-requirements').checked).toBe(false);
        expect(q('initiative-delete-consequence').textContent).toBe(
            'Delete initiative 40 "Doomed"? This is permanent — there is no undo.'
            + 'Epics: 2 epics deleted (500, 501).'
            + 'Requirements: 3 requirements kept — un-orchestrated, not deleted.'
            + 'Dependencies detached: epic 600 outside it stops waiting on its epics; '
            + 'initiative 42 stops waiting on it.');
        expect(q('initiative-save')).toBeNull();
    });

    it('confirms with the default choices', async () => {
        const { onSaved, onClose } = render();
        act(() => { q('initiative-delete').click(); });
        await flush();
        act(() => { q('initiative-delete-confirm').click(); });
        await flush();
        expect(deleteInitiativeWithOptions).toHaveBeenCalledWith(undefined, undefined, PLANNED,
            { deleteEpics: true, moveToInitiativeFk: null, deleteRequirements: false });
        expect(onSaved).toHaveBeenCalled();
        expect(onClose).toHaveBeenCalled();
    });

    it('unticking epics moves them to the chosen initiative; ticking requirements deletes them', async () => {
        render();
        act(() => { q('initiative-delete').click(); });
        await flush();
        act(() => { q('initiative-delete-epics').click(); });
        act(() => { q('initiative-delete-requirements').click(); });
        expect(q('initiative-delete-move-target')).not.toBeNull();
        expect(q('initiative-delete-consequence').textContent).toContain(
            'Epics: 2 epics kept (500, 501) — moved to "Keeper" with their dependencies.');
        expect(q('initiative-delete-consequence').textContent).toContain(
            'Requirements: 3 requirements deleted (9001, 9002, 9003).');
        act(() => { q('initiative-delete-confirm').click(); });
        await flush();
        expect(deleteInitiativeWithOptions).toHaveBeenCalledWith(undefined, undefined, PLANNED,
            { deleteEpics: false, moveToInitiativeFk: 41, deleteRequirements: true });
    });

    it('cannot keep epics with nowhere to move them', async () => {
        planned = { ...PLANNED, moveTargets: [] };
        render();
        act(() => { q('initiative-delete').click(); });
        await flush();
        expect(q('initiative-delete-epics').checked).toBe(true);
        expect(q('initiative-delete-epics').disabled).toBe(true);
    });

    it('a blocked delete names the lock and cannot be confirmed', async () => {
        planned = { ...PLANNED, blocked: 'Locked — unlock it to delete it.' };
        render();
        act(() => { q('initiative-delete').click(); });
        await flush();
        expect(q('initiative-delete-blocked').textContent).toBe('Locked — unlock it to delete it.');
        expect(q('initiative-delete-confirm').disabled).toBe(true);
    });

    it('a lock that only blocks deleting the epics lifts when they are kept', async () => {
        planned = { ...PLANNED, blockedDeletingEpics: 'Epic 600 waits on its epics and is locked.' };
        render();
        act(() => { q('initiative-delete').click(); });
        await flush();
        expect(q('initiative-delete-confirm').disabled).toBe(true);
        act(() => { q('initiative-delete-epics').click(); });
        expect(q('initiative-delete-blocked')).toBeNull();
        expect(q('initiative-delete-confirm').disabled).toBe(false);
    });

    it('a target that would loop is offered disabled, and not chosen by default', async () => {
        planned = { ...PLANNED, moveTargets: [{ id: 41, title: 'Keeper', cycle: true },
            { id: 42, title: 'Waiter', cycle: false }] };
        render();
        act(() => { q('initiative-delete').click(); });
        await flush();
        act(() => { q('initiative-delete-epics').click(); });
        expect(q('initiative-delete-consequence').textContent).toContain('moved to "Waiter"');
    });

    it('Keep initiative backs out without writing', async () => {
        render();
        act(() => { q('initiative-delete').click(); });
        await flush();
        act(() => { q('initiative-delete-keep').click(); });
        expect(q('initiative-delete-panel')).toBeNull();
        expect(q('initiative-save')).not.toBeNull();
        expect(deleteInitiativeWithOptions).not.toHaveBeenCalled();
    });

    it('a failed delete reports, re-reads and keeps the editor open', async () => {
        deleteInitiativeWithOptions.mockImplementationOnce(() => Promise.reject(new Error('boom')));
        const { onSaved, onClose } = render();
        act(() => { q('initiative-delete').click(); });
        await flush();
        act(() => { q('initiative-delete-confirm').click(); });
        await flush();
        expect(showError).toHaveBeenCalledWith(expect.any(Error), 'Could not delete initiative');
        expect(onSaved).toHaveBeenCalled();
        expect(onClose).not.toHaveBeenCalled();
    });

    it('a failed requirement delete after the initiative went closes with the reason', async () => {
        const err = Object.assign(new Error('Initiative 40 was deleted, but its 3 requirements could not be: x'),
            { initiativeDeleted: true });
        deleteInitiativeWithOptions.mockImplementationOnce(() => Promise.reject(err));
        const { onClose } = render();
        act(() => { q('initiative-delete').click(); });
        await flush();
        act(() => { q('initiative-delete-confirm').click(); });
        await flush();
        expect(showError).toHaveBeenCalledWith(err.message);
        expect(onClose).toHaveBeenCalled();
    });
});

describe('initiativeDeleteConsequence', () => {
    it('an initiative holding nothing says so', () => {
        expect(initiativeDeleteConsequence({ ...PLANNED, epics: [], reqIds: [],
            outsideDependents: [], waitingEdges: [] },
        { deleteEpics: true, deleteRequirements: false })).toEqual([
            'Delete initiative 40 "Doomed"? This is permanent — there is no undo.',
            'Epics: it holds none.',
            'Requirements: its epics hold none.',
        ]);
    });

    it('kept epics keep their requirements seated and their outside dependents', () => {
        const lines = initiativeDeleteConsequence(PLANNED,
            { deleteEpics: false, moveToTitle: 'Keeper', deleteRequirements: false });
        expect(lines).toContain('Requirements: 3 requirements kept — still seated in their epics.');
        expect(lines[lines.length - 1]).toBe('Dependencies detached: initiative 42 stops waiting on it.');
    });
});
