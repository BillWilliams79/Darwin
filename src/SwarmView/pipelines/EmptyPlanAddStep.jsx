// EmptyPlanAddStep.jsx — the empty-plan panel with a prominent "+" that places
// the FIRST step in an epic (req #3646).
//
// Every other add-step control (req #3586/#3617) hangs off an existing card or
// dependency arc, so a pipeline with no steps had no way to add one from the
// plan. This is the one control that needs no anchor: a large "+" in the middle
// of the otherwise-empty panel, opening the same title + epic dialog the "+"
// marks use. Shared by the canvas and the table, which each return this panel
// when the plan has no rows.

import { useCallback, useContext, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Fab from '@mui/material/Fab';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import AddIcon from '@mui/icons-material/Add';

import AppContext from '../../Context/AppContext';
import AuthContext from '../../Context/AuthContext';
import { pipelineComposeKeys } from '../../hooks/useQueryKeys';
import { pipelineStepKeys } from '../../hooks/useDataQueries';
import { useSnackBarStore } from '../../stores/useSnackBarStore';
import { createStep, isRestNullLiteral, REST_NULL } from '../../Steps/stepsApi';
import { NEW_STEP_TITLE } from './pipelineStepInsert';

/**
 * The plan's epics, in plan order, for the dialog's picker — the payload's own
 * `epics[]`, which carries an epic with no steps yet (the only kind an empty
 * plan has).
 */
export function emptyPlanEpicOptions(model) {
    return (model?.epics || [])
        .map((e) => ({ id: e.id, title: e.title, sortOrder: e.sort_order }))
        .sort((a, b) => (a.sortOrder ?? Infinity) - (b.sortOrder ?? Infinity) || a.id - b.id);
}

export default function EmptyPlanAddStep({ model, pipeline, testId }) {
    const queryClient = useQueryClient();
    const { darwinUri } = useContext(AppContext);
    const { idToken, profile } = useContext(AuthContext);
    const showError = useSnackBarStore((st) => st.showError);

    const epics = useMemo(() => emptyPlanEpicOptions(model), [model]);
    const [open, setOpen] = useState(false);
    const [title, setTitle] = useState(NEW_STEP_TITLE);
    const [epicId, setEpicId] = useState('');
    const [creating, setCreating] = useState(false);

    // When the dialog opened — a double-click on the "+" lands its second click
    // on the dialog's backdrop, which would close it again at once.
    const openedAtRef = useRef(0);
    const openDialog = useCallback(() => {
        openedAtRef.current = Date.now();
        setTitle(NEW_STEP_TITLE);
        setEpicId(epics.length === 1 ? epics[0].id : '');
        setOpen(true);
    }, [epics]);

    const commit = useCallback(async () => {
        if (creating) return;
        const trimmed = title.trim();
        if (!trimmed) {
            showError('Title is required');
            return;
        }
        if (isRestNullLiteral(trimmed)) {
            showError(`"${REST_NULL}" is the API's clear-this-column sentinel and cannot `
                + 'be a title. Try "Null" or another wording.');
            return;
        }
        if (epicId === '' || epicId == null) {
            showError('Epic is required');
            return;
        }
        setCreating(true);
        try {
            await createStep(darwinUri, idToken, { epic_fk: epicId, title: trimmed });
            setOpen(false);
        } catch (error) {
            showError(error, 'Could not add the step');
        } finally {
            setCreating(false);
            if (pipeline?.id != null) {
                queryClient.invalidateQueries({ queryKey: pipelineComposeKeys.byId(pipeline.id) });
            }
            queryClient.invalidateQueries({ queryKey: pipelineStepKeys.all(profile?.userName) });
            queryClient.invalidateQueries({ queryKey: ['orchestration_index'] });
        }
    }, [creating, title, epicId, darwinUri, idToken, pipeline?.id, profile?.userName,
        queryClient, showError]);

    const noEpics = epics.length === 0;

    return (
        <>
            <Paper variant="outlined" sx={{ p: 6, textAlign: 'center' }} data-testid={testId}>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
                    This pipeline has no steps yet.
                </Typography>
                <Fab color="primary" size="large" aria-label="Add the first step"
                     onClick={openDialog} disabled={noEpics}
                     sx={{ width: 80, height: 80 }}
                     data-testid="pipeline-empty-add-step">
                    <AddIcon sx={{ fontSize: 48 }} />
                </Fab>
                <Typography variant="body1" sx={{ mt: 2, fontWeight: 500 }}>
                    {noEpics ? 'Add an epic to this pipeline first' : 'Add the first step'}
                </Typography>
                {noEpics && (
                    <Typography variant="body2" color="text.secondary"
                                data-testid="pipeline-empty-add-step-no-epics">
                        A step lives in an epic, and this pipeline has none yet.
                    </Typography>
                )}
            </Paper>

            <Dialog open={open} onClose={(event, reason) => {
                        if (reason === 'backdropClick' && Date.now() - openedAtRef.current < 600) return;
                        if (!creating) setOpen(false);
                    }}
                    fullWidth maxWidth="xs" data-testid="pipeline-empty-add-step-dialog">
                <DialogTitle>Add the first step</DialogTitle>
                <DialogContent>
                    <Box sx={{ pt: 1 }}>
                        <TextField autoFocus fullWidth size="small" label="Title"
                                   value={title}
                                   onFocus={(e) => e.target.select()}
                                   onChange={(e) => setTitle(e.target.value)}
                                   onKeyDown={(e) => {
                                       if (e.key === 'Enter') { e.preventDefault(); commit(); }
                                   }}
                                   inputProps={{ 'data-testid': 'pipeline-empty-add-step-title' }}
                                   sx={{ mb: 2 }} />
                        <TextField select fullWidth size="small" label="Epic"
                                   value={epicId}
                                   onChange={(e) => setEpicId(e.target.value)}
                                   inputProps={{ 'data-testid': 'pipeline-empty-add-step-epic' }}>
                            {epics.map((e) => (
                                <MenuItem key={e.id} value={e.id}>{e.title || `Epic ${e.id}`}</MenuItem>
                            ))}
                        </TextField>
                    </Box>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setOpen(false)} disabled={creating}>Cancel</Button>
                    <Button variant="contained" onClick={commit}
                            disabled={creating || !title.trim()}
                            data-testid="pipeline-empty-add-step-create">
                        {creating ? 'Creating…' : 'Create'}
                    </Button>
                </DialogActions>
            </Dialog>
        </>
    );
}
