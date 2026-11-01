// PlanElementEditor.jsx — the in-visualizer editor of a plan's elements (req #4133).
//
// User directive: "All elements should be clickable to edit. I want each to have
// an in visualizer editor like the requirement editor with same design language,
// feel, and minimalism. Only one such editor can be open and they follow editor
// rules and not the info/action popup rules."
//
// So a click on the pipeline's title, an initiative or an epic opens THIS: an
// AnchoredPanel in the Requirement Editor's chrome (RequirementEditorPopup.jsx) —
// `<id> - <title>` across the top, native controls, chip rows, one action row —
// in place of the modal dialogs (PipelineEditDialog / InitiativeEditDialog /
// EpicEditDialog) the canvas used to open. A requirement's click opens the
// Requirement Editor itself, ATOP this one (req #4116). ONE plan editor at a time
// (usePlanEditorStore): opening one replaces the last; the Requirement Editor
// neither closes nor is hidden by it.
//
// It writes through the same APIs and the same field rules the dialogs do (their
// pure helpers are imported, not copied); the dialogs stay for the Epics /
// Initiatives / Pipelines pages. Saving is the deliberate SAVE press (or ⌘/Ctrl-
// Enter), greyed until something changed; a refused write is said in a toast.

import { useContext, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import Box from '@mui/material/Box';

import AnchoredPanel from '../../Components/AnchoredPanel/AnchoredPanel';
import { ActionPopupClose } from '../../Components/AnchoredPanel/ActionPopupHead';
import {
    ACTION_POPUP_COLORS, ACTION_POPUP_FONT_PX, ACTION_POPUP_HEAD_PX, ACTION_POPUP_MONO, ACTION_POPUP_SX,
} from '../../Components/AnchoredPanel/actionPopupChrome';
import { validDock } from '../../Components/AnchoredPanel/anchoredPanelGeometry';
import AppContext from '../../Context/AppContext';
import AuthContext from '../../Context/AuthContext';
import { useAllCategories } from '../../hooks/useDataQueries';
import {
    pipelineComposeKeys, pipelineEpicKeys, pipelineEpicRequirementKeys, requirementKeys,
} from '../../hooks/useQueryKeys';
import { SIDEBAR_WIDTH } from '../../NavBar/navConfig';
import { PLAN_EDITOR_Z } from '../../RequirementFiler/filerHover';
import { useSnackBarStore } from '../../stores/useSnackBarStore';
import { usePlanEditorStore } from '../../stores/usePlanEditorStore';
import { PLAN_VIZ_PALETTE as P } from './pipelinePlanLayout';
import { PIPELINE_STATUS_VALUES, pipelineStatusChipProps, pipelineStatusLabel } from './pipelineChipStyles';
import { deletePipeline, updatePipeline } from '../../Pipelines/pipelinesApi';
import {
    ANY_MACHINE, LOCK_FREE, PIPELINE_STATUS_MEANING, isLockedRow, pipelineDeleteBlockedReason,
    pipelineDeleteConsequence, pipelineEditFields,
} from '../../Pipelines/PipelineEditDialog';
import {
    REST_NULL, deleteEpicFreeingDependents, deleteRequirements, isRestNullLiteral, updateEpic,
} from '../../Epics/epicsApi';
import {
    barrierOf, deleteBlockedReason, deleteConsequence, inputValueToNotBefore, notBeforeToInputValue,
    reqIdsOf, runOf,
} from '../../Epics/EpicEditDialog';
import {
    CATEGORY_FIELDS, initiativeDeleteConsequence, parseSortOrder,
} from '../../Initiatives/InitiativeEditDialog';
import {
    deleteInitiativeWithOptions, planInitiativeDelete, setInitiativeDeps, updateInitiative,
} from '../../Initiatives/initiativesApi';
import { initiativeDepEdit } from './pipelineInitiativeDeps';

export const PLAN_EDITOR_RACK_ID = 'plan-element-editor';
const MIN_W = 180;
const MIN_H = 64;
const LIMITS = { minW: MIN_W, minH: MIN_H, autoMaxW: 640, headPx: ACTION_POPUP_HEAD_PX };
/** Floating home: top-left, where the Requirement Editor floats (they are never both open). */
export const PLAN_EDITOR_HOME = Object.freeze({ h: 'l', x: SIDEBAR_WIDTH + 16, v: 't', y: 92, w: null, ht: null });
const FORM_PAD_EM = 1.1;
const FORM_EM = 44 + 2 * (FORM_PAD_EM - 0.6);
const ROW_LABEL_EM = 6.5;
const SAVE_GREEN = '#2e7d32';
const DANGER = '#ff8a80';
const TITLE_MAX = 256;

const FIELD_SX = {
    width: '100%', boxSizing: 'border-box', m: 0,
    fontFamily: ACTION_POPUP_MONO, fontSize: '1em', lineHeight: 1.4,
    color: P.text, background: '#0b1220',
    border: `1px solid ${P.line}`, borderRadius: '0.4em', px: '0.5em', py: '0.3em',
    outline: 'none', '&:focus': { borderColor: P.accent },
    '&:disabled': { opacity: 0.5 },
    '& option': { background: '#0b1220', color: P.text },
};
const BUTTON_SX = {
    px: '1em', py: '0.3em', border: `1px solid ${P.text}`, borderRadius: '999px',
    background: 'transparent', color: P.text, fontFamily: ACTION_POPUP_MONO,
    fontSize: '1em', fontWeight: 700, cursor: 'pointer',
    '&:hover:not(:disabled)': { color: P.accent, borderColor: P.accent },
    '&:disabled': { opacity: 0.45, cursor: 'default' },
};
const ROW_LABEL_SX = { width: `${ROW_LABEL_EM}em`, flexShrink: 0, color: P.dim,
    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' };
const NOTE_SX = { color: P.dim, fontSize: '0.85em', lineHeight: 1.35 };

// ── Controls: native on purpose (the Requirement Editor's rule — they render the
//    same racked in a shadow root, where a portalled MUI menu would open wrong). ──
function Row({ label, children, top = false }) {
    return (
        <Box sx={{ display: 'flex', alignItems: top ? 'flex-start' : 'center', gap: '0.5em', minWidth: 0 }}>
            <Box sx={{ ...ROW_LABEL_SX, ...(top && { pt: '0.35em' }) }}>{label}</Box>
            <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexWrap: 'wrap', gap: '0.35em', alignItems: 'center' }}>
                {children}
            </Box>
        </Box>
    );
}

