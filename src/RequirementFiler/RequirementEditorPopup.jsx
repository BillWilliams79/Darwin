// RequirementEditorPopup.jsx — the popup requirement editor (req #3811): the
// second floating window the Requirement Filer opens. A short editor of ONE
// requirement's directly settable values: title, description, project →
// category, and — behind its spec-code button — status, autonomy, model,
// effort and machine (Any = NULL). No tracking (container) flag: req #3982
// removed it (requirementFilerModel.js says what that means for a save).
//
// ── A DELIBERATE RULE VIOLATION, RULED BY THE USER ─────────────────────────
// This DUPLICATES the requirement editing surfaces (CategoryCard,
// RequirementRow, RequirementDetail) instead of sharing them — the user's
// ruling, 2026-10-23: "let's violate a rule and make a popup edit version of a
// requirement". Do not refactor those editors to share code with this one,
// and do not fold this one into them on DRY grounds.
//
// AS SHORT AS POSSIBLE (user rulings 2026-10-23, req #3815): `<id> - <title>`
// across the whole width; `Project - <project>` with the SPEC-CODE BUTTON at its
// right — the four launch fields as their five letters (SRDOH, SRIOH …, plus the
// machine when one is pinned), derived and never stored (requirementFilerModel.js
// specCode); then
// `Category - <category>`, a line each; a description that grows to the bottom
// of the screen and then scrolls, folded to two lines by its own toggle; and
// one row holding CREATE (greyed until it can create — no reason text — then
// dark green) and, right-justified, the DEBUG CAPTURE button with the capture's
// size beside it, whose details slide open below. The spec-code button slides
// the settings open in place:
// Status and Autonomy chip rows, an AI Settings box (Model, Effort), Machine —
// the requirement page's chips, drawn here under the ruling above.
// A new requirement starts with the last one's settings (SRDOH before any).
//
// THE DEBUG CAPTURE (req #3815) — every draft the filer opens carries one
// (debugBundle.js), where it was filed from among its categories. The editor
// shows its size per category behind a Details button and lets the reader drop
// a category before the first save. That save writes three things, in order:
// the requirement (POST), the capture row with its id (POST
// requirement_debug_captures — one per requirement, so a retry that finds it
// there, a duplicate-key 409, counts as saved), and ONLY when that answers, the
// description's `Debug capture` block pointing at it (PUT). A failed capture
// write leaves the requirement filed with no pointer to nothing; the capture
// stays in memory and the editor offers Retry. Dropping every category files the
// requirement with no capture.
//
// INTO AN EPIC (req #3854) — a draft the filer's + started while aimed at a
// plan visualizer's epic card carries that epic (`draft.seat`, filerEpicAim.js),
// shown on an `Epic - <title>` line under Category with a × to drop it. Create
// POSTs the requirement, then seats it there (Epics/epicsApi.js
// moveEpicRequirement) before its capture is written; a locked epic, or a plan
// read from another database than the filer files into, is said on the line and
// not written.
//
// SAVING (user ruling 2026-10-23): the first save is the deliberate CREATE press,
// so a half-typed title never becomes a row; after that every change saves on
// its own, LIVE_SAVE_MS after the last edit, like the requirement page. A failed
// live save is shown with Retry and not re-sent until something changes.
//
// CREATE CLOSES THE EDITOR AT THE PRESS (req #3860, "try out having the
// requirement editor close as soon as you click create"): the requirement, its
// capture and the description's link are written with the editor hidden — this
// component stays mounted, so the save runs on — and the filer's list shows it
// filed; a click there brings it back. A create that FAILS brings the editor
// back on its draft, so what was typed, the error and Retry are never hidden.
// While it is being written the store's `creating` holds its key, and the
// filer's + and a reopen wait for it (RequirementFiler.jsx createSettled).
// Its fields, the saved id and where it floats live in useRequirementFilerStore
// — racking re-mounts this subtree, and a draft survives a reload.
//
// An AnchoredPanel in the Action Popups' chrome, rackable like every other.
// Native controls on purpose — buttons for the chips, <select> for the lists:
// they render the same racked in AI Architecture's toolbar (a shadow root in an
// iframe), where a portalled MUI menu would open in the wrong document.

import { useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';

import Box from '@mui/material/Box';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import UnfoldLessIcon from '@mui/icons-material/UnfoldLess';
import UnfoldMoreIcon from '@mui/icons-material/UnfoldMore';
import useMediaQuery from '@mui/material/useMediaQuery';

import AnchoredPanel from '../Components/AnchoredPanel/AnchoredPanel';
import { ActionPopupClose } from '../Components/AnchoredPanel/ActionPopupHead';
import {
    ACTION_POPUP_COLORS, ACTION_POPUP_FONT_PX, ACTION_POPUP_HEAD_PX, ACTION_POPUP_MONO, ACTION_POPUP_SX,
} from '../Components/AnchoredPanel/actionPopupChrome';
import { validDock } from '../Components/AnchoredPanel/anchoredPanelGeometry';
import AppContext from '../Context/AppContext';
import AuthContext from '../Context/AuthContext';
import { pipelineEpicRequirementKeys, useCategories, useMachines, useProjects } from '../hooks/useDataQueries';
import { requirementKeys } from '../hooks/useQueryKeys';
import { SIDEBAR_WIDTH } from '../NavBar/navConfig';
import call_rest_api from '../RestApi/RestApi';
import { EDITOR_DEFAULT_HT, useRequirementFilerStore } from '../stores/useRequirementFilerStore';
import { prodRequirementUrl, PROD_HOST } from '../utils/prodUrl';
import { PLAN_VIZ_PALETTE as P } from '../SwarmView/pipelines/pipelinePlanLayout';
import { COORDINATION_COLOR } from '../SwarmView/coordinationChipStyles';
import { AI_MODEL_COLOR, AI_MODELS, aiModelLabel } from '../SwarmView/modelChipStyles';
import { EFFORT_COLOR, EFFORTS, effortLabel } from '../SwarmView/effortChipStyles';
import {
    DEBUG_CATEGORIES, assembleBundle, debugCaptureUri, formatBytes, formatDebugBlock, keepsNothing, withDebugBlock,
} from './debugBundle';
import { BUG_COLOR } from './RequirementFiler';
import { EDITOR_Z } from './filerHover';
import { useFilerFilesElsewhere } from './filerScope';
import { notifyEpicSeated, seatProblem } from './filerEpicAim';
import { moveEpicRequirement } from '../Epics/epicsApi';
import {
    buildPostBody, buildPutBody, defaultProjectId, draftDirty, draftProblem, machineOptions, savedValues, specCode,
    staleCategory, staleMachine,
} from './requirementFilerModel';

/** Its id in the panel rack. */
export const EDITOR_RACK_ID = 'requirement-editor';
const MIN_W = 180;
const MIN_H = 64;
const LIMITS = { minW: MIN_W, minH: MIN_H, autoMaxW: 640, headPx: ACTION_POPUP_HEAD_PX };
/** Floating home: top-left, beside the Requirement Filer's home — as wide as
 *  its form, the size every open gives it (useRequirementFilerStore). */
export const EDITOR_HOME = Object.freeze({ h: 'l', x: SIDEBAR_WIDTH + 16, v: 't', y: 92, w: null, ht: null });
/** The form's width while the panel is content-sized — 44em of fields inside
 *  FORM_PAD_EM a side. */
const FORM_PAD_EM = 1.1;
const FORM_EM = 44 + 2 * (FORM_PAD_EM - 0.6);
/** The space between the settings' rows, em — the AI Settings box's two as well. */
const SETTINGS_GAP_EM = 0.9;
/** A filed requirement's edits save this long after the last one. */
export const LIVE_SAVE_MS = 600;
/** The row labels' column, so every row's first chip starts at the same x. */
const ROW_LABEL_EM = 6.5;
/** The description's cap where the screen cannot be measured (racked: the
 *  rack sets the panel's height) and before the first measure. */
const DESCRIPTION_FALLBACK_MAX = '14em';
/** Kept clear between the panel's foot and the screen's edge, px. */
const DESCRIPTION_SCREEN_GAP_PX = 4;
/** Folded: two lines, as a new draft's description starts. */
const DESCRIPTION_TWO_LINES = 'calc(2lh + 0.4em + 2px)';

const FIELD_SX = {
    width: '100%', boxSizing: 'border-box', m: 0,
    fontFamily: ACTION_POPUP_MONO, fontSize: '1em', lineHeight: 1.4,
    color: P.text, background: '#0b1220',
    border: `1px solid ${P.line}`, borderRadius: '0.4em', px: '0.5em', py: '0.3em',
    outline: 'none', '&:focus': { borderColor: P.accent },
    '&:disabled': { opacity: 0.5 },
    '& option': { background: '#0b1220', color: P.text },
};
const INVALID = '#ff8a80';
/** Create, once it can create: dark green (user, 2026-10-23) — the Met chip's green. */
const CREATE_GREEN = '#2e7d32';
const TEXT_BUTTON_SX = {
    px: '1em', py: '0.3em', border: `1px solid ${P.text}`, borderRadius: '999px',
    background: 'transparent', color: P.text, fontFamily: ACTION_POPUP_MONO,
    fontSize: '1em', fontWeight: 700, cursor: 'pointer',
    '&:hover': { color: P.accent, borderColor: P.accent },
};
const LABEL_SX = {
    display: 'flex', flexDirection: 'column', gap: '0.2em', minWidth: 0,
    color: P.dim, fontSize: '0.85em', letterSpacing: '0.06em', textTransform: 'uppercase',
};
/** A slide-open region: a grid row animating 0fr → 1fr is a height transition
 *  to the content's own height, with no measuring (works racked in a shadow root). */
const slideSx = (open) => ({ display: 'grid', gridTemplateRows: open ? '1fr' : '0fr',
    transition: 'grid-template-rows 220ms ease, opacity 220ms ease', opacity: open ? 1 : 0 });

function Select({ value, onChange, options, testid, placeholder, disabled, invalid, sx, label }) {
    return (
        <Box component="select" value={value ?? ''} disabled={disabled}
             onChange={(e) => onChange(e.target.value)}
             data-testid={`requirement-editor-field-${testid}`} aria-invalid={invalid ? 'true' : undefined}
             aria-label={label}
             sx={{ ...FIELD_SX, textTransform: 'none', letterSpacing: 0, ...sx,
                    ...(invalid ? { borderColor: INVALID, borderBottomColor: INVALID } : null) }}>
            {placeholder != null && <option value="">{placeholder}</option>}
            {options.map(o => <option key={String(o.value)} value={o.value}>{o.label}</option>)}
        </Box>
    );
}

// The requirement page's chip labels and colours (RequirementDetail.jsx),
// written out here under the duplication ruling.
const STATUS_CHIPS = Object.freeze([
    { value: 'authoring', label: 'Authoring', bg: '#fbc02d', fg: '#000' },
    { value: 'approved', label: 'Approved', bg: '#90caf9', fg: '#000' },
    { value: 'swarm_ready', label: 'Swarm-Start', bg: '#1976d2', fg: '#fff' },
    { value: 'development', label: 'Dev', bg: '#81c784', fg: '#000' },
    { value: 'met', label: 'Met', bg: '#2e7d32', fg: '#fff' },
    { value: 'deferred', label: 'Deferred', bg: '#ff9800', fg: '#fff' },
    { value: 'wontfix', label: "Won't Fix", bg: '#9e9e9e', fg: '#fff' },
]);
const AUTONOMY_CHIPS = Object.freeze([
    { value: 'discuss', label: 'Discuss Req' }, { value: 'planned', label: 'Planned' },
    { value: 'implemented', label: 'Implemented' }, { value: 'deployed', label: 'Deployed' },
].map(o => ({ ...o, bg: COORDINATION_COLOR[o.value], fg: '#000' })));
const MODEL_CHIPS = Object.freeze(AI_MODELS.map(v => ({ value: v, label: aiModelLabel(v), bg: AI_MODEL_COLOR[v], fg: '#000' })));
const EFFORT_CHIPS = Object.freeze(EFFORTS.map(v => ({ value: v, label: effortLabel(v), bg: EFFORT_COLOR[v], fg: '#000' })));
/** The Machine row's chips are neutral, as on the requirement page. */
const MACHINE_CHIP = { bg: '#3d4554', fg: '#fff' };

const ROW_LABEL_SX = { width: `${ROW_LABEL_EM}em`, flexShrink: 0, color: P.dim,
    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' };

/** One choice among a few, as a row of chips. The group carries its value
 *  (`data-value`, '' for none); each chip is `<testid>-<value>` (`-any` for none). */
function ChipRow({ label, testid, value, options, onChange, invalid, labelEm = ROW_LABEL_EM }) {
    return (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: '0.5em', minWidth: 0 }}>
            <Box component="span" sx={{ ...ROW_LABEL_SX, width: `${labelEm}em` }}>{label}</Box>
            <Box role="group" aria-label={label} data-chips="1" data-value={value ?? ''}
                 data-testid={`requirement-editor-field-${testid}`}
                 sx={{ display: 'flex', flexWrap: 'wrap', gap: '0.3em', minWidth: 0 }}>
                {options.map((o) => {
                    const selected = (o.value ?? null) === (value ?? null);
                    return (
                        <Box component="button" type="button" key={String(o.value)}
                             aria-pressed={selected ? 'true' : 'false'}
                             data-testid={`requirement-editor-field-${testid}-${o.value ?? 'any'}`}
                             onClick={() => { if (!selected) onChange(o.value ?? null); }}
                             sx={{ px: '0.65em', py: '0.15em', borderRadius: '999px', cursor: 'pointer',
                                    fontFamily: ACTION_POPUP_MONO, fontSize: '0.95em', lineHeight: 1.4, whiteSpace: 'nowrap',
                                    border: `1px solid ${selected ? o.bg : (invalid ? INVALID : P.line)}`,
                                    background: selected ? o.bg : 'transparent',
                                    color: selected ? o.fg : P.text, opacity: selected ? 1 : 0.7,
                                    '&:hover': { opacity: 1 } }}>
                            {o.label}
                        </Box>
                    );
                })}
            </Box>
        </Box>
    );
}

/** The requirement page's captioned box: a real <fieldset>/<legend>, so the
 *  caption sits on the border line. */
function Fieldset({ legend, testid, children }) {
    return (
        <Box component="fieldset" data-testid={testid}
             sx={{ m: 0, minWidth: 0, alignSelf: 'flex-start', px: '0.8em', pt: '0.1em', pb: '0.8em',
                    border: `1px solid ${P.text}`, borderRadius: '0.6em',
                    display: 'flex', flexDirection: 'column', gap: `${SETTINGS_GAP_EM}em` }}>
            <Box component="legend" sx={{ px: '0.35em', ml: '0.3em', color: P.dim }}>{legend}</Box>
            {children}
        </Box>
    );
}

