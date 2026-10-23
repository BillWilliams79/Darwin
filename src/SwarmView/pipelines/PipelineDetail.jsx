// PipelineDetail.jsx — /swarm/pipeline/:id (req #3114).
//
// The header and the plan's panel. The panel comes from pipelineDetailModes.js,
// which since req #3641 registers ONE mode — the Plan visualizer is the only way
// to look at a pipeline (user directive), so there is no mode switcher on the
// row and a click on an epic frames it on the canvas rather than leaving for a
// Table.
//
// DATA: four bounded list reads + three dictionary reads + (req #3117) two cost
// reads, joined client-side in one useMemo (design rule 5 — the POC's ~86
// per-requirement fetches took 2–3 minutes per regeneration). Arriving from
// /swarm/pipelines every one of those queries is already warm, so the plan paints
// from cache with zero fetches — memory/detail-page-interlinking.md's composition
// rule, which is also why this page adds NO endpoint of its own.
//
// The count grows with the number of TABLES the plan draws on, never with the
// number of epics or requirements in it. That invariant is the acceptance check:
// the network tab must show no per-requirement request at any plan size.
//
// REFRESH is event-driven (design rule 6): the query client's staleTime +
// refetchOnWindowFocus + invalidation already do it. Deliberately no
// refetchInterval — a poll here would be the POC's manual regenerate epic wearing
// a different hat.

import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useNavigationType, useParams, useSearchParams } from 'react-router-dom';

import Alert from '@mui/material/Alert';
import AlertTitle from '@mui/material/AlertTitle';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Divider from '@mui/material/Divider';
import Link from '@mui/material/Link';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import useMediaQuery from '@mui/material/useMediaQuery';


import call_rest_api from '../../RestApi/RestApi';
import AuthContext from '../../Context/AuthContext';
import '../../CalendarFC/CalendarFC.css';
import {
    useAllRequirementSessions,
    useAllSessionCostRollups,
    useAllSessionTerminals,
    useDevServers,
    useMachines,
    useOrchestrationClaims,
} from '../../hooks/useDataQueries';
import { useViewPreference } from '../../hooks/useViewPreference';
import normalizeView from '../../Components/ViewerHeader/normalizeView';
import {
    PIPELINE_DETAIL_MODES,
    PIPELINE_DETAIL_MODE_STORAGE_KEY,
    DEFAULT_PIPELINE_DETAIL_MODE,
    findPipelineDetailMode,
} from './pipelineDetailModes';
import { pipelineStatusChipProps } from './pipelineChipStyles';
import { orchestrationBadges } from './orchestrationHolder';
import OrchestrationBadges, { orchestrationBadgesWidth } from './OrchestrationBadges';
import RequirementJumpInput from '../../NavBar/RequirementJumpInput';
// req #3463 — the era↔route binding. This page never spells a plan route or an
// entity name.
//
// req #3356 — THE `era` PROP IS GONE and every accessor below is called with no
// era argument at all. Pipeline 1.0 is eradicated, so there is one era to
// read and no branch to take; the accessors stay because `planEra.js` is still
// the ONE place a plan route or entity name is spelled (its `__tests__/planEra.test.js`
// § THE GUARD fails the build on a route literal anywhere else in `src/`).
// `planEra.js` itself was collapsed to a single binding in the same pass.
import {
    planEntityName, planListPath,
} from './planEra';
import { usePlanSources } from './usePlanSources';
import { useVisualizerMaximize } from '../../hooks/useVisualizerMaximize';
// req #3793 — the shared full screen switch, and the plan's words for it.
import FullscreenSwitch from '../../Components/FullscreenSwitch';
import { PLAN_MAXIMIZE_LABELS } from './planMaximize';
import {
    readColorParam, readFocusEpicParam, readLevelParam,
    FOCUS_EPIC_PARAM, FOCUS_LEVEL_PARAM, FOCUS_COLOR_PARAM,
} from './pipelineEpicLink';
import { readFocusInitiativeParam, FOCUS_INITIATIVE_PARAM } from './pipelineInitiativeLink';
import { writePipelinePlace } from './pipelinePlace';
// Req #3261 P8 — the Plan mode's own controls, in their own component, exactly
// as `SwarmView.jsx` renders `<VisualizerToolbar />` for its canvas mode (S4).
// `SemanticLevelControl` and `PLAN_LEVEL_NUMBER` went with them; this page no
// longer knows what a semantic level is.
import PipelinePlanToolbar, { SHOW_EPIC_WIDTH } from './PipelinePlanToolbar';
// Trimmed to what this file actually renders (req #3241). `DEFAULT_REQ_VIEW`,
// `REQ_VIEWS`, `normalizeReqView`, `reqViewOptions` and `machineTitle` outlived
// the `Reqs:`/`Epic:` controls and the status/machine chips that the 2026-08-01
// directives removed. There is no eslint in this package, so nothing flagged any
// of them — a dead `SemanticLevelControl` import was the visible trace req #3261
// was filed from.
import {
    normalizeColorKey, normalizePlanLevelPref,
    isEpicWidthRung, DEFAULT_PLAN_EPIC_WIDTH,
} from './pipelinePlanLayout';
import { usePlanViewSetting } from './planViewSettings';
import { parseHiddenMachines, toggleHiddenMachine } from './planMachineFilter';
import {
    classifyPlanEntry, isPlanLinkConsumed, planEntryFocus,
    PLAN_ENTRY_LINK, PLAN_LINK_CONSUMED_STATE_KEY,
} from './planViewEntry';
import {
    // The two-read cost fold. It is not plan derivation — `pipeline2_derive.py`
    // owns that, server side — and req #3345 did not move cost into the composed
    // payload, so the plan page still folds it here from two bounded reads.
    buildCostIndex,
    buildSessionStatusIndex,
} from './pipelineViewModel';
import { buildReqPills } from './planReqPills';
import { buildFirstStartIndex } from './planEpicTimes';

// A SHARED frozen empty array for the `data = EMPTY` defaults below. A `= []`
// literal mints a NEW array on every render while `data` is undefined — which is
// exactly the state a failed or in-flight read sits in — and that changing
// identity permanently defeats every useMemo downstream of it: costIndex, plan
// (so `new Date()` is re-read on every render, contradicting the "now is read
// ONCE per model change" contract below), and every panel memo keyed on them.
// One stable reference costs nothing and keeps the memo chain honest in the
// error path the costError branch exists to handle.
const EMPTY = Object.freeze([]);

// The narrowest the plan's name may become (req #3365 polish). A FLOOR on the
// header title's flex basis — see the title's own comment in the render for why
// zero was wrong. 140px is about a dozen `h5` characters plus the ellipsis:
// enough to tell two plans apart at a glance and enough of a box to hover for
// the tooltip that carries the rest. It is deliberately NOT sized to fit any
// particular plan's name — that would be a number that goes stale the first
// time somebody names a plan verbosely, and S13's band already handles the
// overflow.
// req #3827 — the one height every control on the plan header row is drawn at (the
// small Chip's own 24px), so chips, the Req # field, the Full screen switch and the
// group rules share a size and a centre line.
const PLAN_CONTROL_H = 24;

const TITLE_MIN_W = 140;
// The title row's Req # jump field (req #3798): RequirementJumpInput's own width
// (110) plus the row gap, added to the title slot's floor so it never eats the
// plan name's stub.
const REQ_JUMP_W = 118;

/**
 * The plan page (req #3356 — one era).
 *
 * It carried an `era` PROP set by the route while 1.0 and 2.0 stood in parallel,
 * because the era can never be inferred from the id in the URL — that is the
 * whole lesson of req #3462: the 1.0 and 2.0 plan routes were
 * different plans on different tables and the number could not tell them apart.
 * With 1.0 eradicated there is one table, so the prop is gone and the page reads
 * the plan-layer tables unconditionally. It takes NO props at all — a route that passed
 * one would be re-introducing a choice that no longer exists.
 */