function Chips({ value, onChange, options, disabled, testid }) {
    return (
        <Box role="group" data-testid={testid} data-value={String(value ?? '')}
             sx={{ display: 'flex', flexWrap: 'wrap', gap: '0.3em' }}>
            {options.map((o) => {
                const on = o.value === value;
                return (
                    <Box key={String(o.value)} component="button" type="button" disabled={disabled}
                         aria-pressed={on ? 'true' : 'false'} onClick={() => onChange(o.value)}
                         data-testid={`${testid}-${o.value}`}
                         sx={{ px: '0.7em', py: '0.1em', borderRadius: '999px', cursor: 'pointer',
                               fontFamily: ACTION_POPUP_MONO, fontSize: '1em', fontWeight: on ? 700 : 400,
                               border: `1px solid ${on ? (o.bg || P.accent) : P.line}`,
                               background: on ? (o.bg || P.accent) : 'transparent',
                               color: on ? (o.fg || '#000') : P.dim, opacity: on ? 1 : 0.8,
                               '&:disabled': { opacity: 0.45, cursor: 'default' } }}>
                        {o.label}
                    </Box>
                );
            })}
        </Box>
    );
}

function Text({ value, onChange, testid, label, disabled, placeholder, multiline, type = 'text', maxLength }) {
    return (
        <Box component={multiline ? 'textarea' : 'input'} {...(multiline ? { rows: 5 } : { type, maxLength })}
             value={value} disabled={disabled} placeholder={placeholder} aria-label={label}
             onChange={(e) => onChange(e.target.value)} data-testid={testid}
             sx={{ ...FIELD_SX, ...(multiline && { resize: 'vertical', minHeight: '4em' }) }} />
    );
}

function Pick({ value, onChange, options, testid, label, disabled }) {
    return (
        <Box component="select" value={value ?? ''} disabled={disabled} aria-label={label}
             onChange={(e) => onChange(e.target.value)} data-testid={testid} sx={FIELD_SX}>
            {options.map((o) => <option key={String(o.value)} value={o.value} disabled={o.disabled}>{o.label}</option>)}
        </Box>
    );
}

/** `<id> - <title>` across the whole width — the Requirement Editor's top row. */
function Identity({ id, noun, title, setTitle, disabled, testid, onEnter }) {
    return (
        <Box sx={{ display: 'flex', alignItems: 'baseline', gap: '0.45em', minWidth: 0 }}>
            <Box data-testid={`${testid}-identity`}
                 sx={{ flexShrink: 0, fontSize: '1.15em', fontWeight: 600, whiteSpace: 'nowrap', color: P.text }}>
                <Box component="span" sx={{ color: P.dim, fontWeight: 400 }}>{noun} </Box>{id} -
            </Box>
            <Box component="input" type="text" value={title} disabled={disabled} autoFocus
                 placeholder="Title" aria-label="Title" maxLength={TITLE_MAX}
                 onChange={(e) => setTitle(e.target.value)}
                 onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onEnter(); } }}
                 data-testid={`${testid}-field-title`}
                 sx={{ flex: 1, minWidth: 0, fontFamily: ACTION_POPUP_MONO, fontSize: '1.15em',
                       fontWeight: 600, color: P.text, background: 'transparent', border: 'none',
                       borderBottom: `1px solid ${P.accent}`, outline: 'none', px: 0, py: 0,
                       '&:disabled': { opacity: 0.6 } }} />
        </Box>
    );
}

