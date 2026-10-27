// PipelineGroupView.jsx — the Pipelines page's "Pipeline group" view (req #3972).
//
// Every pipeline the page's filters show, in ONE 3D scene, with all their
// initiatives, epics and requirements — the Data Center to a pipeline's
// SuperPod (user directive). The scene is `buildPipelineGroupModel`
// (pipelineGroupModel.js) drawn by `createPipelineGroupScene`
// (pipelineGroupScene.js); this component owns the reads, the toolbar, the
// hover card, the focus panel and the key.
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
import ButtonGroup from '@mui/material/ButtonGroup';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import IconButton from '@mui/material/IconButton';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import CloseIcon from '@mui/icons-material/Close';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import ThreeSixtyIcon from '@mui/icons-material/ThreeSixty';

import { useComposedPipelines } from '../hooks/useDataQueries';
import { adaptComposedPipeline } from '../SwarmView/pipelines/pipelineAdapter';
import { localDayOf } from '../SwarmView/pipelines/pipelinePlanTime';
import {
    computePlanLayout, DEFAULT_PLAN_PALETTE, PLAN_VIZ_PALETTE,
} from '../SwarmView/pipelines/pipelinePlanLayout';
import { pipelineStatusChipProps } from '../SwarmView/pipelines/pipelineChipStyles';
import { buildPipelineGroupModel, GROUP_STATUS_LEGEND, groupStatusColor } from './pipelineGroupModel';
import { createPipelineGroupScene, webglAvailable } from './pipelineGroupScene';

const P = PLAN_VIZ_PALETTE;

const PRESET_BUTTONS = [
    { value: 'iso', label: 'Default' },
    { value: 'top', label: 'Top' },
    { value: 'front', label: 'Front' },
    { value: 'side', label: 'Side' },
];

const MONO = '"SF Mono", "JetBrains Mono", Menlo, monospace';

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
                    Click to focus
                </Typography>
            )}
        </Paper>
    );
}

function FocusPanel({ pipeline, onOpen, onClose }) {
    const c = pipeline.counts;
    return (
        <Paper elevation={6} data-testid="pipelines-group-focus" sx={{
            position: 'absolute', top: 12, right: 12, width: 300, maxHeight: 'calc(100% - 24px)',
            overflow: 'auto', p: 1.5, zIndex: 2,
            background: 'rgba(17, 27, 43, 0.96)', color: P.text, border: `1px solid ${P.line}`,
        }}>
            <Stack direction="row" alignItems="flex-start" spacing={1}>
                <Typography variant="subtitle1" sx={{ fontWeight: 700, flex: 1, lineHeight: 1.3 }}>
                    {pipeline.title}
                </Typography>
                <IconButton size="small" onClick={onClose} aria-label="Clear focus"
                            sx={{ color: P.dim, mt: -0.5 }} data-testid="pipelines-group-focus-close">
                    <CloseIcon fontSize="small" />
                </IconButton>
            </Stack>
            <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 0.5, mb: 1 }}>
                {pipeline.status && (
                    <Chip size="small" label={pipeline.status} {...pipelineStatusChipProps(pipeline.status)} />
                )}
                <Typography variant="caption" sx={{ color: P.dim }}>#{pipeline.id}</Typography>
            </Stack>
            <Typography variant="body2" sx={{ color: P.dim }}>
                {c.initiatives} initiative{c.initiatives === 1 ? '' : 's'} · {c.epics} epic
                {c.epics === 1 ? '' : 's'} · {c.requirements} requirement{c.requirements === 1 ? '' : 's'}
            </Typography>
            <Typography variant="body2" sx={{ color: P.dim, mb: 1 }}>
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
                        <Typography variant="caption" sx={{ color: P.dim, fontFamily: MONO }}>
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
        </Paper>
    );
}

/**
 * @param {Object[]} pipelines     the page's filtered, hand-sorted list rows
 * @param {Object[]} machines
 * @param {number}   refetchInterval   the composed reads' refresh (the thumbnails')
 * @param {?number}  focusId       the focused pipeline (the page's `?focus=`)
 * @param {(id: ?number) => void} onFocusChange
 * @param {(id: number) => void}  onOpen   open a plan's visualizer
 */
