// PipelineDetail.jsx — /swarm/pipeline/:id (req #3114).
//
// The header, the Table|Plan mode switcher (fed by pipelineDetailModes.js so
// req #3115 adds its visualizer without touching this file), and the active
// mode's panel.
//
// DATA: four bounded list reads + three dictionary reads + (req #3117) two cost
// reads, joined client-side in one useMemo (design rule 5 — the POC's ~86
// per-requirement fetches took 2–3 minutes per regeneration). Arriving from
// /swarm/pipelines every one of those queries is already warm, so the plan paints
// from cache with zero fetches — memory/detail-page-interlinking.md's composition
// rule, which is also why this page adds NO endpoint of its own.
//
// The count grows with the number of TABLES the plan draws on, never with the
// number of steps or requirements in it. That invariant is the acceptance check:
// the network tab must show no per-requirement request at any plan size.
//
// REFRESH is event-driven (design rule 6): the query client's staleTime +
// refetchOnWindowFocus + invalidation already do it. Deliberately no
// refetchInterval — a poll here would be the POC's manual regenerate step wearing
// a different hat.

import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';

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
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import useMediaQuery from '@mui/material/useMediaQuery';

import call_rest_api from '../../RestApi/RestApi';
import { pipelineKeys } from '../../hooks/useQueryKeys';
import AppContext from '../../Context/AppContext';
import AuthContext from '../../Context/AuthContext';
import '../../CalendarFC/CalendarFC.css';
import {
    useAllRequirementSessions,
    useAllSessionCostRollups,
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
import { pipelineStatusChipProps, toolbarChipProps } from './pipelineChipStyles';
import { claimForPipeline, holderView } from './orchestrationHolder';
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
import { readFocusStepParam, readLevelParam } from './pipelineStepLink';
import { readFocusEpicParam } from './pipelineEpicLink';
import { writePipelinePlace } from './pipelinePlace';
// Req #3261 P8 — the Plan mode's own controls, in their own component, exactly
// as `SwarmView.jsx` renders `<VisualizerToolbar />` for its canvas mode (S4).
// `SemanticLevelControl` and `PLAN_LEVEL_NUMBER` went with them; this page no
// longer knows what a semantic level is.
import PipelinePlanToolbar from './PipelinePlanToolbar';
// Trimmed to what this file actually renders (req #3241). `DEFAULT_REQ_VIEW`,
// `REQ_VIEWS`, `normalizeReqView`, `reqViewOptions` and `machineTitle` outlived
// the `Reqs:`/`Step:` controls and the status/machine chips that the 2026-08-01
// directives removed. There is no eslint in this package, so nothing flagged any
// of them — a dead `SemanticLevelControl` import was the visible trace req #3261
// was filed from.
import {
    DEFAULT_COLOR_KEY, DEFAULT_PLAN_LEVEL_PREF,
    normalizeColorKey, normalizePlanLevelPref,
    STEP_WIDTH_SCALES, DEFAULT_STEP_WIDTH_LEVEL,
} from './pipelinePlanLayout';
import {
    // The two-read cost fold. It is not plan derivation — `pipeline2_derive.py`
    // owns that, server side — and req #3345 did not move cost into the composed
    // payload, so the plan page still folds it here from two bounded reads.
    buildCostIndex,
} from './pipelineViewModel';

// A SHARED frozen empty array for the `data = EMPTY` defaults below. A `= []`
// literal mints a NEW array on every render while `data` is undefined — which is
// exactly the state a failed or in-flight read sits in — and that changing
// identity permanently defeats every useMemo downstream of it: costIndex, plan
// (so `new Date()` is re-read on every render, contradicting the "now is read
// ONCE per model change" contract below), and the table's own planRenderRows.
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
const TITLE_MIN_W = 140;

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

    const [mode, setMode] = useViewPreference(
        PIPELINE_DETAIL_MODE_STORAGE_KEY, DEFAULT_PIPELINE_DETAIL_MODE);

    // ── Mode toolbar state, OWNED HERE (req #3119) ──────────────────────────
    // The controls render in the header row beside the pipeline name — the
    // SwarmView/VisualizerToolbar arrangement (req #2407), where the panel is the
    // canvas and the page owns the chrome. That is what buys the visualizer a
    // full-height canvas: every row of chrome it used to carry is now shared.
    const [showCost, setShowCost] = useState(false);
    // req #3225 — persisted (unlike showCost above) because the SAME toggle
    // also governs the plan list page's Cards/Table titles, a different page
    // component that must read the same choice on its own next mount rather
    // than default back to off. `useViewPreference`'s per-tab sessionStorage
    // is exactly that: this page writes it, the list page's own hook reads it
    // fresh when React Router mounts that page.
    //
    // ALWAYS ON (req #3242 user directive) — the toggle that used to gate this
    // is gone; requirement counts are now a permanent part of the plan name and
    // every epic band label, not a preference. No storage key, no setter: there
    // is nothing left to persist.
    const showReqCounts = true;
    // ── THE RETIRED VIEW PREFERENCES (no declaration follows — that is the
    //    point). The `Reqs:` and `Step:` preferences went with their controls
    //    (user directive 2026-08-01); the requirement LAYOUT stopped being a
    //    value at all with req #3498, because a card stacks its requirements top
    //    to bottom and there is no second arrangement left to name; and
    //    `darwin-pipeline-viz-step-width` went with the S/M/L control in the
    //    same pass, since every column is one card wide and a stored factor has
    //    nothing to scale. `stepLabel` and `reqLabel` are the two survivors and
    //    are declared as constants further down, beside the comment that
    //    explains what they are pinned TO.
    //
    //    None of the stored keys is read any more, and none is migrated: a value
    //    with no meaning has nothing to migrate to. They go stale in
    //    localStorage.
    // Req #3261 P4 — the title's type scale, the SAME query `ViewerHeader` owns
    // (`useMediaQuery('(max-width:899px)')`, i.e. MUI's `md` breakpoint minus
    // one). This page rendered `h6` unconditionally, which is the mobile size
    // shown on every desktop: a page title one step smaller than every other
    // page's, for no reason anybody recorded.
    const isMobile = useMediaQuery('(max-width:899px)');
    const [colorKeyPref, setColorKeyPref] = useViewPreference(
        'darwin-pipeline-viz-color-key', DEFAULT_COLOR_KEY);
    // req #3503 — "Step Width": four rungs, 1 the card every existing plan is
    // already sized for, 2-4 each 25% more text room. PERSISTED like every
    // other view preference — a reader who widens the card wants it wide next
    // time too — and, unlike Reset or the steps-across buttons, this ONE
    // relayouts the plan (every column, every card, every wrap point) rather
    // than just moving the camera, which is exactly why it is a deliberate,
    // explicit choice and never an automatic one.
    const [stepWidthLevelPref, setStepWidthLevelPref] = useViewPreference(
        'darwin-pipeline-viz-step-width', String(DEFAULT_STEP_WIDTH_LEVEL));
    // `Number.isFinite` on the LOOKED-UP SCALE, not a truthiness test on it
    // (review finding): correct today only because no rung is `0` or another
    // falsy-but-valid number — this says what is actually meant regardless.
    const stepWidthLevel = Number.isFinite(STEP_WIDTH_SCALES[Number(stepWidthLevelPref) - 1])
        ? Number(stepWidthLevelPref) : DEFAULT_STEP_WIDTH_LEVEL;
    // Req #3168 — the semantic-level selector, the Build Visualizer's control
    // (user directive: "show me the L1, L2, L3 and Auto selector used
    // elsewhere"). `auto` keeps the zoom-derived level; 1|2|3 pin one. Persisted
    // like every other view preference, and normalized the same way — the value
    // comes from localStorage.
    const [levelPref, setLevelPref] = useViewPreference(
        'darwin-pipeline-viz-level', DEFAULT_PLAN_LEVEL_PREF);
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
    // req #3498 — the steps-across buttons reach the canvas the same way Reset
    // does, and for the same reason: the control is in the page's header and the
    // camera is inside the panel. A NONCE rides alongside the number so clicking
    // the SAME button twice fires twice — after wheeling away from "8", asking
    // for "8" again must bring you back, and a bare value would be unchanged
    // state and do nothing.
    const [stepsAcross, setStepsAcross] = useState({ n: null, nonce: 0 });
    // The step label is always the TITLE, and the requirement marks always
    // reserve room for their TITLE — the renderer draws the id inside that box
    // at L1/L2 and the title itself at L3 (see the `idText` note in
    // pipelinePlanLayout.js). Reserving at every level is what keeps a zoom
    // change a pure transform instead of a relayout.
    const stepLabel = 'title';
    const reqLabel = 'title';
    // ── The colour key is EVERY REGISTERED SCALE PLUS NONE ──────────────────
    // req #3168 (user directive 2026-08-01), extended by req #3422 — the
    // positions are `REQ_COLOR_KEYS`, so this page never names them and a scale
    // added to the registry needs no edit here. `normalizeColorKey` is
    // `Object.hasOwn`-based because the value comes from localStorage, so
    // "constructor" is a reachable string that resolves to an inherited function,
    // and this one is handed to Konva as a text `fill`. A stored value written
    // before this change ('state' / 'machine') still normalizes to itself, so an
    // existing reader's plan opens exactly as it did.
    const colorKey = normalizeColorKey(colorKeyPref);

    // Req #3115 cross-mode handshake: a bead click in the Plan visualizer lands
    // the user on the SAME step in the table — the visualizer calls
    // onStepFocus(stepId), the page switches modes, and the table scrolls to and
    // highlights the row. The switch is a TRANSIENT override, never written to
    // the persisted preference: the user asked to inspect one step, not to make
    // Table their default everywhere (review finding). Picking a mode by hand
    // persists it as usual and clears both the override and the focus, so a
    // stale highlight never survives an unrelated visit to the table.
    // ── `?mode=` makes the SURFACE addressable, not just the page (req #3168) ──
    // Which panel this page shows is a persisted PREFERENCE, so the route alone
    // names a plan and not a view of it: `/swarm/pipeline/2` opens the Table for
    // anyone whose stored mode says Table, including every first-time visitor
    // (`DEFAULT_PIPELINE_DETAIL_MODE`). That makes the visualizer unlinkable —
    // there is no URL that reliably lands on it — which is a real gap for a dev
    // server deep link, a bug report, or a link pasted into a review.
    //
    // It seeds the SAME transient override the bead-click handshake uses, and for
    // the same reason: a link asks to see one thing once. It must not rewrite what
    // the user chose as their default (the `normalizeView` doctrine — never let an
    // external condition overwrite uncommitted user intent). Picking a mode by
    // hand clears the override, so the link is inert from that moment on even
    // though the query string is still in the address bar.
    const [searchParams] = useSearchParams();
    // Validated against the mode list, never trusted: an unknown `?mode=xyz` is a
    // typo, and falling through to `null` leaves the stored preference in charge
    // rather than selecting nothing in the toggle group.
    const requestedMode = searchParams.get('mode');
    const linkMode = PIPELINE_DETAIL_MODES.some(
        (m) => m.value === requestedMode && !m.disabled) ? requestedMode : null;
    // ── `?step=` makes ONE STEP addressable (req #3140) ──────────────────────
    // The receiving end of the Steps editor's row link, and the same handshake a
    // bead click already uses: seed `focusStepId`, and the table scrolls to and
    // highlights that row. `pipelineStepLink.js` owns both halves of the
    // contract so the writer and this reader cannot drift on the key.
    const linkStepId = readFocusStepParam(searchParams);
    // ── `?epic=` makes ONE EPIC'S LOCATION addressable (req #3235) ───────────
    // The receiving end of the requirement page's epic-box "view on plan" link.
    // An epic band only exists in the visualizer, so a named epic FORCES the
    // Plan mode the same way a named step forces the Table — but a `?step=`
    // is more specific than a `?epic=` (a step names one row; an epic is a
    // whole band a step already belongs to), so if a link somehow carried
    // both, the step wins. `pipelineEpicLink.js` owns both halves of this
    // contract, same split as the step link.
    const linkEpicId = readFocusEpicParam(searchParams);
    // ── `?level=` PINS THE SEMANTIC LEVEL FOR ONE LANDING (req #3253) ────────
    // The step-on-the-plan link carries `level=3` (req #3498 — it was `2`, and
    // the reason expired when the requirements moved INSIDE the card; the value
    // and the argument both live on `STEP_PLAN_LINK_LEVEL`, not here, so this
    // comment cannot drift from the link). Validated against the level
    // vocabulary and null on anything else, so an unrecognised value leaves the
    // reader's stored preference in charge rather than pinning them to 'auto'.
    const linkLevel = readLevelParam(searchParams);
    // A named step FORCES THE TABLE — unless the link explicitly asks for the
    // plan (req #3253).
    //
    // The original rule was unconditional, and its reason was that only the
    // table consumed `focusStepId`: the visualizer had beads, not rows, so
    // honouring `?mode=plan&step=7` landed the reader on a plan with nothing
    // highlighted and nothing to say why. Req #3253 gives the visualizer that
    // handshake — a named step centres and zooms the camera on its bead — so the
    // reason has gone and the rule with it. What survives is the DEFAULT: a
    // `?step=` with no `?mode=` (the Steps editor's row link, which does carry
    // `mode=table`, and any hand-typed URL) still means the row.
    const linkView = linkStepId != null
        ? (linkMode === 'plan' ? 'plan' : 'table')
        : (linkEpicId != null ? 'plan' : linkMode);

    const [focusStepId, setFocusStepId] = useState(linkStepId);
    // Req #3235 code review — `?epic=` needs the SAME transient-override
    // treatment as `?step=`, not the raw searchParams value passed straight
    // through: without a state copy, a manual mode pick can never clear it
    // (nothing owns it to clear), so picking Table then Plan again — or
    // navigating in-place from one `?epic=` link to another, which
    // `pipelineId`'s own comment below notes this component survives without
    // remounting — would keep re-focusing (or silently drop) a link the
    // reader already left behind.
    const [focusEpicId, setFocusEpicId] = useState(linkEpicId);
    // Req #3253 — the level a link asked for, held TRANSIENTLY beside the
    // persisted `levelPref` below and never written to it. Same doctrine as
    // `modeOverride`/`focusStepId`/`focusEpicId`, and same reason: a link asks to
    // see one thing once, so a reader who keeps L3 (or Auto) pinned still has it
    // the next time they open a plan by any other route.
    const [levelOverride, setLevelOverride] = useState(linkLevel);
    const [modeOverride, setModeOverride] = useState(linkView);
    // Re-seeds when the LINK changes — a new `?mode=`, a new `?step=`, a new
    // `?epic=`, or a different plan — and at no other time, so a manual pick
    // below is never resurrected by a re-render. A link with no `?step=`/
    // `?epic=` clears the focus, which is what keeps a stale highlight (or a
    // stale camera focus) from surviving an unrelated navigation.
    useEffect(() => {
        setModeOverride(linkView);
        setFocusStepId(linkStepId);
        setFocusEpicId(linkEpicId);
        setLevelOverride(linkLevel);
        // `era` sat in this list for the same reason it sat in the description
        // dialog's: an era switch at the same id reused this instance, and a
        // `?step=` focus from the other era's plan would have survived into
        // this one. There is no other era to switch from now.
    }, [linkView, linkStepId, linkEpicId, linkLevel, pipelineId]);
    const onStepFocus = useCallback((stepId) => {
        setFocusStepId(stepId);
        setModeOverride('table');
    }, []);
    const handleModeChange = useCallback((_e, v) => {
        if (v == null) return;
        setFocusStepId(null);
        setFocusEpicId(null);
        setLevelOverride(null);
        setModeOverride(null);
        setMode(v);
    }, [setMode]);
    // A manual LEVEL pick clears the link's level the same way a manual MODE pick
    // clears the link's mode — and persists the reader's choice as usual. The two
    // are separate handlers because they are separate controls; folding the level
    // clear into `handleModeChange` alone would leave a reader who picked L3 from
    // the toolbar snapped back to the link's L2 on the next re-render.
    const handleLevelPrefChange = useCallback((v) => {
        setLevelOverride(null);
        setLevelPref(v);
    }, [setLevelPref]);
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
    // Normalized ONCE here rather than at each consumer: `levelOverride` is
    // already validated by `readLevelParam` and `levelPref` comes from
    // localStorage, so this is the single place a level string is proved to be
    // one of the four the vocabulary defines.
    const activeLevelPref = normalizePlanLevelPref(levelOverride ?? storedLevelPref);
    const activeMode = normalizeView(modeOverride || mode, PIPELINE_DETAIL_MODES);

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
    // with the number of steps in the plan (this file's header invariant).
    //
    // Deliberately NOT in `isLoading`: it feeds an OPTIONAL chip whose absence
    // means "nobody is orchestrating this", which is also the right reading
    // while the read is in flight. Gating the plan on live process state would
    // make an unreachable ops table a blank plan page.
    const { data: orchestrationClaims = EMPTY } = useOrchestrationClaims(creatorFk);

    // Req #3117 — the Cost column, from TWO more bounded list reads. Deliberately
    // NOT in `isLoading` below: cost is not an ordering input (see the comment
    // there), so gating the whole plan on it would trade a correct-but-costless
    // first paint for a slower one. They also do not gate because they are
    // OPT-IN at the UI: the Cost column is hidden until the user asks for it.
    const { data: requirementSessions = EMPTY, isError: requirementSessionsError } =
        useAllRequirementSessions(creatorFk);
    const { data: sessionCosts = EMPTY, isError: sessionCostsError } =
        useAllSessionCostRollups(creatorFk);
    // A failed cost read must not render as a column of em-dashes — that is
    // indistinguishable from "this plan has no recorded cost", which is a claim
    // about the data rather than about the fetch. The table says which it is.
    const costError = requirementSessionsError || sessionCostsError;

    const costIndex = useMemo(
        () => buildCostIndex({ requirementSessions, sessionCosts }),
        [requirementSessions, sessionCosts]);

    // ── THE FETCH (req #3463, collapsed to one head by req #3356) ───────────
    // The four values below are all this page consumes. 1.0 joined seven reads
    // in the browser; 2.0 consumes ONE composed read that already did the
    // derivation server-side, and with 1.0 eradicated that head is the only one
    // left — so this calls it directly rather than through an era dispatcher.
    const {
        pipeline, model, plan, diagnostic, isLoading: planLoading,
        dictionaryError: planDictionaryError, knownIds,
    } = usePlanSources(pipelineId, creatorFk, { machines, costIndex });

    const isLoading = planLoading || machinesLoading;

    // `machines` is this page's own read — 2.0 carries no machines dictionary of
    // its own — so its failure is reported here rather than inside the head.
    const dictionaryError = planDictionaryError || machinesError;

    // req #3381 item 3 — a withheld or degraded `derived` block is a HARD STOP,
    // not an empty render.
    const canRenderPlan = !!pipeline && !diagnostic && !!plan;

    // req #3225 — the whole-plan met/total, read straight off the composed
    // read's own derivation. `plan` is null while a diagnostic is set, so this
    // is optional.
    const planReqCounts = plan?.requirementCounts?.overall;

    // req #3224 — the WHOLE-PLAN reservation. An epic-scoped one is a different
    // and weaker claim ("a slice of this plan is being orchestrated") and is the
    // epics page's answer, not this header's.
    //
    // req #3463 — WHICH COLUMN PAIR a claim carries WAS an era fact: a 2.0 claim
    // has `pipeline_fk`/`epic_fk` and NULL `pipeline_fk`, so asking the 1.0
    // lookup about a 2.0 plan matched nothing and vice versa. `claimForPipeline`
    // (the 1.0 half) went with req #3356; this reads the 2.0 columns directly.
    const orchestrationHolder = useMemo(
        () => holderView(claimForPipeline(orchestrationClaims, pipeline?.id), machines),
        [orchestrationClaims, pipeline?.id, machines]);

    // `planMachines` — the distinct machine set behind the header's machine chip
    // — was REMOVED with the rest of the dead code (req #3241). The chip itself
    // went on the 2026-08-01 directive; this memo outlived it, unread, still
    // walking every row and every row's machine labels on each plan change.
    // Unlike a dead import, it cost something.

    // ── req #3431 — THE READER IS HERE, SO THIS IS THE PLACE ────────────────
    // The single writer of the remembered place. Req #3311 wrote it from the
    // LIST page's click handler, which recorded a plan opened by clicking a card
    // and no other arrival: not a `?step=` deep link, not the sessions grid's
    // "view the plan", not the requirement page's epic box, not Back. Recording
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
    // does. Both chips are live-ops conditionals, so this is false on the
    // ordinary row and the row is byte-identical to one with no status slot.
    const hasStatusChips = pipeline.pipeline_status === 'paused'
        || !!orchestrationHolder;

    // req #3242 — epics represented in THIS plan (a requirement with no epic
    // is excluded by `requirementCounts` itself, so this is never inflated by
    // a "no epic" bucket).
    // `plan` is null while `diagnostic` is set (req #3381 item 3 — a
    // withheld/absent `derived` block is a hard stop, so there is no
    // requirement-counts derivation to read).
    const planEpicCount = plan?.requirementCounts?.byEpic?.length ?? 0;

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
    // "FP Pipeline - Agent Harness 4 Epics, 73/115 Requirements" — with nothing
    // saying where the plan's name ends and the statistics begin, and at 1600px
    // it was the STATISTIC that ellipsized, leaving a broken fraction ("73/115
    // …") as the last thing on the row. Splitting the two lets the eye take the
    // name in one jump and treat the counts as the annotation they are.
    //
    // STILL ONE INLINE FLOW, which is what the paragraph above requires: the
    // counts are a `<span>`, so `text-overflow: ellipsis` still clips one line
    // box. A second BLOCK is what would break it — do not turn this into a
    // Stack or a second Typography.
    const countsText = planReqCounts
        ? `${planEpicCount} Epic${planEpicCount === 1 ? '' : 's'}, `
            + `${planReqCounts.met}/${planReqCounts.total} `
            + `Requirement${planReqCounts.total === 1 ? '' : 's'}`
        : '';
    // The tooltip's value, and the accessible text, stay the WHOLE line — it is
    // the recovery path for a clip, so it has to carry everything that was on
    // the row whether or not the two halves are styled alike.
    const titleText = countsText ? `${pipeline.title} ${countsText}` : pipeline.title;

    // `minWidth: 0` is load-bearing, not tidiness (req #3119 polish pass). This
    // Box is an item of the `.app-layout` CSS grid, whose items default to
    // `min-width: auto` — "never shrink below your content". The plan table is
    // ~1640px of NOWRAP columns, so on the real 41-step plan this Box grew past
    // its grid track and took the WHOLE PAGE into horizontal scroll: measured
    // 187px of document overflow at 1680px wide and 427px at 1440px, dragging the
    // nav rail and header sideways with it. The TableContainer already carries
    // `overflow-x: auto` and `min-width: 0` and was never getting the chance to
    // use them — it cannot scroll content that its own ancestor widened to fit.
    // One property restores what PipelinePlanTable's GroupCell comment already
    // claims happens ("The TableContainer scrolls instead"), and it is scoped to
    // this page: nothing else reads it.
    return (
        <Box sx={{ p: 3, minWidth: 0 }} data-testid="pipeline-detail">
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
                band scroll — with the plan's name still on its tooltip. What no
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
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'nowrap',
                        minWidth: 0, overflowX: 'auto', mb: 1 }}
                 data-testid="pipeline-header-row">
                <ToggleButtonGroup
                    value={activeMode}
                    exclusive
                    onChange={handleModeChange}
                    size="small"
                    sx={{ flexShrink: 0 }}
                    data-testid="pipeline-detail-mode-toggle"
                >
                    {PIPELINE_DETAIL_MODES.map(({ value, label, icon: Icon, disabled }) => (
                        <Tooltip key={value} title={`${label} View`}>
                            {/* Explicit aria-label (req #3281 code review): MUI
                                never opens a Tooltip on a disabled child
                                (disabled buttons are `pointer-events: none`),
                                so a future `disabled` mode (V1) would get the
                                Tooltip's injected name only when it can least
                                afford to lose it. Setting it directly makes
                                the accessible name independent of whether the
                                Tooltip can ever open. */}
                            <ToggleButton value={value} disabled={disabled}
                                          aria-label={`${label} View`}
                                          className="cal-toggle-btn" sx={{ px: 1.5 }}
                                          data-testid={`pipeline-mode-${value}`}>
                                <Icon fontSize="small" />
                            </ToggleButton>
                        </Tooltip>
                    ))}
                </ToggleButtonGroup>

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
                    `TITLE_MIN_W` keeps a hoverable stub on the row at every
                    width; the controls scroll in the band S13 built for exactly
                    this, which is the trade S13 already chose over page
                    overflow. It does not weaken S11 — the title is still the
                    spacer and still takes every pixel of slack first. */}
                <Tooltip title={titleText}>
                    <Typography variant={isMobile ? 'h6' : 'h5'} noWrap
                                sx={{ flex: 1, minWidth: TITLE_MIN_W }}
                                data-testid="pipeline-title">
                        {pipeline.title}
                        {/* A REAL SPACE, not just the margin below (measured —
                            the first cut had only the margin and the row's
                            `textContent` read "…Agent Harness4 Epics, 73/115…").
                            The margin is what the eye sees; this is what a
                            COPY-PASTE carries, and the two must not disagree.
                            NOT an accessibility fix: MUI's Tooltip defaults to
                            `describeChild={false}`, so it puts `titleText` on
                            the child as an `aria-label`, and an aria-label
                            OVERRIDES descendant text as the accessible name —
                            a reader is announced the tooltip's string either
                            way. Claiming otherwise here would be citing a
                            benefit this line does not deliver. */}
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
                </Tooltip>

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

                {activeMode === 'table' ? (
                    <Tooltip title="Show each step's elapsed time and token cost">
                        <Chip
                            label="Time / Tokens"
                            // WCAG 2.5.3 — MUI's Tooltip injects its title as
                            // the child's `aria-label` unless the child sets
                            // one, so this chip would display "Time / Tokens"
                            // and announce a sentence that never says it. MUI
                            // spreads the child's props LAST, so this one wins.
                            aria-label={'Time / Tokens — show each step\'s '
                                + 'elapsed time and token cost'}
                            onClick={() => setShowCost((v) => !v)}
                            // `aria-pressed` (req #3261 P5, S7): this was one of
                            // the two toggles on the row that carried their
                            // state in the variant alone, so a screen reader was
                            // told there was a button called "Time / Tokens" and
                            // never told whether it was on. (The other was
                            // Counts, which req #3242 removed.)
                            {...toolbarChipProps(showCost, { sx: { flexShrink: 0 } })}
                            data-testid="pipeline-cost-toggle"
                        />
                    </Tooltip>
                ) : (
                    <PipelinePlanToolbar
                        onStepsAcross={(n) => setStepsAcross(
                            (prev) => ({ n, nonce: prev.nonce + 1 }))}
                        stepWidthLevel={stepWidthLevel}
                        onChangeStepWidthLevel={setStepWidthLevelPref}
                        colorKey={colorKey}
                        onChangeColorKey={setColorKeyPref}
                        planLevelPref={activeLevelPref}
                        effectiveLevel={effectiveLevel}
                        onChangeLevelPref={handleLevelPrefChange}
                        onResetView={handleResetView}
                    />
                )}

                {/* The status chip and the machine chip were REMOVED on the
                    user's directive (2026-08-01). Plan status is already on the
                    Pipelines list this page is reached from, and the machine
                    spread is on every step's hover card; on the title row they
                    were two more things between the plan's name and the reader.
                    Snap (req #3503) and the description button (req #3503) are
                    both gone too — this row's own last child now is whichever
                    of Time/Tokens or PipelinePlanToolbar the active mode drew. */}

                {/* ── STATUS GROUP (req #3261 P2) ─────────────────────────────
                    CONDITIONAL ON ITS OWN CONTENTS, not rendered unconditionally
                    like the two dividers around it: both chips below appear only
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
                    reason the orchestration-holder chip below does: it is
                    CONDITIONAL (renders only while actually paused, so the
                    ordinary row is unchanged) and it is not a duplicate of the
                    list page's chip — a reader who navigated straight here
                    (a deep link, a bookmark) never saw that page at all. */}
                {pipeline?.pipeline_status === 'paused' && (
                    <Tooltip title="This plan is paused — its steps are not swarm-starting">
                        <Chip
                            size="small"
                            label="Paused"
                            {...pipelineStatusChipProps('paused')}
                            sx={{ ...pipelineStatusChipProps('paused').sx, flexShrink: 0 }}
                            data-testid="pipeline-detail-paused"
                        />
                    </Tooltip>
                )}
                {/* req #3224 — WHO is orchestrating this plan, from WHERE.
                    Deliberately kept despite the directive above, and the reason
                    it does not reoffend is that it is CONDITIONAL: it renders
                    only while a reservation is actually held, so the ordinary
                    row is byte-identical to today's. It is also not a duplicate
                    of anything — the status chip was removed because the list
                    page already carried it, while this fact appears nowhere else
                    on this page and is exactly what a user opening a plan
                    somebody else is running needs to see first. */}
                {orchestrationHolder && (
                    <Tooltip title={orchestrationHolder.title}>
                        <Chip
                            size="small"
                            color={orchestrationHolder.stale ? 'warning' : 'success'}
                            variant={orchestrationHolder.stale ? 'outlined' : 'filled'}
                            label={`Orchestrated by ${orchestrationHolder.label}`}
                            // ELASTIC, unlike every other occupant of this row
                            // (req #3241 review finding). It was `flexShrink: 0`
                            // like the controls, but it is not a control — it is
                            // ~158px of PROSE that appears only while somebody
                            // holds a reservation, and as a rigid member it
                            // raised the row's incompressible width by that much
                            // exactly when it happened to be showing. That put
                            // the page into horizontal scroll on a 1152px window
                            // for one plan and not another, which is the worst
                            // version of a layout bug: intermittent and tied to
                            // live ops state. MUI's own Chip label already
                            // ellipsizes, and the machine's full identity is on
                            // the tooltip, so shrinking it loses nothing the
                            // reader cannot get back.
                            //
                            // The page-scroll half of that is gone since req
                            // #3261 (the row scrolls its own band now), but
                            // shrinking is still the right behaviour for the
                            // same reason it always was: SCROLLING PAST prose a
                            // reader has already read to reach a control is a
                            // worse trade than ellipsizing it, and the tooltip
                            // is the recovery path either way.
                            sx={{ flexShrink: 1, minWidth: 0 }}
                            data-testid="pipeline-detail-holder"
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
                             focusStepId={focusStepId} onStepFocus={onStepFocus}
                             focusEpicId={focusEpicId}
                             costError={!!costError}
                             showCost={showCost}
                             showReqCounts={showReqCounts}
                             stepLabel={stepLabel} colorKey={colorKey}
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
                             stepsAcross={stepsAcross}
                             stepWidthLevel={stepWidthLevel}
                             />
            )}
        </Box>
    );
}
