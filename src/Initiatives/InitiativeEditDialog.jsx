// InitiativeEditDialog.jsx — the ONE initiative editor (req #3742): create and edit a
// plan-layer initiative. Lifted out of InitiativesPage so the plan canvas can open the same
// editor over itself when an initiative's name is clicked, rather than a second copy
// that would drift from this one.
//
// The caller mounts it with a fresh `key` per open, so the form seeds from
// `initiative` once; it reads its own category list, writes through initiativesApi itself,
// and reports back through `onSaved` (the caller invalidates or re-reads what
// it draws) and `onClose`.
//
// req #3967 — an existing initiative also gets a Delete: it reads what the delete
// would touch (`planInitiativeDelete`) and confirms with the counts and three
// choices — the initiative goes; its epics go by default (or move to another
// initiative of the plan); the requirements in them stay by default. Every
// dependency onto what is deleted is detached.

import { useContext, useMemo, useState } from 'react';

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
import FormHelperText from '@mui/material/FormHelperText';
import ListItemText from '@mui/material/ListItemText';
import Checkbox from '@mui/material/Checkbox';
import FormControlLabel from '@mui/material/FormControlLabel';
import Alert from '@mui/material/Alert';
import { useQueryClient } from '@tanstack/react-query';

import AuthContext from '../Context/AuthContext';
import AppContext from '../Context/AppContext';
import { useAllCategories } from '../hooks/useDataQueries';
import { useSnackBarStore } from '../stores/useSnackBarStore';
import { createInitiative, updateInitiative, isRestNullLiteral, REST_NULL,
    setInitiativeDeps, planInitiativeDelete, deleteInitiativeWithOptions } from './initiativesApi';
import { initiativeDepEdit } from '../SwarmView/pipelines/pipelineInitiativeDeps';
import { pipelineComposeKeys, requirementKeys, pipelineEpicKeys,
    pipelineEpicRequirementKeys } from '../hooks/useQueryKeys';

// Same projection 1.0's InitiativesPage requests — a NAME DICTIONARY, no `closed`
// filter (an initiative filed under a since-closed category must still render it).
export const CATEGORY_FIELDS = 'id,category_name,color,sort_order,closed';

// SMALLINT — the column's real width.
const SORT_ORDER_MIN = -32768;
const SORT_ORDER_MAX = 32767;

// sort_order is a SMALLINT fed by a text input — three answers, not two:
// EMPTY, a usable integer, and INVALID. Initiatives have a HARD order (req
// #3861), so EMPTY never clears the column: a new initiative is appended to its
// plan, and an edit leaves the stored place as it is.
export const parseSortOrder = (raw) => {
    const t = (raw ?? '').trim();
    if (t === '') return { empty: true };
    const n = Number(t);
    if (!Number.isInteger(n)) return { invalid: 'Sort order must be a whole number' };
    if (n < SORT_ORDER_MIN || n > SORT_ORDER_MAX) {
        return { invalid: `Sort order must be between ${SORT_ORDER_MIN} and ${SORT_ORDER_MAX}` };
    }
    return { value: n };
};

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const idList = (ids) => ids.join(', ');

/**
 * What the delete does, one line per kind of row, in the confirmation's words
 * (req #3967) — every count stated whether the rows go or stay.
 *
 * @param {Object} planned  `planInitiativeDelete`'s answer
 * @param {Object} choices  `{ deleteEpics, moveToTitle, deleteRequirements }`
 * @returns {string[]}
 */
