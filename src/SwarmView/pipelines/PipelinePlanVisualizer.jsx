// PipelinePlanVisualizer.jsx — the Plan (no time anchor) mode of
// /swarm/pipeline/:id (req #3115), the product form of the POC viz-generate.py
// Plan mode archived in req #3080. SINGLE VIEW: the Timeline and Requirements
// modes were deliberately not carried (POC addendum 2026-07-26).
//
// ── Interaction: the Swarm Visualizer's feel, this page's look ─────────────
// react-konva + d3-zoom, the KonvaSwarmCanvas.jsx pattern verbatim (the
// RECOMMENDED parity path in the req #3080 closure decision log): the d3-zoom
// BEHAVIOR computes {x, y, k} and draws nothing; the transform is applied to one
// Konva <Group>. Two-axis drag-pan, wheel zoom, dblclick.zoom disabled, manual
// DOM click hit-test (d3 owns the pointer gesture and can swallow Konva's
// synthetic click), grab/grabbing cursors. NO scrollbars exist at all — the
// stage fills a fixed container (production directive: no visible horizontal
// scrollbar).
//
// Level-of-detail via the SAME semanticLevel() the swarm canvas uses, so the
// three depth levels feel identical. Mapping (worker judgment, documented per
// the requirement):
//   out — epic bands, beads, dependency arcs, batch boxes
//   mid — + step labels (ID or Title per toggle) + requirement ids
//   in  — + per-step title line (the reserved slot) + the hover datacard is the
//         full detail surface at every level
// Unlike the swarm canvas, TEXT DRAWS IN WORLD COORDINATES (scales with zoom):
// the zero-label-overlap guarantee is geometric — computed column widths and
// lane pitches — and it must hold at every k. Counter-scaled labels would break
// it on zoom-out; the POC (a scaled SVG) worked exactly this way.
//
// ── Design language ────────────────────────────────────────────────────────
// The POC page's palette (dark navy panel, mono type, EPAL epic colors, teal
// batch accent) renders verbatim in both app themes — the directive is to keep
// THIS page's look, not the swarm canvas's day-row language.
//
// ── Data discipline ────────────────────────────────────────────────────────
// Requirement-centric: every mark derives from plan rows + hierarchy (design
// rule 9 — no session data). Generated labels carry NO '#'. Click targets
// (production directives): requirement id → /swarm/requirement/:id; bead →
// Table mode scrolled/highlighted to the row (onStepFocus); epic band label →
// /swarm/features?epic=<id> (the minimal target — no dedicated epic pages).

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Stage, Layer, Group, Rect, Circle, Line, Text, Path } from 'react-konva';
import Konva from 'konva';
import { select } from 'd3-selection';
import { zoom as d3zoom, zoomIdentity } from 'd3-zoom';

import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Typography from '@mui/material/Typography';

import { useViewPreference } from '../../hooks/useViewPreference';
import { semanticLevel } from '../konvaSwarmModel';
import {
    formatTimeGates, rowMachineLabel, batchMachineLabel, STEP_RUNNING,
} from './pipelineViewModel';
import { stepStateLabel, runLabel } from './pipelineChipStyles';
import { OrderViolationsAlert } from './PipelinePlanTable';
import {
    computePlanLayout, beadStyle,
    PLAN_VIZ_PALETTE as P, PLAN_VIZ_FONT as F, BEAD_RADIUS,
} from './pipelinePlanLayout';
import '../../CalendarFC/swarmVisualizer.css';

const REQ_LAYOUT_KEY = 'darwin-pipeline-viz-req-layout';
const STEP_LABEL_KEY = 'darwin-pipeline-viz-step-label';
const MONO = '"SF Mono", "JetBrains Mono", Menlo, monospace';

const LEVEL_NAME = { out: 'Overview', mid: 'Plan', in: 'Detail' };

// Legend swatch — a colored dot (or ring) in the POC vocabulary.
function LegendDot({ fill, ring, dashed, label }) {
    return (
        <Stack direction="row" spacing={0.5} alignItems="center">
            <Box sx={{
                width: 10, height: 10, flexShrink: 0,
                borderRadius: dashed ? '3px' : '50%',
                bgcolor: fill || 'transparent',
                border: ring ? `2px ${dashed ? 'dashed' : 'solid'} ${ring}` : 'none',
            }} />
            <Typography variant="caption" sx={{ color: P.dim, whiteSpace: 'nowrap' }}>
                {label}
            </Typography>
        </Stack>
    );
}

