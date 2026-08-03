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
import { useQueryClient } from '@tanstack/react-query';

import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
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
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';

import call_rest_api from '../../RestApi/RestApi';
import { useSnackBarStore } from '../../stores/useSnackBarStore';
import { pipelineKeys } from '../../hooks/useQueryKeys';
import AppContext from '../../Context/AppContext';
import AuthContext from '../../Context/AuthContext';
import '../../CalendarFC/CalendarFC.css';
import {
    ALL_ROWS,
    useAllEpics,
    useAllFeatures,
    useAllPipelineStepDeps,
    useAllPipelineStepRequirements,
    useAllPipelineSteps,
    useAllPipelines,
    useAllRequirementSessions,
    useAllRequirements,
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
import { readFocusStepParam, readLevelParam } from './pipelineStepLink';
import { readFocusEpicParam } from './pipelineEpicLink';
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
    DEFAULT_COLOR_KEY, DEFAULT_PLAN_LEVEL_PREF, DEFAULT_STEP_WIDTH,
    isStepWidth, normalizeColorKey, normalizePlanLevelPref,
} from './pipelinePlanLayout';
import {
    PLAN_REQUIREMENT_FIELDS,
    buildCostIndex,
    buildPipelineModel,
    orderedPlan,
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

// ── Editable pipeline description (req #3119, moved req #3179) ──────────────
// The plan's goal text is the one field on this page a human authors, and it was
// read-only prose. It is the house edit-in-place field: an outlined TextField
// whose notched "Description" label sits on the top-left border, saved on blur,
// exactly like the requirement description.
//
// SINCE REQ #3179 IT LIVES IN A DIALOG behind an info button at the right end of
// the header row — the Telemetry page's Glossary affordance (ContextPage.jsx).
// Inline, it was prose the reader had already read charging the plan 40–110px of
// viewport on every visit, in BOTH modes. The visualizer measures its own top
// (see PipelinePlanVisualizer's `availH`), so every pixel this stops occupying
// becomes canvas. The dialog is also the better AUTHORING surface: the inline
// field capped at four rows and scrolled a long goal internally.
//
// Local draft + save-on-blur rather than a controlled write per keystroke: the
// query cache is the source of truth and re-rendering the whole plan on every
// character would re-run the ordering engine.
//
// The draft ADOPTS a server value that arrives or changes later, but only while
// the field is clean. Seeding state once at mount is the standard version of
// this component and it has a data-loss shape: if the row is rendered before its
// description is in hand, the draft is '' forever, and the next edit-and-blur
// writes that '' over real text. `savedRef` doubles as the clean/dirty marker —
// equal to `draft` means untouched since the last known-good value.
//
// The component stays MOUNTED while the dialog is shut (only MUI's <Dialog>
// children unmount), so `draft` and `savedRef` survive a close — which is what
// lets the close handler save text the field never got to blur on.
function PipelineDescriptionDialog({ pipeline, open, onClose }) {
    const { idToken, profile } = useContext(AuthContext);
    const { darwinUri } = useContext(AppContext);
    const queryClient = useQueryClient();
    const showError = useSnackBarStore((s) => s.showError);
    const incoming = pipeline.description || '';
    const [draft, setDraft] = useState(incoming);
    const savedRef = useRef(incoming);
    // The value currently on the wire, if any. Two exits can fire in one gesture
    // (blur then click), and since req #3179's fix below `savedRef` no longer
    // advances until the server answers — so without this the second exit would
    // re-send the same text while the first was still in flight.
    const inFlightRef = useRef(null);

    useEffect(() => {
        if (incoming === savedRef.current) return;   // nothing new from the server
        if (draft !== savedRef.current) return;      // user is mid-edit — never clobber
        savedRef.current = incoming;
        setDraft(incoming);
    }, [incoming, draft]);

    // `savedRef` advances ONLY on a confirmed write (req #3179 review). Marking
    // it saved optimistically made a failed PUT unrecoverable AND silent: the
    // next blur saw `value === savedRef` and wrote nothing, so the user could not
    // retry, and the next refetch delivered the old server text into a field the
    // adoption effect above considered clean — quietly reverting the edit. Both
    // were survivable while the field was on the page; behind a button the
    // reversion happens off-screen, with nothing on the page to notice it by.
    //
    // Leaving `savedRef` at the last CONFIRMED value on failure is what makes the
    // retry work: `draft !== savedRef` keeps the adoption effect off (it reads as
    // mid-edit, which is exactly right — the text is unsaved), and the next blur
    // or close re-sends.
    //
    // THE COMPARISON IS AGAINST `inFlightRef ?? savedRef`, and getting that wrong
    // costs an edit (review follow-up). Once `savedRef` lags the wire rather than
    // leading it, a bare `value === savedRef` no longer means "already saved" —
    // it means "matches what the server had BEFORE the write now in flight". Undo
    // an edit while its PUT is outstanding (type NEW, blur, Ctrl+Z back to OLD,
    // Close) and that guard reads OLD === OLD and sends nothing, so NEW lands and
    // the user's actual final text never does. The value at or heading to the
    // server is what a save has to be new against.
    //
    // `??` and not `||`: '' is a legitimate in-flight value — the user clearing
    // the description — and `||` would fall through to `savedRef` and re-send it.
    const save = () => {
        const value = draft;
        // Already saved, or already on the wire — either way, nothing to send.
        if (value === (inFlightRef.current ?? savedRef.current)) return;
        inFlightRef.current = value;
        call_rest_api(`${darwinUri}/pipelines`, 'PUT',
            [{ id: pipeline.id, description: value }], idToken)
            .then((result) => {
                const code = result?.httpStatus?.httpStatus;
                if (code !== 200 && code !== 204) {
                    showError(result, 'Unable to update the pipeline description');
                } else {
                    savedRef.current = value;
                    queryClient.invalidateQueries({
                        queryKey: pipelineKeys.all(profile?.userName) });
                }
            })
            .catch((error) => showError(error, 'Unable to update the pipeline description'))
            // `call_rest_api` is `async`, so this exists on every path — including
            // the transport failure, which RESOLVES with a synthetic 503 rather
            // than throwing (every real non-2xx status throws and lands in the
            // catch above). The one state that leaks is a promise that never
            // settles: no timeout is set, so a hung connection pins this string
            // for the component's life. Bounded and recoverable — `savedRef` is
            // unadvanced too, so the text is never reverted, and only re-sending
            // that EXACT string is blocked; any further edit saves normally.
            .finally(() => {
                if (inFlightRef.current === value) inFlightRef.current = null;
            });
    };

    // Every exit from the dialog saves: the Close button, the backdrop, and
    // Escape all land here. Without it, closing by backdrop/Escape unmounts the
    // field without ever blurring it and the edit is silently lost. `save()` is
    // idempotent against `savedRef`, so the blur-then-click path writes once.
    const closeAndSave = () => {
        save();
        onClose();
    };

    return (
        <Dialog
            open={open}
            onClose={closeAndSave}
            maxWidth="md"
            fullWidth
            disableScrollLock
            data-testid="pipeline-description-dialog"
        >
            <DialogTitle>Description — {pipeline.title}</DialogTitle>
            <DialogContent dividers>
                <TextField
                    label="Description"
                    variant="outlined"
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onBlur={save}
                    fullWidth
                    multiline
                    // The dialog is the authoring surface the inline field could
                    // not be: 8 rows before it scrolls instead of 4, and no
                    // upper bound short of the dialog's own max height.
                    minRows={8}
                    maxRows={24}
                    autoComplete="off"
                    autoFocus
                    sx={{ mt: 1 }}
                    data-testid="pipeline-goal"
                />
            </DialogContent>
            <DialogActions>
                <Button onClick={closeAndSave} variant="outlined">Close</Button>
            </DialogActions>
        </Dialog>
    );
}

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
    // Req #3179 — the goal text is behind the header's info button now. Shut it
    // when the route changes plans: this component is re-rendered, not remounted,
    // on an :id change, so an open dialog would otherwise stay open and re-title
    // itself to a plan the user never asked to edit.
    const [descriptionOpen, setDescriptionOpen] = useState(false);
    useEffect(() => { setDescriptionOpen(false); }, [pipelineId]);
    // Defaults vertical + title (user directive 2026-07-31); a persisted
    // preference still wins — useViewPreference only falls back to these.
    //
    // The `Reqs:` and `Step:` PREFERENCES went with their controls (user
    // directive 2026-08-01). Requirement marks are always the vertical stack and
    // the step label is always the title, so these are constants now — declared
    // here, once, rather than threaded as literals through the render.
    //
    // The stored keys are deliberately NOT read any more: a reader who had
    // `horizontal` pinned gets the vertical stack like everyone else, which is
    // the point of removing the choice. Nothing writes them, so they simply go
    // stale in localStorage.
    const reqLayout = 'vertical';
    // Req #3261 P4 — the title's type scale, the SAME query `ViewerHeader` owns
    // (`useMediaQuery('(max-width:899px)')`, i.e. MUI's `md` breakpoint minus
    // one). This page rendered `h6` unconditionally, which is the mobile size
    // shown on every desktop: a page title one step smaller than every other
    // page's, for no reason anybody recorded.
    const isMobile = useMediaQuery('(max-width:899px)');
    const [colorKeyPref, setColorKeyPref] = useViewPreference(
        'darwin-pipeline-viz-color-key', DEFAULT_COLOR_KEY);
    // Req #3168 — the user's own control over column width. Defaults to
    // `compact`, which is the identity factor: an existing reader's plan is
    // pixel-for-pixel what it was until they ask for something wider.
    const [stepWidthPref, setStepWidthPref] = useViewPreference(
        'darwin-pipeline-viz-step-width', DEFAULT_STEP_WIDTH);
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
    const handleResetView = useCallback(() => setResetViewNonce((n) => n + 1), []);
    // The step label is always the TITLE, and the requirement marks always
    // reserve room for their TITLE — the renderer draws the id inside that box
    // at L1/L2 and the title itself at L3 (see the `idText` note in
    // pipelinePlanLayout.js). Reserving at every level is what keeps a zoom
    // change a pure transform instead of a relayout.
    const stepLabel = 'title';
    const reqLabel = 'title';
    // ── The colour key is TRI-STATE (req #3168, user directive 2026-08-01) ──
    // `state` · `machine` · `none`. `normalizeColorKey` is `Object.hasOwn`-based
    // for the same reason `isStepWidth` is: the value comes from localStorage, so
    // "constructor" is a reachable string that resolves to an inherited function,
    // and this one is handed to Konva as a text `fill`. A stored value written
    // before this change ('state' / 'machine') still normalizes to itself, so an
    // existing reader's plan opens exactly as it did.
    const colorKey = normalizeColorKey(colorKeyPref);
    // `isStepWidth`, not a truthiness lookup: this value comes from
    // localStorage, so `"constructor"` is a reachable string and it resolves to
    // an inherited function — truthy, and a factor that turns every column width
    // into NaN and the canvas blank with no error to see.
    const stepWidth = isStepWidth(stepWidthPref) ? stepWidthPref : DEFAULT_STEP_WIDTH;

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
    // The step-on-the-plan link carries `level=2`, because a one-step fit lands
    // well past `SEMANTIC_IN_MIN` and the canvas would otherwise auto-derive L3
    // and draw every requirement TITLE — a wall of prose at exactly the moment
    // the reader wanted to find one bead. Validated against the level vocabulary
    // and null on anything else, so an unrecognised value leaves the reader's
    // stored preference in charge rather than pinning them to 'auto'.
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
    // Normalized ONCE here rather than at each consumer: `levelOverride` is
    // already validated by `readLevelParam` and `levelPref` comes from
    // localStorage, so this is the single place a level string is proved to be
    // one of the four the vocabulary defines.
    const activeLevelPref = normalizePlanLevelPref(levelOverride ?? storedLevelPref);
    const activeMode = normalizeView(modeOverride || mode, PIPELINE_DETAIL_MODES);

    // The list read, not a by-id read: /swarm/pipelines has already primed this
    // exact cache entry, so arriving here costs nothing. A by-id hook would be a
    // second cache entry and a guaranteed fetch on every navigation.
    const { data: pipelines = [], isLoading: pipelinesLoading } = useAllPipelines(creatorFk);
    const { data: steps = [], isLoading: stepsLoading } = useAllPipelineSteps(creatorFk);
    const { data: stepRequirements = [], isLoading: linksLoading } =
        useAllPipelineStepRequirements(creatorFk);
    const { data: stepDeps = [], isLoading: depsLoading } = useAllPipelineStepDeps(creatorFk);
    const { data: requirements = [], isLoading: reqsLoading } =
        useAllRequirements(creatorFk, { fields: PLAN_REQUIREMENT_FIELDS });
    // Labels are a DICTIONARY here, not a catalog: closed epics/features must
    // still resolve or the plan blanks a column it has data for.
    const { data: features = [], isLoading: featuresLoading, isError: featuresError } =
        useAllFeatures(creatorFk, { closed: ALL_ROWS });
    const { data: epics = [], isLoading: epicsLoading, isError: epicsError } =
        useAllEpics(creatorFk);
    const { data: machines = [], isLoading: machinesLoading, isError: machinesError } =
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

    // EVERY read gates the render, the three label dictionaries included. They are
    // not decoration: `displayOrder()` breaks ties on epic first-appearance order,
    // so rendering before features/epics resolve produces a DIFFERENT, silently
    // wrong row order — and one that verifyOrder() accepts, because a plan with no
    // epics violates no invariant. The one failure mode design rule 3's self-check
    // cannot catch is the one where the inputs, not the algorithm, are wrong.
    const isLoading = pipelinesLoading || stepsLoading || linksLoading
        || depsLoading || reqsLoading || featuresLoading || epicsLoading || machinesLoading;

    // Same argument, one step further: `fetchEntity` turns a 404 into `[]` and a
    // 5xx leaves `data` undefined, so a FAILED dictionary read is indistinguishable
    // from an empty one and would ship that wrong order permanently, with blank
    // Epic/Feature columns and numeric machine ids as its only symptoms. Say so.
    const dictionaryError = featuresError || epicsError || machinesError;

    const pipeline = useMemo(
        () => pipelines.find((p) => p.id === pipelineId) || null,
        [pipelines, pipelineId]);

    const model = useMemo(() => buildPipelineModel({
        pipeline, steps, stepRequirements, stepDeps, requirements, features, epics, machines,
    }), [pipeline, steps, stepRequirements, stepDeps, requirements, features, epics, machines]);

    const costIndex = useMemo(
        () => buildCostIndex({ requirementSessions, sessionCosts }),
        [requirementSessions, sessionCosts]);

    // `now` is read ONCE per model change and handed to the engine, which never
    // reads a clock itself. Time-gate eligibility therefore re-evaluates when the
    // data does — on focus, on invalidation — rather than on a timer.
    const plan = useMemo(
        () => orderedPlan(model, { now: new Date(), costIndex }),
        [model, costIndex]);
    // req #3225 — the whole-plan met/total, read straight off `orderedPlan`'s
    // own derivation (no second pass over `model`).
    const planReqCounts = plan.requirementCounts?.overall;

    // req #3224 — the WHOLE-PLAN reservation. An epic-scoped one is a different
    // and weaker claim ("a slice of this plan is being orchestrated") and is the
    // epics page's answer, not this header's.
    const orchestrationHolder = useMemo(
        () => holderView(claimForPipeline(orchestrationClaims, pipeline?.id), machines),
        [orchestrationClaims, pipeline?.id, machines]);

    // `planMachines` — the distinct machine set behind the header's machine chip
    // — was REMOVED with the rest of the dead code (req #3241). The chip itself
    // went on the 2026-08-01 directive; this memo outlived it, unread, still
    // walking every row and every row's machine labels on each plan change.
    // Unlike a dead import, it cost something.

    if (isLoading) {
        return (
            <Box sx={{ display: 'flex', justifyContent: 'center', mt: 4 }}>
                <CircularProgress />
            </Box>
        );
    }

    if (!pipeline) {
        return (
            <Box sx={{ p: 3 }}>
                <Alert severity="warning" data-testid="pipeline-not-found">
                    No pipeline with id {pipelineId}.{' '}
                    <Link component="button" variant="body2"
                          onClick={() => navigate('/swarm/pipelines')}>
                        Back to pipelines
                    </Link>
                </Alert>
            </Box>
        );
    }

    const ActiveComponent = (findPipelineDetailMode(activeMode)
        || PIPELINE_DETAIL_MODES[0]).Component;

    // Whitespace-only prose is not a description — a goal of three newlines
    // would otherwise light the header button up as though the plan were
    // documented.
    const hasDescription = !!(pipeline.description || '').trim();
    const descriptionLabel = hasDescription
        ? 'Description — the plan\'s goal'
        : 'Description — none yet; click to write one';

    // req #3261 P2 — the status group's separator renders only when the group
    // does. Both chips are live-ops conditionals, so this is false on the
    // ordinary row and the row is byte-identical to one with no status slot.
    const hasStatusChips = pipeline.pipeline_status === 'paused'
        || !!orchestrationHolder;

    // req #3242 — epics represented in THIS plan (a requirement with no epic
    // is excluded by `requirementCounts` itself, so this is never inflated by
    // a "no epic" bucket).
    const planEpicCount = plan.requirementCounts?.byEpic?.length ?? 0;

    // ── ONE STRING PER ELLIPSIZING LINE ──────────────────────────────────────
    // `noWrap` with a tooltip needs the whole text as a VALUE: CSS
    // `text-overflow` needs a single inline flow to clip, and a tooltip that is
    // the recovery path for a clip has to carry exactly what was clipped.
    const titleText = pipeline.title + (planReqCounts
        ? ` ${planEpicCount} Epic${planEpicCount === 1 ? '' : 's'}, `
            + `${planReqCounts.met}/${planReqCounts.total} `
            + `Requirement${planReqCounts.total === 1 ? '' : 's'}`
        : '');

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

                    `minWidth: 0` is what actually lets it give: a flex item's
                    default `min-width: auto` means "never below your content",
                    and `noWrap` alone would then widen the row instead of
                    ellipsizing inside it. */}
                <Tooltip title={titleText}>
                    <Typography variant={isMobile ? 'h6' : 'h5'} noWrap
                                sx={{ flex: 1, minWidth: 0 }}
                                data-testid="pipeline-title">
                        {titleText}
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
                        stepWidth={stepWidth}
                        onChangeStepWidth={setStepWidthPref}
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
                    The description button is what remains, and it is last. */}

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
                            sx={{ flexShrink: 0 }}
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

                <Divider orientation="vertical" flexItem
                         sx={{ mx: 0.5, flexShrink: 0 }} />

                {/* Req #3179 — the description, at the RIGHT END of the row,
                    exactly where the Telemetry page keeps its Glossary
                    (ContextPage.jsx). It reports whether there is anything
                    behind it: filled when the plan has a goal, outlined when it
                    does not, so an empty description is visible without opening
                    the dialog and the control never reads as a dead one.

                    A CHIP LIKE EVERYTHING ELSE (req #3261 P1, S6). It was the
                    row's sixth widget vocabulary as a lone `IconButton`, and the
                    Build Visualizer's own dialog-opener — "Merge Rules" — is
                    exactly this: a chip that carries a label. The icon stays as
                    the chip's `icon`, so the affordance a reader already knows
                    is unchanged and it gains the word it never had.

                    `pressed: false`: the fill answers "is there prose behind
                    this", a fact about the PLAN, not a state the button is held
                    in. `aria-pressed` here would tell a screen reader the control
                    has an on position, which is exactly what it does not. */}
                <Tooltip title={descriptionLabel}>
                    <Chip
                        icon={<InfoOutlinedIcon fontSize="small" />}
                        label="Description"
                        onClick={() => setDescriptionOpen(true)}
                        // The SAME string the tooltip carries, because the
                        // outlined chip is the only other place "there is
                        // nothing behind this button" is said and a screen
                        // reader cannot see it. MUI's Tooltip spreads the
                        // child's own props last, so an aria-label here wins
                        // over the one it would inject.
                        aria-label={descriptionLabel}
                        {...toolbarChipProps(hasDescription, {
                            pressed: false,
                            sx: {
                                flexShrink: 0,
                                // MUI gives `.MuiChip-icon` its own colour
                                // (`grey[700]` / `grey[300]` by theme mode —
                                // Chip.js's `iconColor === color` variant),
                                // which does NOT follow the root's — so on the
                                // filled chip the icon would stay dark grey on
                                // the primary fill. `inherit` is what makes the
                                // two states read as one control changing,
                                // rather than a chip whose icon failed to
                                // change with it.
                                '& .MuiChip-icon': { color: 'inherit' },
                            },
                        })}
                        data-testid="pipeline-description-btn"
                    />
                </Tooltip>
            </Box>

            {/* A MUI Dialog is a portal — it renders into document.body and
                contributes NO box to this column at any time, open or shut. It
                therefore costs the plan nothing here and does not disturb the
                "canvas is the last child" invariant asserted below.
                `disableScrollLock`: MUI's scroll lock pads `document.body` by the
                scrollbar width when the body overflows, which would narrow this
                grid column, change the canvas's measured width and re-fit the
                plan behind the dialog — and again on close.

                `key={pipeline.id}` is a DATA-SAFETY guard, not a re-render hint
                (req #3179 review). React Router re-renders this page on an :id
                change rather than remounting it, and every list query is already
                warm, so `isLoading` never flips and nothing below remounts on its
                own. Without the key, a draft typed against plan B survives a
                back-navigation to plan A — the adoption effect reads it as
                mid-edit and refuses to touch it, exactly as designed — and the
                next close writes B's text over A's description.

                The keyed remount runs no save, so an unsaved draft is DISCARDED
                on a plan switch rather than written to the wrong plan. That is
                the deliberate trade and it matches what the inline field did on
                unmount; saving it instead is possible (the unmounting instance
                still holds B's `pipeline` prop) but would make a navigation
                commit text the user never confirmed. */}
            <PipelineDescriptionDialog key={pipeline.id} pipeline={pipeline}
                                       open={descriptionOpen}
                                       onClose={() => setDescriptionOpen(false)} />

            {dictionaryError && (
                <Alert severity="error" variant="outlined" sx={{ mb: 2 }}
                       data-testid="pipeline-dictionary-error">
                    The epic, feature or machine list failed to load. Epic and Feature
                    columns will be blank, machines will read as bare ids, and the ROW
                    ORDER is computed with those labels missing — it is not the plan&apos;s
                    real order. Reload before acting on this page.
                </Alert>
            )}

            {/* MUST stay the last child (req #3156): PipelinePlanVisualizer's
                canvas cancels this Box's `p: 3` on its own sides/bottom via a
                negative margin, which relies on being the last thing in flow
                — anything rendered after it here would overlap the canvas by
                24px instead of leaving a gap. */}
            <ActiveComponent plan={plan} model={model} pipeline={pipeline} timezone={timezone}
                             focusStepId={focusStepId} onStepFocus={onStepFocus}
                             focusEpicId={focusEpicId}
                             costError={!!costError}
                             showCost={showCost}
                             showReqCounts={showReqCounts}
                             reqLayout={reqLayout} stepLabel={stepLabel} colorKey={colorKey}
                             stepWidth={stepWidth} reqLabel={reqLabel}
                             // `levelPref` still travels IN — the canvas needs to
                             // know which level is pinned to draw it. Only the
                             // SETTER left (req #3241): the control that called
                             // it is on this page's own header now, so the panel
                             // no longer changes the preference, it only reports
                             // the level it settled on via `onEffectiveLevel`.
                             levelPref={activeLevelPref}
                             onEffectiveLevel={setEffectiveLevel}
                             resetViewNonce={resetViewNonce}
                             />
        </Box>
    );
}
