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
import SemanticLevelControl from '../../Components/SemanticLevelControl';
import {
    DEFAULT_COLOR_KEY, DEFAULT_PLAN_LEVEL_PREF, DEFAULT_REQ_VIEW, DEFAULT_STEP_WIDTH,
    PLAN_LEVEL_NUMBER, REQ_VIEWS, isStepWidth, normalizeColorKey,
    normalizePlanLevelPref, normalizeReqView, reqViewOptions,
} from './pipelinePlanLayout';
import {
    PLAN_REQUIREMENT_FIELDS,
    buildCostIndex,
    buildPipelineModel,
    machineTitle,
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
    const [effectiveLevel, setEffectiveLevel] = useState(null);
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
    // A named step FORCES the table, overriding `?mode=` when the two disagree.
    // Only the table consumes `focusStepId` — the visualizer has beads, not rows,
    // and ignores the prop entirely — so honoring `?mode=plan&step=7` as written
    // would land the reader on a plan with nothing highlighted and nothing to say
    // why. Naming a row is the more specific request, so it wins.
    const linkView = linkStepId != null ? 'table' : linkMode;

    const [focusStepId, setFocusStepId] = useState(linkStepId);
    const [modeOverride, setModeOverride] = useState(linkView);
    // Re-seeds when the LINK changes — a new `?mode=`, a new `?step=`, or a
    // different plan — and at no other time, so a manual pick below is never
    // resurrected by a re-render. A link with no `?step=` clears the focus, which
    // is what keeps a stale highlight from surviving an unrelated navigation.
    useEffect(() => {
        setModeOverride(linkView);
        setFocusStepId(linkStepId);
    }, [linkView, linkStepId, pipelineId]);
    const onStepFocus = useCallback((stepId) => {
        setFocusStepId(stepId);
        setModeOverride('table');
    }, []);
    const handleModeChange = useCallback((_e, v) => {
        if (v == null) return;
        setFocusStepId(null);
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

    // req #3224 — the WHOLE-PLAN reservation. An epic-scoped one is a different
    // and weaker claim ("a slice of this plan is being orchestrated") and is the
    // epics page's answer, not this header's.
    const orchestrationHolder = useMemo(
        () => holderView(claimForPipeline(orchestrationClaims, pipeline?.id), machines),
        [orchestrationClaims, pipeline?.id, machines]);

    // Every distinct machine the plan's steps actually touch, derived from the
    // requirements (design rule 10's level). Sorted for a stable chip.
    const planMachines = useMemo(() => {
        const seen = [];
        for (const row of plan.rows || []) {
            for (const label of row.machineLabels || []) {
                if (!seen.includes(label)) seen.push(label);
            }
        }
        return seen.sort((a, b) => a.localeCompare(b));
    }, [plan.rows]);

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
            <Breadcrumbs sx={{ mb: 1 }}>
                <Link component="button" variant="body2" underline="hover"
                      onClick={() => navigate('/swarm/pipelines')}
                      data-testid="pipeline-breadcrumb-list">
                    Pipelines
                </Link>
                <Typography variant="body2" color="text.primary">{pipeline.title}</Typography>
            </Breadcrumbs>

            {/* ── ONE ROW (user directive 2026-08-01) ─────────────────────────
                "the title of the visualizer, it became three rows for seemingly
                no reason." Earlier in req #3168 this was split into a PIPELINE
                bar and a VIEW bar, on a reading of "navbar seprate for pipeline
                and its data types". The user looked at the result against
                darwin.one and rejected it: with the breadcrumb above, the split
                reads as three rows of chrome before any plan.

                So this is production's single row again, in production's order —
                mode switch first and left, the plan's identity, the accounting
                line, a spacer, the active mode's own controls, then the status
                and machine chips and the description button at the right end.
                The controls added since (Width, the colour tri-state, the
                semantic-level selector) join the mode's group rather than
                claiming a row.

                MEASURED: in Plan mode this row wraps to a second line below
                ~2180px of viewport, and to a third below ~1290px. It is a
                `flexWrap: 'wrap'` row and always was — every assertion written
                against it is deliberately WRAP-INVARIANT for that reason, and
                nothing here is shrunk to chase a single line. */}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap',
                        mb: 1 }}
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

                <Typography variant="h6" sx={{ flexShrink: 0 }} data-testid="pipeline-title">
                    {pipeline.title}
                </Typography>

                {/* Accounting — the whole plan, never a filtered view
                    (view-switchable-pages § V7). */}
                <Typography variant="body2" color="text.secondary" sx={{ flexShrink: 0 }}
                            data-testid="pipeline-accounting">
                    {summary.total} step{summary.total === 1 ? '' : 's'} —{' '}
                    {summary.done} complete · {summary.running} running ·{' '}
                    {summary.pending} scheduled
                    {pipeline.started_at
                        ? ` · started ${formatDateTime(pipeline.started_at, timezone)}` : ''}
                    {pipeline.completed_at
                        ? ` · completed ${formatDateTime(pipeline.completed_at, timezone)}` : ''}
                </Typography>

                <Box sx={{ flexGrow: 1 }} />

                {activeMode === 'table' ? (
                    <Button
                        size="small"
                        className="cal-toggle-btn"
                        variant={showCost ? 'contained' : 'outlined'}
                        onClick={() => setShowCost((v) => !v)}
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
                        {/* Req #3168 — column width, the one piece of the plan's
                            geometry a reader could not influence. It only ever
                            WIDENS (see STEP_WIDTH_FACTORS): a narrower column
                            than the content needs would push requirement marks
                            out of their own slab, which is the zero-overlap
                            contract the layout module proves. */}
                        <ToggleButtonGroup value={stepWidth} exclusive size="small"
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
                    </>
                )}

                {/* The status chip and the machine chip were REMOVED on the
                    user's directive (2026-08-01). Plan status is already on the
                    Pipelines list this page is reached from, and the machine
                    spread is on every step's hover card; on the title row they
                    were two more things between the plan's name and the reader.
                    The description button is what remains, and it is last. */}

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
                            sx={{ flexShrink: 0 }}
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
                             costError={!!costError}
                             showCost={showCost}
                             reqLayout={reqLayout} stepLabel={stepLabel} colorKey={colorKey}
                             stepWidth={stepWidth} reqLabel={reqLabel}
                             levelPref={planLevelPref}
                             onChangeLevelPref={setLevelPref}
                             onEffectiveLevel={setEffectiveLevel}
                             />
        </Box>
    );
}
