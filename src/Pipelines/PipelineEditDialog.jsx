// PipelineEditDialog.jsx — the ONE pipeline editor (req #3853): the plan's own
// title, goal, machine and status (req #3965), opened by a click on the plan's name in the plan
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
// STATUS (req #3965): all seven values, as a row of chips like the requirement
// page's status selector, any value to any value. It is written alone — the
// gateway derives started_at/completed_at — and, being in the lock-free set,
// it stays editable on a LOCKED plan while the authoring fields are frozen.
// The lock itself is set from the Pipelines page (table and cards).

import { useContext, useRef, useState } from 'react';

import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
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
import {
    PIPELINE_STATUS_VALUES, pipelineStatusChipProps, pipelineStatusLabel,
} from '../SwarmView/pipelines/pipelineChipStyles';

// `''` is the Machine select's "Any" — a MUI select cannot hold a null value
// (NewPipelineDialog's convention).
const ANY_MACHINE = '';

// What the gateway still writes on a locked plan (plan_lock.py) — the Pipelines
// page's LOCK_FREE_FIELDS, of which this dialog edits one.
const LOCK_FREE = new Set(['pipeline_status']);

/**
 * The partial update a save sends — only the columns that changed — or a
 * refusal. Pure, so the "send only what changed" rule is testable on its own.
 *
 * @param {Object} pipeline  the stored row
 * @param {{title: string, description: string, machineFk: (number|string),
 *          status?: string}} form   `status` omitted = not edited here
 * @returns {{fields?: Object, problem?: string}}
 */
export function pipelineEditFields(pipeline, { title, description, machineFk, status }) {
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
    if (status !== undefined && status !== (pipeline?.pipeline_status ?? null)) {
        if (!PIPELINE_STATUS_VALUES.includes(status)) return { problem: `Unknown status "${status}"` };
        fields.pipeline_status = status;
    }
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
    const [status, setStatus] = useState(pipeline?.pipeline_status ?? null);
    // The status this dialog OPENED with. A plan's status is also written by
    // machines while the dialog is open (/pipeline-start, a drain, the engine
    // switch), and the `pipeline` prop refetches under it — so "changed" means
    // the reader moved it from here, never that it differs from the live row,
    // or a goal edit would quietly put back the status the plan opened with.
    const [openedStatus] = useState(pipeline?.pipeline_status ?? null);
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
        const { fields, problem } = pipelineEditFields(pipeline, {
            title, description, machineFk,
            ...(status != null && status !== openedStatus && { status }) });
        if (problem) { showError(problem); return; }
        if (!Object.keys(fields).length) { onClose(); return; }
        // A locked plan is a relic in time (req #3649): the gateway refuses an
        // authoring write (423) — say so before the attempt, in the lock's words.
        // Its status still writes (req #3965).
        if (locked && Object.keys(fields).some((k) => !LOCK_FREE.has(k))) {
            showError('This pipeline is locked — unlock it first');
            return;
        }
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
                    {/* req #3965 — the status, all seven values; editable even
                        while the plan is locked. */}
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
                        <Typography variant="subtitle2" color="text.secondary" sx={{ minWidth: 56 }}>
                            Status
                        </Typography>
                        <Box role="group" aria-label="Status" data-value={status ?? ''}
                             data-testid="pipeline-edit-status"
                             sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                            {PIPELINE_STATUS_VALUES.map((value) => {
                                const selected = value === status;
                                const colours = pipelineStatusChipProps(value).sx;
                                return (
                                    <Chip key={value} size="small" label={pipelineStatusLabel(value)}
                                          onClick={() => setStatus(value)}
                                          aria-pressed={selected ? 'true' : 'false'}
                                          data-testid={`pipeline-edit-status-${value}`}
                                          {...(selected
                                              ? { sx: { ...colours, cursor: 'pointer',
                                                  '&:hover, &.Mui-focusVisible': { bgcolor: colours.bgcolor } } }
                                              : { variant: 'outlined', sx: { cursor: 'pointer', opacity: 0.6 } })} />
                                );
                            })}
                        </Box>
                    </Box>
                    {locked && (
                        <Typography variant="body2" color="text.secondary"
                                    data-testid="pipeline-edit-locked">
                            This pipeline is locked — its status can still be changed; unlock it
                            from the plan toolbar to change anything else.
                        </Typography>
                    )}
                </Stack>
            </DialogContent>
            <DialogActions>
                <Button onClick={() => onClose()} disabled={submitting}>Cancel</Button>
                <Button variant="contained" onClick={handleSubmit}
                        disabled={submitting || !title.trim()}
                        data-testid="pipeline-edit-save">
                    Save
                </Button>
            </DialogActions>
        </Dialog>
    );
}