/** A <select> that reads as text until it is clicked — the requirement page's
 *  Category select. */
const TEXT_SELECT_SX = {
    border: 'none', borderBottom: '1px solid transparent', borderRadius: 0, background: 'transparent',
    px: 0, py: '0.05em', width: 'auto', maxWidth: '100%', minWidth: 0, cursor: 'pointer',
    // No dropdown arrow: it reads as text, as on the requirement page.
    appearance: 'none', WebkitAppearance: 'none', MozAppearance: 'none',
    '&:hover:not(:disabled)': { borderBottomColor: P.line }, '&:focus': { borderBottomColor: P.accent },
};

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

/** The store once the draft `key`'s capture is no longer being built — it is
 *  snapshotted at the press and done within its 250 ms wait, so the bound is
 *  only a backstop. */
export function captureSettled(key, timeoutMs = 3000) {
    const done = (st) => st.draftKey !== key || st.captureStage !== 'capturing';
    const now = useRequirementFilerStore.getState();
    if (done(now)) return Promise.resolve(now);
    return new Promise((resolve) => {
        const timer = setTimeout(() => { unsub(); resolve(useRequirementFilerStore.getState()); }, timeoutMs);
        const unsub = useRequirementFilerStore.subscribe((st) => {
            if (done(st)) { clearTimeout(timer); unsub(); resolve(st); }
        });
    });
}

/** The description's open size, px (req #3982): `max`, the tallest it may grow
 *  so the panel ends at the screen's edge — what the panel can reach from its
 *  docked edge, less its head and frame and everything in its body but the
 *  description; `min`, the height that brings the panel to EDITOR_DEFAULT_HT
 *  (never above `max`). null when racked: the rack sets the panel's height.
 *  Measured from scroll sizes, so a body already scrolling answers the same as
 *  one that is not. */
export function descriptionSizePx(el, dockV) {
    const panel = el?.closest('[data-testid="requirement-editor"]');
    const body = el?.closest('[data-testid="requirement-editor-body"]');
    if (!panel || !body || panel.dataset.racked === '1') return null;
    const doc = el.ownerDocument;
    const vh = doc.documentElement.clientHeight || doc.defaultView?.innerHeight || 0;
    if (!vh) return null;
    const p = panel.getBoundingClientRect();
    const reach = dockV === 'b' ? p.bottom : vh - p.top;
    const chrome = p.height - body.clientHeight;
    const rest = body.scrollHeight - el.offsetHeight;
    const max = Math.max(0, Math.floor(reach - chrome - rest - DESCRIPTION_SCREEN_GAP_PX));
    return { max, min: Math.min(max, Math.max(0, Math.floor(EDITOR_DEFAULT_HT - chrome - rest))) };
}

/** The debug capture's place on the File row (req #3815): a DEBUG CAPTURE
 *  button — it slides the categories open below (CaptureDetails) — a trash can
 *  that drops every category (req #3887), and the size of what is kept. No
 *  status text: the size is the whole report. */
function CaptureLine({ capture, dropped, canDropAll, onDropAll, expanded, onExpand }) {
    // Nothing kept saves nothing, so it measures 0 — not the bundle's bare header.
    const total = useMemo(() => (capture && !keepsNothing(capture, dropped) ? assembleBundle(capture, dropped).bytes : 0), [capture, dropped]);
    return (
        <Box data-testid="requirement-editor-capture"
             sx={{ ml: 'auto', minWidth: 0, display: 'flex', alignItems: 'center', gap: '0.45em', flexWrap: 'wrap' }}>
            <Box component="button" type="button" onClick={capture ? onExpand : undefined} disabled={!capture}
                 aria-expanded={expanded ? 'true' : 'false'} aria-controls="requirement-editor-capture-details"
                 data-testid="requirement-editor-capture-details-toggle"
                 sx={{ px: '0.7em', py: '0.1em', border: `1px solid ${expanded ? BUG_COLOR : P.line}`, borderRadius: '999px',
                        background: 'transparent', color: BUG_COLOR, fontFamily: ACTION_POPUP_MONO, fontSize: '1em',
                        fontWeight: 700, cursor: capture ? 'pointer' : 'default', whiteSpace: 'nowrap',
                        '&:hover:not(:disabled)': { borderColor: BUG_COLOR }, '&:disabled': { opacity: 0.6 } }}>
                Debug Capture
            </Box>
            <Box component="button" type="button" onClick={onDropAll} disabled={!canDropAll}
                 aria-label="Drop every debug capture category" title="Drop everything"
                 data-testid="requirement-editor-capture-drop-all"
                 sx={{ display: 'inline-flex', p: '0.1em', border: 'none', background: 'transparent', color: P.dim,
                        cursor: canDropAll ? 'pointer' : 'default', '&:hover:not(:disabled)': { color: BUG_COLOR },
                        '&:disabled': { opacity: 0.4 } }}>
                <DeleteOutlineIcon sx={{ fontSize: '1.2em' }} />
            </Box>
            <Box component="span" data-testid="requirement-editor-capture-status"
                 sx={{ color: P.dim, fontSize: '0.9em' }}>{capture ? formatBytes(total) : ''}</Box>
        </Box>
    );
}

/** What the capture holds, per category, each droppable until it is sent —
 *  slid open from CaptureLine's Details; with Retry and the saved row's URI. */
function CaptureDetails({ capture, dropped, stage, savedId, locked, expanded, onToggle, onRetry }) {
    // Once a save has sent the bundle, the selection is what was sent.
    const editable = stage === 'ready' && !locked;
    // Filed from always first, a light dashed line, then the rest biggest to
    // smallest (req #3887). Sizes are fixed at capture time; the sort is stable.
    const [filedFrom, rest] = useMemo(() => {
        const cats = capture?.categories ?? [];
        return [cats.find(c => c.key === 'filedFrom'),
                cats.filter(c => c.key !== 'filedFrom').sort((a, b) => b.bytes - a.bytes)];
    }, [capture]);
    return (
        <>
            {capture && (
                <Box id="requirement-editor-capture-details" data-testid="requirement-editor-capture-details"
                     data-open={expanded ? '1' : '0'} aria-hidden={expanded ? undefined : 'true'}
                     inert={expanded ? undefined : ''} sx={slideSx(expanded)}>
                    <Box sx={{ overflow: 'hidden', minHeight: 0 }}>
                        <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0, display: 'grid',
                                                  gridTemplateColumns: 'auto minmax(0, 1fr) auto', columnGap: '0.5em',
                                                  rowGap: '0.1em', alignItems: 'baseline' }}>
                            {[filedFrom, 'rule', ...rest].filter(Boolean).map((c) => {
                                if (c === 'rule') {
                                    return filedFrom ? (
                                        <Box component="li" key="rule" aria-hidden="true"
                                             data-testid="requirement-editor-capture-rule"
                                             sx={{ gridColumn: '1 / -1', borderTop: `1px dashed ${P.line}`, opacity: 0.6, my: '0.15em' }} />
                                    ) : null;
                                }
                                const { key, bytes, note } = c;
                                const label = DEBUG_CATEGORIES.find(c => c.key === key)?.label ?? key;
                                const kept = !dropped.includes(key);
                                return (
                                    <Box component="li" key={key} data-testid={`requirement-editor-capture-${key}`}
                                         sx={{ display: 'contents', color: kept ? P.text : P.dim }}>
                                        <input type="checkbox" checked={kept} disabled={!editable}
                                               onChange={() => onToggle(key)}
                                               aria-label={`Include ${label}`}
                                               data-testid={`requirement-editor-capture-toggle-${key}`} />
                                        <Box component="span" title={note || undefined}
                                             sx={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                                    textDecoration: kept ? 'none' : 'line-through' }}>
                                            {label}{note ? <Box component="span" sx={{ color: P.dim }}> · {note}</Box> : null}
                                        </Box>
                                        <Box component="span" data-testid={`requirement-editor-capture-bytes-${key}`}
                                             sx={{ color: P.dim, textAlign: 'right' }}>{formatBytes(bytes)}</Box>
                                    </Box>
                                );
                            })}
                        </Box>
                    </Box>
                </Box>
            )}
            {capture?.jwtHits > 0 && expanded && (
                <Box data-testid="requirement-editor-capture-redacted" sx={{ color: BUG_COLOR }}>
                    {capture.jwtHits} token-shaped value{capture.jwtHits === 1 ? '' : 's'} redacted
                </Box>
            )}
            {stage === 'done' && savedId != null && expanded && (
                <Box component="span" data-testid="requirement-editor-capture-uri"
                     sx={{ color: P.dim, overflowWrap: 'anywhere' }}>{debugCaptureUri(savedId)}</Box>
            )}
            {onRetry && (
                <Box component="button" type="button" onClick={onRetry}
                     data-testid="requirement-editor-capture-retry"
                     sx={{ ...TEXT_BUTTON_SX, alignSelf: 'flex-start' }}>
                    Retry debug capture
                </Box>
            )}
        </>
    );
}