export default function PipelinePlanVisualizer({ plan, timezone, onStepFocus }) {
    const navigate = useNavigate();
    const [reqLayoutPref, setReqLayoutPref] = useViewPreference(REQ_LAYOUT_KEY, 'horizontal');
    const [stepLabelPref, setStepLabelPref] = useViewPreference(STEP_LABEL_KEY, 'id');
    const reqLayout = reqLayoutPref === 'vertical' ? 'vertical' : 'horizontal';
    const stepLabel = stepLabelPref === 'title' ? 'title' : 'id';

    const rows = plan.rows || [];
    const rowById = useMemo(() => new Map(rows.map((r) => [r.id, r])), [rows]);
    const batchByLetter = useMemo(
        () => new Map((plan.batches || []).map((b) => [b.letter, b])), [plan.batches]);
    const eligibleStepIds = plan.eligibleStepIds || new Set();

    const layout = useMemo(
        () => computePlanLayout(rows, plan.batches || [], { reqLayout, stepLabel }),
        [rows, plan.batches, reqLayout, stepLabel]);

    // The container is tracked as STATE, not a bare ref: with an empty plan the
    // component returns the empty panel and no container exists — if the first
    // step arrives later (focus refetch on a draft pipeline), effects keyed on
    // a ref would never re-run and the canvas would stay blank forever (review
    // finding). A ref callback re-fires every effect when the node appears.
    const [containerEl, setContainer] = useState(null);
    const stageRef = useRef(null);
    const layerRef = useRef(null);
    const zoomRef = useRef(null);
    const downRef = useRef(null);
    const draggingRef = useRef(false);
    const [size, setSize] = useState({ w: 0, h: 0 });
    const [transform, setTransform] = useState(null);
    const [card, setCard] = useState(null);   // {x, y, kind: 'step'|'batch', ...}

    useLayoutEffect(() => {
        if (!containerEl) return undefined;
        const ro = new ResizeObserver((entries) => {
            const cr = entries[0]?.contentRect;
            if (cr) setSize({ w: Math.round(cr.width), h: Math.round(cr.height) });
        });
        ro.observe(containerEl);
        setSize({ w: containerEl.clientWidth, h: containerEl.clientHeight });
        return () => ro.disconnect();
    }, [containerEl]);

    // Fit-to-width base scale — the POC page rendered the whole plan across the
    // panel; kBase is that view, and semanticLevel(curK / kBase) matches the
    // swarm canvas's ratio semantics exactly.
    const kBase = size.w > 0 ? size.w / layout.width : 0.7;
    const curK = transform ? transform.k : kBase;
    const level = semanticLevel(kBase > 0 ? curK / kBase : 1);

    // The d3-zoom behavior (KonvaSwarmCanvas pattern).
    useEffect(() => {
        const el = containerEl;
        if (!el || size.w === 0) return undefined;
        const sel = select(el);
        const zb = d3zoom()
            .scaleExtent([kBase * 0.25, kBase * 8])
            .filter((ev) => (ev.type === 'wheel' ? true : !ev.button))
            .clickDistance(5)
            .on('zoom', (ev) => {
                const tr = ev.transform;
                setTransform({ x: tr.x, y: tr.y, k: tr.k });
                // The world slides under a stationary datacard, which would
                // then caption whatever bead ends up beneath it — dismiss.
                setCard(null);
            })
            .on('start', (ev) => {
                if (!ev.sourceEvent || ev.sourceEvent.type === 'wheel') return;
                draggingRef.current = true;
                const c = stageRef.current?.container();
                if (c) c.style.cursor = 'grabbing';
            })
            .on('end', () => {
                if (!draggingRef.current) return;
                draggingRef.current = false;
                const c = stageRef.current?.container();
                if (c) c.style.cursor = 'grab';
            });
        sel.call(zb);
        sel.on('dblclick.zoom', null);
        const sc = stageRef.current?.container();
        if (sc) sc.style.cursor = 'grab';
        zoomRef.current = zb;
        return () => { sel.on('.zoom', null); };
    }, [containerEl, size.w, size.h, kBase]);

    // Fit the plan on first size and whenever a layout toggle changes the world
    // dimensions wholesale (the POC re-rendered from scratch on those toggles).
    useEffect(() => {
        const el = containerEl;
        const zb = zoomRef.current;
        if (!el || !zb || size.w === 0) return;
        select(el).call(zb.transform, zoomIdentity.scale(kBase));
    }, [containerEl, size.w, size.h, kBase, reqLayout, stepLabel]);

    // Manual DOM click hit-test: d3-zoom owns the pointer gesture, so a
    // non-drag click is resolved against the stage and fired as the Konva
    // 'activate' event on the topmost shape (react-konva binds onActivate).
    useEffect(() => {
        const el = containerEl;
        if (!el) return undefined;
        const onDown = (e) => { downRef.current = { x: e.clientX, y: e.clientY }; };
        const onClick = (e) => {
            const d = downRef.current;
            if (d && Math.hypot(e.clientX - d.x, e.clientY - d.y) > 4) return;
            const stage = stageRef.current;
            if (!stage) return;
            const rect = el.getBoundingClientRect();
            const node = stage.getIntersection({
                x: e.clientX - rect.left, y: e.clientY - rect.top,
            });
            if (node) node.fire('activate', { evt: e }, false);
        };
        el.addEventListener('mousedown', onDown);
        el.addEventListener('click', onClick);
        return () => {
            el.removeEventListener('mousedown', onDown);
            el.removeEventListener('click', onClick);
        };
    }, [containerEl]);

    // Running-bead pulse (POC @keyframes pulse) — one Konva.Animation drives
    // every node named 'pulse-bead'; no React re-render per frame. Keyed on
    // size.w because the Layer only mounts once the container has measured —
    // an effect keyed on rows alone runs before the Layer exists and never
    // again (review finding). Skipped entirely when nothing is running: an
    // unconditional animation would redraw the whole layer at ~60fps on every
    // completed pipeline.
    const hasRunning = useMemo(
        () => rows.some((r) => r.state === STEP_RUNNING), [rows]);
    useEffect(() => {
        const layer = layerRef.current;
        if (!layer || !hasRunning) return undefined;
        const anim = new Konva.Animation((frame) => {
            const op = 0.45 + 0.55 * Math.abs(Math.sin((frame?.time || 0) / 480));
            layer.find('.pulse-bead').forEach((n) => n.opacity(op));
        }, layer);
        anim.start();
        return () => { anim.stop(); };
    }, [rows, hasRunning, size.w]);

    const t = transform || { x: 0, y: 0, k: kBase };

    const cursorPointer = useCallback((e, on) => {
        const stage = e?.target?.getStage?.();
        if (!stage || draggingRef.current) return;
        stage.container().style.cursor = on ? 'pointer' : 'grab';
    }, []);

    const showStepCard = useCallback((row, e) => {
        const p = e?.target?.getStage?.()?.getPointerPosition?.();
        if (p) setCard({ x: p.x, y: p.y, kind: 'step', row });
    }, []);
    const showBatchCard = useCallback((letter, e) => {
        const batch = batchByLetter.get(letter);
        const p = e?.target?.getStage?.()?.getPointerPosition?.();
        if (p && batch) setCard({ x: p.x, y: p.y, kind: 'batch', batch });
    }, [batchByLetter]);
    const hideCard = useCallback(() => setCard(null), []);

    if (!rows.length) {
        return (
            <Box>
                <OrderViolationsAlert plan={plan} />
                <Paper variant="outlined" sx={{ p: 4, textAlign: 'center' }}
                       data-testid="pipeline-plan-viz-empty">
                    <Typography variant="body2" color="text.secondary">
                        This pipeline has no steps yet.
                    </Typography>
                </Paper>
            </Box>
        );
    }

    const hasBatchBoxes = layout.batchBoxes.length > 0;

    // ── World-space nodes ───────────────────────────────────────────────────
    const worldNodes = [];

    layout.bands.forEach((band) => {
        worldNodes.push(
            <Rect key={`band-${band.key}`} x={2} y={band.y} width={layout.width - 4}
                  height={band.height} cornerRadius={8}
                  fill={band.color} opacity={0.06} />,
            <Rect key={`bandstroke-${band.key}`} x={2} y={band.y} width={layout.width - 4}
                  height={band.height} cornerRadius={8}
                  stroke={band.color} strokeWidth={1} opacity={0.35} />);
        for (let l = 0; l < band.sub; l++) {
            const wy = band.y + band.headerH + l * band.pitch + 10;
            worldNodes.push(
                <Line key={`wire-${band.key}-${l}`}
                      points={[36, wy, layout.width - 14, wy]}
                      stroke={P.wire} strokeWidth={1.2} opacity={0.18} />);
        }
    });

    layout.arcs.forEach((arc, i) => {
        if (arc.straight) {
            worldNodes.push(
                <Line key={`arc-${i}`} points={[arc.x1, arc.y1, arc.x2, arc.y2]}
                      stroke="#3d5a86" strokeWidth={1.2} opacity={0.65}
                      listening={false} />);
        } else {
            worldNodes.push(
                <Path key={`arc-${i}`} data={arc.path} stroke="#3d5a86"
                      strokeWidth={1.2} opacity={0.65} listening={false} />);
        }
    });

    layout.batchBoxes.forEach((box) => {
        // Konva has no independent fill/stroke opacity — the POC's 4% wash and
        // 85% dashed edge are rgba colors on one Rect.
        worldNodes.push(
            <Rect key={`batch-${box.letter}`} x={box.x} y={box.y}
                  width={box.width} height={box.height} cornerRadius={10}
                  fill="rgba(74, 217, 200, 0.04)"
                  stroke="rgba(74, 217, 200, 0.85)" dash={[6, 4]} strokeWidth={1.2}
                  onMouseEnter={(e) => { cursorPointer(e, true); showBatchCard(box.letter, e); }}
                  onMouseLeave={(e) => { cursorPointer(e, false); hideCard(); }} />);
    });

    rows.forEach((row) => {
        const n = layout.nodes.get(row.id);
        if (!n) return;
        const style = beadStyle(row, eligibleStepIds.has(row.id));
        worldNodes.push(
            <Group key={`bead-${row.id}`} name={style.pulse ? 'pulse-bead' : undefined}>
                <Circle x={n.x} y={n.y} radius={BEAD_RADIUS}
                        fill={style.fill} stroke={style.ring}
                        strokeWidth={style.ringWidth} />
                {style.check && (
                    <Text x={n.x - 4} y={n.y - 4.5} text="✓" fontSize={F.check}
                          fill={P.doneCheck} listening={false} />
                )}
            </Group>);
        // Hit target on top of the bead (and above any batch box under it).
        worldNodes.push(
            <Circle key={`hit-${row.id}`} x={n.x} y={n.y} radius={BEAD_RADIUS + 5}
                    fill="transparent"
                    onMouseEnter={(e) => { cursorPointer(e, true); showStepCard(row, e); }}
                    onMouseLeave={(e) => { cursorPointer(e, false); hideCard(); }}
                    onActivate={() => onStepFocus?.(row.id)} />);
    });

    layout.labels.forEach((label, i) => {
        if (label.kind === 'step') {
            if (level === 'out') return;
            worldNodes.push(
                <Text key={`lbl-${i}`} x={label.x} y={label.y} text={label.text}
                      fontSize={F.label} fontFamily={MONO} fill={P.text}
                      listening={false} />);
        } else if (label.kind === 'req') {
            if (level === 'out') return;
            worldNodes.push(
                <Text key={`lbl-${i}`} x={label.x} y={label.y} text={label.text}
                      fontSize={F.req} fontFamily={MONO} fill={P.req}
                      onMouseEnter={(e) => cursorPointer(e, true)}
                      onMouseLeave={(e) => cursorPointer(e, false)}
                      onActivate={() => navigate(`/swarm/requirement/${label.reqId}`)} />);
        } else if (label.kind === 'title') {
            if (level !== 'in') return;
            worldNodes.push(
                <Text key={`lbl-${i}`} x={label.x} y={label.y} text={label.text}
                      fontSize={F.title} fontFamily={MONO} fill={P.dim}
                      listening={false} />);
        } else if (label.kind === 'epic') {
            const clickable = label.epicId != null;
            worldNodes.push(
                <Text key={`lbl-${i}`} x={label.x} y={label.y} text={label.text}
                      fontSize={F.epic} fontFamily={MONO} fontStyle="bold"
                      fill={(layout.bands.find((b) => b.epicId === label.epicId) || {}).color || P.text}
                      onMouseEnter={clickable ? (e) => cursorPointer(e, true) : undefined}
                      onMouseLeave={clickable ? (e) => cursorPointer(e, false) : undefined}
                      onActivate={clickable
                          ? () => navigate(`/swarm/features?epic=${label.epicId}`)
                          : undefined}
                      listening={clickable} />);
        } else if (label.kind === 'batch') {
            worldNodes.push(
                <Text key={`lbl-${i}`} x={label.x} y={label.y} text={label.text}
                      fontSize={F.batch} fontFamily={MONO} fill={P.batch}
                      listening={false} />);
        }
    });

    return (
        <Box>
            <OrderViolationsAlert plan={plan} />

            {/* Toolbar: the two POC layout toggles + the legend. */}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1,
                        flexWrap: 'wrap' }}>
                <ToggleButtonGroup value={reqLayout} exclusive size="small"
                                   onChange={(_e, v) => v && setReqLayoutPref(v)}
                                   data-testid="pipeline-viz-reqlayout-toggle">
                    <ToggleButton value="horizontal" sx={{ px: 1.5, textTransform: 'none' }}>
                        Reqs: Horizontal
                    </ToggleButton>
                    <ToggleButton value="vertical" sx={{ px: 1.5, textTransform: 'none' }}>
                        Reqs: Vertical
                    </ToggleButton>
                </ToggleButtonGroup>
                <ToggleButtonGroup value={stepLabel} exclusive size="small"
                                   onChange={(_e, v) => v && setStepLabelPref(v)}
                                   data-testid="pipeline-viz-steplabel-toggle">
                    <ToggleButton value="id" sx={{ px: 1.5, textTransform: 'none' }}>
                        Step: ID
                    </ToggleButton>
                    <ToggleButton value="title" sx={{ px: 1.5, textTransform: 'none' }}>
                        Step: Title
                    </ToggleButton>
                </ToggleButtonGroup>
                <Box sx={{ flexGrow: 1 }} />
                <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap"
                       useFlexGap>
                    <LegendDot fill={P.doneFill} label="Complete" />
                    <LegendDot fill={P.runningFill} label="Running" />
                    <LegendDot fill={P.pendingFill} ring="#5b7293" label="Scheduled" />
                    <LegendDot ring={P.manualRing} label="Manual" />
                    <LegendDot ring={P.eligibleRing} label="eligible now" />
                    {/* Batch key ONLY when a batch box is actually drawn —
                        production directive, kept from the POC. */}
                    {hasBatchBoxes && (
                        <Box data-testid="pipeline-viz-batch-legend">
                            <LegendDot ring={P.batch} dashed
                                       label="launch batch = one /swarm-start" />
                        </Box>
                    )}
                </Stack>
            </Box>

            <Box ref={setContainer} data-testid="pipeline-plan-visualizer"
                 sx={{ position: 'relative', height: 'calc(100vh - 350px)',
                        minHeight: 460, overflow: 'hidden', borderRadius: '8px',
                        border: `1px solid ${P.line}`, background: P.panel,
                        touchAction: 'none' }}>
                {size.w > 0 && (
                    <Stage ref={stageRef} width={size.w} height={size.h}>
                        <Layer ref={layerRef}>
                            <Group x={t.x} y={t.y} scaleX={t.k} scaleY={t.k}>
                                {worldNodes}
                            </Group>
                        </Layer>
                    </Stage>
                )}

                <Box sx={{ position: 'absolute', bottom: 8, right: 10, fontSize: 11,
                            color: P.dim, background: 'rgba(0,0,0,0.45)',
                            px: 1, py: 0.25, borderRadius: '10px',
                            pointerEvents: 'none', userSelect: 'none' }}
                     data-testid="pipeline-viz-zoom-level">
                    {LEVEL_NAME[level]} · drag to pan · scroll to zoom
                </Box>

                {card && (
                    <PlanDataCard card={card} timezone={timezone}
                                  containerW={size.w} containerH={size.h} />
                )}
            </Box>
        </Box>
    );
}

