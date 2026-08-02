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
import Breadcrumbs from '@mui/material/Breadcrumbs';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import IconButton from '@mui/material/IconButton';
import Link from '@mui/material/Link';
import TextField from '@mui/material/TextField';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
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
import { formatDateTime } from '../../utils/dateFormat';
import {
    PIPELINE_DETAIL_MODES,
    PIPELINE_DETAIL_MODE_STORAGE_KEY,
    DEFAULT_PIPELINE_DETAIL_MODE,
    findPipelineDetailMode,
} from './pipelineDetailModes';
import { pipelineStatusChipProps } from './pipelineChipStyles';
import { claimForPipeline, holderView } from './orchestrationHolder';
import { readFocusStepParam } from './pipelineStepLink';
import { readFocusEpicParam } from './pipelineEpicLink';
import SemanticLevelControl from '../../Components/SemanticLevelControl';
// Trimmed to what this file actually renders (req #3241). `DEFAULT_REQ_VIEW`,
// `REQ_VIEWS`, `normalizeReqView`, `reqViewOptions` and `machineTitle` outlived
// the `Reqs:`/`Step:` controls and the status/machine chips that the 2026-08-01
// directives removed, and `PLAN_LEVEL_NUMBER` + `SemanticLevelControl` were
// imported for a move that was started and abandoned. There is no eslint in this
// package, so nothing flagged any of them — the dead `SemanticLevelControl`
// import was the visible trace this requirement was filed from.
import {
    DEFAULT_COLOR_KEY, DEFAULT_PLAN_LEVEL_PREF, DEFAULT_STEP_WIDTH,
    PLAN_LEVEL_NUMBER, isStepWidth, normalizeColorKey, normalizePlanLevelPref,
} from './pipelinePlanLayout';
import {
    DEFAULT_REQ_COUNTS,
    PLAN_REQUIREMENT_FIELDS,
    REQ_COUNTS_STORAGE_KEY,
    buildCostIndex,
    buildPipelineModel,
    orderedPlan,
    pipelineSummary,
} from './pipelineViewModel';

