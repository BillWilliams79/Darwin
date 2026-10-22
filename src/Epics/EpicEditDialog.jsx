// EpicEditDialog.jsx — the ONE epic editor (req #3742): create and edit a
// plan-layer epic. Lifted out of EpicsPage so the plan canvas can open the same
// editor over itself when an epic's name is clicked, rather than a second copy
// that would drift from this one.
//
// The caller mounts it with a fresh `key` per open, so the form seeds from
// `epic` once; it reads its own category list, writes through epicsApi itself,
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
import { createEpic, updateEpic, isRestNullLiteral, REST_NULL } from './epicsApi';

// Same projection 1.0's EpicsPage requests — a NAME DICTIONARY, no `closed`
// filter (an epic filed under a since-closed category must still render it).
export const CATEGORY_FIELDS = 'id,category_name,color,sort_order,closed';

// SMALLINT — the column's real width.
const SORT_ORDER_MIN = -32768;
const SORT_ORDER_MAX = 32767;

// sort_order is a nullable SMALLINT fed by a text input — three answers, not
// two: EMPTY (clear the column), a usable integer, and INVALID.
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
 * @param {?Object} props.epic           the epic row being edited, or null to create one
 * @param {Object[]} props.pipelineOptions  `{ id, title }` for the Pipeline select
 * @param {function} props.onClose
 * @param {function} props.onSaved          after a successful write, before onClose
 */
export default function EpicEditDialog({ open, epic, pipelineOptions, onClose, onSaved }) {
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
        const current = epic?.category_fk;
        if (current != null && !open.some(c => c.id === current)) {
            const row = categories.find(c => c.id === current);
            if (row) return [...open, row];
        }
        return open;
    }, [categories, epic]);

    const [formPipelineFk, setFormPipelineFk] = useState(
        epic ? (epic.pipeline_fk ?? '') : (pipelineOptions[0]?.id ?? ''));
    const [formTitle, setFormTitle] = useState(epic?.title || '');
    const [formDescription, setFormDescription] = useState(epic?.description || '');
    // A new epic's category is the first open one, once the list has loaded.
    const [formCategoryFk, setFormCategoryFk] = useState(epic ? (epic.category_fk ?? '') : null);
    const categoryValue = formCategoryFk ?? (categoryOptions.find(c => !c.closed)?.id ?? '');
    const [formSortOrder, setFormSortOrder] = useState(
        epic?.sort_order == null ? '' : String(epic.sort_order));
    const [formEpicStatus, setFormEpicStatus] = useState(
        epic?.epic_status === 'paused' ? 'paused' : 'active');
    const [submitting, setSubmitting] = useState(false);

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
        // #3393; matches StepsPage's identical guard for its own title field).
        if (isRestNullLiteral(title)) {
            showError(`"${REST_NULL}" is the API's clear-this-column sentinel and cannot `
                + 'be a title. Try "Null" or another wording.');
            return;
        }
        if (!epic && (formPipelineFk === '' || formPipelineFk == null)) {
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
            if (epic) {
                // `pipeline_fk` is deliberately never sent here — the field is
                // disabled once editing (see EpicsPage's header).
                await updateEpic(darwinUri, idToken, epic.id, {
                    title,
                    description: description || REST_NULL,
                    category_fk: categoryValue,
                    sort_order: sortOrder.empty ? REST_NULL : sortOrder.value,
                    epic_status: formEpicStatus,
                });
            } else {
                await createEpic(darwinUri, idToken, {
                    pipeline_fk: formPipelineFk,
                    title,
                    description: description || null,
                    category_fk: categoryValue,
                    sort_order: sortOrder.empty ? null : sortOrder.value,
                    epic_status: formEpicStatus,
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
                maxWidth="md" fullWidth data-testid="epic2-edit-dialog">
            <DialogTitle>{epic ? 'Edit epic' : 'New epic'}</DialogTitle>
            <DialogContent>
                <Stack spacing={2} sx={{ mt: 1 }}>
                    <FormControl fullWidth required disabled={!!epic}>
                        <InputLabel>Pipeline</InputLabel>
                        <Select label="Pipeline" value={formPipelineFk}
                                onChange={(e) => setFormPipelineFk(e.target.value)}
                                data-testid="epic2-pipeline-select">
                            {pipelineOptions.map(p => (
                                <MenuItem key={p.id} value={p.id}>{p.title}</MenuItem>
                            ))}
                        </Select>
                    </FormControl>
                    {epic && (
                        <Typography variant="caption" sx={{ color: 'text.secondary', mt: -1 }}>
                            An epic&apos;s plan membership is not editable from this dialog —
                            use the move tool (MCP `move_epic`) to re-home it.
                        </Typography>
                    )}
                    <TextField
                        label="Title"
                        value={formTitle}
                        onChange={(e) => setFormTitle(e.target.value)}
                        autoFocus required fullWidth
                        slotProps={{ htmlInput: { 'data-testid': 'epic2-title-input', maxLength: 256 } }}
                    />
                    <TextField
                        label="Description"
                        value={formDescription}
                        onChange={(e) => setFormDescription(e.target.value)}
                        helperText="What this epic is for — purpose, not a fact a query can answer."
                        fullWidth multiline minRows={6}
                        slotProps={{ htmlInput: { 'data-testid': 'epic2-description-input' } }}
                    />
                    <FormControl fullWidth required>
                        <InputLabel>Category</InputLabel>
                        <Select label="Category" value={categoryValue}
                                onChange={(e) => setFormCategoryFk(e.target.value)}
                                data-testid="epic2-category-select">
                            {categoryOptions.map(c => (
                                <MenuItem key={c.id} value={c.id}>{c.category_name}</MenuItem>
                            ))}
                        </Select>
                    </FormControl>
                    <FormControl fullWidth>
                        <InputLabel>Pause state</InputLabel>
                        <Select label="Pause state" value={formEpicStatus}
                                onChange={(e) => setFormEpicStatus(e.target.value)}
                                data-testid="epic2-status-select">
                            <MenuItem value="active">Active — swarm-starts normally</MenuItem>
                            <MenuItem value="paused">Paused — suppresses swarm-start</MenuItem>
                        </Select>
                    </FormControl>
                    <TextField
                        label="Sort order"
                        value={formSortOrder}
                        onChange={(e) => setFormSortOrder(e.target.value)}
                        helperText={"Whole number, position among this plan's epics. Leave "
                            + 'blank for derived order (started epics by start date, '
                            + 'unstarted after by creation).'}
                        type="number" fullWidth
                        slotProps={{ htmlInput: {
                            'data-testid': 'epic2-sort-order-input',
                            step: 1, min: SORT_ORDER_MIN, max: SORT_ORDER_MAX,
                        } }}
                    />
                </Stack>
            </DialogContent>
            <DialogActions>
                <Button onClick={() => onClose()} disabled={submitting}>Cancel</Button>
                <Button variant="contained" onClick={handleSubmit}
                        disabled={submitting || !formTitle.trim() || categoryValue === ''
                            || (!epic && formPipelineFk === '')}
                        data-testid="epic2-save">
                    {epic ? 'Save' : 'Create'}
                </Button>
            </DialogActions>
        </Dialog>
    );
}
