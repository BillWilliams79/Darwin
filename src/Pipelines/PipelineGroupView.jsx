// PipelineGroupView.jsx — the Pipelines page's "Pipeline group" view (req #3972).
//
// Every pipeline the page's filters show, in ONE 3D scene, with all their
// initiatives, epics and requirements — the Data Center to a pipeline's
// SuperPod (user directive). The scene is `buildPipelineGroupModel`
// (pipelineGroupModel.js) drawn by `createPipelineGroupScene`
// (pipelineGroupScene.js); this component owns the reads, the panels and the
// hover card.
//
// ── A CALENDAR, IN THE 3-D VIEWER'S CHROME (req #4042) ─────────────────────
// The floor is a calendar — pipelines roughly by time, left to right, and
// those worked close together by their sort order, back to front (the model's
// header says how). The view wears the Topology 3-D viewer's chrome (tpu3d.js
// req #3570/#3591/#3600), so the scene has the whole stage and every control
// lays over it:
//   ▾ CONTROLS  top-left — View (Clear · Rotate · Default · Top · Front ·
//               Side) and Calendar (Day · Week · Month); the Full screen
//               switch just right of the header
//   ▾ INFO      top-right — the calendar's index (every column and its
//               pipelines, a click focuses one) with the status key; a focused
//               pipeline's facts and its place in the calendar instead
//   ▾ HELP      bottom-right — the gestures, COLLAPSED on every visit: it
//               teaches what a returning reader already knows, so it stays a
//               header in the corner until asked for (Topology req #3591)
// Each header folds its panel to itself. Native `title` tooltips rather than
// MUI's: a portal renders outside a full-screen stage and would never show.
//
// The drill-in is the 2D plan visualizer: there is no 3D single-pipeline view
// yet (user: "honoring the fact that there is no 3-D visualizer … we can add
// that later"), so the focus panel's "Open plan" goes to `/swarm/pipeline/:id`.
//
// Loaded with `React.lazy` from PipelinesPage.jsx, so three.js is a chunk of
// its own that the Cards and Table views never download.
//
// ── THE READ, AND ITS HONEST COST ──────────────────────────────────────────
// One composed read per shown plan (`useComposedPipelines`) — the same
// fan-out, under the same cache keys, as the Cards view's thumbnails, so
// arriving here from Cards is a cache hit and it refreshes at the thumbnails'
// rate. The scene is built once every read has SETTLED: a field packed while
// plans are still arriving would re-pack under the camera as each one landed.

