// RequirementFiler.jsx — the Requirement Filer (req #3811): an Action Popup on
// every page that files a requirement without leaving it. Its head says
// REQUIREMENT and its body the one word "Create"; a click anywhere in the body
// opens the popup requirement editor (RequirementEditorPopup.jsx) on a fresh
// draft that starts with the last requirement's settings (user ruling
// 2026-10-23, req #3815 — replacing #3812's DEFAULTS button).
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
// (actionPopupChrome.js): the ▾ head and the REQUIREMENT FILER title, × at the
// far right. RACKABLE (`rackId`) — drag its head onto the Darwin navbar, or AI
// Architecture's toolbar, and it locks in below the nav buttons like every
// other Action Popup; drag it off to float it again.
//
// Opened from the navbar's filer control (NavBarSidebar); whether it is shown,
// folded and where it floats are remembered per browser
// (useRequirementFilerStore), as the Dev Servers dashboard remembers its own.
// Desktop only, signed in only — the navbar control is the desktop sidebar's.
//
// ADDRESSABLE: any page's `?filer=1` opens the filer and `?filer=new` also opens
// a new requirement from that page, as a click does (`?filer=bug`, the
// two-button era's link, does the same) — a link (or a dev server) can land on it.

import { useContext, useEffect } from 'react';
import { useLocation } from 'react-router-dom';

import Box from '@mui/material/Box';
import useMediaQuery from '@mui/material/useMediaQuery';

import AnchoredPanel from '../Components/AnchoredPanel/AnchoredPanel';
import { ActionPopupClose } from '../Components/AnchoredPanel/ActionPopupHead';
import {
    ACTION_POPUP_COLORS, ACTION_POPUP_FONT_PX, ACTION_POPUP_HEAD_PX, ACTION_POPUP_MONO, ACTION_POPUP_SX,
} from '../Components/AnchoredPanel/actionPopupChrome';
import { validDock } from '../Components/AnchoredPanel/anchoredPanelGeometry';
import AppContext from '../Context/AppContext';
import AuthContext from '../Context/AuthContext';
import { SIDEBAR_WIDTH } from '../NavBar/navConfig';
import { useRequirementFilerStore } from '../stores/useRequirementFilerStore';
import { PLAN_VIZ_PALETTE as P } from '../SwarmView/pipelines/pipelinePlanLayout';
import ThemeContext from '../Theme/ThemeContext';
import { buildDebugCapture } from './debugBundle';
import { filedFromNow } from './filedFromContext';
import { draftDirty } from './requirementFilerModel';

/** The debug capture's accent — the editor's invalid-field red. */
export const BUG_COLOR = '#ff8a80';
/** Its id in the panel rack. */
export const FILER_RACK_ID = 'requirement-filer';
const MIN_W = 120;
const MIN_H = 64;
const LIMITS = { minW: MIN_W, minH: MIN_H, autoMaxW: 320, headPx: ACTION_POPUP_HEAD_PX };
/** Floating home: top-left, just clear of the full-width navbar. */
export const FILER_HOME = Object.freeze({ h: 'l', x: SIDEBAR_WIDTH + 16, v: 't', y: 16, w: null, ht: null });

/** Starts a new requirement in the editor — asking first when the one in it
 *  has changes not yet sent (an orphaned draft — committed, id unknown — has
 *  none it can send). `withCapture` — it awaits a debug capture (req #3815).
 *  Returns the new draft's key, or null when the reader kept the one in the editor. */
export function startNewRequirement(withCapture = false) {
    const { editorShow, draft, savedId, saved, orphaned, startNew, captureStage } = useRequirementFilerStore.getState();
    const touched = !orphaned && draft && (savedId != null || (draft.title ?? '').trim() !== ''
        || (draft.description ?? '').trim() !== '');
    // A filed requirement whose capture is not saved (or not yet linked from its
    // description): a new one would drop it — said in the one question asked.
    const captureUnsent = savedId != null && ['capturing', 'ready', 'posted'].includes(captureStage);
    const changes = touched && draftDirty(draft, savedId, saved);
    const lost = [changes && 'unsaved changes',
        captureUnsent && (captureStage === 'posted' ? 'the link to its debug capture' : 'its debug capture')].filter(Boolean);
    if (editorShow && lost.length
        && !window.confirm(`Discard ${lost.join(' and ')} in the requirement editor?`)) return null;
    return startNew(withCapture);
}

