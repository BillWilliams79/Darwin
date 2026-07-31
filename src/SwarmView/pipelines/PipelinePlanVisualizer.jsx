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
import Typography from '@mui/material/Typography';

import { semanticLevel } from '../konvaSwarmModel';
import {
    formatTimeGates, rowMachineLabel, batchMachineLabel, STEP_RUNNING,
} from './pipelineViewModel';
import { fmtCost } from './pipelineModel';
import { stepStateLabel, runLabel } from './pipelineChipStyles';
import { OrderViolationsAlert } from './PipelinePlanTable';
import {
    computePlanLayout, beadStyle,
    PLAN_VIZ_PALETTE as P, PLAN_VIZ_FONT as F, BEAD_RADIUS,
} from './pipelinePlanLayout';
import '../../CalendarFC/swarmVisualizer.css';

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

// Machine colours for the requirement ids (req #3119) — the high-contrast
// ecosystem pairing (user directive 2026-07-27): each machine reads as its
// PLATFORM at a glance, so the two are told apart by association rather than by
// consulting a key.
//
// Keyed on `machines.platform`, NOT on position in the plan's machine list. A
// positional palette makes a machine's colour depend on which OTHER machines a
// plan happens to use, so the Mac mini would be one colour on a two-machine plan
// and another on a three-machine one — and the whole value of an ecosystem
// pairing is that it is the same everywhere.
const MACHINE_MAC_COLOR = '#FF5F56';       // Apple traffic-light red
const MACHINE_WINDOWS_COLOR = '#0078D4';   // Microsoft blue
const MACHINE_ANY_COLOR = '#8fa4c4';       // no pin — not a machine
// A machine outside the pairing still has to be distinguishable, so it takes a
// hue that is neither ecosystem colour.
const MACHINE_FALLBACK_PALETTE = ['#8ce99a', '#c8a2ff', '#6ee7e7', '#ffb86b', '#f78ca0'];

// Which ecosystem a MACHINE ROW belongs to. Colour is resolved per machine id —
// the requirement carries `machine_fk` and that id decides the colour — but the
// id itself says nothing about the ecosystem, so the machine record does.
// `platform` first because it is the field that means this; hostname/title only
// as a backstop, since a machine registered without a platform would otherwise
// silently drop out of the pairing into a fallback hue.
function machineEcosystem(machine) {
    const hay = `${machine?.platform || ''} ${machine?.title || ''} ${machine?.hostname || ''}`
        .toLowerCase();
    if (/darwin|mac|osx|os x/.test(hay)) return 'mac';
    if (/wsl|win32|windows|cygwin|msys|mchp/.test(hay)) return 'windows';
    return null;
}

