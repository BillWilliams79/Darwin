// PipelineEditDialog.jsx — the ONE pipeline editor (req #3853), rewritten by
// req #4128 to the epic and initiative editors' features and design language
// (`EpicEditDialog`, `InitiativeEditDialog`): "Pipeline editor must have the
// same features and design language as the epic and initiative editors … Show
// the pipeline ID # like epics."
//
// It is opened by a click on the plan's name in the plan page's header — the
// initiative and epic names' single editor (req #3742), for the plan itself.
// The caller mounts it with a fresh `key` per open, so the form seeds from
// `pipeline` once; it writes through pipelinesApi itself and reports back
// through `onSaved` (the caller re-reads what it draws), `onDeleted` and
// `onClose`.
//
// WHAT IT SHARES WITH THE OTHER TWO EDITORS
//   - the id in the title: "Edit pipeline 12", as "Edit epic 23";
//   - the NAME first, with a helper saying what a name is (req #3800);
//   - every choice a labelled Select whose items say what the value MEANS
//     ("Locked — frozen against edits", "Running — the only status that
//     launches"), not a bare word or a row of chips;
//   - the Lock control (the epic editor's): lifting the plan's own lock rides
//     the same PUT as the fields, so unlock-and-edit is one Save;
//   - a Sort order field (the initiative editor's): the plan's place among the
//     Pipelines page's cards, blank to keep it;
//   - Delete at the left of the actions, confirmed IN the dialog with what
//     goes and what stays (req #3867 / #3967's pattern) — the Pipelines page's
//     hard delete (`deletePipeline`, req #3934), offered here too.
//
// ONLY WHAT CHANGED IS SENT. A field the reader left alone is never written,
// so a row read without one of these columns cannot have it blanked by a save
// (the Goal dialog's data-loss path, PipelinesPage.jsx). "Changed" is judged
// against the row AS THE DIALOG OPENED (`openedRow`), never the live prop: the
// prop refetches under an open dialog (window focus), so a lock, a card
// reorder or a rename made elsewhere meanwhile is kept, not written back.
//
// LOCKED (req #3649): a plan whose lock is held takes no authoring write (the
// gateway answers 423), so Title, Goal and Machine are read-only until the lock
// is lifted here. The gateway's lock-free set on `pipelines` (plan_lock.py) —
// the status, the list position and the lock itself — stays editable.
//
// STATUS (req #3965): all seven values, any value to any value; the gateway
// derives started_at/completed_at. "Changed" means the reader moved it HERE,
// never that it differs from the live row — machines write it while the dialog
// is open (/pipeline-start, a drain, the engine switch).

import { useContext, useRef, useState } from 'react';

import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import FormControl from '@mui/material/FormControl';
import InputLabel from '@mui/material/InputLabel';
import MenuItem from '@mui/material/MenuItem';
import Select from '@mui/material/Select';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { useQueryClient } from '@tanstack/react-query';

import AuthContext from '../Context/AuthContext';
import AppContext from '../Context/AppContext';
import { useSnackBarStore } from '../stores/useSnackBarStore';
import { updatePipeline, deletePipeline, isRestNullLiteral, REST_NULL } from './pipelinesApi';
import {
    PIPELINE_STATUS_VALUES, pipelineStatusLabel,
} from '../SwarmView/pipelines/pipelineChipStyles';
import {
    pipelineKeys, initiativeKeys, pipelineEpicKeys, pipelineEpicRequirementKeys,
    pipelineEpicDepKeys, initiativeDepKeys, pipelineComposeKeys, requirementKeys,
} from '../hooks/useQueryKeys';

const TITLE_MAX = 256;

// `''` is the Machine select's "Any" — a MUI select cannot hold a null value
// (NewPipelineDialog's convention).
const ANY_MACHINE = '';

// `pipelines.sort_order` is an INT.
const SORT_ORDER_MIN = -2147483648;
const SORT_ORDER_MAX = 2147483647;

// What the gateway still writes on a locked plan (plan_lock.py `PLAN_LOCK`).
export const LOCK_FREE = new Set(['locked', 'pipeline_status', 'sort_order']);

