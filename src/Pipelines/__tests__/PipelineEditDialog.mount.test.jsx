// @vitest-environment jsdom
//
// Req #3965 — a plan's status is also written by machines while the editor is
// open (/pipeline-start, a drain, the engine switch). Saving a goal edit must
// not send back the status the dialog opened with.
//
// Req #4128 — the editor in the epic/initiative editors' form: the id in the
// heading, the Lock control (lift + edit in one PUT), Sort order, and Delete
// confirmed in the dialog.

import { describe, it, expect, vi, afterEach } from 'vitest';
import React from 'react';
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const showError = vi.hoisted(() => vi.fn());
vi.mock('../../stores/useSnackBarStore', () => ({
    useSnackBarStore: (sel) => sel({ showError, showSuccess: vi.fn() }),
}));
vi.mock('../pipelinesApi', async (orig) => ({
    ...(await orig()),
    updatePipeline: vi.fn(() => Promise.resolve()),
    deletePipeline: vi.fn(() => Promise.resolve()),
}));

import AuthContext from '../../Context/AuthContext';
import AppContext from '../../Context/AppContext';
import PipelineEditDialog from '../PipelineEditDialog';
import { updatePipeline, deletePipeline } from '../pipelinesApi';

const ROW = { id: 12, title: 'CurrentWork', description: 'Why', machine_fk: null,
    pipeline_status: 'authoring', locked: 0, sort_order: 3 };
const DELETION = { initiatives: 2, epics: 5, requirements: 9, orchestrated: false };

const ui = (pipeline, props = {}) => (
    <QueryClientProvider client={new QueryClient()}>
        <AuthContext.Provider value={{ idToken: 't', profile: { userName: 'u1' } }}>
            <AppContext.Provider value={{ darwinUri: 'https://x/darwin_dev' }}>
                <PipelineEditDialog open pipeline={pipeline} onClose={() => {}} {...props} />
            </AppContext.Provider>
        </AuthContext.Provider>
    </QueryClientProvider>
);

// A MUI Select: open its listbox from the combobox, then click the option.
const pick = (testId, value) => {
    fireEvent.mouseDown(within(screen.getByTestId(testId)).getByRole('combobox'));
    fireEvent.click(document.body.querySelector(`li[data-value="${value}"]`));
};
const save = () => fireEvent.click(screen.getByTestId('pipeline-edit-save'));

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('PipelineEditDialog status', () => {
    it('does not send the opened status back when a machine changed it meanwhile', async () => {
        const { rerender } = render(ui(ROW));
        rerender(ui({ ...ROW, pipeline_status: 'orchestrating' }));   // /pipeline-start ran
        fireEvent.change(screen.getByTestId('pipeline-edit-description'),
            { target: { value: 'A better goal' } });
        save();
        await waitFor(() => expect(updatePipeline).toHaveBeenCalledTimes(1));
        expect(updatePipeline.mock.calls[0][3]).toEqual({ description: 'A better goal' });
    });

    it('sends the status the reader picked', async () => {
        render(ui(ROW));
        pick('pipeline-edit-status', 'met');
        save();
        await waitFor(() => expect(updatePipeline).toHaveBeenCalledTimes(1));
        expect(updatePipeline.mock.calls[0][3]).toEqual({ pipeline_status: 'met' });
    });

    it('says what each status means, as the epic editor says what Run means', () => {
        render(ui(ROW));
        fireEvent.mouseDown(within(screen.getByTestId('pipeline-edit-status')).getByRole('combobox'));
        expect(screen.getByTestId('pipeline-edit-status-orchestrating').textContent)
            .toBe('Running — the only status whose epics launch');
    });
});

