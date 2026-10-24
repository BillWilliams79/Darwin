// EpicEditDialog.jsx — the ONE epic editor (req #3742): create and edit a
// plan-layer epic. Lifted out of EpicsPage so the plan canvas can open the same
// editor over itself when an epic is clicked (user directive: "can it just
// popup over the visualizer instead of switch to the card view?"), rather than
// a second copy that would drift from this one.
//
// The caller mounts it with a fresh `key` per open, so the form seeds from
// `epic` once; it writes through epicsApi itself and reports back through
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
    createEpic,
    isRestNullLiteral,
    updateEpic,
} from './epicsApi';

const TITLE_MAX = 256;

// HTML `<input type="datetime-local">` reads/writes local wall-clock time with
// no timezone — `YYYY-MM-DDTHH:mm`. `not_before` is stored as a naive-UTC
// string (`YYYY-MM-DD HH:mm:ss`, the same convention `sqlNow()` in
// epicsApi.js writes and `formatDateTime` reads — see that file's header).
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

const runOf = (epic) => (VALID_RUN2_MODES.includes(epic?.run) ? epic.run : 'auto');
// req #3767 — the barrier is the epic's `checkpoint` column. Absent/NULL is the
// column default (on); the plan canvas passes a boolean, the Epics page 0/1.
const barrierOf = (epic) => epic?.checkpoint == null || Boolean(Number(epic.checkpoint));

/**
 * @param {Object} props
 * @param {boolean} props.open
 * @param {?Object} props.epic     the epic being edited — `{ id, initiative_fk, title,
 *                                 notes, run, not_before, checkpoint, locked,
 *                                 lockedBy }` —
 *                                 or null to create one
 * @param {Object[]} props.initiativeOptions  `{ id, title }` for the Initiative select
 * @param {*} [props.defaultInitiativeFk]     the Initiative a NEW epic starts in
 * @param {function} props.onClose
 * @param {function} props.onSaved      after a successful write, before onClose
 */
