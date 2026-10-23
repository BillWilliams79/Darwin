// RequirementFiler.jsx — the Requirement Filer (req #3811): an Action Popup on
// every page that files a requirement without leaving it. Step one of the
// in-situ requirement filer: REQUIREMENT opens the popup requirement editor
// (RequirementEditorPopup.jsx) on a fresh draft started from the Defaults;
// DEFAULTS (req #3812) opens the same editor on those values.
//
// REQUIREMENT RECORDS WHERE IT WAS FILED (req #3813): the moment it is pressed
// — before the editor opens — it snapshots the page's URL, view options, app
// state and its own position (filedFromContext.js), and the draft's
// description opens on that block, editable before Save. Its `Surface:` line
// is the deep link /devops-devserver-start takes, so the AI that builds the
// requirement opens its dev server where it was filed from.
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
// ADDRESSABLE: any page's `?filer=1` opens the filer, `?filer=new` also starts
// a new requirement in the editor (recording that page, as the button does)
// and `?filer=defaults` opens the defaults —
// a link (or a dev server) can land on it.

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
import { RACK_NARROW_PX } from '../Components/AnchoredPanel/panelRack';
import AppContext from '../Context/AppContext';
import AuthContext from '../Context/AuthContext';
import { SIDEBAR_WIDTH } from '../NavBar/navConfig';
import { useRequirementFilerStore } from '../stores/useRequirementFilerStore';
import { PLAN_VIZ_PALETTE as P } from '../SwarmView/pipelines/pipelinePlanLayout';
import ThemeContext from '../Theme/ThemeContext';
import { filedFromBlockNow } from './filedFromContext';
import { draftDirty } from './requirementFilerModel';

/** Its id in the panel rack. */
export const FILER_RACK_ID = 'requirement-filer';
const MIN_W = 120;
const MIN_H = 64;
const LIMITS = { minW: MIN_W, minH: MIN_H, autoMaxW: 320, headPx: ACTION_POPUP_HEAD_PX };
/** Floating home: top-left, just clear of the full-width navbar. */
export const FILER_HOME = Object.freeze({ h: 'l', x: SIDEBAR_WIDTH + 16, v: 't', y: 16, w: null, ht: null });

/** Starts a new requirement in the editor — asking first when the one in it
 *  has changes Save has not sent (an orphaned draft — committed, id unknown —
 *  has none it can send; an untouched Filed-from block is not a change).
 *  `filedFrom` — the Filed-from block its description opens on (req #3813). */
export function startNewRequirement(filedFrom = null) {
    const { editorShow, draft, savedId, saved, orphaned, startNew } = useRequirementFilerStore.getState();
    const description = (draft?.description ?? '').trim();
    const touched = !orphaned && draft && (savedId != null || (draft.title ?? '').trim() !== ''
        || (description !== '' && description !== (draft.startDescription ?? '').trim()));
    if (editorShow && touched && draftDirty(draft, savedId, saved)
        && !window.confirm('Discard the unsaved changes in the requirement editor?')) return;
    startNew(filedFrom);
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
    const { setShow, toggleOpen, setDock, openDefaults } = useRequirementFilerStore.getState();
    const dock = validDock(storedDock, MIN_W, MIN_H) || FILER_HOME;
    const filerParam = new URLSearchParams(location.search).get('filer');
    const signedIn = !!profile?.userName;
    // Where a requirement started now is filed from — read at the press, so it
    // is the page as it is then (req #3813).
    const filedFrom = () => filedFromBlockNow({
        location, profile, database, theme, popupId: FILER_RACK_ID,
        popupStore: { open: useRequirementFilerStore.getState().open, dock },
    });
    const fileRequirement = () => startNewRequirement(filedFrom());
    useEffect(() => {
        if (!filerParam || !signedIn) return;
        useRequirementFilerStore.setState({ show: true, open: true });
        if (filerParam === 'new') startNewRequirement(filedFrom());
        if (filerParam === 'defaults') useRequirementFilerStore.getState().openDefaults();
        // Once per landing on the parameter, as the page then is.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [filerParam, signedIn]);

    if (!show || !isDesktop || !profile?.userName) return null;

    return (
        <AnchoredPanel dock={dock} onDockChange={setDock}
                       open={open} onToggle={toggleOpen}
                       name="Requirement Filer" testid="requirement-filer"
                       rackId={FILER_RACK_ID}
                       limits={LIMITS} fontPx={ACTION_POPUP_FONT_PX} colors={ACTION_POPUP_COLORS}
                       sx={ACTION_POPUP_SX}
                       actions={<ActionPopupClose onClick={() => setShow(false)}
                                                  label="Close the Requirement Filer"
                                                  testid="requirement-filer-close" />}>
            {({ shapedWidth }) => {
                // The icon-only navbar: the button says "+" and its tooltip the rest.
                const narrow = shapedWidth != null && shapedWidth < RACK_NARROW_PX;
                const pill = (color) => ({
                    display: 'inline-flex', alignItems: 'center', gap: '0.4em',
                    maxWidth: '100%', px: narrow ? '0.5em' : '0.85em', py: '0.3em',
                    border: `1px solid ${color}`, borderRadius: '999px',
                    background: 'transparent', color, cursor: 'pointer',
                    fontFamily: ACTION_POPUP_MONO, fontSize: '1em', fontWeight: 700,
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                });
                return (
                    <Box sx={{ px: narrow ? '0.3em' : '0.7em', py: '0.5em',
                               display: 'flex', flexWrap: 'wrap', gap: '0.4em' }}>
                        <Box component="button" type="button" onClick={fileRequirement}
                             title="File a requirement from the Defaults — it records this page, its view and where it was filed from"
                             aria-label="Requirement" data-testid="requirement-filer-new"
                             sx={{ ...pill(P.accent), '&:hover': { bgcolor: 'rgba(74, 217, 200, 0.12)' } }}>
                            <span aria-hidden="true">+</span>
                            {!narrow && <span>Requirement</span>}
                        </Box>
                        <Box component="button" type="button" onClick={openDefaults}
                             title="The values every new requirement filed here starts with"
                             aria-label="Defaults" data-testid="requirement-filer-defaults"
                             sx={{ ...pill(P.text), '&:hover': { color: P.accent, borderColor: P.accent } }}>
                            <span aria-hidden="true">⚙</span>
                            {!narrow && <span>Defaults</span>}
                        </Box>
                    </Box>
                );
            }}
        </AnchoredPanel>
    );
}