// ── Hover datacard (reuses the shared .ts-datacard CSS) ─────────────────────
// Step: title, state, run, deps (step gates + wall-clock gates through the ONE
// shared formatter), dominant + FULL epic/feature label sets from the engine,
// requirement ids, machines. Batch: the launch unit with its exact /swarm-start
// argument list. No session data anywhere (design rule 9); no generated '#'.
function PlanDataCard({ card, timezone, containerW, containerH }) {
    const CARD_W = 300;
    const cardRef = useRef(null);
    const [cardH, setCardH] = useState(0);
    useLayoutEffect(() => {
        if (cardRef.current) setCardH(cardRef.current.offsetHeight);
    }, [card]);
    const estH = cardH || 60;
    const left = Math.min(Math.max(8, card.x + 14), Math.max(8, containerW - CARD_W - 8));
    const top = Math.min(Math.max(8, card.y + 14), Math.max(8, containerH - estH - 8));

    const rowEl = (key, value) => (
        <div className="ts-datacard-row">
            <span className="ts-datacard-key">{key}</span><span>{value}</span>
        </div>
    );

    let body;
    if (card.kind === 'batch') {
        const b = card.batch;
        const timeGates = formatTimeGates(b.timeDeps, timezone);
        body = (
            <div className="ts-datacard">
                <div className="ts-datacard-title">Launch batch {b.letter}</div>
                {rowEl('Steps', b.stepIds.join(' '))}
                {rowEl('Gate', b.gateStepIds.length
                    ? `steps ${b.gateStepIds.join(', ')}` : 'no step gate')}
                {timeGates.map((g) => <div key={g}>{rowEl('After', g)}</div>)}
                {rowEl('Run', runLabel(b.run))}
                {b.machineLabels.length > 0 && rowEl('Machines', batchMachineLabel(b))}
                {rowEl('Launch', b.swarmStartCommand
                    ? <code style={{ fontSize: '0.85em' }}>{b.swarmStartCommand}</code>
                    : 'no linked requirements — nothing to launch')}
            </div>
        );
    } else {
        const r = card.row;
        const timeGates = formatTimeGates(r.timeDeps, timezone);
        const depText = r.depIds.length ? r.depIds.join(' ') : '—';
        const epicAll = (r.epicLabels || []).map((l) => l.title).join(' · ');
        const featAll = (r.featureLabels || []).map((l) => l.title).join(' · ');
        body = (
            <div className="ts-datacard">
                <div className="ts-datacard-title">Step {r.id} — {r.title || '(untitled)'}</div>
                {rowEl('State', stepStateLabel(r.state))}
                {rowEl('Run', runLabel(r.run))}
                {rowEl('Deps', depText)}
                {timeGates.map((g) => <div key={g}>{rowEl('After', g)}</div>)}
                {r.epic && rowEl('Epic', (r.epicLabels || []).length > 1
                    ? `${r.epic} (all: ${epicAll})` : r.epic)}
                {r.feature && rowEl('Feature', (r.featureLabels || []).length > 1
                    ? `${r.feature} (all: ${featAll})` : r.feature)}
                {rowEl('Reqs', r.reqIds.length ? r.reqIds.join(' ') : '—')}
                {/* Through the shared stripper: the engine degrades an unknown
                    machine id to '#<id>' and the no-'#' directive covers it. */}
                {rowEl('Machine', rowMachineLabel(r))}
            </div>
        );
    }

    return (
        <div ref={cardRef} className="ts-shared-tooltip" style={{
            position: 'absolute', left, top, maxWidth: CARD_W, zIndex: 20,
            pointerEvents: 'none',
        }}>
            {body}
        </div>
    );
}