/** The action row: Delete at the left, Save at the right (dark green once it can save). */
function Actions({ canSave, saving, onSave, onDelete, deleteBlocked, deleteLabel, testid }) {
    return (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: '0.6em', pt: '0.2em' }}>
            {onDelete && (
                <Box component="button" type="button" onClick={onDelete} disabled={saving || !!deleteBlocked}
                     title={deleteBlocked || ''} data-blocked={deleteBlocked ? 'yes' : 'no'}
                     aria-label={deleteBlocked || deleteLabel} data-testid={`${testid}-delete`}
                     sx={{ ...BUTTON_SX, color: DANGER, borderColor: DANGER,
                           '&:hover:not(:disabled)': { color: '#fff', borderColor: DANGER, background: '#b71c1c' } }}>
                    Delete
                </Box>
            )}
            <Box sx={{ flex: 1 }} />
            <Box component="button" type="button" onClick={onSave} disabled={!canSave || saving}
                 data-testid={`${testid}-save`}
                 sx={{ ...BUTTON_SX, ...(canSave && !saving && { background: SAVE_GREEN, borderColor: SAVE_GREEN, color: '#fff' }) }}>
                {saving ? 'Saving…' : 'Save'}
            </Box>
        </Box>
    );
}

/** The delete confirmation line(s) and the Keep / Delete pair. */
function Confirm({ lines, children, busy, onKeep, onConfirm, confirmDisabled, confirmLabel, keepLabel, testid }) {
    return (
        <Box data-testid={`${testid}-delete-panel`}
             sx={{ display: 'flex', flexDirection: 'column', gap: '0.4em', border: `1px solid ${DANGER}`,
                   borderRadius: '0.5em', p: '0.6em' }}>
            <Box data-testid={`${testid}-delete-consequence`} sx={{ color: P.text, fontSize: '0.9em' }}>
                {lines.map((l) => <Box key={l}>{l}</Box>)}
            </Box>
            {children}
            <Box sx={{ display: 'flex', gap: '0.6em', justifyContent: 'flex-end' }}>
                <Box component="button" type="button" onClick={onKeep} disabled={busy}
                     data-testid={`${testid}-delete-keep`} sx={BUTTON_SX}>{keepLabel}</Box>
                <Box component="button" type="button" onClick={onConfirm} disabled={busy || confirmDisabled}
                     data-testid={`${testid}-delete-confirm`}
                     sx={{ ...BUTTON_SX, background: '#b71c1c', borderColor: '#b71c1c', color: '#fff' }}>
                    {busy ? 'Deleting…' : confirmLabel}
                </Box>
            </Box>
        </Box>
    );
}

function Check({ checked, onChange, disabled, label, testid }) {
    return (
        <Box component="label" sx={{ display: 'flex', alignItems: 'center', gap: '0.5em', color: P.text, fontSize: '0.9em' }}>
            <input type="checkbox" checked={checked} disabled={disabled}
                   onChange={(e) => onChange(e.target.checked)} data-testid={testid} />
            {label}
        </Box>
    );
}

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// ── The three bodies ──────────────────────────────────────────────────────────

// Whether the body on show holds unsaved edits — set by each body as it renders,
// read by the panel's Esc handler (req #4171).
const editorDirty = { current: false };

function useWriter(spec) {
    const showError = useSnackBarStore((s) => s.showError);
    const close = usePlanEditorStore((s) => s.closeEditor);
    const [saving, setSaving] = useState(false);
    const inFlight = useRef(false);
    // Runs `fn`; a second press while it runs is dropped. Success: refresh (`result()`
    // is what `onSaved` is told), close. Failure: the gateway's own reason is shown
    // (a cycle, a lock — the dialogs' wording), the plan is re-read, and the editor
    // closes when `goneOnFail(err)` says the element no longer exists.
    const run = async (fn, failure, { result, goneOnFail, failureMessage } = {}) => {
        if (inFlight.current) return;
        inFlight.current = true;
        setSaving(true);
        try {
            await fn();
            await spec.onSaved?.(result?.());
            close();
        } catch (err) {
            const gone = !!goneOnFail?.(err);
            const what = failureMessage?.() || failure;
            const status = err?.httpStatus?.httpStatus;
            const reason = err?.httpStatus?.httpDetail?.message;
            if (err?.namedRefusal || err?.initiativeDeleted) showError(err.message);
            else if (reason) showError(`${what} (${status}) — ${reason}`);
            else showError(err, what);
            try { await spec.onSaved?.(result?.()); } catch { /* the original error is the one shown */ }
            if (gone) close();
        } finally {
            inFlight.current = false;
            setSaving(false);
        }
    };
    return { saving, run, close, showError };
}

