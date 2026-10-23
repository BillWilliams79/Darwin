// EmptyPlanAddEpic.jsx — the empty-plan panel with a prominent "+" that places
// the FIRST epic in an initiative (req #3646).
//
// Every other add-epic control (req #3586/#3617) hangs off an existing card or
// dependency arc, so a pipeline with no epics had no way to add one from the
// plan. This is the one control that needs no anchor: a large "+" in the middle
// of the otherwise-empty panel, opening the same title + initiative dialog the "+"
// marks use. Shared by the canvas and the table, which each return this panel
// when the plan has no rows.
//
// A plan with NO INITIATIVE (req #3773). An epic lives in an initiative, so this "+" used to
// be disabled there — and that is exactly the state of every pipeline the
// Pipelines page creates. It now opens "Add the first initiative" (title + category)
// and creates the initiative AND its first epic, as the canvas's own initiative-add "+"
// does (an initiative with no epics would draw nowhere).

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
import { initiativeKeys, pipelineEpicKeys, useAllCategories } from '../../hooks/useDataQueries';
import { useSnackBarStore } from '../../stores/useSnackBarStore';
import { createEpic, isRestNullLiteral, REST_NULL } from '../../Epics/epicsApi';
import { createInitiative } from '../../Initiatives/initiativesApi';
import { NEW_INITIATIVE_TITLE, NEW_EPIC_TITLE } from './pipelineEpicInsert';

/**
 * The plan's initiatives, in plan order, for the dialog's picker — the payload's own
 * `initiatives[]`, which carries an initiative with no epics yet (the only kind an empty
 * plan has).
 */
export function emptyPlanInitiativeOptions(model) {
    return (model?.initiatives || [])
        .map((e) => ({ id: e.id, title: e.title, sortOrder: e.sort_order }))
        .sort((a, b) => (a.sortOrder ?? Infinity) - (b.sortOrder ?? Infinity) || a.id - b.id);
}

/** Open categories in their own order — the first-initiative dialog's Category picker. */
export function openCategoryOptions(categories) {
    return (categories || [])
        .filter((c) => !c.closed)
        .sort((a, b) => (a.sort_order ?? Infinity) - (b.sort_order ?? Infinity)
            || String(a.category_name).localeCompare(String(b.category_name)));
}