export default function EpicEditDialog({
    open, epic, initiativeOptions, defaultInitiativeFk = '', onClose, onSaved,
}) {
    const { idToken } = useContext(AuthContext);
    const { darwinUri } = useContext(AppContext);
    const showError = useSnackBarStore(s => s.showError);

    const [formInitiativeFk, setFormInitiativeFk] = useState(epic ? epic.initiative_fk : defaultInitiativeFk);
    const [formTitle, setFormTitle] = useState(epic?.title || '');
    const [formNotes, setFormNotes] = useState(epic?.notes || '');
    const [formRun, setFormRun] = useState(runOf(epic));
    const [formNotBefore, setFormNotBefore] = useState(notBeforeToInputValue(epic?.not_before));
    const [formBarrier, setFormBarrier] = useState(barrierOf(epic));
    const [formLocked, setFormLocked] = useState(!!epic?.locked);
    const [submitting, setSubmitting] = useState(false);
    const initiativeName = epic
        ? (initiativeOptions.find((o) => String(o.id) === String(epic.initiative_fk))?.title
            || (epic.initiative_fk == null ? '(none)' : `Initiative ${epic.initiative_fk}`))
        : null;

    // req #3742 — the lock is set here now that the epic card has no padlock.
    // An epic that STAYS locked takes no authoring write (the gateway would
    // refuse it, 423), so its fields are read-only until the lock is lifted.
    // A lock held by the INITIATIVE or the PLAN is not this epic's to lift: the Lock
    // control is disabled and names the level that holds it.
    const inheritedLock = epic?.lockedBy && epic.lockedBy !== 'epic' ? epic.lockedBy : null;
    const lockHeld = !!inheritedLock || (!!epic?.locked && formLocked);
    // Fields typed while unlocked, then re-locked before saving, would be
    // dropped by the no-write path — so a lock re-set over edits is refused.
    const editedThenRelocked = lockHeld && !inheritedLock && epic && (
        formTitle !== (epic.title || '')
        || formNotes !== (epic.notes || '')
        || formRun !== runOf(epic)
        || formBarrier !== barrierOf(epic)
        || formNotBefore !== notBeforeToInputValue(epic.not_before));

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
        if (!epic && (formInitiativeFk === '' || formInitiativeFk == null)) {
            showError('Initiative is required');
            return;
        }
        const notBeforeValue = inputValueToNotBefore(formNotBefore);
        if (editedThenRelocked) {
            showError('Unlock the epic to save these edits, or cancel them.');
            return;
        }
        if (lockHeld) {
            onClose();
            return;
        }
        setSubmitting(true);
        try {
            if (epic) {
                // One PUT: lifting the row's own lock may edit in the same
                // statement, and setting it is checked against the row's
                // current (unlocked) state (Lambda-Rest `plan_lock.py`).
                await updateEpic(darwinUri, idToken, epic.id, {
                    title,
                    notes: notes || REST_NULL,
                    run: formRun,
                    checkpoint: formBarrier ? 1 : 0,
                    not_before: notBeforeValue || REST_NULL,
                    ...(formLocked !== !!epic.locked
                        ? { locked: formLocked ? 1 : 0 } : {}),
                });
            } else {
                await createEpic(darwinUri, idToken, {
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
            showError(err, epic ? 'Could not save epic' : 'Could not create epic');
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <Dialog open={open} onClose={(_e, reason) => !submitting && onClose(reason)}
                maxWidth="md" fullWidth data-testid="epic-edit-dialog">
            <DialogTitle>{epic ? `Edit epic ${epic.id}` : 'New epic'}</DialogTitle>
            <DialogContent>
                <Stack spacing={2} sx={{ mt: 1 }}>
                    {/* req #3800 — the NAME is the first field. A greyed-out parent
                        selector used to open this dialog, captioned with why it could
                        not change, and read as "the name cannot be edited". */}
                    <TextField
                        label="Title"
                        value={formTitle}
                        onChange={(e) => setFormTitle(e.target.value)}
                        helperText={lockHeld ? 'Locked — unlock to edit this epic.'
                            : 'The epic\'s short NAME — "Session Drain", not a sentence.'}
                        disabled={lockHeld}
                        autoFocus required fullWidth
                        slotProps={{ htmlInput: {
                            'data-testid': 'epic-title-input', maxLength: TITLE_MAX } }}
                    />
                    {epic ? (
                        // An epic's initiative is its identity, so on edit it is a fact
                        // shown as text, not a disabled control competing with the name.
                        <Typography variant="body2" sx={{ color: 'text.secondary' }}
                                    data-testid="epic-initiative-readonly">
                            Initiative: <strong>{initiativeName}</strong> — to move this epic,
                            delete it and create it in the other initiative, so its
                            dependencies are answered rather than silently broken.
                        </Typography>
                    ) : (
                        <FormControl fullWidth required>
                            <InputLabel>Initiative</InputLabel>
                            <Select label="Initiative" value={formInitiativeFk}
                                    onChange={(e) => setFormInitiativeFk(e.target.value)}
                                    data-testid="epic-initiative-select">
                                {initiativeOptions.map(e => (
                                    <MenuItem key={e.id} value={e.id}>{e.title}</MenuItem>
                                ))}
                            </Select>
                        </FormControl>
                    )}
                    {epic && (
                        <FormControl fullWidth disabled={!!inheritedLock}>
                            <InputLabel>Lock</InputLabel>
                            <Select label="Lock"
                                    value={formLocked || inheritedLock ? 'locked' : 'unlocked'}
                                    onChange={(e) => setFormLocked(e.target.value === 'locked')}
                                    data-testid="epic-locked-select">
                                <MenuItem value="unlocked">Unlocked — the epic can be edited</MenuItem>
                                <MenuItem value="locked">Locked — frozen against edits (red on the plan)</MenuItem>
                            </Select>
                        </FormControl>
                    )}
                    {inheritedLock && (
                        <Typography variant="caption" sx={{ color: 'text.secondary', mt: -1 }}
                                    data-testid="epic-inherited-lock">
                            Locked by its {inheritedLock} — unlock the {inheritedLock} to edit
                            this epic.
                        </Typography>
                    )}
                    <TextField
                        label="Notes"
                        value={formNotes}
                        onChange={(e) => setFormNotes(e.target.value)}
                        helperText={'What this epic must achieve and why. Never its dependencies, '
                            + 'status, membership or ordinal — those are rows, and prose that '
                            + 'restates them goes stale. Replaces on save; it does not append.'}
                        fullWidth multiline minRows={5} disabled={lockHeld}
                        slotProps={{ htmlInput: { 'data-testid': 'epic-notes-input' } }}
                    />
                    <FormControl fullWidth disabled={lockHeld}>
                        <InputLabel>Run</InputLabel>
                        <Select label="Run" value={formRun}
                                onChange={(e) => setFormRun(e.target.value)}
                                data-testid="epic-run-select">
                            <MenuItem value="auto">Auto — the orchestrator launches it</MenuItem>
                            <MenuItem value="manual">Manual — reported eligible, never launched</MenuItem>
                        </Select>
                    </FormControl>
                    <FormControl fullWidth disabled={lockHeld}>
                        <InputLabel>Barrier</InputLabel>
                        <Select label="Barrier" value={formBarrier ? 'on' : 'off'}
                                onChange={(e) => setFormBarrier(e.target.value === 'on')}
                                data-testid="epic-barrier-select">
                            <MenuItem value="on">
                                On — dependent epics start only when all of this epic&apos;s
                                requirements are met, wontfix, deferred or paused
                            </MenuItem>
                            <MenuItem value="off">
                                Off (priority) — dependent epics may start once this
                                epic&apos;s requirements have been started
                            </MenuItem>
                        </Select>
                    </FormControl>
                    <TextField
                        label="Not before"
                        type="datetime-local"
                        value={formNotBefore}
                        onChange={(e) => setFormNotBefore(e.target.value)}
                        helperText={'The one instant before which this epic does not start. '
                            + 'Leave blank for no time gate.'}
                        fullWidth disabled={lockHeld}
                        slotProps={{
                            inputLabel: { shrink: true },
                            htmlInput: { 'data-testid': 'epic-not-before-input' },
                        }}
                    />
                    {formNotBefore && !lockHeld && (
                        <Button size="small" onClick={() => setFormNotBefore('')}
                                data-testid="epic-not-before-clear"
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
                            || (!epic && formInitiativeFk === '')}
                        data-testid="epic-save">
                    {epic ? 'Save' : 'Create'}
                </Button>
            </DialogActions>
        </Dialog>
    );
}
