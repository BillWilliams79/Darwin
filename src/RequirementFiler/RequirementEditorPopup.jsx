// RequirementEditorPopup.jsx — the popup requirement editor (req #3811): the
// second floating window the Requirement Filer's "New requirement" opens. A
// simple, visualizer-like editor of ONE requirement's directly settable values:
// title, description, project → category, status, autonomy, model, effort,
// machine (Any = NULL), affected repos and the tracking (container) flag.
//
// ── A DELIBERATE RULE VIOLATION, RULED BY THE USER ─────────────────────────
// This DUPLICATES the requirement editing surfaces (CategoryCard,
// RequirementRow, RequirementDetail) instead of sharing them — the user's
// ruling, 2026-10-23: "let's violate a rule and make a popup edit version of a
// requirement". Do not refactor those editors to share code with this one,
// and do not fold this one into them on DRY grounds.
//
// The first Save POSTs the requirement through Lambda-Rest (one object); the
// window then shows its id as a link to /swarm/requirement/<id>, and every
// later Save PUTs that same row with what changed (requirementFilerModel.js).
// Its fields, the saved id and where it floats live in useRequirementFilerStore
// — racking re-mounts this subtree, and a draft survives a reload.
//
// An AnchoredPanel in the Action Popups' chrome, rackable like every other.
// Native form controls on purpose: they render the same racked in AI
// Architecture's toolbar (a shadow root in an iframe), where a portalled MUI
// menu would open in the wrong document.