export default function EmptyPlanAddEpic({ model, pipeline, testId }) {
    const queryClient = useQueryClient();
    const { darwinUri } = useContext(AppContext);
    const { idToken, profile } = useContext(AuthContext);
    const showError = useSnackBarStore((st) => st.showError);

    const initiatives = useMemo(() => emptyPlanInitiativeOptions(model), [model]);
    const noInitiatives = initiatives.length === 0;
    const { data: categories = [] } = useAllCategories(
        profile?.userName, { fields: 'id,category_name,sort_order,closed' });
    const categoryOptions = useMemo(() => openCategoryOptions(categories), [categories]);
    const [open, setOpen] = useState(false);
    const [title, setTitle] = useState(NEW_EPIC_TITLE);
    const [initiativeId, setInitiativeId] = useState('');
    const [categoryId, setCategoryId] = useState('');
    const [creating, setCreating] = useState(false);

    // When the dialog opened — a double-click on the "+" lands its second click
    // on the dialog's backdrop, which would close it again at once.
    const openedAtRef = useRef(0);
    const openDialog = useCallback(() => {
        openedAtRef.current = Date.now();
        setTitle(noInitiatives ? NEW_INITIATIVE_TITLE : NEW_EPIC_TITLE);
        setInitiativeId(initiatives.length === 1 ? initiatives[0].id : '');
        setCategoryId(categoryOptions[0]?.id ?? '');
        setOpen(true);
    }, [initiatives, noInitiatives, categoryOptions]);

    // Opened before the categories read landed — default the picker once
    // they arrive rather than leaving it blank.
    useEffect(() => {
        if (open && noInitiatives && categoryId === '' && categoryOptions.length) {
            setCategoryId(categoryOptions[0].id);
        }
    }, [open, noInitiatives, categoryId, categoryOptions]);

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
        if (noInitiatives ? (categoryId === '' || categoryId == null)
            : (initiativeId === '' || initiativeId == null)) {
            showError(noInitiatives ? 'Category is required' : 'Initiative is required');
            return;
        }
        setCreating(true);
        try {
            if (noInitiatives) {
                const initiative = await createInitiative(darwinUri, idToken, {
                    pipeline_fk: pipeline.id, title: trimmed, category_fk: categoryId,
                });
                const newInitiativeId = Array.isArray(initiative) ? initiative[0]?.id : initiative?.id;
                setOpen(false);
                if (newInitiativeId == null) {
                    // Written but not read back: retrying would make a second initiative.
                    showError('The initiative may have been created without a first epic — '
                        + 'check the Initiatives page before adding it again');
                    return;
                }
                try {
                    await createEpic(darwinUri, idToken, { initiative_fk: newInitiativeId, title: NEW_EPIC_TITLE });
                } catch (error) {
                    showError(error, 'Initiative created, but its first epic could not be added');
                }
            } else {
                await createEpic(darwinUri, idToken, { initiative_fk: initiativeId, title: trimmed });
                setOpen(false);
            }
        } catch (error) {
            showError(error, noInitiatives ? 'Could not create the initiative' : 'Could not add the epic');
        } finally {
            setCreating(false);
            if (pipeline?.id != null) {
                queryClient.invalidateQueries({ queryKey: pipelineComposeKeys.byId(pipeline.id) });
            }
            if (noInitiatives && profile?.userName) {
                queryClient.invalidateQueries({ queryKey: initiativeKeys.all(profile.userName) });
            }
            queryClient.invalidateQueries({ queryKey: pipelineEpicKeys.all(profile?.userName) });
            queryClient.invalidateQueries({ queryKey: ['orchestration_index'] });
        }
    }, [creating, title, noInitiatives, initiativeId, categoryId, darwinUri, idToken, pipeline?.id,
        profile?.userName, queryClient, showError]);

    const pickerEmpty = noInitiatives ? categoryId === '' : initiativeId === '';
    const dialogTitle = noInitiatives ? 'Add the first initiative' : 'Add the first epic';

    return (
        <>
            <Paper variant="outlined" sx={{ p: 6, textAlign: 'center' }} data-testid={testId}>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
                    This pipeline has no epics yet.
                </Typography>
                <Fab color="primary" size="large" aria-label={dialogTitle}
                     onClick={openDialog} disabled={locked}
                     sx={{ width: 80, height: 80 }}
                     data-testid="pipeline-empty-add-epic">
                    <AddIcon sx={{ fontSize: 48 }} />
                </Fab>
                <Typography variant="body1" sx={{ mt: 2, fontWeight: 500 }}>
                    {dialogTitle}
                </Typography>
                {locked && (
                    <Typography variant="body2" color="text.secondary"
                                data-testid="pipeline-empty-add-epic-locked">
                        This pipeline is locked — unlock it first.
                    </Typography>
                )}
                {!locked && noInitiatives && (
                    <Typography variant="body2" color="text.secondary"
                                data-testid="pipeline-empty-add-epic-no-initiatives">
                        An epic lives in an initiative — this creates the initiative and its first epic.
                    </Typography>
                )}
            </Paper>

            <Dialog open={open} onClose={(event, reason) => {
                        if (reason === 'backdropClick' && Date.now() - openedAtRef.current < 600) return;
                        if (!creating) setOpen(false);
                    }}
                    fullWidth maxWidth="xs" data-testid="pipeline-empty-add-epic-dialog">
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
                                   inputProps={{ 'data-testid': 'pipeline-empty-add-epic-title' }}
                                   sx={{ mb: 2 }} />
                        {noInitiatives && !categoryOptions.length ? (
                            <Typography variant="body2" color="text.secondary"
                                        data-testid="pipeline-empty-add-epic-no-categories">
                                An initiative is filed under a category, and you have no open
                                category. <Link component={RouterLink} to="/categoryedit">Create
                                one first</Link>.
                            </Typography>
                        ) : noInitiatives ? (
                            <TextField select fullWidth size="small" label="Category"
                                       value={categoryId}
                                       onChange={(e) => setCategoryId(e.target.value)}
                                       inputProps={{ 'data-testid': 'pipeline-empty-add-epic-category' }}>
                                {categoryOptions.map((c) => (
                                    <MenuItem key={c.id} value={c.id}>
                                        {c.category_name || `Category ${c.id}`}
                                    </MenuItem>
                                ))}
                            </TextField>
                        ) : (
                            <TextField select fullWidth size="small" label="Initiative"
                                       value={initiativeId}
                                       onChange={(e) => setInitiativeId(e.target.value)}
                                       inputProps={{ 'data-testid': 'pipeline-empty-add-epic-initiative' }}>
                                {initiatives.map((e) => (
                                    <MenuItem key={e.id} value={e.id}>{e.title || `Initiative ${e.id}`}</MenuItem>
                                ))}
                            </TextField>
                        )}
                    </Box>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setOpen(false)} disabled={creating}>Cancel</Button>
                    <Button variant="contained" onClick={commit}
                            disabled={creating || !title.trim() || pickerEmpty}
                            data-testid="pipeline-empty-add-epic-create">
                        {creating ? 'Creating…' : 'Create'}
                    </Button>
                </DialogActions>
            </Dialog>
        </>
    );
}