function PipelineBody({ spec }) {
    const { idToken } = useContext(AuthContext);
    const { darwinUri } = useContext(AppContext);
    const queryClient = useQueryClient();
    const { saving, run, close, showError } = useWriter(spec);
    const pipeline = spec.target;
    const deletion = spec.deletion;
    // The row as the editor opened: "changed?" is judged against it, never a live refetch.
    const [openedRow] = useState(() => ({ ...pipeline }));
    const [title, setTitle] = useState(pipeline?.title || '');
    const [description, setDescription] = useState(pipeline?.description || '');
    const [machineFk, setMachineFk] = useState(pipeline?.machine_fk ?? ANY_MACHINE);
    const [status, setStatus] = useState(pipeline?.pipeline_status ?? null);
    const [sortOrder, setSortOrder] = useState(pipeline?.sort_order == null ? '' : String(pipeline.sort_order));
    const storedLocked = isLockedRow(pipeline);
    const [formLocked, setFormLocked] = useState(storedLocked);
    const [confirming, setConfirming] = useState(false);
    const lockHeld = storedLocked && formLocked;
    const machines = (spec.machines || []).filter((m) => !m.closed || m.id === pipeline?.machine_fk);
    const editedThenRelocked = lockHeld && (
        title.trim() !== (openedRow.title ?? '')
        || description.trim() !== String(openedRow.description ?? '').trim()
        || machineFk !== (openedRow.machine_fk ?? ANY_MACHINE));
    const { fields, problem } = pipelineEditFields(openedRow, {
        title, description, machineFk, sortOrder, locked: formLocked, status });
    const dirty = !problem && Object.keys(fields).length > 0;
    editorDirty.current = dirty;
    const deleteBlocked = deletion ? pipelineDeleteBlockedReason(pipeline, deletion) : null;

    const save = () => {
        if (confirming) return;
        if (editedThenRelocked) { showError('Unlock the pipeline to save these edits, or cancel them.'); return; }
        if (problem) { showError(problem); return; }
        if (!dirty) { close(); return; }
        if (lockHeld && Object.keys(fields).some((k) => !LOCK_FREE.has(k))) {
            showError('This pipeline is locked — unlock it first');
            return;
        }
        run(() => updatePipeline(darwinUri, idToken, pipeline.id, fields), 'Could not save pipeline');
    };
    const del = async () => {
        let deleted = false;
        await run(async () => {
            await deletePipeline(darwinUri, idToken, pipeline.id);
            deleted = true;
            // Its page is still mounted this tick: REMOVE the read, an invalidation would re-fetch a dead plan.
            queryClient.removeQueries({ queryKey: pipelineComposeKeys.byId(pipeline.id) });
        }, 'Could not delete the pipeline', { goneOnFail: () => false });
        setConfirming(false);
        if (deleted) spec.onDeleted?.();
    };
    return (
        <>
            <Identity id={pipeline.id} noun="Pipeline" title={title} setTitle={setTitle} disabled={lockHeld}
                      testid="plan-editor" onEnter={save} />
            <Row label="Lock">
                <Chips value={formLocked ? 'locked' : 'unlocked'} testid="plan-editor-lock"
                       onChange={(v) => setFormLocked(v === 'locked')}
                       options={[{ value: 'unlocked', label: 'Unlocked' },
                           { value: 'locked', label: 'Locked', bg: '#ef5350', fg: '#000' }]} />
            </Row>
            <Row label="Goal" top>
                <Text multiline value={description} onChange={setDescription} disabled={lockHeld} label="Goal"
                      testid="plan-editor-description" />
            </Row>
            <Row label="Machine">
                <Pick value={machineFk} onChange={setMachineFk} disabled={lockHeld} label="Machine"
                      testid="plan-editor-machine"
                      options={[{ value: ANY_MACHINE, label: 'Any' },
                          ...machines.map((m) => ({ value: m.id, label: m.title || `Machine ${m.id}` }))]} />
            </Row>
            <Row label="Sort order">
                <Text type="number" value={sortOrder} onChange={setSortOrder} label="Sort order"
                      testid="plan-editor-sort-order" placeholder="keep its place" />
            </Row>
            <Row label="Status">
                <Chips value={status} onChange={setStatus} testid="plan-editor-status"
                       options={PIPELINE_STATUS_VALUES.map((v) => {
                           const sx = pipelineStatusChipProps(v).sx || {};
                           return { value: v, label: pipelineStatusLabel(v), bg: sx.bgcolor, fg: sx.color,
                               title: PIPELINE_STATUS_MEANING[v] };
                       })} />
            </Row>
            {lockHeld && <Box sx={NOTE_SX} data-testid="plan-editor-locked">
                Locked — its status, sort order and lock can still change; unlock it to change anything else.
            </Box>}
            {confirming ? (
                <Confirm lines={pipelineDeleteConsequence(pipeline, deletion)} busy={saving} testid="plan-editor"
                         onKeep={() => setConfirming(false)} onConfirm={del}
                         confirmLabel="Delete pipeline" keepLabel="Keep pipeline" />
            ) : (
                <Actions canSave={dirty} saving={saving} onSave={save} testid="plan-editor"
                         onDelete={deletion ? () => setConfirming(true) : null} deleteBlocked={deleteBlocked}
                         deleteLabel={`Delete pipeline ${pipeline.id}`} />
            )}
        </>
    );
}