export default function PipelineGroupView({
    pipelines, machines = [], refetchInterval, focusId = null, onFocusChange, onOpen,
}) {
    const [supported] = useState(() => webglAvailable());
    // The page hands a freshly filtered array every render; what the scene
    // draws of a list row is its id, title and status, so that is the key.
    const pipelinesKey = pipelines.map((p) => `${p.id}:${p.pipeline_status}:${p.title}`).join('|');
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
    const today = localDayOf(new Date());
    const model = useMemo(() => {
        if (!settled) return null;
        const now = new Date();
        return buildPipelineGroupModel(
            pipelines.map((p, i) => planForGroup(p, queries[i], stableMachines, now)));
    }, [settled, readKey, pipelinesKey, stableMachines, today]);

    const hostRef = useRef(null);
    const engineRef = useRef(null);
    const [engineError, setEngineError] = useState(null);
    const [preset, setPreset] = useState('iso');
    const [rotating, setRotating] = useState(false);
    const [hover, setHover] = useState(null);
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

    useEffect(() => {
        const engine = engineRef.current;
        if (!engine || !model) return;
        engine.setModel(model);
        engine.setFocus(focusId, { fly: true });
    }, [model]);

    useEffect(() => {
        engineRef.current?.setFocus(focusId, { fly: true });
    }, [focusId]);

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

    const c = model?.counts;
    return (
        <Box data-testid="pipelines-group-view">
            <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mb: 1, flexWrap: 'wrap', rowGap: 1 }}>
                <ButtonGroup size="small" variant="outlined" aria-label="View">
                    <Tooltip title="Clear the focus and return to the whole group">
                        <Button onClick={() => {
                            // The engine first, so the focus effect that follows
                            // finds nothing changed and starts no second flight.
                            engineRef.current?.setFocus(null, { fly: false });
                            engineRef.current?.preset('iso');
                            onFocusChange?.(null);
                        }}
                                data-testid="pipelines-group-clear">
                            Clear
                        </Button>
                    </Tooltip>
                    <Tooltip title={rotating ? 'Stop turning' : 'Turn the view about its centre'}>
                        <Button onClick={() => engineRef.current?.setRotate(!rotating)}
                                variant={rotating ? 'contained' : 'outlined'}
                                startIcon={<ThreeSixtyIcon />}
                                data-testid="pipelines-group-rotate">
                            Rotate
                        </Button>
                    </Tooltip>
                </ButtonGroup>
                <ButtonGroup size="small" aria-label="View presets">
                    {PRESET_BUTTONS.map((b) => (
                        <Button key={b.value}
                                variant={preset === b.value ? 'contained' : 'outlined'}
                                onClick={() => engineRef.current?.preset(b.value)}
                                data-testid={`pipelines-group-view-${b.value === 'iso' ? 'default' : b.value}`}>
                            {b.label}
                        </Button>
                    ))}
                </ButtonGroup>
                {c && (
                    <Typography variant="body2" color="text.secondary" data-testid="pipelines-group-counts">
                        {c.pipelines} pipeline{c.pipelines === 1 ? '' : 's'} · {c.initiatives} initiatives
                        · {c.epics} epics · {c.requirements} requirements ({c.met} met)
                    </Typography>
                )}
            </Stack>

            <Box
                ref={hostRef}
                data-testid="pipelines-group-stage"
                data-preset={preset}
                data-ready={model ? 'true' : 'false'}
                sx={{
                    position: 'relative',
                    height: 'calc(100vh - 260px)',
                    minHeight: 480,
                    borderRadius: 2,
                    overflow: 'hidden',
                    border: '1px solid',
                    borderColor: 'divider',
                    background: P.bg,
                    '& .pg-label': {
                        fontFamily: 'Roboto, Helvetica, Arial, sans-serif',
                        whiteSpace: 'nowrap',
                        pointerEvents: 'none',
                        userSelect: 'none',
                        transition: 'opacity 150ms',
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
                {focused && (
                    <FocusPanel pipeline={focused} onOpen={onOpen} onClose={() => onFocusChange?.(null)} />
                )}
                <Paper elevation={0} data-testid="pipelines-group-legend" sx={{
                    position: 'absolute', left: 12, bottom: 12, px: 1.25, py: 0.75, zIndex: 2,
                    background: 'rgba(13, 20, 32, 0.82)', color: P.text, border: `1px solid ${P.line}`,
                    pointerEvents: 'none',
                }}>
                    <Typography variant="caption" sx={{ color: P.dim, display: 'block', mb: 0.25 }}>
                        Requirement status
                    </Typography>
                    <Stack direction="row" spacing={1.25} sx={{ flexWrap: 'wrap', rowGap: 0.25 }}>
                        {GROUP_STATUS_LEGEND.map((s) => (
                            <Stack key={s.status} direction="row" spacing={0.5} alignItems="center">
                                <Dot color={s.color} size={9} />
                                <Typography variant="caption">{s.label}</Typography>
                            </Stack>
                        ))}
                    </Stack>
                </Paper>
                <Typography variant="caption" sx={{
                    position: 'absolute', right: 12, bottom: 10, zIndex: 2, color: P.dim,
                    pointerEvents: 'none', textAlign: 'right',
                }}>
                    Drag to orbit · right-drag to pan · scroll to zoom · arrows / WASD to move
                    <br />
                    Click a pipeline to focus · double-click to zoom in · Esc to clear
                </Typography>
            </Box>
        </Box>
    );
}