import { useEffect, useMemo, useRef, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import ButtonBase from '@mui/material/ButtonBase';
import ButtonGroup from '@mui/material/ButtonGroup';
import CircularProgress from '@mui/material/CircularProgress';
import IconButton from '@mui/material/IconButton';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import CloseIcon from '@mui/icons-material/Close';
import FullscreenIcon from '@mui/icons-material/Fullscreen';
import FullscreenExitIcon from '@mui/icons-material/FullscreenExit';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import ThreeSixtyIcon from '@mui/icons-material/ThreeSixty';

import { useComposedPipelines } from '../hooks/useDataQueries';
import { useViewPreference } from '../hooks/useViewPreference';
import { adaptComposedPipeline } from '../SwarmView/pipelines/pipelineAdapter';
import { localDayOf } from '../SwarmView/pipelines/pipelinePlanTime';
import {
    computePlanLayout, DEFAULT_PLAN_PALETTE, PLAN_VIZ_PALETTE,
} from '../SwarmView/pipelines/pipelinePlanLayout';
import PipelineStatusChip from './PipelineStatusChip';
import {
    buildPipelineGroupModel, calendarLabel, CALENDAR_BUCKETS, DEFAULT_CALENDAR_BUCKET,
    GROUP_STATUS_LEGEND, groupStatusColor,
} from './pipelineGroupModel';
import { createPipelineGroupScene, webglAvailable } from './pipelineGroupScene';

const P = PLAN_VIZ_PALETTE;

const PRESET_BUTTONS = [
    { value: 'iso', label: 'Default' },
    { value: 'top', label: 'Top' },
    { value: 'front', label: 'Front' },
    { value: 'side', label: 'Side' },
];

const MONO = '"SF Mono", "JetBrains Mono", Menlo, monospace';

const CALENDAR_BUTTONS = [
    { value: 'day', label: 'Day', title: 'A column per day' },
    { value: 'week', label: 'Week', title: 'A column per week, Sunday to Saturday' },
    { value: 'month', label: 'Month', title: 'A column per month' },
];
const CALENDAR_STORAGE_KEY = 'darwin-pipeline-group-calendar';

export const HELP_TEXT = 'Drag to orbit · right-drag to pan · scroll to zoom · arrows / WASD to move · '
    + 'left to right is time, back to front is sort order within a column · '
    + 'click a pipeline (here or in Info) to focus it · double-click to zoom in · Esc clears';

// The Topology 3-D viewer's panel chrome (systems2/styles.css .tpu3d-toolbar,
// .tpu3d-info, .tpu3d-help, .tpu3d-head).
const VIEWER = {
    panel: 'rgba(12, 29, 52, 0.88)',
    border: '#1c3a5f',
    text: '#cfe4f7',
    head: '#7bb8de',
    hint: '#9bbcd6',
};
const panelSx = {
    position: 'absolute', zIndex: 2, background: VIEWER.panel, border: `1px solid ${VIEWER.border}`,
    borderRadius: '6px', color: VIEWER.text, fontSize: 12,
};
const smallButtonSx = { px: 1.1, py: 0.25, minWidth: 0, fontSize: 11, lineHeight: 1.5, textTransform: 'none' };

/** ▾ NAME — the header that folds its panel to itself. */
function PanelHead({ name, open, onToggle, testid }) {
    return (
        <ButtonBase onClick={onToggle} data-testid={testid} aria-expanded={open ? 'true' : 'false'}
                    title={`${open ? 'Collapse' : 'Expand'} ${name.toLowerCase()}`}
                    sx={{
                        display: 'inline-flex', alignItems: 'center', gap: '5px', justifyContent: 'flex-start',
                        color: VIEWER.head, fontSize: 10, fontWeight: 700, lineHeight: '14px',
                        letterSpacing: '0.06em', textTransform: 'uppercase', fontFamily: 'inherit',
                        '&:hover': { color: VIEWER.text },
                    }}>
            <Box component="span" sx={{
                display: 'inline-block', width: 10, textAlign: 'center', transition: 'transform 0.15s',
                transform: open ? 'none' : 'rotate(-90deg)',
            }}>▾</Box>
            {name}
        </ButtonBase>
    );
}

/** A labelled Controls row: its title in a column of its own, so a wrap stays under its buttons. */
function ControlRow({ label, children }) {
    return (
        <Box sx={{ position: 'relative', pl: '60px', minHeight: 22, display: 'flex', alignItems: 'center',
                   flexWrap: 'wrap', gap: '4px' }}>
            <Box component="span" sx={{
                position: 'absolute', left: 0, top: 0, lineHeight: '22px', fontSize: 11, fontWeight: 700,
                color: VIEWER.head,
            }}>{label}</Box>
            {children}
        </Box>
    );
}

/** "Started Oct 23, 2026" / "Created …" — when a pipeline sits on the calendar. */
function whenText(pipeline) {
    if (!pipeline.when) return 'No start or creation date';
    const day = calendarLabel(pipeline.when.day, 'day', { withYear: true });
    return `${pipeline.when.source === 'started' ? 'Started' : 'Created'} ${day}`;
}

const ordinal = (n) => {
    const t = n % 100;
    if (t >= 11 && t <= 13) return `${n}th`;
    return `${n}${{ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th'}`;
};

/** One plan's read → what the model needs. */
// Data first: a failed background refetch keeps the cached plan (TanStack
// keeps `data` beside the error), so it stays drawn, as its thumbnail does.
export function planForGroup(pipeline, query, machines, now) {
    const data = query?.data;
    if (!data) {
        if (query?.isLoading) return { pipeline, state: 'loading' };
        if (query?.isError) return { pipeline, state: 'error' };
        return { pipeline, state: 'empty' };
    }
    let rows;
    let layout;
    try {
        rows = adaptComposedPipeline(data, { machines, now })?.rows;
        if (!rows || !rows.length) return { pipeline, state: 'empty' };
        layout = computePlanLayout(rows, { palette: DEFAULT_PLAN_PALETTE });
    } catch {
        // One unreadable plan is one failed platform, never a blank page.
        return { pipeline, state: 'error' };
    }
    if (!layout || layout.empty) return { pipeline, state: 'empty' };
    const requirementsById = new Map((data.requirements || []).map((r) => [r.id, r]));
    return { pipeline, state: 'drawn', layout, rows, requirementsById };
}

function Dot({ color, size = 10 }) {
    return (
        <Box component="span" sx={{
            display: 'inline-block', width: size, height: size, borderRadius: '2px',
            background: color, flex: 'none',
        }} />
    );
}

function HoverCard({ hover }) {
    const { kind, pipeline, epic, req } = hover;
    return (
        <Paper elevation={6} data-testid="pipelines-group-hover" sx={{
            position: 'absolute', left: hover.x + 16, top: hover.y + 16, maxWidth: 340,
            px: 1.5, py: 1, pointerEvents: 'none', zIndex: 3,
            background: 'rgba(17, 27, 43, 0.96)', color: P.text, border: `1px solid ${P.line}`,
        }}>
            {kind === 'req' && (
                <>
                    <Stack direction="row" spacing={1} alignItems="center">
                        <Dot color={groupStatusColor(req.status)} />
                        <Typography variant="caption" sx={{ fontFamily: MONO, color: P.dim }}>
                            #{req.id} · {req.status || 'unknown'}
                        </Typography>
                    </Stack>
                    <Typography variant="body2" sx={{ fontWeight: 600, mt: 0.25 }}>
                        {req.title || `Requirement ${req.id}`}
                    </Typography>
                </>
            )}
            {(kind === 'req' || kind === 'epic') && (
                <Typography variant="caption" component="div" sx={{ color: kind === 'epic' ? P.text : P.dim, fontWeight: kind === 'epic' ? 600 : 400 }}>
                    Epic: {epic.title}
                </Typography>
            )}
            {kind === 'epic' && (
                <Typography variant="caption" component="div" sx={{ color: P.dim }}>
                    {epic.initiative} · {epic.met}/{epic.reqs.length} met · {epic.open} open
                </Typography>
            )}
            <Typography variant="caption" component="div" sx={{ color: P.dim }}>
                {kind === 'pipeline' ? (
                    <Box component="span" sx={{ color: P.text, fontWeight: 600 }}>{pipeline.title}</Box>
                ) : `Pipeline: ${pipeline.title}`}
                {kind === 'pipeline' && ` · ${pipeline.counts.epics} epics · `
                    + `${pipeline.counts.met}/${pipeline.counts.requirements} met`}
            </Typography>
            {kind === 'pipeline' && (
                <Typography variant="caption" component="div" sx={{ color: P.dim }}>
                    {whenText(pipeline)} · click to focus
                </Typography>
            )}
        </Paper>
    );
}

/** Info, a pipeline focused: its facts, its place in the calendar and the way into its plan. */
function FocusInfo({ pipeline, column, onOpen, onClose, onSetStatus }) {
    const c = pipeline.counts;
    const n = column ? column.pipelineIds.length : 0;
    return (
        <Box data-testid="pipelines-group-focus">
            <Stack direction="row" alignItems="flex-start" spacing={1}>
                <Typography variant="subtitle1" sx={{ fontWeight: 700, flex: 1, lineHeight: 1.3, color: '#fff' }}>
                    {pipeline.title}
                </Typography>
                <IconButton size="small" onClick={onClose} aria-label="Clear focus" title="Clear the focus"
                            sx={{ color: VIEWER.hint, mt: -0.5 }} data-testid="pipelines-group-focus-close">
                    <CloseIcon fontSize="small" />
                </IconButton>
            </Stack>
            <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 0.5, mb: 1 }}>
                {/* req #3965 — the plan's status editor. The menu renders in
                    place: a full-screen stage shows nothing portalled to <body>. */}
                <PipelineStatusChip status={pipeline.status}
                                    onChange={onSetStatus ? (next) => onSetStatus(pipeline.id, next) : undefined}
                                    disablePortal tooltip=""
                                    testId={`pipelines-group-status-${pipeline.id}`} />
                <Typography variant="caption" sx={{ color: VIEWER.hint }}>#{pipeline.id}</Typography>
            </Stack>
            <Typography variant="body2" sx={{ color: VIEWER.hint }} data-testid="pipelines-group-focus-when">
                {whenText(pipeline)}
            </Typography>
            {column && (
                <Typography variant="body2" sx={{ color: VIEWER.hint, mb: 1 }}>
                    {column.label}
                    {n > 1 ? ` · ${ordinal(pipeline.rank)} of ${n} by sort order` : ''}
                </Typography>
            )}
            <Typography variant="body2" sx={{ color: VIEWER.hint }}>
                {c.initiatives} initiative{c.initiatives === 1 ? '' : 's'} · {c.epics} epic
                {c.epics === 1 ? '' : 's'} · {c.requirements} requirement{c.requirements === 1 ? '' : 's'}
            </Typography>
            <Typography variant="body2" sx={{ color: VIEWER.hint, mb: 1 }}>
                {c.met} met · {c.open} open
            </Typography>
            {pipeline.bands.map((band) => {
                const epics = pipeline.epics.filter((e) => e.band === band.key);
                const reqs = epics.flatMap((e) => e.reqs);
                const met = reqs.filter((r) => r.status === 'met').length;
                return (
                    <Stack key={band.key} direction="row" spacing={1} alignItems="center" sx={{ py: 0.25 }}>
                        <Dot color={band.color} />
                        <Typography variant="body2" sx={{ flex: 1, minWidth: 0 }} noWrap title={band.label}>
                            {band.label}
                        </Typography>
                        <Typography variant="caption" sx={{ color: VIEWER.hint, fontFamily: MONO }}>
                            {epics.length}e · {met}/{reqs.length}
                        </Typography>
                    </Stack>
                );
            })}
            <Button fullWidth size="small" variant="contained" endIcon={<OpenInNewIcon />}
                    sx={{ mt: 1.5 }} onClick={() => onOpen(pipeline.id)}
                    data-testid="pipelines-group-open-plan">
                Open plan
            </Button>
        </Box>
    );
}