function EpicBody({ spec }) {
    const { idToken } = useContext(AuthContext);
    const { darwinUri } = useContext(AppContext);
    const { saving, run, close, showError } = useWriter(spec);
    const epic = spec.target;
    const deletion = spec.deletion;
    const [title, setTitle] = useState(epic.title || '');
    const [notes, setNotes] = useState(epic.notes || '');
    const [runMode, setRunMode] = useState(runOf(epic));
    const [barrier, setBarrier] = useState(barrierOf(epic));
    const [notBefore, setNotBefore] = useState(notBeforeToInputValue(epic.not_before));
    const [locked, setLocked] = useState(!!epic.locked);
    const [confirming, setConfirming] = useState(false);
    const [alsoReqs, setAlsoReqs] = useState(false);
    const inheritedLock = epic.lockedBy && epic.lockedBy !== 'epic' ? epic.lockedBy : null;
    const lockHeld = !!inheritedLock || (!!epic.locked && locked);
    const initiativeName = (spec.initiativeOptions || []).find((o) => String(o.id) === String(epic.initiative_fk))?.title
        || (epic.initiative_fk == null ? '(none)' : `Initiative ${epic.initiative_fk}`);
    const edited = title !== (epic.title || '') || notes !== (epic.notes || '') || runMode !== runOf(epic)
        || barrier !== barrierOf(epic) || notBefore !== notBeforeToInputValue(epic.not_before);
    const lockChanged = locked !== !!epic.locked;
    const dirty = edited || lockChanged;
    editorDirty.current = dirty;
    const deleteBlocked = deletion ? deleteBlockedReason(epic, inheritedLock, deletion) : null;

    const save = () => {
        const t = title.trim();
        if (!t) { showError('Title is required'); return; }
        if (isRestNullLiteral(t)) {
            showError(`"${REST_NULL}" is the API's clear-this-column sentinel and cannot be a title. `
                + 'Try "Null" or another wording.');
            return;
        }
        if (lockHeld && !inheritedLock && edited) { showError('Unlock the epic to save these edits, or cancel them.'); return; }
        if (lockHeld) { close(); return; }
        run(() => updateEpic(darwinUri, idToken, epic.id, {
            title: t,
            notes: notes.trim() || REST_NULL,
            run: runMode,
            checkpoint: barrier ? 1 : 0,
            not_before: inputValueToNotBefore(notBefore) || REST_NULL,
            ...(lockChanged ? { locked: locked ? 1 : 0 } : {}),
        }), 'Could not save epic');
    };
    const del = () => {
        let deleted = false;
        return run(async () => {
            await deleteEpicFreeingDependents(darwinUri, idToken, epic.id, (deletion.dependents || []).map((d) => d.id));
            deleted = true;
            if (alsoReqs && reqIdsOf(deletion).length) await deleteRequirements(darwinUri, idToken, reqIdsOf(deletion));
        }, 'Could not delete epic', {
            // Requirement lists change when an epic goes (deleted, or un-seated).
            result: () => ({ deleted, requirementsDeleted: deleted && alsoReqs }),
            goneOnFail: () => deleted,
            failureMessage: () => (deleted ? `Epic ${epic.id} was deleted, but its requirements could not be` : null),
        }).finally(() => setConfirming(false));
    };

    return (
        <>
            <Identity id={epic.id} noun="Epic" title={title} setTitle={setTitle} disabled={lockHeld}
                      testid="plan-editor" onEnter={save} />
            <Row label="Initiative"><Box data-testid="plan-editor-initiative" sx={{ color: P.text }}>{initiativeName}</Box></Row>
            <Row label="Lock">
                <Chips value={locked || inheritedLock ? 'locked' : 'unlocked'} testid="plan-editor-lock"
                       disabled={!!inheritedLock} onChange={(v) => setLocked(v === 'locked')}
                       options={[{ value: 'unlocked', label: 'Unlocked' },
                           { value: 'locked', label: 'Locked', bg: '#ef5350', fg: '#000' }]} />
            </Row>
            {inheritedLock && <Box sx={NOTE_SX} data-testid="plan-editor-inherited-lock">
                Locked by its {inheritedLock} — unlock the {inheritedLock} to edit this epic.
            </Box>}
            <Row label="Notes" top>
                <Text multiline value={notes} onChange={setNotes} disabled={lockHeld} label="Notes"
                      testid="plan-editor-notes" />
            </Row>
            <Row label="Run">
                <Chips value={runMode} onChange={setRunMode} disabled={lockHeld} testid="plan-editor-run"
                       options={[{ value: 'auto', label: 'Auto' }, { value: 'manual', label: 'Manual' }]} />
            </Row>
            <Row label="Barrier">
                <Chips value={barrier ? 'on' : 'off'} onChange={(v) => setBarrier(v === 'on')} disabled={lockHeld}
                       testid="plan-editor-barrier"
                       options={[{ value: 'on', label: 'On' }, { value: 'off', label: 'Off (priority)' }]} />
            </Row>
            <Row label="Not before">
                <Text type="datetime-local" value={notBefore} onChange={setNotBefore} disabled={lockHeld}
                      label="Not before" testid="plan-editor-not-before" />
            </Row>
            {confirming ? (
                <Confirm lines={[deleteConsequence(epic, deletion, alsoReqs)]} busy={saving} testid="plan-editor"
                         onKeep={() => { setConfirming(false); setAlsoReqs(false); }} onConfirm={del}
                         confirmLabel="Delete epic" keepLabel="Keep epic">
                    {reqIdsOf(deletion).length > 0 && (
                        <Check checked={alsoReqs} onChange={setAlsoReqs} disabled={saving} testid="plan-editor-delete-requirements"
                               label={`Also delete its ${plural(reqIdsOf(deletion).length, 'requirement')} — permanently`} />
                    )}
                </Confirm>
            ) : (
                <Actions canSave={dirty} saving={saving} onSave={save} testid="plan-editor"
                         onDelete={deletion ? () => setConfirming(true) : null} deleteBlocked={deleteBlocked}
                         deleteLabel={`Delete epic ${epic.id}`} />
            )}
        </>
    );
}