// A SHARED frozen empty array for the `data = EMPTY` defaults below. A `= []`
// literal mints a NEW array on every render while `data` is undefined — which is
// exactly the state a failed or in-flight read sits in — and that changing
// identity permanently defeats every useMemo downstream of it: costIndex, plan
// (so `new Date()` is re-read on every render, contradicting the "now is read
// ONCE per model change" contract below), pipelineSummary, and the table's own
// planRenderRows. One stable reference costs nothing and keeps the memo chain
// honest in the error path the costError branch exists to handle.
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
    // ON BY DEFAULT since req #3241, from the ONE shared key/default pair the
    // list page also reads. It shipped off on a header-width argument; this
    // requirement solved the header width directly (the row is `nowrap` with
    // the title as its elastic member) and the argument never touched the epic
    // band labels, which are drawn on the canvas.
    const [showReqCountsPref, setShowReqCountsPref] = useViewPreference(
        REQ_COUNTS_STORAGE_KEY, DEFAULT_REQ_COUNTS);
    const showReqCounts = showReqCountsPref === 'on';
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
    const planLevelPref = normalizePlanLevelPref(levelPref);
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
    // A named step FORCES the table, overriding `?mode=` when the two disagree.
    // Only the table consumes `focusStepId` — the visualizer has beads, not rows,
    // and ignores the prop entirely — so honoring `?mode=plan&step=7` as written
    // would land the reader on a plan with nothing highlighted and nothing to say
    // why. Naming a row is the more specific request, so it wins.
    const linkView = linkStepId != null ? 'table' : (linkEpicId != null ? 'plan' : linkMode);

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
    }, [linkView, linkStepId, linkEpicId, pipelineId]);
    const onStepFocus = useCallback((stepId) => {
        setFocusStepId(stepId);
        setModeOverride('table');
    }, []);
    const handleModeChange = useCallback((_e, v) => {
        if (v == null) return;
        setFocusStepId(null);
        setFocusEpicId(null);
        setModeOverride(null);
        setMode(v);
    }, [setMode]);
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
    const summary = useMemo(() => pipelineSummary(plan.rows), [plan.rows]);
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

    // ── ONE STRING PER ELLIPSIZING LINE (req #3241) ─────────────────────────
    // Both of these are now `noWrap` with a tooltip, and both of those need the
    // whole text as a VALUE: CSS `text-overflow` needs a single inline flow to
    // clip, and a tooltip that is the recovery path for a clip has to carry
    // exactly what was clipped. Building the title's suffix inline in the JSX
    // and passing the bare `pipeline.title` to the tooltip would clip
    // "Darwin 30/64" to "Darwin 30/6…" and recover only "Darwin" — losing the
    // one part of the string the reader could not already infer (review
    // finding). The title reads the same in the breadcrumb, so it is built once
    // and used in all three places.
    const titleText = pipeline.title
        + (showReqCounts && planReqCounts
            ? ` ${planReqCounts.met}/${planReqCounts.total}` : '');
    const accountingText = `${summary.total} step${summary.total === 1 ? '' : 's'} — `
        + `${summary.done} complete · ${summary.running} running · `
        + `${summary.pending} scheduled`
        + (pipeline.started_at
            ? ` · started ${formatDateTime(pipeline.started_at, timezone)}` : '')
        + (pipeline.completed_at
            ? ` · completed ${formatDateTime(pipeline.completed_at, timezone)}` : '');

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
            {/* ── The breadcrumb line now also carries the ACCOUNTING (req
                #3241) ────────────────────────────────────────────────────────
                This is the header row's overflow answer, and it is the cheapest
                one available. MEASURED, on the live plan's own strings, at the
                real 180px sidebar + 24px page padding (244px of chrome):

                    accounting "64 steps — 30 complete · 2 running ·
                                32 scheduled · started …"          530px
                    next widest occupant of that row (Width: S|M|L) 139px

                It is the largest single occupant of the row below by nearly 4×,
                and the only pure PROSE on it — everything else there is a
                control the reader clicks. This line already exists, already
                renders, already uses the same `body2` scale, and carried only
                163px of content across the full page width. So the move costs NO
                row and NO pixel of page height — which matters here more than on
                most pages, because the visualizer measures its own top and turns
                every pixel above it into canvas.

                Both are `minWidth: 0` with ellipsis, so this line cannot become
                two either. Flex distributes shrink in PROPORTION to width and
                the accounting is 3.3× the breadcrumb, so it absorbs most of any
                deficit on its own — a narrow viewport loses the trailing
                timestamps well before it touches the plan's name. The full
                string is on the tooltip regardless. */}
            <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1,
                        flexWrap: 'nowrap', minWidth: 0, mb: 1 }}
                 data-testid="pipeline-subheader-row">
                {/* `MuiBreadcrumbs-ol` wraps by default and its `li`s carry the
                    same `min-width: auto` the header's children do, so both have
                    to be answered here or this line reintroduces exactly the
                    problem the row below just solved. The LAST crumb — the plan
                    name — is the one allowed to give, mirroring the header's own
                    rule; the "Pipelines" link is navigation and keeps its size. */}
                <Breadcrumbs sx={{ minWidth: 0, flexShrink: 1,
                                    '& .MuiBreadcrumbs-ol': { flexWrap: 'nowrap' },
                                    '& .MuiBreadcrumbs-li:last-of-type': { minWidth: 0 } }}>
                    <Link component="button" variant="body2" underline="hover"
                          onClick={() => navigate('/swarm/pipelines')}
                          data-testid="pipeline-breadcrumb-list">
                        Pipelines
                    </Link>
                    {/* Tooltipped for the same reason the header title is: the
                        header comment calls this crumb the place a reader
                        recovers a truncated plan name, and below ~945px of
                        viewport it truncates too, so without one the stated
                        fallback would not exist at the widths that need it
                        (review finding). */}
                    <Tooltip title={titleText}>
                        <Typography variant="body2" color="text.primary" noWrap>
                            {titleText}
                        </Typography>
                    </Tooltip>
                </Breadcrumbs>

                {/* Accounting — the whole plan, never a filtered view
                    (view-switchable-pages § V7). */}
                <Tooltip title={accountingText}>
                    <Typography variant="body2" color="text.secondary" noWrap
                                sx={{ minWidth: 0, flexShrink: 1 }}
                                data-testid="pipeline-accounting">
                        {accountingText}
                    </Typography>
                </Tooltip>
            </Box>

            {/* ── ONE ROW (user directive 2026-08-01) ─────────────────────────
                "the title of the visualizer, it became three rows for seemingly
                no reason." Earlier in req #3168 this was split into a PIPELINE
                bar and a VIEW bar, on a reading of "navbar seprate for pipeline
                and its data types". The user looked at the result against
                darwin.one and rejected it: with the breadcrumb above, the split
                reads as three rows of chrome before any plan.

                So this is production's single row again, in production's order —
                mode switch first and left, the plan's identity, a spacer, the
                active mode's own controls, then the description button at the
                right end. The controls added since (Width, the colour tri-state,
                the semantic-level selector) join the mode's group rather than
                claiming a row.

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

                `nowrap` trades a wrap for page overflow, so the controls now
                have a width CEILING rather than a soft cost. The row's
                INCOMPRESSIBLE width — everything that is not the title — is
                763px. Measured with the sidebar expanded: clean at 1024 and at
                1000, 5px of document overflow at 980, 25px at 960. So the floor
                is ~1000px of viewport, and it is the SAME floor whether or not
                the orchestration chip is showing (see its own note below).
                `pipelines.spec.ts` PIPE-18 asserts that budget directly
                (≤ 780px, the row's own width at a 1024px viewport) so a control
                added here fails a test rather than somebody's 1152px window.

                The three changes that make it true at every width, in the order
                they take effect:

                  1. The ACCOUNTING LINE LEFT — it is on the breadcrumb line
                     above, which already existed and had the room. That is the
                     530px this row needed and the whole reason the level
                     selector fits.
                  2. `flexWrap: 'nowrap'` — the row cannot become two rows, by
                     construction. There is nothing left to measure.
                  3. THE PROSE IS ELASTIC, THE CONTROLS ARE NOT. Every control
                     is `flexShrink: 0` and keeps its natural size at every
                     viewport, so none is ever clipped or compressed into
                     illegibility. The title gives instead, ellipsizing with its
                     full text on a tooltip — and so does the orchestration
                     chip, which reads as a control but is a sentence (see its
                     own note below).

                What that costs, stated plainly: on a narrow viewport a long plan
                name truncates. Nothing else changes, and the reader keeps the
                full name on the tooltip and, until it truncates too, one line
                above in the breadcrumb. */}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'nowrap',
                        minWidth: 0, mb: 1 }}
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
                        <ToggleButton key={value} value={value} disabled={disabled}
                                      className="cal-toggle-btn" sx={{ px: 1.5 }}
                                      data-testid={`pipeline-mode-${value}`}>
                            <Tooltip title={`${label} view`}>
                                <Icon fontSize="small" />
                            </Tooltip>
                        </ToggleButton>
                    ))}
                </ToggleButtonGroup>

                {/* The row's ONE elastic member — see the block comment above.
                    `minWidth: 0` is what actually lets it shrink: a flex item's
                    default `min-width: auto` means "never below your content",
                    and `noWrap` alone would then widen the row instead of
                    ellipsizing inside it. */}
                <Tooltip title={titleText}>
                    <Typography variant="h6" noWrap
                                sx={{ minWidth: 0, flexShrink: 1 }}
                                data-testid="pipeline-title">
                        {titleText}
                    </Typography>
                </Tooltip>

                <Box sx={{ flexGrow: 1, flexShrink: 1, minWidth: 0 }} />

                {/* req #3225 — visible in EITHER mode (the plan name reads it
                    here, the epic band label reads it in Plan mode), so it
                    lives outside the mode-conditional block below rather than
                    joining one side of it. */}
                <Tooltip title={'Show requirements met / total beside the plan '
                    + 'name and every epic band label'}>
                    <Button
                        size="small"
                        className="cal-toggle-btn"
                        variant={showReqCounts ? 'contained' : 'outlined'}
                        onClick={() => setShowReqCountsPref(showReqCounts ? 'off' : 'on')}
                        sx={{ flexShrink: 0 }}
                        data-testid="pipeline-reqcounts-toggle"
                    >
                        Counts
                    </Button>
                </Tooltip>

                {activeMode === 'table' ? (
                    <Button
                        size="small"
                        className="cal-toggle-btn"
                        variant={showCost ? 'contained' : 'outlined'}
                        onClick={() => setShowCost((v) => !v)}
                        sx={{ flexShrink: 0 }}
                        data-testid="pipeline-cost-toggle"
                    >
                        Time / Tokens
                    </Button>
                ) : (
                    <>
                        {/* The `Reqs:` and `Step:` controls were REMOVED on the
                            user's directive (2026-08-01): requirement marks are
                            always the vertical stack and the step label is always
                            the title, so both controls had one useful position
                            each and spent header width saying so. The layout
                            module still takes both parameters and still proves
                            every combination — a control is a product decision,
                            not a reason to delete a tested code path. */}
                        {/* ── THE SEMANTIC LEVEL SELECTOR, LEFT OF WIDTH (req
                            #3241) ─────────────────────────────────────────────
                            Req #3214's title — "Zoom UI buttons to title bar" —
                            asked for exactly this and the work declined it,
                            leaving the control in the key and a dead import in
                            this file as the trace. The reason recorded for the
                            decline was a measurement, not a decision: the header
                            row had grown past 2300px of natural content. That
                            figure is from req #3168's row, which carried four
                            more controls than this one — re-measured today the
                            row was 1172px — but the SHAPE of the finding held:
                            adding this 186px control to it would have wrapped a
                            1440px laptop. A measurement says what a move COSTS;
                            it does not say whether to make it. The header block
                            comment above says what was done about the cost.

                            It is NOT a zoom pair, whatever the old title called
                            it: Auto plus three named levels selecting which
                            marks are DRAWN, with the camera untouched across a
                            change. Nothing about transforms or scale extents
                            applies to it, which is also why it sits beside Width
                            (a layout control) rather than beside Reset.

                            THE SHARED COMPONENT, not a header-shaped copy of it
                            — req #3168 extracted it from the Build Visualizer
                            precisely so two canvases doing semantic zoom cannot
                            drift, and the Build Visualizer renders it in ITS
                            header among chips too. `testIdPrefix="pipeline-viz"`
                            keeps every `pipeline-viz-level-*` hook byte-for-byte
                            through the move, so the move re-points test
                            LOCATIONS and renames nothing.

                            No `data-viz-chrome` here, unlike in the key: that
                            attribute exempts a control from the canvas's two
                            gesture filters, and those are bound to the canvas
                            container. This row is outside it, so a mousedown
                            here was never reachable as a pan gesture. The
                            exemption travelled with the control in the sense
                            that matters — it is gone from the key's level Box,
                            and the key keeps its own on the collapse button. */}
                        <Box sx={{ display: 'flex', flexShrink: 0 }}>
                            <SemanticLevelControl
                                // The page holds the pref as the CANVAS's
                                // vocabulary ('auto'|'1'|'2'|'3') and the
                                // reported level as the canvas's OTHER
                                // vocabulary ('out'|'mid'|'in'); the shared
                                // control speaks `null | 1 | 2 | 3` and is
                                // deliberately ignorant of what a level MEANS.
                                // Both translations happen here, which is the
                                // only place that knows both.
                                pinnedLevel={planLevelPref === 'auto'
                                    ? null : Number(planLevelPref)}
                                effectiveLevel={PLAN_LEVEL_NUMBER[effectiveLevel] ?? null}
                                onChangePinnedLevel={(lvl) => setLevelPref(
                                    lvl == null ? 'auto' : String(lvl))}
                                testIdPrefix="pipeline-viz"
                            />
                        </Box>
                        {/* Req #3168 — column width, the one piece of the plan's
                            geometry a reader could not influence. It only ever
                            WIDENS (see STEP_WIDTH_FACTORS): a narrower column
                            than the content needs would push requirement marks
                            out of their own slab, which is the zero-overlap
                            contract the layout module proves. */}
                        <ToggleButtonGroup value={stepWidth} exclusive size="small"
                                           sx={{ flexShrink: 0 }}
                                           onChange={(_e, v) => v && setStepWidthPref(v)}
                                           data-testid="pipeline-viz-stepwidth-toggle">
                            <Tooltip title="Column width — compact">
                                <ToggleButton value="compact" className="cal-toggle-btn">
                                    Width: S
                                </ToggleButton>
                            </Tooltip>
                            <Tooltip title="Column width — medium">
                                <ToggleButton value="medium" className="cal-toggle-btn">
                                    M
                                </ToggleButton>
                            </Tooltip>
                            <Tooltip title="Column width — wide">
                                <ToggleButton value="wide" className="cal-toggle-btn">
                                    L
                                </ToggleButton>
                            </Tooltip>
                        </ToggleButtonGroup>
                        {/* The colour key for the REQUIREMENT MARKS, never the
                            beads — the bead's fill is derived STEP state and
                            stays that (the one-fact-one-channel-one-level rule
                            in pipelinePlanLayout.js).

                            THREE POSITIONS FROM TWO BUTTONS. MUI's exclusive
                            group already fires `onChange(_, null)` when the
                            selected button is clicked again; the old handler
                            (`v && setPref(v)`) swallowed exactly that event.
                            `value={null}` renders BOTH buttons unpressed, so the
                            control reports the third position honestly instead of
                            lying about one of the other two.
                            `useViewPreference.changeView` ignores null, so the
                            string 'none' is what gets stored. */}
                        <Tooltip title={'Colour the requirement marks — click the '
                            + 'selected button again for none'}>
                            <ToggleButtonGroup
                                value={colorKey === 'none' ? null : colorKey}
                                exclusive size="small"
                                sx={{ flexShrink: 0 }}
                                onChange={(_e, v) => setColorKeyPref(v == null ? 'none' : v)}
                                data-testid="pipeline-viz-colorkey-toggle">
                                <ToggleButton value="state" className="cal-toggle-btn">
                                    State
                                </ToggleButton>
                                <ToggleButton value="machine" className="cal-toggle-btn">
                                    Machine
                                </ToggleButton>
                            </ToggleButtonGroup>
                        </Tooltip>
                        {/* Req #3216 — Reset joins the zoom control group here,
                            out of the bottom-right corner of the canvas it used
                            to float in. FACTORY DEFAULT, not the readable
                            landing scale the page opens on: one click always
                            shows the whole plan's vertical extent, from any
                            pan or zoom. Width re-centres on every change (it
                            rescales every column), and does so onto WHICHEVER
                            of the two scales is currently active — see
                            `recenterModeRef` in PipelinePlanVisualizer.jsx —
                            so clicking Width right after Reset keeps showing
                            the whole plan instead of snapping back to the
                            readable scale out from under its own neighbour. */}
                        <Tooltip title={'Reset — fully zoomed out, the whole '
                            + "plan's vertical extent visible"}>
                            <Button
                                size="small"
                                className="cal-toggle-btn"
                                variant="outlined"
                                onClick={handleResetView}
                                sx={{ flexShrink: 0 }}
                                data-testid="pipeline-viz-reset"
                            >
                                Reset
                            </Button>
                        </Tooltip>
                    </>
                )}

                {/* The status chip and the machine chip were REMOVED on the
                    user's directive (2026-08-01). Plan status is already on the
                    Pipelines list this page is reached from, and the machine
                    spread is on every step's hover card; on the title row they
                    were two more things between the plan's name and the reader.
                    The description button is what remains, and it is last. */}

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
                            // AND IT REALLY DOES REACH ZERO — worth recording,
                            // because the arithmetic says otherwise and a later
                            // reader will redo it. A small Chip carries 8px of
                            // label padding a side, so ~18px looks like a floor
                            // this can never give back, which would put the
                            // chip's presence back into the row's overflow
                            // budget just smaller. Measured: the label's own
                            // `overflow: hidden` collapses that padding along
                            // with the root, so the chip renders 6px at a 1024px
                            // viewport and 0-2px below it (the 2px is the
                            // `outlined` stale variant's border). The row's
                            // overflow floor is IDENTICAL with and without it.
                            sx={{ flexShrink: 1, minWidth: 0 }}
                            data-testid="pipeline-detail-holder"
                        />
                    </Tooltip>
                )}
                {/* Req #3179 — the description, at the RIGHT END of the row,
                    exactly where the Telemetry page keeps its Glossary
                    (ContextPage.jsx). The icon reports whether there is anything
                    behind it: coloured when the plan has a goal, muted when it
                    does not, so an empty description is visible without opening
                    the dialog and the button never reads as a dead control. */}
                <Tooltip title={descriptionLabel}>
                    <IconButton
                        size="small"
                        color={hasDescription ? 'primary' : 'default'}
                        onClick={() => setDescriptionOpen(true)}
                        // The SAME string the tooltip carries, because the muted
                        // icon is the only other place "there is nothing behind
                        // this button" is said and a screen reader cannot see it.
                        // MUI's Tooltip spreads the child's own props last, so an
                        // aria-label here wins over the one it would inject.
                        aria-label={descriptionLabel}
                        sx={{ flexShrink: 0 }}
                        data-testid="pipeline-description-btn"
                    >
                        <InfoOutlinedIcon fontSize="small" />
                    </IconButton>
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
                             levelPref={planLevelPref}
                             onEffectiveLevel={setEffectiveLevel}
                             resetViewNonce={resetViewNonce}
                             />
        </Box>
    );
}