/** FILE: where it was filed from and the debug capture, both snapshotted NOW —
 *  before the confirm or the editor can change the page — the capture landing
 *  on the draft when its ≤ 250 ms wait for failure bodies is over. */
export function fileRequirementNow(filedFrom, profile) {
    const pending = buildDebugCapture({ profile, filedFrom });
    const key = startNewRequirement(true);
    // Kept the draft in the editor: this capture is for no one — settle it quietly.
    if (key == null) { pending.catch(() => {}); return null; }
    const { setCapture } = useRequirementFilerStore.getState();
    pending.then((capture) => setCapture(key, capture), () => setCapture(key, null));
    return key;
}

export default function RequirementFiler() {
    const { profile } = useContext(AuthContext);
    const { database } = useContext(AppContext);
    const theme = useContext(ThemeContext);
    const location = useLocation();
    const isDesktop = useMediaQuery('(min-width:900px)');
    const show = useRequirementFilerStore(s => s.show);
    const open = useRequirementFilerStore(s => s.open);
    const storedDock = useRequirementFilerStore(s => s.dock);
    const { setShow, toggleOpen, setDock } = useRequirementFilerStore.getState();
    const dock = validDock(storedDock, MIN_W, MIN_H) || FILER_HOME;
    const filerParam = new URLSearchParams(location.search).get('filer');
    const signedIn = !!profile?.userName;
    // Where a requirement started now is filed from — read at the press, so it
    // is the page as it is then (req #3813).
    const filedFrom = () => filedFromNow({
        location, profile, database, theme, popupId: FILER_RACK_ID,
        popupStore: { open: useRequirementFilerStore.getState().open, dock },
    });
    const fileRequirement = () => fileRequirementNow(filedFrom(), profile);
    useEffect(() => {
        if (!filerParam || !signedIn) return;
        useRequirementFilerStore.setState({ show: true, open: true });
        if (filerParam === 'new' || filerParam === 'bug') fileRequirementNow(filedFrom(), profile);
        // Once per landing on the parameter, as the page then is.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [filerParam, signedIn]);

    if (!show || !isDesktop || !profile?.userName) return null;

    // The whole body is the control (user ruling 2026-10-23): the word "Create",
    // and a click anywhere but the head starts a new requirement.
    const onKey = (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileRequirement(); }
    };

    return (
        <AnchoredPanel dock={dock} onDockChange={setDock}
                       open={open} onToggle={toggleOpen}
                       name="Requirement" testid="requirement-filer"
                       rackId={FILER_RACK_ID}
                       limits={LIMITS} fontPx={ACTION_POPUP_FONT_PX} colors={ACTION_POPUP_COLORS}
                       sx={ACTION_POPUP_SX}
                       actions={<ActionPopupClose onClick={() => setShow(false)}
                                                  label="Close the Requirement Filer"
                                                  testid="requirement-filer-close" />}>
            {() => (
                <Box role="button" tabIndex={0} onClick={fileRequirement} onKeyDown={onKey}
                     aria-label="Create a requirement" data-testid="requirement-filer-new"
                     title="Create a requirement — it starts with the last one's settings and records this page and a debug capture"
                     sx={{ px: '0.7em', py: '0.5em', cursor: 'pointer', color: P.text,
                            fontFamily: ACTION_POPUP_MONO, fontSize: '1em', whiteSpace: 'nowrap',
                            outline: 'none', '&:hover, &:focus-visible': { color: P.accent } }}>
                    Create
                </Box>
            )}
        </AnchoredPanel>
    );
}