function InitiativeBody({ spec }) {
    const { idToken, profile } = useContext(AuthContext);
    const { darwinUri } = useContext(AppContext);
    const queryClient = useQueryClient();
    const { saving, run, close, showError } = useWriter(spec);
    const initiative = spec.target;
    const { data: categories = [] } = useAllCategories(profile?.userName, { fields: CATEGORY_FIELDS });
    const categoryOptions = useMemo(() => {
        const open = categories.filter((c) => !c.closed).sort((a, b) => {
            const ao = a.sort_order == null ? Infinity : a.sort_order;
            const bo = b.sort_order == null ? Infinity : b.sort_order;
            return ao - bo || String(a.category_name).localeCompare(String(b.category_name));
        });
        const current = initiative.category_fk;
        if (current != null && !open.some((c) => c.id === current)) {
            const row = categories.find((c) => c.id === current);
            if (row) return [...open, row];
        }
        return open;
    }, [categories, initiative.category_fk]);

    const [title, setTitle] = useState(initiative.title || '');
    const [description, setDescription] = useState(initiative.description || '');
    const [categoryFk, setCategoryFk] = useState(initiative.category_fk ?? '');
    const [sortOrder, setSortOrder] = useState(initiative.sort_order == null ? '' : String(initiative.sort_order));
    const [pause, setPause] = useState(initiative.initiative_status === 'paused' ? 'paused' : 'active');
    const depRows = spec.dependencies?.rows || [];
    const depChoices0 = spec.dependencies?.choices || [];
    const currentDepIds = depRows.map((r) => r.dep_initiative_fk);
    const [depEdit, setDepEdit] = useState(null);
    const depIds = depEdit ? depEdit.chosen : currentDepIds;
    const depChoices = [...depChoices0, ...depIds.filter((id) => !depChoices0.some((c) => c.id === id))
        .map((id) => ({ id, title: `Initiative ${id}`, disabled: false, reason: 'not in this plan — untick to remove' }))];
    const pipelineName = (spec.pipelineOptions || []).find((p) => String(p.id) === String(initiative.pipeline_fk))?.title
        || `Pipeline ${initiative.pipeline_fk}`;

    const [plan, setPlan] = useState(null);
    const [deleteEpics, setDeleteEpics] = useState(true);
    const [deleteReqs, setDeleteReqs] = useState(false);
    const [moveTo, setMoveTo] = useState('');
    const [reading, setReading] = useState(false);

    const dirty = title !== (initiative.title || '') || description !== (initiative.description || '')
        || String(categoryFk) !== String(initiative.category_fk ?? '')
        || sortOrder !== (initiative.sort_order == null ? '' : String(initiative.sort_order))
        || pause !== (initiative.initiative_status === 'paused' ? 'paused' : 'active') || !!depEdit;
    editorDirty.current = dirty;

    const save = () => {
        const t = title.trim();
        const so = parseSortOrder(sortOrder);
        if (!t) { showError('Title is required'); return; }
        if (isRestNullLiteral(t)) {
            showError(`"${REST_NULL}" is the API's clear-this-column sentinel and cannot be a title. `
                + 'Try "Null" or another wording.');
            return;
        }
        if (categoryFk === '' || categoryFk == null) { showError('Category is required'); return; }
        if (so.invalid) { showError(so.invalid); return; }
        run(async () => {
            if (depEdit) {
                await setInitiativeDeps(darwinUri, idToken, initiative.id,
                    initiativeDepEdit(depRows, depEdit.seen, depEdit.chosen));
            }
            await updateInitiative(darwinUri, idToken, initiative.id, {
                title: t,
                description: description.trim() || REST_NULL,
                category_fk: categoryFk,
                ...(so.empty ? null : { sort_order: so.value }),
                initiative_status: pause,
            });
        }, 'Could not save initiative');
    };

    const startDelete = async () => {
        setReading(true);
        try {
            const planned = await planInitiativeDelete(darwinUri, idToken, initiative.id);
            setDeleteEpics(true);
            setDeleteReqs(false);
            setMoveTo(planned.moveTargets.find((t) => !t.cycle)?.id ?? '');
            setPlan(planned);
        } catch (err) {
            showError(err?.namedRefusal ? err.message : err, 'Could not read what the delete would touch');
        } finally {
            setReading(false);
        }
    };
    const deleteBlocked = plan && (plan.blocked || (deleteEpics ? plan.blockedDeletingEpics : null));
    const del = async () => {
        const creatorFk = profile?.userName;
        let gone = false;
        await run(async () => {
            try {
                await deleteInitiativeWithOptions(darwinUri, idToken, plan, {
                    deleteEpics, moveToInitiativeFk: deleteEpics ? null : moveTo, deleteRequirements: deleteReqs,
                });
            } finally {
                await Promise.all([
                    queryClient.invalidateQueries({ queryKey: pipelineComposeKeys.all }),
                    creatorFk && queryClient.invalidateQueries({ queryKey: pipelineEpicKeys.all(creatorFk) }),
                    creatorFk && queryClient.invalidateQueries({ queryKey: pipelineEpicRequirementKeys.all(creatorFk) }),
                    creatorFk && queryClient.invalidateQueries({ queryKey: requirementKeys.all(creatorFk) }),
                ]);
            }
        }, 'Could not delete initiative', {
            goneOnFail: (err) => { gone = !!err?.initiativeDeleted; return gone; },
        });
        if (!gone) setPlan(null);
    };

    const hasEpics = plan?.epics.length > 0;
    const canKeepEpics = hasEpics && plan.moveTargets.some((t) => !t.cycle);
    return (
        <>
            <Identity id={initiative.id} noun="Initiative" title={title} setTitle={setTitle}
                      testid="plan-editor" onEnter={save} />
            <Row label="Plan"><Box data-testid="plan-editor-pipeline" sx={{ color: P.text }}>{pipelineName}</Box></Row>
            <Row label="Category">
                <Pick value={categoryFk} onChange={(v) => setCategoryFk(v === '' ? '' : Number(v))} label="Category"
                      testid="plan-editor-category"
                      options={[...(categoryFk === '' ? [{ value: '', label: '—' }] : []),
                          ...categoryOptions.map((c) => ({ value: c.id, label: c.category_name }))]} />
            </Row>
            <Row label="Pause">
                <Chips value={pause} onChange={setPause} testid="plan-editor-pause"
                       options={[{ value: 'active', label: 'Active' }, { value: 'paused', label: 'Paused', bg: '#ff9800', fg: '#000' }]} />
            </Row>
            <Row label="Description" top>
                <Text multiline value={description} onChange={setDescription} label="Description"
                      testid="plan-editor-description" />
            </Row>
            <Row label="Sort order">
                <Text type="number" value={sortOrder} onChange={setSortOrder} label="Sort order"
                      testid="plan-editor-sort-order" placeholder="keep its place" />
            </Row>
            {spec.dependencies && depChoices.length > 0 && (
                <Row label="Waits for" top>
                    <Box data-testid="plan-editor-deps" sx={{ display: 'flex', flexDirection: 'column', gap: '0.2em' }}>
                        {depChoices.map((c) => (
                            <Check key={c.id} checked={depIds.includes(c.id)} testid={`plan-editor-deps-option-${c.id}`}
                                   disabled={c.disabled && !depIds.includes(c.id)}
                                   onChange={(on) => setDepEdit({
                                       seen: depEdit?.seen ?? currentDepIds,
                                       chosen: on ? [...depIds, c.id] : depIds.filter((x) => x !== c.id),
                                   })}
                                   label={c.reason ? `${c.title} — ${c.reason}` : c.title} />
                        ))}
                    </Box>
                </Row>
            )}
            {plan ? (
                <Confirm lines={initiativeDeleteConsequence(plan, {
                    deleteEpics, moveToTitle: plan.moveTargets.find((t) => t.id === moveTo)?.title,
                    deleteRequirements: deleteReqs })}
                         busy={saving} testid="plan-editor" onKeep={() => setPlan(null)} onConfirm={del}
                         confirmDisabled={!!deleteBlocked || (!deleteEpics && moveTo === '')}
                         confirmLabel="Delete initiative" keepLabel="Keep initiative">
                    {deleteBlocked && <Box sx={{ color: DANGER, fontSize: '0.9em' }} data-testid="plan-editor-delete-blocked">{deleteBlocked}</Box>}
                    <Check checked={deleteEpics || !canKeepEpics} disabled={saving || !canKeepEpics} onChange={setDeleteEpics}
                           testid="plan-editor-delete-epics"
                           label={!hasEpics ? 'Delete its epics — it holds none'
                               : `Delete its ${plural(plan.epics.length, 'epic')}${canKeepEpics ? ''
                                   : ' — no other unlocked initiative in this plan to keep them in'}`} />
                    {!deleteEpics && canKeepEpics && (
                        <Row label="Move to">
                            <Pick value={moveTo} onChange={(v) => setMoveTo(Number(v))} disabled={saving} label="Move its epics to"
                                  testid="plan-editor-delete-move-target"
                                  options={plan.moveTargets.map((t) => ({ value: t.id, disabled: t.cycle,
                                      label: t.cycle ? `${t.title} — would close a dependency loop` : t.title }))} />
                        </Row>
                    )}
                    <Check checked={deleteReqs} disabled={saving || !plan.reqIds.length} onChange={setDeleteReqs}
                           testid="plan-editor-delete-requirements"
                           label={plan.reqIds.length ? `Delete the ${plural(plan.reqIds.length, 'requirement')} in its epics — permanently`
                               : 'Delete the requirements in its epics — they hold none'} />
                </Confirm>
            ) : (
                <Actions canSave={dirty && categoryFk !== ''} saving={saving || reading} onSave={save} testid="plan-editor"
                         onDelete={startDelete} deleteLabel={`Delete initiative ${initiative.id}`} />
            )}
        </>
    );
}

