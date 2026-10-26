// PipelineEditDialog.jsx — the ONE pipeline editor (req #3853): the plan's own
// title, goal and machine, opened by a click on the plan's name in the plan
// page's header — the initiative and epic names' single editor (req #3742),
// for the plan itself.
//
// The caller mounts it with a fresh `key` per open, so the form seeds from
// `pipeline` once; it writes through pipelinesApi itself and reports back
// through `onSaved` (the caller re-reads what it draws) and `onClose`.
//
// ONLY WHAT CHANGED IS SENT. A field the reader left alone is never written,
// so a row read without one of these columns cannot have it blanked by a save
// (the Goal dialog's data-loss path, PipelinesPage.jsx), and a plan edited
// elsewhere meanwhile keeps every field this save did not touch.
//
// Lifecycle (`pipeline_status`) and the lock are not here: the plan is started,
// paused and stopped by the `/pipeline-*` commands, and locked from the
// Pipelines page (table and cards).

import { useContext, useRef, useState } from 'react';

import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';

import AuthContext from '../Context/AuthContext';
import AppContext from '../Context/AppContext';
import { useSnackBarStore } from '../stores/useSnackBarStore';
import { updatePipeline, isRestNullLiteral, REST_NULL } from './pipelinesApi';

// `''` is the Machine select's "Any" — a MUI select cannot hold a null value
// (NewPipelineDialog's convention).
const ANY_MACHINE = '';

/**
 * The partial update a save sends — only the columns that changed — or a
 * refusal. Pure, so the "send only what changed" rule is testable on its own.
 *
 * @param {Object} pipeline  the stored row
 * @param {{title: string, description: string, machineFk: (number|string)}} form
 * @returns {{fields?: Object, problem?: string}}
 */
export function pipelineEditFields(pipeline, { title, description, machineFk }) {
    const t = String(title ?? '').trim();
    if (!t) return { problem: 'Title is required' };
    // `title` is NOT NULL and the literal `NULL` is Lambda-Rest's
    // clear-this-column sentinel (the Initiatives and Epics editors' guard).
    if (isRestNullLiteral(t)) {
        return { problem: `"${REST_NULL}" is the API's clear-this-column sentinel and cannot `
            + 'be a title. Try "Null" or another wording.' };
    }
    const fields = {};
    if (t !== (pipeline?.title ?? '')) fields.title = t;
    const d = String(description ?? '').trim();
    // A typed `NULL` would land as SQL NULL and erase the goal without a word.
    if (isRestNullLiteral(d)) {
        return { problem: `"${REST_NULL}" is the API's clear-this-column sentinel and cannot `
            + 'be a goal. Leave the goal empty to clear it.' };
    }
    if (d !== String(pipeline?.description ?? '').trim()) fields.description = d || REST_NULL;
    const m = machineFk === ANY_MACHINE || machineFk == null ? null : Number(machineFk);
    if (m !== (pipeline?.machine_fk ?? null)) fields.machine_fk = m == null ? REST_NULL : m;
    return { fields };
}

/**
 * @param {Object} props
 * @param {boolean} props.open
 * @param {Object} props.pipeline   the plan row being edited
 * @param {Object[]} [props.machines]  the machine dictionary, for the Machine select
 * @param {function} props.onClose
 * @param {function} [props.onSaved]  after a successful write, before onClose
 */
export default function PipelineEditDialog({ open, pipeline, machines = [], onClose, onSaved }) {
    const { idToken } = useContext(AuthContext);
    const { darwinUri } = useContext(AppContext);
    const showError = useSnackBarStore((s) => s.showError);

    const [title, setTitle] = useState(pipeline?.title || '');
    const [description, setDescription] = useState(pipeline?.description || '');
    const [machineFk, setMachineFk] = useState(pipeline?.machine_fk ?? ANY_MACHINE);
    const [submitting, setSubmitting] = useState(false);
    // The in-flight guard is a ref, not `submitting` (useCreatePipeline's
    // rule): a second Enter can arrive before the render that disables Save.
    const inFlightRef = useRef(false);
    const locked = !!Number(pipeline?.locked ?? 0);

    // The plan's own machine stays choosable even if it has since been closed.
    const machineOptions = machines.filter((m) => !m.closed || m.id === pipeline?.machine_fk);

    const handleSubmit = async () => {
        // Enter in the Title field reaches here too, not only the (disabled)
        // Save button — a second Enter mid-save must not send a second PUT.
        if (inFlightRef.current) return;
        const { fields, problem } = pipelineEditFields(pipeline, { title, description, machineFk });
        if (problem) { showError(problem); return; }
        if (!Object.keys(fields).length) { onClose(); return; }
        // A locked plan is a relic in time (req #3649): the gateway refuses an
        // authoring write (423) — say so before the attempt, in the lock's words.
        if (locked) { showError('This pipeline is locked — unlock it first'); return; }
        inFlightRef.current = true;
        setSubmitting(true);
        try {
            await updatePipeline(darwinUri, idToken, pipeline.id, fields);
            await onSaved?.();
            onClose();
        } catch (err) {
            showError(err, 'Could not save pipeline');
        } finally {
            inFlightRef.current = false;
            setSubmitting(false);
        }
    };

    return (
        <Dialog open={open} onClose={(_e, reason) => !submitting && onClose(reason)}
                maxWidth="md" fullWidth data-testid="pipeline-edit-dialog">
            <DialogTitle>Edit pipeline</DialogTitle>
            <DialogContent>
                <Stack spacing={2} sx={{ mt: 1 }}>
                    <TextField
                        label="Title"
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') { e.preventDefault(); handleSubmit(); }
                        }}
                        autoFocus required fullWidth disabled={locked}
                        slotProps={{ htmlInput: { 'data-testid': 'pipeline-edit-title', maxLength: 256 } }}
                    />
                    <TextField
                        label="Goal"
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        helperText="Why this plan exists and what it must achieve — purpose, not a fact a query can answer."
                        fullWidth multiline minRows={6} disabled={locked}
                        slotProps={{ htmlInput: { 'data-testid': 'pipeline-edit-description' } }}
                    />
                    <TextField
                        select fullWidth label="Machine" value={machineFk} disabled={locked}
                        onChange={(e) => setMachineFk(e.target.value)}
                        slotProps={{ htmlInput: { 'data-testid': 'pipeline-edit-machine' } }}>
                        <MenuItem value={ANY_MACHINE}>Any</MenuItem>
                        {machineOptions.map((m) => (
                            <MenuItem key={m.id} value={m.id}>{m.title || `Machine ${m.id}`}</MenuItem>
                        ))}
                    </TextField>
                    {locked && (
                        <Typography variant="body2" color="text.secondary"
                                    data-testid="pipeline-edit-locked">
                            This pipeline is locked — unlock it from the plan toolbar to change it.
                        </Typography>
                    )}
                </Stack>
            </DialogContent>
            <DialogActions>
                <Button onClick={() => onClose()} disabled={submitting}>Cancel</Button>
                <Button variant="contained" onClick={handleSubmit}
                        disabled={submitting || locked || !title.trim()}
                        data-testid="pipeline-edit-save">
                    Save
                </Button>
            </DialogActions>
        </Dialog>
    );
}