export const initiativeDeleteConsequence = (planned, { deleteEpics, moveToTitle, deleteRequirements }) => {
    const { initiative, epics, reqIds, outsideDependents, waitingEdges } = planned;
    const lines = [`Delete initiative ${initiative.id} "${initiative.title || ''}"? `
        + 'This is permanent — there is no undo.'];
    const epicIds = epics.map((e) => e.id);
    if (!epicIds.length) {
        lines.push('Epics: it holds none.');
    } else if (deleteEpics) {
        lines.push(`Epics: ${plural(epicIds.length, 'epic')} deleted (${idList(epicIds)}).`);
    } else {
        lines.push(`Epics: ${plural(epicIds.length, 'epic')} kept (${idList(epicIds)}) — moved to `
            + `"${moveToTitle || '?'}" with their dependencies.`);
    }
    if (!reqIds.length) {
        lines.push('Requirements: its epics hold none.');
    } else if (deleteRequirements) {
        lines.push(`Requirements: ${plural(reqIds.length, 'requirement')} deleted (${idList(reqIds)}).`);
    } else {
        lines.push(`Requirements: ${plural(reqIds.length, 'requirement')} kept — `
            + (deleteEpics || !epicIds.length ? 'un-orchestrated, not deleted.'
                : 'still seated in their epics.'));
    }
    const waiting = [...new Set(waitingEdges.map((r) => r.initiative_fk))].sort((a, b) => a - b);
    const detached = [];
    if (deleteEpics && outsideDependents.length) {
        detached.push(`${outsideDependents.length === 1 ? 'epic' : 'epics'} `
            + `${idList(outsideDependents)} outside it stop${outsideDependents.length === 1 ? 's' : ''} `
            + 'waiting on its epics');
    }
    if (waiting.length) {
        detached.push(`${waiting.length === 1 ? 'initiative' : 'initiatives'} ${idList(waiting)} `
            + `stop${waiting.length === 1 ? 's' : ''} waiting on it`);
    }
    if (detached.length) lines.push(`Dependencies detached: ${detached.join('; ')}.`);
    return lines;
};

/**
 * @param {Object} props
 * @param {boolean} props.open
 * @param {?Object} props.initiative           the initiative row being edited, or null to create one
 * @param {Object[]} props.pipelineOptions  `{ id, title }` for the Pipeline select
 * @param {?number} [props.defaultPipelineFk] a new initiative's pipeline (req #3864),
 *                                          else the first option; ignored on edit
 * @param {function} props.onClose
 * @param {function} props.onSaved          after a successful write, before onClose
 * @param {?Object} [props.dependencies]    req #3823 — editing an EXISTING initiative's
 *   "waits for" set: `{ choices, rows }` — `choices` from `dependencyChoices`
 *   (the other initiatives of its plan, a cycle-closing one disabled), `rows`
 *   its own `initiative_deps` rows. Absent, the field is not shown.
 */