export default function RequirementEditorPopup() {
    const { profile, idToken } = useContext(AuthContext);
    const { darwinUri } = useContext(AppContext);
    const queryClient = useQueryClient();
    const filesElsewhere = useFilerFilesElsewhere();
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
    const capture = useRequirementFilerStore(s => s.capture);
    const captureDropped = useRequirementFilerStore(s => s.captureDropped);
    const captureStage = useRequirementFilerStore(s => s.captureStage);
    const captureSentDropped = useRequirementFilerStore(s => s.captureSentDropped);
    const descriptionCollapsed = useRequirementFilerStore(s => s.descriptionCollapsed);
    const { setEditorShow, toggleEditorOpen, setEditorDock, setFields, markSaved, markOrphaned,
        clearFocusPending, toggleCaptureCategory, dropAllCaptureCategories, setCaptureStage, markCaptureSent,
        setCreating, endCreating, clearSeat, toggleDescriptionCollapsed, discardDeleted } = useRequirementFilerStore.getState();
    // Always as tall as its content (user, 2026-10-23: "probably 3x too tall"):
    // a height stored from an earlier, longer form is never applied.
    const dock = { ...(validDock(storedDock, MIN_W, MIN_H) || EDITOR_HOME), ht: null };
    // Both belong to the draft they were set for (`key`): a save still in flight
    // when another requirement is started reports nothing over the new one.
    const [saving, setSaving] = useState(null);
    const [failure, setFailure] = useState(null);
    const error = failure?.key === draftKey ? failure.text : null;
    // A failure is shown where it can be read: on a create, Create closed the
    // editor (req #3860), so it comes back — on that draft only, never over
    // another, and never for a later save the reader closed it on.
    const failOpen = (f) => {
        setFailure(f);
        const st = useRequirementFilerStore.getState();
        if (st.draftKey === f.key && st.creating === f.key) setEditorShow(true);
    };
    // The settings behind the spec-code button: closed for every new draft.
    const [settingsOpen, setSettingsOpen] = useState(false);
    // The capture's per-category details, behind its Details button.
    const [captureOpen, setCaptureOpen] = useState(false);
    // Delete (req #4152): two presses — the first asks, the second deletes.
    const [confirmDelete, setConfirmDelete] = useState(false);
    const [deleting, setDeleting] = useState(false);
    // Read by save() and the live save: nothing is PUT to a row being deleted.
    const deletingRef = useRef(false);
    useEffect(() => { setSettingsOpen(false); setCaptureOpen(false); setConfirmDelete(false); }, [draftKey]);
    const titleRef = useRef(null);
    // The description's own element, as state: racking re-mounts it, and the
    // measure below must follow the new one.
    const [descEl, setDescEl] = useState(null);
    const [descCap, setDescCap] = useState(null);
    const [descMin, setDescMin] = useState(null);

    const user = profile?.userName;
    const visible = show && isDesktop && !!user && !!draft;
    const { data: projects, isError: projectsError } = useProjects(user, { closed: 0, enabled: visible });
    const projectId = draft?.projectId ?? null;
    // Default fields: the open-categories cache key does not carry them, so a
    // narrower read here would hand other readers of that key a narrower row.
    const { data: categories, isError: categoriesError } = useCategories(user, projectId,
        { closed: 0, enabled: visible && projectId != null });
    const { data: machines, isError: machinesError } = useMachines(user, { enabled: visible });

    // What a new draft carried from the last requirement — its place and its
    // machine — is checked once against live data: a closed or deleted one is
    // dropped and said so, and File waits for the verdict (draftProblem). A failed
    // read cannot vouch for it either. An entry this version does not know (an
    // older version's 'seat') is dropped, never left holding File.
    const unchecked = draft?.defaultsUnchecked ?? [];
    useEffect(() => {
        if (!visible || !unchecked.length) return;
        const verdicts = {
            category: () => staleCategory(draft, projects, categories, projectsError || categoriesError),
            machine: () => {
                const r = staleMachine(draft, machines);
                return r === undefined && machinesError ? 'could not be checked' : r;
            },
        };
        const patch = { defaultsUnchecked: [] };
        const notes = [];
        for (const f of unchecked) {
            if (!verdicts[f]) continue;
            const reason = verdicts[f]();
            if (reason === undefined) return;     // its read has not landed yet
            if (!reason) continue;
            if (f === 'category') {
                Object.assign(patch, { category_fk: null, ...(reason.project ? { projectId: null } : null) });
                // A place aimed at a category card (req #4026) is the card's, not the last requirement's.
                const whose = draft.aimedPlace ? "The aimed card's" : "The last requirement's";
                notes.push(`${whose} ${reason.project ? 'project' : 'category'} ${reason.text} — choose one`);
            } else {
                patch.machine_fk = null;
                notes.push(`The last requirement's machine ${reason} — Any instead`);
            }
        }
        patch.notice = notes.length ? `${notes.join('; ')}.` : null;
        setFields(patch);
    });

    // A draft with no place starts in Darwin (req #3830) — never over a carried
    // place still being checked, nor over a project the reader chose.
    const fallbackProject = defaultProjectId(projects);
    useEffect(() => {
        if (!visible || projectId != null || draft.category_fk != null
            || unchecked.includes('category') || fallbackProject == null) return;
        setFields({ projectId: fallbackProject });
    }, [visible, projectId, draft?.category_fk, unchecked.length, fallbackProject]);

    // The title takes focus once, for a requirement just started — never on a
    // reload or a rack/unrack remount, which would pull focus off the page.
    useEffect(() => {
        if (visible && focusPending && titleRef.current) {
            titleRef.current.focus();
            clearFocusPending();
        }
    });

    // Open, the description fills the panel to its default height, grows past
    // it until the panel meets the screen's edge, then scrolls (req #3982).
    // Re-measured whenever the panel or its form changes size (typing, the
    // settings sliding open, a reshape), moves, or the window resizes. The measure is invariant in the description's own height, so
    // applying it cannot set off another.
    const dockV = dock.v;
    useLayoutEffect(() => {
        if (!descEl || descriptionCollapsed) return undefined;
        const win = descEl.ownerDocument.defaultView;
        const measure = () => {
            const size = descriptionSizePx(descEl, dockV);
            setDescCap(size?.max ?? null);
            setDescMin(size?.min ?? null);
        };
        measure();
        // The next frame, not inside the observer's own callback: a new cap
        // resizes what it observes, which the browser reports as a loop.
        let frame = null;
        const later = () => {
            if (frame != null || !win?.requestAnimationFrame) return;
            frame = win.requestAnimationFrame(() => { frame = null; measure(); });
        };
        const RO = win?.ResizeObserver ?? (typeof ResizeObserver === 'undefined' ? null : ResizeObserver);
        const ro = RO ? new RO(later) : null;
        const form = descEl.closest('form');
        const panel = descEl.closest('[data-testid="requirement-editor"]');
        if (ro) { if (form) ro.observe(form); if (panel) ro.observe(panel); }
        win?.addEventListener('resize', later);
        return () => {
            ro?.disconnect();
            win?.removeEventListener('resize', later);
            if (frame != null) win.cancelAnimationFrame(frame);
        };
    }, [descEl, descriptionCollapsed, dockV, storedDock, open]);

    // Live saving once filed: the save itself is defined below the early return,
    // so the effect calls the newest through a ref. Not gated on the editor being
    // shown: an edit made just before × still reaches the row — the ref keeps the
    // last render's closure, and the draft cannot change while the form is hidden.
    const liveSaveRef = useRef(null);
    const failedDraftRef = useRef(null);
    // The key of the save in flight, readable from a hidden editor's stale closure.
    const savingRef = useRef(null);
    useEffect(() => {
        if (savedId == null || saving === draftKey) return undefined;
        const t = setTimeout(() => liveSaveRef.current?.(), LIVE_SAVE_MS);
        return () => clearTimeout(t);
    }, [draft, savedId, saving, draftKey, deleting]);

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
    const machineLabel = draft.machine_fk == null ? null
        : (machineOpts.find(o => o.value === draft.machine_fk)?.label ?? `Machine ${draft.machine_fk}`);
    const categoryColor = (Array.isArray(categories) ? categories : []).find(c => c.id === draft.category_fk)?.color || null;

    // A capture a reload lost is not shown at all (user ruling 2026-10-23,
    // req #3830): the requirement simply files without one.
    const hasCapture = captureStage != null && captureStage !== 'lost';
    // File never waits on the capture: the capture save, after the requirement
    // is filed, waits for it instead (captureSettled).
    const problem = draftProblem(draft);
    const canSave = !problem && draftDirty(draft, savedId, saved) && saving !== draftKey && !orphaned;
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

    // The draft's debug capture, once its requirement `id` exists (req #3815):
    // the capture row, then the description block that points at it. Each half
    // that lands advances the stage, so a retry resumes where the last stopped.
    const saveCapture = async (key, id) => {
        const st = await captureSettled(key);
        if (st.draftKey !== key) return;
        let stage = st.captureStage;
        // Still being built when its wait ran out: shown with Retry once it is
        // ready, rather than left unsent behind the closed editor (req #3860).
        if (stage === 'capturing' && st.creating === key) setEditorShow(true);
        if (stage === 'ready') {
            // The first send fixes the selection: a retry sends, and the block
            // describes, exactly what that send carried.
            const sent = st.captureSentDropped ?? st.captureDropped;
            markCaptureSent(key, sent);
            // Every category dropped: the requirement files with no capture at all.
            if (keepsNothing(st.capture, sent)) { setCaptureStage(key, 'none'); return; }
            const { text, bytes } = assembleBundle(st.capture, sent);
            let ok = false;
            try {
                const res = await call_rest_api(`${darwinUri}/requirement_debug_captures`, 'POST',
                    { requirement_fk: id, bundle: text, bundle_bytes: bytes, creator_fk: user }, idToken);
                const status = res?.httpStatus?.httpStatus;
                ok = status === 200 || status === 201;
                if (!ok) failOpen({ key, text: errorText(res, `#${id} saved, but its debug capture was not`) });
            } catch (e) {
                // One capture per requirement: a DUPLICATE-KEY 409 is the row an
                // earlier try wrote. A foreign-key 409 (the requirement is gone) is not.
                ok = e?.httpStatus?.httpStatus === 409 && Number(e?.httpStatus?.httpDetail?.errno) === 1062;
                if (!ok) failOpen({ key, text: errorText(e, `#${id} saved, but its debug capture was not`) });
            }
            if (!ok) return;
            stage = 'posted';
            setCaptureStage(key, stage);
        }
        if (stage !== 'posted') return;
        const now = useRequirementFilerStore.getState();
        if (now.draftKey !== key) return;
        const block = formatDebugBlock(now.capture, now.captureSentDropped ?? now.captureDropped, id);
        const description = withDebugBlock(now.saved?.description ?? '', block);
        try {
            const res = await call_rest_api(`${darwinUri}/requirements`, 'PUT', [{ id, description }], idToken);
            const status = res?.httpStatus?.httpStatus;
            if (status !== 200 && status !== 204) {
                failOpen({ key, text: errorText(res, `#${id}'s debug capture is saved, but its description does not point at it yet`) });
                return;
            }
        } catch (e) {
            failOpen({ key, text: errorText(e, `#${id}'s debug capture is saved, but its description does not point at it yet`) });
            return;
        }
        queryClient.invalidateQueries({ queryKey: requirementKeys.all(user) });
        const after = useRequirementFilerStore.getState();
        if (after.draftKey !== key) return;
        // The block is now in the row: in the draft too, so a later save keeps it.
        setFields({ description: withDebugBlock(after.draft?.description ?? '', block) });
        markSaved(key, id, { ...after.saved, description });
        setCaptureStage(key, 'done');
    };

    // The Epic line's outcome, on the draft it was written for only.
    const markSeat = (key, seat, outcome) => {
        const st = useRequirementFilerStore.getState();
        if (st.draftKey === key && st.draft?.seat?.epicId === seat.epicId) {
            setFields({ seat: { ...st.draft.seat, ...outcome } });
        }
    };
    // The plan epic the filer's + was aimed at (req #3854), once its requirement
    // `id` exists: one seat write, then the plan refreshes. A failure leaves the
    // requirement filed and unseated — it waits in the plan's unorchestrated box.
    const seatInEpic = async (key, id, seat) => {
        try {
            await moveEpicRequirement(darwinUri, idToken, { requirementId: id, toEpicId: seat.epicId });
        } catch (e) {
            failOpen({ key, text: errorText(e, `#${id} filed, but not placed in ${seat.title}`) });
            markSeat(key, seat, { failed: true });
            return;
        }
        notifyEpicSeated(seat.epicId);
        markSeat(key, seat, { placed: true });
    };

    // Retry: the capture half only, for a requirement already saved.
    const retryCapture = async () => {
        if (savedId == null || saving === draftKey) return;
        const key = draftKey;
        setSaving(key);
        setFailure(null);
        try { await saveCapture(key, savedId); } finally { setSaving(s => (s === key ? null : s)); }
    };

    // call_rest_api RESOLVES 200/201/204 and the transport failure (503), and
    // THROWS {data, httpStatus} for every gateway error — both reach the reader.
    // `live` — called by live saving, which has already judged the draft from the
    // store (this closure's `canSave` may be a hidden render's, stale).
    const save = async (live = false) => {
        if (deletingRef.current) return;
        if (!live && !canSave) return;
        // A live save only ever PUTs: a closure from before the create landed
        // (the editor it closed renders nothing) must never POST it twice.
        if (live && savedId == null) return;
        const key = draftKey;
        const isPost = savedId == null;
        const fail = (res, text) => {
            failedDraftRef.current = draft;
            (isPost ? failOpen : setFailure)({ key, text: errorText(res, text) });
        };
        savingRef.current = key;
        setSaving(key);
        setFailure(null);
        const values = savedValues(draft);
        const uri = `${darwinUri}/requirements`;
        let id = savedId;
        // CREATE closes the editor at the press (req #3860); the rest is written hidden.
        if (isPost) { setCreating(key); setEditorShow(false); }
        try {
            if (isPost) {
                const body = buildPostBody(draft);
                const res = await call_rest_api(uri, 'POST', body, idToken);
                const status = res?.httpStatus?.httpStatus;
                if (status !== 200 && status !== 201) return fail(res, 'Requirement not saved');
                queryClient.invalidateQueries({ queryKey: requirementKeys.all(user) });
                id = res.data?.[0]?.id ?? await findNewId(body);
                if (id == null) {
                    // Saved, but no id to PUT later edits to: keep what was typed,
                    // and refuse a second save that would POST a duplicate.
                    markOrphaned(key);
                    failOpen({ key, text: `Saved, but its id could not be read back — find it on ${
                        filesElsewhere ? `${PROD_HOST}/swarm` : '/swarm'}, or start a new requirement.` });
                    return;
                }
            } else {
                const body = buildPutBody(savedId, draft, saved);
                if (body) {
                    const res = await call_rest_api(uri, 'PUT', body, idToken);
                    const status = res?.httpStatus?.httpStatus;
                    if (status !== 200 && status !== 204) return fail(res, 'Changes not saved');
                    queryClient.invalidateQueries({ queryKey: requirementKeys.all(user) });
                }
            }
            markSaved(key, id, values);
            if (useRequirementFilerStore.getState().captureStage) await saveCapture(key, id);
            // Into the epic the + was aimed at (req #3854) — as Create was pressed.
            // Last: the seat makes it launchable, so its row is complete first.
            if (isPost && draft.seat && !seatProblem(draft.seat, darwinUri)) await seatInEpic(key, id, draft.seat);
        } catch (e) {
            fail(e, isPost ? 'Requirement not saved' : 'Changes not saved');
        } finally {
            if (isPost) endCreating(key);
            if (savingRef.current === key) savingRef.current = null;
            setSaving(s => (s === key ? null : s));
        }
    };

    // Asked of the store as it is NOW: while the editor is hidden this closure is
    // the last render's, whose `saved` never moves — trusting it re-sent the same
    // PUT on every pass. A save that has landed leaves nothing dirty here.
    // Every input is read live — the closure's own `canSave` would be stale too
    // (an edit typed while a save was in flight, then ×, would never be sent).
    // Its PUT is built against the closure's `saved`, which can only be older:
    // a superset of the changes, never a lost one.
    liveSaveRef.current = () => {
        const st = useRequirementFilerStore.getState();
        if (st.draftKey !== draftKey || st.draft !== draft || savingRef.current === draftKey || deletingRef.current) return;
        if (st.savedId == null || st.orphaned || draftProblem(st.draft)) return;
        if (draftDirty(st.draft, st.savedId, st.saved) && draft !== failedDraftRef.current) save(true);
    };
    // DELETE this requirement (req #4152) — the same DELETE the requirement page
    // sends. Its epic seat CASCADEs (req #3706), so every plan read re-reads. A
    // refusal (a locked epic, plan or initiative: 423) is said in the editor's
    // error line and the requirement stays.
    const deleteRequirement = async () => {
        if (savedId == null || deletingRef.current || saving === draftKey) return;
        const key = draftKey;
        const id = savedId;
        deletingRef.current = true;
        setDeleting(true);
        setFailure(null);
        try {
            const res = await call_rest_api(`${darwinUri}/requirements`, 'DELETE', { id }, idToken);
            if (res?.httpStatus?.httpStatus !== 200) {
                setFailure({ key, text: errorText(res, 'Requirement not deleted') });
                return;
            }
            queryClient.invalidateQueries({ queryKey: requirementKeys.all(user) });
            queryClient.invalidateQueries({ queryKey: pipelineEpicRequirementKeys.all(user) });
            queryClient.invalidateQueries({ queryKey: ['pipeline_compose'] });
            setConfirmDelete(false);
            discardDeleted(id);
        } catch (e) {
            const locked = e?.httpStatus?.httpStatus === 423 ? e.httpStatus.httpMessage : null;
            setFailure({ key, text: locked || errorText(e, 'Requirement not deleted') });
        } finally {
            deletingRef.current = false;
            setDeleting(false);
        }
    };
    // Retry: the live save the last failure stopped.
    const retry = () => { failedDraftRef.current = null; save(); };

    const onKeyDown = (e) => {
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); save(); }
        // Esc dismisses the editor like its ×: the draft stays in the store, so
        // nothing typed is lost (req #4171). A press that already did something
        // (closed a select's list) or is mid-composition is not ours; a pending
        // delete confirmation is what Esc backs out of first.
        if (e.key === 'Escape' && !e.defaultPrevented && !e.nativeEvent?.isComposing
            && e.nativeEvent?.keyCode !== 229) {
            e.preventDefault();
            if (confirmDelete) { if (!deleting) setConfirmDelete(false); return; }
            setEditorShow(false);
        }
    };

    const seatIssue = savedId == null ? seatProblem(draft.seat, darwinUri) : null;
    const code = specCode(draft);
    const spec = machineLabel ? `${code} · ${machineLabel}` : code;

    return (
        <AnchoredPanel dock={dock} onDockChange={setEditorDock}
                       open={open} onToggle={toggleEditorOpen}
                       name="Requirement Editor" testid="requirement-editor"
                       rackId={EDITOR_RACK_ID} zIndex={EDITOR_Z}
                       limits={LIMITS} fontPx={ACTION_POPUP_FONT_PX} colors={ACTION_POPUP_COLORS}
                       sx={ACTION_POPUP_SX}
                       actions={<ActionPopupClose onClick={() => setEditorShow(false)}
                                                  label="Close the requirement editor"
                                                  testid="requirement-editor-close" />}>
            {({ shapedWidth }) => (
                <Box component="form" data-testid="requirement-editor-form"
                     onSubmit={(e) => { e.preventDefault(); save(); }} onKeyDown={onKeyDown}
                     sx={{ width: shapedWidth == null ? `${FORM_EM}em` : '100%', maxWidth: '100%',
                            // Room around the fields (req #3830: "it looks cramped").
                            boxSizing: 'border-box', px: `${FORM_PAD_EM}em`, py: '0.9em',
                            display: 'flex', flexDirection: 'column', gap: '0.55em' }}>
                    {/* `<id> - <title>`, the whole width. */}
                    <Box sx={{ display: 'flex', alignItems: 'baseline', gap: '0.45em', minWidth: 0 }}>
                        <Box data-testid="requirement-editor-identity"
                             sx={{ flexShrink: 0, fontSize: '1.15em', fontWeight: 600, whiteSpace: 'nowrap' }}>
                            {savedId != null ? (
                                <Box {...(filesElsewhere
                                        // Filed into production from a dev build (req #3888): its page is on darwin.one.
                                        ? { component: 'a', href: prodRequirementUrl(savedId), target: '_blank', rel: 'noopener noreferrer' }
                                        : { component: Link, to: `/swarm/requirement/${savedId}` })}
                                     data-testid="requirement-editor-id-link"
                                     sx={{ color: P.req, textDecoration: 'none', '&:hover': { textDecoration: 'underline' } }}>
                                    {savedId}
                                </Box>
                            ) : (
                                <Box component="span" sx={{ color: P.text }}>New</Box>
                            )}
                            <Box component="span" sx={{ color: P.text }}> -</Box>
                        </Box>
                        <Box component="input" type="text" value={draft.title} ref={titleRef}
                             placeholder="Title" aria-label="Title"
                             onChange={(e) => setFields({ title: e.target.value })}
                             data-testid="requirement-editor-field-title"
                             sx={{ flex: 1, minWidth: 0, fontFamily: ACTION_POPUP_MONO, fontSize: '1.15em',
                                    fontWeight: 600, color: P.text, background: 'transparent', border: 'none',
                                    borderBottom: `1px solid ${P.accent}`, outline: 'none', px: 0, py: 0,
                                    '&::placeholder': { color: P.dim } }} />
                    </Box>

                    {/* Project, then Category, each on its own line (user, 2026-10-23). */}
                    <Box sx={{ display: 'flex', alignItems: 'baseline', gap: '0.25em', minWidth: 0, fontWeight: 700,
                               color: projectId == null ? INVALID : P.dim }}>
                        <Box component="span">Project -</Box>
                        <Select value={projectId} testid="project" label="Project" sx={TEXT_SELECT_SX}
                                placeholder="Must select" options={projectOpts}
                                onChange={(v) => setFields({ projectId: toInt(v), category_fk: null })} />
                        {/* The spec-code button: here, not on the title's line, so the title has it all. */}
                        <Box component="button" type="button" onClick={() => setSettingsOpen(o => !o)}
                             aria-expanded={settingsOpen ? 'true' : 'false'} aria-controls="requirement-editor-settings"
                             title={`Status · Autonomy · Model · Effort${machineLabel ? ' · Machine' : ''} — click to edit`}
                             data-testid="requirement-editor-spec"
                             sx={{ ml: 'auto', flexShrink: 0, alignSelf: 'center', px: '0.6em', py: 0,
                                    border: `1px solid ${settingsOpen ? P.accent : P.line}`, borderRadius: '999px',
                                    background: 'transparent', color: P.text, fontFamily: ACTION_POPUP_MONO,
                                    fontSize: '0.9em', fontWeight: 700, letterSpacing: '0.05em', cursor: 'pointer',
                                    whiteSpace: 'nowrap', '&:hover': { borderColor: P.accent, color: P.accent } }}>
                            {spec}
                        </Box>
                    </Box>
                    <Box sx={{ display: 'flex', alignItems: 'baseline', gap: '0.25em', minWidth: 0, fontWeight: 700,
                               color: draft.category_fk == null ? INVALID : P.dim }}>
                        {categoryColor && (
                            <Box component="span" data-testid="requirement-editor-category-color"
                                 sx={{ width: '0.35em', alignSelf: 'stretch', minHeight: '1em', mr: '0.3em',
                                        bgcolor: categoryColor, borderRadius: '0.2em', flexShrink: 0 }} />
                        )}
                        <Box component="span">Category -</Box>
                        <Select value={draft.category_fk} testid="category" label="Category" sx={TEXT_SELECT_SX}
                                placeholder={projectId == null ? 'choose a project first'
                                    : (Array.isArray(categories) ? 'Must select' : 'Loading…')}
                                options={categoryOpts} disabled={projectId == null}
                                onChange={(v) => setFields({ category_fk: toInt(v) })} />
                    </Box>

                    {/* The plan epic the filer's + was aimed at (req #3854): Create seats it
                        there; × before Create files it in no epic. */}
                    {draft.seat && (
                        <Box data-testid="requirement-editor-epic" data-epic-id={draft.seat.epicId}
                             sx={{ display: 'flex', alignItems: 'baseline', gap: '0.25em', minWidth: 0,
                                    fontWeight: 700, color: P.dim }}>
                            <Box component="span" sx={{ flexShrink: 0 }}>Epic -</Box>
                            <Box component="span" title={draft.seat.title}
                                 sx={{ color: seatIssue ? INVALID : P.text, minWidth: 0, overflow: 'hidden',
                                        textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {draft.seat.title}
                            </Box>
                            {seatIssue && (
                                <Box component="span" data-testid="requirement-editor-epic-problem"
                                     sx={{ color: INVALID, fontWeight: 400, fontSize: '0.9em', flexShrink: 1 }}>
                                    {seatIssue}
                                </Box>
                            )}
                            {draft.seat.failed && (
                                <Box component="span" data-testid="requirement-editor-epic-failed"
                                     sx={{ color: INVALID, fontWeight: 400, fontSize: '0.9em' }}>
                                    not placed — drag it in from the plan's box
                                </Box>
                            )}
                            {draft.seat.placed && (
                                <Box component="span" data-testid="requirement-editor-epic-placed"
                                     sx={{ color: P.dim, fontWeight: 400, fontSize: '0.9em' }}>
                                    placed
                                </Box>
                            )}
                            {savedId == null && (
                                <Box component="button" type="button" onClick={clearSeat}
                                     aria-label="File it in no epic" title="File it in no epic"
                                     data-testid="requirement-editor-epic-clear"
                                     sx={{ ml: 'auto', flexShrink: 0, alignSelf: 'center', p: 0, px: '0.3em',
                                            border: 'none', background: 'transparent', color: P.dim,
                                            fontFamily: ACTION_POPUP_MONO, fontSize: '1em', cursor: 'pointer',
                                            '&:hover': { color: P.accent } }}>
                                    ×
                                </Box>
                            )}
                        </Box>
                    )}

                    {/* The settings, slid open from the spec-code button. */}
                    <Box id="requirement-editor-settings" data-testid="requirement-editor-settings"
                         data-open={settingsOpen ? '1' : '0'} aria-hidden={settingsOpen ? undefined : 'true'}
                         inert={settingsOpen ? undefined : ''} sx={slideSx(settingsOpen)}>
                        <Box sx={{ overflow: 'hidden', minHeight: 0 }}>
                            {/* Five rows — Status, Autonomy, Model, Effort, Machine —
                                spread out (req #3830: "more white space"). */}
                            <Box sx={{ display: 'flex', flexDirection: 'column', gap: `${SETTINGS_GAP_EM}em`,
                                       pt: '0.4em', pb: '0.5em' }}>
                                <ChipRow label="Status" testid="status" value={draft.requirement_status}
                                         options={STATUS_CHIPS} onChange={(v) => setFields({ requirement_status: v })} />
                                <ChipRow label="Autonomy" testid="autonomy" value={draft.coordination_type}
                                         options={AUTONOMY_CHIPS} onChange={(v) => setFields({ coordination_type: v })} />
                                <Fieldset legend="AI Settings" testid="requirement-editor-ai-settings">
                                    <ChipRow label="Model" testid="model" value={draft.ai_model} labelEm={4.5}
                                             options={MODEL_CHIPS} onChange={(v) => setFields({ ai_model: v })} />
                                    <ChipRow label="Effort" testid="effort" value={draft.effort} labelEm={4.5}
                                             options={EFFORT_CHIPS} onChange={(v) => setFields({ effort: v })} />
                                </Fieldset>
                                <ChipRow label="Machine" testid="machine" value={draft.machine_fk}
                                         options={[{ value: null, label: 'Any' }, ...machineOpts].map(o => ({ ...o, ...MACHINE_CHIP }))}
                                         onChange={(v) => setFields({ machine_fk: v })} />
                            </Box>
                        </Box>
                    </Box>

                    {/* Open, it grows with what is typed until the panel meets the bottom of
                        the screen, then scrolls; its toggle folds it to two lines (req #3982). */}
                    <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: '0.3em', minWidth: 0 }}>
                        <Box component="textarea" rows={2} value={draft.description ?? ''} ref={setDescEl}
                             placeholder="Description" aria-label="Description"
                             onChange={(e) => setFields({ description: e.target.value })}
                             data-testid="requirement-editor-field-description"
                             data-collapsed={descriptionCollapsed ? '1' : '0'}
                             sx={{ ...FIELD_SX, flex: 1, minWidth: 0, py: '0.2em', overflowY: 'auto',
                                    '&::placeholder': { color: P.dim },
                                    // No resize grip: its inline height would beat both the
                                    // fold and the grow-to-the-edge sizing.
                                    resize: 'none',
                                    ...(descriptionCollapsed
                                        ? { fieldSizing: 'fixed', height: DESCRIPTION_TWO_LINES }
                                        : { fieldSizing: 'content',
                                            minHeight: descMin != null
                                                ? `max(${DESCRIPTION_TWO_LINES}, ${descMin}px)` : DESCRIPTION_TWO_LINES,
                                            maxHeight: descCap != null ? `${descCap}px` : DESCRIPTION_FALLBACK_MAX }) }} />
                        <Box component="button" type="button" onClick={toggleDescriptionCollapsed}
                             aria-expanded={descriptionCollapsed ? 'false' : 'true'}
                             aria-label={descriptionCollapsed ? 'Expand the description' : 'Collapse the description'}
                             title={descriptionCollapsed ? 'Expand the description' : 'Collapse the description to two lines'}
                             data-testid="requirement-editor-description-toggle"
                             sx={{ display: 'inline-flex', flexShrink: 0, p: '0.15em', mt: '0.1em',
                                    border: `1px solid ${P.line}`, borderRadius: '0.4em', background: 'transparent',
                                    color: P.dim, cursor: 'pointer',
                                    '&:hover': { color: P.accent, borderColor: P.accent } }}>
                            {descriptionCollapsed
                                ? <UnfoldMoreIcon sx={{ fontSize: '1.2em' }} />
                                : <UnfoldLessIcon sx={{ fontSize: '1.2em' }} />}
                        </Box>
                    </Box>

                    {draft.notice && (
                        <Box data-testid="requirement-editor-notice" sx={{ color: P.dim, overflowWrap: 'anywhere' }}>
                            {draft.notice}
                        </Box>
                    )}
                    {error && (
                        <Box role="alert" data-testid="requirement-editor-error"
                             sx={{ color: INVALID, overflowWrap: 'anywhere' }}>
                            {error}
                        </Box>
                    )}
                    {problem && savedId != null && (
                        <Box component="span" data-testid="requirement-editor-problem"
                             sx={{ color: INVALID, fontSize: '0.9em' }}>
                            {problem} — not saving
                        </Box>
                    )}
                    {/* CREATE (the first save) — or RETRY for a live save that failed — and the
                        debug capture's line, on one row; the capture's details slide open below.
                        A filed requirement carries DELETE here too (req #4152). */}
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: '0.5em', flexWrap: 'wrap' }}>
                        {savedId == null ? (
                            <Box component="button" type="submit" disabled={!canSave}
                                 title={orphaned ? 'Start a new requirement' : (problem || 'Create it (⌘↵)')}
                                 data-testid="requirement-editor-save"
                                 sx={{ px: '0.9em', py: '0.1em', borderRadius: '999px',
                                        border: `1px solid ${canSave ? CREATE_GREEN : P.line}`,
                                        background: canSave ? CREATE_GREEN : 'transparent',
                                        color: canSave ? '#fff' : P.dim, fontFamily: ACTION_POPUP_MONO,
                                        fontSize: '1em', fontWeight: 700, cursor: canSave ? 'pointer' : 'default' }}>
                                Create
                            </Box>
                        ) : (error && canSave) ? (
                            <Box component="button" type="button" onClick={retry}
                                 data-testid="requirement-editor-retry" sx={{ ...TEXT_BUTTON_SX, py: '0.1em' }}>
                                Retry
                            </Box>
                        ) : null}
                        {savedId != null && (
                            confirmDelete ? (
                                <Box component="span" data-testid="requirement-editor-delete-confirm"
                                     sx={{ display: 'inline-flex', alignItems: 'center', gap: '0.5em' }}>
                                    <Box component="span" sx={{ color: INVALID }}>Delete {savedId}?</Box>
                                    <Box component="button" type="button" onClick={deleteRequirement}
                                         disabled={deleting || saving === draftKey}
                                         data-testid="requirement-editor-delete-yes"
                                         sx={{ ...TEXT_BUTTON_SX, py: '0.1em', color: INVALID, borderColor: INVALID }}>
                                        {deleting ? 'Deleting…' : 'Yes, delete'}
                                    </Box>
                                    <Box component="button" type="button" onClick={() => setConfirmDelete(false)}
                                         disabled={deleting}
                                         data-testid="requirement-editor-delete-cancel"
                                         sx={{ ...TEXT_BUTTON_SX, py: '0.1em' }}>
                                        Cancel
                                    </Box>
                                </Box>
                            ) : (
                                <Box component="button" type="button" onClick={() => setConfirmDelete(true)}
                                     disabled={saving === draftKey}
                                     title="Delete this requirement"
                                     data-testid="requirement-editor-delete"
                                     sx={{ ...TEXT_BUTTON_SX, py: '0.1em', display: 'inline-flex', alignItems: 'center',
                                            gap: '0.3em', '&:hover': { color: INVALID, borderColor: INVALID } }}>
                                    <DeleteOutlineIcon sx={{ fontSize: '1.2em' }} />
                                    Delete
                                </Box>
                            )
                        )}
                        {hasCapture && (
                            <CaptureLine capture={capture} dropped={captureSentDropped ?? captureDropped}
                                         canDropAll={captureStage === 'ready' && captureSentDropped == null
                                             && saving !== draftKey && !keepsNothing(capture, captureDropped)}
                                         onDropAll={dropAllCaptureCategories}
                                         expanded={captureOpen} onExpand={() => setCaptureOpen(o => !o)} />
                        )}
                    </Box>
                    {hasCapture && (
                        <CaptureDetails capture={capture} dropped={captureSentDropped ?? captureDropped}
                                        stage={captureStage} savedId={savedId} expanded={captureOpen}
                                        locked={saving === draftKey || captureSentDropped != null}
                                        onToggle={toggleCaptureCategory}
                                        onRetry={savedId != null && ['ready', 'posted'].includes(captureStage)
                                            && saving !== draftKey ? retryCapture : null} />
                    )}
                </Box>
            )}
        </AnchoredPanel>
    );
}
