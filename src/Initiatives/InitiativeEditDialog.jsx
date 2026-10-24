// InitiativeEditDialog.jsx — the ONE initiative editor (req #3742): create and edit a
// plan-layer initiative. Lifted out of InitiativesPage so the plan canvas can open the same
// editor over itself when an initiative's name is clicked, rather than a second copy
// that would drift from this one.
//
// The caller mounts it with a fresh `key` per open, so the form seeds from
// `initiative` once; it reads its own category list, writes through initiativesApi itself,
// and reports back through `onSaved` (the caller invalidates or re-reads what
// it draws) and `onClose`.

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

import AuthContext from '../Context/AuthContext';
import AppContext from '../Context/AppContext';
import { useAllCategories } from '../hooks/useDataQueries';
import { useSnackBarStore } from '../stores/useSnackBarStore';
import { createInitiative, updateInitiative, isRestNullLiteral, REST_NULL } from './initiativesApi';

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
const parseSortOrder = (raw) => {
    const t = (raw ?? '').trim();
    if (t === '') return { empty: true };
    const n = Number(t);
    if (!Number.isInteger(n)) return { invalid: 'Sort order must be a whole number' };
    if (n < SORT_ORDER_MIN || n > SORT_ORDER_MAX) {
        return { invalid: `Sort order must be between ${SORT_ORDER_MIN} and ${SORT_ORDER_MAX}` };
    }
    return { value: n };
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
 */
export default function InitiativeEditDialog({
    open, initiative, pipelineOptions, defaultPipelineFk, onClose, onSaved,
}) {
    const { idToken, profile } = useContext(AuthContext);
    const { darwinUri } = useContext(AppContext);
    const showError = useSnackBarStore(s => s.showError);
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
    const pipelineName = initiative
        ? (pipelineOptions.find((p) => String(p.id) === String(initiative.pipeline_fk))?.title
            || `Pipeline ${initiative.pipeline_fk}`)
        : null;

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
            showError(err, initiative ? 'Could not save initiative' : 'Could not create initiative');
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <Dialog open={open} onClose={(_e, reason) => !submitting && onClose(reason)}
                maxWidth="md" fullWidth data-testid="initiative-edit-dialog">
            <DialogTitle>{initiative ? 'Edit initiative' : 'New initiative'}</DialogTitle>
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
            <DialogActions>
                <Button onClick={() => onClose()} disabled={submitting}>Cancel</Button>
                <Button variant="contained" onClick={handleSubmit}
                        disabled={submitting || !formTitle.trim() || categoryValue === ''
                            || (!initiative && formPipelineFk === '')}
                        data-testid="initiative-save">
                    {initiative ? 'Save' : 'Create'}
                </Button>
            </DialogActions>
        </Dialog>
    );
}
