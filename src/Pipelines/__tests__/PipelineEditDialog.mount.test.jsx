// @vitest-environment jsdom
//
// Req #3965 — a plan's status is also written by machines while the editor is
// open (/pipeline-start, a drain, the engine switch). Saving a goal edit must
// not send back the status the dialog opened with.

import { describe, it, expect, vi, afterEach } from 'vitest';
import React from 'react';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';

vi.mock('../pipelinesApi', async (orig) => ({
    ...(await orig()),
    updatePipeline: vi.fn(() => Promise.resolve()),
}));

import AuthContext from '../../Context/AuthContext';
import AppContext from '../../Context/AppContext';
import PipelineEditDialog from '../PipelineEditDialog';
import { updatePipeline } from '../pipelinesApi';

const ROW = { id: 12, title: 'CurrentWork', description: 'Why', machine_fk: null,
    pipeline_status: 'authoring', locked: 0 };

const ui = (pipeline) => (
    <AuthContext.Provider value={{ idToken: 't' }}>
        <AppContext.Provider value={{ darwinUri: 'https://x/darwin_dev' }}>
            <PipelineEditDialog open pipeline={pipeline} onClose={() => {}} />
        </AppContext.Provider>
    </AuthContext.Provider>
);

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('PipelineEditDialog status', () => {
    it('does not send the opened status back when a machine changed it meanwhile', async () => {
        const { rerender } = render(ui(ROW));
        rerender(ui({ ...ROW, pipeline_status: 'orchestrating' }));   // /pipeline-start ran
        fireEvent.change(screen.getByTestId('pipeline-edit-description'),
            { target: { value: 'A better goal' } });
        fireEvent.click(screen.getByTestId('pipeline-edit-save'));
        await waitFor(() => expect(updatePipeline).toHaveBeenCalledTimes(1));
        expect(updatePipeline.mock.calls[0][3]).toEqual({ description: 'A better goal' });
    });

    it('sends the status the reader picked', async () => {
        render(ui(ROW));
        fireEvent.click(screen.getByTestId('pipeline-edit-status-met'));
        fireEvent.click(screen.getByTestId('pipeline-edit-save'));
        await waitFor(() => expect(updatePipeline).toHaveBeenCalledTimes(1));
        expect(updatePipeline.mock.calls[0][3]).toEqual({ pipeline_status: 'met' });
    });
});
