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
// ── The scroll pane (req #3168) ────────────────────────────────────────────
// That directive stands, and the panel still has no scrollbar of any kind. What
// it gained is the two properties a scroll pane has and free pan does not:
// BOUNDED translation (d3's translateExtent — the plan cannot be dragged off the
// panel and lost). The overlay scroll rails that shipped alongside it were
// REMOVED on the user's directive (2026-08-01): the bound plus the Reset
// control (now in the header's zoom control group, req #3216) are what keep
// the plan reachable, and a thumb on a canvas that pans by transform was
// chrome restating what the pan already shows.
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
// THE PANEL HAS NO LIGHT MODE, and that is load-bearing rather than incidental
// (req #3168). `PLAN_VIZ_PALETTE` is a fixed dark set and this container's
// background is `P.panel` (#111b2b) under both Darwin themes, so every colour
// decision on this surface is made against ONE known background. A
// theme-conditional colour here could never fire; writing one would be dead code
// claiming to handle a case that does not exist. Near-white `P.text` is
// therefore the whole answer to "neutral" — there is no black variant.
//
// The colour LANGUAGE itself — which channel encodes what, at which level, what
// animates, and the rule that stops two channels claiming one meaning — is
// documented and decided in `pipelinePlanLayout.js`, because it is pure and
// because the on-screen KEY below has to render exactly what the canvas draws.
// This file draws the language; it does not define it.
//
// ── Data discipline ────────────────────────────────────────────────────────
// Requirement-centric: every mark derives from plan rows + hierarchy (design
// rule 9 — no session data). Generated labels carry NO '#'. Click targets
// (production directives): requirement id → /swarm/requirement/:id; bead →
// Table mode scrolled/highlighted to the row (onStepFocus); epic band label →
// FOCUS the band (req #3204), with /swarm/features?epic=<id> — the req #3119
// directive, the minimal target since there are no dedicated epic pages — moved
// onto the chip's own ↗ control so it stays a visible affordance rather than
// being deleted or buried under a modifier key.
//
// ── Epic focus (req #3204) ─────────────────────────────────────────────────
// Clicking an epic's name fits that band to the viewport. THIS IS NOT A MODE:
// no focused-epic state exists anywhere in this file, there is nothing to
// un-zoom, and after the click every gesture behaves exactly as in a session
// where the feature was never used. That property is not a promise, it is a
// consequence of applying the transform THROUGH the d3-zoom behavior
// (`zb.transform`): the behavior's own internal transform simply becomes the
// new current one. Writing `setTransform` directly would leave d3's copy stale
// and the next wheel or drag would snap back — the classic integration bug.
// The geometry itself is pure and lives in pipelinePlanLayout.js.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Stage, Layer, Group, Rect, Circle, Line, Text, Path } from 'react-konva';
import Konva from 'konva';
import { select } from 'd3-selection';
import { zoom as d3zoom, zoomIdentity } from 'd3-zoom';
// Side-effect import: augments d3-selection's prototype with .transition(), which
// is how d3-zoom animates a programmatic transform. A user gesture interrupts the
// transition through d3-zoom's own `interrupt`, so an impatient click-then-drag
// never fights the animation.
import 'd3-transition';

import Alert from '@mui/material/Alert';
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
// The autonomy / model / effort words the rest of the UI uses (req #3213 D5).
// The card renders a requirement's execution settings through the SAME helpers
// the swarm datacard and the detail grids do — a raw column value on one
// surface and a label on another is two vocabularies for one fact.
import { formatCoordination } from '../../CalendarFC/timeSeriesSizes';
import { aiModelLabel } from '../modelChipStyles';
import { effortLabel } from '../effortChipStyles';
import { OrderViolationsAlert } from './PipelinePlanTable';
import {
    computePlanLayout, beadStyle, placeEpicChips, collectWorldObstacles,
    epicFocusTransform, factoryDefaultScale,
    PLAN_VIZ_PALETTE as P, PLAN_VIZ_FONT as F, BEAD_RADIUS, BEAD_HIT_RADIUS,
    CHW_EPIC, ZOOM_MIN_RATIO, ZOOM_MAX_RATIO,
    K_READABLE, DEFAULT_STEP_WIDTH, EPIC_CHIP_BG_ALPHA,
    NEXT_HALO_RADIUS, NEXT_HALO_STROKE, NEXT_HALO_OPACITY, NEXT_HALO_DASH,
    buildMachineColorView, reqIdStyle, reqIdKeyEntries, normalizeColorKey,
    DEFAULT_COLOR_KEY, PLAN_KEY_MAX_W, pinnedLevelOf, DEFAULT_PLAN_LEVEL_PREF,
} from './pipelinePlanLayout';
import '../../CalendarFC/swarmVisualizer.css';

const MONO = '"SF Mono", "JetBrains Mono", Menlo, monospace';

// The three requirement-mark colour scales, in the order they are reserved.
// Every one is rendered every time (hidden when not live) so the key's footprint
// is the MAX of the three and therefore constant — see the key's own comment.
const REQ_KEY_SCALES = ['state', 'machine', 'none'];

// Interactive chrome layered OVER the canvas (req #3168). d3-zoom's gesture
// filter and the manual click hit-test both reject anything originating inside
// it, so a control can never double as a pan gesture or as a click on the bead
// beneath it.
//
// EXACTLY ONE ELEMENT CARRIES IT NOW: the key's collapse button. The reset
// control and the status chip left in req #3216, and the level selector left in
// req #3241 — its `data-viz-chrome="level"` wrapper went with it, because an
// exemption is only meaningful where the gesture filters can see it. Every one
// of those now lives in the page header, OUTSIDE the container this behaviour is
// bound to, so a mousedown on them was never reachable as a pan gesture in the
// first place. Anything added back over the canvas needs the attribute again.
const CHROME_SELECTOR = '[data-viz-chrome]';

// The panel colour at the chip's declared opacity (req #3168 user directive:
// 40% transparent). Derived from the ONE palette entry rather than written as a
// second literal, so a palette change cannot leave the chip a different shade of
// the same intent.
const rgba = (hex, a) => {
    const n = parseInt(hex.replace('#', ''), 16);
    /* eslint-disable no-bitwise */
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
    /* eslint-enable no-bitwise */
};

// Duration of the epic-focus camera move (req #3204). Long enough to read as a
// move, short enough that a second click never feels queued.
const FOCUS_MS = 420;

// Key swatch — a colored dot (or ring) in the POC vocabulary. The requirement
// channel colours TYPE instead (LegendWord, below) — a dot there would
// misrepresent it as another bead, which is why this swatch only ever draws
// the STEP channel's marks now.
function LegendDot({ fill, ring, label, animated }) {
    return (
        <Stack direction="row" spacing={0.5} alignItems="center">
            <Box sx={{
                width: 10, height: 10, flexShrink: 0,
                borderRadius: '50%',
                bgcolor: fill || 'transparent',
                border: ring ? `2px solid ${ring}` : 'none',
                // The key SHOWS the motion it describes rather than only
                // naming it — the two animated marks are the two questions
                // this page exists to answer, and a static swatch beside the
                // word "pulses" makes the reader match prose to a moving
                // thing 400px away. Same curves as the canvas
                // (PLAN_VIZ pulse ~480ms, halo ~900ms), so the key and the
                // plan visibly share a rhythm.
                ...(animated ? {
                    animation: `${animated} ${animated === 'pipeKeyPulse' ? '0.96s' : '1.8s'}`
                        + ' ease-in-out infinite',
                } : null),
            }} />
            <Typography variant="caption" sx={{ color: P.dim, whiteSpace: 'nowrap' }}>
                {label}
            </Typography>
        </Stack>
    );
}

// The requirement channel's swatch: THE WORD IS THE SWATCH (user directive
// 2026-08-01 — "instead just list the statuses and make them their color").
// A dot beside a name spends width on a mark the canvas does not draw for this
// channel; the canvas colours TYPE, so the key colours type. It is also strictly
// more information per pixel — the reader matches the colour AND reads what it
// means in one glyph run — which is what let the key lose two rows without
// losing anything it said.
function LegendWord({ color, label }) {
    return (
        <Typography variant="caption"
                    sx={{ color, fontFamily: MONO, fontWeight: 700, fontSize: 10.5,
                           lineHeight: 1.35, whiteSpace: 'nowrap' }}>
            {label}
        </Typography>
    );
}

// The key's own section heading — dim, uppercase, and narrow, so a section costs
// the corner ~54px rather than a row of its own.
// ONE SHAPE FOR EVERY SECTION (user directive 2026-08-01: "the key is a
// disaster… beautify"). What made it read as a jumble was that its three
// sections were three different objects: a caption sitting INLINE with its
// entries on two of them, MUI chips in a different type scale on the third, and
// the entries wrapping around the captions at the cap width so nothing lined up.
//
// Now every section is the same two lines — an uppercase caption on its own
// baseline, then its row, left-aligned to a single edge — separated by a
// hairline. Uniformity is the whole treatment: three sections that look alike
// read as one key, and the eye stops re-parsing each row.
function KeyGroup({ title, children, first = false }) {
    return (
        <Stack direction="column" spacing={0.3} useFlexGap
               sx={{ pt: first ? 0 : 0.6, mt: first ? 0 : 0.15,
                      borderTop: first ? 'none' : `1px solid ${P.line}66` }}>
            <Typography variant="caption"
                        sx={{ color: P.dim, opacity: 0.7, whiteSpace: 'nowrap',
                               fontSize: 9, lineHeight: 1,
                               letterSpacing: '0.11em', fontWeight: 600,
                               textTransform: 'uppercase' }}>
                {title}
            </Typography>
            <Stack direction="row" spacing={1.1} alignItems="center"
                   flexWrap="nowrap" useFlexGap>
                {children}
            </Stack>
        </Stack>
    );
}

