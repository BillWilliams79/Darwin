// RequirementFiler.jsx — the Requirement Filer (req #3811): an Action Popup on
// every page that files a requirement without leaving it. Its head says
// REQUIREMENT, and the + after it — there open or folded — opens the popup
// requirement editor (RequirementEditorPopup.jsx) on a fresh draft that starts
// with the last requirement's settings (user ruling 2026-10-23, req #3815 —
// replacing #3812's DEFAULTS button). Its body lists the requirements it has
// filed, newest first; a click brings one back into the editor, read fresh
// from its row (user ruling 2026-10-23, req #3830 — the + replaced the body's
// "Create"). Create in the editor closes it at the press (req #3860): the
// requirement joins this list as it is filed. Below the list, CLEAR empties it
// (req #3975) — the list only, never a requirement; drawn while there is one.
//
// CREATE RECORDS EVERYTHING, AT THE PRESS — before the editor opens, so the
// editor is never the subject: where it was filed from (req #3813 — URL, view
// options, app state, the popup's own position; filedFromContext.js) and a
// full-spectrum debug capture (req #3815 — console, errors, network trace,
// query/store state, build and environment; debugBundle.js, from the buffers
// utils/debugCapture.js installs at boot). The editor shows the capture's size
// per category and lets any category be dropped before the first save.
//
// ONE BUTTON — the user's ruling, 2026-10-23, absorbing #3818: Requirement and
// Bug were two buttons "so I can test the two behaviors" (req #3814), then
// combined: "can filed from be part of debug capture? and then we just have
// one button?".
//
// An AnchoredPanel (Components/AnchoredPanel, pattern doc
// memory/anchored-collapse-pattern.md) in the Action Popups' own chrome
// (actionPopupChrome.js): the ▾ head and the REQUIREMENT title, + and × at the
// far right. It has no badge slot: the title sits against the ▾, and folded
// the + follows the title — `▸ REQUIREMENT +` — so the filer can live
// folded in the rack (user ruling 2026-10-23, req #3830); folded, there is no ×
// (req #3893). In a minimized bar
// (the icon-only navbar, the folded topology toolbar) it is ONE + in its purple
// box, and a click on it creates a new requirement as the + does (req #3886). RACKABLE (`rackId`) — drag its head onto the Darwin navbar, or AI
// Architecture's toolbar, and it locks in below the nav buttons like every
// other Action Popup; drag it off to float it again. LOCKABLE INTO THE TITLE
// BAR (req #3857) — drop its head on the page's title bar and it stays there,
// where it was dropped, in the bar's free space only: it never covers the bar's
// own buttons and text, nor moves them (AnchoredPanel, titleBarLock.js).
//
// Opened from the navbar's filer control (NavBarSidebar); whether it is shown,
// folded and where it floats are remembered per browser
// (useRequirementFilerStore), as the Dev Servers dashboard remembers its own.
// Desktop only, signed in only — the navbar control is the desktop sidebar's.
//
// PRODUCTION FROM EVERY BUILD (req #3888): App.jsx mounts the filer and its
// editor inside FilerDataScope (filerScope.jsx), which points their `darwinUri`
// at production `darwin` on a dev server — the requirement is real, filed with
// the reader's own credentials, and its id opens on darwin.one.
//
// AIMED AT AN EPIC (req #3854): on a plan visualizer, the + hovered over an
// epic card outlines that epic, and a click files the new requirement into it —
// the editor names it on its Epic line and Create seats it there
// (filerEpicAim.js).
//
// AIMED AT A CATEGORY (req #4026): on the requirements page's Cards view, the +
// of a floating filer — not racked, not locked into the title bar — hovered over
// a category card outlines that card, and a click files the new requirement in
// that category (filerCategoryAim.js). Anywhere else the + files as it always has.
//
// ADDRESSABLE: any page's `?filer=` (`1`, and the older `new`/`bug` links) opens
// the filer — a link (or a dev server) can land on it. Only the filer: the
// editor opens on a press of the + and never on its own (req #3974), so a dev
// server landing on the filer never starts a requirement nobody asked for.