export default function PipelineDetail() {
    const { id } = useParams();
    const navigate = useNavigate();
    const { profile } = useContext(AuthContext);
    const creatorFk = profile?.userName;
    const timezone = profile?.timezone;
    const pipelineId = Number(id);

    // Written by exactly one control now: the plan toolbar's Lock chip (req
    // #3761). Req #3641 removed the switcher that used to write it; a stored
    // 'table' from before still normalizes onto the registry below.
    const [mode, setMode] = useViewPreference(
        PIPELINE_DETAIL_MODE_STORAGE_KEY, DEFAULT_PIPELINE_DETAIL_MODE);

    // ── Mode toolbar state, OWNED HERE (req #3119) ──────────────────────────
    // The controls render in the header row beside the pipeline name — the
    // SwarmView/VisualizerToolbar arrangement (req #2407), where the panel is the
    // canvas and the page owns the chrome. That is what buys the visualizer a
    // full-height canvas: every row of chrome it used to carry is now shared.
    // req #3225 — persisted because the SAME toggle
    // also governs the plan list page's Cards/Table titles, a different page
    // component that must read the same choice on its own next mount rather
    // than default back to off. `useViewPreference`'s per-tab sessionStorage
    // is exactly that: this page writes it, the list page's own hook reads it
    // fresh when React Router mounts that page.
    //
    // ALWAYS ON (req #3242 user directive) — the toggle that used to gate this
    // is gone; requirement counts are now a permanent part of the plan name and
    // every initiative band label, not a preference. No storage key, no setter: there
    // is nothing left to persist.
    const showReqCounts = true;
    // ── THE RETIRED VIEW PREFERENCES (no declaration follows — that is the
    //    point). The `Reqs:` and `Epic:` preferences went with their controls
    //    (user directive 2026-08-01); the requirement LAYOUT stopped being a
    //    value at all with req #3498, because a card stacks its requirements top
    //    to bottom and there is no second arrangement left to name. (The S/M/L
    //    epic-width control went in that same pass; its storage key came back
    //    with req #3503's four-rung Epic Width, now the `epicWidth` row of
    //    `planViewSettings.js` — read below.) `epicLabel` and `reqLabel` are the two survivors and
    //    are declared as constants further down, beside the comment that
    //    explains what they are pinned TO.
    //
    //    None of the stored keys is read any more, and none is migrated: a value
    //    with no meaning has nothing to migrate to. They go stale in
    //    localStorage.
    // Req #3261 P4 — the title's type scale, the SAME query `ViewerHeader` owns
    // (`useMediaQuery('(max-width:899px)')`, i.e. MUI's `md` breakpoint minus
    // one). This page rendered `h6` unconditionally, which is the mobile size
    // shown on every desktop: a page title one epic smaller than every other
    // page's, for no reason anybody recorded.
    const isMobile = useMediaQuery('(max-width:899px)');
    // The persisted view settings are ONE table, `planViewSettings.js` (req
    // #3651) — key and default are spelled there, never at a call site.
    const [colorKeyPref, setColorKeyPref] = usePlanViewSetting('colorKey');
    // req #3686 — hide the closed requirements (and the line above them) on the canvas.
    const [hideClosed, setHideClosed] = usePlanViewSetting('hideClosed');
    const [showTimes, setShowTimes] = usePlanViewSetting('showTimes');
    // req #3708 — the machines DESELECTED in the toolbar's machine filter.
    const [hiddenMachinesRaw, setHiddenMachinesRaw] = usePlanViewSetting('hiddenMachines');
    const hiddenMachines = useMemo(
        () => parseHiddenMachines(hiddenMachinesRaw), [hiddenMachinesRaw]);
    const handleToggleMachine = useCallback(
        (machineId) => setHiddenMachinesRaw((raw) => toggleHiddenMachine(raw, machineId)),
        [setHiddenMachinesRaw]);
    // req #3503 — "Epic Width": four rungs, 1 the card every existing plan is
    // already sized for, 2-4 each 25% more text room. PERSISTED like every
    // other view preference — a reader who widens the card wants it wide next
    // time too — and, unlike Reset or the epics-across buttons, this ONE
    // relayouts the plan (every column, every card, every wrap point) rather
    // than just moving the camera, which is exactly why it is a deliberate,
    // explicit choice and never an automatic one.
    const [epicWidthLevelPref, setEpicWidthLevelPref] = usePlanViewSetting('epicWidth');
    // `Number.isFinite` on the LOOKED-UP SCALE, not a truthiness test on it
    // (review finding): correct today only because no rung is `0` or another
    // falsy-but-valid number — this says what is actually meant regardless.
    // req #3648 — the rung is the card's width in QUARTERS of the base card
    // (6 5 4 3); the plan opens at 5, "25% wider" (user directive).
    // While the rungs are hidden (`SHOW_EPIC_WIDTH`) the plan is drawn at the
    // fixed default, so a stored rung nobody can see cannot decide the width.
    const epicWidthLevel = SHOW_EPIC_WIDTH && isEpicWidthRung(Number(epicWidthLevelPref))
        ? Number(epicWidthLevelPref) : DEFAULT_PLAN_EPIC_WIDTH;
    // Req #3168 — the semantic-level selector, the Build Visualizer's control
    // (user directive: "show me the L1, L2, L3 and Auto selector used
    // elsewhere"). `auto` keeps the zoom-derived level; 1|2|3 pin one. Persisted
    // like every other view preference, and normalized the same way — the value
    // comes from localStorage.
    const [levelPref, setLevelPref] = usePlanViewSetting('level');
    // The STORED preference. What the toolbar and the canvas actually read is
    // `activeLevelPref` further down, which lets a `?level=` link pin one level
    // for one landing without ever writing it here (req #3253).
    const storedLevelPref = normalizePlanLevelPref(levelPref);
    // The level the CANVAS is rendering, reported back so the control can softly
    // mark it while on Auto — the same handshake BuildVisualizerPage uses
    // (`onEffectiveLevel={setEffectiveLevel}`). Display only: nothing is derived
    // from it, so a late first report cannot change what is drawn.
    //
    // It arrives in the CANVAS's vocabulary ('out'|'mid'|'in'), because that is
    // what `semanticLevel()` returns and the panel reports what it actually
    // drew. `PLAN_LEVEL_NUMBER` maps it at the control (req #3241) — handing the
    // string straight through would leave every chip unpressed and the control
    // would silently claim nothing was active.
    const [effectiveLevel, setEffectiveLevel] = useState(null);
    // Req #3216 — Reset joins the header's zoom controls (it used to float
    // over the canvas in the bottom-right corner). The click has to reach
    // across the page/panel boundary, so this is `resetViewNonce`,
    // KonvaBuildCanvas's own device (`BuildVisualizerPage.jsx`
    // `handleResetView`): a number that only ever increments, watched by an
    // effect inside the visualizer. 0 is the initial render, deliberately
    // never fired at.
    const [resetViewNonce, setResetViewNonce] = useState(0);
    // req #3722 — the toolbar chip under the pointer (`{ key, el }`), which the
    // plan visualizer draws the colour-help popup for. Transient, so state.
    const [keyHover, setKeyHover] = useState(null);
    // req #3498 — the epics-across buttons reach the canvas the same way Reset
    // does, and for the same reason: the control is in the page's header and the
    // camera is inside the panel. A NONCE rides alongside the number so clicking
    // the SAME button twice fires twice — after wheeling away from "8", asking
    // for "8" again must bring you back, and a bare value would be unchanged
    // state and do nothing.
    const [epicsAcross, setEpicsAcross] = useState({ n: null, nonce: 0 });
    // The epic label is always the TITLE, and the requirement marks always
    // reserve room for their TITLE — the renderer draws the id inside that box
    // at L1/L2 and the title itself at L3 (see the `idText` note in
    // pipelinePlanLayout.js). Reserving at every level is what keeps a zoom
    // change a pure transform instead of a relayout.
    const epicLabel = 'title';
    const reqLabel = 'title';
    // ── The colour key is EVERY REGISTERED SCALE PLUS NONE ──────────────────
    // req #3168 (user directive 2026-08-01), extended by req #3422 — the
    // positions are `REQ_COLOR_KEYS`, so this page never names them and a scale
    // added to the registry needs no edit here. `normalizeColorKey` is
    // `Object.hasOwn`-based because the value comes from localStorage, so
    // "constructor" is a reachable string that resolves to an inherited function,
    // and this one is handed to Konva as a text `fill`. A stored value written
    // before this change ('state' / 'machine') still normalizes to itself, so an
    // existing reader's plan opens exactly as it did. The resolved `colorKey`
    // is computed below, after `?color=` (req #3636) is read.

    // ── ONE PANEL SINCE REQ #3641 ───────────────────────────────────────────
    // This page chose between a Table and the Plan visualizer — a persisted
    // preference, a `?mode=` link override (req #3168), and a bead-click
    // handshake that pushed the epic's Table link (req #3115/#3637). The user
    // withdrew the Table: the visualizer is the only way to look at a pipeline.
    // `pipelineDetailModes.js` now registers one mode, so every path below
    // resolves to the plan; the machinery stays because `?mode=` links exist in
    // the wild and the registry is how a second view would come back. A link is
    // still a TRANSIENT override that never rewrites the stored preference (the
    // `normalizeView` doctrine — never let an external condition overwrite
    // uncommitted user intent).
    const [searchParams] = useSearchParams();
    // Validated against the mode list, never trusted: an unknown or withdrawn
    // `?mode=` (`table`, a typo) falls through to `null` and leaves the stored
    // preference — normalized onto the registry — in charge.
    const requestedMode = searchParams.get('mode');
    const linkMode = PIPELINE_DETAIL_MODES.some(
        (m) => m.value === requestedMode && !m.disabled) ? requestedMode : null;
    // ── `?epic=` makes ONE EPIC addressable (req #3140) ──────────────────────
    // The receiving end of an epic link (`epicPlanLinkTo`): seed `focusEpicId`,
    // and the visualizer centres and zooms on that epic. `pipelineEpicLink.js`
    // owns both halves of the contract so a writer and this reader cannot drift
    // on the key.
    const linkEpicId = readFocusEpicParam(searchParams);
    // ── `?initiative=` makes ONE INITIATIVE'S LOCATION addressable (req #3235) ───────────
    // The receiving end of the requirement page's initiative-box "view on plan" link.
    // A `?epic=` is more specific than a `?initiative=` (an epic names one card; an
    // initiative is a whole band an epic already belongs to), so if a link somehow
    // carried both, the epic wins — the canvas applies that precedence.
    // `pipelineInitiativeLink.js` owns both halves of this contract, same split as the
    // epic link.
    const linkInitiativeId = readFocusInitiativeParam(searchParams);
    // ── `?level=` PINS THE SEMANTIC LEVEL FOR ONE LANDING (req #3253) ────────
    // The epic-on-the-plan link carries `level=3` (req #3498 — it was `2`, and
    // the reason expired when the requirements moved INSIDE the card; the value
    // and the argument both live on `EPIC_PLAN_LINK_LEVEL`, not here, so this
    // comment cannot drift from the link). Validated against the level
    // vocabulary and null on anything else, so an unrecognised value leaves the
    // reader's stored preference in charge rather than pinning them to 'auto'.
    const linkLevel = readLevelParam(searchParams);
    // req #3636 — `?color=` picks the colour key for one landing, transiently,
    // by `?level=`'s contract (see `readColorParam`).
    const linkColor = readColorParam(searchParams);
    // A named epic or initiative means the PLAN, whatever `?mode=` the link carries
    // (req #3641). Until then a bare `?epic=` meant the Table's row; the Table is
    // gone, and the visualizer has consumed `focusEpicId` since req #3253 (it
    // centres and zooms on the epic).
    const linkView = linkEpicId != null || linkInitiativeId != null ? 'plan' : linkMode;

    // ── A LINK FIRES ONCE PER HISTORY ENTRY (req #3637) ─────────────────────
    // `?epic=`/`?initiative=` move the camera onto one thing.
    // Read straight off the URL they fired AGAIN on every reload and every
    // Back/Forward onto that entry — the URL still carries them — and yanked
    // the reader off wherever they had since panned to: *"refresh, reload,
    // should not change the viewport"*. So the first time an entry's link is
    // honoured it is MARKED in that entry's own history state (a replace, same
    // URL). History state survives a reload and travels with Back/Forward, so a
    // marked entry is answered by the remembered camera, not by the link; a
    // fresh click on the same link is a new entry and fires as it always did.
    //
    // `?mode=` and `?level=` are NOT consumed: they say which panel and which
    // level the entry shows, which is exactly what a reload must keep. What
    // stops them overriding a later manual pick is that the pick rewrites the
    // URL (`replaceLinkParams` below) instead of leaving a stale query behind.
    const location = useLocation();
    const navigationType = useNavigationType();
    // ── THE FOCUS IS THE ENTRY'S, COMPUTED IN RENDER (req #3651) ────────────
    // Each entry is a LINK (fire once, then mark), a REWRITE (this page's own
    // replace — keep the focus in hand) or a RETURN (Back/Forward, reload,
    // "Back to Plan" — no focus; memory answers). `planViewEntry.js` holds the
    // three and why there are only three.
    //
    // It used to be state re-seeded by an EFFECT on `location.key`, and an
    // effect runs after the render it follows — so a Back from a bead click's
    // `?mode=table&epic=N` mounted the canvas WITH `focusEpicId = N`. The canvas
    // began flying to that epic before restoring the reader's camera, and saved
    // the interrupted flight over it: the plan's top-left at scale 1. React's
    // "adjust state when a prop changes" pattern below re-derives the focus in
    // the SAME render the entry changes in, before any child renders, so no
    // panel can see another entry's focus. `?initiative=` rides along for the reason
    // req #3235's review gave it a state copy at all: an in-place move between
    // two links must not keep the first. (A manual mode pick cleared both too,
    // until req #3641 withdrew the Table and the switcher with it.)
    const linkConsumed = isPlanLinkConsumed(location);
    const entryKind = classifyPlanEntry({
        consumed: linkConsumed, navigationType,
        hasFocusLink: linkEpicId != null || linkInitiativeId != null,
    });
    const [focus, setFocus] = useState(() => ({
        entry: location.key,
        ...planEntryFocus(entryKind, { epicId: linkEpicId, initiativeId: linkInitiativeId }, null),
    }));
    let liveFocus = focus;
    if (focus.entry !== location.key) {
        liveFocus = {
            entry: location.key,
            ...planEntryFocus(entryKind, { epicId: linkEpicId, initiativeId: linkInitiativeId }, focus),
        };
        setFocus(liveFocus);
    }
    const focusEpicId = liveFocus.epicId;
    const focusInitiativeId = liveFocus.initiativeId;
    // The panel and the level are the URL's whenever it names them — derived,
    // never a state copy, so a Back/Forward lands on that entry's own panel and
    // a reload keeps it. Never written to the persisted preferences: a link
    // asks to see one thing, and must not change what any other plan opens in.
    const modeOverride = linkView;
    const levelOverride = linkLevel;
    const colorKey = normalizeColorKey(linkColor ?? colorKeyPref);
    // A LINK entry is MARKED once its focus is in hand — a replace onto the same
    // URL, which arrives back here as a REWRITE and so keeps the focus.
    useEffect(() => {
        if (entryKind !== PLAN_ENTRY_LINK) return;
        navigate({ pathname: location.pathname, search: location.search }, {
            replace: true,
            state: { ...(location.state || {}), [PLAN_LINK_CONSUMED_STATE_KEY]: location.search },
        });
        // `location.key` is the entry; the rest are read off that same entry.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [location.key]);
    // Rewrite this entry's query in place — a manual pick must not leave a
    // stale `?mode=`/`?level=` behind for a reload to resurrect. Re-marked so
    // the rewrite is not mistaken for a fresh link.
    const replaceLinkParams = useCallback((drop) => {
        const next = new URLSearchParams(location.search);
        drop.forEach((k) => next.delete(k));
        const search = next.toString() ? `?${next.toString()}` : '';
        if (search === location.search) return;
        navigate({ pathname: location.pathname, search }, {
            replace: true,
            state: { ...(location.state || {}), [PLAN_LINK_CONSUMED_STATE_KEY]: search },
        });
    }, [location.pathname, location.search, location.state, navigate]);
    // A click on an epic used to push its Table link (req #3115/#3637). Req
    // #3641 removed the Table: the visualizer frames the epic on its own
    // canvas, so there is no cross-mode handshake left for this page to own.
    // A manual LEVEL pick clears the link's `?level=` — so a reload keeps the
    // pick (req #3637) — and persists the reader's choice as usual.
    const handleLevelPrefChange = useCallback((v) => {
        setLevelPref(v);
        replaceLinkParams([FOCUS_LEVEL_PARAM]);
    }, [setLevelPref, replaceLinkParams]);
    // A manual COLOUR pick clears the link's `?color=` for the level pick's reason.
    const handleColorKeyChange = useCallback((v) => {
        setColorKeyPref(v);
        replaceLinkParams([FOCUS_COLOR_PARAM]);
    }, [setColorKeyPref, replaceLinkParams]);
    // ── RESET IS THE VIEW, AND ONLY THE VIEW (req #3324) ────────────────────
    // The camera goes back to the factory default; the LEVEL does not move.
    // > *"There are four modes only… it's fixed until Auto is selected."*
    // Reset is not one of the four — it is an action on the camera — so it may
    // not un-pin a level, and the reader who wants Auto has a chip that says so
    // one position to the right.
    //
    // IT DID CLEAR THE LEVEL between req #3310 and req #3324, on the grounds
    // that Reset lands below `K_READABLE` where a pin could not be drawn at all,
    // making a lit chip over an overview the "stuck at L1" state again. That
    // premise is gone: a pinned level is now honoured at every scale, so the
    // factory camera and a pinned level are a perfectly coherent pair — the
    // reader sees L2's formation on the whole plan, small, which is what asking
    // for a fixed rule set at that zoom means.
    const handleResetView = useCallback(() => {
        setResetViewNonce((n) => n + 1);
    }, []);
    // req #3761 — the Lock chip's choice: persisted per tab through the mode
    // registry, and it clears a `?mode=` link so the pick is not overridden by
    // the very URL it was made on (a manual pick rewrites the entry's query, as
    // the level and colour picks do).
    // A pick also drops a focus link (`?epic=` / `?initiative=`): those mean "the
    // plan" whatever the stored mode says, so leaving them in the URL would make
    // the chip a dead control on every such entry.
    const handleViewModeChange = useCallback((v) => {
        setMode(v);
        replaceLinkParams(['mode', FOCUS_EPIC_PARAM, FOCUS_INITIATIVE_PARAM]);
    }, [setMode, replaceLinkParams]);
    // Normalized ONCE here rather than at each consumer: `levelOverride` is
    // already validated by `readLevelParam` and `levelPref` comes from
    // localStorage, so this is the single place a level string is proved to be
    // one of the four the vocabulary defines.
    const activeLevelPref = normalizePlanLevelPref(levelOverride ?? storedLevelPref);
    const activeMode = normalizeView(modeOverride || mode, PIPELINE_DETAIL_MODES);
    // The Default nonce belongs to the mode it was pressed in. A panel that mounts
    // with a nonzero nonce reads it as a click and factory-resets its camera —
    // which cancels the epic framing an epic click in the Lock view just asked for
    // and replaces a remembered viewport on Plan -> Lock -> Plan. So a mode change
    // starts the next panel from 0 (which no panel acts on), in the same render.
    const [nonceMode, setNonceMode] = useState(activeMode);
    if (nonceMode !== activeMode) {
        setNonceMode(activeMode);
        setResetViewNonce(0);
    }

    // `machines` is a small WHOLE-APP dictionary, not a per-plan read, and it is
    // fetched here rather than in either head because both eras need it and
    // neither carries it: 1.0 hands it to `buildPipelineModel`, 2.0's composed
    // payload has no `machines` table of its own (`pipelineAdapter.js`'s
    // header).
    const { data: machines = EMPTY, isLoading: machinesLoading, isError: machinesError } =
        useMachines(creatorFk);

    // Req #3224 — the durable orchestration reservation on THIS plan. One more
    // bounded list read of a table holding one row per reserved scope, so the
    // count still grows with the number of TABLES this page draws on and never
    // with the number of epics in the plan (this file's header invariant).
    //
    // Deliberately NOT in `isLoading`: it feeds OPTIONAL badges whose absence
    // means "nobody is orchestrating this", which is also the right reading
    // while the read is in flight. Gating the plan on live process state would
    // make an unreachable ops table a blank plan page.
    const { data: orchestrationClaims = EMPTY } = useOrchestrationClaims(creatorFk);

    // Req #3117 — the Cost column, from TWO more bounded list reads. Deliberately
    // NOT in `isLoading` below: cost is not an ordering input (see the comment
    // there), so gating the whole plan on it would trade a correct-but-costless
    // first paint for a slower one. They also do not gate because they are
    // OPT-IN at the UI: the Cost column is hidden until the user asks for it.
    // (The junction now gates anyway, as a pill input — req #3587, below.)
    const requirementSessionsQuery = useAllRequirementSessions(creatorFk);
    const sessionCostsQuery = useAllSessionCostRollups(creatorFk);
    const { data: requirementSessions = EMPTY, isError: requirementSessionsError,
        isLoading: requirementSessionsLoading } = requirementSessionsQuery;
    const { data: sessionCosts = EMPTY, isError: sessionCostsError } = sessionCostsQuery;
    // Req #3584 — "has data", not `isSuccess`: a failed background refetch
    // clears `isSuccess` while TanStack keeps the last good rows, and the cost
    // fold keeps rendering those same rows — the Session key must not blank the
    // whole plan to unknown over a refetch the Cost column shrugs off.
    const sessionReadsReady = requirementSessionsQuery.data !== undefined
        && sessionCostsQuery.data !== undefined;
    // A failed cost read must not render as a column of em-dashes — that is
    // indistinguishable from "this plan has no recorded cost", which is a claim
    // about the data rather than about the fetch. The table says which it is.
    const costError = requirementSessionsError || sessionCostsError;

    const costIndex = useMemo(
        () => buildCostIndex({ requirementSessions, sessionCosts }),
        [requirementSessions, sessionCosts]);

    // Req #3584 — the visualizer's Session colour key, from the SAME two reads
    // (the session read carries `swarm_status`). Null until both have data, so
    // a slow or failed first read paints "unknown" rather than "no session".
    const sessionStatus = useMemo(
        () => buildSessionStatusIndex({
            requirementSessions, sessions: sessionCosts, ready: sessionReadsReady,
        }),
        [requirementSessions, sessionCosts, sessionReadsReady]);

    // Req #3825 — each requirement's FIRST swarm start, for the epic cards'
    // start time, from the SAME two reads (the session read carries
    // `started_at`). No fetch of its own.
    const firstStarts = useMemo(
        () => buildFirstStartIndex({ requirementSessions, sessions: sessionCosts }),
        [requirementSessions, sessionCosts]);

    // Req #3587 — the visualizer's Terminal and Dev Server pills. Two more
    // bounded list reads (a light session projection and `dev_servers`, the
    // latter always production per its req #2871 carve-out), joined against the
    // junction already read above.
    //
    // UNLIKE COST, THESE GATE `isLoading`, because a pill is TEXT in the row and
    // so changes the card's wrap, its height and the plan's: drawing first and
    // adding pills a round trip later reflowed every card under the reader and
    // fitted the landing view to a plan shorter than the one that then settled.
    // A FAILED read still ends the wait (`isLoading` goes false, `data` stays
    // EMPTY) — no pill is the right reading of "could not tell".
    const { data: sessionTerminals = EMPTY, isLoading: sessionTerminalsLoading } =
        useAllSessionTerminals(creatorFk);
    const { data: devServers = EMPTY, isLoading: devServersLoading } =
        useDevServers(creatorFk);
    const pillsLoading = requirementSessionsLoading || sessionTerminalsLoading
        || devServersLoading;
    const reqPills = useMemo(
        () => buildReqPills({
            requirementSessions, sessions: sessionTerminals, devServers,
            // undefined while in flight, so a terminal pill reads LOADING
            // rather than claiming this browser's machine is unknowable.
            machines: machinesLoading ? undefined : machines,
        }),
        [requirementSessions, sessionTerminals, devServers, machines, machinesLoading]);

    // ── THE FETCH (req #3463, collapsed to one head by req #3356) ───────────
    // The four values below are all this page consumes. 1.0 joined seven reads
    // in the browser; 2.0 consumes ONE composed read that already did the
    // derivation server-side, and with 1.0 eradicated that head is the only one
    // left — so this calls it directly rather than through an era dispatcher.
    const {
        pipeline, model, plan, diagnostic, isLoading: planLoading,
        dictionaryError: planDictionaryError, knownIds,
    } = usePlanSources(pipelineId, creatorFk, { machines, costIndex, sessionStatus, firstStarts });

    const isLoading = planLoading || machinesLoading || pillsLoading;

    // req #3708 — one filter chip per OPEN machine, in dictionary order.
    const filterMachines = useMemo(
        () => machines.filter((m) => !m.closed), [machines]);

    // `machines` is this page's own read — 2.0 carries no machines dictionary of
    // its own — so its failure is reported here rather than inside the head.
    const dictionaryError = planDictionaryError || machinesError;

    // req #3381 item 3 — a withheld or degraded `derived` block is a HARD STOP,
    // not an empty render.
    const canRenderPlan = !!pipeline && !diagnostic && !!plan;
    // req #3658 — the Plan visualizer's maximize switch. This page owns the
    // state because what it hides is HERE: the header row, and (by covering
    // it) the Darwin navbar. The switch is in the header row while that row is
    // on screen and on the canvas's upper-left corner once it is hidden (req
    // #3793). Enabled only while the canvas is actually drawn — the switch is
    // the only way out on screen, so a mode, a load or a withheld derivation
    // that takes the canvas away must take the maximize with it. The hook also
    // suspends the panel rack while the page covers the navbar (req #3735).
    const planMaximizable = activeMode === 'plan' && canRenderPlan;
    const { maximized, toggle: toggleMaximized } = useVisualizerMaximize(planMaximizable);

    // req #3225 — the whole-plan met/total, read straight off the composed
    // read's own derivation. `plan` is null while a diagnostic is set, so this
    // is optional.
    const planReqCounts = plan?.requirementCounts?.overall;

    // req #3809 — who is orchestrating this plan, one circular badge per
    // machine beside the plan's name: green the master (the first machine in,
    // req #3678), orange each secondary, the platform printed inside.
    const orchestrationBadgeList = useMemo(
        () => orchestrationBadges(orchestrationClaims, pipeline?.id, machines),
        [orchestrationClaims, pipeline?.id, machines]);

    // `planMachines` — the distinct machine set behind the header's machine chip
    // — was REMOVED with the rest of the dead code (req #3241). The chip itself
    // went on the 2026-08-01 directive; this memo outlived it, unread, still
    // walking every row and every row's machine labels on each plan change.
    // Unlike a dead import, it cost something.

    // ── req #3431 — THE READER IS HERE, SO THIS IS THE PLACE ────────────────
    // The single writer of the remembered place. Req #3311 wrote it from the
    // LIST page's click handler, which recorded a plan opened by clicking a card
    // and no other arrival: not a `?epic=` deep link, not the sessions grid's
    // "view the plan", not the requirement page's initiative box, not Back. Recording
    // on ARRIVAL covers all of them and every route added later, without any of
    // them being enumerated — the same argument `viewportMemory.js` makes about
    // return paths, pointed the other way.
    //
    // GATED ON `pipeline`, not on `pipelineId`: a URL naming a plan that does
    // not exist must not become the place the reader is sent back to. The
    // record is left alone in that case rather than cleared, because a
    // hand-typed bad id says nothing about the plan they were last really on.
    //
    // THE PANEL IS NOT RECORDED, deliberately — `pipelinePlace.js` argues it out.
    // The short version: `activeMode` is already durable through
    // `useViewPreference`, and the only channel a resume could replay it on is
    // `?mode=`, which everything on this page treats as a LINK asking to see one
    // thing once. The reader lands in the panel they left either way.
    // KEYED ON THE ID, NOT ON `pipeline`. The memo above mints a new object
    // every time the pipelines read refetches — which `refetchOnWindowFocus`
    // makes routine — and `localStorage.setItem` is synchronous and serializing.
    // Depending on the object writes the identical record on every focus; the id
    // changes only when the reader actually moves to another plan, which is the
    // only moment there is anything new to record.
    const placePipelineId = pipeline?.id ?? null;
    useEffect(() => {
        if (placePipelineId == null) return;
        // req #3463 — the era rides with the id: the resume gate rebuilds a
        // plan route from this record, and an id with no era is not an address.
        // Still written, and still 2.0 explicitly, because `pipelinePlace.js`
        // owns the record's shape and req #3356 is a page change, not a storage
        // migration — a record written without it would read as era-less to a
        // reader that has not been collapsed yet.
        writePipelinePlace({ at: 'plan', pipelineId: placePipelineId });
    }, [placePipelineId]);

    if (isLoading) {
        return (
            <Box sx={{ display: 'flex', justifyContent: 'center', mt: 4 }}>
                <CircularProgress />
            </Box>
        );
    }

    // ── req #3463 GUARD B — A MISS IS LOUD AND NAMES ITS SOURCE ─────────────
    // This alert used to read "No pipeline with id 79." and nothing else, and
    // that sentence is why req #3462's outage survived its own verification:
    // #3381's dev server issued the identical 404 EIGHTY TIMES against an empty
    // `darwin_dev.pipelines`, and every one of them rendered as this
    // tidy warning. "This plan was deleted", "this table is empty", "you are
    // asking the wrong era" and "the read failed" were one indistinguishable
    // message.
    //
    // So it now names the ERA, the ENTITY that answered, and the ids that
    // entity actually holds. `knownIds` costs one extra list read, fired ONLY on
    // this path. Three cases, three different sentences:
    //
    //   knownIds == null    the id list did not resolve — say so, claim nothing
    //   knownIds is []      the table is EMPTY, which is a fact about the DATA
    //   knownIds has rows   the id is not among them, and they are printed
    if (!pipeline) {
        const entity = planEntityName();
        return (
            <Box sx={{ p: 3 }}>
                <Alert severity="warning" data-testid="pipeline-not-found">
                    <AlertTitle>
                        No plan with id {pipelineId}
                    </AlertTitle>
                    <Typography variant="body2" component="div"
                                data-testid="pipeline-not-found-source">
                        This page reads <code>{entity}</code>.{' '}
                        {knownIds == null
                            ? 'The list of plans it holds did not load, so whether this '
                              + 'id exists there is unknown.'
                            : knownIds.length === 0
                                ? 'That table holds NO plans at all — this is an '
                                  + 'empty table, not a missing plan.'
                                : `It holds ${knownIds.length} plan${knownIds.length === 1 ? '' : 's'}: `
                                  + `${knownIds.join(', ')}.`}
                    </Typography>
                    <Typography variant="body2" component="div" sx={{ mt: 1 }}>
                        <Link component="button" variant="body2"
                              onClick={() => navigate(planListPath())}>
                            Back to plans
                        </Link>
                    </Typography>
                </Alert>
            </Box>
        );
    }

    const ActiveComponent = (findPipelineDetailMode(activeMode)
        || PIPELINE_DETAIL_MODES[0]).Component;

    // req #3261 P2 — the status group's separator renders only when the group
    // does. Its chip is a live-ops conditional, so this is false on the
    // ordinary row and the row is byte-identical to one with no status slot.
    // The orchestration chip left this group for the title (req #3809).
    const hasStatusChips = pipeline.pipeline_status === 'paused';

    // req #3242 — initiatives represented in THIS plan (a requirement with no initiative
    // is excluded by `requirementCounts` itself, so this is never inflated by
    // a "no initiative" bucket).
    // `plan` is null while `diagnostic` is set (req #3381 item 3 — a
    // withheld/absent `derived` block is a hard stop, so there is no
    // requirement-counts derivation to read).
    const planInitiativeCount = plan?.requirementCounts?.byInitiative?.length ?? 0;

    // ── ONE STRING PER ELLIPSIZING LINE ──────────────────────────────────────
    // `noWrap` with a tooltip needs the whole text as a VALUE: CSS
    // `text-overflow` needs a single inline flow to clip, and a tooltip that is
    // the recovery path for a clip has to carry exactly what was clipped.
    //
    // THE COUNTS ARE A SEPARATE RUN OF TYPE, NOT MORE TITLE (req #3365 polish).
    // Req #3242 folded the whole-plan counts INTO the title and removed the
    // accounting line that used to carry them; that directive is about WHERE
    // they live and this is about how they READ. Rendered at the title's own
    // weight, size and colour they produced one undifferentiated string —
    // "FP Pipeline - Agent Harness 4 Initiatives, 73/115 Requirements" — with nothing
    // saying where the plan's name ends and the statistics begin, and at 1600px
    // it was the STATISTIC that ellipsized, leaving a broken fraction ("73/115
    // …") as the last thing on the row. Splitting the two lets the eye take the
    // name in one jump and treat the counts as the annotation they are.
    //
    // STILL ONE INLINE FLOW, which is what the paragraph above requires: the
    // counts are a `<span>`, so `text-overflow: ellipsis` still clips one line
    // box. A second BLOCK is what would break it — do not turn this into a
    // Stack or a second Typography.
    //
    // NUMBERS ONLY, "EE  -  MM/TT" (req #3648 user directive: "2  -  70/71",
    // two spaces either side of the dash to separate the numbers visually). The
    // spaces are NO-BREAK spaces: the title is `noWrap`, i.e. `white-space:
    // nowrap`, which collapses a run of ordinary spaces to one.
    const countsText = planReqCounts
        ? `${planInitiativeCount}\u00a0\u00a0-\u00a0\u00a0`
            + `${planReqCounts.met}/${planReqCounts.total}`
        : '';
    // NO TOOLTIP ON THE TITLE (req #3648 user directive, "drop the tooltip for
    // the title"). It used to carry the whole line as the recovery path for a
    // clip; the title's own text is now its accessible name.

    // `minWidth: 0` is load-bearing, not tidiness (req #3119 polish pass). This
    // Box is an item of the `.app-layout` CSS grid, whose items default to
    // `min-width: auto` — "never shrink below your content". The plan table is
    // ~1640px of NOWRAP columns, so on the real 41-epic plan this Box grew past
    // its grid track and took the WHOLE PAGE into horizontal scroll: measured
    // 187px of document overflow at 1680px wide and 427px at 1440px, dragging the
    // nav rail and header sideways with it. The TableContainer already carries
    // `overflow-x: auto` and `min-width: 0` and was never getting the chance to
    // use them — it cannot scroll content that its own ancestor widened to fit.
    // One property restores what PipelinePlanTable's GroupCell comment already
    // claims happens ("The TableContainer scrolls instead"), and it is scoped to
    // this page: nothing else reads it.
    return (
        <Box sx={{ p: 3, minWidth: 0,
                   // req #3658 — MAXIMIZED: the page becomes a fixed full-window
                   // layer over the Darwin navbar (the drawer's z-index and
                   // above) and under the modal layer, so the seat and insert
                   // dialogs and every tooltip still open over it. No top
                   // padding — the header row above the canvas is hidden, so
                   // the canvas starts at the window's top edge; the sides and
                   // bottom keep `p: 3` because the canvas cancels exactly that.
                   ...(maximized && {
                       position: 'fixed', inset: 0, zIndex: 1250, pt: 0,
                       overflow: 'hidden', bgcolor: 'background.default',
                   }) }}
             data-maximized={maximized ? 'true' : 'false'}
             data-testid="pipeline-detail">
            {/* ── ONE ROW (user directive 2026-08-01) ─────────────────────────
                "the title of the visualizer, it became three rows for seemingly
                no reason." Earlier in req #3168 this was split into a PIPELINE
                bar and a VIEW bar, on a reading of "navbar seprate for pipeline
                and its data types". The user looked at the result against
                darwin.one and rejected it: with the breadcrumb above, the split
                reads as three rows of chrome before any plan.

                So this is production's single row again, in production's order —
                mode switch first and left, the plan's identity (which IS the
                spacer, S11), the active mode's own controls, then the
                description at the right end. Since req #3261 those controls are
                GROUPED and the groups are separated by a vertical rule:
                [mode] | [view] | [display] | [status] | [description].

                EVERY MEASUREMENT BELOW IS HISTORICAL — it describes the row as
                req #3241 left it, and it is kept because it is the argument, not
                the state. That row has since lost the Counts toggle and gained
                three dividers, a group caption, a labelled description chip and
                an `h5` title, so none of these figures is this row's width
                today. Nothing depends on one any more; the ceiling they were
                rationing against is gone (see the S13 note below).

                ── IT IS NOW ONE ROW AS A PROPERTY, NOT AS A MEASUREMENT (req
                #3241) ────────────────────────────────────────────────────────
                It used to be `flexWrap: 'wrap'`, and every assertion against it
                was written to be wrap-INVARIANT so the suite kept passing on
                both sides of the wrap point. Req #3241 puts the semantic-level
                selector back on this row — the move req #3214's title promises —
                and makes a one-row header the requirement rather than an
                observation, so wrap-invariance is no longer the right property
                to assert.

                MEASURED, at the real 244px of page chrome (180px sidebar + the
                24px padding either side of this Box):

                    the row as it stood, WITHOUT the selector    1172px
                        → wrapped to two lines below ~1416px of viewport,
                          i.e. on every 1280px window and narrower
                    the same row plus the selector (186px)      ~1366px
                        → would have wrapped below ~1610px, i.e. on a
                          1440px laptop too. That is the cost req #3214
                          recorded, and it is real.
                    this row, after the three changes below       883px
                        → ONE line at EVERY width, because it cannot wrap
                          at all; the whole name fits down to ~1127px and
                          ellipsizes below that.

                The two changes that made it true at every width:

                  1. The ACCOUNTING LINE LEFT — it went to the breadcrumb line
                     above, which already existed and had the room. That is the
                     530px this row needed and the whole reason the level
                     selector fits. (Req #3242 then removed that line, and the
                     breadcrumb with it, so neither exists today.)
                  2. `flexWrap: 'nowrap'` — the row cannot become two rows, by
                     construction. There is nothing left to measure.

                ── AND OVERFLOW SCROLLS THIS ROW'S OWN BAND (req #3261 P7, S13) ─
                `nowrap` used to trade a wrap for PAGE overflow, and this comment
                conceded exactly that: the row's incompressible width was 763px,
                which was clean at 1024 and 1000, 5px of document overflow at
                980 and 25px at 960 — a ~1000px VIEWPORT FLOOR on a page whose
                only job is to draw a plan. `pipelines.spec.ts` PIPE-18 then
                asserted a ≤ 780px control budget to hold that floor in place, so
                every control this row might ever want was rationed against a
                number that came from the page dragging sideways.

                `SwarmView.jsx:253-263` solved the identical problem for the
                identical reason (req #2802 — "the visualizer's wide toolbar
                overflowed the viewport on mobile, scrolling the whole page
                left/right") with three properties and NO floor: `minWidth: 0`
                keeps the row inside its grid track, `overflowX: 'auto'` gives it
                a scrollable band of its own, and every control keeps
                `flexShrink: 0` so it scrolls out of view at its natural size
                rather than compressing into illegibility.

                The title is the one member that is NOT `flexShrink: 0`, and it
                is what right-aligns the tail as well (S11): `flex: 1` gives it
                every pixel of slack while there is slack, and zero once there is
                not. So a desktop sees no scrollbar at all, a narrow viewport
                spends the title first exactly as before, and only then does the
                band scroll (the title's tooltip was dropped by req #3648). What no
                longer happens is the page itself moving. It matters more since
                req #3242 removed the breadcrumb: this row IS the plan's
                identity now, so the page dragging sideways would drag the name
                with it.

                ONE CAVEAT, latent rather than live: per CSS Overflow 3 a
                `visible` value paired with a non-`visible` one computes to
                `auto`, so this row is now a scroll container on BOTH axes and
                clips vertical overflow. Nothing overflows vertically today (the
                `flexItem` Dividers define the line's height, and Tooltips are
                portaled), and `SwarmView.jsx` has carried the identical shape
                since req #2802 — but the first control here with a badge or a
                popper anchored INSIDE the row will find it. */}
            {/* req #3658 — hidden, not unmounted, while maximized: the
                toolbar's controls keep their state for the way back. */}
            {/* req #3827 (user directive: "make sure all buttons are centered
                vertically in the bar … buttons could ideally be same height
                too"): every control on this row is ONE height, the small
                Chip's 24px, and centred on the row's axis. The Req # field
                (~27px) and the Full screen switch (20px) were their own
                heights, and the rules were `flexItem` Dividers that stretched
                to the title's 32px line box — so the row read as four sizes
                of control around chips that sat in the middle of a taller
                rule. The overrides are scoped to this row: the field and the
                switch are shared with the Requirements page and the TPU views,
                which keep theirs. */}
            <Box sx={{ display: maximized ? 'none' : 'flex',
                        alignItems: 'center', gap: 1, flexWrap: 'nowrap',
                        minWidth: 0, overflowX: 'auto', mb: 1,
                        '& > .MuiDivider-root': { alignSelf: 'center', height: PLAN_CONTROL_H },
                        '& .MuiChip-root': { height: PLAN_CONTROL_H },
                        '& [data-testid="pipeline-req-launcher"] .MuiInputBase-root':
                            { height: PLAN_CONTROL_H },
                        '& [data-testid="pipeline-req-launcher"] .MuiInputBase-input':
                            { py: 0, height: '100%', boxSizing: 'border-box' },
                        '& [data-fullscreen-switch="header"]':
                            { height: PLAN_CONTROL_H } }}
                 data-testid="pipeline-header-row">

                {/* THE TITLE IS THE SPACER (req #3261 P3, S11 / V2). It used to
                    be `flexShrink: 1` beside a SEPARATE `flexGrow` Box —
                    `darwin-viewer-pages.md` 2.1 calls adding that spacer "the
                    exact failure the rule exists to prevent", and it is the one
                    deviation on this row that the canonical `ViewerHeader` and
                    both shipped visualizers agree about. `flex: 1` is the whole
                    control: it absorbs every pixel of slack while there is
                    slack, and nothing once there is not.

                    A FLOOR, NOT `minWidth: 0` (req #3365 polish). `min-width: 0`
                    is what lets a flex item give at all — a flex item's default
                    `min-width: auto` means "never below your content", and
                    `noWrap` alone would widen the row instead of ellipsizing
                    inside it — but ZERO lets it give EVERYTHING. Measured at a
                    1024px viewport: the title's box was **0px** and the plan's
                    name was not on the page at all, while the row's own S13 band
                    scrolled the controls. Since req #3242 removed the breadcrumb
                    this row IS the plan's only identity, and S13's own note says
                    the title's tooltip is the only recovery path left when it
                    ellipsizes — at zero width there is no text to ellipsize and
                    no target to hover, so that path is gone too and the page
                    silently stops saying which plan it is drawing.
                    `TITLE_MIN_W` keeps a stub of the name on the row at every
                    width; the controls scroll in the band S13 built for exactly
                    this, which is the trade S13 already chose over page
                    overflow. It does not weaken S11 — the title is still the
                    spacer and still takes every pixel of slack first.
                    The title's tooltip was dropped by req #3648 (user
                    directive), so a clipped name is read from the plan list. */}
                {/* The title's SLOT is the spacer (S11 — `flex: 1`, every
                    pixel of slack); the title text sits at its start (after
                    the orchestration badges, req #3820), shrinking to clip,
                    and the Full screen switch follows the text
                    (and the Req # launcher, req #3798) inside the
                    slot (req #3793 — "in the title", as the TPU views'
                    follows "▾ Controls"), not the slot's far end. */}
                {/* The floor is the NAME's (req #3809 review): the badges are
                    rigid, so the slot's floor grows by their width rather than
                    letting them eat the name's stub. */}
                <Box sx={{ flex: 1,
                           minWidth: TITLE_MIN_W + REQ_JUMP_W + orchestrationBadgesWidth(
                               orchestrationBadgeList.length),
                           display: 'flex', alignItems: 'center', gap: 1 }}>
                {/* ── ORCHESTRATION BADGES (req #3809; req #3820 moved them,
                    user directive: "it should be to the left of pipeline's
                    name in the title") ──────────────────────────────────────
                    Rigid, so the plan's name is what clips first; they render
                    only while somebody orchestrates this plan. */}
                <OrchestrationBadges badges={orchestrationBadgeList} />
                <Typography variant={isMobile ? 'h6' : 'h5'} noWrap
                            sx={{ flex: '0 1 auto', minWidth: 0 }}
                            data-testid="pipeline-title">
                    {pipeline.title}
                    {/* A REAL SPACE, not just the margin below (measured —
                        the first cut had only the margin and the row's
                        `textContent` read "…Agent Harness4 Initiatives, 73/115…").
                        The margin is what the eye sees; this is what a
                        COPY-PASTE carries, and the two must not disagree.
                        With the tooltip gone (req #3648) the text content
                        is also the accessible name, so the space reaches a
                        screen reader too. */}
                    {countsText && ' '}
                    {countsText && (
                        <Box component="span"
                             data-testid="pipeline-title-counts"
                             sx={{
                                 // `em`, so the counts stay in proportion
                                 // through the `h6`/`h5` breakpoint swap
                                 // instead of needing a second media query.
                                 fontSize: '0.62em',
                                 fontWeight: 400,
                                 color: 'text.secondary',
                                 // The gap is a margin rather than a space
                                 // in the string so it does not collapse
                                 // against the ellipsis when the line clips.
                                 ml: 1,
                                 // NO `whiteSpace` HERE, deliberately. The
                                 // first cut set `nowrap` to stop a count
                                 // breaking across the clip ("73/1…"), and
                                 // that was two mistakes at once: the
                                 // parent's `noWrap` already inherits down,
                                 // so it was a no-op, and no `white-space`
                                 // value could have done it anyway —
                                 // `text-overflow: ellipsis` clips at the
                                 // box edge without regard to word or token
                                 // boundaries. What actually protects the
                                 // numbers is ORDER: the counts come last,
                                 // so the name is spent first and the clip
                                 // reaches them only once the name is
                                 // already gone.
                             }}>
                            {countsText}
                        </Box>
                    )}
                </Typography>

                {/* ── REQUIREMENT LAUNCHER (req #3798) ────────────────────────
                    The Requirements page's title-row "Req #" field, unchanged —
                    type a number, Enter (or →) opens that requirement in a new
                    tab — placed immediately LEFT of the Full screen switch.
                    Rigid, so the plan's name clips first. Hidden with the row
                    while maximized, as the switch's header copy is. */}
                <Box sx={{ flexShrink: 0, display: 'flex', alignItems: 'center' }}
                     data-testid="pipeline-req-launcher">
                    <RequirementJumpInput />
                </Box>

                {/* ── FULL SCREEN (req #3793; the switch is req #3658's) ──────
                    The user's rule: with the controls on screen the switch
                    lives in the controls' title, just right of the title word —
                    the TPU 3D views put theirs right of "▾ Controls". The
                    plan's title IS this row's title word, so the switch follows
                    its text inside the title's slot. Only while the plan
                    canvas is drawn (the hook's own enable), and only while NOT
                    maximized — then this row is hidden and the canvas draws the
                    same switch in its upper-left corner, so exactly one is ever
                    on the page. */}
                {planMaximizable && !maximized && (
                    <FullscreenSwitch
                        on={false}
                        onToggle={toggleMaximized}
                        testid="pipeline-viz-maximize"
                        {...PLAN_MAXIMIZE_LABELS} />
                )}
                </Box>

                {/* ── GROUP SEPARATOR (req #3261 P2, S5) ──────────────────────
                    The single most legible thing the Build Visualizer does, and
                    what makes twelve of its controls readable: groups, separated
                    by a vertical rule. This row had none, so five unrelated
                    controls read as one undifferentiated strip. The groups are
                    [mode] | [view] | [display] | [status] | [description], and
                    every divider on this row is pure addition — nothing moved to
                    make room for one.

                    P2 named the groups as `[display: Counts, Width, Colour] |
                    [zoom: Level, Reset]`, in that order. Both halves of that
                    have since been overtaken by req #3242's user directives,
                    which are LATER and specific: Counts was removed outright,
                    and Reset was moved to sit immediately left of the level
                    selector "ahead of the whole zoom/layout control cluster
                    rather than trailing it". So the view group leads and the
                    display group follows. What P2 actually asked for — that
                    there BE groups and that a rule separate them — is applied to
                    the order the user asked for, which is the only reading under
                    which both requirements are satisfied. */}
                <Divider orientation="vertical" flexItem
                         sx={{ mx: 0.5, flexShrink: 0 }} />

                    <PipelinePlanToolbar
                        onEpicsAcross={(n) => setEpicsAcross(
                            (prev) => ({ n, nonce: prev.nonce + 1 }))}
                        epicWidthLevel={epicWidthLevel}
                        onChangeEpicWidthLevel={setEpicWidthLevelPref}
                        colorKey={colorKey}
                        onChangeColorKey={handleColorKeyChange}
                        onKeyHover={setKeyHover}
                        hideClosed={hideClosed}
                        onChangeHideClosed={setHideClosed}
                        showTimes={showTimes}
                        onChangeShowTimes={setShowTimes}
                        machines={filterMachines}
                        hiddenMachines={hiddenMachines}
                        onToggleMachine={handleToggleMachine}
                        planLevelPref={activeLevelPref}
                        effectiveLevel={effectiveLevel}
                        onChangeLevelPref={handleLevelPrefChange}
                        onResetView={handleResetView}
                        viewMode={activeMode}
                        onChangeViewMode={handleViewModeChange}
                    />

                {/* The status chip and the machine chip were REMOVED on the
                    user's directive (2026-08-01). Plan status is already on the
                    Pipelines list this page is reached from, and the machine
                    spread is in the plan table; on the title row they
                    were two more things between the plan's name and the reader.
                    Snap (req #3503) and the description button (req #3503) are
                    both gone too — this row's own last child now is whichever
                    of Time/Tokens or PipelinePlanToolbar the active mode drew. */}

                {/* ── STATUS GROUP (req #3261 P2) ─────────────────────────────
                    CONDITIONAL ON ITS OWN CONTENTS, not rendered unconditionally
                    like the two dividers around it: the chip below appears only
                    in a live ops state, so an unconditional rule here would put
                    two adjacent separators with nothing between them on the
                    ordinary row — a group boundary announcing an empty group,
                    which is worse than no boundary at all.

                    This slot is the one thing on the row the canonical
                    `ViewerHeader` has no place for (P11), recorded and left
                    where it is: whether V3 grows a `status` slot or this prose
                    moves elsewhere is its own question. */}
                {hasStatusChips && (
                    <Divider orientation="vertical" flexItem
                             sx={{ mx: 0.5, flexShrink: 0 }} />
                )}

                {/* req #3226 — the ONE status this requirement asks to survive
                    here despite the chip-removal directive above, for the same
                    reason the orchestration badges beside the title do: it is
                    CONDITIONAL (renders only while actually paused, so the
                    ordinary row is unchanged) and it is not a duplicate of the
                    list page's chip — a reader who navigated straight here
                    (a deep link, a bookmark) never saw that page at all. */}
                {pipeline?.pipeline_status === 'paused' && (
                    <Tooltip title="This plan is paused — its epics are not swarm-starting">
                        <Chip
                            size="small"
                            label="Paused"
                            {...pipelineStatusChipProps('paused')}
                            sx={{ ...pipelineStatusChipProps('paused').sx, flexShrink: 0 }}
                            data-testid="pipeline-detail-paused"
                        />
                    </Tooltip>
                )}

            </Box>

            {dictionaryError && (
                <Alert severity="error" variant="outlined" sx={{ mb: 2 }}
                       data-testid="pipeline-dictionary-error">
                    The machine list failed to load. Machines will read as bare
                    ids on this plan until it recovers. Reload before acting on
                    this page.
                </Alert>
            )}

            {/* req #3381 item 3 — A WITHHELD OR DEGRADED `derived` BLOCK IS A
                HARD STOP, NOT AN EMPTY RENDER. `diagnostic` is set for all four
                regimes (`derivation_failed`, `budget_derived_only`,
                `budget_rows_truncated`, and the wholly-absent key) — the panel
                below is never attempted from rows with no derived state; this
                banner replaces it, in the SAME Alert treatment
                `OrderViolationsAlert` (PipelinePlanTable.jsx) already uses for
                an order-invariant failure, rather than inventing a second
                diagnostic surface. */}
            {diagnostic && (
                <Alert severity="error" variant="outlined" sx={{ mb: 2 }}
                       data-testid="pipeline-derived-withheld">
                    <AlertTitle>
                        Plan derivation unavailable ({diagnostic.regime})
                    </AlertTitle>
                    {diagnostic.message}
                    {!diagnostic.rowsComplete && (
                        <>
                            {' '}The underlying rows are INCOMPLETE — do not sequence
                            or launch from this plan until it recovers.
                        </>
                    )}
                </Alert>
            )}

            {/* MUST stay the last child (req #3156): PipelinePlanVisualizer's
                canvas cancels this Box's `p: 3` on its own sides/bottom via a
                negative margin, which relies on being the last thing in flow
                — anything rendered after it here would overlap the canvas by
                24px instead of leaving a gap. A withheld/absent `derived` block
                renders NO panel at all (item 3's hard stop) — the diagnostic
                Alert above is then the last child instead. */}
            {canRenderPlan && (
            <ActiveComponent plan={plan} model={model} pipeline={pipeline} timezone={timezone}
                             focusEpicId={focusEpicId}
                             focusInitiativeId={focusInitiativeId}
                             costError={!!costError}
                             showReqCounts={showReqCounts}
                             epicLabel={epicLabel} colorKey={colorKey}
                             reqLabel={reqLabel}
                             // `levelPref` still travels IN — the canvas needs to
                             // know which level is pinned to draw it. Only the
                             // SETTER left (req #3241): the control that called
                             // it is on this page's own header now, so the panel
                             // no longer changes the preference, it only reports
                             // the level it settled on via `onEffectiveLevel`.
                             // A `levelPrefFromLink` flag went with it between req
                             // #3310 and req #3324, so the canvas could tell the
                             // reader's own pick from a `?level=` link for the sake
                             // of the pin's camera correction. #3324 deleted the
                             // correction, so `activeLevelPref` collapsing the two
                             // is now right for the only thing a level does: draw.
                             levelPref={activeLevelPref}
                             onEffectiveLevel={setEffectiveLevel}
                             resetViewNonce={resetViewNonce}
                             epicsAcross={epicsAcross}
                             epicWidthLevel={epicWidthLevel}
                             hideClosed={hideClosed}
                             showTimes={showTimes}
                             hiddenMachines={hiddenMachines}
                             reqPills={reqPills}
                             sessionStatus={sessionStatus}
                             maximized={maximized}
                             onToggleMaximized={toggleMaximized}
                             keyHover={keyHover}
                             orchestrationClaims={orchestrationClaims}
                             machines={machines}
                             />
            )}
        </Box>
    );
}
