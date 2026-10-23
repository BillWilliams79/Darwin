// EmptyPlanAddStep.jsx — the empty-plan panel with a prominent "+" that places
// the FIRST step in an epic (req #3646).
//
// Every other add-step control (req #3586/#3617) hangs off an existing card or
// dependency arc, so a pipeline with no steps had no way to add one from the
// plan. This is the one control that needs no anchor: a large "+" in the middle
// of the otherwise-empty panel, opening the same title + epic dialog the "+"
// marks use. Shared by the canvas and the table, which each return this panel
// when the plan has no rows.
//
// A plan with NO EPIC (req #3773). A step lives in an epic, so this "+" used to
// be disabled there — and that is exactly the state of every pipeline the
// Pipelines page creates. It now opens "Add the first epic" (title + category)
// and creates the epic AND its first step, as the canvas's own epic-add "+"
// does (an epic with no steps would draw nowhere).

import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';

import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Fab from '@mui/material/Fab';
import Link from '@mui/material/Link';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import AddIcon from '@mui/icons-material/Add';

import AppContext from '../../Context/AppContext';
import AuthContext from '../../Context/AuthContext';
import { pipelineComposeKeys } from '../../hooks/useQueryKeys';
import { epicKeys, pipelineStepKeys, useAllCategories } from '../../hooks/useDataQueries';
import { useSnackBarStore } from '../../stores/useSnackBarStore';
import { createStep, isRestNullLiteral, REST_NULL } from '../../Steps/stepsApi';
import { createEpic } from '../../Epics/epicsApi';
import { NEW_EPIC_TITLE, NEW_STEP_TITLE } from './pipelineStepInsert';

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

/** Open categories in their own order — the first-epic dialog's Category picker. */
export function openCategoryOptions(categories) {
    return (categories || [])
        .filter((c) => !c.closed)
        .sort((a, b) => (a.sort_order ?? Infinity) - (b.sort_order ?? Infinity)
            || String(a.category_name).localeCompare(String(b.category_name)));
}