const LOCKED_MESSAGE = 'This pipeline is locked — unlock it first';

// What each status MEANS, in the items' words (the Run / Pause state selects'
// "Value — meaning" form). Only `orchestrating` launches (req #3965).
export const PIPELINE_STATUS_MEANING = Object.freeze({
    authoring: 'being written; nothing launches',
    authorized: 'approved, not yet set to run; nothing launches',
    orchestration_ready: 'set to run; the engine switch turns it on',
    orchestrating: 'the only status whose epics launch',
    met: 'finished — its goal is met',
    wontfix: 'finished — abandoned',
    deferred: 'finished — put off',
});

// sort_order is an INT fed by a text input — three answers, not two: EMPTY
// (keep the stored place), a usable integer, and INVALID (the initiative
// editor's `parseSortOrder`).
const parseSortOrder = (raw) => {
    const t = String(raw ?? '').trim();
    if (t === '') return { empty: true };
    const n = Number(t);
    if (!Number.isInteger(n)) return { invalid: 'Sort order must be a whole number' };
    if (n < SORT_ORDER_MIN || n > SORT_ORDER_MAX) {
        return { invalid: `Sort order must be between ${SORT_ORDER_MIN} and ${SORT_ORDER_MAX}` };
    }
    return { value: n };
};

const isLockedRow = (pipeline) => !!Number(pipeline?.locked ?? 0);

/**
 * The partial update a save sends — only the columns that changed — or a
 * refusal. Pure, so the "send only what changed" rule is testable on its own.
 *
 * @param {Object} pipeline  the stored row
 * @param {{title: string, description: string, machineFk: (number|string),
 *          status?: string, locked?: boolean, sortOrder?: string}} form
 *          `status`, `locked`, `sortOrder` omitted = not edited here
 * @returns {{fields?: Object, problem?: string}}
 */
export function pipelineEditFields(pipeline, {
    title, description, machineFk, status, locked, sortOrder,
}) {
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
    if (sortOrder !== undefined) {
        const parsed = parseSortOrder(sortOrder);
        if (parsed.invalid) return { problem: parsed.invalid };
        if (!parsed.empty && parsed.value !== (pipeline?.sort_order ?? null)) {
            fields.sort_order = parsed.value;
        }
    }
    if (locked !== undefined && !!locked !== isLockedRow(pipeline)) fields.locked = locked ? 1 : 0;
    return { fields };
}

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * What the delete does, in the confirmation's words (req #3934's card dialog,
 * in the epic editor's form): what goes, and what stays.
 *
 * @param {Object} pipeline  `{ id, title }`
 * @param {{initiatives: number, epics: number, requirements: number}} deletion
 * @returns {string[]}
 */
export const pipelineDeleteConsequence = (pipeline, deletion) => {
    const { initiatives = 0, epics = 0, requirements = 0 } = deletion || {};
    return [
        `Delete pipeline ${pipeline.id} "${pipeline.title || ''}"? This is permanent — there is no undo.`,
        `Its ${plural(initiatives, 'initiative')}, ${plural(epics, 'epic')} and every dependency `
            + 'between them are deleted with it.',
        requirements
            ? `Its ${plural(requirements, 'requirement')} ${requirements === 1
                ? 'is kept — it comes' : 'are kept — they come'} out unseated, in no plan.`
            : 'It seats no requirements.',
        'Past sessions keep their history.',
    ];
};

// Why the plan cannot be deleted right now, or null. The gateway refuses a
// locked plan (423) and `deletePipeline` refuses one a live orchestrator holds,
// so the button says so instead of failing.
const deleteBlockedReason = (pipeline, deletion) => {
    if (isLockedRow(pipeline)) return 'Locked — unlock and save to delete this pipeline.';
    if (deletion?.lockedInside) {
        return `${deletion.lockedInside} in it is locked — unlock it to delete this pipeline.`;
    }
    if (deletion?.orchestrated) return 'Being orchestrated — /pipeline-stop it first.';
    return null;
};