export default function InitiativeEditDialog({
    open, initiative, pipelineOptions, defaultPipelineFk, onClose, onSaved,
    dependencies = null,
}) {
    const { idToken, profile } = useContext(AuthContext);
    const { darwinUri } = useContext(AppContext);
    const showError = useSnackBarStore(s => s.showError);
    const queryClient = useQueryClient();
    const { data: categories = [] } =
        useAllCategories(profile?.userName, { fields: CATEGORY_FIELDS });

    const categoryOptions = useMemo(() => {
        const open = categories.filter(c => !c.closed).sort((a, b) => {
            const ao = a.sort_order == null ? Infinity : a.sort_order;
            const bo = b.sort_order == null ? Infinity : b.sort_order;
            return ao - bo || String(a.category_name).localeCompare(String(b.category_name));
        });
        const current = initiative?.category_fk;
        if (current != null && !open.some(c => c.id === current)) {
            const row = categories.find(c => c.id === current);
            if (row) return [...open, row];
        }
        return open;
    }, [categories, initiative]);

    const [formPipelineFk, setFormPipelineFk] = useState(
        initiative ? (initiative.pipeline_fk ?? '')
            : (defaultPipelineFk ?? pipelineOptions[0]?.id ?? ''));
    const [formTitle, setFormTitle] = useState(initiative?.title || '');
    const [formDescription, setFormDescription] = useState(initiative?.description || '');
    // A new initiative's category is the first open one, once the list has loaded.
    const [formCategoryFk, setFormCategoryFk] = useState(initiative ? (initiative.category_fk ?? '') : null);
    const categoryValue = formCategoryFk ?? (categoryOptions.find(c => !c.closed)?.id ?? '');
    const [formSortOrder, setFormSortOrder] = useState(
        initiative?.sort_order == null ? '' : String(initiative.sort_order));
    const [formInitiativeStatus, setFormInitiativeStatus] = useState(
        initiative?.initiative_status === 'paused' ? 'paused' : 'active');
    const [submitting, setSubmitting] = useState(false);
    // req #3967 — the delete: null until asked for, then the live plan of what
    // it touches, and the reader's three choices.
    const [deletePlan, setDeletePlan] = useState(null);
    const [deleteEpics, setDeleteEpics] = useState(true);
    const [deleteReqs, setDeleteReqs] = useState(false);
    const [moveTo, setMoveTo] = useState('');
    const pipelineName = initiative
        ? (pipelineOptions.find((p) => String(p.id) === String(initiative.pipeline_fk))?.title
            || `Pipeline ${initiative.pipeline_fk}`)
        : null;
    // req #3823 — the initiatives this one WAITS FOR: no epic under it launches
    // while any epic under one of them holds open work.
    // The field shows the rows AS THEY ARE until the reader changes it; from
    // then on it shows their choice, and a save applies only their delta
    // (`initiativeDepEdit`) — never a snapshot that could drop an edge which
    // arrived after the dialog opened. Untouched, nothing is written.
    const depRows = dependencies?.rows || [];
    const currentDepIds = depRows.map((r) => r.dep_initiative_fk);
    const [depEdit, setDepEdit] = useState(null);       // { seen, chosen } once touched
    const formDepIds = depEdit ? depEdit.chosen : currentDepIds;
    // An edge to an initiative the choices do not offer (another plan's — a
    // dangling edge) is still listed, so it can be unticked.
    const depChoices = [...(dependencies?.choices || []),
        ...formDepIds.filter((id) => !(dependencies?.choices || []).some((c) => c.id === id))
            .map((id) => ({ id, title: `Initiative ${id}`, disabled: false,
                reason: 'not in this plan — untick to remove' }))];
    const depTitle = (id) => depChoices.find((c) => c.id === id)?.title ?? `Initiative ${id}`;

    const startDelete = async () => {
        setSubmitting(true);
        try {
            const planned = await planInitiativeDelete(darwinUri, idToken, initiative.id);
            setDeleteEpics(true);
            setDeleteReqs(false);
            setMoveTo(planned.moveTargets.find((t) => !t.cycle)?.id ?? '');
            setDeletePlan(planned);
        } catch (err) {
            showError(err?.namedRefusal ? err.message : err, 'Could not read what the delete would touch');
        } finally {
            setSubmitting(false);
        }
    };

    const cancelDelete = () => setDeletePlan(null);
    // A locked epic outside waiting on one of its epics blocks only DELETING
    // them: kept, they move with that edge intact.
    const deleteBlocked = deletePlan
        && (deletePlan.blocked || (deleteEpics ? deletePlan.blockedDeletingEpics : null));

    const handleDelete = async () => {
        setSubmitting(true);
        let deleted = false;
        try {
            await deleteInitiativeWithOptions(darwinUri, idToken, deletePlan, {
                deleteEpics,
                moveToInitiativeFk: deleteEpics ? null : moveTo,
                deleteRequirements: deleteReqs,
            });
            deleted = true;
        } catch (err) {
            deleted = !!err?.initiativeDeleted;
            if (!deleted) setDeletePlan(null);
            const status = err?.httpStatus?.httpStatus;
            const reason = err?.httpStatus?.httpDetail?.message;
            if (err?.namedRefusal || err?.initiativeDeleted) showError(err.message);
            else if (reason) showError(`Could not delete initiative (${status}) — ${reason}`);
            else showError(err, 'Could not delete initiative');
        } finally {
            setSubmitting(false);
        }
        // Re-read either way: after a failure, whatever landed (or its
        // rollback) is the plan now. Epics, seats and requirements are every
        // page's reads, not only the caller's.
        const creatorFk = profile?.userName;
        await Promise.all([
            queryClient.invalidateQueries({ queryKey: pipelineComposeKeys.all }),
            creatorFk && queryClient.invalidateQueries({ queryKey: pipelineEpicKeys.all(creatorFk) }),
            creatorFk && queryClient.invalidateQueries({
                queryKey: pipelineEpicRequirementKeys.all(creatorFk) }),
            // Deleted or only un-seated, requirements change (`pipelined` is derived).
            creatorFk && queryClient.invalidateQueries({ queryKey: requirementKeys.all(creatorFk) }),
            onSaved?.(),
        ]);
        if (deleted) onClose();
    };

    // Whether Save would write anything (req #4171) — what Esc must not lose silently.
    const editsPending = () => {
        const sameText = (a, b) => String(a ?? '').trim() === String(b ?? '').trim();
        if (depEdit) return true;
        if (!initiative) {
            return formTitle.trim() !== '' || formDescription.trim() !== '';
        }
        return !sameText(formTitle, initiative.title)
            || !sameText(formDescription, initiative.description)
            || String(formPipelineFk ?? '') !== String(initiative.pipeline_fk ?? '')
            || String(categoryValue ?? '') !== String(initiative.category_fk ?? '')
            || String(formSortOrder).trim() !== (initiative.sort_order == null ? '' : String(initiative.sort_order))
            || formInitiativeStatus !== (initiative.initiative_status === 'paused' ? 'paused' : 'active');
    };

    const handleSubmit = async () => {
        const title = formTitle.trim();
        const description = formDescription.trim();
        const sortOrder = parseSortOrder(formSortOrder);
        if (!title) {
            showError('Title is required');
            return;
        }
        // `title` is NOT NULL — a typed "NULL" is Lambda-Rest's clear-column
        // sentinel on BOTH POST and PUT, so it would otherwise reach the
        // gateway as SQL NULL and fail as an opaque 500 (code review, req
        // #3393; matches EpicsPage's identical guard for its own title field).
        if (isRestNullLiteral(title)) {
            showError(`"${REST_NULL}" is the API's clear-this-column sentinel and cannot `
                + 'be a title. Try "Null" or another wording.');
            return;
        }
        if (!initiative && (formPipelineFk === '' || formPipelineFk == null)) {
            showError('Pipeline is required');
            return;
        }
        if (categoryValue === '' || categoryValue == null) {
            showError('Category is required');
            return;
        }
        if (sortOrder.invalid) {
            showError(sortOrder.invalid);
            return;
        }
        setSubmitting(true);
        try {
            // req #3823 — the dependency set FIRST: a refusal (a cycle, a lock)
            // arrives with the server's reason and nothing else is written.
            if (initiative && dependencies && depEdit) {
                await setInitiativeDeps(darwinUri, idToken, initiative.id,
                    initiativeDepEdit(depRows, depEdit.seen, depEdit.chosen));
            }
            if (initiative) {
                // `pipeline_fk` is deliberately never sent here — the field is
                // read-only text once editing (see InitiativesPage's header).
                await updateInitiative(darwinUri, idToken, initiative.id, {
                    title,
                    description: description || REST_NULL,
                    category_fk: categoryValue,
                    ...(sortOrder.empty ? null : { sort_order: sortOrder.value }),
                    initiative_status: formInitiativeStatus,
                });
            } else {
                await createInitiative(darwinUri, idToken, {
                    pipeline_fk: formPipelineFk,
                    title,
                    description: description || null,
                    category_fk: categoryValue,
                    sort_order: sortOrder.empty ? null : sortOrder.value,
                    initiative_status: formInitiativeStatus,
                });
            }
            await onSaved?.();
            onClose();
        } catch (err) {
            // A dependency save can refuse part-way (adds go one at a time), so
            // the caller re-reads what actually landed before the reader retries.
            if (initiative && dependencies && depEdit) {
                try { await onSaved?.(); } catch { /* the original error is the one to show */ }
            }
            // The SERVER'S REASON, when it gave one (req #3823): a dependency
            // that would close a loop, or cross a plan, is refused with a
            // sentence naming the initiatives — a bare status would hide it.
            // `call_rest_api` throws `{data, httpStatus}`; a structured refusal
            // (409 CONFLICT, 423 LOCKED) carries its sentence on `httpDetail`.
            const reason = err?.httpStatus?.httpDetail?.message;
            const what = initiative ? 'Could not save initiative' : 'Could not create initiative';
            if (reason) {
                showError(`${what} (${err.httpStatus.httpStatus}) — ${reason}`);
            } else {
                showError(err, what);
            }
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <Dialog open={open} onClose={(_e, reason) => {
                    if (submitting) return;
                    // Esc / backdrop over typed-but-unsaved edits asks first (req #4171);
                    // the Cancel button is the explicit discard and never asks.
                    if ((reason === 'escapeKeyDown' || reason === 'backdropClick') && editsPending()
                        && !window.confirm('Discard unsaved changes to this initiative?')) return;
                    onClose(reason);
                }}
                maxWidth="md" fullWidth data-testid="initiative-edit-dialog">
            <DialogTitle>{initiative ? `Edit initiative ${initiative.id}` : 'New initiative'}</DialogTitle>
            <DialogContent>
                <Stack spacing={2} sx={{ mt: 1 }}>
                    {/* req #3800 — the NAME is the first field. A greyed-out Pipeline
                        select used to open this dialog, captioned with an MCP tool
                        name, and read as "the name cannot be edited". */}
                    <TextField
                        label="Title"
                        value={formTitle}
                        onChange={(e) => setFormTitle(e.target.value)}
                        autoFocus required fullWidth
                        slotProps={{ htmlInput: { 'data-testid': 'initiative-title-input', maxLength: 256 } }}
                    />
                    {initiative ? (
                        // Its plan is a fact on edit (pipeline_fk is never sent), so
                        // it is shown as text rather than as a disabled control.
                        <Typography variant="body2" sx={{ color: 'text.secondary' }}
                                    data-testid="initiative-pipeline-readonly">
                            Plan: <strong>{pipelineName}</strong> — moving an initiative to
                            another plan is not done from this editor.
                        </Typography>
                    ) : (
                        <FormControl fullWidth required>
                            <InputLabel>Pipeline</InputLabel>
                            <Select label="Pipeline" value={formPipelineFk}
                                    onChange={(e) => setFormPipelineFk(e.target.value)}
                                    data-testid="initiative-pipeline-select">
                                {pipelineOptions.map(p => (
                                    <MenuItem key={p.id} value={p.id}>{p.title}</MenuItem>
                                ))}
                            </Select>
                        </FormControl>
                    )}
                    <TextField
                        label="Description"
                        value={formDescription}
                        onChange={(e) => setFormDescription(e.target.value)}
                        helperText="What this initiative is for — purpose, not a fact a query can answer."
                        fullWidth multiline minRows={6}
                        slotProps={{ htmlInput: { 'data-testid': 'initiative-description-input' } }}
                    />
                    <FormControl fullWidth required>
                        <InputLabel>Category</InputLabel>
                        <Select label="Category" value={categoryValue}
                                onChange={(e) => setFormCategoryFk(e.target.value)}
                                data-testid="initiative-category-select">
                            {categoryOptions.map(c => (
                                <MenuItem key={c.id} value={c.id}>{c.category_name}</MenuItem>
                            ))}
                        </Select>
                    </FormControl>
                    <FormControl fullWidth>
                        <InputLabel>Pause state</InputLabel>
                        <Select label="Pause state" value={formInitiativeStatus}
                                onChange={(e) => setFormInitiativeStatus(e.target.value)}
                                data-testid="initiative-status-select">
                            <MenuItem value="active">Active — swarm-starts normally</MenuItem>
                            <MenuItem value="paused">Paused — suppresses swarm-start</MenuItem>
                        </Select>
                    </FormControl>
                    {initiative && dependencies && (
                        <FormControl fullWidth>
                            <InputLabel>Waits for</InputLabel>
                            <Select label="Waits for" multiple value={formDepIds}
                                    onChange={(e) => {
                                        const chosen = typeof e.target.value === 'string'
                                            ? e.target.value.split(',').map(Number) : e.target.value;
                                        setDepEdit((prev) => ({ seen: prev?.seen ?? currentDepIds, chosen }));
                                    }}
                                    renderValue={(ids) => ids.map(depTitle).join(', ')}
                                    data-testid="initiative-deps-select">
                                {depChoices.map((c) => (
                                    <MenuItem key={c.id} value={c.id}
                                              disabled={c.disabled && !formDepIds.includes(c.id)}
                                              data-testid={`initiative-deps-option-${c.id}`}>
                                        <Checkbox size="small" checked={formDepIds.includes(c.id)} />
                                        <ListItemText primary={c.title} secondary={c.reason} />
                                    </MenuItem>
                                ))}
                            </Select>
                            <FormHelperText>
                                No epic of this initiative launches while any epic of an initiative
                                it waits for holds open work. Only this plan&apos;s initiatives; a
                                dependency that would close a loop is refused.
                            </FormHelperText>
                        </FormControl>
                    )}
                    <TextField
                        label="Sort order"
                        value={formSortOrder}
                        onChange={(e) => setFormSortOrder(e.target.value)}
                        helperText={"Whole number, position among this plan's initiatives — "
                            + "or drag the initiative's name bar on the plan. Leave blank to "
                            + (initiative ? 'keep its place.' : 'add it at the end.')}
                        type="number" fullWidth
                        slotProps={{ htmlInput: {
                            'data-testid': 'initiative-sort-order-input',
                            step: 1, min: SORT_ORDER_MIN, max: SORT_ORDER_MAX,
                        } }}
                    />
                </Stack>
            </DialogContent>
            {deletePlan && (() => {
                const hasEpics = deletePlan.epics.length > 0;
                const canKeepEpics = hasEpics && deletePlan.moveTargets.some((t) => !t.cycle);
                const moveToTitle = deletePlan.moveTargets.find((t) => t.id === moveTo)?.title;
                const reqCount = deletePlan.reqIds.length;
                return (
                    <Stack spacing={1} sx={{ mx: 3, mt: 1 }} data-testid="initiative-delete-panel">
                        {deleteBlocked && (
                            <Alert severity="error" data-testid="initiative-delete-blocked">
                                {deleteBlocked}
                            </Alert>
                        )}
                        <Alert severity="warning" data-testid="initiative-delete-consequence">
                            {initiativeDeleteConsequence(deletePlan,
                                { deleteEpics, moveToTitle, deleteRequirements: deleteReqs })
                                .map((line) => <div key={line}>{line}</div>)}
                        </Alert>
                        <FormControlLabel
                            control={<Checkbox checked={deleteEpics || !canKeepEpics}
                                               disabled={submitting || !canKeepEpics}
                                               onChange={(e) => setDeleteEpics(e.target.checked)}
                                               slotProps={{ input: {
                                                   'data-testid': 'initiative-delete-epics' } }} />}
                            label={!hasEpics ? 'Delete its epics — it holds none'
                                : `Delete its ${plural(deletePlan.epics.length, 'epic')}`
                                    + (canKeepEpics ? ''
                                        : ' — no other unlocked initiative in this plan to keep them in')} />
                        {!deleteEpics && canKeepEpics && (
                            <FormControl fullWidth size="small">
                                <InputLabel>Move its epics to</InputLabel>
                                <Select label="Move its epics to" value={moveTo}
                                        onChange={(e) => setMoveTo(e.target.value)}
                                        disabled={submitting}
                                        data-testid="initiative-delete-move-target">
                                    {deletePlan.moveTargets.map((t) => (
                                        <MenuItem key={t.id} value={t.id} disabled={t.cycle}
                                                  data-testid={`initiative-delete-move-option-${t.id}`}>
                                            <ListItemText primary={t.title}
                                                secondary={t.cycle
                                                    ? 'its epics there would close a dependency loop'
                                                    : null} />
                                        </MenuItem>
                                    ))}
                                </Select>
                            </FormControl>
                        )}
                        <FormControlLabel
                            control={<Checkbox checked={deleteReqs}
                                               disabled={submitting || !reqCount}
                                               onChange={(e) => setDeleteReqs(e.target.checked)}
                                               slotProps={{ input: {
                                                   'data-testid': 'initiative-delete-requirements' } }} />}
                            label={reqCount
                                ? `Delete the ${plural(reqCount, 'requirement')} in its epics — permanently`
                                : 'Delete the requirements in its epics — they hold none'} />
                    </Stack>
                );
            })()}
            {deletePlan ? (
                <DialogActions>
                    <Button onClick={cancelDelete} disabled={submitting}
                            data-testid="initiative-delete-keep">Keep initiative</Button>
                    <Button variant="contained" color="error" onClick={handleDelete}
                            disabled={submitting || !!deleteBlocked
                                || (!deleteEpics && moveTo === '')}
                            data-testid="initiative-delete-confirm">
                        {submitting ? 'Deleting…' : 'Delete initiative'}
                    </Button>
                </DialogActions>
            ) : (
            <DialogActions>
                {initiative && (
                    <Button color="error" onClick={startDelete} disabled={submitting}
                            sx={{ mr: 'auto' }} aria-label={`Delete initiative ${initiative.id}`}
                            data-testid="initiative-delete">
                        Delete
                    </Button>
                )}
                <Button onClick={() => onClose()} disabled={submitting}>Cancel</Button>
                <Button variant="contained" onClick={handleSubmit}
                        disabled={submitting || !formTitle.trim() || categoryValue === ''
                            || (!initiative && formPipelineFk === '')}
                        data-testid="initiative-save">
                    {initiative ? 'Save' : 'Create'}
                </Button>
            </DialogActions>
            )}
        </Dialog>
    );
}