export default function EmptyPlanAddStep({ model, pipeline, testId }) {
    const queryClient = useQueryClient();
    const { darwinUri } = useContext(AppContext);
    const { idToken, profile } = useContext(AuthContext);
    const showError = useSnackBarStore((st) => st.showError);

    const epics = useMemo(() => emptyPlanEpicOptions(model), [model]);
    const noEpics = epics.length === 0;
    const { data: categories = [] } = useAllCategories(
        profile?.userName, { fields: 'id,category_name,sort_order,closed' });
    const categoryOptions = useMemo(() => openCategoryOptions(categories), [categories]);
    const [open, setOpen] = useState(false);
    const [title, setTitle] = useState(NEW_STEP_TITLE);
    const [epicId, setEpicId] = useState('');
    const [categoryId, setCategoryId] = useState('');
    const [creating, setCreating] = useState(false);

    // When the dialog opened — a double-click on the "+" lands its second click
    // on the dialog's backdrop, which would close it again at once.
    const openedAtRef = useRef(0);
    const openDialog = useCallback(() => {
        openedAtRef.current = Date.now();
        setTitle(noEpics ? NEW_EPIC_TITLE : NEW_STEP_TITLE);
        setEpicId(epics.length === 1 ? epics[0].id : '');
        setCategoryId(categoryOptions[0]?.id ?? '');
        setOpen(true);
    }, [epics, noEpics, categoryOptions]);

    // Opened before the categories read landed — default the picker once
    // they arrive rather than leaving it blank.
    useEffect(() => {
        if (open && noEpics && categoryId === '' && categoryOptions.length) {
            setCategoryId(categoryOptions[0].id);
        }
    }, [open, noEpics, categoryId, categoryOptions]);

    // req #3649 — a locked plan refuses every child write at the gateway (423),
    // so the "+" says so instead of opening a dialog that cannot succeed (the
    // canvas hides its own add marks on a locked plan for the same reason).
    const locked = Boolean(Number(pipeline?.locked));

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
        if (noEpics ? (categoryId === '' || categoryId == null)
            : (epicId === '' || epicId == null)) {
            showError(noEpics ? 'Category is required' : 'Epic is required');
            return;
        }
        setCreating(true);
        try {
            if (noEpics) {
                const epic = await createEpic(darwinUri, idToken, {
                    pipeline_fk: pipeline.id, title: trimmed, category_fk: categoryId,
                });
                const newEpicId = Array.isArray(epic) ? epic[0]?.id : epic?.id;
                setOpen(false);
                if (newEpicId == null) {
                    // Written but not read back: retrying would make a second epic.
                    showError('The epic may have been created without a first step — '
                        + 'check the Epics page before adding it again');
                    return;
                }
                try {
                    await createStep(darwinUri, idToken, { epic_fk: newEpicId, title: NEW_STEP_TITLE });
                } catch (error) {
                    showError(error, 'Epic created, but its first step could not be added');
                }
            } else {
                await createStep(darwinUri, idToken, { epic_fk: epicId, title: trimmed });
                setOpen(false);
            }
        } catch (error) {
            showError(error, noEpics ? 'Could not create the epic' : 'Could not add the step');
        } finally {
            setCreating(false);
            if (pipeline?.id != null) {
                queryClient.invalidateQueries({ queryKey: pipelineComposeKeys.byId(pipeline.id) });
            }
            if (noEpics && profile?.userName) {
                queryClient.invalidateQueries({ queryKey: epicKeys.all(profile.userName) });
            }
            queryClient.invalidateQueries({ queryKey: pipelineStepKeys.all(profile?.userName) });
            queryClient.invalidateQueries({ queryKey: ['orchestration_index'] });
        }
    }, [creating, title, noEpics, epicId, categoryId, darwinUri, idToken, pipeline?.id,
        profile?.userName, queryClient, showError]);

    const pickerEmpty = noEpics ? categoryId === '' : epicId === '';
    const dialogTitle = noEpics ? 'Add the first epic' : 'Add the first step';

    return (
        <>
            <Paper variant="outlined" sx={{ p: 6, textAlign: 'center' }} data-testid={testId}>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
                    This pipeline has no steps yet.
                </Typography>
                <Fab color="primary" size="large" aria-label={dialogTitle}
                     onClick={openDialog} disabled={locked}
                     sx={{ width: 80, height: 80 }}
                     data-testid="pipeline-empty-add-step">
                    <AddIcon sx={{ fontSize: 48 }} />
                </Fab>
                <Typography variant="body1" sx={{ mt: 2, fontWeight: 500 }}>
                    {dialogTitle}
                </Typography>
                {locked && (
                    <Typography variant="body2" color="text.secondary"
                                data-testid="pipeline-empty-add-step-locked">
                        This pipeline is locked — unlock it first.
                    </Typography>
                )}
                {!locked && noEpics && (
                    <Typography variant="body2" color="text.secondary"
                                data-testid="pipeline-empty-add-step-no-epics">
                        A step lives in an epic — this creates the epic and its first step.
                    </Typography>
                )}
            </Paper>

            <Dialog open={open} onClose={(event, reason) => {
                        if (reason === 'backdropClick' && Date.now() - openedAtRef.current < 600) return;
                        if (!creating) setOpen(false);
                    }}
                    fullWidth maxWidth="xs" data-testid="pipeline-empty-add-step-dialog">
                <DialogTitle>{dialogTitle}</DialogTitle>
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
                        {noEpics && !categoryOptions.length ? (
                            <Typography variant="body2" color="text.secondary"
                                        data-testid="pipeline-empty-add-step-no-categories">
                                An epic is filed under a category, and you have no open
                                category. <Link component={RouterLink} to="/categoryedit">Create
                                one first</Link>.
                            </Typography>
                        ) : noEpics ? (
                            <TextField select fullWidth size="small" label="Category"
                                       value={categoryId}
                                       onChange={(e) => setCategoryId(e.target.value)}
                                       inputProps={{ 'data-testid': 'pipeline-empty-add-step-category' }}>
                                {categoryOptions.map((c) => (
                                    <MenuItem key={c.id} value={c.id}>
                                        {c.category_name || `Category ${c.id}`}
                                    </MenuItem>
                                ))}
                            </TextField>
                        ) : (
                            <TextField select fullWidth size="small" label="Epic"
                                       value={epicId}
                                       onChange={(e) => setEpicId(e.target.value)}
                                       inputProps={{ 'data-testid': 'pipeline-empty-add-step-epic' }}>
                                {epics.map((e) => (
                                    <MenuItem key={e.id} value={e.id}>{e.title || `Epic ${e.id}`}</MenuItem>
                                ))}
                            </TextField>
                        )}
                    </Box>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setOpen(false)} disabled={creating}>Cancel</Button>
                    <Button variant="contained" onClick={commit}
                            disabled={creating || !title.trim() || pickerEmpty}
                            data-testid="pipeline-empty-add-step-create">
                        {creating ? 'Creating…' : 'Create'}
                    </Button>
                </DialogActions>
            </Dialog>
        </>
    );
}