/**
 * @param {Object} props
 * @param {boolean} props.open
 * @param {Object} props.pipeline   the plan row being edited
 * @param {Object[]} [props.machines]  the machine dictionary, for the Machine select
 * @param {function} props.onClose
 * @param {function} [props.onSaved]  after a successful write, before onClose
 * @param {?Object} [props.deletion]  enables Delete: `{ initiatives, epics,
 *                                    requirements, orchestrated, lockedInside }` —
 *                                    counts, the live-orchestrator fact and the
 *                                    first locked child ("Epic 4"), or null, from
 *                                    rows the caller holds. Absent, no Delete.
 * @param {function} [props.onDeleted] after the plan is gone (the caller leaves
 *                                    the page that drew it)
 */
export default function PipelineEditDialog({
    open, pipeline, machines = [], onClose, onSaved, deletion = null, onDeleted,
}) {
    const { idToken, profile } = useContext(AuthContext);
    const { darwinUri } = useContext(AppContext);
    const showError = useSnackBarStore((s) => s.showError);
    const queryClient = useQueryClient();

    // The row as it was when the dialog opened — the base every "changed?" is
    // judged against (see the header). The live `pipeline` still decides
    // whether the lock is held now.
    const [openedRow] = useState(() => ({ ...pipeline }));
    const storedLocked = isLockedRow(pipeline);
    const [title, setTitle] = useState(pipeline?.title || '');
    const [description, setDescription] = useState(pipeline?.description || '');
    const [machineFk, setMachineFk] = useState(pipeline?.machine_fk ?? ANY_MACHINE);
    const [status, setStatus] = useState(pipeline?.pipeline_status ?? null);
    // The status this dialog OPENED with (see the header): only a move made
    // here is sent.
    const [sortOrder, setSortOrder] = useState(
        pipeline?.sort_order == null ? '' : String(pipeline.sort_order));
    const [formLocked, setFormLocked] = useState(storedLocked);
    const [submitting, setSubmitting] = useState(false);
    const [confirmingDelete, setConfirmingDelete] = useState(false);
    // The in-flight guard is a ref, not `submitting` (useCreatePipeline's
    // rule): a second Enter can arrive before the render that disables Save.
    const inFlightRef = useRef(false);

    // The epic editor's rule: a lock that STAYS held freezes the authoring
    // fields; lifting it here (and saving) unfreezes them in the same PUT.
    const lockHeld = storedLocked && formLocked;
    // Fields typed while unlocked, then re-locked before saving, would be
    // refused by the gateway — so a lock re-set over edits is refused here.
    const editedThenRelocked = lockHeld && (
        title.trim() !== (openedRow.title ?? '')
        || description.trim() !== String(openedRow.description ?? '').trim()
        || machineFk !== (openedRow.machine_fk ?? ANY_MACHINE));

    // The plan's own machine stays choosable even if it has since been closed.
    const machineOptions = machines.filter((m) => !m.closed || m.id === pipeline?.machine_fk);
    // A stored status outside the seven (should not happen) is shown as itself.
    const statusOptions = status && !PIPELINE_STATUS_VALUES.includes(status)
        ? [...PIPELINE_STATUS_VALUES, status] : PIPELINE_STATUS_VALUES;
    // A row read without a status (should not happen) selects nothing rather
    // than an out-of-range value.
    const statusValue = statusOptions.includes(status) ? status : '';

    const canDelete = !!(pipeline && deletion);
    const deleteBlocked = canDelete ? deleteBlockedReason(pipeline, deletion) : null;

    const handleSubmit = async () => {
        // Enter in the Title field reaches here too, not only the (disabled)
        // Save button — a second Enter mid-save must not send a second PUT.
        // Enter in the Title field while the Delete is being confirmed must not
        // save underneath the confirmation.
        if (inFlightRef.current || confirmingDelete) return;
        if (editedThenRelocked) {
            showError('Unlock the pipeline to save these edits, or cancel them.');
            return;
        }
        const { fields, problem } = pipelineEditFields(openedRow, {
            title, description, machineFk, sortOrder, locked: formLocked, status });
        if (problem) { showError(problem); return; }
        if (!Object.keys(fields).length) { onClose(); return; }
        // A locked plan is a relic in time (req #3649): the gateway refuses an
        // authoring write (423) — say so before the attempt. Unlocking in this
        // same save lifts the check (plan_lock.py), as it does for an epic.
        if (lockHeld && Object.keys(fields).some((k) => !LOCK_FREE.has(k))) {
            showError(LOCKED_MESSAGE);
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

    const handleDelete = async () => {
        if (inFlightRef.current) return;
        inFlightRef.current = true;
        setSubmitting(true);
        let deleted = false;
        try {
            await deletePipeline(darwinUri, idToken, pipeline.id);
            deleted = true;
        } catch (err) {
            setConfirmingDelete(false);
            // A named refusal (a lock inside it, a running orchestrator, a
            // cross-plan edge) says WHICH — show it, as the Pipelines page does.
            const code = err?.httpStatus?.httpStatus;
            if (err?.namedRefusal) {
                showError(`Could not delete the pipeline${code ? ` (${code})` : ''} — ${err.message}`);
            } else {
                showError(err, 'Could not delete the pipeline');
            }
        } finally {
            inFlightRef.current = false;
            setSubmitting(false);
        }
        // The caller leaves the page, and the deleted plan's own read is
        // REMOVED (not invalidated) — its page is still mounted this tick, so
        // an invalidation would re-fetch a plan that no longer exists.
        if (deleted) {
            queryClient.removeQueries({ queryKey: pipelineComposeKeys.byId(pipeline.id) });
            onClose();
            onDeleted?.();
        }
        // Re-read either way: after a failure, whatever landed (or its
        // rollback) is the plan now. Its initiatives, epics, seats and edges
        // went with it, and requirement rows carry the derived `pipelined`.
        const creatorFk = profile?.userName;
        [...(deleted ? [] : [pipelineComposeKeys.all]),
            ...(creatorFk ? [pipelineKeys.all(creatorFk), initiativeKeys.all(creatorFk),
                pipelineEpicKeys.all(creatorFk), pipelineEpicRequirementKeys.all(creatorFk),
                pipelineEpicDepKeys.all(creatorFk), initiativeDepKeys.all(creatorFk),
                requirementKeys.all(creatorFk)] : [])]
            .forEach((queryKey) => queryClient.invalidateQueries({ queryKey }));
    };

    return (
        <Dialog open={open} onClose={(_e, reason) => !submitting && onClose(reason)}
                maxWidth="md" fullWidth data-testid="pipeline-edit-dialog">
            <DialogTitle data-testid="pipeline-edit-heading">
                {`Edit pipeline ${pipeline?.id ?? ''}`.trim()}
            </DialogTitle>
            <DialogContent>
                <Stack spacing={2} sx={{ mt: 1 }}>
                    {/* The NAME is the first field (req #3800). */}
                    <TextField
                        label="Title"
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') { e.preventDefault(); handleSubmit(); }
                        }}
                        helperText={lockHeld ? 'Locked — unlock to edit this pipeline.'
                            : 'The plan\'s short NAME — "CurrentWork", not a sentence.'}
                        autoFocus required fullWidth disabled={lockHeld}
                        slotProps={{ htmlInput: {
                            'data-testid': 'pipeline-edit-title', maxLength: TITLE_MAX } }}
                    />
                    <FormControl fullWidth>
                        <InputLabel>Lock</InputLabel>
                        <Select label="Lock" value={formLocked ? 'locked' : 'unlocked'}
                                onChange={(e) => setFormLocked(e.target.value === 'locked')}
                                data-testid="pipeline-edit-locked-select">
                            <MenuItem value="unlocked">Unlocked — the plan can be edited</MenuItem>
                            <MenuItem value="locked">
                                Locked — frozen against edits, with its initiatives and epics
                                (it still orchestrates)
                            </MenuItem>
                        </Select>
                    </FormControl>
                    <TextField
                        label="Goal"
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        helperText={'Why this plan exists and what it must achieve. Never its '
                            + 'initiatives, epics, status or ordinals — those are rows, and prose '
                            + 'that restates them goes stale. Replaces on save; it does not append.'}
                        fullWidth multiline minRows={6} disabled={lockHeld}
                        slotProps={{ htmlInput: { 'data-testid': 'pipeline-edit-description' } }}
                    />
                    <FormControl fullWidth disabled={lockHeld}>
                        <InputLabel>Machine</InputLabel>
                        <Select label="Machine" value={machineFk}
                                onChange={(e) => setMachineFk(e.target.value)}
                                data-testid="pipeline-edit-machine">
                            <MenuItem value={ANY_MACHINE}>Any — whichever machine runs its engine</MenuItem>
                            {machineOptions.map((m) => (
                                <MenuItem key={m.id} value={m.id}>{m.title || `Machine ${m.id}`}</MenuItem>
                            ))}
                        </Select>
                    </FormControl>
                    {/* req #3965 — the status, all seven values; editable even
                        while the plan is locked. */}
                    <FormControl fullWidth>
                        <InputLabel>Status</InputLabel>
                        <Select label="Status" value={statusValue}
                                onChange={(e) => setStatus(e.target.value)}
                                data-testid="pipeline-edit-status">
                            {statusOptions.map((value) => (
                                <MenuItem key={value} value={value}
                                          data-testid={`pipeline-edit-status-${value}`}>
                                    {pipelineStatusLabel(value)}
                                    {PIPELINE_STATUS_MEANING[value]
                                        ? ` — ${PIPELINE_STATUS_MEANING[value]}` : ''}
                                </MenuItem>
                            ))}
                        </Select>
                    </FormControl>
                    <TextField
                        label="Sort order"
                        value={sortOrder}
                        onChange={(e) => setSortOrder(e.target.value)}
                        helperText={'Whole number, the plan\'s place among the Pipelines page\'s '
                            + 'cards (lowest first) — or drag its card there. Leave blank to keep '
                            + 'its place.'}
                        type="number" fullWidth
                        slotProps={{ htmlInput: {
                            'data-testid': 'pipeline-edit-sort-order',
                            step: 1, min: SORT_ORDER_MIN, max: SORT_ORDER_MAX,
                        } }}
                    />
                    {lockHeld && (
                        <Typography variant="body2" color="text.secondary"
                                    data-testid="pipeline-edit-locked">
                            This pipeline is locked — its status, sort order and lock can still be
                            changed; unlock it above to change anything else.
                        </Typography>
                    )}
                </Stack>
            </DialogContent>
            {confirmingDelete && (
                <Alert severity="warning" sx={{ mx: 3 }} data-testid="pipeline-delete-consequence">
                    {pipelineDeleteConsequence(pipeline, deletion)
                        .map((line) => <div key={line}>{line}</div>)}
                </Alert>
            )}
            {confirmingDelete ? (
                <DialogActions>
                    <Button onClick={() => setConfirmingDelete(false)} disabled={submitting}
                            data-testid="pipeline-delete-keep">Keep pipeline</Button>
                    <Button variant="contained" color="error" onClick={handleDelete}
                            disabled={submitting} autoFocus
                            data-testid="pipeline-delete-confirm">
                        {submitting ? 'Deleting…' : 'Delete pipeline'}
                    </Button>
                </DialogActions>
            ) : (
                <DialogActions>
                    {canDelete && (
                        <Tooltip title={deleteBlocked || ''}>
                            {/* A disabled button fires no events; the span carries the tooltip. */}
                            <span style={{ marginRight: 'auto' }}>
                                <Button color="error" onClick={() => setConfirmingDelete(true)}
                                        disabled={submitting || !!deleteBlocked}
                                        data-blocked={deleteBlocked ? 'yes' : 'no'}
                                        aria-label={deleteBlocked || `Delete pipeline ${pipeline.id}`}
                                        data-testid="pipeline-delete">
                                    Delete
                                </Button>
                            </span>
                        </Tooltip>
                    )}
                    <Button onClick={() => onClose()} disabled={submitting}>Cancel</Button>
                    <Button variant="contained" onClick={handleSubmit}
                            disabled={submitting || !title.trim()}
                            data-testid="pipeline-edit-save">
                        Save
                    </Button>
                </DialogActions>
            )}
        </Dialog>
    );
}