export default function PipelinePlanVisualizer({
    plan, model, pipeline, timezone, onStepFocus,
    // Toolbar state is OWNED BY THE PAGE since req #3119 — the controls render in
    // the header row beside the pipeline name (the SwarmView/VisualizerToolbar
    // pattern, req #2407), so the panel is the canvas and nothing else.
    reqLayout = 'vertical', stepLabel = 'title', colorKey = 'state',
}) {
    const navigate = useNavigate();

    const rows = plan.rows || [];
    const rowById = useMemo(() => new Map(rows.map((r) => [r.id, r])), [rows]);
    const batchByLetter = useMemo(
        () => new Map((plan.batches || []).map((b) => [b.letter, b])), [plan.batches]);
    const eligibleStepIds = plan.eligibleStepIds || new Set();

    // Requirement name + status for the hover tooltip (req #3119). The canvas
    // keeps drawing bare IDS — a plan title is many times the width of the
    // column it hangs under, so putting names on the surface either shrinks them
    // to nothing or blows the layout apart. The name belongs on demand.
    // From the SAME light projection the page already read; no extra fetch.
    const reqInfo = useMemo(
        () => new Map((model?.requirements || [])
            .map((r) => [r.id, { title: r.title, status: r.requirement_status }])),
        [model]);
    const layout = useMemo(
        () => computePlanLayout(rows, plan.batches || [], { reqLayout, stepLabel }),
        [rows, plan.batches, reqLayout, stepLabel]);

    // ── Machine identity on the REQUIREMENT IDS (req #3119) ─────────────────
    // Machine rides the requirement ids, never the bead: the bead's fill already
    // carries derived state (rule 1), and repainting it would trade that reading
    // for this one. Colour + weight, so the distinction survives at small sizes.
    //
    // Colour comes from the machine's PLATFORM, so it is the same on every plan.
    const machineView = useMemo(() => {
        const reqMachine = new Map((model?.requirements || [])
            .map((r) => [r.id, r.machine_fk == null ? null : r.machine_fk]));
        const machineById = new Map((model?.machines || []).map((m) => [m.id, m]));
        const titleById = new Map((model?.machines || []).map((m) => [m.id, m.title]));
        const used = [...new Set([...reqMachine.values()].filter((v) => v != null))]
            .sort((a, b) => a - b);
        let fallbackNext = 0;
        const colorById = new Map(used.map((id) => {
            const eco = machineEcosystem(machineById.get(id));
            if (eco === 'mac') return [id, MACHINE_MAC_COLOR];
            if (eco === 'windows') return [id, MACHINE_WINDOWS_COLOR];
            const c = MACHINE_FALLBACK_PALETTE[fallbackNext % MACHINE_FALLBACK_PALETTE.length];
            fallbackNext += 1;
            return [id, c];
        }));
        const anyPresent = [...reqMachine.values()].some((v) => v == null);
        return {
            colorOf: (reqId) => {
                const m = reqMachine.get(reqId);
                return m == null ? MACHINE_ANY_COLOR : (colorById.get(m) || MACHINE_ANY_COLOR);
            },
            legend: [
                ...used.map((id) => ({
                    key: id, color: colorById.get(id),
                    label: titleById.get(id) || `Machine ${id}`,
                })),
                ...(anyPresent
                    ? [{ key: 'any', color: MACHINE_ANY_COLOR, label: 'Any' }] : []),
            ],
        };
    }, [model]);
    const byMachine = colorKey === 'machine';

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

    // The canvas fills whatever is left below it, MEASURED (req #3119). A
    // `calc(100vh - Npx)` constant — which is what the swarm canvas can afford,
    // because its chrome is fixed — assumes this page's header height, and this
    // page's header is not fixed: the breadcrumb, a one- or two-line description,
    // and an order-violations alert that appears only on some plans all move it.
    // Guessing put the panel 57px below the fold on the live plan. `top` does not
    // depend on the panel's own height, so writing height from it cannot loop.
    const [availH, setAvailH] = useState(null);
    useLayoutEffect(() => {
        if (!containerEl) return undefined;
        const recompute = () => {
            const { top } = containerEl.getBoundingClientRect();
            setAvailH(Math.max(480, Math.round(window.innerHeight - top - 14)));
        };
        recompute();
        window.addEventListener('resize', recompute);
        return () => window.removeEventListener('resize', recompute);
    }, [containerEl, plan, colorKey, reqLayout, stepLabel]);

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
    const showReqCard = useCallback((reqId, e) => {
        const p = e?.target?.getStage?.()?.getPointerPosition?.();
        if (p) setCard({ x: p.x, y: p.y, kind: 'req', reqId, info: reqInfo.get(reqId) });
    }, [reqInfo]);
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

    // ── Floating epic labels (req #3119, prototype item 3) ──────────────────
    // The epic name rides its band's top edge, CLAMPS to the top of the viewport
    // while any part of the band is visible, and slides away only as the band's
    // bottom passes. Static world text scrolls off the moment you pan into a tall
    // band, and a full-height canvas makes bands taller — so on the live plan you
    // could be four screens deep in a band with nothing on screen saying which.
    //
    // HTML overlay rather than a Konva node: the clamp is a per-frame position
    // that has nothing to do with the world transform, and computing it here
    // keeps the world purely a function of the layout. `pointerEvents: 'none'` on
    // the strip so it never eats a drag-pan; the label itself re-enables them so
    // the epic stays clickable (production directive).
    const LABEL_H = 20;      // the HTML chip's own height, in SCREEN px
    const CHAR_W = 7.3;      // 12px bold mono, for the width estimate
    const floatingEpics = layout.bands.map((band) => {
        // Band geometry in SCREEN space.
        const top = t.y + band.y * t.k;
        const bottom = t.y + (band.y + band.height) * t.k;
        const headerBottom = t.y + (band.y + band.headerH) * t.k;
        const left = t.x + 2 * t.k;
        const right = t.x + (layout.width - 2) * t.k;
        // Off-screen on EITHER axis means no label. Vertical alone was not
        // enough: panning far right leaves a band's rectangle entirely to the
        // left of the panel, and clamping x into a rectangle that is off-screen
        // puts the label off-screen with it — correct, but it should simply not
        // render. (Caught by the pan sweep, which found three labels at negative
        // x after a -1100px drag.)
        if (bottom < 0 || top > size.h) return null;
        if (right < 0 || left > size.w) return null;

        // VERTICAL: confined to the band's HEADER STRIP, never into lane space.
        //
        // The strip is the only part of the epic rectangle that holds no step
        // content, so this is what "must not overlap another swim lane's text"
        // reduces to. It also keeps the label inside its own rectangle at both
        // ends, which a plain viewport clamp did not: a band whose bottom edge
        // had scrolled just past the top of the view still parked its label at
        // the viewport top, i.e. below its own band.
        //
        // The label is sized in SCREEN px while the header is reserved in WORLD
        // px — that mismatch is the actual cause of the overlap. At fit zoom
        // (k≈0.67) a 40+14pxworld header is only ~36px on screen, and the label is
        // 20 of them; zoom out further and the strip becomes shorter than the
        // label, so the clamp below pins to the strip's TOP and lets it extend
        // over the band's own first lane rather than over a neighbouring band.
        const minY = top + 3;
        const maxY = Math.max(minY, headerBottom - LABEL_H - 2);
        const y = Math.min(Math.max(4, minY), maxY);
        // WHOLLY on screen or not at all. Testing only the label's TOP left a
        // band whose header strip ends 2px above the panel floor rendering a
        // label that hung 2px past it.
        if (y < 0 || y + LABEL_H > size.h) return null;

        // HORIZONTAL: inside the band rectangle too, so a pan never leaves the
        // label hanging in the margin beside the plan it labels.
        const estW = band.epic.length * CHAR_W + 18;
        // Confine to the part of the band that is BOTH inside the rectangle and
        // on screen. When the band has scrolled far enough that its visible
        // sliver is narrower than the label, there is no honest position left:
        // clamping to the rectangle alone hangs the label off the panel edge
        // (measured at x=-40 after a -1200px drag), and clamping to the panel
        // alone puts it outside the rectangle. Hide it instead — the band is
        // leaving anyway.
        const visLeft = Math.max(0, left);
        const visRight = Math.min(size.w, right);
        if (visRight - visLeft < estW + 12) return null;
        const x = Math.min(Math.max(visLeft + 6, left + 6), right - estW - 6);

        return {
            key: band.key == null ? 'none' : band.key,
            epicId: band.epicId,
            text: band.epic,
            color: band.color,
            x,
            y,
        };
    }).filter(Boolean);

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
            // band.laneY, not l × pitch — lanes have individual heights since
            // req #3119 and a constant-pitch wire would drift off its beads.
            const wy = band.y + band.headerH + band.laneY[l] + 10;
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
                      fontSize={F.req} fontFamily={MONO}
                      // Machine colour + bold on the ids themselves. Applied on
                      // the SAME node in both requirement layouts — the SVG
                      // prototype coloured only the horizontal one, because a
                      // `text { fill }` CSS rule beat the attribute on <text> but
                      // never reached its <tspan> children. Konva has no tspans,
                      // so the cause cannot recur here; the symptom is asserted
                      // against both layouts anyway.
                      // WHITE by default, machine colour when that key is on
                      // (user directive 2026-07-27). A requirement number is an
                      // identifier, and colouring it was reading as a status —
                      // status already lives in the bead's fill and the row
                      // highlight, which is where it belongs. The palette's
                      // `req` blue is retained for anything that wants it, but
                      // the id itself no longer carries a second signal.
                      fill={byMachine ? machineView.colorOf(label.reqId) : P.text}
                      fontStyle={byMachine ? 'bold' : 'normal'}
                      onMouseEnter={(e) => { cursorPointer(e, true); showReqCard(label.reqId, e); }}
                      onMouseLeave={(e) => { cursorPointer(e, false); hideCard(); }}
                      // Carry the plan's identity so the requirement page's Back
                      // returns HERE and not to the Roadmap (req #3119). The
                      // mode/layout/label toggles restore themselves — they are
                      // useViewPreference — so landing back on this route is
                      // enough to resume the view; only pan/zoom re-fits.
                      onActivate={() => navigate(`/swarm/requirement/${label.reqId}`,
                          pipeline?.id
                              ? { state: { from: 'pipeline', pipelineId: pipeline.id } }
                              : undefined)} />);
        } else if (label.kind === 'title') {
            if (level !== 'in') return;
            worldNodes.push(
                <Text key={`lbl-${i}`} x={label.x} y={label.y} text={label.text}
                      fontSize={F.title} fontFamily={MONO} fill={P.dim}
                      listening={false} />);
        } else if (label.kind === 'epic') {
            // Drawn as an HTML overlay below, not in the world — see
            // `floatingEpics`. Nothing is pushed here.
        } else if (label.kind === 'batch') {
            worldNodes.push(
                <Text key={`lbl-${i}`} x={label.x} y={label.y} text={label.text}
                      fontSize={F.batch} fontFamily={MONO} fill={P.batch}
                      listening={false} />);
            if (label.leader) {
                worldNodes.push(
                    <Line key={`lbl-${i}-leader`}
                          points={[label.leader.x1, label.leader.y1,
                                   label.leader.x2, label.leader.y2]}
                          stroke="rgba(74, 217, 200, 0.55)" strokeWidth={1}
                          dash={[4, 4]} listening={false} />);
            }
        }
    });

    return (
        <Box>
            <OrderViolationsAlert plan={plan} />

            {/* The layout toggles moved into the page header row (req #3119).
                What stays with the canvas is the LEGEND — it describes the marks
                on this surface and nothing else — and it now floats INSIDE the
                panel, so it costs the plan no vertical space. */}

            {/* `data-transform` mirrors the world transform d3-zoom computes.
                The canvas is a bitmap, so pan and zoom are otherwise only
                observable as changed pixels — and pixels also change when a
                hover datacard appears, which makes a screenshot diff a weak
                proof that the view actually moved. Publishing {x, y, k} costs one
                attribute on a node React already re-renders per zoom event and
                makes the interaction falsifiable (req #3118 PIPE-08/09). Same
                purpose as the `pipeline-viz-zoom-level` chip beside it. */}
            <Box ref={setContainer} data-testid="pipeline-plan-visualizer"
                 data-transform={`${t.x.toFixed(2)},${t.y.toFixed(2)},${t.k.toFixed(4)}`}
                 // Full-page canvas (req #3119), the KonvaSwarmCanvas figure
                 // verbatim. It only fits because the page header collapsed to
                 // one row: the toggles, the accounting line and the legend all
                 // left this column.
                 //
                 // `mx`/`mb: -3` (req #3156) cancel PipelineDetail's ancestor
                 // `p: 3` on the sides/bottom only — top stays, since `availH`
                 // already measures from this Box's own top and accounts for
                 // everything above it. Without this the canvas sat in a
                 // visibly boxed 24px gutter on every side while the swarm
                 // canvas (KonvaSwarmCanvas.jsx) bleeds edge-to-edge inside a
                 // zero-padding tab panel; this makes the two match.
                 sx={{ position: 'relative', mx: -3, mb: -3,
                        height: availH ? `${availH}px` : 'calc(100vh - 260px)',
                        minHeight: 480, overflow: 'hidden', borderRadius: '8px',
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

                {/* Floating epic labels — pinned to their band, clamped to the
                    top of the viewport while the band is on screen. The strip
                    ignores the pointer so it can never swallow a drag-pan; each
                    label re-enables it so the epic stays clickable. */}
                <Box sx={{ position: 'absolute', inset: 0, pointerEvents: 'none',
                            overflow: 'hidden' }}
                     data-testid="pipeline-viz-epic-layer">
                    {floatingEpics.map((e) => (
                        <Box
                            key={e.key}
                            onClick={e.epicId != null
                                ? () => navigate(`/swarm/features?epic=${e.epicId}`) : undefined}
                            data-testid={`pipeline-viz-epic-${e.key}`}
                            sx={{
                                position: 'absolute', left: e.x, top: e.y,
                                height: 24, lineHeight: '17px',
                                display: 'flex', alignItems: 'center',
                                // +25% with the band-label metric in the layout
                                // (PLAN_VIZ_FONT.epic / CHW_EPIC) — this chip is
                                // an HTML overlay, so it does not inherit them.
                                fontFamily: MONO, fontSize: 15, fontWeight: 700,
                                color: e.color,
                                // OPAQUE, not a wash: the chip sits over the
                                // canvas, and a translucent one let whatever is
                                // behind it read through the epic name.
                                background: P.panel,
                                px: 0.9, py: 0.2, borderRadius: '5px',
                                border: `1px solid ${e.color}55`,
                                whiteSpace: 'nowrap', userSelect: 'none',
                                pointerEvents: e.epicId != null ? 'auto' : 'none',
                                cursor: e.epicId != null ? 'pointer' : 'default',
                            }}
                        >
                            {e.text}
                        </Box>
                    ))}
                </Box>

                {/* Legend, floated into the panel so it costs the plan no height. */}
                <Stack direction="row" spacing={1.25} alignItems="center" flexWrap="wrap"
                       useFlexGap
                       data-testid="pipeline-viz-legend"
                       sx={{ position: 'absolute', top: 8, right: 10,
                              background: 'rgba(13, 20, 32, 0.82)',
                              px: 1, py: 0.4, borderRadius: '10px',
                              pointerEvents: 'none', userSelect: 'none', maxWidth: '70%' }}>
                    {byMachine ? (
                        machineView.legend.map((m) => (
                            <LegendDot key={m.key} fill={m.color} label={m.label} />
                        ))
                    ) : (
                        <>
                            <LegendDot fill={P.doneFill} label="Complete" />
                            <LegendDot fill={P.runningFill} label="Running" />
                            <LegendDot fill={P.pendingFill} ring="#5b7293" label="Scheduled" />
                            <LegendDot ring={P.manualRing} label="Manual" />
                            <LegendDot ring={P.eligibleRing} label="eligible now" />
                        </>
                    )}
                    {/* Batch key ONLY when a batch box is actually drawn —
                        production directive, kept from the POC. */}
                    {hasBatchBoxes && (
                        <Box data-testid="pipeline-viz-batch-legend">
                            <LegendDot ring={P.batch} dashed
                                       label="launch batch = one /swarm-start" />
                        </Box>
                    )}
                </Stack>

                <Box sx={{ position: 'absolute', bottom: 8, right: 10, fontSize: 11,
                            color: P.dim, background: 'rgba(0,0,0,0.45)',
                            px: 1, py: 0.25, borderRadius: '10px',
                            pointerEvents: 'none', userSelect: 'none' }}
                     data-testid="pipeline-viz-zoom-level">
                    {LEVEL_NAME[level]} · drag to pan · scroll to zoom
                </Box>

                {card && (
                    <PlanDataCard card={card} timezone={timezone} level={level}
                                  containerW={size.w} containerH={size.h} />
                )}
            </Box>
        </Box>
    );
}

// ── Hover datacard (reuses the shared .ts-datacard CSS) ─────────────────────
// Step: title, state, run, deps (step gates + wall-clock gates through the ONE
// shared formatter), dominant + FULL epic/feature label sets from the engine,
// requirement ids, machines, and — at the 'in' level only — Cost (req #3117).
// Batch: the launch unit with its exact /swarm-start argument list. No session
// data anywhere (design rule 9); no generated '#'.
//
// COST IS LEVEL-GATED, matching the level ladder's own rule: 'in' is where the
// per-step detail slot opens (the title line above does the same). It is also
// the only place the number is actionable — at 'out' and 'mid' the question is
// what runs next, not what it cost.
//
// It is NOT session data despite living on session rows. `row.cost` is a
// per-requirement rollup summed by the engine; the visualizer reads a field the
// table already renders, and design rule 9 stays intact because no session
// identity, phase or status appears here.
function PlanDataCard({ card, timezone, level, containerW, containerH }) {
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
    if (card.kind === 'req') {
        // Requirement hover (req #3119): the NAME and the STATUS, which is what
        // an id alone cannot tell you. Deliberately not on the canvas — see the
        // reqInfo comment. Requirement status is the requirement's OWN field, not
        // the step state derived from it, so it is shown verbatim.
        const info = card.info || {};
        body = (
            <div className="ts-datacard">
                <div className="ts-datacard-title">{card.reqId}</div>
                {rowEl('Name', info.title || '(untitled)')}
                {rowEl('Status', info.status || 'unknown')}
            </div>
        );
    } else if (card.kind === 'batch') {
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
                {level === 'in' && rowEl('Cost',
                    // Same fmtCost the table's Cost column uses, on the same
                    // row.cost the engine attached — the two surfaces cannot
                    // disagree about a step's cost because there is one value.
                    // '\n'-joined, so the card renders it on two lines.
                    <span style={{ whiteSpace: 'pre-line' }}>
                        {fmtCost(r.cost?.wallSecs, r.cost?.tokens)}
                    </span>)}
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
