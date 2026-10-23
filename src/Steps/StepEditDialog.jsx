// StepEditDialog.jsx — the ONE step editor (req #3742): create and edit a
// plan-layer step. Lifted out of StepsPage so the plan canvas can open the same
// editor over itself when a step is clicked (user directive: "can it just
// popup over the visualizer instead of switch to the card view?"), rather than
// a second copy that would drift from this one.
//
// The caller mounts it with a fresh `key` per open, so the form seeds from
// `step` once; it writes through stepsApi itself and reports back through
// `onSaved` (the caller invalidates or re-reads what it draws) and `onClose`.

import { useContext, useState } from 'react';

import Stack from '@mui/material/Stack';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import TextField from '@mui/material/TextField';
import Select from '@mui/material/Select';
import MenuItem from '@mui/material/MenuItem';
import InputLabel from '@mui/material/InputLabel';
import FormControl from '@mui/material/FormControl';

import AuthContext from '../Context/AuthContext';
import AppContext from '../Context/AppContext';
import { useSnackBarStore } from '../stores/useSnackBarStore';
import {
    REST_NULL,
    VALID_RUN2_MODES,
    createStep,
    isRestNullLiteral,
    updateStep,
} from './stepsApi';

const TITLE_MAX = 256;

// HTML `<input type="datetime-local">` reads/writes local wall-clock time with
// no timezone — `YYYY-MM-DDTHH:mm`. `not_before` is stored as a naive-UTC
// string (`YYYY-MM-DD HH:mm:ss`, the same convention `sqlNow()` in
// stepsApi.js writes and `formatDateTime` reads — see that file's header).
// These two helpers are the one place that conversion happens.
export const notBeforeToInputValue = (naiveUtc) => {
    if (!naiveUtc) return '';
    const d = new Date(`${naiveUtc.replace(' ', 'T')}Z`);
    if (Number.isNaN(d.getTime())) return '';
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
        + `T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const inputValueToNotBefore = (localValue) => {
    if (!localValue) return null;
    const d = new Date(localValue);
    if (Number.isNaN(d.getTime())) return null;
    return d.toISOString().slice(0, 19).replace('T', ' ');
};

const runOf = (step) => (VALID_RUN2_MODES.includes(step?.run) ? step.run : 'auto');
// req #3767 — the barrier is the step's `checkpoint` column. Absent/NULL is the
// column default (on); the plan canvas passes a boolean, the Steps page 0/1.
const barrierOf = (step) => step?.checkpoint == null || Boolean(Number(step.checkpoint));

/**
 * @param {Object} props
 * @param {boolean} props.open
 * @param {?Object} props.step     the step being edited — `{ id, initiative_fk, title,
 *                                 notes, run, not_before, checkpoint, locked,
 *                                 lockedBy }` —
 *                                 or null to create one
 * @param {Object[]} props.initiativeOptions  `{ id, title }` for the Initiative select
 * @param {*} [props.defaultInitiativeFk]     the Initiative a NEW step starts in
 * @param {function} props.onClose
 * @param {function} props.onSaved      after a successful write, before onClose
 */
export default function StepEditDialog({
    open, step, initiativeOptions, defaultInitiativeFk = '', onClose, onSaved,
}) {
    const { idToken } = useContext(AuthContext);
    const { darwinUri } = useContext(AppContext);
    const showError = useSnackBarStore(s => s.showError);

    const [formInitiativeFk, setFormInitiativeFk] = useState(step ? step.initiative_fk : defaultInitiativeFk);
    const [formTitle, setFormTitle] = useState(step?.title || '');
    const [formNotes, setFormNotes] = useState(step?.notes || '');
    const [formRun, setFormRun] = useState(runOf(step));
    const [formNotBefore, setFormNotBefore] = useState(notBeforeToInputValue(step?.not_before));
    const [formBarrier, setFormBarrier] = useState(barrierOf(step));
    const [formLocked, setFormLocked] = useState(!!step?.locked);
    const [submitting, setSubmitting] = useState(false);

    // req #3742 — the lock is set here now that the step card has no padlock.
    // A step that STAYS locked takes no authoring write (the gateway would
    // refuse it, 423), so its fields are read-only until the lock is lifted.
    // A lock held by the INITIATIVE or the PLAN is not this step's to lift: the Lock
    // control is disabled and names the level that holds it.
    const inheritedLock = step?.lockedBy && step.lockedBy !== 'step' ? step.lockedBy : null;
    const lockHeld = !!inheritedLock || (!!step?.locked && formLocked);
    // Fields typed while unlocked, then re-locked before saving, would be
    // dropped by the no-write path — so a lock re-set over edits is refused.
    const editedThenRelocked = lockHeld && !inheritedLock && step && (
        formTitle !== (step.title || '')
        || formNotes !== (step.notes || '')
        || formRun !== runOf(step)
        || formBarrier !== barrierOf(step)
        || formNotBefore !== notBeforeToInputValue(step.not_before));

    const handleSubmit = async () => {
        const title = formTitle.trim();
        const notes = formNotes.trim();
        if (!title) {
            showError('Title is required');
            return;
        }
        if (isRestNullLiteral(title)) {
            showError(`"${REST_NULL}" is the API's clear-this-column sentinel and cannot `
                + 'be a title. Try "Null" or another wording.');
            return;
        }
        if (!step && (formInitiativeFk === '' || formInitiativeFk == null)) {
            showError('Initiative is required');
            return;
        }
        const notBeforeValue = inputValueToNotBefore(formNotBefore);
        if (editedThenRelocked) {
            showError('Unlock the step to save these edits, or cancel them.');
            return;
        }
        if (lockHeld) {
            onClose();
            return;
        }
        setSubmitting(true);
        try {
            if (step) {
                // One PUT: lifting the row's own lock may edit in the same
                // statement, and setting it is checked against the row's
                // current (unlocked) state (Lambda-Rest `plan_lock.py`).
                await updateStep(darwinUri, idToken, step.id, {
                    title,
                    notes: notes || REST_NULL,
                    run: formRun,
                    checkpoint: formBarrier ? 1 : 0,
                    not_before: notBeforeValue || REST_NULL,
                    ...(formLocked !== !!step.locked
                        ? { locked: formLocked ? 1 : 0 } : {}),
                });
            } else {
                await createStep(darwinUri, idToken, {
                    initiative_fk: formInitiativeFk,
                    title,
                    notes: notes || null,
                    run: formRun,
                    checkpoint: formBarrier ? 1 : 0,
                    not_before: notBeforeValue,
                });
            }
            await onSaved?.();
            onClose();
        } catch (err) {
            showError(err, step ? 'Could not save step' : 'Could not create step');
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <Dialog open={open} onClose={(_e, reason) => !submitting && onClose(reason)}
                maxWidth="md" fullWidth data-testid="step2-edit-dialog">
            <DialogTitle>{step ? `Edit step ${step.id}` : 'New step'}</DialogTitle>
            <DialogContent>
                <Stack spacing={2} sx={{ mt: 1 }}>
                    <FormControl fullWidth required disabled={!!step}>
                        <InputLabel>Initiative</InputLabel>
                        <Select label="Initiative" value={formInitiativeFk}
                                onChange={(e) => setFormInitiativeFk(e.target.value)}
                                data-testid="step2-initiative-select">
                            {initiativeOptions.map(e => (
                                <MenuItem key={e.id} value={e.id}>{e.title}</MenuItem>
                            ))}
                        </Select>
                    </FormControl>
                    {step && (
                        <Typography variant="caption" sx={{ color: 'text.secondary', mt: -1 }}>
                            A step&apos;s initiative is its identity. To move this step, delete it
                            and create it in the other initiative — that forces its dependencies to
                            be answered rather than silently broken.
                        </Typography>
                    )}
                    {step && (
                        <FormControl fullWidth disabled={!!inheritedLock}>
                            <InputLabel>Lock</InputLabel>
                            <Select label="Lock"
                                    value={formLocked || inheritedLock ? 'locked' : 'unlocked'}
                                    onChange={(e) => setFormLocked(e.target.value === 'locked')}
                                    data-testid="step2-locked-select">
                                <MenuItem value="unlocked">Unlocked — the step can be edited</MenuItem>
                                <MenuItem value="locked">Locked — frozen against edits (red on the plan)</MenuItem>
                            </Select>
                        </FormControl>
                    )}
                    {inheritedLock && (
                        <Typography variant="caption" sx={{ color: 'text.secondary', mt: -1 }}
                                    data-testid="step2-inherited-lock">
                            Locked by its {inheritedLock} — unlock the {inheritedLock} to edit
                            this step.
                        </Typography>
                    )}
                    <TextField
                        label="Title"
                        value={formTitle}
                        onChange={(e) => setFormTitle(e.target.value)}
                        helperText={lockHeld ? 'Locked — unlock to edit this step.'
                            : 'The step\'s short NAME — "Session Drain", not a sentence.'}
                        disabled={lockHeld}
                        autoFocus required fullWidth
                        slotProps={{ htmlInput: {
                            'data-testid': 'step2-title-input', maxLength: TITLE_MAX } }}
                    />
                    <TextField
                        label="Notes"
                        value={formNotes}
                        onChange={(e) => setFormNotes(e.target.value)}
                        helperText={'What this step must achieve and why. Never its dependencies, '
                            + 'status, membership or ordinal — those are rows, and prose that '
                            + 'restates them goes stale. Replaces on save; it does not append.'}
                        fullWidth multiline minRows={5} disabled={lockHeld}
                        slotProps={{ htmlInput: { 'data-testid': 'step2-notes-input' } }}
                    />
                    <FormControl fullWidth disabled={lockHeld}>
                        <InputLabel>Run</InputLabel>
                        <Select label="Run" value={formRun}
                                onChange={(e) => setFormRun(e.target.value)}
                                data-testid="step2-run-select">
                            <MenuItem value="auto">Auto — the orchestrator launches it</MenuItem>
                            <MenuItem value="manual">Manual — reported eligible, never launched</MenuItem>
                        </Select>
                    </FormControl>
                    <FormControl fullWidth disabled={lockHeld}>
                        <InputLabel>Barrier</InputLabel>
                        <Select label="Barrier" value={formBarrier ? 'on' : 'off'}
                                onChange={(e) => setFormBarrier(e.target.value === 'on')}
                                data-testid="step2-barrier-select">
                            <MenuItem value="on">
                                On — dependent steps start only when all of this step&apos;s
                                requirements are met, wontfix, deferred or paused
                            </MenuItem>
                            <MenuItem value="off">
                                Off (priority) — dependent steps may start once this
                                step&apos;s requirements have been started
                            </MenuItem>
                        </Select>
                    </FormControl>
                    <TextField
                        label="Not before"
                        type="datetime-local"
                        value={formNotBefore}
                        onChange={(e) => setFormNotBefore(e.target.value)}
                        helperText={'The one instant before which this step does not start. '
                            + 'Leave blank for no time gate.'}
                        fullWidth disabled={lockHeld}
                        slotProps={{
                            inputLabel: { shrink: true },
                            htmlInput: { 'data-testid': 'step2-not-before-input' },
                        }}
                    />
                    {formNotBefore && !lockHeld && (
                        <Button size="small" onClick={() => setFormNotBefore('')}
                                data-testid="step2-not-before-clear"
                                sx={{ alignSelf: 'flex-start', mt: -1 }}>
                            Clear time gate
                        </Button>
                    )}
                </Stack>
            </DialogContent>
            <DialogActions>
                <Button onClick={() => onClose()} disabled={submitting}>Cancel</Button>
                <Button variant="contained" onClick={handleSubmit}
                        disabled={submitting || !formTitle.trim()
                            || (!step && formInitiativeFk === '')}
                        data-testid="step2-save">
                    {step ? 'Save' : 'Create'}
                </Button>
            </DialogActions>
        </Dialog>
    );
}