describe('PipelineEditDialog — the epic and initiative editors\' form (req #4128)', () => {
    it('names the plan by id in the heading, as "Edit epic 23" does', () => {
        render(ui(ROW));
        expect(screen.getByTestId('pipeline-edit-heading').textContent).toBe('Edit pipeline 12');
    });

    it('locking an unlocked plan writes locked=1 alone', async () => {
        render(ui(ROW));
        pick('pipeline-edit-locked-select', 'locked');
        save();
        await waitFor(() => expect(updatePipeline).toHaveBeenCalledTimes(1));
        expect(updatePipeline.mock.calls[0][3]).toEqual({ locked: 1 });
    });

    it('a locked plan opens read-only; unlocking edits in the same PUT', async () => {
        render(ui({ ...ROW, locked: 1 }));
        expect(screen.getByTestId('pipeline-edit-title').disabled).toBe(true);
        expect(screen.getByTestId('pipeline-edit-description').disabled).toBe(true);
        pick('pipeline-edit-locked-select', 'unlocked');
        expect(screen.getByTestId('pipeline-edit-title').disabled).toBe(false);
        fireEvent.change(screen.getByTestId('pipeline-edit-title'), { target: { value: 'Renamed' } });
        save();
        await waitFor(() => expect(updatePipeline).toHaveBeenCalledTimes(1));
        expect(updatePipeline.mock.calls[0][3]).toEqual({ title: 'Renamed', locked: 0 });
    });

    it('refuses edits made while unlocked and then re-locked, writing nothing', async () => {
        render(ui({ ...ROW, locked: 1 }));
        pick('pipeline-edit-locked-select', 'unlocked');
        fireEvent.change(screen.getByTestId('pipeline-edit-title'), { target: { value: 'Renamed' } });
        pick('pipeline-edit-locked-select', 'locked');
        save();
        await waitFor(() => expect(showError).toHaveBeenCalledTimes(1));
        expect(showError.mock.calls[0][0]).toMatch(/Unlock the pipeline/);
        expect(updatePipeline).not.toHaveBeenCalled();
    });

    it('a changed sort order writes sort_order; a blank keeps the place', async () => {
        render(ui(ROW));
        fireEvent.change(screen.getByTestId('pipeline-edit-sort-order'), { target: { value: '-4' } });
        save();
        await waitFor(() => expect(updatePipeline).toHaveBeenCalledTimes(1));
        expect(updatePipeline.mock.calls[0][3]).toEqual({ sort_order: -4 });
    });

    it('a locked plan still writes its sort order (lock-free at the gateway)', async () => {
        render(ui({ ...ROW, locked: 1 }));
        fireEvent.change(screen.getByTestId('pipeline-edit-sort-order'), { target: { value: '8' } });
        save();
        await waitFor(() => expect(updatePipeline).toHaveBeenCalledTimes(1));
        expect(updatePipeline.mock.calls[0][3]).toEqual({ sort_order: 8 });
    });

    // Code review — the prop refetches under an open dialog (window focus):
    // what changed elsewhere meanwhile is kept, not written back.
    it('a lock set elsewhere while open is not lifted by a goal-only save', async () => {
        const { rerender } = render(ui(ROW));
        rerender(ui({ ...ROW, locked: 1 }));                 // locked from the Pipelines page
        save();
        await waitFor(() => expect(updatePipeline).not.toHaveBeenCalled());
        expect(showError).not.toHaveBeenCalled();
    });

    it('a card reorder made elsewhere while open is not reverted', async () => {
        const { rerender } = render(ui(ROW));
        rerender(ui({ ...ROW, sort_order: -2 }));            // dragged on the Pipelines page
        fireEvent.change(screen.getByTestId('pipeline-edit-description'), { target: { value: 'New' } });
        save();
        await waitFor(() => expect(updatePipeline).toHaveBeenCalledTimes(1));
        expect(updatePipeline.mock.calls[0][3]).toEqual({ description: 'New' });
    });

    it('Delete is blocked, naming it, while an initiative or epic inside is locked', () => {
        render(ui(ROW, { deletion: { ...DELETION, lockedInside: 'Epic 4' } }));
        expect(screen.getByTestId('pipeline-delete').disabled).toBe(true);
        expect(screen.getByTestId('pipeline-delete').getAttribute('aria-label'))
            .toBe('Epic 4 in it is locked — unlock it to delete this pipeline.');
    });

    it('offers no Delete without the caller\'s counts', () => {
        render(ui(ROW));
        expect(screen.queryByTestId('pipeline-delete')).toBeNull();
    });

    it('Delete confirms in the dialog with what goes and what stays, then deletes', async () => {
        const onDeleted = vi.fn();
        const onClose = vi.fn();
        render(ui(ROW, { deletion: DELETION, onDeleted, onClose }));
        fireEvent.click(screen.getByTestId('pipeline-delete'));
        const text = screen.getByTestId('pipeline-delete-consequence').textContent;
        expect(text).toContain('Delete pipeline 12 "CurrentWork"?');
        expect(text).toContain('2 initiatives, 5 epics');
        expect(text).toContain('9 requirements are kept');
        expect(deletePipeline).not.toHaveBeenCalled();
        fireEvent.click(screen.getByTestId('pipeline-delete-confirm'));
        await waitFor(() => expect(onDeleted).toHaveBeenCalledTimes(1));
        expect(deletePipeline).toHaveBeenCalledWith('https://x/darwin_dev', 't', 12);
        expect(onClose).toHaveBeenCalled();
    });

    it('Keep pipeline backs out without deleting', () => {
        render(ui(ROW, { deletion: DELETION }));
        fireEvent.click(screen.getByTestId('pipeline-delete'));
        fireEvent.click(screen.getByTestId('pipeline-delete-keep'));
        expect(screen.queryByTestId('pipeline-delete-consequence')).toBeNull();
        expect(deletePipeline).not.toHaveBeenCalled();
    });

    it('Delete is blocked, and says why, on a locked or orchestrated plan', () => {
        render(ui({ ...ROW, locked: 1 }, { deletion: DELETION }));
        expect(screen.getByTestId('pipeline-delete').disabled).toBe(true);
        expect(screen.getByTestId('pipeline-delete').getAttribute('aria-label')).toMatch(/Locked/);
        cleanup();
        render(ui(ROW, { deletion: { ...DELETION, orchestrated: true } }));
        expect(screen.getByTestId('pipeline-delete').disabled).toBe(true);
        expect(screen.getByTestId('pipeline-delete').getAttribute('aria-label'))
            .toMatch(/pipeline-stop/);
    });

    it('a refused delete shows the named refusal and stays on the plan', async () => {
        deletePipeline.mockImplementationOnce(() => {
            const e = new Error('"CurrentWork" cannot be deleted: epic 4 in it is locked — unlock it first.');
            e.namedRefusal = true;
            e.httpStatus = { httpStatus: 423 };
            return Promise.reject(e);
        });
        const onDeleted = vi.fn();
        render(ui(ROW, { deletion: DELETION, onDeleted }));
        fireEvent.click(screen.getByTestId('pipeline-delete'));
        fireEvent.click(screen.getByTestId('pipeline-delete-confirm'));
        await waitFor(() => expect(showError).toHaveBeenCalledTimes(1));
        expect(showError.mock.calls[0][0]).toMatch(/\(423\) — "CurrentWork" cannot be deleted/);
        expect(onDeleted).not.toHaveBeenCalled();
    });
});

describe('PipelineEditDialog Esc (req #4171)', () => {
    const esc = () => fireEvent.keyDown(screen.getByTestId('pipeline-edit-dialog'), { key: 'Escape' });

    it('closes at once when nothing was edited', () => {
        const onClose = vi.fn();
        const confirm = vi.spyOn(window, 'confirm');
        render(ui(ROW, { onClose }));
        esc();
        expect(confirm).not.toHaveBeenCalled();
        expect(onClose).toHaveBeenCalledTimes(1);
        confirm.mockRestore();
    });

    it('asks before discarding edits, and keeps the dialog on No', () => {
        const onClose = vi.fn();
        const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
        render(ui(ROW, { onClose }));
        fireEvent.change(screen.getByTestId('pipeline-edit-description'), { target: { value: 'Changed' } });
        esc();
        expect(confirm).toHaveBeenCalledTimes(1);
        expect(onClose).not.toHaveBeenCalled();
        confirm.mockReturnValue(true);
        esc();
        expect(onClose).toHaveBeenCalledTimes(1);
        confirm.mockRestore();
    });
});