import { useContext, useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';

import Box from '@mui/material/Box';
import useMediaQuery from '@mui/material/useMediaQuery';
import AddIcon from '@mui/icons-material/Add';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';

import AnchoredPanel from '../Components/AnchoredPanel/AnchoredPanel';
import { ActionPopupAdd, ActionPopupClose } from '../Components/AnchoredPanel/ActionPopupHead';
import {
    ACTION_POPUP_COLORS, ACTION_POPUP_FONT_PX, ACTION_POPUP_HEAD_PX, ACTION_POPUP_MONO, ACTION_POPUP_SX,
} from '../Components/AnchoredPanel/actionPopupChrome';
import { validDock } from '../Components/AnchoredPanel/anchoredPanelGeometry';
import AppContext from '../Context/AppContext';
import AuthContext from '../Context/AuthContext';
import { SIDEBAR_WIDTH } from '../NavBar/navConfig';
import call_rest_api from '../RestApi/RestApi';
import { useRequirementFilerStore } from '../stores/useRequirementFilerStore';
import { PLAN_VIZ_PALETTE as P } from '../SwarmView/pipelines/pipelinePlanLayout';
import ThemeContext from '../Theme/ThemeContext';
import { buildDebugCapture } from './debugBundle';
import { categoryAimAt, highlightCategoryAim, placeProblem } from './filerCategoryAim';
import { epicAimAt, highlightEpicAim, seatProblem } from './filerEpicAim';
import { useFilerFilesElsewhere } from './filerScope';
import { filedFromNow } from './filedFromContext';
import { REOPEN_FIELDS, draftDirty } from './requirementFilerModel';

/** The debug capture's accent — the editor's invalid-field red. */
export const BUG_COLOR = '#ff8a80';
/** Its id in the panel rack. */
export const FILER_RACK_ID = 'requirement-filer';
const MIN_W = 120;
const MIN_H = 64;
const LIMITS = { minW: MIN_W, minH: MIN_H, autoMaxW: 320, headPx: ACTION_POPUP_HEAD_PX };
/** Floating home: top-left, just clear of the full-width navbar. */
export const FILER_HOME = Object.freeze({ h: 'l', x: SIDEBAR_WIDTH + 16, v: 't', y: 16, w: null, ht: null });

// What held focus as a press on the + began: the click moves focus to the
// filer before it files, and the field being typed in is never copied (req #3829).
// Timed: a press that never became a click (dragged off) is forgotten.
let focusAtPress = null;
const PRESS_MS = 2000;
// The plan epic beneath the + as that press began (req #3854, filerEpicAim.js),
// and the category card (req #4026, filerCategoryAim.js).
let aimAtPress = null;

/** Whether the requirement in the editor stays there: asked when it has
 *  changes not yet sent (an orphaned draft — committed, id unknown — has none
 *  it can send) or a debug capture not yet saved, before another replaces it.
 *  A draft a reload brought back hidden (`restoredDraft`, req #3974) is asked
 *  about as if shown, and kept, this press shows it. */
function keepsEditorDraft() {
    const { editorShow, restoredDraft, draft, savedId, saved, orphaned, captureStage } = useRequirementFilerStore.getState();
    const touched = !orphaned && draft && (savedId != null || (draft.title ?? '').trim() !== ''
        || (draft.description ?? '').trim() !== '');
    // A filed requirement whose capture is not saved (or not yet linked from its
    // description): a new one would drop it — said in the one question asked.
    const captureUnsent = savedId != null && ['capturing', 'ready', 'posted'].includes(captureStage);
    const changes = touched && draftDirty(draft, savedId, saved);
    const lost = [changes && 'unsaved changes',
        captureUnsent && (captureStage === 'posted' ? 'the link to its debug capture' : 'its debug capture')].filter(Boolean);
    if (!((editorShow || restoredDraft) && lost.length)) return false;
    if (window.confirm(`Discard ${lost.join(' and ')} in the requirement editor?`)) return false;
    if (!editorShow) useRequirementFilerStore.getState().setEditorShow(true);
    return true;
}

/** How long a new or reopened requirement waits for a create still being
 *  written (req #3860) — its POST, capture row and description link take a
 *  second or two; the bound is only a backstop. */
export const CREATE_WAIT_MS = 10000;

/** Resolves true once no create is being written with the editor closed (the
 *  store's `creating`, req #3860), so the next draft never replaces one whose
 *  debug capture is still on its way. A create that fails has brought its draft
 *  back into the editor by then, and is asked about. Resolves false when one is
 *  still being written after CREATE_WAIT_MS: the caller brings that draft back
 *  into the editor instead of replacing it (keepCreating). */
export function createSettled(timeoutMs = CREATE_WAIT_MS) {
    if (useRequirementFilerStore.getState().creating == null) return Promise.resolve(true);
    return new Promise((resolve) => {
        const timer = setTimeout(() => { unsub(); resolve(useRequirementFilerStore.getState().creating == null); }, timeoutMs);
        const unsub = useRequirementFilerStore.subscribe((st) => {
            if (st.creating == null) { clearTimeout(timer); unsub(); resolve(true); }
        });
    });
}

/** A create slower than CREATE_WAIT_MS is never replaced unseen: the editor
 *  comes back on it, still saving, and the reader presses again once it lands. */
function keepCreating() {
    useRequirementFilerStore.getState().setEditorShow(true);
}

/** Starts a new requirement in the editor, unless the reader keeps the one in
 *  it (keepsEditorDraft). `withCapture` — it awaits a debug capture (req #3815).
 *  Returns the new draft's key, or null when the reader kept the one in the editor. */
export function startNewRequirement(withCapture = false, seat = null, place = null) {
    if (keepsEditorDraft()) return null;
    return useRequirementFilerStore.getState().startNew(withCapture, seat, place);
}

/** Brings filed requirement `id` back into the editor (req #3830), read fresh:
 *  its row, then its category's project. Resolves null when it is open there,
 *  'kept' when the reader kept the draft in the editor, 'gone' when its row no
 *  longer exists (it leaves the list), else a reason it could not be read. */
let reopenSeq = 0;
export async function reopenFiledRequirement(id, darwinUri, idToken) {
    if (!(await createSettled())) { keepCreating(); return 'kept'; }
    const { savedId, editorShow } = useRequirementFilerStore.getState();
    if (savedId === id) { if (!editorShow) useRequirementFilerStore.getState().setEditorShow(true); return null; }
    if (keepsEditorDraft()) return 'kept';
    // The reads take a moment: the newest click wins, and a draft started or
    // reopened meanwhile is never replaced by a slower read.
    const seq = ++reopenSeq;
    const { draftKey } = useRequirementFilerStore.getState();
    const superseded = () => seq !== reopenSeq || useRequirementFilerStore.getState().draftKey !== draftKey;
    const read = async (uri) => {
        try {
            const res = await call_rest_api(uri, 'GET', '', idToken);
            return res?.httpStatus?.httpStatus === 200 ? (res.data?.[0] ?? 'gone') : 'failed';
        } catch (e) {
            return e?.httpStatus?.httpStatus === 404 ? 'gone' : 'failed';
        }
    };
    const row = await read(`${darwinUri}/requirements?id=${id}&fields=${REOPEN_FIELDS.join(',')}`);
    if (row === 'gone') { useRequirementFilerStore.getState().forgetFiled(id); return 'gone'; }
    if (row === 'failed') return superseded() ? 'kept' : 'failed';
    // Its category's project, so the Project and Category selects show it — a
    // read that fails fails the reopen rather than open it half-shown.
    const category = row.category_fk == null ? null
        : await read(`${darwinUri}/categories?id=${row.category_fk}&fields=id,project_fk`);
    if (superseded()) return 'kept';
    if (row.category_fk != null && (typeof category !== 'object' || category?.project_fk == null)) return 'failed';
    useRequirementFilerStore.getState().openFiled(row, category?.project_fk ?? null);
    return null;
}

/** FILE: where it was filed from and the debug capture, both snapshotted NOW —
 *  before the confirm or the editor can change the page — the capture landing
 *  on the draft when its ≤ 250 ms wait for failure bodies is over. A create
 *  still being written (req #3860) is waited for first (createSettled), and
 *  then null is returned; otherwise the new draft's key, or null when the
 *  reader kept the draft in the editor. `seat` — the plan epic the + was
 *  aimed at (req #3854): Create seats the requirement in it. `place` — the
 *  category card it was aimed at (req #4026): the draft starts there. */
export function fileRequirementNow(filedFrom, profile, seat = null, place = null) {
    const pending = buildDebugCapture({ profile, filedFrom });
    const start = () => {
        const key = startNewRequirement(true, seat, place);
        // Kept the draft in the editor: this capture is for no one — settle it quietly.
        if (key == null) { pending.catch(() => {}); return null; }
        const { setCapture } = useRequirementFilerStore.getState();
        pending.then((capture) => setCapture(key, capture), () => setCapture(key, null));
        return key;
    };
    if (useRequirementFilerStore.getState().creating == null) return start();
    createSettled().then((settled) => {
        if (settled) start();
        else { pending.catch(() => {}); keepCreating(); }
    });
    return null;
}

export default function RequirementFiler() {
    const { profile, idToken } = useContext(AuthContext);
    const { database, darwinUri } = useContext(AppContext);
    const filesElsewhere = useFilerFilesElsewhere();
    const theme = useContext(ThemeContext);
    const location = useLocation();
    const isDesktop = useMediaQuery('(min-width:900px)');
    const show = useRequirementFilerStore(s => s.show);
    const open = useRequirementFilerStore(s => s.open);
    const storedDock = useRequirementFilerStore(s => s.dock);
    const titleLock = useRequirementFilerStore(s => s.titleLock);
    const filed = useRequirementFilerStore(s => s.filed);
    const editingId = useRequirementFilerStore(s => (s.editorShow ? s.savedId : null));
    // Why the last pick could not be opened — this session's, cleared by the next.
    const [reopenNote, setReopenNote] = useState(null);
    // Bumped by Clear (req #3975): a pick still being read when the list was
    // cleared says nothing about a list that no longer holds it.
    const clears = useRef(0);
    const { setShow, toggleOpen, setDock, setTitleLock, clearFiled } = useRequirementFilerStore.getState();
    const dock = validDock(storedDock, MIN_W, MIN_H) || FILER_HOME;
    const filerParam = new URLSearchParams(location.search).get('filer');
    const signedIn = !!profile?.userName;
    // Where a requirement started now is filed from — read at the press, so it
    // is the page as it is then (req #3813).
    const filedFrom = () => {
        const typingIn = focusAtPress && performance.now() - focusAtPress.t < PRESS_MS ? focusAtPress.el : null;
        focusAtPress = null;
        return filedFromNow({
            location, profile, database, theme, popupId: FILER_RACK_ID,
            popupStore: { open: useRequirementFilerStore.getState().open, dock,
                titleLock: useRequirementFilerStore.getState().titleLock }, typingIn,
        });
    };
    // The epic the + was aimed at as its press began (req #3854) — read at the
    // press, as where it was filed from is, and then outlined no longer.
    // A keyboard press (a click with no pointer, `detail` 0) aims at nothing: the
    // last pointer press may have been dragged off the + instead of clicked.
    const fileRequirement = (e) => {
        const pointed = e?.detail !== 0 && aimAtPress && performance.now() - aimAtPress.t < PRESS_MS;
        const seat = pointed ? aimAtPress.seat : null;
        const card = pointed ? aimAtPress.card : null;
        const place = card && !placeProblem(card, darwinUri)
            ? { projectId: card.projectId, categoryId: card.categoryId } : null;
        aimAtPress = null;
        highlightEpicAim(null);
        highlightCategoryAim(null);
        return fileRequirementNow(filedFrom(), profile, seat, place);
    };
    // What held focus as a press on the + began (req #3829) — the head's + and,
    // in a minimized bar, the icon's (req #3886) — and the plan epic beneath it.
    const notePress = (e) => {
        focusAtPress = { el: document.activeElement, t: performance.now() };
        aimAtPress = { seat: epicAimAt(e?.clientX, e?.clientY),
            card: categoryAimAt(e?.clientX, e?.clientY, e?.currentTarget), t: performance.now() };
    };
    // Hovering the + over a plan's epic outlines the epic it would file into.
    // An epic it could not be seated in (locked, or a plan read from another
    // database than the filer files into) is outlined as the refusal it is.
    // A category card beneath a floating filer's + is outlined the same way (req #4026).
    const aimHover = (e) => {
        const target = epicAimAt(e.clientX, e.clientY);
        highlightEpicAim(target && { ...target, ok: !seatProblem(target, darwinUri) });
        const card = categoryAimAt(e.clientX, e.clientY, e.currentTarget);
        highlightCategoryAim(card, !placeProblem(card, darwinUri));
    };
    const aimLeave = () => { highlightEpicAim(null); highlightCategoryAim(null); };
    useEffect(() => {
        if (!filerParam || !signedIn) return;
        useRequirementFilerStore.setState({ show: true, open: true });
    }, [filerParam, signedIn]);

    if (!show || !isDesktop || !profile?.userName) return null;

    const reopen = async (id) => {
        setReopenNote(null);
        const cleared = clears.current;
        const outcome = await reopenFiledRequirement(id, darwinUri, idToken);
        if (clears.current !== cleared) return;
        if (outcome === 'gone') setReopenNote(`#${id} no longer exists — taken off the list`);
        else if (outcome === 'failed') setReopenNote(`#${id} could not be read — try again`);
    };
    const onKey = (id) => (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); reopen(id); }
    };
    const row = { px: '0.7em', py: '0.25em', fontFamily: ACTION_POPUP_MONO, fontSize: '1em',
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' };

    return (
        <AnchoredPanel dock={dock} onDockChange={setDock}
                       open={open} onToggle={toggleOpen}
                       name="Requirement" testid="requirement-filer" badgeSlot={false}
                       rackId={FILER_RACK_ID}
                       rackIcon={AddIcon} onRackIcon={fileRequirement} onRackIconPress={notePress}
                       rackIconLabel={`Requirement — create a new one${filesElsewhere ? ' (filed in production Darwin)' : ''}`}
                       titleLock={titleLock} onTitleLockChange={setTitleLock}
                       limits={LIMITS} fontPx={ACTION_POPUP_FONT_PX} colors={ACTION_POPUP_COLORS}
                       sx={ACTION_POPUP_SX}
                       actions={<>
                           {/* The one way to create (req #3830): after the title folded, far right open. */}
                           <Box sx={{ mr: open ? '0.3em' : 0, display: 'flex' }}
                                onPointerDownCapture={notePress}
                                onPointerMove={aimHover}
                                onPointerLeave={aimLeave}>
                               <ActionPopupAdd onClick={fileRequirement}
                                               label={`Create a requirement — it starts with the last one's settings and records this page and a debug capture${filesElsewhere ? ' — filed in production Darwin' : ''}`}
                                               testid="requirement-filer-add" />
                           </Box>
                           <ActionPopupClose onClick={() => setShow(false)}
                                             label="Close the Requirement Filer"
                                             testid="requirement-filer-close" />
                       </>}>
            {() => (
                <Box data-testid="requirement-filer-list" sx={{ py: '0.2em' }}>
                    {reopenNote && (
                        <Box data-testid="requirement-filer-note" sx={{ ...row, color: BUG_COLOR, whiteSpace: 'normal' }}>
                            {reopenNote}
                        </Box>
                    )}
                    {filed.map(f => (
                        <Box key={f.id} role="button" tabIndex={0} data-testid={`requirement-filer-item-${f.id}`}
                             aria-current={f.id === editingId ? 'true' : undefined}
                             onClick={() => reopen(f.id)} onKeyDown={onKey(f.id)}
                             title={`Open #${f.id} in the requirement editor`}
                             sx={{ ...row, cursor: 'pointer', outline: 'none',
                                    color: f.id === editingId ? P.accent : P.text,
                                    '&:hover, &:focus-visible': { color: P.accent } }}>
                            <Box component="span" sx={{ color: P.dim }}>#{f.id}</Box> {f.title || '(untitled)'}
                        </Box>
                    ))}
                    {filed.length > 0 && (
                        <Box sx={{ display: 'flex', justifyContent: 'flex-end', px: '0.5em', pt: '0.2em' }}>
                            <Box component="button" type="button"
                                 onClick={() => { clears.current += 1; setReopenNote(null); clearFiled(); }}
                                 aria-label="Clear the list of filed requirements" title="Clear this list (the requirements stay)"
                                 data-testid="requirement-filer-clear"
                                 sx={{ display: 'inline-flex', alignItems: 'center', gap: '0.25em', px: '0.3em', py: '0.1em',
                                        border: 'none', borderRadius: '0.4em', background: 'transparent', color: P.dim,
                                        fontFamily: ACTION_POPUP_MONO, fontSize: '0.9em', cursor: 'pointer',
                                        '&:hover, &:focus-visible': { color: BUG_COLOR } }}>
                                <DeleteOutlineIcon sx={{ fontSize: '1.2em' }} />
                                Clear
                            </Box>
                        </Box>
                    )}
                </Box>
            )}
        </AnchoredPanel>
    );
}