export default function PipelinePlanVisualizer({
    plan, model, pipeline, timezone, onStepFocus, focusEpicId,
    // Toolbar state is OWNED BY THE PAGE since req #3119 — the controls render in
    // the header row beside the pipeline name (the SwarmView/VisualizerToolbar
    // pattern, req #2407), so the panel is the canvas and nothing else.
    reqLayout = 'vertical', stepLabel = 'title', colorKey = DEFAULT_COLOR_KEY,
    stepWidth = DEFAULT_STEP_WIDTH, reqLabel = 'id', levelPref = DEFAULT_PLAN_LEVEL_PREF,
    // `levelPref` IN, the level actually drawn OUT. The SETTER is gone (req
    // #3241): the Auto/L1/L2/L3 control that called it moved to the page header,
    // so this panel no longer writes the preference — it reads it, draws at that
    // level, and reports which level that turned out to be.
    onEffectiveLevel,
    // req #3225 — the page's own persisted toggle. Governs the epic band
    // label's count suffix here and the plan-name suffix on the page's own
    // header, from one shared preference.
    showReqCounts = false,
    // The header's Reset control (req #3216) lives outside this component, in
    // the zoom control group PipelineDetail.jsx owns, so the click has to
    // reach across that boundary. `resetViewNonce` is KonvaBuildCanvas's own
    // device for exactly this (`resetViewNonce`/`frame`): a number that only
    // ever increments, watched by an effect below. 0 is the initial render.
    resetViewNonce = 0,
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
    // Since req #3213 it also carries HOW the work runs — autonomy, model and
    // effort. Same projection, same pass, three more fields off rows already in
    // hand; see PLAN_REQUIREMENT_FIELDS for why widening it costs no read.
    const reqInfo = useMemo(
        () => new Map((model?.requirements || [])
            .map((r) => [r.id, {
                title: r.title, status: r.requirement_status,
                coordination: r.coordination_type, model: r.ai_model, effort: r.effort,
            }])),
        [model]);
    // The requirement TITLE lookup, when that mark is showing (req #3168). Built
    // from `reqInfo`, which the hover card already needed — so the option costs
    // no extra read and no extra pass over the model. Passed as an ARGUMENT
    // rather than attached to the engine's rows; the reasoning is on
    // `reqLabelText` in the layout module.
    const reqTitles = useMemo(
        () => new Map([...reqInfo].map(([id, info]) => [id, info.title])), [reqInfo]);
    // req #3225 — the epic->{met,total} lookup `computePlanLayout` measures
    // into the band label. Built from `plan.requirementCounts.byEpic`, the
    // SAME derivation `orderedPlan` already ran (design rule 5: no second
    // pass over the model just to feed this component). `null` while the
    // toggle is off, so an unlit toggle costs the layout nothing beyond the
    // one extra memo dependency — every band's label reads exactly as it did
    // before this requirement.
    const epicCounts = useMemo(() => {
        if (!showReqCounts) return null;
        return new Map((plan.requirementCounts?.byEpic || [])
            .map((c) => [c.epicId, c]));
    }, [showReqCounts, plan.requirementCounts]);
    // `plan.timeAxis` (req #3201) is what makes the horizontal axis read as a
    // calendar and stacks the bands by epic start. It comes from `orderedPlan`
    // rather than being derived here for the same reason cost does: two
    // surfaces over one plan must not each derive the same fact.
    const layout = useMemo(
        () => computePlanLayout(rows, plan.batches || [], {
            reqLayout, stepLabel, stepWidth, reqLabel, reqTitles,
            timeAxis: plan.timeAxis || null, epicCounts,
        }),
        [rows, plan.batches, plan.timeAxis, reqLayout, stepLabel, stepWidth,
            reqLabel, reqTitles, epicCounts]);

    // ── The REQUIREMENT-ID channel (req #3119, tri-state req #3168) ─────────
    // Whatever the key, it rides the requirement ids and never the bead: the
    // bead's fill already carries derived STEP state (rule 1), and repainting it
    // would trade that reading for this one. The full colour language, and the
    // one-fact-one-channel-one-level rule it turns on, is documented in
    // pipelinePlanLayout.js — which is also where every colour below is decided,
    // so the canvas and the on-screen key cannot drift apart.
    const machineView = useMemo(
        () => buildMachineColorView({
            requirements: model?.requirements, machines: model?.machines,
        }), [model]);
    // Normalized HERE as well as in the page (review discipline): the prop is a
    // persisted preference travelling through a component boundary, and a
    // visualizer rendered from anywhere else must not be able to receive a
    // localStorage string this file then hands to Konva as a `fill`.
    const activeColorKey = normalizeColorKey(colorKey);
    // The statuses this plan actually contains — the key lists only these, which
    // is what stops a seven-entry scale from taking the corner the epic chips
    // need. Derived from the SAME map the hover card reads; no extra pass over
    // the model.
    const planStatuses = useMemo(() => {
        const seen = new Set();
        for (const row of rows) {
            for (const reqId of row.reqIds || []) seen.add(reqInfo.get(reqId)?.status);
        }
        return seen;
    }, [rows, reqInfo]);
    // ALL THREE scales, always, not just the live one. The key stacks them in one
    // grid cell to reserve a footprint that cannot move when the colour mode does
    // (user directive: "when I select machine view the key gets too small"), and
    // a cell can only be sized by children that exist. Same module and same
    // resolver as the canvas — the key is a rendering of the language, never a
    // second copy of it.
    const reqKeyScales = useMemo(() => Object.fromEntries(
        REQ_KEY_SCALES.map((scale) => [scale, reqIdKeyEntries({
            colorKey: scale,
            statuses: planStatuses,
            machineLegend: machineView.legend,
        }).entries])), [planStatuses, machineView]);
    // Expanded by default — see the key's own comment below for why this is
    // component state and not a persisted preference.
    const [keyOpen, setKeyOpen] = useState(true);

    // The container is tracked as STATE, not a bare ref: with an empty plan the
    // component returns the empty panel and no container exists — if the first
    // step arrives later (focus refetch on a draft pipeline), effects keyed on
    // a ref would never re-run and the canvas would stay blank forever (review
    // finding). A ref callback re-fires every effect when the node appears.
    const [containerEl, setContainer] = useState(null);
    // The key is a floating overlay in the panel's top-right corner, and the
    // epic chips clamp into the same corner whenever a band's header strip
    // reaches it — so the two collided, with the key on top and the epic name
    // unreadable underneath (req #3168, "epic title collisions"). Its rect is
    // MEASURED rather than assumed, and measuring is what lets the key GROW into
    // the complete vocabulary without anyone re-tuning a constant: its size
    // depends on the live colour key (a status scale filtered to the plan, or one
    // entry per machine), on whether a batch box is drawn, and on whether the
    // reader has collapsed it. Any hard-coded keep-out would be wrong on most
    // plans in one direction or the other.
    const [legendEl, setLegendEl] = useState(null);
    const [legendSize, setLegendSize] = useState(null);
    const stageRef = useRef(null);
    const layerRef = useRef(null);
    const zoomRef = useRef(null);
    const downRef = useRef(null);
    const draggingRef = useRef(false);
    // True only while a focus transition is in flight (req #3204). See the
    // world-click hit-test for why. `focusSeqRef` stamps each transition so a
    // SUPERSEDED one cannot clear the flag out from under its successor: d3
    // interrupts the older transition on the next timer tick, i.e. AFTER the
    // newer one has already raised the flag, so an unstamped handler would
    // re-open the very window this closes.
    const focusingRef = useRef(false);
    const focusSeqRef = useRef(0);
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

    useLayoutEffect(() => {
        if (!legendEl) { setLegendSize(null); return undefined; }
        const ro = new ResizeObserver((entries) => {
            const cr = entries[0]?.contentRect;
            if (cr) {
                setLegendSize({
                    w: Math.round(legendEl.offsetWidth),
                    h: Math.round(legendEl.offsetHeight),
                });
            }
        });
        ro.observe(legendEl);
        setLegendSize({ w: legendEl.offsetWidth, h: legendEl.offsetHeight });
        return () => ro.disconnect();
    }, [legendEl]);

    // The canvas fills whatever is left below it, MEASURED (req #3119). A
    // `calc(100vh - Npx)` constant — which is what the swarm canvas can afford,
    // because its chrome is fixed — assumes this page's header height, and this
    // page's header is not fixed: the breadcrumb and an order-violations alert
    // that appears only on some plans both move it. (The description block was a
    // third mover until req #3179 put it behind the header's info button; the
    // pixels it used to spend arrive here automatically, because this measures
    // its OWN top rather than subtracting a list of known chrome.)
    //
    // Measured on EVERY render, not on a dependency list (req #3179). A list has
    // to name each thing that can move this Box's top, and it silently goes stale
    // the moment the page above grows or loses a control — which is exactly the
    // edit req #3179 makes. `top` does not depend on the panel's own height, so
    // writing height from it cannot loop; the equality bail below makes that
    // explicit rather than relying on React's own bail-out.
    //
    // The cost is one forced layout per render, and a drag-pan renders per
    // pointermove (d3-zoom → setTransform). Affordable, but do not write down the
    // tempting justification — that the floating epic chips already dirty layout
    // every frame, so this reads a value the browser was about to compute anyway.
    // It is true only WHILE A CHIP IS ON SCREEN (`floatingEpics` returns null on
    // three separate guards below, and a pan that carries every band off-screen
    // renders none), and it leans on the chips writing `left`/`top` through `sx`,
    // which is itself a per-frame Emotion class injection somebody should fix.
    // The honest statement is the plain one: a rect read is cheap, this panel's
    // DOM is a canvas plus a handful of overlay nodes, and a canvas measured from
    // a stale header is a visible defect while a few microseconds are not.
    const [availH, setAvailH] = useState(null);
    const measureAvailH = useCallback(() => {
        if (!containerEl) return;
        // SCROLL-INVARIANT (req #3179 review). getBoundingClientRect().top is
        // viewport-relative, so a scrolled document reports a smaller top, which
        // would hand the canvas the scrolled-away pixels as extra height — and
        // measuring on every render is what makes an unrelated re-render (a bead
        // hover, a pan) read that scroll position. Adding scrollY converts it to
        // the top this Box has when the page is at rest, which is the number the
        // "fill the rest of the window" intent actually means. Where the scroller
        // is an inner element instead of the document, scrollY is 0 and this is
        // the old expression exactly.
        const top = containerEl.getBoundingClientRect().top + (window.scrollY || 0);
        const next = Math.max(480, Math.round(window.innerHeight - top - 14));
        setAvailH((prev) => (prev === next ? prev : next));
    }, [containerEl]);
    useLayoutEffect(measureAvailH);                     // after every render
    useEffect(() => {
        window.addEventListener('resize', measureAvailH);
        return () => window.removeEventListener('resize', measureAvailH);
    }, [measureAvailH]);

    // Fit-to-width base scale — the POC page rendered the whole plan across the
    // panel; kFit is that view.
    const kFit = size.w > 0 ? size.w / layout.width : 0.7;

    // ── The DEFAULT view is the readable one, not the whole one (req #3168) ──
    // Fit-to-width is the right OVERVIEW and the wrong DEFAULT. It is a scale
    // divided by plan size, so the bigger the plan the smaller the type — and the
    // live 64-step plan opens at a k where the requirement ids are a few pixels
    // tall. The page's whole job is reading a plan, and it was arriving unreadable
    // on exactly the plans that need it.
    //
    // K_READABLE is derived from the smallest required text (the req ids) and an
    // 11px floor; see pipelinePlanLayout. On a plan that already fits at a legible
    // size this is inert — kFit wins and nothing about the old view changes.
    const kDefault = Math.max(kFit, K_READABLE);
    // The zoom behavior's own configured floor, computed ONCE here so this
    // and the `.scaleExtent` call below read the SAME number rather than two
    // copies of a formula that only agree today because `kDefault` happens to
    // collapse `Math.min(kFit, kDefault)` to `kFit` (req #3216 review
    // finding — a future `kDefault` that could fall below `kFit` would
    // silently desync a duplicated expression; a shared variable cannot).
    const kZoomFloor = Math.min(kFit, kDefault) * ZOOM_MIN_RATIO;
    const curK = transform ? transform.k : kDefault;
    // THE LEVEL LADDER RE-ANCHORS ON THE DEFAULT, not on the fit (req #3168).
    // semanticLevel() takes a RATIO, and the ratio means "how far in from where
    // you started". Leaving the denominator at kFit while the default moved would
    // open a large plan at 'Detail' and a small one at 'Plan' — the same gesture
    // reporting a different level for no reason the reader can see. Anchoring on
    // kDefault keeps "the view you land on" = 'Plan' at every plan size, which is
    // the contract PIPE-09 asserts.
    // ── Auto, or PINNED (req #3168) ─────────────────────────────────────────
    // `KonvaBuildCanvas`'s own line, in this canvas's vocabulary:
    // `pinnedLevel != null ? pinnedLevel : autoLevel(ratio)`. Pinning changes
    // what is DRAWN and never where the camera is — no transform is touched, so
    // a pinned reader can still pan and zoom freely and PIPE-09's wheel ladder is
    // untouched while the selector sits on Auto.
    const pinnedLevel = pinnedLevelOf(levelPref);
    const autoLevelName = semanticLevel(kDefault > 0 ? curK / kDefault : 1);
    const level = pinnedLevel || autoLevelName;

    // The d3-zoom behavior (KonvaSwarmCanvas pattern).
    useEffect(() => {
        const el = containerEl;
        if (!el || size.w === 0) return undefined;
        const sel = select(el);
        // ── Bounded pan — the "scroll pane" half of req #3168 ────────────────
        // An unbounded pan can carry the entire plan off the panel, and the only
        // way back is a mode switch (nothing on the surface re-fits). A scroll
        // pane cannot do that, and that is the property being asked for.
        //
        // A CUSTOM `constrain`, not `translateExtent`. The extent is a world-space
        // rectangle fixed at construction, so the overshoot it grants is measured
        // in world units and therefore GROWS ON SCREEN as you zoom in: a slack of
        // half a viewport at kDefault is half a viewport at kDefault and four
        // viewports at the 8× ceiling, i.e. the bound quietly stops binding at
        // exactly the zoom where the plan is easiest to lose (review finding).
        // Reading the live k in `constrain` states the rule in the units the rule
        // is actually about — HALF A PANEL of overshoot, at every scale — and
        // deletes the slack arithmetic entirely.
        //
        // The `Math.min(0, …)` / `Math.max(0, …)` is what keeps the DEFAULT view
        // (world origin at the panel's top-left) legal on a plan smaller than the
        // panel. Without it the bound would force a re-centre on the very first
        // transform, moving the world frame that the E2E click maths reads as
        // `screen = world × k + t`.
        const bound = (t) => {
            const loX = Math.min(0, size.w / 2 - t.k * layout.width);
            const loY = Math.min(0, size.h / 2 - t.k * layout.height);
            const x = Math.min(Math.max(t.x, loX), Math.max(0, size.w / 2));
            const y = Math.min(Math.max(t.y, loY), Math.max(0, size.h / 2));
            return (x === t.x && y === t.y) ? t : t.translate((x - t.x) / t.k,
                (y - t.y) / t.k);
        };
        const zb = d3zoom()
            // The SAME pair the epic-focus clamp reads (req #3204). They have to
            // agree — `zoom.transform` applies a programmatic transform verbatim
            // and does not constrain it, so an out-of-extent k would sit there
            // looking fine until the user's first wheel event snapped it back.
            //
            // Anchored on `kDefault`, not the fit scale (req #3168): the default
            // view is `max(fit, K_READABLE)` and every ratio on this surface —
            // the level ladder, this extent, and the focus clamp — is measured
            // from the view the reader actually lands in. The lower bound keeps
            // the fit scale in reach so `Overview` can still show the whole plan
            // on a plan that opens zoomed in.
            .scaleExtent([kZoomFloor, kDefault * ZOOM_MAX_RATIO])
            .constrain(bound)
            // A DRAG that starts on the key belongs to that control (req
            // #3168; the reset button's own exclusion left with it, req
            // #3216 — it now lives in the header, outside this container
            // entirely, so it was never reachable as a pan gesture here to
            // begin with). Rejecting it HERE rather than calling
            // stopPropagation on the control's React handler is the only version
            // that works: d3's listener is bound to this container and fires on
            // the way up, long before React's delegated handler at the document
            // root gets a look.
            //
            // A WHEEL is never rejected. The key and the reset chip sit over the
            // canvas, and excluding them from zoom too made a scroll with the
            // cursor over one do nothing at all, which reads as the page having
            // frozen (review finding).
            .filter((ev) => (ev.type === 'wheel' ? true
                : (!ev.button && !ev.target?.closest?.(CHROME_SELECTOR))))
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
        return () => {
            sel.on('.zoom', null);
            // Detaching the listeners does NOT stop a running focus transition
            // (req #3204): it would keep ticking on a detached container for the
            // rest of its 420ms, calling setTransform/setCard into an unmounted
            // tree and holding the node. Reachable — a bead click switches the
            // page to Table mode, which unmounts this component.
            sel.interrupt();
        };
    }, [containerEl, size.w, size.h, kFit, kDefault, kZoomFloor, layout.width, layout.height]);

    // ── Reset = FACTORY DEFAULT (req #3216 D1) ──────────────────────────────
    // Deliberately NOT `kDefault` above — see `factoryDefaultScale`'s own
    // comment in pipelinePlanLayout.js for why the readable landing scale and
    // "reset" are two different numbers now. The fit math is pure and lives
    // there, same as `epicFocusTransform`'s; this file only draws what it
    // returns. `kZoomFloor` (computed above, alongside `kDefault`) is the
    // SAME number the zoom behavior's own `scaleExtent` floor uses — passed
    // in rather than re-derived, so the two can never desync (review finding:
    // a duplicated `kFit * ZOOM_MIN_RATIO` only agreed with the behavior's
    // real floor by algebraic coincidence).
    const kFactoryDefault = factoryDefaultScale(layout, size, kFit, kZoomFloor);

    // WHICH base a toggle-driven recenter targets (review finding): Width
    // rescales every column and re-centres to keep the view sane on the new
    // geometry (the effect below), and until this ref existed that recentre
    // was hard-coded to `kDefault` — so clicking Width right after clicking
    // Reset, its own neighbour in the same header group, silently undid the
    // factory reset the user had just asked for. Flipping this to 'factory'
    // on a Reset click and reading it back here means a toggle instead
    // preserves whichever view the reader is IN, exactly as it always
    // preserved `kDefault` when the two scales happened to be the same
    // number. A drag or a wheel zoom never touches this ref: those don't run
    // through this effect at all, so which gesture last moved the camera is
    // still irrelevant to it, same as before this fix.
    const recenterModeRef = useRef('readable');

    // Reset to the current base view on first size and whenever a layout
    // toggle changes the world dimensions wholesale (the POC re-rendered from
    // scratch on those toggles). `stepWidth` joins that list for the same
    // reason the other two are on it: it rescales every column, so the
    // previous pan lands somewhere unrelated on the new geometry.
    const resetView = useCallback(() => {
        const el = containerEl;
        const zb = zoomRef.current;
        if (!el || !zb || size.w === 0) return;
        const k = recenterModeRef.current === 'factory' ? kFactoryDefault : kDefault;
        select(el).call(zb.transform, zoomIdentity.scale(k));
    }, [containerEl, size.w, kDefault, kFactoryDefault]);
    useEffect(() => {
        resetView();
    }, [resetView, size.h, reqLayout, stepLabel, stepWidth, reqLabel]);

    const factoryReset = useCallback(() => {
        recenterModeRef.current = 'factory';
        resetView();
    }, [resetView]);
    // `resetViewNonce` only ever increments (the header's click handler), so
    // the effect fires once per click. Read through a ref rather than joining
    // the dependency list: `factoryReset`'s identity changes on every resize
    // and every layout toggle, and depending on it directly would fire this on
    // those too — which is the mount/toggle effect above's job, not a factory
    // reset the user never asked for. 0 is the initial render — skip it, the
    // mount effect above already puts the canvas at the readable default.
    const factoryResetRef = useRef(factoryReset);
    factoryResetRef.current = factoryReset;
    useEffect(() => {
        if (!resetViewNonce) return;
        factoryResetRef.current();
    }, [resetViewNonce]);

    // Manual DOM click hit-test: d3-zoom owns the pointer gesture, so a
    // non-drag click is resolved against the stage and fired as the Konva
    // 'activate' event on the topmost shape (react-konva binds onActivate).
    useEffect(() => {
        const el = containerEl;
        if (!el) return undefined;
        const onDown = (e) => { downRef.current = { x: e.clientX, y: e.clientY }; };
        const onClick = (e) => {
            // Same exclusion as the zoom filter: the key is chrome over the
            // canvas, and resolving a click through it would fire whichever
            // bead it happens to be lying on top of.
            if (e.target?.closest?.(CHROME_SELECTOR)) return;
            const d = downRef.current;
            if (d && Math.hypot(e.clientX - d.x, e.clientY - d.y) > 4) return;
            // Only a click that landed on the CANVAS ITSELF is a world click
            // (req #3204). This listener is native and sits on the container,
            // so it also sees clicks bubbling up from the HTML overlays —
            // and it would then fire an `activate` on whatever Konva node
            // happens to lie beneath the overlay. That was harmless only while
            // the epic chip navigated away from this page; now that the chip
            // focuses and stays, a chip parked over a bead would ALSO switch
            // the page to Table mode. React's stopPropagation cannot fix it:
            // React 18 delegates to its root, which is an ANCESTOR of this
            // node, so this listener runs first regardless.
            if (!(e.target instanceof HTMLCanvasElement)) return;
            // A click that lands mid-focus-transition would hit-test a world
            // that is still moving (req #3204). The chip the user just clicked
            // slides across the panel during the transition — measured, one
            // band's chip travelled from (8, 523) to (247, 47) — so an impatient
            // second click (a different epic, or the same one again) lands on
            // BARE CANVAS at an interpolated transform. That resolves against
            // whatever bead or requirement id happens to be under the cursor at
            // that instant and switches to Table mode or navigates away. The
            // window is new: the chip used to leave the page immediately.
            if (focusingRef.current) return;
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
    // The next steps — the ones the engine says are launchable right now. Their
    // halo breathes on the SAME animation as the running pulse (req #3168): a
    // second Konva.Animation on one Layer would redraw it twice per frame for no
    // extra information, and the two marks stay distinguishable because they are
    // driven on different curves — the running bead fades to 45%, the halo only
    // to 25% and half as fast, so a running step and a next step never read as
    // the same rhythm.
    // Whether ANY step is launchable — that is all the animation needs. There was
    // a bottom-left readout naming the ids too; removed on the user's directive
    // (2026-08-01), so nothing builds the list any more. The halo is the whole
    // mark: it says which steps, on the steps themselves.
    const hasNext = useMemo(
        () => rows.some((r) => eligibleStepIds.has(r.id)), [rows, eligibleStepIds]);
    useEffect(() => {
        const layer = layerRef.current;
        if (!layer || (!hasRunning && !hasNext)) return undefined;
        // The node sets are found ONCE per effect run, not per frame. Every
        // change that can add or remove one of these nodes lands in this
        // dependency list — `rows` is a fresh array on each refetch and both
        // flags derive from it — so the lists cannot go stale, and the animation
        // stops walking a ~2000-node layer twice every frame.
        const pulseNodes = hasRunning ? layer.find('.pulse-bead') : [];
        const haloNodes = hasNext ? layer.find('.next-halo') : [];
        // `performance.now()`, not the frame's own clock: `frame.time` restarts
        // at zero every time this effect re-runs, and it re-runs on every
        // refetch — so both marks visibly snapped to their minimum opacity on
        // each poll. A wall clock makes the phase continuous across restarts.
        const anim = new Konva.Animation(() => {
            const time = performance.now();
            const op = 0.45 + 0.55 * Math.abs(Math.sin(time / 480));
            for (const n of pulseNodes) n.opacity(op);
            const halo = 0.25 + 0.75 * Math.abs(Math.sin(time / 900));
            for (const n of haloNodes) n.opacity(halo);
        }, layer);
        anim.start();
        // RESTORE what the animation wrote imperatively. react-konva only writes
        // props it observes CHANGING, and it never saw `opacity` on these nodes —
        // so a bead that stops Running keeps whatever opacity the last frame left
        // it at, permanently, and renders semi-transparent until something
        // remounts it. Resetting the nodes this animation actually touched fixes
        // it regardless of what their names have since become.
        //
        // ONLY the nodes that have STOPPED qualifying. React has already
        // committed the new props by the time a cleanup runs, so a node that is
        // still Running still carries its name — and resetting it here would
        // flash it to full opacity for the one frame before the replacement
        // animation's first tick. Every refetch re-runs this effect (`rows` is a
        // fresh array), so that flash would be a visible tic on every poll.
        return () => {
            anim.stop();
            let dirty = false;
            for (const n of pulseNodes) {
                if (n.hasName('pulse-bead')) continue;
                n.opacity(1);
                dirty = true;
            }
            for (const n of haloNodes) {
                if (n.hasName('next-halo')) continue;
                n.opacity(NEXT_HALO_OPACITY);
                dirty = true;
            }
            // A layer detached from its stage (this component unmounting) still
            // accepts batchDraw and still schedules a frame for it — a wasted rAF
            // holding a dead layer. Nothing to redraw is also a reason not to.
            if (dirty && layer.getStage()) layer.batchDraw();
        };
    }, [rows, hasRunning, hasNext, size.w]);

    // ── The level ladder, as ONE predicate ──────────────────────────────────
    // Every label kind asks this and nothing else, and the container publishes
    // the answer as `data-drawn`. Two reasons, both learned here:
    //
    //   · The canvas is a bitmap, so "Overview omits step labels" is otherwise
    //     unfalsifiable — a screenshot at L1 looks the same whether the labels
    //     are there or not unless you already have the other version to
    //     compare against, and a test that pins L1 twice and compares proves
    //     nothing. Same argument as `data-transform`, which exists because a pan
    //     is only observable as changed pixels.
    //   · The three early returns it replaces were three places to get the ladder
    //     wrong, and the attribute would have been a fourth.
    //
    // STEP LABELS ARE GATED LIKE REQUIREMENT MARKS (req #3221) — a step name is
    // per-step detail the same as a requirement id, so it shares that gate
    // rather than drawing unconditionally. This does not clear Overview down to
    // bare beads and arcs: the ruler's slot ticks, the batch letters and the
    // epic band names are drawn elsewhere in this component and are not asked
    // through `drawsKind` at all, so they keep drawing at every level — the
    // `return true` fallback below exists for THEM, not as a default nobody
    // reaches. This gate is draw-only: `computePlanLayout` reserves the step
    // label's rect at every level regardless (the zero-overlap invariant is
    // asserted against it unconditionally), so hiding it here never moves
    // anything else.
    const drawsKind = useCallback((kind) => {
        if (kind === 'step' || kind === 'req') return level !== 'out';
        if (kind === 'title') return level === 'in';
        return true;
    }, [level]);
    const drawnKinds = ['step', 'req', 'title'].filter(drawsKind).join(',');

    // Every world-space rect currently DRAWN — beads (widened to the
    // eligible-step halo where one draws), batch-box outlines, whichever
    // labels the semantic LEVEL actually shows, and every dependency arc's
    // bbox — for the sticky epic chips (req #3210) to steer clear of.
    // `collectWorldObstacles` is PURE (`pipelinePlanLayout.js`) precisely so
    // this assembly — otherwise only provable by rendering the component — is
    // a testable property of plain data; `drawsKind`/`level` is passed in
    // because it is this component's own gate; the pure module has no notion
    // of semantic level on its own (review finding — the first cut passed
    // `layout.labels` unfiltered, which dropped stickies to avoid marks that
    // were not actually on screen).
    const worldObstacles = useMemo(
        () => collectWorldObstacles(layout, { drawsKind, eligibleStepIds }),
        [layout, drawsKind, eligibleStepIds]);

    // Report the level actually being rendered so the toolbar's selector can
    // softly mark it while on Auto — BuildVisualizerPage's `onEffectiveLevel`
    // handshake. In an EFFECT, not during render: this calls a setState on the
    // PARENT, and doing that in a child's render body is the React warning that
    // ends in a cross-component update loop.
    useEffect(() => { onEffectiveLevel?.(level); }, [level, onEffectiveLevel]);

    const t = transform || { x: 0, y: 0, k: kDefault };

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

    // ── Focus an epic band (req #3204) ──────────────────────────────────────
    // Applied through the d3-zoom BEHAVIOR, on a transition. Animated rather
    // than jumped (the requirement asked for a decision): a 420ms ease shows
    // WHERE the band was, so the click reads as a camera move over one plan
    // instead of a page swap — and d3-zoom already supports it, so the choice
    // costs a duration argument rather than an animation loop.
    //
    // Stores NOTHING. `band` comes from the layout the caller is already
    // rendering, the transform goes to d3, and the callback returns.
    // Returns whether it actually moved the camera — false on every guard above
    // (no container/behaviour yet, or a band that can't be fit). The req #3235
    // mount-time effect below needs that signal: without it, a transient
    // zero-size container would be recorded as "already focused" and the deep
    // link would silently never apply once the canvas actually became ready.
    const focusEpic = useCallback((band) => {
        const el = containerEl;
        const zb = zoomRef.current;
        if (!el || !zb) return false;
        const tr = epicFocusTransform(layout, band, size, kDefault);
        if (!tr) return false;
        // The world is about to slide out from under any open datacard, exactly
        // as it does on a pan.
        setCard(null);
        focusingRef.current = true;
        const seq = (focusSeqRef.current += 1);
        select(el).transition().duration(FOCUS_MS)
            // 'end' fires on completion, 'interrupt' when a user gesture, a
            // second focus or the unmount cleanup pre-empts this one — both mean
            // the world has stopped being a moving target. Only the LATEST
            // transition may lower the flag.
            .on('end.focus interrupt.focus', () => {
                if (focusSeqRef.current === seq) focusingRef.current = false;
            })
            .call(zb.transform, zoomIdentity.translate(tr.x, tr.y).scale(tr.k));
        return true;
    }, [containerEl, layout, size, kDefault]);

    // Req #3235 — the mount-time end of the `?epic=` deep link: land on the
    // SAME centered/zoomed view a band-header click produces, through the
    // SAME zoom behaviour (`focusEpic`, never a direct transform write — the
    // behaviour owns its own transform, and setting state alone would snap
    // back on the next wheel or drag).
    //
    // If the plan is still loading, this component has not mounted yet
    // (PipelineDetail's `isLoading` gate) — nothing here can fire against an
    // empty canvas. What CAN still be empty at mount is the container's own
    // size (the ResizeObserver hasn't measured yet) and the zoom behaviour
    // (attached by the effect above, in the same commit but strictly earlier
    // in hook order); `focusEpic`'s own guards return false for both, so this
    // effect simply retries on the next render that changes one of its
    // dependencies rather than marking a no-op "applied".
    //
    // `epicFocusAppliedRef` KEYS ON THE MEASURED SIZE TOO, not just the
    // (pipeline, epic) pair (code review finding) — the panel is sized TWICE
    // at mount (the `calc(100vh - 260px)` fallback in the JSX below, then
    // again once `measureAvailH` resolves), and that second resize re-runs
    // the `resetView` effect above (its deps include `size.h`), whose
    // cleanup INTERRUPTS an in-flight focus transition and snaps the camera
    // back to the default view — after which this effect, unkeyed on size,
    // would see its own stale "applied" mark and never retry. Folding the
    // measured size into the key means that second resize (and any later
    // real one) invalidates the earlier mark and reapplies the focus, landing
    // AFTER `resetView` in the same commit because both effects react to the
    // same size change and this one is declared later in hook order. A
    // genuine later browser resize reapplying the focus for the same reason
    // matches `resetView`'s own existing contract, which already discards
    // whatever view the reader was on whenever the container resizes.
    const epicFocusAppliedRef = useRef(null);
    useEffect(() => {
        if (focusEpicId == null) return;
        const key = `${pipeline?.id}:${focusEpicId}:${size.w}x${size.h}`;
        if (epicFocusAppliedRef.current === key) return;
        const band = layout.bands.find((b) => b.epicId === focusEpicId);
        if (!band) return;
        if (focusEpic(band)) epicFocusAppliedRef.current = key;
    }, [focusEpicId, pipeline?.id, size, layout, focusEpic]);

    // Req #3235 code review — the resolved pipeline can legitimately hold no
    // band for this epic: the resolver answers "which pipeline hosts any of
    // this epic's requirements", but a band is keyed on each STEP's DOMINANT
    // epic (design rule 10), so an epic that never dominates a step of the
    // resolved pipeline has no band here even though the resolution was
    // correct. By the time this component has mounted, PipelineDetail's
    // `isLoading` gate has already cleared and `layout` is final — so a miss
    // here is a terminal fact, not a still-loading one, and needs to say so
    // rather than silently landing on the default view (the dead-link outcome
    // the requirement text rules out, arrived at from the other direction).
    const focusEpicNotOnPlan = focusEpicId != null
        && !layout.bands.some((b) => b.epicId === focusEpicId);

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
    //
    // THE PLACEMENT ITSELF MOVED OUT (req #3168) to pipelinePlanLayout's
    // `placeEpicChips` — every other rectangle on this surface is decided by a
    // pure function precisely so that overlap is testable, and the chips were the
    // one exception. They were also the one thing on the page still colliding:
    // with each other when the band header shrinks below the chip's fixed screen
    // height, and with the legend they clamp underneath in the top-right corner.
    // Both are now avoided by the same displacement pass, and both are asserted
    // in vitest over a swept transform rather than by eye.
    //
    // The chip's METRICS come from the layout module too (`EPIC_CHIP_H`,
    // `EPIC_CHIP_CHAR_W`), and are deliberately not passed from here: this file
    // carried its own character width, it was a leftover from the 12px chip that
    // never moved with req #3119's +25% type scale, and a displacement pass
    // reading a 22%-short width declares chips clear of things they overlap.
    // The sx block below is the other half of that contract — its `fontSize` and
    // padding must stay in step with the module's constants.
    const floatingEpics = placeEpicChips({
        bands: layout.bands,
        transform: t,
        viewport: size,
        worldWidth: layout.width,
        keepOut: legendSize
            ? { x: size.w - 10 - legendSize.w, y: 8, w: legendSize.w, h: legendSize.h }
            : null,
        // Sticky prev/next chips (req #3210) pin to the viewport edge rather
        // than to their own band, so — unlike the natural chips, which are
        // confined to their own band's content-free epic lane — they need an
        // explicit collision source: `worldObstacles`, above.
        worldObstacles,
    });

    const chipBg = rgba(P.panel, EPIC_CHIP_BG_ALPHA);

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

    // ── The time ruler (req #3207) ──────────────────────────────────────────
    // Drawn AFTER the band washes and BEFORE the arcs and beads: the rules and
    // the future tint are background furniture that must sit over the band fill
    // (a 6% wash would otherwise swallow them) and under everything a reader
    // actually reads. The label TEXT is not here — it rides `layout.labels` as
    // `kind: 'slot'` so the zero-overlap contract covers it, and is drawn in the
    // label loop below with every other piece of text on the surface.
    {
        const R = layout.ruler || { h: 0, slots: [], futureX: null };
        // The FUTURE REGION, first, so the rules draw on top of its edge. A rule
        // alone says where the boundary is; it does not say which side of it has
        // not happened yet.
        if (R.futureX != null && R.futureX < layout.width) {
            worldNodes.push(
                <Rect key="ruler-future" x={R.futureX} y={0}
                      width={layout.width - R.futureX} height={layout.height}
                      fill={P.wire} opacity={0.07} listening={false} />);
        }
        // The strip's baseline — what makes the ticks read as one ruler rather
        // than as a row of unrelated marks.
        worldNodes.push(
            <Line key="ruler-baseline"
                  points={[0, R.h - 2, layout.width, R.h - 2]}
                  stroke={P.line} strokeWidth={1} opacity={0.7}
                  listening={false} />);
        R.slots.forEach((s, i) => {
            // A GAPPED boundary is DASHED and brighter. Slots are dense in
            // COLUMNS but sparse in TIME — 07-28 and 07-31 are adjacent columns
            // three days apart — and the dashes are how the ruler says so
            // without spending a second label on it. `gapDays` is null on the
            // first dated slot and on the undated/future ones, where there is no
            // predecessor to have skipped anything.
            const gapped = s.gapDays != null && s.gapDays > 1;
            // The first slot's rule would land in the left gutter, where it
            // marks nothing: there is no earlier slot for it to divide from.
            if (i > 0) {
                worldNodes.push(
                    <Line key={`ruler-rule-${s.key}`}
                          points={[s.x, 6, s.x, layout.height - 6]}
                          stroke={gapped ? P.dim : P.line} strokeWidth={1}
                          dash={gapped ? [5, 5] : undefined}
                          opacity={gapped ? 0.5 : 0.55} listening={false} />);
            }
            // The tick itself, in the strip, at every slot — including the ones
            // whose LABEL was thinned away. The tick is 1px of geometry and can
            // never collide, so a degraded ruler still shows every boundary it
            // has; only the dates thin out.
            worldNodes.push(
                <Line key={`ruler-tick-${s.key}`}
                      points={[s.x, R.h - 9, s.x, R.h - 2]}
                      stroke={P.dim} strokeWidth={1} opacity={0.8}
                      listening={false} />);
        });
    }

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
            // Keyed on the SEGMENT, not the batch. A letter was unique per box
            // while a batch produced one segment per BAND and could never span
            // two — but req #3188 made batch-mates share only their REMAINING
            // gate, so one batch legitimately produces one segment per column
            // and `batch-A` became a duplicate React key on every such plan.
            // React warns and reserves the right to drop a child.
            <Rect key={`batch-${box.letter}-${box.bandIndex}-${box.depth}`}
                  x={box.x} y={box.y}
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
        // ── Highlight for next steps (req #3168) ────────────────────────────
        // Drawn BEFORE the bead so the halo sits under it, and at EVERY zoom
        // level including 'out' — a 2.5px ring is the only thing that used to
        // mark a launchable step, and at Overview it is a pixel of a green that
        // the Complete fill already owns. The one question a plan view is opened
        // to answer should be answerable at the level you open it in.
        if (style.next) {
            worldNodes.push(
                <Circle key={`next-${row.id}`} name="next-halo" x={n.x} y={n.y}
                        radius={NEXT_HALO_RADIUS} stroke={P.eligibleRing}
                        strokeWidth={NEXT_HALO_STROKE} opacity={NEXT_HALO_OPACITY}
                        dash={NEXT_HALO_DASH} listening={false} />);
        }
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
        // Its radius is a LAYOUT constant since req #3213 — the label hit
        // regions below are pushed above these circles, so the clearance
        // between the two is an invariant the layout tests assert.
        worldNodes.push(
            <Circle key={`hit-${row.id}`} x={n.x} y={n.y} radius={BEAD_HIT_RADIUS}
                    fill="transparent"
                    onMouseEnter={(e) => { cursorPointer(e, true); showStepCard(row, e); }}
                    onMouseLeave={(e) => { cursorPointer(e, false); hideCard(); }}
                    onActivate={() => onStepFocus?.(row.id)} />);
    });

    // ── Hover regions on the TEXT (req #3213 D1/D2) ─────────────────────────
    // The words are the larger, more obvious target than the bead beside them,
    // and until now they did not listen at all — so hovering a step name fell
    // THROUGH to the dashed batch rectangle underneath and produced the batch
    // card where a step card was wanted. The batch box is pushed before this
    // loop, so every region added here is already above it: the topmost, most
    // specific listening element wins and the rectangle stays the fallback for
    // empty space inside its own bounds.
    //
    // The region is the label's OWN world rect — the exact x/y/w/h
    // pipelinePlanLayout exports and the zero-overlap invariant already sweeps.
    // A hit target grown past its text is precisely how that invariant gets
    // broken silently, so nothing here is larger than the words it covers. The
    // TEXT stays `listening={false}`: one node answers for one label.
    const labelHit = (key, label, handlers) => (
        <Rect key={key} x={label.x} y={label.y} width={label.w} height={label.h}
              fill="transparent" {...handlers} />);

    layout.labels.forEach((label, i) => {
        if (!drawsKind(label.kind)) return;
        if (label.kind === 'step') {
            worldNodes.push(
                <Text key={`lbl-${i}`} x={label.x} y={label.y} text={label.text}
                      fontSize={F.label} fontFamily={MONO} fill={P.text}
                      listening={false} />);
            // HOVER ONLY — deliberately NOT the bead's third handler (review
            // finding). The bead's hit circle also carries `onActivate`, which
            // switches the whole page to Table mode and, because the visualizer
            // unmounts, discards the reader's pan and zoom. Mirroring it here
            // would grow the click-to-leave surface from 0.22% of the world to
            // 1.25% — measured on the live 97-step plan — and make the step
            // name the largest click target on the canvas, while the manual
            // hit-test tolerates 4px of drag before it stops calling a gesture
            // a click. D1 asks for the CARD; a click on the words did nothing
            // before this change and still does nothing.
            const row = rowById.get(label.stepId);
            if (row) {
                worldNodes.push(labelHit(`lblhit-${i}`, label, {
                    onMouseEnter: (e) => { cursorPointer(e, true); showStepCard(row, e); },
                    onMouseLeave: (e) => { cursorPointer(e, false); hideCard(); },
                }));
            }
        } else if (label.kind === 'req') {
            // ONE resolver decides this, and the same one feeds the key below —
            // see pipelinePlanLayout's colour-language block. Applied on the SAME
            // node in both requirement layouts: the SVG prototype coloured only
            // the horizontal one, because a `text { fill }` CSS rule beat the
            // attribute on <text> but never reached its <tspan> children. Konva
            // has no tspans, so the cause cannot recur here; the symptom is
            // asserted against both layouts anyway.
            //
            // The 2026-07-27 directive that made these ids white stands and is
            // satisfied by the TRI-STATE, not overridden by it: neutral is a
            // real position of the control, and a colour appears only when a
            // reader turns a key on and the key is on screen naming the scale.
            // What that directive rejected was an unlabelled colour reading as
            // the STEP's status; `state` here is the REQUIREMENT's own status,
            // which is the fact the bead's aggregate was derived from.
            const rs = reqIdStyle({
                colorKey: activeColorKey,
                status: reqInfo.get(label.reqId)?.status,
                machineColor: machineView.colorOf(label.reqId),
            });
            // ── ID at L1/L2, TITLE at L3 (user directive 2026-08-01: "L3 can
            //    have the req titles on by default") ────────────────────────
            // The LAYOUT always reserved the title's box (`idText` in
            // pipelinePlanLayout.js) and the renderer picks which text goes in
            // it, so crossing a level changes what is drawn and never where
            // anything is — the invariant that a zoom is a pure transform. The
            // id is centred on the same point and strictly narrower, so it
            // cannot leave a box the title already fits.
            const showTitle = level === 'in' && label.idText != null;
            const reqText = showTitle ? label.text : (label.idText ?? label.text);
            const reqX = showTitle ? label.x
                : label.x + (label.w - (label.idW ?? label.w)) / 2;
            worldNodes.push(
                <Text key={`lbl-${i}`} x={reqX} y={label.y} text={reqText}
                      fontSize={F.req} fontFamily={MONO}
                      fill={rs.fill}
                      fontStyle={rs.bold ? 'bold' : 'normal'}
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
            worldNodes.push(
                <Text key={`lbl-${i}`} x={label.x} y={label.y} text={label.text}
                      fontSize={F.title} fontFamily={MONO} fill={P.dim}
                      listening={false} />);
            // The reserved title slot is the step's own name in a second place
            // (req #3213 D2): it is drawn over the batch box like the step
            // label, so leaving it silent would put the batch card under half
            // the text belonging to a step.
            //
            // THIS BRANCH IS FOR A NON-DEFAULT CONFIGURATION, honestly stated
            // (review finding): the layout emits `kind: 'title'` only when
            // `stepLabel !== 'title'`, and PipelineDetail — the sole mount site
            // — pins `stepLabel = 'title'`, so the step label already IS the
            // name and this slot is empty on the shipped page. It is added
            // anyway for the same reason the `<Text>` above it exists: the
            // layout module supports the combination and the renderer must not
            // be the half that doesn't. Hover only, matching the step label.
            const titleRow = rowById.get(label.stepId);
            if (titleRow) {
                worldNodes.push(labelHit(`lblhit-${i}`, label, {
                    onMouseEnter: (e) => { cursorPointer(e, true); showStepCard(titleRow, e); },
                    onMouseLeave: (e) => { cursorPointer(e, false); hideCard(); },
                }));
            }
        } else if (label.kind === 'slot') {
            // The FUTURE tick is the accent: it names the tinted REGION beside
            // it rather than a boundary, and it is the mark the plan is most
            // often opened to find. A DATE and an UNDATED tick are both dim —
            // `undated` is the absence of a claim, and giving it the accent
            // would make a plan with no timestamps read as a plan that is
            // entirely in the future, which is the opposite claim.
            const accented = label.slotKind === 'future';
            worldNodes.push(
                <Text key={`lbl-${i}`} x={label.x} y={label.y} text={label.text}
                      fontSize={F.slot} fontFamily={MONO}
                      fill={accented ? P.accent : P.dim}
                      opacity={accented ? 0.9 : 0.95}
                      listening={false} />);
        } else if (label.kind === 'epic') {
            // Drawn as an HTML overlay below, not in the world — see
            // `floatingEpics`. Nothing is pushed here.
        } else if (label.kind === 'batch') {
            worldNodes.push(
                <Text key={`lbl-${i}`} x={label.x} y={label.y} text={label.text}
                      fontSize={F.batch} fontFamily={MONO} fill={P.batch}
                      listening={false} />);
            // The letter names the box, so it answers with the box's card (req
            // #3213 D2 acceptance). It sits in the band's header strip, which
            // is often ABOVE the box's top edge — the leader line below exists
            // exactly because of that gap — so this is not a duplicate of the
            // rectangle's own hover but the only way to reach a batch by its
            // name.
            worldNodes.push(labelHit(`lblhit-${i}`, label, {
                onMouseEnter: (e) => { cursorPointer(e, true); showBatchCard(label.letter, e); },
                onMouseLeave: (e) => { cursorPointer(e, false); hideCard(); },
            }));
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

            {/* Req #3235 — the `?epic=` deep link named an epic no band on THIS
                plan carries (see focusEpicNotOnPlan above). Saying so beats a
                default view with no explanation for why nothing focused. */}
            {focusEpicNotOnPlan && (
                <Alert severity="info" variant="outlined" sx={{ mb: 2 }}
                       data-testid="pipeline-viz-epic-not-on-plan">
                    That epic isn&apos;t shown on this plan — none of its steps are here.
                </Alert>
            )}

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
                makes the interaction falsifiable (req #3118 PIPE-08/09).
                `data-level` a few lines down carries the same duty for the
                semantic level since the status chip that used to name it was
                deleted (req #3216). */}
            <Box ref={setContainer} data-testid="pipeline-plan-visualizer"
                 data-transform={`${t.x.toFixed(2)},${t.y.toFixed(2)},${t.k.toFixed(4)}`}
                 // The WORLD the transform is applied to, for the same reason
                 // the transform itself is published: it is otherwise only
                 // observable as changed pixels, and pixels also change when a
                 // bead pulses. The step-width control's whole effect is on this
                 // number — it used to be read off the scroll rail's thumb, and
                 // the rails were removed on the user's directive (2026-08-01).
                 data-world={`${Math.round(layout.width)},${Math.round(layout.height)}`}
                 // Same device as `data-transform`, for the same reason and now
                 // carrying the same duty (req #3168). The dashed batch box is
                 // canvas geometry, so the only DOM proof it was drawn used to be
                 // the legend's conditional batch key — and the user directive to
                 // strip the key back to step marks + the requirement scale
                 // removed that proxy. Publishing the COUNT is strictly better
                 // evidence than the key ever was: it is what the canvas actually
                 // drew rather than a second thing derived from the same flag.
                 data-batch-boxes={layout.batchBoxes.length}
                 // `slots,labelled` — the time ruler (req #3207), published for
                 // the same reason the batch-box count is: canvas geometry is
                 // otherwise only observable as pixels, and the DEGRADATION rule
                 // is the half that a screenshot cannot distinguish from a plan
                 // that simply has fewer days. The two numbers differing IS the
                 // proof that thinning ran.
                 data-ruler={`${layout.ruler.slots.length},${
                     layout.ruler.slots.filter((s) => s.showLabel).length}`}
                 data-level={level}
                 data-drawn={drawnKinds}
                 // Full-page canvas (req #3119), the KonvaSwarmCanvas figure
                 // verbatim. The height is MEASURED (`availH` above) rather than
                 // subtracted from a list of known chrome, which is what lets the
                 // page above change shape — req #3179 removed the description
                 // block, req #3168 split the header into a pipeline bar and a
                 // view bar — without this Box ever being told.
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
                    label re-enables it so the epic stays clickable.

                    Clicking the NAME focuses that band (req #3204). Every band
                    is focusable, "No epic" included — it is a band with steps
                    like any other, and the previous rule (pointer events only
                    when `epicId != null`) existed solely because the old click
                    needed an epic id to navigate WITH. The ↗ beside it keeps
                    that navigation, and only it needs the id.

                    Re-enabling pointer events does not cost the drag-pan: the
                    chip is a DESCENDANT of the container d3-zoom is bound to, so
                    a mousedown on the chip still bubbles and still starts a pan.
                    Only the click is the chip's.

                    SOME entries are STICKY (req #3210, `e.sticky === 'top' |
                    'bottom'`): the epic immediately above/below the visible
                    range, pinned to the viewport edge inside the blank margin
                    `epicFocusTransform` already reserves, so a reader who has
                    focused one epic can still see — and one click away from —
                    its neighbours in the stack. `e.band` already resolves to
                    that neighbour, so `focusEpic(e.band)` chains exactly like
                    a normal chip click; nothing about the click wiring differs. */}
                <Box sx={{ position: 'absolute', inset: 0, pointerEvents: 'none',
                            overflow: 'hidden' }}
                     data-testid="pipeline-viz-epic-layer">
                    {floatingEpics.map((e) => {
                        const stickyTitle = e.sticky === 'top'
                            ? `Jump to the epic above — ${e.text}`
                            : `Jump to the epic below — ${e.text}`;
                        return (
                        <Box
                            key={e.key}
                            onClick={() => focusEpic(e.band)}
                            // Reachable without a mouse. The chip has been a
                            // click target since req #3119 and was never
                            // focusable; now that it is the ONLY way to reach
                            // the focus feature, leaving it mouse-only would
                            // make the feature mouse-only.
                            role="button"
                            tabIndex={0}
                            onKeyDown={(ev) => {
                                if (ev.key !== 'Enter' && ev.key !== ' ') return;
                                ev.preventDefault();     // Space must not scroll
                                focusEpic(e.band);
                            }}
                            // NAMES WHAT THE CLICK DOES (req #3213 D6). The
                            // chip body has focused the band since req #3204 —
                            // only this tooltip still described the old
                            // navigate-away behaviour, and a control that
                            // silently does one of two plausible things is
                            // worse than either. The chip's two controls each
                            // name themselves: the body zooms, the ↗ below
                            // opens the features view, and both say so.
                            // A STICKY chip names the DIRECTION it climbs
                            // instead (req #3210) — "Zoom pipeline epic" is
                            // true of it too, but "the epic above/below" is
                            // the fact the reader actually needs to decide
                            // whether to click.
                            title={e.sticky ? stickyTitle : 'Zoom pipeline epic'}
                            aria-label={e.sticky ? stickyTitle : `Zoom pipeline epic ${e.text}`}
                            data-testid={`pipeline-viz-epic-${e.key}`}
                            sx={{
                                position: 'absolute', left: e.x, top: e.y,
                                // The height and font the placement pass MEASURED
                                // — both come back from `placeEpicChips`, because
                                // it now scales the chip to fit its own epic lane
                                // at low zoom (req #3168). Drawing at any other
                                // size means the collision maths decided against a
                                // box that is not on screen. `gap` is req #3204's,
                                // for the ↗ control that rides beside the name.
                                height: e.h, lineHeight: 1,
                                display: 'flex', alignItems: 'center', gap: '4px',
                                fontFamily: MONO, fontSize: e.fontSize,
                                fontWeight: 700,
                                color: e.color,
                                // 60% opaque (user directive 2026-08-01). It was
                                // fully opaque, which read as a tile punched into
                                // the plan; the band's own colour now tints
                                // through while the name still wins over what it
                                // crosses.
                                background: chipBg,
                                px: 0.9, py: 0, borderRadius: '5px',
                                // A sticky chip's border rides at full colour
                                // rather than the ambient 33% (req #3210): it is
                                // the one thing on screen naming an epic with no
                                // content of its own in view, so it reads as a
                                // standing control rather than a label that
                                // happens to still be there.
                                border: `1px solid ${e.color}${e.sticky ? '' : '55'}`,
                                whiteSpace: 'nowrap', userSelect: 'none',
                                pointerEvents: 'auto',
                                cursor: 'pointer',
                                // An affordance you cannot see is not a feature
                                // (req #3204): the border firms up and the name
                                // underlines on hover, so the chip reads as the
                                // control it is.
                                transition: 'border-color 120ms',
                                '&:hover': { borderColor: e.color },
                                // Scoped to the NAME, not the chip: an ancestor
                                // rule would draw the underline through the ↗
                                // too, and a blockified flex item cannot opt out
                                // of an inherited text-decoration.
                                '&:hover .pipeline-viz-epic-name': {
                                    textDecoration: 'underline',
                                    textDecorationThickness: '1px',
                                    textUnderlineOffset: '2px',
                                },
                            }}
                        >
                            {/* No directional glyph here on purpose (req #3210
                                review finding): the chip's measured width comes
                                straight from `placeEpicChips`, which — unlike
                                the ↗ control below — sizes the chip to exactly
                                `e.text`, so any further in-flow content would
                                render past what the collision math measured.
                                The pinned position (viewport edge, not a band)
                                plus the solid border and the "Jump to…" title
                                below are the sticky affordance instead. */}
                            <Box component="span" className="pipeline-viz-epic-name">
                                {e.text}
                            </Box>
                            {/* The req #3119 target — the features view filtered
                                to this epic — kept as its OWN visible control
                                now that the chip body focuses instead. Its click
                                must not also focus, hence stopPropagation; the
                                react-router navigate leaves the page anyway, but
                                relying on that would make the ordering matter. */}
                            {e.epicId != null && (
                                <Box
                                    component="span"
                                    role="link"
                                    tabIndex={0}
                                    aria-label={`Open ${e.text} in the features view`}
                                    title={`Open “${e.text}” in the features view`}
                                    data-testid={`pipeline-viz-epic-open-${e.key}`}
                                    onClick={(ev) => {
                                        ev.stopPropagation();
                                        navigate(`/swarm/features?epic=${e.epicId}`);
                                    }}
                                    onKeyDown={(ev) => {
                                        if (ev.key !== 'Enter') return;
                                        // Without this the chip's own handler
                                        // also fires and focuses the band the
                                        // user is navigating away from.
                                        ev.stopPropagation();
                                        ev.preventDefault();
                                        navigate(`/swarm/features?epic=${e.epicId}`);
                                    }}
                                    sx={{
                                        fontSize: 12, fontWeight: 400, opacity: 0.7,
                                        lineHeight: 1, px: '2px',
                                        '&:hover': { opacity: 1 },
                                    }}
                                >
                                    ↗
                                </Box>
                            )}
                        </Box>
                        );
                    })}
                </Box>

                {/* ── THE KEY (req #3168, user directives 2026-08-01) ────────
                    "Have a common key displayed in the upper right", then a
                    second pass on what it should hold: no "Key" heading, no
                    small-print footer, no epic-band or launch-batch entries, the
                    requirement group labelled simply "Requirement", each status
                    or machine name drawn IN ITS OWN COLOUR rather than beside a
                    sample id, and — the one with teeth — **one stable footprint
                    across colour modes**.

                    What is left is the two channels a reader is actually decoding
                    on this canvas: the STEP marks, and the REQUIREMENT marks
                    under whichever colour key is live. Every colour comes from
                    the same pure module the canvas draws from, so the key cannot
                    describe a colour the plan is not using.

                    THE FOOTPRINT IS RESERVED, NOT MEASURED-AND-SET. The user's
                    complaint was that "when I select machine view the key gets
                    too small", so all three requirement scales are stacked in ONE
                    grid cell with the inactive ones `visibility: hidden`. A
                    hidden grid item still occupies its cell, so the cell is the
                    MAX of the three and the box cannot change size when the mode
                    does — declaratively, with no measurement, no ResizeObserver
                    feedback loop, and no risk of a scale being clipped to a
                    footprint that was reserved for a different one.

                    IT IS STILL WIDTH-CAPPED. This element's measured rect is the
                    keep-out `placeEpicChips` displaces the floating epic names
                    around, and that displacement is horizontal only — so width is
                    the whole cost and `PLAN_KEY_MAX_W` is the whole defence.
                    Removing the plan-level rows made the key SHORTER, which costs
                    the epic labels nothing either way.

                    Collapse is LOCAL STATE, not a persisted preference: a stored
                    one would need seeding in the E2E fixture and could arrive
                    collapsed from another session. Every visit opens with the key
                    shown, which is what "displayed in the upper right" asks. */}
                <Stack direction="column" spacing={0}
                       useFlexGap
                       ref={setLegendEl}
                       data-testid="pipeline-viz-legend"
                       sx={{ position: 'absolute', top: 10, right: 12,
                              // A panel, not a wash: opaque enough that the plan
                              // never reads through the key's own type, with a
                              // soft edge so it sits ON the canvas rather than
                              // being cut out of it.
                              background: 'rgba(13, 20, 32, 0.94)',
                              backdropFilter: 'blur(2px)',
                              px: 1.25, py: 0.9, borderRadius: '10px',
                              border: `1px solid ${P.line}`,
                              boxShadow: '0 6px 18px rgba(0, 0, 0, 0.45)',
                              pointerEvents: 'none', userSelect: 'none',
                              maxWidth: PLAN_KEY_MAX_W,
                              '@keyframes pipeKeyPulse': {
                                  '0%, 100%': { opacity: 1 },
                                  '50%': { opacity: 0.45 },
                              },
                              '@keyframes pipeKeyBreathe': {
                                  '0%, 100%': { opacity: 1 },
                                  '50%': { opacity: 0.25 },
                              } }}>
                    {/* No heading (user directive), so the collapse control is
                        the only chrome. ABSOLUTE, in the panel's own top-right
                        corner: in the flow it was a lone button on a line of its
                        own, which is most of what made the key look unfinished.
                        The sections keep their left edge and the control floats
                        clear of them. */}
                    <Box component="button" type="button"
                         onClick={() => setKeyOpen((v) => !v)}
                         data-viz-chrome="legend"
                         data-testid="pipeline-viz-legend-toggle"
                         aria-expanded={keyOpen}
                         aria-label={keyOpen ? 'Collapse the key' : 'Expand the key'}
                         sx={{ pointerEvents: 'auto', cursor: 'pointer',
                                position: 'absolute', top: 3, right: 4,
                                width: 15, height: 15, p: 0,
                                display: 'flex', alignItems: 'center',
                                justifyContent: 'center',
                                fontFamily: MONO, fontSize: 11, lineHeight: 1,
                                color: P.dim, background: 'transparent',
                                border: 'none', borderRadius: '4px',
                                opacity: 0.55,
                                '&:hover': { opacity: 1, color: P.accent } }}>
                        {keyOpen ? '−' : '+'}
                    </Box>

                    {keyOpen && (
                        <>
                            {/* THE LEVEL SELECTOR IS GONE FROM HERE (req #3241).
                                It moved to the page header, left of Width —
                                which is what req #3214's title asked for and its
                                work declined, leaving the control here and a
                                dead import in PipelineDetail.jsx. The reason
                                recorded for keeping it here was that the key
                                already says what a mark MEANS and the level says
                                which marks are drawn; that reading is fine, and
                                it is not the user's, which is the only one that
                                decides where a control lives.

                                THE KEY IS RE-PROPORTIONED TO WHAT REMAINS, not
                                left with a hole: the step channel is now the
                                FIRST group, so `KeyGroup`'s separating hairline
                                and its top padding do not survive as an edge
                                over nothing.

                                `PLAN_KEY_MAX_W` needs no re-measurement for
                                this. It is a CAP, and the box sizes to its
                                widest line; the 186px control was never that
                                line (the step channel's five swatches and names
                                are), and even if it had been, a NARROWER key
                                only ever gives the floating epic labels more
                                room — the cap's whole purpose. The sweep behind
                                that constant bounds the key's cost to the chips
                                from above, so removing a row cannot invalidate
                                it in either direction.

                                The pan exemption travelled with the control in
                                the only sense that matters: the `data-viz-chrome`
                                Box that wrapped it is gone, and the key keeps its
                                own on the collapse button below. The header is
                                outside the container the gesture filters are
                                bound to, so nothing there needs one. */}

                            {/* THE STEP channel. Running and next-up carry live
                                motion in the key itself, because naming a rhythm
                                in words is not the same as showing it. */}
                            <KeyGroup title="step" first>
                                <LegendDot fill={P.doneFill} label="Complete" />
                                <LegendDot fill={P.runningFill} label="Running"
                                           animated="pipeKeyPulse" />
                                <LegendDot fill={P.pendingFill} ring="#5b7293"
                                           label="Scheduled" />
                                <LegendDot ring={P.manualRing} label="Manual" />
                                {/* "next up" and not "eligible now" because the
                                    mark answers the question in the plan's own
                                    words: these are the steps that run next. */}
                                <LegendDot ring={P.eligibleRing} label="next up"
                                           animated="pipeKeyBreathe" />
                            </KeyGroup>

                            {/* THE REQUIREMENT channel — all three scales in ONE
                                grid cell so the footprint cannot move when the
                                colour key does. The swatch IS the word: each name
                                is drawn in its own colour, which is exactly what
                                the canvas does to the marks themselves. */}
                            <Box sx={{ display: 'grid' }}
                                 data-testid="pipeline-viz-legend-reqscale">
                                {REQ_KEY_SCALES.map((scale) => {
                                    const active = scale === activeColorKey;
                                    return (
                                        <Box key={scale}
                                             data-testid={`pipeline-viz-legend-scale-${scale}`}
                                             aria-hidden={!active}
                                             sx={{ gridArea: '1 / 1',
                                                    visibility: active ? 'visible' : 'hidden' }}>
                                            <KeyGroup title="requirement">
                                                {reqKeyScales[scale].map((e) => (
                                                    <LegendWord key={e.key} color={e.color}
                                                                label={e.label} />
                                                ))}
                                            </KeyGroup>
                                        </Box>
                                    );
                                })}
                            </Box>
                        </>
                    )}
                </Stack>

                {/* The bottom-right reset button + status chip stack is GONE
                    (req #3216). Reset moved to the header's zoom control group
                    — see PipelineDetail.jsx and the `resetViewNonce` handshake
                    above — and the status chip (zoom level name, "pinned", the
                    "drag to pan, scroll to zoom" hint) was deleted outright,
                    not just its text: drag-to-pan and scroll-to-zoom are
                    discovered in under a second by anyone who touches the
                    canvas, and a permanent caption teaching them cost this
                    corner forever. The level and the pinned state are each
                    still named elsewhere — `data-level` on the container
                    (published for the same reason `data-transform` is, a few
                    lines up) and the `SemanticLevelControl` itself (the
                    filled/outlined Auto|L1|L2|L3 chips), which was ALREADY the
                    control a reader used to pin or clear a level, so removing
                    this chip removes no signal that had no other home. That
                    control is in the PAGE HEADER since req #3241; it was in the
                    key when this note was written. */}

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
        //
        // THE NAME LEADS AND THE NUMBER IS A FIELD (req #3213 D4). It was
        // exactly inverted — a bare id as the heading with the title labelled
        // beneath it — so the card led with the one thing the reader had just
        // pointed at and already knew. An identifier is data; the step card
        // below now reads the same way, which is the other half of the fix.
        //
        // Autonomy / model / effort (D5) answer HOW the work will be executed,
        // not merely what it is called, and every one of them goes through the
        // shared label helper rather than printing a column value.
        const info = card.info || {};
        body = (
            <div className="ts-datacard">
                <div className="ts-datacard-title">{info.title || '(untitled)'}</div>
                {rowEl('Requirement', card.reqId)}
                {rowEl('Status', info.status || 'unknown')}
                {/* ONE missing-value policy across the three (review finding).
                    `aiModelLabel`/`effortLabel` fall back to Opus/High on
                    unknown input, and their own comments justify that by the
                    NULL backfill — but those columns are NOT NULL with exactly
                    those defaults, so a fallback reached HERE can only mean the
                    projection did not carry the field. That is a plausible
                    WRONG answer with no visual tell, which is worse than no
                    answer; `formatCoordination` in the line above already says
                    '—' for the same condition. The row stays present either
                    way, so the card still answers all four questions. */}
                {rowEl('Autonomy', formatCoordination(info.coordination))}
                {rowEl('Model', info.model ? aiModelLabel(info.model) : '—')}
                {rowEl('Effort', info.effort ? effortLabel(info.effort) : '—')}
            </div>
        );
    } else if (card.kind === 'batch') {
        const b = card.batch;
        const timeGates = formatTimeGates(b.timeDeps, timezone);
        body = (
            <div className="ts-datacard">
                <div className="ts-datacard-title">Launch batch {b.letter}</div>
                {rowEl('Steps', b.stepIds.join(' '))}
                {/* The REMAINING gate since req #3188 — same wording as the
                    plan table's banner, because the two are one plan. */}
                {rowEl('Gate', b.gateStepIds.length
                    ? `steps ${b.gateStepIds.join(', ')}` : 'no remaining step gate')}
                {timeGates.map((g) => <div key={g}>{rowEl('After', g)}</div>)}
                {rowEl('Run', runLabel(b.run))}
                {b.machineLabels.length > 0 && rowEl('Machines', batchMachineLabel(b))}
                {rowEl('Launch', b.swarmStartCommand
                    ? <code style={{ fontSize: '0.85em' }}>{b.swarmStartCommand}</code>
                    : (b.noLaunchReason || 'no linked requirements — nothing to launch'))}
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
                {/* NAME ALONE in the heading, id as the first field (req #3213
                    D3). The heading used to concatenate the two, which made the
                    step card and the requirement card read in opposite orders;
                    they now agree — a name on top, identifiers among the
                    attributes. */}
                <div className="ts-datacard-title">{r.title || '(untitled)'}</div>
                {rowEl('Step', r.id)}
                {rowEl('State', stepStateLabel(r.state))}
                {rowEl('Run', runLabel(r.run))}
                {rowEl('Deps', depText)}
                {timeGates.map((g) => <div key={g}>{rowEl('After', g)}</div>)}
                {r.epic && rowEl('Epic', (r.epicLabels || []).length > 1
                    ? `${r.epic} (all: ${epicAll})` : r.epic)}
                {r.feature && rowEl('Feature', (r.featureLabels || []).length > 1
                    ? `${r.feature} (all: ${featAll})` : r.feature)}
                {/* Tracking containers marked with a trailing † and named below
                    (req #3123). The card answers the same question the plan
                    table now answers — "this step links a requirement still in
                    development, so why is it not Running?" — and leaving the
                    SVG surface silent would make the derivation look broken to
                    a reader who is right to check it. */}
                {rowEl('Reqs', r.reqIds.length
                    ? r.reqIds.map((id) => ((r.trackingReqIds || []).includes(id)
                        ? `${id}†` : `${id}`)).join(' ')
                    : '—')}
                {(r.trackingReqIds || []).length > 0 && rowEl('† tracking',
                    'container, not work — does not gate this step, not launched')}
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
        // `data-kind` is what makes D2 assertable (req #3213): "the card that
        // appears belongs to the thing being pointed at" is a claim about WHICH
        // card, and the three read too similarly to tell apart by text alone.
        <div ref={cardRef} className="ts-shared-tooltip"
             data-testid="pipeline-viz-datacard" data-kind={card.kind}
             style={{
                 position: 'absolute', left, top, maxWidth: CARD_W, zIndex: 20,
                 pointerEvents: 'none',
             }}>
            {body}
        </div>
    );
}