/** Info, nothing focused: the calendar's index — every column and its pipelines, back to front. */
function CalendarIndex({ model, onFocus }) {
    const c = model.counts;
    const byId = new Map(model.pipelines.map((p) => [p.id, p]));
    return (
        <Box data-testid="pipelines-group-calendar-index">
            <Typography variant="body2" sx={{ color: VIEWER.hint, mb: 1 }} data-testid="pipelines-group-counts">
                {c.pipelines} pipeline{c.pipelines === 1 ? '' : 's'} · {c.initiatives} initiatives
                · {c.epics} epics · {c.requirements} requirements ({c.met} met)
            </Typography>
            {model.columns.map((col) => (
                <Box key={col.key} sx={{ mb: 0.75 }} data-testid={`pipelines-group-column-${col.key}`}>
                    {col.gapBefore && (
                        <Typography variant="caption" component="div"
                                    sx={{ color: VIEWER.head, opacity: 0.7, fontStyle: 'italic' }}>
                            · {col.gapBefore.label} with nothing ·
                        </Typography>
                    )}
                    <Typography variant="caption" component="div" sx={{ color: '#fff', fontWeight: 700 }}>
                        {col.label}
                    </Typography>
                    {col.pipelineIds.map((id) => {
                        const p = byId.get(id);
                        if (!p) return null;
                        return (
                            <ButtonBase key={id} onClick={() => onFocus(id)}
                                        data-testid={`pipelines-group-index-${id}`}
                                        title={`${whenText(p)} — click to focus`}
                                        sx={{
                                            display: 'flex', width: '100%', justifyContent: 'flex-start',
                                            gap: 0.75, pl: 1, py: '1px', borderRadius: '3px',
                                            textAlign: 'left', '&:hover': { background: '#19324e' },
                                        }}>
                                <Box component="span" sx={{ flex: 1, minWidth: 0, fontSize: 11.5, overflow: 'hidden',
                                                            textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                    {p.title}
                                </Box>
                                <Box component="span" sx={{ fontSize: 10.5, color: VIEWER.hint, fontFamily: MONO }}>
                                    {p.counts.met}/{p.counts.requirements}
                                </Box>
                            </ButtonBase>
                        );
                    })}
                </Box>
            ))}
        </Box>
    );
}

function StatusKey() {
    return (
        <Box data-testid="pipelines-group-legend"
             sx={{ mt: 1, pt: 1, borderTop: `1px solid ${VIEWER.border}` }}>
            <Typography variant="caption" sx={{ color: VIEWER.hint, display: 'block', mb: 0.25 }}>
                Requirement status
            </Typography>
            <Stack direction="row" spacing={1.25} sx={{ flexWrap: 'wrap', rowGap: 0.25 }}>
                {GROUP_STATUS_LEGEND.map((st) => (
                    <Stack key={st.status} direction="row" spacing={0.5} alignItems="center">
                        <Dot color={st.color} size={9} />
                        <Typography variant="caption">{st.label}</Typography>
                    </Stack>
                ))}
            </Stack>
        </Box>
    );
}

/**
 * @param {Object[]} pipelines     the page's filtered, hand-sorted list rows
 * @param {Object[]} machines
 * @param {number}   refetchInterval   the composed reads' refresh (the thumbnails')
 * @param {?number}  focusId       the focused pipeline (the page's `?focus=`)
 * @param {(id: ?number) => void} onFocusChange
 * @param {(id: number) => void}  onOpen   open a plan's visualizer
 * @param {(row: Object, status: string) => Promise} [onSetStatus]  the focus panel's status
 *                                 write (req #3965), handed the page's list row
 */
export default function PipelineGroupView({
    pipelines, machines = [], refetchInterval, focusId = null, onFocusChange, onOpen, onSetStatus,
}) {
    const [supported] = useState(() => webglAvailable());
    // The page hands a freshly filtered array every render; what the scene
    // draws of a list row is its id, title and status, and the calendar
    // places it by its times and sort order — so that is the key.
    const pipelinesKey = pipelines.map((p) => [p.id, p.pipeline_status, p.title, p.sort_order,
        p.started_at, p.create_ts].join(':')).join('|');
    const ids = useMemo(() => pipelines.map((p) => p.id), [pipelinesKey]);
    const queries = useComposedPipelines(ids, { enabled: supported, refetchInterval });

    const settled = queries.every((q) => !q.isLoading);
    // `useQueries` hands back a fresh array every render, and every refetch
    // stamps a new `dataUpdatedAt` even when structural sharing kept the same
    // `data`. The model is rebuilt only when a plan's DATA (by identity) or
    // its read state changed — a scene rebuild is a GPU teardown.
    const readRef = useRef({ datas: [], states: '', n: 0 });
    const readStates = queries.map((q) => (q.data ? 'd' : q.isLoading ? 'l' : q.isError ? 'e' : 'n')).join('');
    const datas = queries.map((q) => q.data);
    const prevRead = readRef.current;
    if (readStates !== prevRead.states || datas.length !== prevRead.datas.length
        || datas.some((d, i) => d !== prevRead.datas[i])) {
        readRef.current = { datas, states: readStates, n: prevRead.n + 1 };
    }
    const readKey = readRef.current.n;
    // The page passes a fresh `[]` while machines are loading or failed;
    // what the adapter reads of a machine is its id and title.
    const machinesKey = machines.map((m) => `${m.id}:${m.title}`).join('|');
    const stableMachines = useMemo(() => machines, [machinesKey]);
    const [storedBucket, setBucket] = useViewPreference(CALENDAR_STORAGE_KEY, DEFAULT_CALENDAR_BUCKET);
    const bucket = CALENDAR_BUCKETS.includes(storedBucket) ? storedBucket : DEFAULT_CALENDAR_BUCKET;
    const today = localDayOf(new Date());
    const model = useMemo(() => {
        if (!settled) return null;
        const now = new Date();
        return buildPipelineGroupModel(
            pipelines.map((p, i) => planForGroup(p, queries[i], stableMachines, now)), { bucket });
    }, [settled, readKey, pipelinesKey, stableMachines, today, bucket]);

    const hostRef = useRef(null);
    const engineRef = useRef(null);
    const [engineError, setEngineError] = useState(null);
    const [preset, setPreset] = useState('iso');
    const [rotating, setRotating] = useState(false);
    const [hover, setHover] = useState(null);
    // The panels: Controls and Info open, Help folded — on every visit.
    const [controlsOpen, setControlsOpen] = useState(true);
    const [infoOpen, setInfoOpen] = useState(true);
    const [helpOpen, setHelpOpen] = useState(false);
    // Full screen: the browser's own on the stage where it is allowed
    // ('native'), a fixed overlay where it is not ('overlay').
    const [full, setFull] = useState(null);
    const focusChangeRef = useRef(onFocusChange);
    focusChangeRef.current = onFocusChange;

    useEffect(() => {
        if (!supported || !hostRef.current) return undefined;
        let engine;
        try {
            engine = createPipelineGroupScene(hostRef.current, {
                onHover: setHover,
                onFocus: (id) => focusChangeRef.current?.(id),
                onPreset: setPreset,
                onRotate: setRotating,
            });
        } catch (err) {
            setEngineError(err?.message || String(err));
            return undefined;
        }
        engineRef.current = engine;
        if (import.meta.env.DEV) window.__pipelineGroup = engine;
        return () => {
            engineRef.current = null;
            if (import.meta.env.DEV && window.__pipelineGroup === engine) delete window.__pipelineGroup;
            engine.dispose();
        };
    }, [supported]);

    const framedBucketRef = useRef(null);
    useEffect(() => {
        const engine = engineRef.current;
        if (!engine || !model) return;
        engine.setModel(model);
        engine.setFocus(focusId, { fly: true });
        // A new granularity redraws the whole calendar: frame it again, in the
        // view the reader is in. A data refresh keeps the camera where it is.
        if (framedBucketRef.current != null && framedBucketRef.current !== model.bucket) {
            engine.preset(engine.state().preset);
        }
        framedBucketRef.current = model.bucket;
    }, [model]);

    useEffect(() => {
        engineRef.current?.setFocus(focusId, { fly: true });
        // A pipeline focused from the scene opens Info, where its facts are.
        if (focusId != null) setInfoOpen(true);
    }, [focusId]);

    // Leaving the browser's full screen by its own means (Esc) ends ours.
    useEffect(() => {
        const onChange = () => {
            if (!document.fullscreenElement) setFull((f) => (f === 'native' ? null : f));
        };
        document.addEventListener('fullscreenchange', onChange);
        return () => document.removeEventListener('fullscreenchange', onChange);
    }, []);
    // The overlay stands in for the browser's full screen, Esc included: as
    // there, that Esc only leaves full screen (taken in the capture phase, so
    // the scene's own Esc — clear the focus — never sees it).
    useEffect(() => {
        if (full !== 'overlay') return undefined;
        const onKey = (e) => {
            if (e.key !== 'Escape') return;
            e.stopPropagation();
            setFull(null);
        };
        window.addEventListener('keydown', onKey, true);
        return () => window.removeEventListener('keydown', onKey, true);
    }, [full]);
    const toggleFull = () => {
        if (full) {
            if (full === 'native' && document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
            setFull(null);
            return;
        }
        const stage = hostRef.current;
        if (stage?.requestFullscreen) {
            stage.requestFullscreen().then(() => setFull('native'), () => setFull('overlay'));
        } else {
            setFull('overlay');
        }
    };

    const focused = model && focusId != null
        ? model.pipelines.find((p) => p.id === focusId) : null;

    if (!supported || engineError) {
        return (
            <Alert severity="warning" variant="outlined" data-testid="pipelines-group-unsupported">
                The pipeline group view needs WebGL, which this browser did not provide
                {engineError ? ` (${engineError})` : ''}. The Cards and Table views show the same plans.
            </Alert>
        );
    }

    const column = focused ? model.columns.find((col) => col.key === focused.bucket) : null;
    return (
        <Box data-testid="pipelines-group-view">
            <Box
                ref={hostRef}
                data-testid="pipelines-group-stage"
                data-preset={preset}
                data-ready={model ? 'true' : 'false'}
                data-bucket={bucket}
                data-full={full || ''}
                sx={{
                    position: 'relative',
                    height: 'calc(100vh - 220px)',
                    minHeight: 480,
                    borderRadius: 2,
                    overflow: 'hidden',
                    border: '1px solid',
                    borderColor: 'divider',
                    background: P.bg,
                    ...(full === 'overlay' && {
                        position: 'fixed', inset: 0, width: '100vw', height: '100vh', minHeight: 0,
                        zIndex: 1300, borderRadius: 0, border: 'none',
                    }),
                    ...(full === 'native' && { height: '100vh', borderRadius: 0, border: 'none' }),
                    '& .pg-label': {
                        fontFamily: 'Roboto, Helvetica, Arial, sans-serif',
                        whiteSpace: 'nowrap',
                        pointerEvents: 'none',
                        userSelect: 'none',
                        transition: 'opacity 150ms',
                    },
                    '& .pg-label-column': {
                        color: '#fff', fontSize: 14, fontWeight: 700, letterSpacing: '0.02em',
                        padding: '2px 10px', borderRadius: '4px',
                        background: 'rgba(12, 29, 52, 0.88)', border: `1px solid ${P.accent}`,
                    },
                    '& .pg-label-gap': {
                        color: VIEWER.head, fontSize: 11, fontStyle: 'italic',
                    },
                    '& .pg-label-pipeline': {
                        color: P.text, fontSize: 13, fontWeight: 700, padding: '2px 8px',
                        borderRadius: '4px', background: 'rgba(13, 20, 32, 0.78)',
                        border: `1px solid ${P.line}`,
                    },
                    '& .pg-label-dim': { opacity: 0.35 },
                    '& .pg-label-initiative': {
                        color: P.text, fontSize: 11, fontWeight: 600, padding: '1px 6px',
                        borderLeft: '3px solid var(--pg-band)', background: 'rgba(13, 20, 32, 0.7)',
                        maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis',
                    },
                    '& .pg-label-epic': {
                        color: P.text, fontSize: 10, padding: '0 4px', borderRadius: '3px',
                        background: 'rgba(13, 20, 32, 0.6)', maxWidth: 140,
                        overflow: 'hidden', textOverflow: 'ellipsis',
                    },
                }}
            >
                {!model && (
                    <Stack alignItems="center" justifyContent="center" spacing={1}
                           sx={{ position: 'absolute', inset: 0, zIndex: 2, color: P.dim }}>
                        <CircularProgress size={28} />
                        <Typography variant="caption">
                            Loading {ids.length} plan{ids.length === 1 ? '' : 's'}…
                        </Typography>
                    </Stack>
                )}
                {model && !model.pipelines.length && (
                    <Typography variant="body2" sx={{
                        position: 'absolute', inset: 0, display: 'flex', alignItems: 'center',
                        justifyContent: 'center', color: P.dim, zIndex: 2, pointerEvents: 'none',
                    }}>
                        No pipelines match the filters.
                    </Typography>
                )}
                {hover && <HoverCard hover={hover} />}

                {/* ▾ CONTROLS — top-left; the Full screen switch just right of the word. */}
                <Box data-testid="pipelines-group-controls" sx={{
                    ...panelSx, top: 10, left: 10, px: 1.25, py: 1,
                    display: 'flex', flexDirection: 'column', gap: '7px', maxWidth: 'calc(100% - 340px)',
                    minWidth: 0,
                }}>
                    <Stack direction="row" alignItems="center" spacing={0.75}>
                        <PanelHead name="Controls" open={controlsOpen} onToggle={() => setControlsOpen((o) => !o)}
                                   testid="pipelines-group-controls-collapse" />
                        <ButtonBase onClick={toggleFull} data-testid="pipelines-group-fullscreen"
                                    aria-pressed={full ? 'true' : 'false'}
                                    title={full ? 'Leave full screen' : 'Full screen'}
                                    sx={{
                                        width: 16, height: 14, border: '1px solid #2d5a85', borderRadius: '3px',
                                        color: VIEWER.head, '&:hover': { color: VIEWER.text, borderColor: '#5fa3d4' },
                                    }}>
                            {full ? <FullscreenExitIcon sx={{ fontSize: 12 }} /> : <FullscreenIcon sx={{ fontSize: 12 }} />}
                        </ButtonBase>
                    </Stack>
                    {controlsOpen && (
                        <>
                            <ControlRow label="View">
                                <Button size="small" variant="outlined" sx={smallButtonSx}
                                        title="Clear the focus and return to the whole calendar"
                                        onClick={() => {
                                            // The engine first, so the focus effect that follows
                                            // finds nothing changed and starts no second flight.
                                            engineRef.current?.setFocus(null, { fly: false });
                                            engineRef.current?.preset('iso');
                                            onFocusChange?.(null);
                                        }}
                                        data-testid="pipelines-group-clear">
                                    Clear
                                </Button>
                                <Button size="small" sx={smallButtonSx}
                                        title={rotating ? 'Stop turning' : 'Turn the view about its centre'}
                                        onClick={() => engineRef.current?.setRotate(!rotating)}
                                        variant={rotating ? 'contained' : 'outlined'}
                                        startIcon={<ThreeSixtyIcon sx={{ fontSize: '14px !important' }} />}
                                        aria-pressed={rotating ? 'true' : 'false'}
                                        data-testid="pipelines-group-rotate">
                                    Rotate
                                </Button>
                                <ButtonGroup size="small" aria-label="View presets">
                                    {PRESET_BUTTONS.map((b) => (
                                        <Button key={b.value} sx={smallButtonSx}
                                                variant={preset === b.value ? 'contained' : 'outlined'}
                                                onClick={() => engineRef.current?.preset(b.value)}
                                                data-testid={`pipelines-group-view-${b.value === 'iso' ? 'default' : b.value}`}>
                                            {b.label}
                                        </Button>
                                    ))}
                                </ButtonGroup>
                            </ControlRow>
                            <ControlRow label="Calendar">
                                <ButtonGroup size="small" aria-label="Calendar columns">
                                    {CALENDAR_BUTTONS.map((b) => (
                                        <Button key={b.value} sx={smallButtonSx} title={b.title}
                                                variant={bucket === b.value ? 'contained' : 'outlined'}
                                                aria-pressed={bucket === b.value ? 'true' : 'false'}
                                                onClick={() => setBucket(b.value)}
                                                data-testid={`pipelines-group-calendar-${b.value}`}>
                                            {b.label}
                                        </Button>
                                    ))}
                                </ButtonGroup>
                            </ControlRow>
                        </>
                    )}
                </Box>

                {/* ▾ INFO — top-right: the calendar's index, or the focused pipeline. */}
                {model && model.pipelines.length > 0 && (
                    <Box data-testid="pipelines-group-info" sx={{
                        ...panelSx, top: 10, right: 10, width: infoOpen ? 300 : 'auto', px: 1.25, py: 1,
                        maxHeight: 'calc(100% - 60px)', display: 'flex', flexDirection: 'column',
                    }}>
                        <PanelHead name="Info" open={infoOpen} onToggle={() => setInfoOpen((o) => !o)}
                                   testid="pipelines-group-info-collapse" />
                        {infoOpen && (
                            <Box sx={{ overflow: 'auto', minHeight: 0, mt: '7px' }}>
                                {focused ? (
                                    <FocusInfo pipeline={focused} column={column} onOpen={onOpen}
                                               onClose={() => onFocusChange?.(null)}
                                               onSetStatus={onSetStatus && ((id, next) => {
                                                   const row = pipelines.find((p) => p.id === id);
                                                   return row ? onSetStatus(row, next) : undefined;
                                               })} />
                                ) : (
                                    <CalendarIndex model={model} onFocus={(id) => onFocusChange?.(id)} />
                                )}
                                <StatusKey />
                            </Box>
                        )}
                    </Box>
                )}

                {/* ▾ HELP — bottom-right, collapsed by default: the text slides out to the header's left. */}
                <Box data-testid="pipelines-group-help" data-open={helpOpen ? 'true' : 'false'} sx={{
                    ...panelSx, bottom: 10, right: 10, px: 1.25, py: 0.5, fontSize: 11, color: VIEWER.hint,
                    whiteSpace: 'nowrap', maxWidth: 'calc(100% - 20px)',
                    display: 'grid', alignItems: 'center',
                    gridTemplateColumns: helpOpen ? '1fr auto' : '0fr auto',
                    columnGap: helpOpen ? '8px' : 0,
                    transition: 'grid-template-columns 0.25s ease, column-gap 0.25s ease',
                    '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
                }}>
                    {/* Folding, the text slides in behind the header; open, its START
                        stays readable on a stage narrower than the line. */}
                    <Box sx={{ gridArea: '1 / 1', minWidth: 0, overflow: 'hidden', display: 'flex',
                               justifyContent: helpOpen ? 'flex-start' : 'flex-end' }}>
                        <Box component="span" data-testid="pipelines-group-help-text"
                             aria-hidden={helpOpen ? undefined : 'true'}
                             sx={{ flex: 'none' }}>
                            {HELP_TEXT}
                        </Box>
                    </Box>
                    <Box sx={{ gridArea: '1 / 2' }}>
                        <PanelHead name="Help" open={helpOpen} onToggle={() => setHelpOpen((o) => !o)}
                                   testid="pipelines-group-help-collapse" />
                    </Box>
                </Box>
            </Box>
        </Box>
    );
}