import { useContext, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';

import Box from '@mui/material/Box';
import useMediaQuery from '@mui/material/useMediaQuery';

import AnchoredPanel from '../Components/AnchoredPanel/AnchoredPanel';
import {
    ACTION_POPUP_COLORS, ACTION_POPUP_FONT_PX, ACTION_POPUP_HEAD_PX, ACTION_POPUP_MONO, ACTION_POPUP_SX,
} from '../Components/AnchoredPanel/actionPopupChrome';
import { validDock } from '../Components/AnchoredPanel/anchoredPanelGeometry';
import AppContext from '../Context/AppContext';
import AuthContext from '../Context/AuthContext';
import { useCategories, useMachines, useProjects } from '../hooks/useDataQueries';
import { requirementKeys } from '../hooks/useQueryKeys';
import { SIDEBAR_WIDTH } from '../NavBar/navConfig';
import call_rest_api from '../RestApi/RestApi';
import { useRequirementFilerStore } from '../stores/useRequirementFilerStore';
import { PLAN_VIZ_PALETTE as P } from '../SwarmView/pipelines/pipelinePlanLayout';
import { ActionPopupClose } from './RequirementFiler';
import {
    ENUM_FIELDS, buildPostBody, buildPutBody, draftDirty, draftProblem, machineOptions, savedValues,
} from './requirementFilerModel';

/** Its id in the panel rack. */
export const EDITOR_RACK_ID = 'requirement-editor';
const MIN_W = 180;
const MIN_H = 64;
const LIMITS = { minW: MIN_W, minH: MIN_H, autoMaxW: 560, headPx: ACTION_POPUP_HEAD_PX };
/** Floating home: top-left, beside the Requirement Filer's home. */
export const EDITOR_HOME = Object.freeze({ h: 'l', x: SIDEBAR_WIDTH + 16, v: 't', y: 92, w: null, ht: null });
/** The form's width while the panel is content-sized. */
const FORM_EM = 30;
/** Shaped narrower than this, the selects stack one per row. */
const TWO_COLUMN_PX = 280;

const FIELD_SX = {
    width: '100%', boxSizing: 'border-box', m: 0,
    fontFamily: ACTION_POPUP_MONO, fontSize: '1em', lineHeight: 1.4,
    color: P.text, background: '#0b1220',
    border: `1px solid ${P.line}`, borderRadius: '0.4em', px: '0.5em', py: '0.3em',
    outline: 'none', '&:focus': { borderColor: P.accent },
    '&:disabled': { opacity: 0.5 },
    '& option': { background: '#0b1220', color: P.text },
};
const LABEL_SX = {
    display: 'flex', flexDirection: 'column', gap: '0.2em', minWidth: 0,
    color: P.dim, fontSize: '0.85em', letterSpacing: '0.06em', textTransform: 'uppercase',
};

function Field({ label, children }) {
    return (
        <Box component="label" sx={LABEL_SX}>
            <span>{label}</span>
            {children}
        </Box>
    );
}

function Select({ value, onChange, options, testid, placeholder, disabled }) {
    return (
        <Box component="select" value={value ?? ''} disabled={disabled}
             onChange={(e) => onChange(e.target.value)}
             data-testid={`requirement-editor-field-${testid}`}
             sx={{ ...FIELD_SX, textTransform: 'none', letterSpacing: 0 }}>
            {placeholder != null && <option value="">{placeholder}</option>}
            {options.map(o => <option key={String(o.value)} value={o.value}>{o.label}</option>)}
        </Box>
    );
}

/** Options for a list read, keeping a current value the list does not hold
 *  (a closed project or category) visible rather than silently showing another. */
function withCurrent(opts, current, loaded, noun) {
    if (current == null || !loaded || opts.some(o => o.value === current)) return opts;
    return [...opts, { value: current, label: `${noun} #${current} (closed)` }];
}

const errorText = (res, fallback) => {
    const s = res?.httpStatus;
    return s ? `${fallback} (HTTP ${s.httpStatus}${s.httpMessage ? ` ${s.httpMessage}` : ''})` : fallback;
};

export default function RequirementEditorPopup() {
    const { profile, idToken } = useContext(AuthContext);
    const { darwinUri } = useContext(AppContext);
    const queryClient = useQueryClient();
    const isDesktop = useMediaQuery('(min-width:900px)');
    const show = useRequirementFilerStore(s => s.editorShow);
    const open = useRequirementFilerStore(s => s.editorOpen);
    const storedDock = useRequirementFilerStore(s => s.editorDock);
    const draft = useRequirementFilerStore(s => s.draft);
    const savedId = useRequirementFilerStore(s => s.savedId);
    const saved = useRequirementFilerStore(s => s.saved);
    const draftKey = useRequirementFilerStore(s => s.draftKey);
    const orphaned = useRequirementFilerStore(s => s.orphaned);
    const focusPending = useRequirementFilerStore(s => s.focusPending);
    const { setEditorShow, toggleEditorOpen, setEditorDock, setFields, markSaved, markOrphaned,
        clearFocusPending } = useRequirementFilerStore.getState();
    const dock = validDock(storedDock, MIN_W, MIN_H) || EDITOR_HOME;
    // Both belong to the draft they were set for (`key`): a save still in flight
    // when another requirement is started reports nothing over the new one.
    const [saving, setSaving] = useState(null);
    const [failure, setFailure] = useState(null);
    const error = failure?.key === draftKey ? failure.text : null;
    const titleRef = useRef(null);

    const user = profile?.userName;
    const visible = show && isDesktop && !!user && !!draft;
    const { data: projects } = useProjects(user, { closed: 0, enabled: visible });
    const projectId = draft?.projectId ?? null;
    // Default fields: the open-categories cache key does not carry them, so a
    // narrower read here would hand other readers of that key a narrower row.
    const { data: categories } = useCategories(user, projectId,
        { closed: 0, enabled: visible && projectId != null });
    const { data: machines } = useMachines(user, { enabled: visible });

    // The title takes focus once, for a requirement just started — never on a
    // reload or a rack/unrack remount, which would pull focus off the page.
    useEffect(() => {
        if (visible && focusPending && titleRef.current) {
            titleRef.current.focus();
            clearFocusPending();
        }
    });

    if (!visible) return null;

    const bySort = (name) => (a, b) => ((a.sort_order ?? 1e9) - (b.sort_order ?? 1e9))
        || String(a[name] || '').localeCompare(String(b[name] || ''));
    const projectOpts = withCurrent(
        (Array.isArray(projects) ? [...projects] : []).sort(bySort('project_name'))
            .map(p => ({ value: p.id, label: p.project_name })),
        projectId, Array.isArray(projects), 'Project');
    const categoryOpts = withCurrent(
        (Array.isArray(categories) ? [...categories] : []).sort(bySort('category_name'))
            .map(c => ({ value: c.id, label: c.category_name })),
        draft.category_fk, Array.isArray(categories), 'Category');
    const machineOpts = machineOptions(machines, draft.machine_fk);

    const problem = draftProblem(draft);
    const dirty = draftDirty(draft, savedId, saved);
    const canSave = !problem && dirty && saving !== draftKey && !orphaned;
    const toInt = (v) => (v === '' ? null : parseInt(v, 10));

    // The row a 201 (committed, read-back failed) did not return: the newest
    // requirement in its category carrying its title. null when that read fails
    // too — the row is saved either way.
    const findNewId = async (body) => {
        try {
            const res = await call_rest_api(
                `${darwinUri}/requirements?category_fk=${body.category_fk}&fields=id,title`, 'GET', null, idToken);
            const rows = Array.isArray(res?.data) ? res.data : [];
            const ids = rows.filter(r => r.title === body.title).map(r => r.id);
            return ids.length ? Math.max(...ids) : null;
        } catch {
            return null;
        }
    };

    // call_rest_api RESOLVES 200/201/204 and the transport failure (503), and
    // THROWS {data, httpStatus} for every gateway error — both reach the reader.
    const save = async () => {
        if (!canSave) return;
        const key = draftKey;
        const fail = (res, text) => setFailure({ key, text: errorText(res, text) });
        setSaving(key);
        setFailure(null);
        const values = savedValues(draft);
        const uri = `${darwinUri}/requirements`;
        const isPost = savedId == null;
        try {
            if (isPost) {
                const body = buildPostBody(draft);
                const res = await call_rest_api(uri, 'POST', body, idToken);
                const status = res?.httpStatus?.httpStatus;
                if (status !== 200 && status !== 201) return fail(res, 'Requirement not saved');
                queryClient.invalidateQueries({ queryKey: requirementKeys.all(user) });
                const id = res.data?.[0]?.id ?? await findNewId(body);
                if (id == null) {
                    // Saved, but no id to PUT later edits to: keep what was typed,
                    // and refuse a second Save that would POST a duplicate.
                    markOrphaned(key);
                    setFailure({ key, text: 'Saved, but its id could not be read back — find it on /swarm, '
                        + 'or start a new requirement.' });
                    return;
                }
                markSaved(key, id, values);
            } else {
                const body = buildPutBody(savedId, draft, saved);
                if (body) {
                    const res = await call_rest_api(uri, 'PUT', body, idToken);
                    const status = res?.httpStatus?.httpStatus;
                    if (status !== 200 && status !== 204) return fail(res, 'Changes not saved');
                    queryClient.invalidateQueries({ queryKey: requirementKeys.all(user) });
                }
                markSaved(key, savedId, values);
            }
        } catch (e) {
            fail(e, isPost ? 'Requirement not saved' : 'Changes not saved');
        } finally {
            setSaving(s => (s === key ? null : s));
        }
    };

    const onKeyDown = (e) => {
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); save(); }
    };

    return (
        <AnchoredPanel dock={dock} onDockChange={setEditorDock}
                       open={open} onToggle={toggleEditorOpen}
                       name="Requirement Editor" testid="requirement-editor"
                       rackId={EDITOR_RACK_ID}
                       limits={LIMITS} fontPx={ACTION_POPUP_FONT_PX} colors={ACTION_POPUP_COLORS}
                       sx={ACTION_POPUP_SX}
                       actions={<ActionPopupClose onClick={() => setEditorShow(false)}
                                                  label="Close the requirement editor"
                                                  testid="requirement-editor-close" />}>
            {({ shapedWidth }) => {
                const twoCol = shapedWidth == null || shapedWidth >= TWO_COLUMN_PX;
                return (
                    <Box component="form" data-testid="requirement-editor-form"
                         onSubmit={(e) => { e.preventDefault(); save(); }} onKeyDown={onKeyDown}
                         sx={{ width: shapedWidth == null ? `${FORM_EM}em` : '100%', maxWidth: '100%',
                                boxSizing: 'border-box', px: '0.7em', py: '0.5em',
                                display: 'flex', flexDirection: 'column', gap: '0.55em' }}>
                        {/* Which requirement this is: new, or its id as a link. */}
                        <Box data-testid="requirement-editor-identity"
                             sx={{ display: 'flex', alignItems: 'baseline', gap: '0.6em', flexWrap: 'wrap' }}>
                            {savedId != null ? (
                                <Box component={Link} to={`/swarm/requirement/${savedId}`}
                                     data-testid="requirement-editor-id-link"
                                     sx={{ color: P.req, fontWeight: 700, textDecoration: 'none',
                                            '&:hover': { textDecoration: 'underline' } }}>
                                    #{savedId}
                                </Box>
                            ) : (
                                <Box component="span" sx={{ color: P.text, fontWeight: 700 }}>New requirement</Box>
                            )}
                            <Box component="span" data-testid="requirement-editor-state"
                                 sx={{ color: P.dim, fontSize: '0.9em' }}>
                                {saving === draftKey ? 'Saving…' : (orphaned ? 'saved — id unknown'
                                    : savedId == null ? 'not saved yet'
                                    : (dirty ? 'unsaved changes' : 'saved'))}
                            </Box>
                        </Box>

                        <Field label="Title">
                            <Box component="input" type="text" value={draft.title} ref={titleRef}
                                 onChange={(e) => setFields({ title: e.target.value })}
                                 data-testid="requirement-editor-field-title"
                                 sx={{ ...FIELD_SX, textTransform: 'none', letterSpacing: 0 }} />
                        </Field>
                        <Field label="Description">
                            <Box component="textarea" rows={6} value={draft.description ?? ''}
                                 onChange={(e) => setFields({ description: e.target.value })}
                                 data-testid="requirement-editor-field-description"
                                 sx={{ ...FIELD_SX, resize: 'vertical', textTransform: 'none', letterSpacing: 0 }} />
                        </Field>

                        <Box sx={{ display: 'grid', gap: '0.55em',
                                   gridTemplateColumns: twoCol ? 'minmax(0, 1fr) minmax(0, 1fr)' : 'minmax(0, 1fr)' }}>
                            <Field label="Project">
                                <Select value={projectId} testid="project" placeholder="Choose a project"
                                        options={projectOpts}
                                        onChange={(v) => setFields({ projectId: toInt(v), category_fk: null })} />
                            </Field>
                            <Field label="Category">
                                <Select value={draft.category_fk} testid="category"
                                        placeholder={projectId == null ? 'Choose a project first'
                                            : (Array.isArray(categories) ? 'Choose a category' : 'Loading…')}
                                        options={categoryOpts} disabled={projectId == null}
                                        onChange={(v) => setFields({ category_fk: toInt(v) })} />
                            </Field>
                            {ENUM_FIELDS.map(({ field, label, testid, options }) => (
                                <Field key={field} label={label}>
                                    <Select value={draft[field]} testid={testid} options={options}
                                            onChange={(v) => setFields({ [field]: v })} />
                                </Field>
                            ))}
                            <Field label="Machine">
                                <Select value={draft.machine_fk} testid="machine" placeholder="Any"
                                        options={machineOpts}
                                        onChange={(v) => setFields({ machine_fk: toInt(v) })} />
                            </Field>
                            <Field label="Affected repos">
                                <Box component="input" type="text" value={draft.affected_repos ?? ''}
                                     placeholder="e.g. Darwin,Lambda-Rest"
                                     onChange={(e) => setFields({ affected_repos: e.target.value })}
                                     data-testid="requirement-editor-field-repos"
                                     sx={{ ...FIELD_SX, textTransform: 'none', letterSpacing: 0 }} />
                            </Field>
                        </Box>

                        <Box component="label" title="A container holds a plan or an epic rather than being work inside it"
                             sx={{ display: 'flex', alignItems: 'center', gap: '0.5em', color: P.text, cursor: 'pointer' }}>
                            <input type="checkbox" checked={!!draft.tracking}
                                   onChange={(e) => setFields({ tracking: e.target.checked ? 1 : 0 })}
                                   data-testid="requirement-editor-field-tracking" />
                            Tracking (container)
                        </Box>

                        {error && (
                            <Box role="alert" data-testid="requirement-editor-error"
                                 sx={{ color: '#ff8a80', overflowWrap: 'anywhere' }}>
                                {error}
                            </Box>
                        )}
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: '0.6em', flexWrap: 'wrap' }}>
                            <Box component="button" type="submit" disabled={!canSave}
                                 title={orphaned ? 'Start a new requirement' : (problem || (dirty ? 'Save (⌘↵)' : 'Nothing to save'))}
                                 data-testid="requirement-editor-save"
                                 sx={{ px: '1em', py: '0.3em', border: `1px solid ${P.accent}`,
                                        borderRadius: '999px', background: canSave ? P.accent : 'transparent',
                                        color: canSave ? '#0b1220' : P.dim, fontFamily: ACTION_POPUP_MONO,
                                        fontSize: '1em', fontWeight: 700,
                                        cursor: canSave ? 'pointer' : 'default',
                                        '&:disabled': { borderColor: P.line } }}>
                                {savedId == null ? 'Save' : 'Save changes'}
                            </Box>
                            {problem && (
                                <Box component="span" data-testid="requirement-editor-problem"
                                     sx={{ color: P.dim, fontSize: '0.9em' }}>
                                    {problem}
                                </Box>
                            )}
                        </Box>
                    </Box>
                );
            }}
        </AnchoredPanel>
    );
}