const BODIES = { pipeline: PipelineBody, epic: EpicBody, initiative: InitiativeBody };
const NAMES = { pipeline: 'Pipeline Editor', epic: 'Epic Editor', initiative: 'Initiative Editor' };

/** Mounted once on the plan page; draws whichever editor `usePlanEditorStore` holds. */
export default function PlanElementEditor() {
    const current = usePlanEditorStore((s) => s.current);
    const storedDock = usePlanEditorStore((s) => s.dock);
    const open = usePlanEditorStore((s) => s.open);
    const setDock = usePlanEditorStore((s) => s.setDock);
    const toggleOpen = usePlanEditorStore((s) => s.toggleOpen);
    const closeEditor = usePlanEditorStore((s) => s.closeEditor);
    if (!current) return null;
    const Body = BODIES[current.kind];
    if (!Body) return null;
    const dock = { ...(validDock(storedDock, MIN_W, MIN_H) || PLAN_EDITOR_HOME), ht: null };
    return (
        <AnchoredPanel dock={dock} onDockChange={setDock} open={open} onToggle={toggleOpen}
                       name={NAMES[current.kind]} testid="plan-editor" badgeSlot={false}
                       rackId={PLAN_EDITOR_RACK_ID} zIndex={PLAN_EDITOR_Z}
                       limits={LIMITS} fontPx={ACTION_POPUP_FONT_PX} colors={ACTION_POPUP_COLORS}
                       sx={ACTION_POPUP_SX}
                       actions={<ActionPopupClose onClick={closeEditor} label="Close the editor"
                                                  testid="plan-editor-close" />}>
            {({ shapedWidth }) => (
                <Box component="form" data-testid={`plan-editor-form-${current.kind}`}
                     onSubmit={(e) => e.preventDefault()}
                     onKeyDown={(e) => {
                         // Esc dismisses the editor (req #4171); unsaved edits are asked about first.
                         // A press that already did something (closed a list) or is IME input is not ours.
                         if (e.key !== 'Escape' || e.defaultPrevented || e.nativeEvent?.isComposing
                             || e.nativeEvent?.keyCode === 229) return;
                         e.preventDefault();
                         if (editorDirty.current && !window.confirm('Discard unsaved changes in the editor?')) return;
                         closeEditor();
                     }}
                     sx={{ width: shapedWidth == null ? `${FORM_EM}em` : '100%', maxWidth: '100%',
                            boxSizing: 'border-box', px: `${FORM_PAD_EM}em`, py: '0.9em',
                            display: 'flex', flexDirection: 'column', gap: '0.55em' }}>
                    <Body key={current.key} spec={current} />
                </Box>
            )}
        </AnchoredPanel>
    );
}
