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
//   out — initiative bands, beads, dependency arcs
//   mid — + step labels (ID or Title per toggle) + requirement ids
//   in  — + per-step title line (the reserved slot) + the hover datacard is the
//         full detail surface at every level
// Unlike the swarm canvas, TEXT DRAWS IN WORLD COORDINATES (scales with zoom):
// the zero-label-overlap guarantee is geometric — computed column widths and
// lane pitches — and it must hold at every k. Counter-scaled labels would break
// it on zoom-out; the POC (a scaled SVG) worked exactly this way.
//
// ── Design language ────────────────────────────────────────────────────────
// The POC page's palette (dark navy panel, mono type, EPAL initiative colors, teal
// launch accent) renders verbatim in both app themes — the directive is to keep
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
// (production directives): requirement id → /swarm/requirement/:id; bead or
// card title → frame that step on this canvas (req #3641 — it opened the Table
// mode, which is gone; `onStepFocus` went with it); initiative status light
// and closure count → FOCUS the band (req #3204; moved off the name by req
// #3580, which made the initiative name, the step name and the step's run circle
// in-place editors), with /swarm/steps?initiative=<id> — the req #3119
// directive, re-pointed by req #3373 when the browsable-catalog route it used
// to open was retired (req #3357) — moved onto the chip's own ↗ control so it
// stays a visible affordance rather than being deleted or buried under a
// modifier key.
//
// ── Initiative focus (req #3204) ─────────────────────────────────────────────────
// Clicking an initiative's status light or closure count (its name until req #3580)
// fits that band to the viewport. THIS IS NOT A MODE:
// no focused-initiative state exists anywhere in this file, there is nothing to
// un-zoom, and after the click every gesture behaves exactly as in a session
// where the feature was never used. That property is not a promise, it is a
// consequence of applying the transform THROUGH the d3-zoom behavior
// (`zb.transform`): the behavior's own internal transform simply becomes the
// new current one. Writing `setTransform` directly would leave d3's copy stale
// and the next wheel or drag would snap back — the classic integration bug.
// The geometry itself is pure and lives in pipelinePlanLayout.js.

import {
    startTransition, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef,
    useState,
} from 'react';
import { useNavigate } from 'react-router-dom';
import { useIsFetching, useQueryClient } from '@tanstack/react-query';
import { Stage, Layer, Group, Rect, Circle, Line, Text, Path, Shape } from 'react-konva';
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
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import Popper from '@mui/material/Popper';
import TextField from '@mui/material/TextField';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
// req #3428 — the icon `/swarm`'s own view toggle uses for Cards. Reusing the
// page's mark rather than inventing one is what makes the chip's second control
// legible as a destination.
import ViewModuleIcon from '@mui/icons-material/ViewModule';

import { STEP_RUNNING } from './pipelineViewModel';
// req #3356 — the `era` PROP is gone (there is one era) but `planEra.js` stays
// the ONE place a plan storage namespace or route is spelled, so the accessor is
// still called — now with no era argument.
import { planStorageNamespace } from './planEra';
import { OrderViolationsAlert } from './PipelinePlanTable';
import EmptyPlanAddStep from './EmptyPlanAddStep';
import StepEditDialog from '../../Steps/StepEditDialog';
import InitiativeEditDialog from '../../Initiatives/InitiativeEditDialog';
import {
    computePlanLayout, beadStyle, placeInitiativeChips,
    initiativeFocusTransform, stepFocusTransform, initiativeWorkFocusTransform,
    factoryDefaultView, clampPlanTransform, planLandingAction,
    relayoutAnchorTransform,
    // req #3365 — the ruler's own thinning rule, re-applied at draw time
    // against the counter-scaled label widths (a pure function since req #3793).
    drawnRulerLabelKeys,
    PLAN_VIZ_PALETTE as P, PLAN_VIZ_FONT as F, CARD_FONT as CF,
    BEAD_RADIUS, BEAD_HIT_RADIUS,
    CHW_INITIATIVE, INITIATIVE_CHIP_FONT, ZOOM_MIN_RATIO, ZOOM_MAX_RATIO,
    readableDefaultScale, INITIATIVE_CHIP_BG_ALPHA,
    NEXT_HALO_RADIUS, NEXT_HALO_STROKE, NEXT_HALO_OPACITY, NEXT_HALO_DASH,
    nextHaloMagnify, nextMarkIsDot, nextMarkDotRadius,
    clusterNextMarks, NEXT_MARK_COUNT_FONT_PX,
    planLevelFor, drawsLabelKind, stepsAcrossScale, zoomAboutViewportCentre,
    stepsAcrossTransform,
    snapZoomScale, zoomAboutPoint,
    // req #3498 — the step is a CARD. The renderer draws the box the layout
    // measured; it never measures one of its own.
    CARD_RADIUS, CARD_PAD_X, CARD_PAD_Y, CARD_LINE_H, CARD_RULE_GAP,
    CARD_STATE_BAR_W, CARD_BADGE_FONT,
    // req #3607 — the title buttons' outline (the barrier and lock buttons'
    // border since they moved to HTML, req #3673).
    CARD_TITLE_BTN_STROKE,
    MIN_CARD_H, REQ_LINE_H, CHW_REQ, CARD_SEP_CHARS, REQ_SEP_PULL,
    // req #3580 — the run pill's letter and type.
    CARD_RUN_FONT, CARD_RUN_WORDS,
    // req #3650 — the collapse heads' type and the chip head's reserved width.
    CARD_COLLAPSE_FONT, CARD_COLLAPSE_W, CARD_COLLAPSE_GAP, INITIATIVE_CHIP_COLLAPSE_HEAD_W,
    buildReqColorViews, REQ_COLOR_KEYS, reqColorScale, reqIdStyle, reqIdKeyEntries, normalizeColorKey,
    DEFAULT_PLAN_PALETTE, isPlanPalette, planPalette,
    DEFAULT_COLOR_KEY, pinnedLevelOf, DEFAULT_PLAN_LEVEL_PREF,
    DEFAULT_STEP_WIDTH_LEVEL,
    INITIATIVE_PAUSE_BUBBLE_D, pauseBubbleColor, stickyRulerY, rulerScreenBottom,
    PAUSE_PAUSED_COLOR,
    // req #3649 — the initiative chip's padlock.
    INITIATIVE_LOCK_D,
    rulerScreenMag,
    KEY_GROUP_TITLES, orderStepReqs, hideClosedReqs, CARD_DONE_RULE_DASH, CARD_DONE_RULE_OPACITY,
} from './pipelinePlanLayout';
import {
    initiativeCycleKey, initiativeZoomStateKey, initiativeWorkStepIds, nextInitiativeZoom,
    initiativeZoomHintSuffix, gestureMovedCamera,
    INITIATIVE_ZOOM_CLICK_SLOP, INITIATIVE_ZOOM_BAND, INITIATIVE_ZOOM_STEP,
} from './pipelineInitiativeZoom';
// req #3428 — the initiative chip's second destination. The URL contract lives with
// the rest of `/swarm`'s query string, so this file names no query key itself.
import { swarmInitiativeLinkTo, swarmStepLinkTo } from '../swarmViewLink';
import { planExitState } from './pipelineStepLink';
import { useSavedViewport } from '../../hooks/useSavedViewport';
import { usePlanViewSetting } from './planViewSettings';
// req #3650 — every initiative chip's and step card's own fold.
import {
    parseCollapsed, toggleInitiativeCollapsed, toggleStepCollapsed, expandInitiative, expandStep,
} from './planCollapse';
import PlanCollapseHead from './PlanCollapseHead';
import { useFoldAnimation, foldContentAlpha } from './planFoldAnimation';
// req #3581 — dragging a requirement between steps writes its seat.
import AppContext from '../../Context/AppContext';
import AuthContext from '../../Context/AuthContext';
import { pipelineComposeKeys, requirementKeys } from '../../hooks/useQueryKeys';
import {
    pipelineStepRequirementKeys, pipelineStepKeys, pipelineStepDepKeys, initiativeKeys,
    useAllCategories,
} from '../../hooks/useDataQueries';
import { useSnackBarStore } from '../../stores/useSnackBarStore';
import {
    moveStepRequirement, insertStepOnEdge, addDependentStep, precedeStepWith,
    isRestNullLiteral, REST_NULL, updateStep, createStep,
} from '../../Steps/stepsApi';
// req #3649 — the initiative chip's lock control; req #3673 — the pictures on it and
// on the step card's barrier and lock buttons.
import {
    BarrierGateIcon, PlanLockIcon, barrierTitle,
} from './PlanStepFlagIcons';
// req #3586 — the "+" marks that add a step on an edge or a dependent step; req
// #3617 adds the one off a free left side, for a step this one depends on.
import {
    insertMarkRadius, buildInsertMarks, insertMarkAt, insertRequest, NEW_STEP_TITLE,
    NEW_INITIATIVE_TITLE,
} from './pipelineStepInsert';
import {
    REQ_DRAG_SLOP, reqPressOutcome, stillHeld, dropTargetAt, canDropOn, applyReqMoves,
    canUnseatFrom, reqMoveReflected,
    edgePanVelocity,
} from './pipelineReqDrag';
// req #3665 — the app-wide press timeline and drag surface: the requirement
// marks read its numbers, the Orchestrables box drags through its context.
import { DarwinDndContext, LIFT_DELAY_MS, LIFT_VIBRATE_MS } from '../../dnd';
import { viewportStorageKey } from '../../utils/viewportMemory';
// req #3583 — the swarm-ready, not-orchestrated box and its drop-to-seat. The
// contexts, snackbar, query keys and `moveStepRequirement` are req #3581's,
// imported above.
import { hideMachineReqs, isMachineHidden } from './planMachineFilter';
import UnorchestratedReqBox, { ORCHESTRABLES_RACK_ID, UNSEATED_FLOAT_Z } from './UnorchestratedReqBox';
import { usePanelRackStore } from '../../stores/usePanelRackStore';
import { RACK_DRAG_Z } from '../../Components/AnchoredPanel/panelRack';
// req #3721 — the plan's requirements whose sessions are under way.
import PlanActiveBox from './PlanActiveBox';
// req #3793 — the shared full screen switch, and the plan's own words and corner.
import FullscreenSwitch from '../../Components/FullscreenSwitch';
import {
    MAXIMIZE_SWITCH, MAXIMIZE_SWITCH_Z, PLAN_MAXIMIZE_LABELS as MAXIMIZE_LABELS, maximizeSwitchWorldRight,
} from './planMaximize';
import { activePlanRequirements } from './planActiveReqs';
import { useUnorchestratedRequirements } from './useUnorchestratedRequirements';
import {
    UNSEATED_DRAG_TYPE, bulkSeatRequest, resolveSeatDrop, screenRectOf, unseatedBoxFontPx,
    unseatedBoxWidthPx, unseatedBoxZoom,
    pointerCanSeat, runBulkSeat, bulkSeatFailureMessage, pointInRect,
} from './pipelineUnseated';
import '../../CalendarFC/swarmVisualizer.css';
// req #3580 — in-place edit. The SAME mutation helpers the Initiatives and Steps
// editors use (one gateway path per table); contexts, snackbar and query keys
// are the ones req #3581 already imports above.
import { updateInitiative, createInitiative } from '../../Initiatives/initiativesApi';
import PlanInPlaceInput, { titleProblem } from './PlanInPlaceInput';
import { createPressTracker, LONG_PRESS_MS, DOUBLE_CLICK_MS } from './planPressGesture';
// req #3661 — a requirement's title, edited in place on its own row.
import PlanInPlaceTitleArea from './PlanInPlaceTitleArea';
import { reqTitleEditorBox, updateRequirementTitle } from './planReqTitleEdit';
import {
    REQ_PILL_FONT, REQ_PILL_FONT_EM, REQ_PILL_H_EM, REQ_PILL_LABEL_PAD_EM, REQ_PILL_STROKE,
    REQ_PILL_STYLE,
} from './planReqPills';

// Stable default for the machine filter prop (req #3708).
const NO_HIDDEN_MACHINES = new Set();
const MONO = '"SF Mono", "JetBrains Mono", Menlo, monospace';

// req #3587 — the requirement row's Terminal and Dev Server pills. Their
// palette and proportions live in planReqPills.js, shared with the Active box
// (req #3721), which draws the same pills in HTML.
//
// Inside the gap before each token (`REQ_PILL_SEP` between pills, the id
// column's own separator before the first), so neighbours keep clear air.
// The CEILING on a pill's reach — see `REQ_PILL_LABEL_PAD_EM` for its width.
const REQ_PILL_PAD_X = CHW_REQ * 0.3;
// The pill's BOX is placed over the characters it replaced, MEASURED in the
// font the row is actually drawn in, so the air between the id, the pills and
// the title's dash stays even. `CHW_REQ` is a deliberate OVER-estimate of the
// mono advance (it sizes boxes, where erring wide is safe), so as a
// per-character OFFSET its error accumulates — and a browser without SF
// Mono/Menlo falls back to a narrower monospace (Consolas, ~0.55em). The layout
// still owns WHICH characters a pill covers; this only asks the canvas how wide
// they really are. One shared 2D context; null where there
// is no canvas (jsdom), and the caller falls back to the layout's advance.
let pillMeasureCtx;
const measureReqText = (str, fontSize, bold, fontSpec = null) => {
    try {
        if (pillMeasureCtx === undefined) {
            pillMeasureCtx = Konva.Util.createCanvasElement().getContext('2d') || null;
        }
        if (!pillMeasureCtx) return null;
        // Konva's own font string for a Text node: style, variant, size, family.
        pillMeasureCtx.font = fontSpec
            || `${bold ? 'bold' : 'normal'} normal ${fontSize}px ${MONO}`;
        const w = pillMeasureCtx.measureText(str).width;
        return Number.isFinite(w) && w > 0 ? w : null;
    } catch (e) {
        return null;
    }
};

// The requirement-mark colour scales, in the order they are reserved — the
// REGISTRY's order plus `none`, never a copy of it (req #3422), so a scale added
// there appears in the key here with no edit. Every one is rendered every time
// (hidden when not live) so the key's footprint is the MAX over all of them and
// therefore constant — see the key's own comment.
const REQ_KEY_SCALES = REQ_COLOR_KEYS;

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
/** An Orchestrables row in the air (req #3665): highlighted, not popped — the
 *  same quiet lift the canvas requirement gets, in place of the shared
 *  pickup's scale-and-bounce (user directive: "it jumps way too much"). */
const QUIET_LIFT_SX = {
    borderRadius: '4px',
    outline: `1px solid ${P.accent}`,
    boxShadow: '0 10px 28px rgba(0, 0, 0, 0.55)',
    '@keyframes planRowLift': {
        '0%': { outlineColor: 'transparent', boxShadow: '0 0 0 rgba(0,0,0,0)' },
    },
    animation: 'planRowLift 140ms ease-out',
    '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
};
/** Seat writes in flight at once when the whole box is dropped (req #3608) —
 *  each is its own gateway call and its own database connection. */
const BULK_SEAT_CONCURRENCY = 4;

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

// The run pill's STATIC chrome (req #3580) — hoisted so the ~100 pills on a
// live plan hand Emotion one unchanging object per pan/zoom frame rather than
// a fresh one each; everything that changes per frame or per state rides
// `style`.
const RUN_PILL_SX = {
    position: 'absolute', p: 0, m: 0, border: 'none',
    pointerEvents: 'auto', cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    borderRadius: '999px',
    color: P.panel, fontFamily: MONO, fontWeight: 700, lineHeight: 1,
    transition: 'opacity 120ms, box-shadow 120ms',
    '&[aria-busy="true"]': { cursor: 'progress' },
    '&:hover, &:focus-visible': { outline: 'none', boxShadow: `0 0 0 2px ${P.text}` },
};

// req #3673 — the barrier and lock buttons' static chrome; geometry and the
// state's colours ride `style`, for the run pill's per-frame reason.
const FLAG_BTN_SX = {
    position: 'absolute', p: 0, m: 0,
    pointerEvents: 'auto', cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    borderRadius: '4px', boxSizing: 'border-box', lineHeight: 1,
    transition: 'box-shadow 120ms',
    '&:hover, &:focus-visible': { outline: 'none', boxShadow: `0 0 0 2px ${P.text}` },
};

// Duration of the initiative-focus camera move (req #3204). Long enough to read as a
// move, short enough that a second click never feels queued.
const FOCUS_MS = 420;

// Key swatch — a colored dot (or ring) in the POC vocabulary. The requirement
// channel colours TYPE instead (LegendWord, below) — a dot there would
// misrepresent it as another bead, which is why this swatch only ever draws
// the STEP channel's marks now.
// `dashed` (req #3271): the canvas's next-step halo is DASHED, and that is not
// decoration — only 0.25px separates it from the bead's own eligible ring, so
// form rather than distance is the whole of what makes it read as a second mark
// (see NEXT_HALO_DASH). A key that advertised it as a solid ring described a
// mark the canvas does not draw, in the one channel where form carries meaning.
function LegendDot({ fill, ring, label, animated, dashed }) {
    return (
        <Stack direction="row" spacing={0.5} alignItems="center">
            <Box sx={{
                width: 10, height: 10, flexShrink: 0,
                borderRadius: '50%',
                bgcolor: fill || 'transparent',
                border: ring ? `2px ${dashed ? 'dashed' : 'solid'} ${ring}` : 'none',
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
        // `data-testid` so a test can ask for the WORDS and not for every span in
        // the block (req #3422 review W1). `KeyGroup`'s own caption is a
        // `<span>` too, and it is painted `PLAN_VIZ_PALETTE.dim` — which is
        // EXACTLY the unknown swatch — so a "every entry has its own colour"
        // assertion scoped to `span` counts the caption as an entry and collides
        // with `unknown` the first time a plan contains one.
        <Typography variant="caption" data-testid="pipeline-viz-legend-word"
                    sx={{ color, fontFamily: MONO, fontWeight: 700, fontSize: 10.5,
                           lineHeight: 1.35, whiteSpace: 'nowrap' }}>
            {label}
        </Typography>
    );
}

// req #3673 — a key entry whose swatch is a control's own picture: the icon
// the card draws, then its word in the state's colour.
function LegendIcon({ color, label, children }) {
    return (
        <Box component="span" data-testid="pipeline-viz-legend-icon"
             sx={{ display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
            {children}
            <LegendWord color={color} label={label} />
        </Box>
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
    plan, model, pipeline, focusInitiativeId,
    // Req #3253 — the deep link's OTHER target. This prop has always travelled
    // here (PipelineDetail hands the same page state to both panels); until now
    // the canvas ignored it, because a step was a ROW and only the table had one
    // to scroll to. It is also a BEAD, and the requirement page's "view on plan"
    // link means "show me where this requirement lives" — so a named step
    // centres and zooms the camera on it, the same handshake `focusInitiativeId`
    // already gets one level up.
    focusStepId,
    // Toolbar state is OWNED BY THE PAGE since req #3119 — the controls render in
    // the header row beside the pipeline name (the SwarmView/VisualizerToolbar
    // pattern, req #2407), so the panel is the canvas and nothing else.
    // `reqLayout` left with req #3498 — a card stacks its requirements, so it
    // had nothing left to select. `stepWidth` (the S/M/L content multiplier)
    // left with it for the same reason; `stepWidthLevel` below is its
    // req #3503 successor, scaling the CARD itself rather than a per-column
    // content negotiation that no longer exists — see `cardGeometryFor`.
    stepLabel = 'title', colorKey = DEFAULT_COLOR_KEY,
    reqLabel = 'id', levelPref = DEFAULT_PLAN_LEVEL_PREF,
    // req #3365 — WHICH colours the initiative bands and the two enum scales draw
    // from. Normalized below with the same discipline `colorKey` gets, and for
    // the same reason: it is a persisted preference crossing a component
    // boundary on its way to a Konva `fill`.
    palette = DEFAULT_PLAN_PALETTE,
    // A `levelPrefFromLink` flag rode beside `levelPref` between req #3310 and
    // req #3324, to tell a reader's own click from a `?level=` link for the sake
    // of the pin's camera correction. With no correction there is nothing that
    // needs to know: the level is DRAWN the same way whoever asked for it.
    // `levelPref` IN, the level actually drawn OUT. The SETTER is gone (req
    // #3241): the Auto/L1/L2/L3 control that called it moved to the page header,
    // so this panel no longer writes the preference — it reads it, draws at that
    // level, and reports which level that turned out to be.
    onEffectiveLevel,
    // req #3225 — the page's own persisted toggle. Governs the initiative band
    // label's count suffix here and the plan-name suffix on the page's own
    // header, from one shared preference.
    showReqCounts = false,
    // The header's Reset control (req #3216) lives outside this component, in
    // the zoom control group PipelineDetail.jsx owns, so the click has to
    // reach across that boundary. `resetViewNonce` is KonvaBuildCanvas's own
    // device for exactly this (`resetViewNonce`/`frame`): a number that only
    // ever increments, watched by an effect below. 0 is the initial render.
    resetViewNonce = 0,
    // req #3498 — `{n, nonce}` from the header's steps-across buttons. Same
    // handshake as `resetViewNonce`: the control lives on the page, the camera
    // lives here, and the nonce is what makes a repeated click fire again.
    stepsAcross = null,
    // req #3498 — when true the WHEEL walks the steps-across ladder instead of
    // scaling continuously. Read through a ref by the zoom filter below, so
    // toggling it never rebuilds the zoom behaviour (which would drop the
    // reader's camera).
    snapZoom = false,
    // req #3503 — "Step Width". A `STEP_WIDTH_RUNGS` value (6 5 4 3, quarters
    // of the base card since req #3648). The ONE
    // toolbar control that RELAYOUTS rather than just moving the camera —
    // every column, every card, every wrap point in `layout` below depends on
    // it, so it rides in `computePlanLayout`'s own options rather than being
    // applied as a post-hoc transform the way every other control here is.
    stepWidthLevel = DEFAULT_STEP_WIDTH_LEVEL,
    // req #3686 — draw only the OPEN requirements under each step (the closed
    // group and its dashed line are dropped from the layout's input).
    hideClosed = false,
    // req #3708 — machine ids deselected in the toolbar's machine filter: the
    // requirements pinned to them are drawn nowhere (step cards, Orchestrables).
    hiddenMachines = NO_HIDDEN_MACHINES,
    // req #3587 — requirement id -> {terminal, devServer} (`planReqPills.js`),
    // built by the page from reads it owns. Drawn as pills between a row's id
    // and its title; null draws every row exactly as before.
    reqPills = null,
    // req #3702 — requirement id -> latest session status (the page's own
    // `buildSessionStatusIndex`), so the Orchestrables box can paint its rows by
    // the Session colour key too. Its rows sit on no step, so `model` has none.
    sessionStatus = null,
    // req #3658 — the page is maximized (PipelineDetail owns the state, because
    // what it hides — the header row and the navbar — is the page's), and the
    // switch's click. No `onToggleMaximized`, no switch.
    maximized = false,
    onToggleMaximized = null,
    // req #3722 — the colour help is a HOVER popup on the toolbar's chips. The
    // page owns the toolbar, so the chip under the pointer arrives here as
    // `{ key, el }` (`key` a colour scale, or 'step'; `el` the chip to anchor
    // to), null when none is hovered; `pinned: true` when a long press holds it
    // open (req #3766).
    keyHover = null,
}) {
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const { darwinUri } = useContext(AppContext);
    const { idToken, profile } = useContext(AuthContext);
    const showError = useSnackBarStore((st) => st.showError);
    const showMessage = useSnackBarStore((st) => st.showMessage);

    // ── Requirement drag-and-drop: the moves in flight (req #3581) ──────────
    // A dropped requirement is drawn on its NEW step from the instant of the
    // drop, and stays there through the write and the refetch — see
    // `applyReqMoves` for why that is one redraw rather than two. Each entry
    // leaves this list once the refetch it triggered has landed (or the write
    // failed, in which case the refetched server rows ARE the revert).
    const [pendingMoves, setPendingMoves] = useState([]);

    // ── Add a step from the canvas (req #3586) ──────────────────────────────
    // `insertReq` is the open dialog's request (`insertRequest`), null when
    // closed. The marks themselves are ONE non-listening Konva shape whose
    // geometry is memoized per layout (see `insertGeom` below), and clicks and
    // hover resolve against that geometry in the native listeners — so the
    // marks add no hit-graph nodes and no React state on pointer movement.
    // `insertHoverRef` is the key of the "+" under the pointer.
    const [insertReq, setInsertReq] = useState(null);
    const [insertTitle, setInsertTitle] = useState(NEW_STEP_TITLE);
    const [insertInitiative, setInsertInitiative] = useState('');
    const [inserting, setInserting] = useState(false);
    const insertHoverRef = useRef(null);
    const insertGeomRef = useRef(null);
    const insertHitRef = useRef(null);
    const openInsertRef = useRef(null);

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
                machineFk: r.machine_fk, session: r.session_status,
            }])),
        [model]);
    // req #3676 — the requirement marks stacked under a step are in
    // ORCHESTRATION order whatever colour key is on: open work above complete,
    // `deployed` first within each, then FIFO (`sortReqIdsByOrchestration`).
    // `orderStepReqs` reorders each row's `reqIds` only and stamps
    // `reqDoneFrom` for the complete line; every engine field on the row is
    // left as computed, so the display order never touches what `/swarm-start`
    // launches.
    const rows = useMemo(() => {
        const base = applyReqMoves(plan.rows || [], pendingMoves);
        if (!base.length) return base;
        return orderStepReqs(base, {
            statusOf: (id) => reqInfo.get(id)?.status,
            autonomyOf: (id) => reqInfo.get(id)?.coordination,
        });
    }, [plan.rows, pendingMoves, reqInfo]);
    const rowById = useMemo(() => new Map(rows.map((r) => [r.id, r])), [rows]);

    // The initiatives the add-step dialog offers: the payload's own `initiatives[]` (an
    // initiative with no steps yet included), in the plan's initiative order. Falls back to
    // the initiatives the rows name when a caller hands in a model without them.
    const insertInitiativeOptions = useMemo(() => {
        const fromModel = (model?.initiatives || []).map((e) => ({
            id: e.id, title: e.title, sortOrder: e.sort_order,
        }));
        const list = fromModel.length ? fromModel : [...new Map(rows
            .filter((r) => r.initiativeId != null)
            .map((r) => [r.initiativeId, { id: r.initiativeId, title: r.initiative, sortOrder: r.initiativeSortOrder }]))
            .values()];
        return list.sort((a, b) => (a.sortOrder ?? Infinity) - (b.sortOrder ?? Infinity)
            || a.id - b.id);
    }, [model, rows]);

    // When the dialog opened — a double-click on a "+" lands its second click
    // on the dialog's backdrop, which would close it again at once.
    const insertOpenedAtRef = useRef(0);
    const openInsert = useCallback((kind, ids) => {
        const req = insertRequest(kind, ids, rowById);
        setInsertTitle(NEW_STEP_TITLE);
        setInsertInitiative(req.initiativeId ?? '');
        insertOpenedAtRef.current = Date.now();
        setInsertReq(req);
    }, [rowById]);
    const closeInsert = useCallback((event, reason) => {
        if (reason === 'backdropClick' && Date.now() - insertOpenedAtRef.current < 600) return;
        if (!inserting) setInsertReq(null);
    }, [inserting]);

    const commitInsert = useCallback(async () => {
        const req = insertReq;
        if (!req || inserting) return;
        const title = insertTitle.trim();
        if (!title) {
            showError('Title is required');
            return;
        }
        if (isRestNullLiteral(title)) {
            showError(`"${REST_NULL}" is the API's clear-this-column sentinel and cannot `
                + 'be a title. Try "Null" or another wording.');
            return;
        }
        if (insertInitiative === '' || insertInitiative == null) {
            showError('Initiative is required');
            return;
        }
        setInserting(true);
        try {
            if (req.kind === 'edge') {
                await insertStepOnEdge(darwinUri, idToken, {
                    fromStepId: req.fromId, toStepId: req.toId,
                    initiative_fk: insertInitiative, title,
                });
            } else if (req.kind === 'precede') {
                await precedeStepWith(darwinUri, idToken, {
                    toStepId: req.toId, initiative_fk: insertInitiative, title,
                });
            } else {
                await addDependentStep(darwinUri, idToken, {
                    fromStepId: req.fromId, initiative_fk: insertInitiative, title,
                });
            }
            setInsertReq(null);
        } catch (error) {
            if (error?.orphanStep) {
                // The step exists with no edges; a retry would make a second.
                setInsertReq(null);
                showError(error, 'Step created without its dependencies');
            } else if (error?.redundantEdge) {
                // The new step is in and wired; only the old direct edge is
                // left, which gates exactly as the chain does.
                setInsertReq(null);
                showError(error, `Step inserted, but step ${req.toId} still also `
                    + `waits on step ${req.fromId} directly`);
            } else {
                showError(error, req.kind === 'edge'
                    ? 'Could not insert the step' : 'Could not add the step');
            }
        } finally {
            setInserting(false);
            if (pipeline?.id != null) {
                queryClient.invalidateQueries({ queryKey: pipelineComposeKeys.byId(pipeline.id) });
            }
            queryClient.invalidateQueries({ queryKey: pipelineStepKeys.all(profile?.userName) });
            queryClient.invalidateQueries({ queryKey: pipelineStepDepKeys.all(profile?.userName) });
            queryClient.invalidateQueries({ queryKey: ['orchestration_index'] });
        }
    }, [insertReq, inserting, insertTitle, insertInitiative, darwinUri, idToken,
        pipeline?.id, profile?.userName, queryClient, showError]);

    // ── Add an initiative from the canvas (req #3719) ─────────────────────────────
    // The "+" under the last initiative band. An initiative's band is drawn from its STEPS,
    // so an initiative with none would be created and not appear anywhere on this
    // canvas; the dialog therefore creates the initiative AND its first step (the
    // same placeholder title the add-step dialog starts from), and the band
    // shows up as soon as the plan re-reads. `initiativeAddOpen` is the dialog.
    const [initiativeAddOpen, setInitiativeAddOpen] = useState(false);
    const [initiativeAddTitle, setInitiativeAddTitle] = useState(NEW_INITIATIVE_TITLE);
    const [initiativeAddCategory, setInitiativeAddCategory] = useState('');
    const [initiativeAdding, setInitiativeAdding] = useState(false);
    const initiativeAddOpenedAtRef = useRef(0);
    const openInitiativeAddRef = useRef(null);
    const { data: categories = [] } = useAllCategories(
        profile?.userName, { fields: 'id,category_name,sort_order,closed' });
    const initiativeAddCategories = useMemo(() => categories
        .filter((c) => !c.closed)
        .sort((a, b) => (a.sort_order ?? Infinity) - (b.sort_order ?? Infinity)
            || String(a.category_name).localeCompare(String(b.category_name))),
    [categories]);
    const openInitiativeAdd = useCallback((afterInitiativeId) => {
        // Default to the category of the initiative this "+" sits under.
        const last = (model?.initiatives || []).find((e) => e.id === afterInitiativeId) || null;
        const open = initiativeAddCategories.some((c) => c.id === last?.category_fk);
        setInitiativeAddTitle(NEW_INITIATIVE_TITLE);
        setInitiativeAddCategory(open ? last.category_fk : (initiativeAddCategories[0]?.id ?? ''));
        initiativeAddOpenedAtRef.current = Date.now();
        setInitiativeAddOpen(true);
    }, [model, initiativeAddCategories]);
    openInitiativeAddRef.current = openInitiativeAdd;
    const closeInitiativeAdd = useCallback((event, reason) => {
        if (reason === 'backdropClick' && Date.now() - initiativeAddOpenedAtRef.current < 600) return;
        if (!initiativeAdding) setInitiativeAddOpen(false);
    }, [initiativeAdding]);
    const commitInitiativeAdd = useCallback(async () => {
        if (initiativeAdding) return;
        const title = initiativeAddTitle.trim();
        if (!title) { showError('Title is required'); return; }
        if (isRestNullLiteral(title)) {
            showError(`"${REST_NULL}" is the API's clear-this-column sentinel and cannot `
                + 'be a title. Try "Null" or another wording.');
            return;
        }
        if (initiativeAddCategory === '' || initiativeAddCategory == null) {
            showError('Category is required');
            return;
        }
        setInitiativeAdding(true);
        let initiative = null;
        try {
            initiative = await createInitiative(darwinUri, idToken, {
                pipeline_fk: pipeline.id, title, category_fk: initiativeAddCategory,
            });
            const initiativeId = Array.isArray(initiative) ? initiative[0]?.id : initiative?.id;
            setInitiativeAddOpen(false);
            if (initiativeId == null) {
                // The row was written but not read back (stepsApi documents a
                // 201 with no body): retrying here would make a second initiative.
                showError('The initiative may have been created without a first step — '
                    + 'check the Initiatives page before adding it again');
                return;
            }
            try {
                await createStep(darwinUri, idToken, { initiative_fk: initiativeId, title: NEW_STEP_TITLE });
            } catch (error) {
                showError(error, 'Initiative created, but its first step could not be added');
            }
        } catch (error) {
            showError(error, 'Could not create the initiative');
        } finally {
            setInitiativeAdding(false);
            if (pipeline?.id != null) {
                queryClient.invalidateQueries({ queryKey: pipelineComposeKeys.byId(pipeline.id) });
            }
            if (profile?.userName) {
                queryClient.invalidateQueries({ queryKey: initiativeKeys.all(profile.userName) });
            }
            queryClient.invalidateQueries({ queryKey: pipelineStepKeys.all(profile?.userName) });
            queryClient.invalidateQueries({ queryKey: ['orchestration_index'] });
        }
    }, [initiativeAdding, initiativeAddTitle, initiativeAddCategory, darwinUri, idToken, pipeline?.id,
        profile?.userName, queryClient, showError]);
    const eligibleStepIds = plan.eligibleStepIds || new Set();
    // The requirement TITLE lookup, when that mark is showing (req #3168). Built
    // from `reqInfo`, which the hover card already needed — so the option costs
    // no extra read and no extra pass over the model. Passed as an ARGUMENT
    // rather than attached to the engine's rows; the reasoning is on
    // `reqLabelText` in the layout module.
    const reqTitles = useMemo(
        () => new Map([...reqInfo].map(([id, info]) => [id, info.title])), [reqInfo]);
    // req #3661 — the requirement title open in its in-place editor
    // (`{ reqId, stepId, saving }` — the row, not just the requirement), and
    // what has been typed (`reqId -> title`). Declared here, not with the other
    // in-place edits below, because the LAYOUT reads the drafts: the card is
    // laid out around the title being typed — wrapped, and grown or shrunk a
    // line, exactly as it will be drawn once saved — so the editor is always
    // the size of what it will become. A draft stays until its save's re-read
    // lands, so a save never flashes the old title back — including one whose
    // editor was closed by opening the next row's (several drafts at once).
    const [reqEdit, setReqEdit] = useState(null);
    const [reqDrafts, setReqDrafts] = useState(() => new Map());
    const layoutTitles = useMemo(() => {
        if (!reqDrafts.size) return reqTitles;
        const out = new Map(reqTitles);
        reqDrafts.forEach((title, id) => out.set(id, title));
        return out;
    }, [reqTitles, reqDrafts]);
    // req #3225 — the initiative->{met,total} lookup `computePlanLayout` measures
    // into the band label. Built from `plan.requirementCounts.byInitiative`, the
    // SAME derivation `orderedPlan` already ran (design rule 5: no second
    // pass over the model just to feed this component). `null` while the
    // toggle is off, so an unlit toggle costs the layout nothing beyond the
    // one extra memo dependency — every band's label reads exactly as it did
    // before this requirement.
    const initiativeCounts = useMemo(() => {
        if (!showReqCounts) return null;
        return new Map((plan.requirementCounts?.byInitiative || [])
            .map((c) => [c.initiativeId, c]));
    }, [showReqCounts, plan.requirementCounts]);
    // `plan.timeAxis` (req #3201) is what makes the horizontal axis read as a
    // calendar and stacks the bands by initiative start. It comes from `orderedPlan`
    // rather than being derived here for the same reason cost does: two
    // surfaces over one plan must not each derive the same fact.
    // Normalized HERE as well as in the page, for `activeColorKey`'s reason.
    const activePalette = isPlanPalette(palette) ? palette : DEFAULT_PLAN_PALETTE;
    // req #3650 — the initiatives and steps folded by their own collapse heads. One
    // remembered setting, so a fold survives every way of leaving the canvas
    // and coming back, exactly as the key's popout does (req #3651).
    const [collapsedRaw, setCollapsedRaw] = usePlanViewSetting('collapsed');
    const collapsed = useMemo(() => parseCollapsed(collapsedRaw), [collapsedRaw]);
    // req #3695 — the fold flips at once; its DRAWING animates (see
    // `planFoldAnimation.js`): a folding box shrinks to its title bar, an
    // unfolding one grows to the size it needs.
    const { foldReveal, animateFold } = useFoldAnimation();
    const folding = foldReveal != null;
    const toggleInitiativeFold = useCallback((initiativeId) => {
        animateFold(initiativeId, collapsed.initiativeIds.has(initiativeId));
        setCollapsedRaw((raw) => toggleInitiativeCollapsed(raw, initiativeId));
    }, [setCollapsedRaw, animateFold, collapsed]);
    const toggleStepFold = useCallback(
        (stepId) => setCollapsedRaw((raw) => toggleStepCollapsed(raw, stepId)),
        [setCollapsedRaw]);
    // req #3686 — `orderStepReqs` puts the closed requirements last, from
    // `reqDoneFrom` on; hiding them is slicing there. Only the LAYOUT's input is
    // trimmed: `rows` (drag, seating, counts) keeps every requirement.
    // req #3708 — and the requirements pinned to a deselected machine, in the
    // same layout-only pass; `reqInfo` already carries each one's `machineFk`.
    const layoutRows = useMemo(() => {
        const open = hideClosed ? hideClosedReqs(rows) : rows;
        return hideMachineReqs(open, hiddenMachines, (id) => reqInfo.get(id)?.machineFk);
    }, [rows, hideClosed, hiddenMachines, reqInfo]);
    const layoutOpts = useMemo(
        () => ({
            stepLabel, reqLabel, reqTitles: layoutTitles, reqPills,
            palette: activePalette,
            timeAxis: plan.timeAxis || null, initiativeCounts,
            // req #3226 — `plan.pause` comes from the composed derivation (same
            // provenance as `requirementCounts`/`timeAxis` above): one
            // derivation, read here rather than recomputed.
            pauseInfo: plan.pause || null,
            // req #3649 — which bands are LOCKED (their own initiative, or the plan).
            lockInfo: { planLocked: !!plan.locked,
                        lockedInitiativeIds: [...(plan.lockedInitiativeIds || [])] },
            stepWidthLevel,
            collapsedInitiativeIds: collapsed.initiativeIds, collapsedStepIds: collapsed.stepIds,
        }),
        [plan.timeAxis, stepLabel,
            reqLabel, layoutTitles, reqPills, initiativeCounts, plan.pause, plan.locked,
            plan.lockedInitiativeIds, activePalette, stepWidthLevel, collapsed]);
    const layout = useMemo(
        () => computePlanLayout(layoutRows, layoutOpts), [layoutRows, layoutOpts]);
    // req #3695 — THE LAYOUT THE CANVAS DRAWS. While an initiative's fold animates it
    // is re-laid out every frame with that band part-way open; otherwise it IS
    // `layout`. Only the drawing reads it: the camera, the zoom behaviour's
    // pan bound and every focus fit keep the SETTLED `layout` — the plan the
    // animation is arriving at — so a fold never rebuilds the zoom behaviour
    // sixty times or interrupts a camera move in flight.
    const drawLayout = useMemo(
        () => (foldReveal
            ? computePlanLayout(layoutRows, { ...layoutOpts, foldReveal })
            : layout),
        [foldReveal, layout, layoutRows, layoutOpts]);
    // A LINK INTO A FOLDED BOX UNFOLDS IT (req #3650). `?initiative=` and `?step=`
    // name a place on the plan to land on, and a folded band draws no cards —
    // so the fit would have nothing to fit. `?step=` is how the requirement
    // page shows a requirement on its plan, so the step unfolds too, or its
    // rows would stay hidden. Every other fold stays as the reader left it.
    //
    // ONCE PER LINK, NOT WHILE IT STANDS: the focus props live as long as the
    // history entry does, so an effect that kept unfolding while they were set
    // would undo every fold the reader then made on that very box. The fold
    // state is therefore not a dependency — this answers "a link arrived",
    // never "the box is folded".
    const linkUnfoldedRef = useRef(null);
    useEffect(() => {
        if (focusInitiativeId == null && focusStepId == null) {
            linkUnfoldedRef.current = null;
            return;
        }
        const key = `${focusInitiativeId}:${focusStepId}`;
        if (linkUnfoldedRef.current === key) return;
        const initiatives = focusInitiativeId != null ? [focusInitiativeId] : [];
        if (focusStepId != null) {
            if (!rowById.has(focusStepId)) return;       // the plan has not loaded it yet
            initiatives.push(rowById.get(focusStepId).initiativeId ?? null);
        }
        linkUnfoldedRef.current = key;
        setCollapsedRaw((raw) => {
            const next = initiatives.reduce(expandInitiative, raw);
            return focusStepId != null ? expandStep(next, focusStepId) : next;
        });
    }, [focusInitiativeId, focusStepId, rowById, setCollapsedRaw]);

    // ── The REQUIREMENT-ID channel (req #3119; #3168 neutral; #3422 registry) ─
    // Whatever the key, it rides the requirement ids and never the bead: the
    // bead's fill already carries derived STEP state (rule 1), and repainting it
    // would trade that reading for this one. The full colour language, and the
    // one-fact-one-channel-one-level rule it turns on, is documented in
    // pipelinePlanLayout.js — which is also where every colour below is decided
    // and where the SCALES THEMSELVES are registered, so the canvas and the
    // on-screen key cannot drift apart and neither can name a scale the other
    // does not have.
    // Normalized HERE as well as in the page (review discipline): the prop is a
    // persisted preference travelling through a component boundary, and a
    // visualizer rendered from anywhere else must not be able to receive a
    // localStorage string this file then hands to Konva as a `fill`.
    const activeColorKey = normalizeColorKey(colorKey);
    // The requirements this plan actually DRAWS. Since req #3621 the key lists
    // every value of every scale regardless; these ids decide only whether an
    // `unknown` swatch is listed, because a drawn mark is wearing it. One pass
    // over the rows, no extra read — ids rather than values (req #3422), because
    // the registry's builders each read their own column off the requirement.
    const presentReqIds = useMemo(() => {
        const seen = new Set();
        for (const row of rows) for (const reqId of row.reqIds || []) seen.add(reqId);
        return seen;
    }, [rows]);
    // EVERY scale, always, not just the live one — the canvas reads one view out
    // of this bag and the key renders them all. The key stacks them in one grid
    // cell to reserve a footprint that cannot move when the colour mode does
    // (user directive: "when I select machine view the key gets too small"), and
    // a cell can only be sized by children that exist. Same module and same
    // resolver as the canvas — the key is a rendering of the language, never a
    // second copy of it.
    const reqColorViews = useMemo(() => buildReqColorViews({
        requirements: model?.requirements, machines: model?.machines, presentReqIds,
        palette: activePalette,
    }), [model, presentReqIds, activePalette]);
    const reqKeyScales = useMemo(() => Object.fromEntries(
        REQ_KEY_SCALES.map((scale) => [scale, reqIdKeyEntries({
            colorKey: scale, views: reqColorViews,
        }).entries])), [reqColorViews]);
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
    // ── The REQUIREMENT drag (req #3581) — not to be confused with the pan ──
    // `draggingRef` above is d3's camera gesture. This one moves a requirement
    // to another step, and the two never coexist: the zoom filter refuses any
    // press that lands on a requirement mark (`reqHitRef`), so a press there
    // belongs to the requirement — a click navigates, a drag moves it.
    //
    // `reqDragRef` is the gesture's live state (`{phase: 'press' | 'drag', …}`),
    // read by native listeners at pointer rate, so a ref. `reqDrag` is the slice
    // the RENDER needs — which mark to grey, the preview image — and is set only
    // at drag start and drag end, so a drag in progress re-renders the canvas
    // only when the target step under the pointer changes (`dropStepId`), never
    // per pointermove. `reqHitRef` holds the current hit test so the zoom
    // behaviour, built once, sees the current stage without being rebuilt.
    const reqDragRef = useRef(null);
    const reqHitRef = useRef(null);
    // req #3661 — opens a requirement's title editor from a long press on its
    // row, or answers false when this frame draws no title to edit. Rebound
    // every render (below `drawsKind`) so the press listeners read this frame's
    // level.
    const reqLongPressRef = useRef(null);
    // Re-aims the drop outline after the camera moves under a still pointer —
    // a wheel zoom or an edge auto-pan mid-drag. Called from the zoom
    // behaviour's own 'zoom' handler, the one place every camera move passes
    // through (d3's wheel listener stops every other listener on the element).
    const reqRetargetRef = useRef(null);
    const reqClickGuardRef = useRef(false);
    const dragPreviewRef = useRef(null);
    const [reqDrag, setReqDrag] = useState(null);
    const [dropStepId, setDropStepId] = useState(null);
    // req #3817 — THE ORCHESTRABLES BOX IS A DROP TARGET TOO. A requirement
    // dragged off a step and released over the box (wherever it is: home,
    // floated anywhere in the window, racked in the navbar) is UN-orchestrated
    // — its seat deleted, so it is the box's. `unseatBoxRef` is the box's own
    // element (it hands it over through `dropTargetRef`), hit-tested by CLIENT
    // point before any step card, since it floats above them. `dropOnBox` is
    // true while the requirement in flight is over it and may leave its step.
    const unseatBoxRef = useRef(null);
    const [dropOnBox, setDropOnBox] = useState(false);
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

    // ── The swarm-ready, not-orchestrated box (req #3583) ───────────────────
    // `seatTarget` is the step card under the cursor (`{stepId, ok}`,
    // outlined), and `pendingSeats`
    // the rows already dropped whose write or refetch has not landed — hidden
    // from the box at once so a drop never shows the row snapping back.
    // (`darwinUri`/`idToken`/`profile`/`queryClient`/`showError` are declared
    // once, at the top of the component, for req #3581.)
    const unseated = useUnorchestratedRequirements(profile?.userName);
    const [seatTarget, setSeatTarget] = useState(null);
    const [pendingSeats, setPendingSeats] = useState(() => new Set());
    const [boxCarrying, setBoxCarrying] = useState(false);
    // req #3735 — a box carried OUT OF the navbar rack is drawn from inside the
    // navbar, which lifts itself to RACK_DRAG_Z for the drag; the seat-target
    // outline must clear that, not just the box's own UNSEATED_FLOAT_Z.
    const boxFromRack = usePanelRackStore(
        (s) => s.drag?.id === ORCHESTRABLES_RACK_ID && !!s.drag.fromRack);
    // req #3817 — a requirement dropped on the box from a step is the box's
    // from the instant of the drop, as a seat leaves it at once: drawn from the
    // plan's own row until the junction read lists it. Only a SWARM-READY one —
    // the box lists ready work and nothing else, so any other status simply
    // leaves the plan.
    // The row is the one captured AT THE DROP (`commitReqMove`): the plan's
    // read stops carrying it once its refetch lands, which may be before the
    // junction's. Until the DELETE is written the row cannot be dragged back
    // out — its seat still exists, so a seat would collide with it.
    const boxRows = useMemo(() => {
        const unseating = pendingMoves.filter((m) => m.toStepId == null
            && m.req?.requirement_status === 'swarm_ready');
        if (!unseating.length) return unseated.items;
        const listed = new Set(unseated.items.map((r) => Number(r.id)));
        const added = unseating
            .filter((m) => !listed.has(m.reqId))
            .map((m) => ({ ...m.req, unseating: m.writtenRows === undefined }));
        if (!added.length) return unseated.items;
        return [...unseated.items, ...added].sort((a, b) => Number(a.id) - Number(b.id));
    }, [unseated.items, pendingMoves]);
    const unseatedItems = useMemo(
        () => boxRows.filter((r) => !pendingSeats.has(Number(r.id))
            && !isMachineHidden(r.machine_fk, hiddenMachines)),
        [boxRows, pendingSeats, hiddenMachines]);
    // req #3702 — the Orchestrables rows follow the reader's colour preference.
    // The SAME registry, theme and resolver as the canvas ids, built over the
    // box's own rows (they sit on no step, so `model.requirements` lacks them).
    // `session_status` is attached exactly as `buildPlanModel` does; with no
    // index yet the Session scale paints unknown rather than "no session".
    const unseatedColorViews = useMemo(() => buildReqColorViews({
        requirements: boxRows.map((r) => ({
            ...r, id: Number(r.id),
            ...(sessionStatus && {
                session_status: sessionStatus.get(Number(r.id)) ?? 'no_session',
            }),
        })),
        machines: model?.machines,
        palette: activePalette,
    }), [boxRows, sessionStatus, model?.machines, activePalette]);
    // req #3721 — the Active box: this plan's requirements whose latest
    // session is under way, in the cards' own order, coloured by the canvas's
    // own resolver. Off rows and requirements already in hand — no new read.
    const activeItems = useMemo(() => activePlanRequirements({
        rows, requirements: model?.requirements, hiddenMachines,
    }), [rows, model?.requirements, hiddenMachines]);
    const activeIdStyleOf = useCallback((reqId) => reqIdStyle({
        colorKey: activeColorKey, views: reqColorViews, reqId: Number(reqId),
    }), [activeColorKey, reqColorViews]);
    const openActiveReq = useCallback((id) => navigate(`/swarm/requirement/${id}`,
        pipeline?.id ? { state: planExitState(pipeline.id, 'plan') } : undefined),
    [navigate, pipeline?.id]);
    const unseatedIdStyleOf = useCallback((reqId) => reqIdStyle({
        colorKey: activeColorKey, views: unseatedColorViews, reqId: Number(reqId),
    }), [activeColorKey, unseatedColorViews]);
    // req #3608 — the whole box dropped on a step: the open confirm dialog's
    // request (`bulkSeatRequest`), null when closed, and whether its writes are
    // in flight.
    // (req #3614) `bulkSeat` is the request being ASKED about and `bulkSeatOpen`
    // whether the dialog is showing: the request stays rendered until the exit
    // transition ends, so the title and list do not blank while it closes.
    const [bulkSeat, setBulkSeat] = useState(null);
    const [bulkSeatOpen, setBulkSeatOpen] = useState(false);
    const [bulkSeating, setBulkSeating] = useState(false);
    // The last pointer of a carrying title-bar move, and a ref to the function
    // that re-resolves the outlined step from it. A wheel zoom mid-carry moves
    // every card under a pointer that did not move, so the target is re-judged
    // whenever the transform changes (req #3614) — via a ref because the
    // function is defined below the empty-plan early return, the effect above it.
    const boxPointerRef = useRef(null);
    // req #3665 — a box ROW in the air: the pointer dnd-kit last reported, and
    // the collision detection it calls (stable, so the context can keep it).
    const rowPointerRef = useRef(null);
    const seatCollideRef = useRef(() => []);
    const seatCollision = useCallback((args) => seatCollideRef.current(args), []);
    const reseatRef = useRef(null);
    useEffect(() => { reseatRef.current?.(); }, [transform]);

    // ── The camera survives leaving the page (req #3252) ────────────────────
    // `transform` above is component state, and EVERY way of leaving this panel
    // unmounts the component: a requirement label, an initiative chip's ↗, the
    // breadcrumb, browser Back, a reload (and, until req #3641 withdrew the
    // Table, a bead click into it and the Table|Plan toggle). The comment on the
    // requirement label below used to end "only pan/zoom re-fits"; this is that
    // sentence being retired.
    //
    // There is deliberately NO LIST OF RETURN PATHS anywhere in this file. The
    // camera is written down whenever it moves and read back when the canvas
    // lands, so a link added tomorrow is covered without being enumerated today
    // — the user's ask was "all occasions, not just the three I mentioned".
    //
    // KEYED ON THE PLAN: two plans open in one tab keep their own camera, and
    // `pipeline?.id` being absent disables persistence rather than letting an
    // unidentified canvas read another one's position.
    const viewportKey = pipeline?.id != null
        // req #3463 — era-qualified, so 1.0 plan 7 and 2.0 plan 7 did not share
        // one camera (and one is not pruned by the other list's liveness read).
        ? viewportStorageKey(planStorageNamespace(), pipeline.id) : null;
    // SIGNATURE is the one input that RESCALES the world: the Step Width rung
    // (req #3637). It used to be the layout's own dimensions plus its row and
    // band counts, and that refused a restore for any change at all between two
    // visits — a requirement added to a card, a status that re-wrapped a title,
    // the time axis growing by a day — so a reload routinely landed on the base
    // view for a plan the reader could still perfectly well have seen from
    // where they were. Content that GREW is not content that MOVED: columns
    // keep their places, and `clampPlanTransform` bounds whatever does change on
    // the restore path. Step Width is different in kind — every card, column
    // and wrap point is re-scaled, so a camera from another rung points at
    // unrelated content and is refused.
    // `q` since req #3648 — the rungs became quarters of the base card (6 5 4
    // 3), so a camera saved under the old `sw1`-`sw4` was taken at a different
    // width than the same number means now.
    const viewportFingerprint = `q${stepWidthLevel}`;
    const viewport = useSavedViewport(viewportKey, viewportFingerprint);
    // The live camera, mirrored out of the d3-zoom 'zoom' handler so the commit
    // on unmount has something to write. A ref, not state: this is read only by
    // effects and costs one assignment per pointermove.
    const liveTransformRef = useRef(null);
    // ── EVERY CAMERA MOVE PERSISTS, A DEEP LINK'S INCLUDED (req #3637) ──────
    // A save-suppression flag used to keep a `?initiative=`/`?step=` focus out of
    // storage (req #3252: "a link must never rewrite what the reader chose").
    // Req #3637 reverses it: *"refresh, reload, should not change the viewport"*
    // — the camera ON SCREEN is the one a reload or a Back must bring back, and
    // after following a link that camera IS the link's. Saving anything else
    // made a reload jump from the initiative the reader was looking at to a pan they
    // had left behind. A link still cannot re-fire on a reload or a Back:
    // PipelineDetail consumes it once (`planLinkConsumed`), so nothing here
    // needs to tell a link from a gesture for the purpose of saving.
    // Has the reader CHOSEN where to look this mount? Guards the `?initiative=`
    // re-focus below — see it for why (req #3252 review).
    //
    // Three things set it, and they are exactly the three that also persist:
    // a d3 gesture (drag or wheel), the header's Reset, and a band-header or
    // sticky-chip focus click. The last two are the ones a `sourceEvent` test
    // alone MISSES — both reach the camera through `zoom.transform`, which
    // carries no source event, so watching gestures only would let a window
    // resize yank a reader who had explicitly clicked Reset (or another band)
    // straight back onto the linked initiative. `persist` is the same predicate in
    // both places for the same reason: it means "the reader asked for this".
    const userMovedCameraRef = useRef(false);

    // ── THE INITIATIVE NAME'S CYCLE POSITION (req #3297) ──────────────────────────
    // `{ key, level }` — WHERE the initiative name's two-state zoom last put the
    // camera, per initiative AND per plan (`initiativeZoomStateKey`). Declared up here, next
    // to the flag whose gesture also clears it, rather than beside
    // `activateInitiativeName` where it is read: the zoom handler below is the only
    // place that can see a real drag or wheel, and it is defined earlier in the
    // body, so a callback declared later could not appear in its dependency
    // array without a TDZ error. A ref needs none.
    //
    // See `activateInitiativeName` for the cycle itself, and the handler below for
    // why a reader's own gesture ends it.
    const initiativeZoomRef = useRef(null);
    // The camera at the start of the gesture in progress — the baseline
    // `gestureMovedCamera` measures against, so the jitter inside a click on
    // the chip is not mistaken for a pan. Written only for a gesture that
    // carries a `sourceEvent`; see the zoom behaviour's 'start' handler.
    const gestureStartRef = useRef(null);

    // THE LAST MEASUREMENT TAKEN, beside the state it is written into (req
    // #3312). The landing effect has to know whether `size` has caught up with
    // the panel yet — the DOM is resized twice at mount and the second sizing
    // decides the opening view — and this is the only formulation of that
    // question with NO geometric assumptions in it. The obvious alternatives
    // both encode one silently: comparing against `availH` assumes the box
    // model (this Box has a 1px border, so `clientHeight` is never the height
    // it was asked for, and `minHeight: 480` can override it outright), and
    // comparing against a fresh `clientHeight` read assumes zero padding and no
    // scrollbar. Either would be CORRECT TODAY and would turn a later `p: 1` on
    // the panel into a permanent, silent refusal to land. Written on both
    // writers below so the pair cannot drift; the guard then reads exactly what
    // was measured, whatever box that was measured in.
    const observedSizeRef = useRef({ w: 0, h: 0 });
    useLayoutEffect(() => {
        if (!containerEl) return undefined;
        const ro = new ResizeObserver((entries) => {
            const cr = entries[0]?.contentRect;
            if (cr) {
                const next = { w: Math.round(cr.width), h: Math.round(cr.height) };
                observedSizeRef.current = next;
                setSize(next);
            }
        });
        ro.observe(containerEl);
        const first = { w: containerEl.clientWidth, h: containerEl.clientHeight };
        observedSizeRef.current = first;
        setSize(first);
        return () => ro.disconnect();
    }, [containerEl]);
    // "Has `size` caught up with the panel?" — ONE definition, read by the three
    // effects that move the camera (req #3312). Each of them computes a fit from
    // `size`, and the panel is sized twice at mount with two different heights,
    // so each would otherwise aim at a panel the reader never sees for one
    // delivery. A FUNCTION called inside effects, deliberately not a value
    // derived in the render body: a ref read during render is not guaranteed to
    // see the write that a concurrent render is about to make, while an effect
    // runs after the commit that wrote it.
    //
    // ONE-DIRECTIONAL FRESHNESS is what makes it safe, and it is worth stating
    // as the invariant rather than as "the two converge": each `setSize(x)`
    // above is immediately preceded by `observedSizeRef.current = x` with no
    // yield between, so the ref is always at least as fresh as the state and
    // `size` can never be AHEAD of it. The predicate can therefore be wrong
    // only in the safe direction — a spurious defer, resolved by the very
    // `size` change every caller already depends on — never in the direction
    // that lands on a panel the reader will not see.
    //
    // IT IS VACUOUSLY TRUE BEFORE THE FIRST MEASUREMENT (both sides start at
    // `{0, 0}`), so it is a readiness guard and NOT an emptiness check, and
    // each caller still needs its own: the landing effect tests `size.w === 0`
    // directly, and the two focus effects lean on `applyFocus` returning false
    // while `zoomRef.current` is null — which it is for exactly as long as
    // `size.w` is 0 — so they record nothing and retry.
    const sizeSettled = useCallback(() => {
        const o = observedSizeRef.current;
        return o.w === size.w && o.h === size.h;
    }, [size.w, size.h]);

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
    // tempting justification — that the floating initiative chips already dirty layout
    // every frame, so this reads a value the browser was about to compute anyway.
    // It is true only WHILE A CHIP IS ON SCREEN (`floatingInitiatives` returns null on
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
        //
        // req #3658 — MAXIMIZED, the page is a fixed full-window layer, so its
        // top is the window's and the document's scroll is not in it, and the
        // canvas runs to the window's bottom edge with no 14px gutter — and with
        // no 480px floor either: the overlay clips, so on a short window (a
        // phone in landscape) a floor would push the restore switch and the
        // key off the bottom of the screen.
        const top = containerEl.getBoundingClientRect().top
            + (maximized ? 0 : (window.scrollY || 0));
        const next = maximized
            ? Math.max(0, Math.round(window.innerHeight - top))
            : Math.max(480, Math.round(window.innerHeight - top - 14));
        setAvailH((prev) => (prev === next ? prev : next));
    }, [containerEl, maximized]);
    useLayoutEffect(measureAvailH);                     // after every render
    useEffect(() => {
        window.addEventListener('resize', measureAvailH);
        return () => window.removeEventListener('resize', measureAvailH);
    }, [measureAvailH]);

    // Fit-to-width base scale — the POC page rendered the whole plan across the
    // panel; kFit is that view.
    const kFit = size.w > 0 ? size.w / layout.width : 0.7;

    // ── The READABLE scale (req #3168) — WAS the default view, req #3312 ────
    // Introduced as the opening view: fit-to-width is the right OVERVIEW and
    // was the wrong DEFAULT, because it is a scale divided by plan size, so the
    // bigger the plan the smaller the type — the live 64-step plan opened at a
    // k where the requirement ids were a few pixels tall.
    //
    // **REQ #3312 TOOK THE OPENING VIEW BACK OFF IT** and gave it to
    // `kFactoryDefault` (below), on the user's own instruction: the page must
    // open in the same viewport the header's Reset produces. So it does now
    // arrive at a scale where a large plan's labels are not drawn — the exact
    // condition #3168 describes above as the defect — and that is the ask, not
    // a regression of it. Read the paragraph above as history.
    //
    // WHAT THIS NUMBER STILL IS, and it is not vestigial: the ANCHOR of the
    // semantic level ladder and of the zoom behavior's `scaleExtent`, and the
    // base scale both focus clamps measure against. Every ratio on this surface
    // is still measured from it.
    //
    // K_READABLE is derived from the smallest required text (the req ids) and an
    // 11px floor; see pipelinePlanLayout. Hoisted there by req #3280 — see
    // `readableDefaultScale` for why the formula could not stay inline: a test
    // can only reach the number the renderer actually uses.
    const kDefault = readableDefaultScale(kFit);
    // The zoom behavior's own configured floor, computed ONCE here so this
    // and the `.scaleExtent` call below read the SAME number rather than two
    // copies of a formula that only agree today because `kDefault` happens to
    // collapse `Math.min(kFit, kDefault)` to `kFit` (req #3216 review
    // finding — a future `kDefault` that could fall below `kFit` would
    // silently desync a duplicated expression; a shared variable cannot).
    const kZoomFloor = Math.min(kFit, kDefault) * ZOOM_MIN_RATIO;
    // ── THE SCALE THE PLAN OPENS AT (req #3312) ─────────────────────────────
    // The whole plan's vertical extent, floored at the zoom behavior's own
    // configured minimum — `factoryDefaultScale`'s own comment has the fit
    // maths and why the floor is handed IN rather than re-derived. It is the
    // number `resetView` applies, and since #3312 that is the ONLY recenter
    // target: the landing view and the header's Reset are one expression, not
    // two numbers a test has to prove agree. See `resetView` below.
    //
    // COMPUTED HERE, above `curK`, rather than beside `resetView` where it
    // used to sit: the two fallbacks below are "the view the page opens in"
    // for the frames before the zoom behavior has emitted anything, and they
    // can only be that if the number exists by then.
    // req #3648 — the base view is a whole camera, not just a scale: below
    // k = 1 it is pulled down so the pinned ruler clears the top band's header.
    const factoryView = factoryDefaultView(layout, size, kFit, kZoomFloor);
    const kFactoryDefault = factoryView.k;
    const yFactoryDefault = factoryView.y;
    // The camera's live scale, or — before the first transform — the one the
    // landing effect is about to apply. Reading `kDefault` here made the very
    // first frame report `mid` on a plan that opens at Overview, a level the
    // reader never saw (req #3312).
    const curK = transform ? transform.k : kFactoryDefault;
    // THE LEVEL LADDER RE-ANCHORS ON THE DEFAULT, not on the fit (req #3168).
    // semanticLevel() takes a RATIO, and the ratio means "how far in from where
    // you started". Leaving the denominator at kFit while the default moved would
    // open a large plan at 'Detail' and a small one at 'Plan' — the same gesture
    // reporting a different level for no reason the reader can see. Anchoring on
    // kDefault keeps ratio 1 = 'Plan' at every plan size, which is the contract
    // PIPE-09 asserts.
    //
    // RATIO 1 IS NO LONGER THE VIEW A PLAN LANDS IN, and the anchor deliberately
    // does NOT follow it (req #3312). The landing moved to `kFactoryDefault`, so
    // a plan too tall to fit at the readable scale now opens BELOW ratio 1 and
    // reports 'Overview' — which is an honest description of what is on screen
    // there, bare beads and no labels, exactly what the header's Reset has
    // produced on those plans since req #3216. Re-anchoring the ladder on the
    // new landing scale instead would change what is DRAWN at every k and undo
    // req #3280's legibility gate, for a requirement that asked about the
    // CAMERA. The denominator stays where #3168 put it.
    // ── FOUR MODES, ONE LEVEL (req #3324) ───────────────────────────────────
    // `planLevelFor` is the whole rule and it lives in `pipelinePlanLayout` where
    // a test can reach it: a PIN returns itself at every scale and every panel
    // width, and AUTO reads the ladder and demotes an illegible answer to 'out'.
    // What is bound here is only this frame's inputs.
    //
    // THERE IS ONE LEVEL NOW. This used to compute the ladder's answer and the
    // level actually drawn separately — publishing one as `data-level` and
    // reporting the other to the toolbar — which is how the selector came to sit
    // on L1 while the reader had pinned L2 ("L1, L2 and L3 are still broken").
    // The chip, the attribute, `data-drawn` and the pixels now all name the same
    // level, and `legible` as a separate frame-level fact is gone with it.
    //
    // PINNING STILL NEVER MOVES THE CAMERA, and since #3324 that has no
    // exception: req #3310's `levelPinTransform` and the effect that applied it
    // are deleted, so a pinned reader pans and zooms freely and PIPE-09's wheel
    // ladder is untouched while the selector sits on Auto.
    const pinnedLevel = pinnedLevelOf(levelPref);
    const level = planLevelFor(pinnedLevel,
        kDefault > 0 ? curK / kDefault : 1, curK);

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
        //
        // THE ARITHMETIC MOVED to `clampPlanTransform` in pipelinePlanLayout.js
        // (req #3252) and this reads it. It was a closure here while the zoom
        // behavior was the only thing that could produce a transform; a viewport
        // RESTORED from storage is a second producer, it arrives through
        // `zoom.transform` (which constrains nothing — see the `scaleExtent`
        // comment below), and two copies of a bound that "only have to agree" is
        // the desync class this file has already taken two review findings on.
        // Passing `t.k` for both scale bounds clamps the translation only, which
        // is all `constrain` wants: d3 has applied `scaleExtent` before calling it.
        const bound = (t) => {
            const c = clampPlanTransform(t, size, layout, t.k, t.k);
            return (c.x === t.x && c.y === t.y) ? t : t.translate((c.x - t.x) / t.k,
                (c.y - t.y) / t.k);
        };
        const zb = d3zoom()
            // The SAME pair the initiative-focus clamp reads (req #3204). They have to
            // agree — `zoom.transform` applies a programmatic transform verbatim
            // and does not constrain it, so an out-of-extent k would sit there
            // looking fine until the user's first wheel event snapped it back.
            //
            // Anchored on `kDefault`, not the fit scale (req #3168): every ratio
            // on this surface — the level ladder, this extent, and the focus
            // clamp — is measured from the same `max(fit, K_READABLE)`, so they
            // cannot disagree about what "twice as far in" means.
            //
            // IT IS NO LONGER "THE VIEW THE READER LANDS IN", and this comment
            // said so until req #3312 moved the landing onto `kFactoryDefault`
            // (see `resetView` below). The anchor deliberately did not follow:
            // moving it would rescale the level ladder and this extent for a
            // requirement about the CAMERA. The lower bound keeps the fit scale
            // in reach, which now matters in the other direction — a plan opens
            // AT or below fit-to-width, so the room this bound protects is the
            // room to zoom out from an already-wide view rather than into one.
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
            // req #3498 — WITH SNAP ON, THE WHEEL IS NOT d3's. Rejecting it here
            // is what lets the ladder handler below own the gesture; leaving
            // d3 to scale continuously and then correcting it afterwards would
            // fight its own inertia and emit a smooth zoom before every snap.
            // Through a ref, so the toggle does not rebuild this behaviour.
            //
            // req #3581 — A PRESS ON A REQUIREMENT MARK IS NOT A PAN. It is the
            // requirement's own gesture (click to open it, drag to re-seat it),
            // and no handle exists to tell the two apart: the mark itself is
            // the handle. Refused HERE for the same reason the key is — d3's
            // listener fires first, so nothing downstream could take it back.
            .filter((ev) => (ev.type === 'wheel' ? !snapZoomRef.current
                : (!ev.button && !ev.target?.closest?.(CHROME_SELECTOR)
                    && !(ev.type === 'mousedown' && reqHitRef.current?.(ev))
                    // req #3586 — a press on an add-step "+" is a click, never a pan.
                    && !(ev.type === 'mousedown' && insertHitRef.current?.(ev)))))
            // ONE number for "how far may a click move" (req #3297). d3 uses it
            // to decide whether to suppress the click; the initiative name's cycle
            // uses it to decide whether that same gesture was the reader taking
            // the camera. Two copies would drift into disagreeing about what a
            // click is, on the same gesture, in the same file. The constant's
            // own comment states the two ways "one number" is not "one
            // measurement" — read it before changing either side.
            .clickDistance(INITIATIVE_ZOOM_CLICK_SLOP)
            .on('zoom', (ev) => {
                const tr = ev.transform;
                setTransform({ x: tr.x, y: tr.y, k: tr.k });
                // req #3252 — one ref assignment per pointermove, no render and
                // no write. The write happens once, on 'end' below.
                liveTransformRef.current = { x: tr.x, y: tr.y, k: tr.k };
                reqRetargetRef.current?.();          // req #3581, see the ref
                viewport.record(liveTransformRef.current);
                // `sourceEvent` is non-null only for a USER gesture — a drag or
                // a wheel — and null for every programmatic transform. Once the
                // reader has moved the camera themselves, the `?initiative=` deep link
                // has been answered and must never move it again (req #3252
                // review). See that effect for what this stops.
                if (ev.sourceEvent) userMovedCameraRef.current = true;
                // ── AND A REAL ONE ENDS THE INITIATIVE NAME'S CYCLE (req #3297) ───
                // Level 2 ("show me the next launch") is only the right answer
                // to the next click while the reader is still looking at the
                // band this control put them on. A drag or a wheel breaks that
                // premise, and the cycle ref cannot see either.
                //
                // Left unhooked: land on `?initiative=11` (which counts as click 1),
                // pan to the far side of the plan, click initiative 11's name meaning
                // "take me back" — and drop straight onto its next launch step
                // at 2.6× the readable default, having never seen the band.
                //
                // BUT NOT ON `sourceEvent` ALONE, which is where the flag above
                // and this part deliberately: the chip is a descendant of the
                // element this behaviour is bound to, so a mousedown on the
                // NAME starts a pan and every pixel of hand-jitter inside the
                // click emits a real zoom event. Clearing on those would break
                // the band → step move for anyone whose hand moves — i.e.
                // intermittently. `gestureMovedCamera` asks d3's own
                // click-vs-drag question with d3's own number.
                if (ev.sourceEvent
                    && gestureMovedCamera(gestureStartRef.current, tr)) {
                    initiativeZoomRef.current = null;
                }
            })
            .on('start', (ev) => {
                // WHERE THE CAMERA WAS WHEN THIS GESTURE BEGAN (req #3297) —
                // recorded before the wheel early-return below, because a wheel
                // is exactly the gesture whose scale change must end the initiative
                // name's cycle. Programmatic transforms carry no `sourceEvent`
                // and must not re-baseline it, or a focus transition landing
                // mid-drag would make the rest of that drag look stationary.
                if (ev.sourceEvent) {
                    gestureStartRef.current = {
                        x: ev.transform.x, y: ev.transform.y, k: ev.transform.k,
                    };
                }
                if (!ev.sourceEvent || ev.sourceEvent.type === 'wheel') return;
                draggingRef.current = true;
                const c = stageRef.current?.container();
                if (c) c.style.cursor = 'grabbing';
            })
            .on('end', () => {
                // req #3252 — BEFORE the cursor guard, deliberately. d3 emits
                // 'end' exactly once per gesture: a drag, a wheel's settle
                // timeout, a transition, or a programmatic `zoom.transform`. Only
                // the first of those sets `draggingRef`, so committing after the
                // guard below would persist drags and silently drop every wheel
                // zoom, every Reset and every band-header fit.
                viewport.commit();
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
            // rest of its 420ms, calling setTransform into an unmounted
            // tree and holding the node. Reachable whenever the page navigates
            // away mid-transition (a requirement click, the nav rail) — it was
            // first reached by a bead click opening the Table (gone, req #3641).
            sel.interrupt();
        };
    }, [containerEl, size.w, size.h, kFit, kDefault, kZoomFloor, layout.width, layout.height,
        viewport]);

    // ── THE BASE VIEW = FACTORY DEFAULT, LANDING AND RESET ALIKE ────────────
    // Req #3216 D1 redefined Reset as the factory default — the whole plan's
    // vertical extent, one click, from any pan or zoom — while the LANDING
    // stayed on req #3168's readable scale `kDefault`. On live pipeline 2 that
    // is 0.8 against a fit of ~0.4, so a plan opened zoomed in past
    // fit-to-width with the world origin at the panel's top-left: "the default
    // view is zoomed into the top initiative's name", which is the defect req #3312
    // was filed on. The two scales are now ONE — this recenters to
    // `kFactoryDefault` for every caller.
    //
    // THE OLD CHOICE IS DELETED, NOT DEFAULTED. It was a `recenterModeRef`
    // ('readable' | 'factory') written once, by the header's Reset click, so
    // that a Width toggle recentering right after a Reset preserved the view
    // the reader was in instead of snapping back to the readable scale. With
    // one base view there is nothing left for it to choose between, and
    // leaving it initialised to 'factory' would leave a live branch on a value
    // nothing can produce. Landing === Reset is then STRUCTURAL — one
    // expression, one function, both callers — rather than two numbers a test
    // has to prove agree, which is the property this requirement asked for.
    //
    // `kDefault` is untouched and still earns its keep: it anchors the zoom
    // behavior's `scaleExtent`, the semantic level ladder's ratio, and the
    // initiative/step focus clamps. Only the RECENTER TARGET moved.
    //
    // Applied on first size and whenever a layout toggle changes the world
    // dimensions wholesale (the POC re-rendered from scratch on those
    // toggles): a toggle that rescales the world leaves the previous pan
    // somewhere unrelated on the new geometry.
    const resetView = useCallback(() => {
        const el = containerEl;
        const zb = zoomRef.current;
        if (!el || !zb || size.w === 0) return;
        select(el).call(zb.transform,
            zoomIdentity.translate(0, yFactoryDefault).scale(kFactoryDefault));
    }, [containerEl, size.w, kFactoryDefault, yFactoryDefault]);
    // ── THE LANDING VIEW (req #3252) ────────────────────────────────────────
    // What this canvas shows when it arrives at a plan. Two answers, in order:
    // the camera the reader left on this plan at THIS Step Width (req #3637), or
    // — failing that, the first visit — the base view `resetView` computes,
    // which since req #3312 is the factory default the header's Reset lands on.
    //
    // THE RESTORE SUBSTITUTES FOR resetView, IT DOES NOT RACE IT. Same code
    // path, same `zb.transform`, one of them runs. The stored-camera read stays
    // OUT of `resetView`, which is what keeps the header's Reset honest: if it
    // lived inside, a Reset click would read back the pan it was asked to
    // discard and do nothing.
    //
    // ── WHEN IT LANDS: a new plan or a rescale, never a resize or growth ────
    // `landKey` is the plan plus the Step Width rung (req #3637 — it was the
    // world's width, which a refetch adding a column also moves). Three things
    // must NOT re-land, and each was a measured defect:
    //   · A RESIZE. The panel is sized TWICE at mount (the `calc(100vh - 260px)`
    //     fallback, then `measureAvailH`), so keying on size discarded a camera
    //     set milliseconds earlier.
    //   · A WORLD THAT GREW BUT WAS NOT RESCALED — a background refetch adding a
    //     step or a column. Re-landing snapped the reader home mid-read for a
    //     plan they could still perfectly well see (review finding; #3637).
    //   · THE PLAN ID ALONE. `landKey` carries `viewportKey`, so an in-place
    //     switch between two plans still lands — `PipelineDetail` renders this
    //     component with no `key` and survives a `pipelineId` change without
    //     remounting (review finding).
    //
    // The readiness guard does NOT consume the mark: with no container, no
    // behaviour or no measured width there is nothing to apply a transform to,
    // and marking that as "landed" would strand the canvas at the identity
    // transform forever. `focusInitiative`'s own retry contract, for the same reason.
    //
    // ── …AND SINCE req #3312 IT WAITS FOR THE PANEL'S REAL HEIGHT ───────────
    // The landing scale is now `kFactoryDefault`, which reads `size.h`. Before
    // #3312 it read `size.w` alone (through `kFit` → `kDefault`), and the panel
    // is sized TWICE at mount with the SAME WIDTH and two different HEIGHTS —
    // the `calc(100vh - 260px)` fallback in the JSX below, then `measureAvailH`
    // — so a mount-time double measure that used to be invisible here now
    // decides the view. `landKey` deliberately excludes the height (a resize
    // must not re-land, req #3252), so the first land was final and it was made
    // against a height the reader never sees: measured on this fixture at
    // 1440x900, the fallback gave k = 0.4720 into a panel only 586px tall, i.e.
    // ~54px of the plan below the fold on open AND a Reset click that then
    // moved the camera — the exact divergence #3312 exists to delete. The 260
    // is not merely approximate, it is KNOWN wrong: the comment on
    // `measureAvailH` above says this page's header is not fixed.
    //
    // A READINESS GUARD, not a second landing trigger — the distinction matters
    // and is why it asks "has `size` caught up with the last MEASUREMENT?"
    // rather than "is `availH` set?" (which is already true on the bad render)
    // or "does `size` match a fresh `clientHeight`?" (correct only while the
    // panel has no padding — see `observedSizeRef` above). It cannot deadlock:
    // `observedSizeRef` is written by the same two statements that call
    // `setSize`, so state converges on it by construction, and the observer's
    // next delivery re-runs this effect (`size` is on its dependency list).
    // Exact equality, no tolerance: both sides are the identical value, one
    // through a ref and one through state, never two measurements compared.
    // req #3637 — keyed on the plan and the Step Width rung, NOT the world's
    // width: a background refetch that adds a column moves `layout.width`, and
    // re-landing on it reset the camera mid-read. Growth is handled by the
    // re-clamp in (a) below; only a new plan or a rescale lands.
    const landKey = `${viewportKey}|${viewportFingerprint}`;
    const landedKeyRef = useRef(null);
    // The same fact as STATE, for the two focus effects (req #3651): they must
    // not move the camera before the landing has, and must re-run in the commit
    // after it does whatever else did or did not change in that commit.
    const [landedKey, setLandedKey] = useState(null);
    // Which PLAN last landed — tells "arrived at a plan" (restore) apart from
    // "this plan's Step Width changed" (the base view: the rescale is the
    // reader's explicit choice and the old camera means nothing on it).
    const landedPlanRef = useRef(null);
    // req #3688 — the layout the camera was last showing, and — once Hide
    // closed flips — the layout it was showing BEFORE the flip, held until the
    // housekeeping branch below consumes it. Held rather than read in the same
    // run because a run can bail on a readiness guard: the reader's place is
    // defined by what they saw before the toggle, however many commits later
    // the camera gets to act on it. The camera at the toggle rides along: if
    // the reader has moved it by the time the anchor is consumed, the old
    // layout no longer describes what they are looking at, and it is dropped.
    // `lastAnchorRef` is the anchor the previous toggle held and the camera it
    // left — handed back while the camera is still there, so hide → expand
    // holds the SAME card both ways and returns exactly.
    const shownLayoutRef = useRef(null);
    // req #3708 — a machine-filter toggle re-lays the plan out exactly as Hide
    // closed does, so it rides the same anchor under one combined key.
    const layoutFilterKey = `${hideClosed ? 1 : 0}|${[...hiddenMachines].sort().join(',')}`;
    const shownHideClosedRef = useRef(layoutFilterKey);
    const anchorFromRef = useRef(null);
    const lastAnchorRef = useRef(null);
    useEffect(() => {
        if (shownHideClosedRef.current !== layoutFilterKey) {
            shownHideClosedRef.current = layoutFilterKey;
            if (anchorFromRef.current == null) {
                anchorFromRef.current = { layout: shownLayoutRef.current,
                    t: liveTransformRef.current };
            }
        }
        shownLayoutRef.current = layout;
        const el = containerEl;
        const zb = zoomRef.current;
        if (!el || zb == null || size.w === 0) return;
        if (!sizeSettled()) return;
        // ── …AND THE PANEL MUST BE AT ITS MEASURED HEIGHT (req #3365) ───────
        // `sizeSettled()` asks whether `size` STATE has caught up with the last
        // OBSERVATION, which is a different question from whether that
        // observation was of the panel the reader ends up looking at — and the
        // paragraph above already names the reason: the box is sized twice, and
        // the first size comes from the `calc(100vh - 260px)` fallback in the
        // JSX below. Both sides of `sizeSettled()` are written by the same two
        // statements, so it is satisfied by the FALLBACK delivery, the landing
        // runs there, and `landKey` (correctly) refuses to re-land on the
        // resize that follows.
        //
        // MEASURED on plan 7 before this guard: the plan landed at k = 0.1666
        // (= 738 / 4430, and 738px is that fallback minus the border) while the
        // header's Reset gave 0.2077 — so the page opened ~20% smaller than its
        // own Reset view, wasting a CONSTANT 184px of panel below the plan at
        // every viewport and up to 548px to the right at 1920x1080. That
        // constant is the signature: a ratio would vary with the window, a
        // fixed-height fallback does not. It also broke #3312's stated contract
        // in this same file — "the landing view and the header's Reset are one
        // expression, not two numbers a test has to prove agree".
        //
        // THE FIX IS A WAIT, NOT A RE-LAND. Re-landing on a size change would
        // undo req #3252/#3431's camera memory, which is exactly what `landKey`
        // excludes the height to protect. Both conditions are needed: `availH`
        // proves the measurement has HAPPENED, and the DOM comparison proves it
        // has been APPLIED and observed — without the second, a landing can
        // still slip through in the frame between the height being written and
        // the ResizeObserver delivering it.
        //
        // Compared against `clientHeight`, not against arithmetic on `availH`
        // and the border: that is the same property `setSize`'s own
        // initialisation reads, so the two cannot disagree about what the box
        // measures. 1px of tolerance for sub-pixel rounding — `contentRect` is
        // fractional and is rounded on the way into `size`.
        if (availH == null) return;
        if (Math.abs(size.h - el.clientHeight) > 1) return;
        const kMax = kDefault * ZOOM_MAX_RATIO;
        // CLAMPED BEFORE IT IS APPLIED, k first and then the translation — the
        // pan bound is computed FROM k, so clamping position first would
        // immediately re-invalidate it. `zoom.transform` runs neither
        // `constrain` nor `scaleExtent` (it applies what it is given verbatim).
        const apply = (t) => {
            const c = clampPlanTransform(t, size, layout, kZoomFloor, kMax);
            // THROUGH THE BEHAVIOUR, never `setTransform`. Writing state alone
            // leaves d3's own `__zoom` stale and the next wheel or drag snaps
            // back — the integration bug this file warns about twice.
            select(el).call(zb.transform,
                zoomIdentity.translate(c.x, c.y).scale(c.k));
        };

        const landed = landedKeyRef.current == null ? null
            : { landKey: landedKeyRef.current, planKey: landedPlanRef.current };
        const next = { landKey, planKey: viewportKey };
        // Read only when it can matter — a 'keep' must not touch storage.
        const saved = landed?.landKey === landKey ? null : viewport.read();
        const action = planLandingAction(landed, next, saved);
        if (action !== 'keep') {
            // A landing replaces the camera wholesale; there is no place to keep.
            anchorFromRef.current = null;
            landedKeyRef.current = landKey;
            landedPlanRef.current = viewportKey;
            setLandedKey(landKey);
            // ── A NEW WORLD ENDS THE INITIATIVE NAME'S CYCLE (req #3297, review) ──
            // Both branches below relocate the camera, and neither carries a
            // `sourceEvent`, so the zoom handler cannot see it — without this,
            // click an initiative name, click Width, click the same name and you land
            // on its next launch step at 2.6× the readable default, never having
            // seen the band. At the TOP of the block so it covers both answers.
            initiativeZoomRef.current = null;
            // ── THE LANDING RESTORES THE CAMERA THE READER LEFT (req #3637) ──
            // *"the pipelines viewport should be pretty damn sticky. refresh,
            // reload, should not change the viewport"* — and every other way
            // back: browser Back/Forward, the requirement page's Back to Plan,
            // (and, until req #3641 withdrew the Table, the Plan|Table toggle and
            // a bead click into the Table and back). They all arrive HERE, as a mount, so one read covers every one of them
            // without a list of return paths.
            //
            // This REVERSES req #3365's "the landing is the Reset view, always",
            // on the user's later instruction. What #3365 wanted is kept where it
            // still applies: a plan never opened before (no record) and a Step
            // Width change both land on the base view, and the header's Reset is
            // one click from any camera.
            if (action === 'restore') {
                apply(saved);
                return;
            }
            resetView();
            return;
        }

        // ── Already landed on this world. Housekeeping that must NOT move the
        // camera the reader chose.
        //
        // (a) THE EXTENT MOVES WITH THE PANEL AND THE WORLD. Both ends of the
        // scale extent are proportional to `size.w`, and the pan bound to the
        // layout, so a narrower window or a plan that shrank on a refetch can
        // leave a perfectly good camera out of range. Nothing else re-clamps it
        // — `constrain` only ever fixes translation and `scaleExtent` is
        // consulted only by a wheel — so it would sit there looking correct
        // until the reader's first scroll snapped it (review finding). Re-clamp
        // ONLY when it is actually out of range, so a resize or a refetch is
        // otherwise a no-op on the camera.
        const live = liveTransformRef.current;
        if (!live) return;
        // (b) HIDE CLOSED KEEPS THE READER'S PLACE (req #3688). The toggle
        // relayouts — cards shrink or grow and everything below them moves —
        // so holding the WORLD transform slides the cards the reader was on off
        // to somewhere else. Hold the card nearest the viewport centre at its
        // screen position instead. A null answer (nothing on screen) falls
        // through to (a)'s plain re-clamp.
        const anchorFrom = anchorFromRef.current;
        anchorFromRef.current = null;
        const sameCamera = (a, b) => !!a && !!b && a.x === b.x && a.y === b.y && a.k === b.k;
        if (anchorFrom && sameCamera(anchorFrom.t, live)) {
            const last = lastAnchorRef.current;
            const anchored = relayoutAnchorTransform(anchorFrom.layout, layout, live, size,
                sameCamera(last?.t, live) ? last.key : null);
            if (anchored) {
                apply(anchored);
                lastAnchorRef.current = liveTransformRef.current
                    ? { key: anchored.anchor, t: liveTransformRef.current } : null;
                return;
            }
        }
        const c = clampPlanTransform(live, size, layout, kZoomFloor, kMax);
        if (c.k !== live.k || c.x !== live.x || c.y !== live.y) apply(live);
    }, [resetView, containerEl, size, layout, kZoomFloor, kDefault, sizeSettled,
        landKey, viewportKey, viewport, layoutFilterKey]);

    // Reset targets the same view the plan lands on (req #3312), so all this
    // adds over `resetView` is the INTENT: an explicit, in-the-moment
    // instruction about where to look, which ends any `?initiative=` re-fit exactly
    // as a drag does (req #3252 review). Still a separate callback for that
    // reason — the landing must NOT set the flag, or a `?initiative=` deep link
    // would be answered by the very effect that is supposed to precede it.
    const factoryReset = useCallback(() => {
        userMovedCameraRef.current = true;
        // …and ends the initiative name's cycle for the same reason (req #3297): the
        // reader is no longer looking at the band this control put them on, so
        // the next click on that name owes them the band, not its next launch.
        // Reset reaches the camera through `zoom.transform`, which carries no
        // `sourceEvent`, so the zoom handler above cannot see it — this is the
        // same explicit-instruction case the line above exists for.
        initiativeZoomRef.current = null;
        resetView();
    }, [resetView]);
    // `resetViewNonce` only ever increments (the header's click handler), so
    // the effect fires once per click. Read through a ref rather than joining
    // the dependency list: `factoryReset`'s identity changes on every resize
    // and every layout toggle, and depending on it directly would fire this on
    // those too — which is the mount/toggle effect above's job, not a factory
    // reset the user never asked for. 0 is the initial render — skip it, the
    // landing effect above has already put the canvas at that same view, and
    // firing here would additionally set `userMovedCameraRef` and cancel a
    // `?initiative=` deep link nobody dismissed.
    const factoryResetRef = useRef(factoryReset);
    factoryResetRef.current = factoryReset;
    useEffect(() => {
        if (!resetViewNonce) return;
        factoryResetRef.current();
    }, [resetViewNonce]);

    // ── FIT N STEPS ACROSS, ON THE ACTIVE STEPS (req #3498, #3648) ──────────
    // The scale and the transform are both `pipelinePlanLayout`'s (see
    // `stepsAcrossScale` / `stepsAcrossTransform`) — this effect only drives
    // d3-zoom with the answer, so the arithmetic stays testable without a canvas
    // and the "2 is the loose one" rule lives beside the option list rather than
    // in a component.
    //
    // Through `zb.transform`, not by setting state: d3-zoom owns the gesture and
    // a transform written behind its back is reverted by the next wheel event.
    // `zb.transform` does NOT apply `scaleExtent` (only `scale()` does), so the
    // clamp is `stepsAcrossTransform`'s, through `centreTransform`; the
    // viewport-centre fallback is only reached on a plan with nothing placed.
    //
    // Keyed on the NONCE alone, read through a ref: `size` and the layout change
    // on every resize and every toggle, and depending on them would re-fire a
    // zoom the reader never asked for a second time.
    const stepsAcrossRef = useRef(null);
    stepsAcrossRef.current = () => {
        const el = containerEl;
        const zb = zoomRef.current;
        if (!el || !zb || !(size.w > 0)) return;
        // `layout.colPitch` — req #3503 review: the fixed scale-1 pitch
        // under-counted every rung above Step Width 1 (measured "5 across"
        // landing at 3.27 columns at rung 4). NOT `layout.colW`, the
        // per-column array this scalar was built from.
        const nextK = stepsAcrossScale(stepsAcross?.n, size.w, layout.colPitch);
        if (!nextK) return;
        // req #3648 — centred on the ACTIVE steps (`activeStepIds`), not on
        // wherever the viewport happens to be; the viewport centre is only the
        // fallback for a plan with nothing placed.
        const next = stepsAcrossTransform(layout, rows, stepsAcross?.n, size,
            kDefault, kZoomFloor) || zoomAboutViewportCentre(t, size, nextK);
        if (!next) return;
        // The reader moved the camera deliberately, so a pending `?initiative=` re-fit
        // must not fight them for it — the same stand-down `factoryReset` does.
        initiativeZoomRef.current = null;
        userMovedCameraRef.current = true;
        select(el).call(zb.transform,
            zoomIdentity.translate(next.x, next.y).scale(next.k));
    };
    useEffect(() => {
        if (!stepsAcross?.nonce) return;
        stepsAcrossRef.current();
    }, [stepsAcross?.nonce]);

    // ── THE SNAPPING WHEEL (req #3498) ──────────────────────────────────────
    // One notch = one rung of the steps-across ladder, so the wheel and the
    // buttons land on the SAME scales rather than two sets that look alike.
    //
    // ANCHORED ON THE POINTER, not the viewport centre: that is what a wheel
    // has always done on this canvas, and snapping is a change to the SIZE of
    // the step, not to what the gesture means. The buttons anchor at the centre
    // because a button has no pointer to speak of.
    //
    // `passive: false` and an explicit `preventDefault`, because the whole point
    // is to stop the page scrolling under a gesture d3 is no longer taking.
    const snapZoomRef = useRef(snapZoom);
    snapZoomRef.current = snapZoom;
    const snapWheelRef = useRef(null);
    snapWheelRef.current = (ev) => {
        const el = containerEl;
        const zb = zoomRef.current;
        if (!el || !zb || !(size.w > 0)) return;
        // d3's own sign convention: deltaY > 0 is a zoom OUT.
        const dir = ev.deltaY > 0 ? 1 : -1;
        const nextK = snapZoomScale(t.k, size.w, dir, layout.colPitch);
        if (!nextK) return;                     // already at the ladder's floor
        const rect = el.getBoundingClientRect();
        const next = zoomAboutPoint(t,
            { x: ev.clientX - rect.left, y: ev.clientY - rect.top }, nextK);
        if (!next) return;
        initiativeZoomRef.current = null;
        userMovedCameraRef.current = true;
        select(el).call(zb.transform,
            zoomIdentity.translate(next.x, next.y).scale(next.k));
    };
    useEffect(() => {
        const el = containerEl;
        if (!el) return undefined;
        const onWheel = (ev) => {
            if (!snapZoomRef.current) return;   // d3 has it; do nothing
            ev.preventDefault();
            snapWheelRef.current(ev);
        };
        el.addEventListener('wheel', onWheel, { passive: false });
        return () => el.removeEventListener('wheel', onWheel);
    }, [containerEl]);

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
            // req #3581 — the click that ends a requirement DRAG is not a click
            // on the requirement, even when the drop lands back within the slop
            // of where it was picked up (a drag that wandered and came home).
            if (reqClickGuardRef.current) return;
            const d = downRef.current;
            // `REQ_DRAG_SLOP` — the requirement drag starts at exactly the
            // distance this stops calling a gesture a click (req #3581).
            if (d && Math.hypot(e.clientX - d.x, e.clientY - d.y) > REQ_DRAG_SLOP) return;
            // Only a click that landed on the CANVAS ITSELF is a world click
            // (req #3204). This listener is native and sits on the container,
            // so it also sees clicks bubbling up from the HTML overlays —
            // and it would then fire an `activate` on whatever Konva node
            // happens to lie beneath the overlay. That was harmless only while
            // the initiative chip navigated away from this page; now that the chip
            // focuses and stays, a chip parked over a bead would ALSO activate
            // the bead (it switched the page to Table mode until req #3641; it
            // frames the step now). React's stopPropagation cannot fix it:
            // React 18 delegates to its root, which is an ANCESTOR of this
            // node, so this listener runs first regardless.
            if (!(e.target instanceof HTMLCanvasElement)) return;
            // A click that lands mid-focus-transition would hit-test a world
            // that is still moving (req #3204). The chip the user just clicked
            // slides across the panel during the transition — measured, one
            // band's chip travelled from (8, 523) to (247, 47) — so an impatient
            // second click (a different initiative, or the same one again) lands on
            // BARE CANVAS at an interpolated transform. That resolves against
            // whatever bead or requirement id happens to be under the cursor at
            // that instant and frames a step or navigates away. The
            // window is new: the chip used to leave the page immediately.
            if (focusingRef.current) return;
            // req #3586 — an add-step "+" is resolved by geometry, not by the
            // stage: the marks are drawn as one non-listening shape.
            const mark = insertHitRef.current?.(e);
            if (mark) {
                if (mark.kind === 'initiative') openInitiativeAddRef.current?.(mark.afterInitiativeId);
                else openInsertRef.current?.(mark.kind, { fromId: mark.fromId, toId: mark.toId });
                return;
            }
            const stage = stageRef.current;
            if (!stage) return;
            const rect = el.getBoundingClientRect();
            const node = stage.getIntersection({
                x: e.clientX - rect.left, y: e.clientY - rect.top,
            });
            if (node) node.fire('activate', { evt: e }, false);
        };
        // ── STEP-TITLE PRESSES (req #3580) ─────────────────────────────────
        // A step title is a Konva shape, so its quick-click / double-click /
        // long-press gestures are resolved here, against the stage, the same
        // way the click above is. The shape names itself with a `pressStepId`
        // attr. POINTER events, which d3-zoom never stops (it owns mousedown).
        //
        // `canvasKey` is set only by a press that began ON A STEP TITLE: these
        // listeners also see pointer events bubbling up from the HTML chips,
        // whose presses the chips' own React handlers drive, and acting on
        // those here (this native listener runs first) would cancel them.
        let canvasKey = null;
        const stepAt = (e) => {
            const stage = stageRef.current;
            if (!stage || !(e.target instanceof HTMLCanvasElement)) return null;
            const rect = el.getBoundingClientRect();
            const node = stage.getIntersection({
                x: e.clientX - rect.left, y: e.clientY - rect.top,
            });
            return node?.getAttr('pressStepId') ?? null;
        };
        const onPDown = (e) => {
            // A second finger (a pinch) ends any press the first one began —
            // its moves would otherwise never reach the tracker, and the long
            // press would fire mid-pinch.
            if (canvasKey || !e.isPrimary) {
                canvasKey = null;
                pressRef.current.cancel();
                return;
            }
            if (e.button !== 0 || focusingRef.current) return;
            // Off the canvas is a chip — its own handlers drive the tracker.
            if (!(e.target instanceof HTMLCanvasElement)) return;
            const stepId = stepAt(e);
            if (stepId == null) {
                // Bare canvas: a click still waiting to see if it is a double
                // is owed now, before this press can become a pan.
                pressRef.current.flush();
                return;
            }
            canvasKey = `step-${stepId}`;
            pressRef.current.down(canvasKey, e.clientX, e.clientY,
                stepPressRef.current(stepId));
        };
        const onPMove = (e) => {
            if (canvasKey) pressRef.current.move(e.clientX, e.clientY);
        };
        const onPUp = (e) => {
            if (!canvasKey) return;
            const key = canvasKey;
            canvasKey = null;
            const stepId = stepAt(e);
            if (stepId != null && `step-${stepId}` === key) pressRef.current.up(key);
            else pressRef.current.cancel();
        };
        const onPCancel = () => {
            if (!canvasKey) return;
            canvasKey = null;
            pressRef.current.cancel();
        };
        el.addEventListener('mousedown', onDown);
        el.addEventListener('click', onClick);
        el.addEventListener('pointerdown', onPDown);
        el.addEventListener('pointermove', onPMove);
        el.addEventListener('pointerup', onPUp);
        el.addEventListener('pointercancel', onPCancel);
        el.addEventListener('pointerleave', onPCancel);
        // A touch long press on a title would also raise the browser's own
        // callout menu.
        const onMenu = (e) => { if (canvasKey) e.preventDefault(); };
        el.addEventListener('contextmenu', onMenu);
        return () => {
            el.removeEventListener('contextmenu', onMenu);
            el.removeEventListener('mousedown', onDown);
            el.removeEventListener('click', onClick);
            el.removeEventListener('pointerdown', onPDown);
            el.removeEventListener('pointermove', onPMove);
            el.removeEventListener('pointerup', onPUp);
            el.removeEventListener('pointercancel', onPCancel);
            el.removeEventListener('pointerleave', onPCancel);
        };
    }, [containerEl]);

    // ── DRAG A REQUIREMENT TO ANOTHER STEP (req #3581) ─────────────────────
    // "Clean sweet and beautiful drag and drop for requirements between the
    // steps shown on the screen" — no drag handle: the requirement mark itself
    // is what you pick up. While it is in the air the mark it left is greyed
    // out, a full-size copy of it (a snapshot of the very Konva node, at the
    // current zoom and in its current colour) rides the cursor, the card it
    // would land on is outlined, and NOTHING ELSE MOVES — the plan is laid out
    // again exactly once, on the drop (`applyReqMoves`).
    //
    // A press that never passes `REQ_DRAG_SLOP` is still a click and still opens
    // the requirement; the manual click hit-test above uses the same number.
    // Pressing near the panel edge mid-drag auto-pans (bounded by the same
    // clamp the zoom behaviour uses), so a step off-screen is still reachable;
    // the wheel keeps zooming throughout. Escape, or the window losing focus,
    // puts the requirement back.
    //
    // ── ON THE SHARED PRESS TIMELINE, BY TOUCH TOO (req #3665) ─────────────
    // POINTER events, so a finger drives it exactly as a mouse does, read
    // through `reqPressOutcome` (pipelineReqDrag.js has the table). On touch the
    // press is SHARED with d3-zoom until it lifts: d3 pans under a finger that
    // moves first, and the press is dropped; a finger held still lifts the
    // requirement (a haptic tick), and from then on d3 never sees it move — its
    // touchmove is stopped on the way down, at the window. Held still past
    // LONG_PRESS_MS and let go in place, it is the title edit (a mouse held
    // still opens it while held, and lifts only by moving). A lifted touch swallows
    // its touchend, so the release never turns into a click that opens the
    // requirement; a second finger puts the requirement back (the pinch is d3's).
    //
    // The listeners read everything that changes through `dragWorldRef`, so the
    // effect binds once per container and never tears a gesture down mid-drag
    // because a refetch re-rendered the page.
    // The server's own rows, as of the last commit — what a written move is
    // stamped with, so the settle effect below can tell a read that landed
    // AFTER the write from the one already on screen.
    const serverRowsRef = useRef(plan.rows);
    const commitReqMove = useCallback(async (move) => {
        // req #3817 — an unseat keeps the requirement's row as of the drop:
        // the box draws it from this until the junction read lists it, and the
        // plan's own read stops carrying it the moment its refetch lands.
        if (move.toStepId == null) {
            move.req = (model?.requirements || [])
                .find((r) => Number(r.id) === move.reqId) || null;
        }
        setPendingMoves((ms) => [...ms, move]);
        let failed = false;
        try {
            await moveStepRequirement(darwinUri, idToken, {
                requirementId: move.reqId,
                fromStepId: move.fromStepId,
                toStepId: move.toStepId,
            });
        } catch (error) {
            failed = true;
            // THE RESIDUAL THE JUNCTION'S KEY PERMITS (see `moveStepRequirement`):
            // the old seat was deleted and the new one refused. On this surface
            // that would make the requirement vanish from the plan with nothing
            // left to click, so it is put back where the DELETE just proved it
            // was — a known prior state, not a guessed rollback.
            let stranded = false;
            if (error?.seatStage === 'seat' && move.fromStepId != null) {
                try {
                    await moveStepRequirement(darwinUri, idToken, {
                        requirementId: move.reqId, toStepId: move.fromStepId,
                    });
                } catch {
                    stranded = true;
                }
            }
            showError(error, stranded
                ? `Requirement ${move.reqId} could not be moved and is now on no step `
                  + '— re-seat it from its requirement page'
                : (move.toStepId == null
                    ? `Unable to un-orchestrate requirement ${move.reqId}`
                    : `Unable to move requirement ${move.reqId}`));
        }
        if (failed) {
            // The server's rows ARE the revert, and they are already on screen
            // under the local move — so it goes now, not when a refetch lands.
            setPendingMoves((ms) => ms.filter((m) => m !== move));
        } else {
            // Written. It stays drawn until a read that LANDED AFTER the write
            // says so — see the settle effect below for why a promise cannot
            // be what clears it.
            move.writtenRows = serverRowsRef.current;
            setPendingMoves((ms) => [...ms]);
            // req #3817 — the box lists swarm-ready work only, so anything else
            // un-orchestrated leaves the plan without arriving there: say so.
            const status = move.req?.requirement_status;
            if (move.toStepId == null && status && status !== 'swarm_ready') {
                showMessage(`Requirement ${move.reqId} is no longer orchestrated. `
                    + `It is ${status}, and Orchestrables lists swarm-ready work only.`);
            }
        }
        if (pipeline?.id != null) {
            queryClient.invalidateQueries({ queryKey: pipelineComposeKeys.byId(pipeline.id) });
        }
        queryClient.invalidateQueries({
            queryKey: pipelineStepRequirementKeys.all(profile?.userName) });
        queryClient.invalidateQueries({ queryKey: ['orchestration_index'] });
    }, [darwinUri, idToken, profile?.userName, pipeline?.id, queryClient, showError,
        showMessage, model?.requirements]);

    // ── A WRITTEN MOVE IS DROPPED BY THE DATA, NEVER BY A PROMISE ───────────
    // `invalidateQueries` cancels a refetch already in flight, and a cancelled
    // (or paused, or failed) refetch still RESOLVES its caller's await — so
    // clearing on that await let a second quick drop snap the first one back to
    // its old step for a round trip (code review). Instead a written move stays
    // until the server's rows put it on its target, or until a read that landed
    // after the write, with nothing further in flight, says otherwise (somebody
    // else moved it meanwhile — the server wins). A refetch that fails leaves
    // it standing, which is right: the write succeeded.
    const composeFetching = useIsFetching({
        queryKey: pipelineComposeKeys.byId(pipeline?.id ?? null) });
    // req #3817 — an UNSEAT is also drawn in the Orchestrables box, whose rows
    // come from the junction read, not the plan's: it is held until that read
    // has landed too, so the row never blinks out of the box between the two.
    const junctionFetching = useIsFetching({
        queryKey: pipelineStepRequirementKeys.all(profile?.userName) });
    useEffect(() => {
        serverRowsRef.current = plan.rows;
        const server = plan.rows || [];
        const settled = pendingMoves.filter((m) => m.writtenRows !== undefined && (
            reqMoveReflected(server, m)
            || (server !== m.writtenRows && composeFetching === 0))
            && (m.toStepId != null || junctionFetching === 0));
        if (settled.length) setPendingMoves((ms) => ms.filter((m) => !settled.includes(m)));
    }, [plan.rows, pendingMoves, composeFetching, junctionFetching]);

    const dragWorldRef = useRef(null);
    useLayoutEffect(() => {
        dragWorldRef.current = {
            layout, rowById, size, pendingMoves, commit: commitReqMove,
            t: liveTransformRef.current || transform || { x: 0, y: yFactoryDefault, k: kFactoryDefault },
        };
    });

    useEffect(() => {
        const el = containerEl;
        if (!el) return undefined;
        // Screen padding around the snapshot inside the floating copy — the
        // grab offset accounts for it, so the lifted text starts exactly where
        // the mark it was copied from is drawn.
        const PAD_X = 6;
        const PAD_Y = 3;
        let raf = 0;
        let lastPoint = null;           // panel-relative, last pointer position
        let lastClient = null;          // the same position in WINDOW coordinates
        let guardTimer = 0;
        // A lifted or long-pressed TOUCH ends in a touchend the browser would
        // turn into a click — swallowed, once (see `onTouchEnd`).
        let swallowTouchEnd = false;

        const world = () => dragWorldRef.current;
        const panelPoint = (e) => {
            const r = el.getBoundingClientRect();
            return { x: e.clientX - r.left, y: e.clientY - r.top };
        };
        // The live camera first: an auto-pan step emits its zoom event
        // synchronously, so the ref is current before the next retarget reads
        // it, while the render-time copy in `dragWorldRef` lags one commit.
        const camera = () => liveTransformRef.current || world().t;
        const toWorld = (p) => {
            const t = camera();
            return { x: (p.x - t.x) / t.k, y: (p.y - t.y) / t.k };
        };
        const setCursor = (c) => {
            const sc = stageRef.current?.container();
            if (sc) sc.style.cursor = c;
        };
        // The requirement mark under a pointer event, or null — also the zoom
        // filter's test. Not one whose previous move is still being written:
        // its DELETE would name a seat the server does not have yet.
        const hit = (e) => {
            const stage = stageRef.current;
            if (!stage || focusingRef.current) return null;
            if (!(e.target instanceof HTMLCanvasElement)) return null;
            const node = stage.getIntersection(panelPoint(e));
            const reqId = node?.getAttr?.('dragReqId');
            if (reqId == null) return null;
            if (world().pendingMoves.some((m) => m.reqId === reqId)) return null;
            return node;
        };
        reqHitRef.current = hit;

        const retarget = () => {
            const d = reqDragRef.current;
            if (d?.phase !== 'drag' || !lastPoint) return;
            const w = world();
            // req #3817 — over the Orchestrables box, the box takes it: the
            // drop un-orchestrates the requirement, whatever step card lies
            // beneath the box. Hit-tested in WINDOW coordinates, so a box
            // parked on the navbar or racked there is a target too. A locked
            // step's requirement cannot leave it (the gateway answers 423).
            // The box must be what is SEEN there: racked in a navbar stack
            // that scrolls, its rect can lie under the nav buttons or past the
            // rack's visible edge, and other chrome can sit over it. The copy
            // in flight ignores the pointer, so it is never what is found.
            const box = unseatBoxRef.current;
            const seen = box?.isConnected && lastClient
                && pointInRect(lastClient.x, lastClient.y, box.getBoundingClientRect())
                && box.contains(document.elementFromPoint?.(lastClient.x, lastClient.y) ?? null);
            if (seen) {
                const ok = canUnseatFrom(w.rowById.get(d.fromStepId));
                if (d.target != null) {
                    d.target = null;
                    setDropStepId(null);
                }
                if (!!d.unseat !== ok) {
                    d.unseat = ok;
                    setDropOnBox(ok);
                }
                return;
            }
            if (d.unseat) {
                d.unseat = false;
                setDropOnBox(false);
            }
            // ONLY INSIDE THE PANEL (code review C1). The move listeners are on
            // `window`, so a pointer over the page header or past the panel
            // edge still maps to a world point — onto a card clipped out of
            // sight, which would take the drop with nobody having seen it lit.
            const inside = lastPoint.x >= 0 && lastPoint.y >= 0
                && lastPoint.x <= w.size.w && lastPoint.y <= w.size.h;
            const stepId = inside ? dropTargetAt(w.layout.nodes, toWorld(lastPoint)) : null;
            const ok = canDropOn(w.rowById.get(stepId), d.fromStepId);
            const next = ok ? stepId : null;
            if (d.target !== next) {
                d.target = next;
                setDropStepId(next);
            }
            // A card that refuses the requirement (a locked step) says so; its
            // own home card and open canvas just keep the grab.
            setCursor(stepId != null && stepId !== d.fromStepId && !ok
                ? 'no-drop' : 'grabbing');
        };
        const placePreview = () => {
            const d = reqDragRef.current;
            const box = dragPreviewRef.current;
            if (!d || !box || !lastClient) return;
            // WINDOW coordinates (req #3817): the copy is `position: fixed`, so
            // it stays visible carried out of the pane to a box on the navbar.
            box.style.transform =
                `translate(${lastClient.x - d.offX}px, ${lastClient.y - d.offY}px)`;
        };
        // Edge auto-pan, one step per frame while the pointer sits in the edge
        // band. Clamped BEFORE it is applied, with the zoom behaviour's own
        // bound, so a plan already at its edge costs no transform (and no
        // re-render) per frame.
        const tick = () => {
            raf = 0;
            const d = reqDragRef.current;
            const zb = zoomRef.current;
            if (d?.phase !== 'drag' || !lastPoint || !zb) return;
            const w = world();
            const { vx, vy } = edgePanVelocity(lastPoint, w.size);
            if (!vx && !vy) return;
            const t = camera();
            const c = clampPlanTransform(
                { x: t.x - vx, y: t.y - vy, k: t.k }, w.size, w.layout, t.k, t.k);
            if (c.x !== t.x || c.y !== t.y) {
                // The reader moving the camera, by reaching for the edge — so
                // it counts as theirs exactly as a pan does (see the zoom
                // handler for both flags).
                userMovedCameraRef.current = true;
                initiativeZoomRef.current = null;
                // Retargets through the zoom handler (`reqRetargetRef`).
                select(el).call(zb.transform, zoomIdentity.translate(c.x, c.y).scale(t.k));
            }
            raf = requestAnimationFrame(tick);
        };

        const start = (d) => {
            if (!d.node.getStage()) return false;       // redrawn away mid-press
            let src;
            try {
                // req #3587 — a row with pills is a Group; snapshot the whole row.
                d.snap = d.node.getAttr('dragRowGroup') ? (d.node.getParent() || d.node) : d.node;
                src = d.snap.toDataURL({ pixelRatio: window.devicePixelRatio || 1 });
            } catch {
                return false;
            }
            const r = (d.snap || d.node).getClientRect();
            // The grab point on the mark. Under a finger d3 panned the canvas
            // with the resting jitter of the hold, so the mark is where the
            // finger is now; a mouse moved off a still mark.
            const p0 = d.pointerType === 'touch' && lastPoint
                ? lastPoint : panelPoint({ clientX: d.down.x, clientY: d.down.y });
            d.offX = p0.x - r.x + PAD_X;
            d.offY = p0.y - r.y + PAD_Y;
            d.phase = 'drag';
            d.target = null;
            setReqDrag({
                reqId: d.reqId, fromStepId: d.fromStepId, src,
                w: r.width, h: r.height, padX: PAD_X, padY: PAD_Y,
                x: lastClient.x - d.offX, y: lastClient.y - d.offY,
            });
            setCursor('grabbing');
            if (d.pointerType === 'touch') {
                swallowTouchEnd = true;
                navigator.vibrate?.(LIFT_VIBRATE_MS);
            }
            return true;
        };
        const finish = () => {
            reqDragRef.current = null;
            if (raf) cancelAnimationFrame(raf);
            raf = 0;
            lastPoint = null;
            lastClient = null;
            setReqDrag(null);
            setDropStepId(null);
            setDropOnBox(false);
            setCursor('grab');
        };
        // The click that ends a drag is the drag's, not the requirement's —
        // held for exactly the task that delivers it.
        const guardClick = () => {
            reqClickGuardRef.current = true;
            clearTimeout(guardTimer);
            guardTimer = setTimeout(() => { reqClickGuardRef.current = false; }, 0);
        };
        const clearTimers = (d) => {
            clearTimeout(d.liftTimer);
            clearTimeout(d.longTimer);
        };
        // Picked up where the pointer is now — by a move or by the hold.
        const lift = (d) => {
            clearTimeout(d.liftTimer);
            if (!start(d)) {
                clearTimers(d);
                reqDragRef.current = null;
                return false;
            }
            placePreview();
            retarget();
            if (!raf) raf = requestAnimationFrame(tick);
            return true;
        };
        // Put back, and the rest of the press (until its pointer comes up) is
        // nobody's — neither a drop nor a click.
        const cancel = (d) => {
            clearTimers(d);
            const lifted = d.phase === 'drag';
            if (lifted) finish();
            d.phase = 'cancelled';
            reqDragRef.current = d;
        };

        const onDown = (e) => {
            const held = reqDragRef.current;
            if (held) {
                // A second pointer — a pinch's second finger — puts back what
                // the first began, and lets go of the press entirely: the pinch
                // is d3's, so its touchmoves must reach it. The first finger's
                // release is still no tap (`swallowTouchEnd`, set at the lift).
                if (e.pointerId !== held.pointerId) {
                    clearTimers(held);
                    if (held.phase === 'drag') finish(); else reqDragRef.current = null;
                    if (held.phase !== 'press') guardClick();
                }
                return;
            }
            if (!e.isPrimary || e.button !== 0 || e.target?.closest?.(CHROME_SELECTOR)) return;
            const node = hit(e);
            if (!node) return;
            const d = {
                phase: 'press', node,
                pointerId: e.pointerId, pointerType: e.pointerType,
                reqId: node.getAttr('dragReqId'),
                fromStepId: node.getAttr('dragStepId'),
                down: { x: e.clientX, y: e.clientY },
                travel: 0,
            };
            lastPoint = panelPoint(e);
            lastClient = { x: e.clientX, y: e.clientY };
            // HELD STILL, A FINGER LIFTS IT (a mouse lifts by moving).
            d.liftTimer = setTimeout(() => {
                if (reqDragRef.current !== d || d.phase !== 'press') return;
                if (reqPressOutcome(d.pointerType, d.travel, true) === 'lift') lift(d);
            }, LIFT_DELAY_MS);
            // req #3661 — A LONG PRESS IS THE TITLE EDIT (pipelineReqDrag.js
            // has why the two pointers differ). A MOUSE held within the slop
            // to `LONG_PRESS_MS` opens the in-place editor WHILE STILL HELD, the
            // caret blinking under the pointer, and the press becomes CANCELLED
            // so the release is neither a drop nor the click that opens the
            // requirement page. A FINGER has lifted the requirement by then, so
            // its edit waits for the release in place (`onUp`); moving past the
            // slop at any point makes it a drag for good.
            d.longTimer = setTimeout(() => {
                if (reqDragRef.current !== d) return;
                if (d.pointerType === 'touch') { d.heldLong = true; return; }
                if (d.phase !== 'press' || !stillHeld(d.travel)) return;
                if (reqLongPressRef.current?.(d.reqId, d.fromStepId, d.down)) cancel(d);
            }, LONG_PRESS_MS);
            reqDragRef.current = d;
        };
        const onMove = (e) => {
            const d = reqDragRef.current;
            if (!d || e.pointerId !== d.pointerId || d.phase === 'cancelled') return;
            // The button is up but no pointerup reached us (something swallowed
            // it): a release we never saw is not a drop — put it back.
            if (!(e.buttons & 1)) {        // eslint-disable-line no-bitwise
                clearTimers(d);
                if (d.phase === 'drag') finish(); else reqDragRef.current = null;
                return;
            }
            d.travel = Math.max(d.travel, Math.hypot(e.clientX - d.down.x, e.clientY - d.down.y));
            lastPoint = panelPoint(e);
            lastClient = { x: e.clientX, y: e.clientY };
            if (d.phase === 'press') {
                const outcome = reqPressOutcome(d.pointerType, d.travel, false);
                if (outcome === 'pan') {             // d3 has the finger
                    clearTimers(d);
                    reqDragRef.current = null;
                    return;
                }
                if (outcome !== 'lift') return;
                if (!lift(d)) return;
            }
            placePreview();
            retarget();
            if (!raf) raf = requestAnimationFrame(tick);
        };
        const onUp = (e) => {
            const d = reqDragRef.current;
            if (!d || e.pointerId !== d.pointerId) return;
            clearTimers(d);
            // Let go where it was picked up, after the long press: the edit,
            // and the requirement is put back. Neither a drop nor a click.
            const travel = Math.max(d.travel, Math.hypot(e.clientX - d.down.x, e.clientY - d.down.y));
            if (d.heldLong && stillHeld(travel) && d.phase !== 'cancelled'
                && reqLongPressRef.current?.(d.reqId, d.fromStepId,
                    { x: e.clientX, y: e.clientY })) {
                if (d.phase === 'drag') finish();
                reqDragRef.current = null;
                guardClick();
                if (d.pointerType === 'touch') swallowTouchEnd = true;
                return;
            }
            if (d.phase === 'press') { reqDragRef.current = null; return; }
            guardClick();
            if (d.phase === 'cancelled') { reqDragRef.current = null; return; }
            lastPoint = panelPoint(e);
            lastClient = { x: e.clientX, y: e.clientY };
            retarget();
            const toStepId = d.target;
            const unseat = !!d.unseat;
            finish();
            if (unseat) {
                // req #3817 — dropped on the Orchestrables box: off the plan.
                world().commit({ reqId: d.reqId, fromStepId: d.fromStepId, toStepId: null });
            } else if (toStepId != null) {
                world().commit({ reqId: d.reqId, fromStepId: d.fromStepId, toStepId });
            }
        };
        // The browser took the pointer away (a system gesture): no drop.
        const onPointerCancel = (e) => {
            const d = reqDragRef.current;
            if (!d || e.pointerId !== d.pointerId) return;
            if (d.pointerType === 'touch') swallowTouchEnd = false;   // no touchend is coming
            clearTimers(d);
            if (d.phase === 'drag') finish(); else reqDragRef.current = null;
        };
        // Escape puts it back. The press stays recorded as CANCELLED until the
        // button comes up, so the release is neither a drop nor a click.
        const onKey = (e) => {
            const d = reqDragRef.current;
            if (e.key !== 'Escape' || d?.phase !== 'drag') return;
            e.preventDefault();
            cancel(d);
        };
        const onBlur = () => {
            swallowTouchEnd = false;
            const d = reqDragRef.current;
            if (!d) return;
            clearTimers(d);
            if (d.phase === 'drag') finish(); else reqDragRef.current = null;
        };
        // A mouse press on a mark selects no text and starts no native drag.
        const onMouseDown = (e) => {
            if (reqDragRef.current?.pointerType === 'mouse') e.preventDefault();
        };
        // A lifted (or edited) finger is the requirement's: d3-zoom's touch pan,
        // bound to the panel, never sees it move. Stopped at the WINDOW, on the
        // way down, because d3 stops every listener after its own.
        const onTouchMove = (e) => {
            const d = reqDragRef.current;
            if (d?.pointerType !== 'touch' || d.phase === 'press') return;
            e.stopPropagation();
            if (e.cancelable) e.preventDefault();
        };
        // ...and its release is not a tap: no click, no compatibility mouse
        // events. d3 still sees the touchend, which ends its gesture.
        const onTouchEnd = (e) => {
            if (!swallowTouchEnd) return;
            if (e.cancelable) e.preventDefault();
            if (!e.touches?.length) swallowTouchEnd = false;
        };
        // A touch the system took away (an edge swipe, an app switch) ends in
        // touchcancel, never touchend — nothing is left to swallow, and a
        // flag left standing would eat the next tap anywhere on the page.
        const onTouchCancel = (e) => { if (!e.touches?.length) swallowTouchEnd = false; };
        // The long-press menu / callout a held finger would raise.
        const onMenu = (e) => { if (reqDragRef.current) e.preventDefault(); };
        reqRetargetRef.current = retarget;

        el.addEventListener('pointerdown', onDown);
        el.addEventListener('mousedown', onMouseDown);
        el.addEventListener('contextmenu', onMenu);
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
        window.addEventListener('pointercancel', onPointerCancel);
        window.addEventListener('touchmove', onTouchMove, { capture: true, passive: false });
        window.addEventListener('touchend', onTouchEnd, { capture: true, passive: false });
        window.addEventListener('touchcancel', onTouchCancel, { capture: true });
        window.addEventListener('keydown', onKey);
        window.addEventListener('blur', onBlur);
        return () => {
            el.removeEventListener('pointerdown', onDown);
            el.removeEventListener('mousedown', onMouseDown);
            el.removeEventListener('contextmenu', onMenu);
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
            window.removeEventListener('pointercancel', onPointerCancel);
            window.removeEventListener('touchmove', onTouchMove, { capture: true });
            window.removeEventListener('touchend', onTouchEnd, { capture: true });
            window.removeEventListener('touchcancel', onTouchCancel, { capture: true });
            window.removeEventListener('keydown', onKey);
            window.removeEventListener('blur', onBlur);
            if (raf) cancelAnimationFrame(raf);
            clearTimeout(guardTimer);
            clearTimeout(reqDragRef.current?.liftTimer);
            clearTimeout(reqDragRef.current?.longTimer);
            reqHitRef.current = null;
            reqRetargetRef.current = null;
            reqDragRef.current = null;
            reqClickGuardRef.current = false;
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
    // `folding` (req #3695): a card mid-fold is wrapped in a fade Group, which
    // remounts its nodes as the fold starts and again as it lands — so the
    // nodes captured above are re-found on both edges.
    }, [rows, hasRunning, hasNext, size.w, folding]);

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
    // THE RULE ITSELF MOVED TO `pipelinePlanLayout` (req #3280) — see
    // `drawsLabelKind`, which carries what it decides and why. It went there
    // because the halo's ceiling depends on this answer and a rule that lives in
    // a component cannot be asserted against a function that does not: the pair
    // is now one sweep in the layout tests. What stays here is the binding of
    // that rule to THIS frame's level, and the attribute.
    // A PLAIN FUNCTION, not a `useCallback` (review finding): nothing depends on
    // its identity — both call sites are in the render body below and it appears
    // in no dependency array — so the wrapper only read as if it memoised
    // something.
    const drawsKind = (kind) => drawsLabelKind(kind, level);
    // req #3661 — only where the title is DRAWN (L3): at L1/L2 the row is the
    // bare id, and an editor there would be editing text the reader cannot see.
    reqLongPressRef.current = (reqId, stepId, at = null) => {
        if (level !== 'in' || !drawsKind('req')) return false;
        if (!layout.labels.some((l) => l.kind === 'req' && l.reqId === reqId
            && l.stepId === stepId)) return false;
        setReqEdit({ reqId, stepId, saving: false, at });
        return true;
    };
    const drawnKinds = ['step', 'req', 'title', 'badge', 'barrier']
        .filter(drawsKind).join(',');

    // Report the level being rendered so the toolbar's selector can softly mark
    // it while on Auto — BuildVisualizerPage's `onEffectiveLevel` handshake. In
    // an EFFECT, not during render: this calls a setState on the PARENT, and
    // doing that in a child's render body is the React warning that ends in a
    // cross-component update loop.
    //
    // `level` ITSELF, with nothing subtracted (req #3324). A second, quieter
    // level was computed here — `legible ? level : 'out'` — so that the soft mark
    // named what was really on screen while `data-level` carried the ladder's
    // answer. Two answers to one question is what let the control report L1 over
    // a canvas pinned to L2; `planLevelFor` resolves it once and this reports it.
    useEffect(() => { onEffectiveLevel?.(level); }, [level, onEffectiveLevel]);

    // The frames before the zoom behavior has emitted anything draw the view
    // the landing effect is about to apply, not the readable scale it used to
    // name — otherwise the plan paints once zoomed in and then jumps out to
    // where it actually opens (req #3312). `x` stays at the origin and `y` at
    // the ruler's excess, because that is what `resetView` applies (req #3648).
    const t = transform || { x: 0, y: yFactoryDefault, k: kFactoryDefault };

    // ── The add-step marks' geometry (req #3586) ────────────────────────────
    // PLACED once per LAYOUT (at the largest radius, so spacing holds at every
    // zoom), never per frame or per zoom: the camera lives in state, so the
    // render body runs on every pan and zoom event. Only the DRAWN radius
    // follows the zoom, and that is a number the scene function and the hit
    // test read. Drawn only where the cards are — the same predicate as the
    // step label (`labelsDrawn` below).
    const insertDrawn = drawsLabelKind('step', level);
    const insertR = insertMarkRadius(curK);
    const insertRRef = useRef(insertR);
    insertRRef.current = insertR;
    // req #3695 — not while an initiative's fold animates: the marks sit on the
    // SETTLED layout, so mid-fold they would float where the cards are going
    // rather than where they are. They return the frame the fold lands.
    const insertGeom = useMemo(
        () => (insertDrawn && !folding
            ? buildInsertMarks(layout, rows, undefined, { initiativeAdd: !plan.locked }) : null),
        [insertDrawn, folding, layout, rows, plan.locked]);
    insertGeomRef.current = insertGeom;
    openInsertRef.current = openInsert;
    insertHitRef.current = (e) => {
        const el = containerEl;
        const g = insertGeomRef.current;
        if (!el || !g || !(e.target instanceof HTMLCanvasElement)) return null;
        const cam = liveTransformRef.current || t;
        const rect = el.getBoundingClientRect();
        return insertMarkAt(g, {
            x: (e.clientX - rect.left - cam.x) / cam.k,
            y: (e.clientY - rect.top - cam.y) / cam.k,
        }, insertMarkRadius(cam.k));
    };
    // Draws every stub and "+" in one pass on the canvas context. Reads the
    // refs, so a hover change is a `batchDraw`, not a React render.
    const insertSceneFunc = useCallback((ctx) => {
        const g = insertGeomRef.current;
        if (!g) return;
        const hov = insertHoverRef.current;
        const r = insertRRef.current;
        ctx.save();
        ctx.setAttr('strokeStyle', P.arc);
        ctx.setAttr('lineWidth', 1.2);
        ctx.setAttr('globalAlpha', 0.7);
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        // A stub stops at its mark's rim, on whichever side of the card it
        // leaves — right for a dependent, left for a precede (req #3617).
        for (const st of g.stubs) {
            ctx.moveTo(st.x1, st.y);
            ctx.lineTo(st.x2 - Math.sign(st.x2 - st.x1) * r, st.y);
        }
        ctx.stroke();
        ctx.setLineDash([]);
        const arm = r * 0.5;
        ctx.setAttr('lineWidth', Math.max(1, r * 0.17));
        ctx.setAttr('lineCap', 'round');
        ctx.setAttr('fillStyle', P.panel);
        for (const m of g.marks) {
            const lit = m.key === hov;
            // The disc is OPAQUE: the dependency line runs through the mark's
            // centre and must not show inside it (user directive).
            ctx.setAttr('globalAlpha', 1);
            ctx.setAttr('strokeStyle', lit ? P.accent : P.arc);
            ctx.beginPath();
            ctx.arc(m.x, m.y, r, 0, Math.PI * 2, false);
            ctx.fill();
            ctx.moveTo(m.x - arm, m.y);
            ctx.lineTo(m.x + arm, m.y);
            ctx.moveTo(m.x, m.y - arm);
            ctx.lineTo(m.x, m.y + arm);
            ctx.stroke();
        }
        ctx.restore();
    }, []);
    // Hover: light the "+" under the pointer and show a pointer cursor. Native,
    // bound once per container, and a no-op during a pan or a requirement drag.
    useEffect(() => {
        const el = containerEl;
        if (!el) return undefined;
        const setHover = (key) => {
            if (key === insertHoverRef.current) return;
            insertHoverRef.current = key;
            const sc = stageRef.current?.container?.();
            if (sc) sc.style.cursor = key ? 'pointer' : 'grab';
            layerRef.current?.batchDraw?.();
        };
        const onMove = (e) => {
            if (draggingRef.current || reqDragRef.current) return;
            setHover(insertHitRef.current?.(e)?.key ?? null);
        };
        const onLeave = () => setHover(null);
        el.addEventListener('mousemove', onMove);
        el.addEventListener('mouseleave', onLeave);
        return () => {
            el.removeEventListener('mousemove', onMove);
            el.removeEventListener('mouseleave', onLeave);
        };
    }, [containerEl]);

    const cursorPointer = useCallback((e, on) => {
        const stage = e?.target?.getStage?.();
        if (!stage || draggingRef.current || reqDragRef.current?.phase === 'drag') return;
        stage.container().style.cursor = on ? 'pointer' : 'grab';
    }, []);

    // ── Focus an initiative band (req #3204) ──────────────────────────────────────
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
    // `persist` is false for the ONE caller that is not the reader moving the
    // camera: the `?initiative=` deep link (req #3252 — see that effect below). A
    // band-header or sticky-chip click is a user pick, indistinguishable in
    // intent from a drag, and saves like one.
    //
    // THE CAMERA MOVE ITSELF is `applyFocus` (extracted req #3253): a transform,
    // a transition and four flags, identical whether the target is a band or one
    // step. Only the GEOMETRY differs between the two callers, and the flag
    // discipline below — which took two review findings to get right — must never
    // exist in two copies.
    //
    // `animate: false` IS NOT A PREFERENCE (req #3310). A transition is only a
    // transition once a frame arrives, and the panel is sized TWICE at mount —
    // so an effect that starts one during the FIRST sizing has it cancelled by
    // the zoom effect's own `sel.interrupt()` cleanup when the second sizing
    // re-creates the behaviour, one frame in and before it has moved anything.
    // For a camera the reader has not seen yet there is nothing to animate FROM,
    // and `zoom.transform` on a plain selection dispatches start/zoom/end
    // SYNCHRONOUSLY — so an instant apply cannot be pre-empted, needs no seq
    // stamp (the flags cannot outlive the call), and lands before the interrupt
    // that would have killed it. The animated path is unchanged, and is still
    // what every reader-initiated move uses.
    const applyFocus = useCallback((tr, { persist = true, animate = true } = {}) => {
        const el = containerEl;
        const zb = zoomRef.current;
        if (!el || !zb || !tr) return false;
        if (!animate) {
            // INTERRUPT FIRST (review finding): an animated focus still in flight
            // has its `interrupt.focus` handler run here, before this camera is
            // dispatched, so it cannot come back and lower `focusingRef` later.
            select(el).interrupt();
            if (persist) userMovedCameraRef.current = true;
            select(el).call(zb.transform,
                zoomIdentity.translate(tr.x, tr.y).scale(tr.k));
            return true;
        }
        focusingRef.current = true;
        // A band-header click is the reader choosing where to look; the
        // `?initiative=` deep link is not. See `userMovedCameraRef`'s own comment.
        if (persist) userMovedCameraRef.current = true;
        const seq = (focusSeqRef.current += 1);
        select(el).transition().duration(FOCUS_MS)
            // 'end' fires on completion; a pre-emption fires one of two
            // different events and BOTH must be listened for. d3-transition
            // dispatches 'interrupt' only for a transition that has already
            // STARTED, and 'cancel' for one still scheduled — see
            // d3-transition/src/interrupt.js, `state > STARTING && state < ENDING`.
            // A transition created inside an effect sits at CREATED/SCHEDULED
            // until the next animation frame, so anything that pre-empts it
            // inside that window — a mousedown, a wheel, the unmount cleanup's
            // `sel.interrupt()`, or `resetView`'s own `zoom.transform` (which
            // interrupts first) — dispatched 'cancel' and NOTHING lowered the
            // flag, and `focusingRef` stuck true kills every world click. It was
            // reachable by pressing the mouse within one frame of a
            // `?initiative=` landing, and unbounded in a backgrounded tab where no
            // frame ever comes. (The `focusingRef` half predates req #3252.)
            //
            // Only the LATEST transition may lower them: d3 pre-empts the older
            // one on the next tick, i.e. AFTER its successor has already set the
            // flags, so an unstamped handler would clear its successor's.
            .on('end.focus interrupt.focus cancel.focus', () => {
                if (focusSeqRef.current !== seq) return;
                focusingRef.current = false;
            })
            .call(zb.transform, zoomIdentity.translate(tr.x, tr.y).scale(tr.k));
        return true;
    }, [containerEl]);

    // The band caller. Signature unchanged (a band, an options bag, a boolean
    // back) so every existing call site — the band header, the sticky chip, the
    // req #3235 deep-link effect — is untouched.
    //
    // `kZoomFloor` is handed IN rather than re-derived inside the fit (req
    // #3274). It is the same number `.scaleExtent` is configured with and the
    // same number `factoryDefaultScale` is already given, for the reason that
    // one's comment spells out — a re-derived `kBase * FOCUS_MIN_RATIO` agreed
    // with the real floor only while `kDefault === kFit`, and req #3168's
    // readable default broke that on every plan large enough to need it.
    const focusInitiative = useCallback((band, opts) => applyFocus(
        initiativeFocusTransform(layout, band, size, kDefault, kZoomFloor), opts),
    [applyFocus, layout, size, kDefault, kZoomFloor]);

    // ── AND NO PIN EFFECT AT ALL (req #3324) ────────────────────────────────
    // Req #3310 put an effect here that read the live camera and, when the
    // pinned level named something the scale could not draw, zoomed to the
    // smallest scale that could — on a click AND on every landing, with a flag
    // apiece for persist/animate and a stand-aside for `?initiative=`/`?step=` links.
    // All of it existed to rescue a chip that `drawsLabelKind`'s legibility AND
    // had made inert. #3324 honours the pin instead, so the whole mechanism is
    // deleted: no `pinAppliedRef`, no `levelPrefFromLink` prop, and no third
    // caller of `applyFocus`. THE SELECTOR OWNS NO CAMERA MOVE — a level pin
    // changes what is drawn and nothing else, which is what the reader asked for
    // and what makes PIPE-16's "pinning must not move the camera" true at every
    // scale rather than only at the ones the correction declined to fire on.

    // ── THE SECOND STOP: THE NEXT LAUNCH STEP (req #3297, #3371) ────────────
    // NO NEW GEOMETRY FUNCTION. This used to call a third fit of its own,
    // framing the dashed launch-unit rectangle; req #3371 made the STEP the
    // launch unit, so the second stop re-points at `stepFocusTransform` — req
    // #3253's, already here for the `?step=` deep link. A single step is
    // framed by a STATED scale (`STEP_FOCUS_STEPS_ACROSS`); a SET of two or
    // more is a TIGHT fit — `FOCUS_PAD` screen px on whichever axis binds,
    // nothing proportional (req #3503) — with no third function needed for
    // either.
    //
    // Written to look identical to the band caller on purpose — the flag
    // discipline in `applyFocus` took two review findings to get right and must
    // never exist in a second copy. `opts` is not even offered: this focus is
    // only ever reached by the reader clicking, so it always persists (item 5),
    // and a parameter whose one legal value is the default is a way to get it
    // wrong later.
    // req #3365 — a SET of steps, not one. `stepsFocusTransform` is what
    // `stepFocusTransform` is now built on, so a one-step initiative frames exactly
    // as the single-step focus always did.
    // req #3685 — the band rides along so the work stop's spare room is spent
    // on the initiative's own cards, not on whatever lies beside the open work.
    const focusInitiativeWork = useCallback((band, stepIds) => applyFocus(
        initiativeWorkFocusTransform(layout, band, stepIds, size, kDefault, kZoomFloor)),
    [applyFocus, layout, size, kDefault, kZoomFloor]);

    // Which STEP each band's SECOND click goes to — computed once per layout
    // rather than per click, because the initiative chips also need it to say what
    // they do (the `title`/`aria-label` below) and a control that named one
    // step and zoomed to another would be worse than one that named none.
    // `null` for a band with no next launch step, which is what keeps that
    // band's clicks on the level-1 fit instead of reaching for a transform that
    // would come back null.
    const initiativeWorkByInitiative = useMemo(() => {
        const m = new Map();
        for (const band of layout.bands) {
            m.set(initiativeCycleKey(band), initiativeWorkStepIds(rows, layout, band));
        }
        return m;
    }, [layout, rows]);

    // WHERE THE CYCLE LIVES: a ref, not state. Nothing on screen is a function
    // of it — the camera is moved by d3, the chip's label is a function of the
    // LAYOUT (which step is next), not of where the reader currently is — so
    // holding it in state would re-render the whole canvas on every click for
    // no visible difference. It is also why the cycle is a pure function in
    // `pipelineInitiativeZoom.js`: a ref is invisible to a test, and the rules are the
    // part of this feature most worth pinning.
    //
    // `{ key, level }` — per INITIATIVE AND per PLAN (`initiativeZoomStateKey`), never
    // global (item 2). Only ever advanced by a move that actually happened:
    // `applyFocus` returns false when there is no container or no transform yet,
    // and recording a level for a camera that did not move would make the
    // reader's next click the reverse of a move they never saw. Declared beside
    // `userMovedCameraRef` above; cleared by the same gesture it is.
    //
    // The initiative name's activation — one function behind both the click and the
    // Enter/Space handler, so keyboard parity is structural rather than a second
    // copy that has to be kept in step.
    // `deep` (req #3580, "double click to double zoom") skips the band stop and
    // asks for the step stop directly — the same floor applies, so a band with
    // no next step still lands on its band fit.
    const activateInitiativeName = useCallback((band, { deep = false } = {}) => {
        // A FOLDED initiative has no cards to zoom to (req #3650), so its name
        // unfolds it instead of doing nothing; the next click zooms as usual.
        if (band?.collapsed) {
            toggleInitiativeFold(band.initiativeId ?? null);
            return;
        }
        // req #3695 — the chip carries the band as DRAWN, which mid-fold is
        // part-way open; the camera fits the band the fold is arriving at.
        band = layout.bands.find((b) => b.key === band?.key) || band;
        const key = initiativeZoomStateKey(pipeline?.id, band);
        const workIds = initiativeWorkByInitiative.get(initiativeCycleKey(band)) || [];
        const next = deep && workIds.length > 0
            ? INITIATIVE_ZOOM_STEP
            : nextInitiativeZoom(initiativeZoomRef.current, key, workIds.length > 0);
        // THE STEP MOVE IS ATTEMPTED, THE BAND MOVE IS THE FLOOR (code review).
        // If the step fit comes back null — the two halves disagreeing, or a
        // container not ready — the level would never advance and every further
        // click would retry the same failing step, with the band fit
        // unreachable. Falling through to the band makes the control
        // self-healing: something always happens, and the cycle is never stuck
        // at a level the camera is not actually on.
        let level = next;
        let moved = next === INITIATIVE_ZOOM_STEP && focusInitiativeWork(band, workIds);
        if (!moved) {
            level = INITIATIVE_ZOOM_BAND;
            moved = focusInitiative(band);
        }
        if (moved) initiativeZoomRef.current = { key, level };
    }, [initiativeWorkByInitiative, focusInitiativeWork, focusInitiative, pipeline?.id, toggleInitiativeFold, layout]);

    // ── IN-PLACE EDIT (req #3580) ───────────────────────────────────────────
    // Three edits, straight from the canvas: an initiative's NAME, a step's NAME, and
    // a step's RUN mode. Each writes ONE column through the same helper the
    // Initiatives / Steps editors use, then re-reads the composed plan — the canvas
    // never patches its own copy, so what it draws next is the server's answer.
    //
    // `{ key, saving }` / `{ stepId, saving }` — which editor is open, and
    // whether its write is in flight (the input goes read-only rather than
    // vanishing, so a slow save does not look like a dropped one).
    // (`idToken`, `darwinUri`, `queryClient`, `showError` are declared once at
    // the top of the component — req #3581's drag-and-drop needs them too.)
    const [initiativeEdit, setInitiativeEdit] = useState(null);
    const [stepEdit, setStepEdit] = useState(null);
    // stepId -> the run mode being written. Drawn in place of the stored one
    // until the re-read lands, so the circle answers the click immediately.
    const [runPending, setRunPending] = useState(() => new Map());

    // The plan's own read, plus the two list caches the Initiatives and Steps pages
    // render from — a rename here must not leave either of them stale.
    const refreshPlan = useCallback(() => {
        const creatorFk = profile?.userName;
        return Promise.all([
            pipeline?.id != null
                && queryClient.invalidateQueries({
                    queryKey: pipelineComposeKeys.byId(pipeline.id) }),
            creatorFk && queryClient.invalidateQueries({ queryKey: initiativeKeys.all(creatorFk) }),
            creatorFk && queryClient.invalidateQueries({
                queryKey: pipelineStepKeys.all(creatorFk) }),
        ]);
    }, [queryClient, pipeline?.id, profile?.userName]);

    // ── THE SINGLE EDITOR, OVER THE CANVAS (req #3742) ─────────────────────
    // User directives: "single click of initiative and step to take you to the single
    // editor", then "can it just popup over the visualizer instead of switch to
    // the card view?". So a click opens the SAME dialog the Steps / Initiatives pages
    // use (`StepEditDialog`, `InitiativeEditDialog`) right here, seeded from rows this
    // canvas already holds — the composed read carries every field the dialogs
    // edit, so no read is added — and a save re-reads the plan. `key` changes
    // per open so the form seeds afresh; `kind` outlives the close so the exit
    // animation has something to draw.
    const [planEditor, setPlanEditor] = useState({ key: 0, open: false, kind: null, target: null });
    // When it opened: the second click of a quick double click on the title
    // area lands on the dialog's backdrop, which must not close it at once (the
    // add-step dialog's `insertOpenedAtRef` rule).
    const planEditorOpenedAtRef = useRef(0);
    const openPlanEditor = useCallback((what, id) => {
        let target = null;
        if (what === 'initiative') {
            target = (model?.initiatives || []).find((e) => e.id === id) || null;
        } else {
            const row = rowById.get(id);
            if (row) {
                target = {
                    id: row.id, initiative_fk: row.initiativeId, title: row.title, notes: row.notes,
                    // A run-mode write still in flight is the mode the step
                    // has; seeding the stored one would revert it on Save.
                    run: runPending.get(row.id) ?? row.run,
                    not_before: row.timeDeps?.[0] ?? null,
                    locked: row.locked, lockedBy: row.lockedBy,
                    checkpoint: row.checkpoint,
                };
            }
        }
        if (!target) return;
        planEditorOpenedAtRef.current = Date.now();
        setPlanEditor((ed) => ({ key: ed.key + 1, open: true, kind: what, target }));
    }, [model?.initiatives, rowById, runPending]);
    const closePlanEditor = useCallback((reason) => {
        if (reason === 'backdropClick'
            && Date.now() - planEditorOpenedAtRef.current < DOUBLE_CLICK_MS) return;
        setPlanEditor((ed) => ({ ...ed, open: false }));
    }, []);

    // One commit path for every name — initiative, step and (req #3661) requirement
    // title. An unchanged name closes the editor
    // without a write; a refused one says why and keeps the stored name.
    //
    // EVERY state write is to THIS editor only. An editor can commit after the
    // reader has already opened another — a long press on the next row takes
    // the first editor away, and its unmount is a commit — so an unconditional
    // `setEdit` would mark, or close, the editor the reader just asked for.
    const commitTitle = useCallback(async ({ current, raw, setEdit, editState, write, what }) => {
        const mine = (cur) => !!cur && cur.key === editState.key
            && cur.stepId === editState.stepId && cur.reqId === editState.reqId;
        const close = () => setEdit((cur) => (mine(cur) ? null : cur));
        const next = String(raw ?? '').trim();
        if (next === current) { close(); return; }
        const problem = titleProblem(next);
        if (problem) { showError(problem); close(); return; }
        setEdit((cur) => (mine(cur) ? { ...cur, saving: true } : cur));
        try {
            await write(next);
            await refreshPlan();
        } catch (err) {
            showError(err, `Could not rename the ${what}`);
        } finally {
            close();
        }
    }, [refreshPlan, showError]);

    // req #3649 — A LOCKED ROW IS A RELIC IN TIME. The gateway refuses the
    // write (423) whatever the UI does; these say so BEFORE the attempt, in
    // the lock's own words, and name the level to unlock. `lockedBy` is the
    // OUTERMOST lock, which is the one that must be lifted first.
    const lockedMessage = (what, lockedBy) => (
        `This ${what} is locked${lockedBy && lockedBy !== what
            ? ` by its ${lockedBy}` : ''} — unlock it first`);
    const refuseIfLocked = useCallback((what, lockedBy) => {
        if (!lockedBy) return false;
        showError(lockedMessage(what, lockedBy));
        return true;
    }, [showError]);

    const commitInitiativeTitle = useCallback((band, raw) => {
        if (refuseIfLocked('initiative', band.lockedBy)) { setInitiativeEdit(null); return undefined; }
        return commitTitle({
            current: band.initiative, raw, what: 'initiative',
            setEdit: setInitiativeEdit, editState: { key: initiativeCycleKey(band) },
            write: (title) => updateInitiative(darwinUri, idToken, band.initiativeId, { title }),
        });
    }, [commitTitle, darwinUri, idToken, refuseIfLocked]);

    const commitStepTitle = useCallback((row, raw) => {
        if (refuseIfLocked('step', row.lockedBy)) { setStepEdit(null); return undefined; }
        return commitTitle({
            current: row.title || '', raw, what: 'step',
            setEdit: setStepEdit, editState: { stepId: row.id },
            write: (title) => updateStep(darwinUri, idToken, row.id, { title }),
        });
    }, [commitTitle, darwinUri, idToken, refuseIfLocked]);

    // req #3649 — ONE write path for the step's two flags and the three locks:
    // write, re-read, surface the gateway's own refusal. The lock toggle is the
    // one authoring write a locked row still accepts (it is how a lock is
    // lifted), so it never asks `refuseIfLocked` — except when the lock is an
    // ANCESTOR's, where flipping this row's own flag would change nothing the
    // reader can see.
    const writeFlag = useCallback(async (write, failure) => {
        try {
            await write();
            await refreshPlan();
        } catch (err) {
            showError(err, failure);
        }
    }, [refreshPlan, showError]);

    const toggleBarrier = useCallback((row) => {
        if (refuseIfLocked('step', row.lockedBy)) return;
        writeFlag(() => updateStep(darwinUri, idToken, row.id,
            { checkpoint: row.checkpoint === false ? 1 : 0 }),
        'Could not change the step barrier flag');
    }, [writeFlag, refuseIfLocked, darwinUri, idToken]);

    const toggleInitiativeLock = useCallback((band) => {
        if (band.lockedBy === 'pipeline') {
            showError(lockedMessage('initiative', 'pipeline'));
            return;
        }
        writeFlag(() => updateInitiative(darwinUri, idToken, band.initiativeId,
            { locked: band.lockedBy === 'initiative' ? 0 : 1 }),
        'Could not change the initiative lock');
    }, [writeFlag, showError, darwinUri, idToken]);

    // req #3661 — the requirement title. The composed plan read carries the
    // titles the canvas draws; the requirements lists carry them everywhere else.
    //
    // "Unchanged" is judged against the text the editor OPENED on, not the
    // latest stored title: if somebody else renamed it meanwhile, closing this
    // editor untouched must not write the old name back over theirs.
    const dropReqDraft = useCallback((reqId, title) => setReqDrafts((m) => {
        if (!m.has(reqId) || (title !== undefined && m.get(reqId) !== title)) return m;
        const out = new Map(m);
        out.delete(reqId);
        return out;
    }), []);
    const commitReqTitle = useCallback(async (reqId, stepId, raw, opened) => {
        try {
            await commitTitle({
                current: opened, raw, what: 'requirement',
                setEdit: setReqEdit, editState: { reqId, stepId },
                write: async (title) => {
                    await updateRequirementTitle(darwinUri, idToken, reqId, title);
                    if (profile?.userName) {
                        queryClient.invalidateQueries({
                            queryKey: requirementKeys.all(profile.userName) });
                    }
                },
            });
        } finally {
            // Unless the reader has since typed something newer for it.
            dropReqDraft(reqId, raw);
        }
    }, [commitTitle, dropReqDraft, darwinUri, idToken, queryClient, profile?.userName]);

    // The run circle's click. A second click while the first write is in flight
    // is ignored rather than queued — it would race the first one's re-read.
    const toggleRun = useCallback(async (stepId, current) => {
        if (runPending.has(stepId)) return;
        if (refuseIfLocked('step', rowById.get(stepId)?.lockedBy)) return;
        const next = current === 'manual' ? 'auto' : 'manual';
        setRunPending((m) => new Map(m).set(stepId, next));
        try {
            await updateStep(darwinUri, idToken, stepId, { run: next });
            await refreshPlan();
        } catch (err) {
            showError(err, 'Could not change the step run mode');
        } finally {
            setRunPending((m) => {
                const out = new Map(m);
                out.delete(stepId);
                return out;
            });
        }
    }, [runPending, darwinUri, idToken, refreshPlan, showError, refuseIfLocked, rowById]);

    // ── QUICK CLICK / DOUBLE CLICK / LONG PRESS (req #3580) ────────────────
    // User directive: "fast click to zoom, long click to edit, double click to
    // double zoom". ONE tracker for every target on the panel — see
    // `planPressGesture.js` for the rules and for why it reads pointer events.
    const pressRef = useRef(null);
    if (!pressRef.current) pressRef.current = createPressTracker();
    useEffect(() => () => pressRef.current?.dispose(), []);

    // A STEP TITLE's three gestures. Read through a ref by the native canvas
    // listeners (bound once per container), so they always see this render's
    // layout and camera. A quick click opens the step's single editor (req
    // #3742 — it framed the step until then); a double click frames it at
    // twice the `?step=` deep link's own framing, about the same centre. A
    // long press opens the name's in-place editor.
    const stepPressRef = useRef(null);
    stepPressRef.current = (stepId) => ({
        onClick: () => openPlanEditor('step', stepId),
        onDoubleClick: () => {
            const tr = stepFocusTransform(layout, stepId, size, kDefault, kZoomFloor);
            if (!tr) return;
            initiativeZoomRef.current = null;
            const k2 = Math.min(kDefault * ZOOM_MAX_RATIO, tr.k * 2);
            applyFocus(zoomAboutViewportCentre(tr, size, k2) || tr);
        },
        // `at` — the press point, where the editor puts its caret (req #3665).
        onLongPress: (at) => {
            setStepEdit({ stepId, saving: false, at });
        },
    });

    // ── WHERE THE CYCLE IS CLEARED, AND WHY IT IS THREE PLACES ──────────────
    // Level 2 is only the right answer to the NEXT click while the premise
    // behind it holds: the reader is looking at the band this control put them
    // on. Every camera move that is not this control's own breaks that premise,
    // and they arrive by three different roads — so the clear sits on each:
    //
    //   · a DRAG or a WHEEL — the zoom behaviour's own handler, gated on
    //     `gestureMovedCamera` so the jitter inside a click is not mistaken for
    //     a pan;
    //   · RESET — `factoryReset`, which reaches the camera through
    //     `zoom.transform` and so carries no `sourceEvent` at all;
    //   · A NEW WORLD — the landing effect, when a toolbar toggle rescales the
    //     plan and the camera is re-based.
    //
    // A shared callback was written here first and used by none of them: two of
    // the three are effects defined EARLIER in this body, where a callback
    // declared at this point cannot appear in a dependency array. A ref write
    // needs no dependency, so each site does its own — three assignments,
    // documented at each, rather than one binding nothing could reach.

    // Req #3235 — the mount-time end of the `?initiative=` deep link: land on the
    // SAME centered/zoomed view a band-header click produces, through the
    // SAME zoom behaviour (`focusInitiative`, never a direct transform write — the
    // behaviour owns its own transform, and setting state alone would snap
    // back on the next wheel or drag).
    //
    // If the plan is still loading, this component has not mounted yet
    // (PipelineDetail's `isLoading` gate) — nothing here can fire against an
    // empty canvas. What CAN still be empty at mount is the container's own
    // size (the ResizeObserver hasn't measured yet) and the zoom behaviour
    // (attached by the effect above, in the same commit but strictly earlier
    // in hook order); `focusInitiative`'s own guards return false for both, so this
    // effect simply retries on the next render that changes one of its
    // dependencies rather than marking a no-op "applied".
    //
    // `initiativeFocusAppliedRef` KEYS ON THE MEASURED SIZE TOO, not just the
    // (pipeline, initiative) pair (req #3235 code review finding) — the panel is
    // sized TWICE at mount (the `calc(100vh - 260px)` fallback in the JSX
    // below, then again once `measureAvailH` resolves), and the focus applied
    // against the first of those is a fit for a panel the reader never sees.
    // Folding the measured size into the key re-fits it once the panel has
    // settled.
    //
    // ── BUT NOT AFTER THE READER HAS TAKEN THE WHEEL (req #3252 review) ─────
    // That key used to be justified by REPAIR: the second resize re-ran the
    // `resetView` effect, whose cleanup interrupted the focus and snapped the
    // camera home, so re-applying put back what the resize had broken. Req
    // #3252 replaced that effect with one keyed on the world's own geometry, so
    // A RESIZE NO LONGER RESETS ANYTHING — and the re-focus stopped being a
    // repair and became the only thing moving the camera, away from wherever
    // the reader had put it. `availH` is re-measured on EVERY render, so a
    // header-height change alone (the description dialog, an order-violations
    // alert appearing on a refetch) was enough to yank a reader who had panned
    // somewhere else back onto the linked band — while storage still held their
    // pan, so the screen and the memory silently disagreed.
    //
    // `userMovedCameraRef` is the boundary: the deep link may re-fit itself as
    // the panel settles, and stops existing the moment the reader drags or
    // wheels. One flag, set from the only place that can know the difference —
    // d3's `sourceEvent`.
    //
    // ── IT WINS OVER THE RESTORED CAMERA, ONCE (req #3252, #3637) ───────────
    // A freshly followed `?initiative=` link is the more specific request, so it
    // overrides the camera the landing restored — letting a stale camera
    // silently swallow it is the dead-link outcome req #3235 rules out. Since
    // req #3637 the camera it lands on is SAVED like any other (the reader is
    // looking at it, so a reload must show it), and the link fires only once:
    // PipelineDetail marks it consumed in the history entry, so a reload or a
    // Back/Forward onto this URL restores the reader's camera instead of
    // re-fitting the band.
    const initiativeFocusAppliedRef = useRef(null);
    useEffect(() => {
        // req #3651 — a cleared focus forgets it was applied, so a LATER link
        // to the same initiative on this same canvas flies again.
        if (focusInitiativeId == null) { initiativeFocusAppliedRef.current = null; return; }
        // Req #3253 — a named STEP is the more specific request and wins, exactly
        // as it does in `PipelineDetail`'s `linkView`. Without this a URL
        // carrying both parameters would start two camera transitions in one
        // commit, and the loser would be pre-empted mid-flight.
        if (focusStepId != null) return;
        if (userMovedCameraRef.current) return;
        // req #3651 — NOT BEFORE THE LANDING. See the step twin below.
        if (landedKey !== landKey) return;
        // The SAME readiness guard the landing effect takes (req #3312). Without
        // it the two desynchronise at mount: this would start its 420ms ease
        // against the provisional panel while the landing waited, and the
        // landing's own `zoom.transform` would then interrupt that transition a
        // render later. The `size` in the key below means the fit was already
        // repeated on the settled panel, so this only removes the wasted first
        // pass — not a behaviour the final camera depended on.
        if (!sizeSettled()) return;
        const key = `${pipeline?.id}:${focusInitiativeId}:${size.w}x${size.h}`;
        if (initiativeFocusAppliedRef.current === key) return;
        const band = layout.bands.find((b) => b.initiativeId === focusInitiativeId);
        if (!band) return;
        if (focusInitiative(band, { persist: false })) {
            initiativeFocusAppliedRef.current = key;
            // A LANDING COUNTS AS CLICK 1 (req #3297 item 4). The reader is
            // already looking at this band, so their first manual click on its
            // name must go one level DEEPER, not repeat the fit they arrived
            // at. Seeded here rather than inferred from `focusInitiativeId` in the
            // cycle itself: this is the only place that knows the fit actually
            // landed, and the re-fit this effect performs as the panel settles
            // is idempotent on the level for the same reason.
            initiativeZoomRef.current = {
                key: initiativeZoomStateKey(pipeline?.id, band), level: INITIATIVE_ZOOM_BAND,
            };
        }
    }, [focusInitiativeId, focusStepId, pipeline?.id, size, layout, focusInitiative, sizeSettled,
        landKey, landedKey]);

    // Req #3253 — the mount-time end of the `?step=` deep link, in PLAN mode.
    //
    // EVERY rule the `?initiative=` effect above works out applies here unchanged, and
    // this is deliberately its twin rather than a variation: keyed on the
    // MEASURED SIZE as well as the (plan, step) pair so the panel's second sizing
    // re-fits rather than being recorded as done; abandoned the moment
    // `userMovedCameraRef` says the reader has taken the wheel; `persist: false`,
    // which since req #3637 only means "not the reader's own gesture" — the
    // camera it lands on is saved, and the link is consumed once upstream. Read those comments for the reasoning; the only
    // thing that differs here is `stepFocusTransform` in place of the band fit.
    //
    // A STEP LINK BEATS AN INITIATIVE LINK, matching `PipelineDetail`'s own precedence
    // (`linkView`: a named step is the more specific request). They cannot both
    // apply in the same landing — the guard below is what stops one camera move
    // interrupting the other's transition mid-flight if a hand-written URL
    // carries both parameters.
    const stepFocusAppliedRef = useRef(null);
    useEffect(() => {
        if (focusStepId == null) { stepFocusAppliedRef.current = null; return; }  // its twin's reason
        if (userMovedCameraRef.current) return;
        // ── NOT BEFORE THE LANDING (req #3651) ──────────────────────────────
        // The landing is this canvas's FIRST camera write — restore or base
        // view — and it waits for the panel's real height; `sizeSettled()`
        // alone is satisfied by the provisional one. A focus that started
        // first flew from the identity camera, was interrupted at its first
        // tick when the panel re-sized (the zoom behaviour is rebuilt on a size
        // change and interrupts what is running), and its 'end' SAVED that
        // near-identity camera — which the landing then restored. `landedKey`
        // is state the landing sets, so this re-runs in the commit after it.
        if (landedKey !== landKey) return;
        if (!sizeSettled()) return;                      // the twin's guard, req #3312
        const key = `${pipeline?.id}:${focusStepId}:${size.w}x${size.h}`;
        if (stepFocusAppliedRef.current === key) return;
        const tr = stepFocusTransform(layout, focusStepId, size, kDefault, kZoomFloor);
        if (!tr) return;
        if (applyFocus(tr, { persist: false })) stepFocusAppliedRef.current = key;
    }, [focusStepId, pipeline?.id, size, layout, kDefault, kZoomFloor, applyFocus,
        sizeSettled, landKey, landedKey]);

    // Req #3235 code review — the resolved pipeline can legitimately hold no
    // band for this initiative: the resolver answers "which pipeline hosts any of
    // this initiative's requirements", but a band is keyed on each STEP's DOMINANT
    // initiative (design rule 10), so an initiative that never dominates a step of the
    // resolved pipeline has no band here even though the resolution was
    // correct. By the time this component has mounted, PipelineDetail's
    // `isLoading` gate has already cleared and `layout` is final — so a miss
    // here is a terminal fact, not a still-loading one, and needs to say so
    // rather than silently landing on the default view (the dead-link outcome
    // the requirement text rules out, arrived at from the other direction).
    const focusInitiativeNotOnPlan = focusInitiativeId != null && focusStepId == null
        && !layout.bands.some((b) => b.initiativeId === focusInitiativeId);

    // Req #3253 — the same terminal fact for a named STEP, and reachable by more
    // than a typo: the requirement page resolves the step and the pipeline from
    // separate reads, so a step DROPPED from the plan between the two renders a
    // link whose ids are each individually valid. By the time this component has
    // mounted `layout` is final, so a miss here is settled rather than pending —
    // and saying so beats a default view with no explanation for why nothing
    // moved. Deliberately keyed on the LAYOUT, not on the transform: a step that
    // is on the plan but could not be fit (a zero-size container mid-mount) is
    // still going to focus on the next render, and must not flash this.
    // The PLAN's rows, not the layout's nodes (req #3650): a step inside a
    // folded initiative has no node and is still on this plan.
    const focusStepNotOnPlan = focusStepId != null && !rowById.has(focusStepId);

    if (!rows.length) {
        return (
            <Box>
                <OrderViolationsAlert plan={plan} />
                <EmptyPlanAddStep model={model} pipeline={pipeline}
                                  testId="pipeline-plan-viz-empty" />
            </Box>
        );
    }

    // ── Floating initiative labels (req #3119, RE-RULED req #3257) ────────────────
    // The name sits at the top-left corner of its band's rectangle INTERSECTED
    // with the visible content area — so it clamps to the viewport while any
    // part of the band is on screen, and is pushed off by its own rectangle as
    // that rectangle leaves. Static world text scrolls off the moment you pan
    // into a tall band, and a full-height canvas makes bands taller — so on the
    // live plan you could be four screens deep in a band with nothing on screen
    // saying which.
    //
    // HTML overlay rather than a Konva node: the clamp is a per-frame position
    // that has nothing to do with the world transform, and computing it here
    // keeps the world purely a function of the layout. `pointerEvents: 'none'` on
    // the strip so it never eats a drag-pan; the label itself re-enables them so
    // the initiative stays clickable (production directive).
    //
    // THE PLACEMENT ITSELF MOVED OUT (req #3168) to pipelinePlanLayout's
    // `placeInitiativeChips` — every other rectangle on this surface is decided by a
    // pure function precisely so that overlap is testable, and the chips were the
    // one exception. Under req #3257's rule the placement is two `min()`s over
    // the band's rectangle and the visible content area. The key (bottom-center
    // since req #3255; was the top-right corner) is the one obstacle that still
    // binds, and it CLIPS a name rather than displacing it. All of it is
    // asserted in `__tests__/pipelinePlanLayout.test.js` over a swept transform.
    //
    // req #3272 put the legibility floor on the FONT (11px) and derives the box
    // from it, so the name no longer shrinks to ~6.9px and is no longer DROPPED
    // when the initiative lane cannot hold it — it draws over the first row of step
    // labels on its 60%-opaque panel instead. Three consequences reach this file,
    // none of them a change to what this component does:
    //
    //   · `e.clipped` NO LONGER IMPLIES A KEY. The floored chip is 20–60% wider,
    //     so the band's own right edge became a clip rather than a drop, and a
    //     name is now cut short with no key on screen at all. The `maxWidth` +
    //     `overflow: hidden` block below is written against the FLAG and never
    //     against the key, which is why it needed no change.
    //   · `e.h` can now EXCEED its band's own on-screen height. Nothing here
    //     assumes otherwise — the box is absolutely positioned and sized from
    //     `e.h` — and `placeInitiativeChips` bounds how far the name may sit from the
    //     band it names, so the click target (req #3204) still belongs to the
    //     initiative the reader is pointing at.
    //   · chip-on-chip overlap, which USED to be impossible by construction, is
    //     now prevented by a vertical de-collision pass inside `placeInitiativeChips`.
    //
    // The chip's METRICS come from the layout module too (`INITIATIVE_CHIP_H`,
    // `INITIATIVE_CHIP_CHAR_W`), and are deliberately not passed from here: this file
    // carried its own character width, it was a leftover from the 12px chip that
    // never moved with req #3119's +25% type scale, and a placement pass reading
    // a 22%-short width lets the name hang past the edge it was clamped to.
    // The sx block below is the other half of that contract — its `fontSize` and
    // padding must stay in step with the module's constants.
    const floatingInitiatives = placeInitiativeChips({
        bands: drawLayout.bands,
        transform: t,
        viewport: size,
        worldWidth: drawLayout.width,
        // No keep-out: the key left the canvas for a popup (req #3722), so
        // nothing floats over the plan's bottom edge for a name to dodge.
        keepOut: null,
        // THE HEADER CHROME the name stops just below, never underneath
        // (req #3257 clause 2) — whatever is PINNED above the plan inside this
        // panel. That is the TIME RULER: since req #3254 it draws in a Group
        // anchored at `stickyRulerY(t)` rather than `t.y`, so it stays on screen
        // while the plan pans under it, and an initiative name clamped to y=0 would
        // slide beneath it.
        //
        // `rulerScreenBottom(t)` is the ONE readable number req #3254 exposes
        // for exactly this handshake — its own comment names req #3257 as the
        // consumer. Read from the SAME transform the ruler is drawn with, so the
        // two cannot disagree, and it scales with zoom because the strip's ticks
        // and text do. Never a hand-guessed pixel offset: `RULER_H` is world
        // units and the pin makes the screen edge a function of `t`, so any
        // constant here would be right at exactly one zoom.
        //
        // The SAME number insets the DOM overlay below (req #3374 P1) — see
        // `initiativeOverlayTopInset` — so the two pinned consumers of this edge can
        // never disagree with each other either.
        topInset: rulerScreenBottom(t),
    });
    // req #3374 P1: a departing chip's y comes from `placeInitiativeChips`' own
    // `bottom − CHIP_MARGIN_Y − h` clamp term (the one that makes a name
    // LEAVE WITH its band), which is free to go below `topInset` — the OTHER
    // clamp term is what floors it at the ruler, and the two are a `min()`
    // apart, so the leave-with-band term can win. That drew the name over the
    // pinned ruler for its last ~26px. A FOLDED initiative's title bar (req #3738)
    // rides its band's corner and so also slides under the ruler as it scrolls
    // off — the same clip covers it. Reusing the SAME `rulerScreenBottom(t)`
    // here clips it at the DOM layer instead of re-deriving the edge.
    const initiativeOverlayTopInset = rulerScreenBottom(t);

    // ── Drop-to-seat from the unorchestrated box (req #3583) ────────────────
    // A box row is a dnd-kit draggable (req #3665 — it was a native HTML5 drag,
    // which touch browsers do not drive): it lifts on the shared press timeline,
    // the shared DragOverlay carries a copy of it, and the drop is answered by
    // a CUSTOM collision detection — the step cards are Konva shapes, not DOM
    // droppables, so "what is under the pointer" is the canvas's own step hit
    // test, the point projected through the SAME live transform the world Group
    // is drawn with and tested against the layout's own card frames.
    //
    // What hides a card: the box (chrome), and an initiative chip — any HTML over the
    // canvas except a card's own count badge, which sits ON the card it counts.
    const overlaysCard = (e) => {
        const target = e.target;
        if (target?.closest?.(`${CHROME_SELECTOR}, [data-viz-unseated]`)) return true;
        if (!(target instanceof HTMLCanvasElement)
            && !target?.closest?.('[data-testid="pipeline-viz-badge-layer"]')) return true;
        return false;
    };
    // The step a client point would seat onto, judged by what lies UNDER it:
    // never the drag preview riding the pointer, and — for the whole box
    // carried by its title bar (`throughBox`) — never the box either, since the
    // card it is aimed at is beneath it. A single row's drop over the box is
    // over chrome, as any drop on the box is.
    //
    // Nothing beneath the pointer is NOT the open canvas (req #3614): pointer
    // capture keeps delivering events past the window edge, where
    // `elementsFromPoint` answers [] — and a point outside the plan panel is no
    // seat either, so both are over-chrome.
    const seatTargetAtPoint = (clientX, clientY, throughBox) => {
        const el = containerEl;
        if (!el || clientX == null || clientY == null) return null;
        const overlay = document.querySelector('[data-testid="drag-overlay"]')?.parentElement;
        const beneath = (document.elementsFromPoint?.(clientX, clientY) || [])
            .find((n) => !overlay?.contains(n)
                && !(throughBox && n.closest?.('[data-viz-unseated]')));
        const rect = el.getBoundingClientRect();
        const canSeat = pointerCanSeat(clientX, clientY, rect, beneath);
        return resolveSeatDrop({
            point: { x: clientX - rect.left, y: clientY - rect.top },
            overChrome: !canSeat || overlaysCard({ target: beneath, clientX, clientY }),
            rulerBottom: initiativeOverlayTopInset,
            t, nodes: drawLayout.nodes, rowById,
        });
    };
    const sameTarget = (a, b) => (a === b)
        || (!!a && !!b && a.stepId === b.stepId && a.ok === b.ok);
    // The collision detection dnd-kit calls on every pointer frame. Its answer
    // carries the resolved target, so the move and drop handlers need not ask
    // again; the pointer is kept so a camera move under a still pointer (a
    // wheel zoom) re-aims the outline (`reseatRef`). Stable identity, read
    // through a ref: DarwinDndContext takes it once.
    seatCollideRef.current = ({ active, pointerCoordinates: p }) => {
        if (active?.data?.current?.type !== UNSEATED_DRAG_TYPE || !p) return [];
        rowPointerRef.current = { x: p.x, y: p.y };
        const target = seatTargetAtPoint(p.x, p.y, false);
        return target ? [{ id: `seat-step-${target.stepId}`, data: { target } }] : [];
    };
    const onUnseatDragMove = (event) => {
        if (event.active?.data?.current?.type !== UNSEATED_DRAG_TYPE) return;
        const target = event.collisions?.[0]?.data?.target ?? null;
        setSeatTarget((prev) => (sameTarget(prev, target) ? prev : target));
    };
    const onUnseatDragCancel = () => {
        rowPointerRef.current = null;
        setSeatTarget(null);
    };
    const onUnseatDragEnd = (event) => {
        const data = event.active?.data?.current;
        if (data?.type !== UNSEATED_DRAG_TYPE) return;
        const target = event.collisions?.[0]?.data?.target ?? null;
        onUnseatDragCancel();
        seatUnseated(Number(data.row?.id), target);
    };
    const forgetPending = (reqId) => setPendingSeats((prev) => {
        if (!prev.has(reqId)) return prev;
        const next = new Set(prev);
        next.delete(reqId);
        return next;
    });
    const seatUnseated = async (reqId, target) => {
        if (!target?.ok || !Number.isFinite(reqId) || reqId <= 0) return;
        setPendingSeats((prev) => new Set(prev).add(reqId));
        // req #3817 — just un-orchestrated from the canvas (its DELETE is
        // written, or the row could not be lifted): the unseat no longer
        // describes it. It becomes a move to the step it now joins, so the
        // canvas draws it there at once — not back on its old step while the
        // plan's read still lists it — and settles the same way a move does.
        const unseat = dragWorldRef.current?.pendingMoves
            .find((m) => m.toStepId == null && m.reqId === reqId);
        const carried = unseat
            ? { reqId, fromStepId: unseat.fromStepId, toStepId: target.stepId } : null;
        if (carried) setPendingMoves((ms) => ms.map((m) => (m === unseat ? carried : m)));
        const junctionKey = pipelineStepRequirementKeys.all(profile?.userName);
        try {
            // The one seat write (`moveStepRequirement`, req #3581) with no
            // `fromStepId`: a requirement in this box has no seat to vacate
            // (the junction keys on `requirement_fk` alone), so it is a plain
            // INSERT. One seated by somebody else since the box last read
            // answers 409, and the snackbar plus the junction re-read below
            // put the row right.
            await moveStepRequirement(darwinUri, idToken,
                { requirementId: reqId, toStepId: target.stepId });
        } catch (error) {
            showError(error, `Unable to add ${reqId} to the step`);
            if (carried) setPendingMoves((ms) => ms.filter((m) => m !== carried));
            forgetPending(reqId);
            queryClient.invalidateQueries({ queryKey: junctionKey });
            return;
        }
        if (carried) {
            carried.writtenRows = serverRowsRef.current;
            setPendingMoves((ms) => [...ms]);
        }
        // Held hidden until the refetches land, so the row leaves the box once
        // and the card gains it once — never a flash back in between.
        await Promise.allSettled([
            queryClient.invalidateQueries({ queryKey: pipelineComposeKeys.byId(pipeline?.id) }),
            // The junction prefix also refreshes the requirement page's
            // Orchestration box, which reads the same factory list.
            queryClient.invalidateQueries({ queryKey: junctionKey }),
        ]);
        forgetPending(reqId);
    };

    // ── The whole box dropped on a step (req #3608) ─────────────────────────
    // The box's title-bar move is the box's own pointer gesture, so it reports
    // the pointer itself. The pointer is over the BOX, so the card it is aimed
    // at is whatever lies beneath it (`seatTargetAtPoint` through the box).
    const boxSeatTargetAt = (clientX, clientY) => seatTargetAtPoint(clientX, clientY, true);
    const onBoxMoveOver = (clientX, clientY) => {
        boxPointerRef.current = clientX == null || clientY == null
            ? null : { x: clientX, y: clientY };
        const target = boxSeatTargetAt(clientX, clientY);
        setSeatTarget((prev) => (sameTarget(prev, target) ? prev : target));
    };
    reseatRef.current = () => {
        const box = boxCarrying ? boxPointerRef.current : null;
        const row = rowPointerRef.current;
        if (!box && !row) return;
        const target = box ? boxSeatTargetAt(box.x, box.y) : seatTargetAtPoint(row.x, row.y, false);
        setSeatTarget((prev) => (sameTarget(prev, target) ? prev : target));
    };
    // Returns whether the drop was a seat — the box goes back to where it was
    // when it is — and asks before writing anything.
    const onBoxMoveDrop = (clientX, clientY) => {
        const req = bulkSeatRequest(unseatedItems, boxSeatTargetAt(clientX, clientY), rowById);
        boxPointerRef.current = null;
        setSeatTarget(null);
        if (!req) return false;
        if (!req.ok) {
            showError(`"${req.stepTitle}" is locked — it takes no new work`);
            return true;
        }
        setBulkSeat(req);
        setBulkSeatOpen(true);
        return true;
    };
    const commitBulkSeat = async () => {
        const req = bulkSeat;
        // `bulkSeat` outlives the close (the exit transition), so a closing
        // dialog must be refused here too, or a second click re-runs every write.
        if (!req || bulkSeating || !bulkSeatOpen) return;
        const ids = req.reqs.map((r) => r.id);
        setBulkSeating(true);
        setPendingSeats((prev) => {
            const next = new Set(prev);
            for (const id of ids) next.add(id);
            return next;
        });
        // The same one-row seat write a single drop makes, a few at a time:
        // every requirement in the box has no seat to vacate, so each is a
        // plain INSERT, and one seated elsewhere since the box last read
        // answers 409 without stopping the rest.
        const failed = await runBulkSeat(ids, (id) => moveStepRequirement(darwinUri, idToken,
            { requirementId: id, toStepId: req.stepId }), BULK_SEAT_CONCURRENCY);
        setBulkSeating(false);
        setBulkSeatOpen(false);
        const failure = bulkSeatFailureMessage(ids.length, failed);
        if (failure) showError(failure);
        const junctionKey = pipelineStepRequirementKeys.all(profile?.userName);
        await Promise.allSettled([
            queryClient.invalidateQueries({ queryKey: pipelineComposeKeys.byId(pipeline?.id) }),
            queryClient.invalidateQueries({ queryKey: junctionKey }),
        ]);
        setPendingSeats((prev) => {
            const next = new Set(prev);
            for (const id of ids) next.delete(id);
            return next;
        });
    };
    const closeBulkSeat = () => { if (!bulkSeating) setBulkSeatOpen(false); };

    const seatTargetNode = seatTarget ? drawLayout.nodes.get(seatTarget.stepId) : null;
    const seatTargetRect = seatTargetNode ? screenRectOf(seatTargetNode, t) : null;

    const chipBg = rgba(P.panel, INITIATIVE_CHIP_BG_ALPHA);

    // ── THE REQUIREMENT-COUNT BADGE, AS AN HTML OVERLAY (req #3503, round 4)
    // ─────────────────────────────────────────────────────────────────────
    // Three rounds of Konva `<Text>` — hand-fighting canvas's `textBaseline:
    // 'middle'`, which centres the font's own em box rather than the glyph's
    // ink — never converged on true centring, because canvas has no real
    // vertical-centring primitive. CSS flexbox does, and this file already
    // reaches for it for exactly this reason: `floatingInitiatives` above is the
    // SAME move for the initiative chip's own controls. Screen position is a plain
    // world→screen projection through `t` (`x*t.k + t.x`), no placement pass
    // needed — unlike the initiative chip there is no lane-fit, no clamp, no
    // collision to resolve, because a badge answers for exactly one card and
    // never competes with a neighbour for room.
    // req #3695 — a card's HTML controls fade with its card while its initiative's
    // fold animates, and take no clicks until it lands. Null when settled.
    const foldStyle = (l) => (l.reveal == null ? null
        : { opacity: foldContentAlpha(l.reveal), pointerEvents: 'none' });
    const floatingBadges = drawLayout.labels
        .filter((l) => l.kind === 'badge' && drawsKind('badge'))
        .map((l) => ({
            key: `badge-${l.stepId}`,
            // req #3503 — the STEP'S OWN id, carried on the label the layout
            // already emits (`pipelinePlanLayout.js` sets `stepId: r.id` on every
            // badge). No lookup is invented here: the badge counts one step's
            // requirements, so the step it answers for is the one whose id it
            // already had to know to be positioned at all.
            stepId: l.stepId,
            left: l.x * t.k + t.x,
            top: l.y * t.k + t.y,
            width: l.w * t.k,
            height: l.h * t.k,
            fontSize: CARD_BADGE_FONT * t.k,
            text: l.text,
            fold: foldStyle(l),
        }));

    // ── THE RUN-MODE PILL, AS AN HTML OVERLAY (req #3580) ──────────────────
    // A button, so it is HTML for the badge's reason (and rides the badge's
    // layer, inset under the ruler the same way). The layout reserved its box
    // in the card's title row (`CARD_RUN_W`); this only projects it to screen.
    // A pending write draws the mode being WRITTEN, so the click answers now.
    const floatingRuns = drawLayout.labels
        .filter((l) => l.kind === 'run' && drawsKind('run'))
        .map((l) => ({
            key: `run-${l.stepId}`,
            stepId: l.stepId,
            run: runPending.get(l.stepId) ?? l.run,
            pending: runPending.has(l.stepId),
            left: l.x * t.k + t.x,
            top: l.y * t.k + t.y,
            width: l.w * t.k,
            height: l.h * t.k,
            fontSize: CARD_RUN_FONT * t.k,
            fold: foldStyle(l),
        }));

    // ── THE BARRIER GATE, AS AN HTML OVERLAY (req #3673) ───────────────────
    // A button, so HTML for the run pill's reason, on the run pill's layer —
    // and for the picture: a real icon (`PlanStepFlagIcons.jsx`) rather than
    // the stroked ⚑ req #3649 drew in Konva, which the user could not read.
    // The layout reserved its box in the control column; this only projects it
    // to screen. (The padlock beside it went in req #3742 — a locked step's
    // card has a red perimeter instead.)
    const floatingFlags = drawLayout.labels
        .filter((l) => l.kind === 'barrier' && drawsKind(l.kind))
        .map((l) => ({
            key: `${l.kind}-${l.stepId}`,
            kind: l.kind,
            stepId: l.stepId,
            on: !!l.on,
            left: l.x * t.k + t.x,
            top: l.y * t.k + t.y,
            size: l.w * t.k,
            fold: foldStyle(l),
        }));

    // ── THE STEP CARD'S COLLAPSE HEAD, AS AN HTML OVERLAY (req #3650) ──────
    // A button, so HTML for the run pill's reason, on the run pill's layer. The
    // layout reserved its box at the title line's left (`CARD_COLLAPSE_W`,
    // req #3648); this only projects it to screen.
    const floatingCollapses = drawLayout.labels
        .filter((l) => l.kind === 'collapse' && drawsKind('collapse'))
        .map((l) => ({
            key: `collapse-${l.stepId}`,
            stepId: l.stepId,
            open: !l.collapsed,
            text: l.text,
            left: l.x * t.k + t.x,
            top: l.y * t.k + t.y,
            width: l.w * t.k,
            height: l.h * t.k,
            fontSize: CARD_COLLAPSE_FONT * t.k,
            fold: foldStyle(l),
        }));

    // ── THE STEP-NAME EDITOR'S BOX (req #3580) ──────────────────────────────
    // The name's own world rect, widened to the whole room the layout reserved
    // for it (`editW`, up to the control cluster's gap), projected through `t`. Only while
    // that step's name is actually drawn — an editor floating where no name is
    // would be editing something the reader cannot see.
    const stepEditLabel = stepEdit != null && drawsKind('step')
        ? drawLayout.labels.find((l) => l.kind === 'step' && l.stepId === stepEdit.stepId)
        : null;
    const stepEditRow = stepEditLabel ? rowById.get(stepEditLabel.stepId) : null;
    const stepEditor = stepEditLabel && stepEditRow ? {
        row: stepEditRow,
        left: stepEditLabel.x * t.k + t.x,
        top: stepEditLabel.y * t.k + t.y,
        width: (stepEditLabel.editW ?? stepEditLabel.w) * t.k,
        height: CARD_LINE_H * t.k,
        fontSize: CF.label * t.k,
    } : null;

    // ── World-space nodes ───────────────────────────────────────────────────
    const worldNodes = [];
    // ── Sticky ruler-strip nodes (req #3254) ────────────────────────────────
    // The baseline, the tick marks and the slot date/future/undated labels —
    // everything that reads as "the header" — draw in a SEPARATE Konva Group
    // (below) whose y is `stickyRulerY(t)` rather than `t.y`, so the strip
    // pins to the top of the viewport instead of scrolling off with the
    // timeline beneath it. The full-height separators and the future-region
    // tint stay in `worldNodes`: they are background guides spanning the
    // whole plan's vertical extent, not the header itself, and belong to the
    // content they mark rather than to viewport chrome.
    const stickyRulerNodes = [];

    drawLayout.bands.forEach((band) => {
        // req #3695 — A FOLDED INITIATIVE HAS NO RECTANGLE: its floating title bar
        // (the chip) is all of it, so it gives way to the initiatives that are open.
        // Mid-fold the box is drawn at the band's animated height and its wash
        // and outline come in (or go out) with it, so the rectangle visibly
        // grows out of the title bar and back into it.
        const rv = band.reveal ?? (band.collapsed ? 0 : 1);
        if (rv > 0) {
            worldNodes.push(
                <Rect key={`band-${band.key}`} x={2} y={band.y} width={drawLayout.width - 4}
                      height={band.height} cornerRadius={8}
                      fill={band.color} opacity={0.06 * rv} />,
                <Rect key={`bandstroke-${band.key}`} x={2} y={band.y} width={drawLayout.width - 4}
                      height={band.height} cornerRadius={8}
                      stroke={band.color} strokeWidth={1} opacity={0.35 * rv} />);
        }
        const wireAlpha = foldContentAlpha(rv);
        for (let l = 0; l < band.sub; l++) {
            // band.laneY, not l × pitch — lanes have individual heights since
            // req #3119 and a constant-pitch wire would drift off its cards.
            //
            // req #3498 — HALF THE LANE'S TALLEST CARD, not a fixed offset from
            // the lane's top. The wire's whole job is to run through the things
            // it connects, and what it connects are now boxes joined at their
            // edge MIDPOINTS. `band.laneCardH` is the same map `lanePitch` sized
            // the lane from, so the wire and the arcs read one number: a literal
            // here is exactly the "two copies that only have to agree" the old
            // `BEAD_LANE_OFFSET` naming existed to prevent.
            //
            // Cards in a lane are CENTRE-aligned (see the node block in
            // pipelinePlanLayout.js), so this is every card's midpoint in the
            // lane, not just the tallest one's — the wire runs through all of
            // them and through every same-lane arc.
            // `|| MIN_CARD_H` and NOT `|| 0`: the two fallbacks have to be the
            // same one `lanePitch` used, or an unmapped lane would put its wire
            // at the lane's TOP while the pitch reserved a card's height for it
            // — the "two copies that only have to agree" failure this shared
            // map exists to prevent. Unreachable in practice (the renumber
            // leaves no empty lane), which is exactly why it must not be wrong.
            const wy = band.y + band.headerH + band.laneY[l]
                + (band.laneCardH?.get(l) ?? MIN_CARD_H) / 2;
            worldNodes.push(
                <Line key={`wire-${band.key}-${l}`}
                      points={[36, wy, drawLayout.width - 14, wy]}
                      stroke={P.wire} strokeWidth={1.2} opacity={0.18 * wireAlpha} />);
        }
    });

    // ── The time ruler (req #3207, sticky since req #3254) ──────────────────
    // Drawn AFTER the band washes and BEFORE the arcs and beads: the rules and
    // the future tint are background furniture that must sit over the band fill
    // (a 6% wash would otherwise swallow them) and under everything a reader
    // actually reads. The label TEXT is not here — it rides `layout.labels` as
    // `kind: 'slot'` so the zero-overlap contract covers it, and is drawn in the
    // label loop below with every other piece of text on the surface — into
    // `stickyRulerNodes`, same as the baseline and ticks here, not `worldNodes`.
    {
        const R = drawLayout.ruler || { h: 0, slots: [], futureX: null };
        // The FUTURE REGION, first, so the rules draw on top of its edge. A rule
        // alone says where the boundary is; it does not say which side of it has
        // not happened yet. WORLD space — it tints the whole plan's height, not
        // just the header strip.
        if (R.futureX != null && R.futureX < drawLayout.width) {
            worldNodes.push(
                <Rect key="ruler-future" x={R.futureX} y={0}
                      width={drawLayout.width - R.futureX} height={drawLayout.height}
                      fill={P.wire} opacity={0.07} listening={false} />);
        }
        // The strip's OWN opaque backing (req #3254, code-review finding): once
        // pinned, the strip floats over whatever band content scrolled up to
        // meet it, and neither the ticks nor the date text otherwise carry any
        // fill — so without this a date could render as text bleeding through
        // a step title rather than legibly over it. Same colour and the same
        // "chrome gets its own opaque plate" move as the shared top time-axis
        // in `KonvaSwarmCanvas.jsx` (`background: C.axisBg`), the truer sibling
        // of this strip than the per-row day headers (which float with no
        // backing because they are never more than one line of text wide).
        //
        // ── AND IT IS AS TALL AS THE TYPE IT BACKS (req #3365 user directive:
        //    "as the pipeline is moved to see the lower initiatives, the pipeline
        //    visualized will scroll up and go below the time part which is
        //    still transparent and this causes clutter") ────────────────────
        // The plate did exist and it did not work, for a reason that only
        // appeared when req #3365 pinned the date TYPE to a fixed screen size:
        // the type stopped scaling with `t.k` and the plate did not. At the
        // scale plan 7 opens in (k = 0.2077) the plate was `36 · k` = **7.5px**
        // of screen height under **13px** of text, so two thirds of every date
        // hung below its own backing, over live beads and arcs — the clutter
        // the directive names, and worse than no plate at all because the plate
        // made the top third look deliberate.
        //
        // `rulerScreenMag(t)` is the SAME counter-scale the type uses, applied
        // to the strip's vertical geometry — the plate here, the baseline, the
        // ticks, and the label `y` in the label sweep below. That makes the
        // strip's vertical axis SCREEN space and its horizontal axis WORLD
        // space, which is exactly what it should be: it is chrome downward and
        // an axis sideways, so it keeps tracking the columns as the reader pans
        // and zooms (the directive's "I like how/where it sits/scrolls so don't
        // change that") while never again being thinner than its own contents.
        //
        // THE ONE COST, disclosed rather than discovered: at k < 1 the strip
        // covers `RULER_H / k` WORLD px instead of `RULER_H`, and the layout
        // reserves only `RULER_H` world px above the first band — so at low
        // zoom the plate now hides the top of band 0's header where before it
        // hid a sliver. What is in that region at those scales is nothing: step
        // labels are below `K_READABLE` and undrawn, and the initiative names are
        // HTML chips already clamped below `rulerScreenBottom(t)`. At k ≥ 1,
        // where that region does hold drawn text, `rulerScreenMag` is 1 and the
        // geometry is bit-for-bit what it was.
        // REPAID BY req #3648: below k = 1 the strip now hangs from its BOTTOM
        // edge (`stickyRulerY`) and the base view pulls the plan down by the
        // excess, so on landing/Default it no longer hides band 0's header —
        // that hidden header is what parked the top initiative's name on its cards.
        const rulerMag = rulerScreenMag(t);
        stickyRulerNodes.push(
            <Rect key="ruler-sticky-bg" x={0} y={0} width={drawLayout.width}
                  height={R.h * rulerMag}
                  fill={P.panel} listening={false} />);
        // The strip's baseline — what makes the ticks read as one ruler rather
        // than as a row of unrelated marks. STICKY: part of the header itself.
        stickyRulerNodes.push(
            <Line key="ruler-baseline"
                  points={[0, (R.h - 2) * rulerMag,
                      drawLayout.width, (R.h - 2) * rulerMag]}
                  stroke={P.line} strokeWidth={rulerMag} opacity={0.7}
                  listening={false} />);
        R.slots.forEach((s, i) => {
            // A GAPPED boundary is DASHED and brighter. Slots are dense in
            // COLUMNS but sparse in TIME — 07-28 and 07-31 are adjacent columns
            // three days apart — and the dashes are how the ruler says so
            // without spending a second label on it. `gapDays` is null on the
            // first dated slot and on the undated/future ones, where there is no
            // predecessor to have skipped anything. WORLD space — the boundary
            // runs the whole plan's height, same reasoning as the future tint.
            const gapped = s.gapDays != null && s.gapDays > 1;
            // The first slot's rule would land in the left gutter, where it
            // marks nothing: there is no earlier slot for it to divide from.
            if (i > 0) {
                worldNodes.push(
                    <Line key={`ruler-rule-${s.key}`}
                          points={[s.x, 6, s.x, drawLayout.height - 6]}
                          stroke={gapped ? P.dim : P.line} strokeWidth={1}
                          dash={gapped ? [5, 5] : undefined}
                          opacity={gapped ? 0.5 : 0.55} listening={false} />);
            }
            // The tick itself, in the strip, at every slot — including the ones
            // whose LABEL was thinned away. The tick is 1px of geometry and can
            // never collide, so a degraded ruler still shows every boundary it
            // has; only the dates thin out. STICKY: part of the header strip,
            // so its LENGTH and its WEIGHT are screen-sized with the rest of it
            // (req #3365) while its `x` stays world — the tick has to keep
            // landing on the column boundary it marks. A tick counter-scaled on
            // both axes would drift off its own slot.
            stickyRulerNodes.push(
                <Line key={`ruler-tick-${s.key}`}
                      points={[s.x, (R.h - 9) * rulerMag,
                          s.x, (R.h - 2) * rulerMag]}
                      stroke={P.dim} strokeWidth={rulerMag} opacity={0.8}
                      listening={false} />);
        });
    }

    drawLayout.arcs.forEach((arc, i) => {
        // req #3695 — an arc into a card mid-fold fades with the card; full
        // opacity everywhere else, exactly as before.
        const arcAlpha = foldContentAlpha(arc.reveal);
        if (arcAlpha <= 0) return;
        if (arc.straight) {
            worldNodes.push(
                // FULL OPACITY and a slightly heavier stroke (req #3365 user
                // directive). `P.arc` carries the contrast half of that fix;
                // this is the other half — an 8.3:1 colour drawn at 0.85 is a
                // 6.9:1 line, and the arcs were already the faintest marks on a
                // panel whose beads and bands are both brighter.
                <Line key={`arc-${i}`} points={[arc.x1, arc.y1, arc.x2, arc.y2]}
                      stroke={P.arc} strokeWidth={1.4} opacity={arcAlpha}
                      listening={false} />);
        } else {
            worldNodes.push(
                <Path key={`arc-${i}`} data={arc.path} stroke={P.arc} opacity={arcAlpha}
                      strokeWidth={1.4} listening={false} />);
        }
    });

    // The next-step halo's magnification for THIS frame (req #3271). Computed
    // once per render rather than per row: it depends only on the scale being
    // drawn at, and `dash` is an array prop — a fresh one per bead would hand
    // react-konva a changed reference for every halo on every frame of a zoom.
    //
    // IT IS ASKED WHETHER THE LABELS ARE DRAWN, AGAIN (req #3324). #3271 asked,
    // #3280 stopped asking because both sides turned on `K_READABLE` and the
    // guarantee (a magnified mark never sits under a drawn label) followed by
    // arithmetic — and #3324's pinned level, which draws its labels at EVERY
    // scale, is exactly the case that arithmetic no longer covers. The step
    // #3280 deleted does not come back: `nextHaloMagnify` is already 1 at every
    // legible `k`, and Auto never draws a label below that, so the argument
    // changes nothing during a wheel. See the function's own docstring.
    //
    // NOT a `useMemo`, and it cannot become one: the `!rows.length` early return
    // above sits between this and the last hook, so a hook here would be
    // conditional. At m === 1 the shared constant is returned by reference and
    // nothing is allocated at all; above it the array is rebuilt per render,
    // which costs one `setAttr` on a layer the halo animation is already
    // redrawing every frame.
    //
    // THAT BAND IS WIDER SINCE req #3280 — m > 1 used to mean level 'out' and
    // now means every k below `K_READABLE`, so the rebuild happens through the
    // whole of the zoomed-out range rather than only at Overview. Same cost per
    // render on the same already-animating layer; noted because the sentence
    // above was written when the band was narrower and would otherwise read as
    // a smaller claim than it is.
    // `curK`, not `t.k` — the same number, deliberately read from the same
    // expression the level resolution reads. The invariant is "the scale the halo
    // sizes itself against is the scale Auto's demotion is judged on", and two
    // expressions that agree today are how that quietly stops being true.
    // req #3299 — below the ring's reach (`nextHaloMagnify`'s ceiling is
    // already maxed out, so the ring's ON-SCREEN size resumes shrinking with
    // `curK`), a DIFFERENT MARK takes over: a filled dot, counter-scaled so
    // its screen size is fixed rather than a world size the camera shrinks.
    // See `nextMarkIsDot`/`nextMarkDotRadius` in pipelinePlanLayout.js for the
    // derivation. Decided BEFORE `haloM`/`haloDash` so those — unused on the
    // dot branch, and `NEXT_HALO_DASH.map` allocates a fresh array every frame
    // on the capped branch this replaces — are only computed for the branch
    // that needs them.
    // ONE ANSWER, ASKED ONCE, and handed to both marks — `drawsKind('step')` is
    // the same call the label loop below makes, so the mark and the labels cannot
    // disagree about whether there is room (req #3324).
    const labelsDrawn = drawsKind('step');
    // req #3498 — WHETHER THE CARD IS PAINTED. The same predicate as the step
    // label, deliberately: the card exists to hold that label and the
    // requirement rows, so a level that draws the text and not its container,
    // or the reverse, is not a level anyone asked for.
    const drawsCard = labelsDrawn;
    const haloIsDot = nextMarkIsDot(curK, labelsDrawn);
    const haloM = haloIsDot ? 1 : nextHaloMagnify(curK, labelsDrawn);
    const haloDash = haloIsDot || haloM === 1 ? NEXT_HALO_DASH
        : NEXT_HALO_DASH.map((d) => d * haloM);
    const dotRadius = haloIsDot ? nextMarkDotRadius(curK) : 0;
    // ── ONE MARK PER CLUSTER (req #3498, user directive) ────────────────────
    // The deep-zoom-out dot holds a fixed SCREEN size, so at the scale this plan
    // lands at its world radius is larger than the gap between two eligible
    // cards and N marks drew as one blob. `clusterNextMarks` merges the ones
    // that would overlap; the loop below skips their individual dots and the
    // merged marks are pushed after it, each carrying how many steps it stands
    // for. Only the DOT branch clusters — the ring and the card outline are
    // both bound to geometry that cannot overlap a neighbour's.
    const dotClusters = (!drawsCard && haloIsDot)
        ? clusterNextMarks(rows.filter((r) => {
            const n = drawLayout.nodes.get(r.id);
            // Not for a card mid-fold (req #3695): its dot returns as it lands.
            return n && n.reveal == null && eligibleStepIds.has(r.id);
        }).map((r) => {
            const n = drawLayout.nodes.get(r.id);
            return { id: r.id, x: n.x, y: n.y, suppressed: r.launchSuppressed };
        }), dotRadius)
        : null;

    // req #3695 — whatever a card mid-fold pushed onto the world is wrapped in
    // ONE Group carrying the card's fade, rather than an opacity threaded
    // through every mark it draws: the card, its halo, its rows and its text
    // fade together because they are one thing. Settled layouts carry no
    // reveal, so this never wraps anything outside an animation.
    // Clipped to the band's animated box, so the box REVEALS its cards as it
    // grows and swallows them as it shrinks — nothing hangs over the next initiative.
    const fadeFoldFrom = (mark, node, key) => {
        const reveal = node?.reveal;
        if (reveal == null || reveal >= 1 || worldNodes.length === mark) return;
        const items = worldNodes.splice(mark);
        const band = drawLayout.bands[node.bandIndex];
        const clip = band ? { clipX: 0, clipY: band.y, clipWidth: drawLayout.width,
            clipHeight: band.height } : null;
        worldNodes.push(
            <Group key={`fold-${key}`} opacity={foldContentAlpha(reveal)} {...clip}>
                {items}
            </Group>);
    };
    const drawRow = (row) => {
        const n = drawLayout.nodes.get(row.id);
        if (!n) return;
        const style = beadStyle(row, eligibleStepIds.has(row.id), row.launchSuppressed);
        // ── Highlight for next steps (req #3168) ────────────────────────────
        // Drawn BEFORE the bead so the halo sits under it, and at EVERY zoom
        // level including 'out' — a 2.5px ring is the only thing that used to
        // mark a launchable step, and at Overview it is a pixel of a green that
        // the Complete fill already owns. The one question a plan view is opened
        // to answer should be answerable at the level you open it in.
        //
        // req #3226 — `style.haloColor` is red instead of the eligible green
        // when the engine says this step's launch is SUPPRESSED (a paused
        // scope): the ring beneath it stays green (still eligible), so the
        // two together read as "eligible, but held", not "about to run".
        //
        // req #3271 — EMITTING it at 'out' was never the same as it reading
        // there. This Group is scaled by `t.k` and Konva scales stroke and dash
        // with it, so on the live plan Overview drew a 0.8px stroke with 1.2px
        // dashes: present in the scene graph, absent on the screen. `haloM`
        // magnifies the whole mark — radius, stroke and dash by ONE factor, so
        // its shape is invariant — into the room the labels vacate below the
        // legibility scale. It is exactly 1 wherever the labels ARE drawn, so
        // 'in' and the readable half of 'mid' are untouched.
        //
        // req #3280 — and it reaches that 1 by ARRIVING at it rather than by
        // switching to it. The room opens where `labelsLegible` closes the
        // labels, so the magnification's target is the mark's own size at that
        // scale and the two branches meet. See `nextHaloMagnify`.
        if (style.next) {
            // req #3299 — the dot does NOT recolour the bead: it is its own
            // node, in the halo's own colour, replacing only the RING's
            // geometry below the floor the ring itself cannot reach. The
            // bead's fill (state) and ring (run mode) below still draw at
            // their own — now sub-pixel — world size, untouched.
            //
            // req #3498 — WHERE THERE IS A CARD, THE HALO IS THE CARD'S OWN
            // OUTLINE. A ring sized to a bead, drawn at the centre of a
            // 406px-wide card, would mark the middle of the card's requirement
            // rows rather than the card — so the mark follows the shape the
            // level is actually drawing. It keeps the halo's colour, dash and
            // opacity, which are what carry the meaning; only the geometry
            // changes. The magnification is NOT applied to it: `haloM` exists
            // to grow a bead-sized mark into the room the labels vacate, and
            // at this level the labels are drawn and `haloM` is already 1.
            worldNodes.push(drawsCard ? (
                <Rect key={`next-${row.id}`} name="next-halo"
                      x={n.frameLeft - NEXT_HALO_STROKE} y={n.top - NEXT_HALO_STROKE}
                      width={n.frameW + 2 * NEXT_HALO_STROKE}
                      height={n.h + 2 * NEXT_HALO_STROKE}
                      cornerRadius={CARD_RADIUS + NEXT_HALO_STROKE}
                      stroke={style.haloColor} strokeWidth={NEXT_HALO_STROKE}
                      opacity={NEXT_HALO_OPACITY} dash={NEXT_HALO_DASH}
                      listening={false} />
            ) : haloIsDot ? (
                // Drawn by the cluster pass after this loop — see `dotClusters`.
                null
            ) : (
                <Circle key={`next-${row.id}`} name="next-halo" x={n.x} y={n.y}
                        radius={NEXT_HALO_RADIUS * haloM} stroke={style.haloColor}
                        strokeWidth={NEXT_HALO_STROKE * haloM} opacity={NEXT_HALO_OPACITY}
                        dash={haloDash} listening={false} />
            ));
        }
        // ── THE CARD, OR THE BEAD (req #3498) ───────────────────────────────
        // L1 draws today's bead, unchanged, on the user's own directive. L2 and
        // L3 draw the card, and the bead is not drawn at all there — a circle at
        // the card's centre would sit squarely on the requirement rows the card
        // exists to show.
        //
        // THE LAYOUT'S GEOMETRY IS THE SAME AT ALL THREE LEVELS: `n.left/top/w/h`
        // is the card's box whether or not the card is painted, the arcs anchor
        // on its edge midpoints either way, and nothing here measures a box of
        // its own. So crossing a level changes WHAT IS DRAWN and never WHERE
        // anything is — this module's oldest invariant, and the reason the bead
        // may not simply move somewhere more convenient at L2.
        if (drawsCard) {
            worldNodes.push(
                // ── WHAT PULSES IS THE STATE BAR, NOT THE CARD (req #3498) ──
                // The Running pulse drives OPACITY 0.45 -> 1.0 twice a second.
                // On the bead that animated a 314px² dot; on the Group it
                // animated the card's whole 30,000px² body — the panel fill, the
                // rule and the ✓ — while the step name and the requirement rows,
                // which are pushed later in the label loop, stayed fully opaque.
                // The result was a card whose BACKGROUND strobed, revealing the
                // lane wire and any arc behind it, under motionless text. The
                // bar is the card's state channel, so pulsing it says the same
                // thing the bead's pulse said, in the same place the colour is.
                <Group key={`card-${row.id}`}>
                    <Rect x={n.frameLeft} y={n.top}
                          width={n.frameW} height={n.h}
                          cornerRadius={CARD_RADIUS}
                          fill={P.panel} stroke={style.frame}
                          strokeWidth={style.frameWidth}
                          name={row.effectiveLocked ? 'locked-frame' : undefined} />
                    {/* The state bar — see CARD_STATE_BAR_W. It sits BESIDE the
                        frame on the LEFT, in the strip `CARD_W` reserves for
                        it, so it never crowds the lettering (user directive).
                        Free-standing, it takes its own full-height rounded
                        ends. Always the FRAME's colour (req #3775); it pulses
                        while the step runs. */}
                    <Rect name={style.pulse ? 'pulse-bead' : undefined}
                          x={n.left} y={n.top}
                          width={CARD_STATE_BAR_W} height={n.h}
                          cornerRadius={CARD_STATE_BAR_W / 2}
                          fill={style.bar} listening={false} />
                    {/* *"Separate the step name with a horizontal line"* — the
                        rule under the title area, inset to the text column so it
                        reads as a divider and not as a second border. */}
                    <Line points={[
                        n.frameLeft + CARD_PAD_X,
                        n.top + n.titleH + CARD_RULE_GAP,
                        n.frameLeft + n.frameW - CARD_PAD_X,
                        n.top + n.titleH + CARD_RULE_GAP,
                    ]} stroke={P.line} strokeWidth={1} listening={false} />
                    {/* req #3676 — the COMPLETE LINE between the step's open and
                        complete requirements, under every colour key. At the
                        y of the packing the rows are drawn at: titles at L3,
                        bare ids at L2. */}
                    {n.doneRule && (
                        <Line points={[
                            n.frameLeft + CARD_PAD_X,
                            level === 'in' ? n.doneRule.y : n.doneRule.idY,
                            n.frameLeft + n.frameW - CARD_PAD_X,
                            level === 'in' ? n.doneRule.y : n.doneRule.idY,
                        ]} stroke={P.dim} strokeWidth={1} dash={CARD_DONE_RULE_DASH}
                              opacity={CARD_DONE_RULE_OPACITY}
                              name="done-rule" listening={false} />
                    )}
                </Group>);
        } else {
            worldNodes.push(
                <Group key={`bead-${row.id}`} name={style.pulse ? 'pulse-bead' : undefined}>
                    {/* THE LEADERS (req #3498). The arcs anchor on the CARD's
                        edge midpoints at every level, and at L1 the card is not
                        painted — so without these the wire would stop a half
                        card short of the bead on each side and the plan would
                        read as a field of disconnected dots. They are drawn in
                        the arc's own colour, at the bead's own y, so bead,
                        leader and arc are one continuous line. */}
                    <Line points={[n.left, n.y, n.right, n.y]}
                          stroke={P.arc} strokeWidth={1.4} listening={false} />
                    <Circle x={n.x} y={n.y} radius={BEAD_RADIUS}
                            fill={style.fill} stroke={style.ring}
                            strokeWidth={style.ringWidth} />
                    {style.check && (
                        <Text x={n.x - 4} y={n.y - 4.5} text="✓" fontSize={F.check}
                              fill={P.doneCheck} listening={false} />
                    )}
                </Group>);
        }
        // ── HOVER IS THE WHOLE CARD; ACTIVATE IS THE TITLE AREA ─────────────
        // ACTIVATE OPENS THE STEP'S SINGLE EDITOR, OVER THE CANVAS (req #3742,
        // user directive: "single click of initiative and step to take you to the
        // single editor") — exactly what a quick click on its name does. It framed the step on
        // this canvas from req #3641 until then; the double click on the name
        // still zooms.
        //
        // The split req #3213 drew still stands: HOVER takes the whole card;
        // ACTIVATE takes the TITLE AREA, so a click on open card between the
        // requirement rows does not move the camera. The requirement ROWS keep
        // their own `onActivate` (navigate to the requirement), below the rule,
        // outside this box. At L1 the bead's hit circle opens the editor too;
        // its radius is a LAYOUT constant since req #3213 — the label hit
        // regions below are pushed above these nodes, so the clearance between
        // the two is an invariant the layout tests assert.
        const stepHover = {
            onMouseEnter: (e) => cursorPointer(e, true),
            onMouseLeave: (e) => cursorPointer(e, false),
        };
        const stepActivate = {
            ...stepHover, onActivate: () => stepPressRef.current?.(row.id).onClick(),
        };
        if (drawsCard) {
            // Both regions are the FRAME's, not the node box's: the strip the
            // state bar stands in belongs to no control, and a hit rect drawn
            // over it would put a rounded card's corner radius on a box that is
            // a bar wider than the card.
            worldNodes.push(
                <Rect key={`hit-${row.id}`} x={n.frameLeft} y={n.top}
                      width={n.frameW} height={n.h} cornerRadius={CARD_RADIUS}
                      fill="transparent" {...stepHover} />,
                // From the NAME rightward since req #3648 put the collapse
                // head on the title line (the badge stood there until req
                // #3683): a near-miss beside the chevron must
                // not also activate the step (req #3650's own rule for the
                // head; since req #3641 activation frames the step on canvas).
                <Rect key={`hitact-${row.id}`}
                      x={n.frameLeft + CARD_PAD_X + CARD_COLLAPSE_W + CARD_COLLAPSE_GAP}
                      y={n.top + CARD_PAD_Y}
                      width={n.frameW - CARD_PAD_X - CARD_COLLAPSE_W - CARD_COLLAPSE_GAP}
                      height={n.titleH - CARD_PAD_Y}
                      fill="transparent" {...stepActivate} />);
        } else {
            worldNodes.push(
                <Circle key={`hit-${row.id}`} x={n.x} y={n.y} radius={BEAD_HIT_RADIUS}
                        fill="transparent" {...stepActivate} />);
        }
    };
    rows.forEach((row) => {
        const mark = worldNodes.length;
        drawRow(row);
        fadeFoldFrom(mark, drawLayout.nodes.get(row.id), `row-${row.id}`);
    });

    // ── THE DROP TARGET (req #3581) ─────────────────────────────────────────
    // The card a dragged requirement would land on, outlined in the panel's
    // accent and faintly washed — pushed after every card and before the label
    // loop, so the rows read through the wash. Its outline is screen-constant
    // (divided by `curK`), since a world-scaled stroke would vanish exactly when
    // the reader has zoomed out to reach a distant step. The box is the layout's
    // own frame, the same one `dropTargetAt` tests, so what lights up is what
    // the drop will hit — at every level, including Overview where the card
    // itself is not painted.
    const dropNode = dropStepId != null ? drawLayout.nodes.get(dropStepId) : null;
    if (dropNode) {
        const sw = 2.5 / curK;
        worldNodes.push(
            <Rect key="req-drop-target" x={dropNode.frameLeft - sw} y={dropNode.top - sw}
                  width={dropNode.frameW + 2 * sw} height={dropNode.h + 2 * sw}
                  cornerRadius={CARD_RADIUS + sw}
                  fill={rgba(P.accent, 0.08)} stroke={P.accent} strokeWidth={sw}
                  shadowColor={P.accent} shadowBlur={14 / curK} shadowOpacity={0.55}
                  listening={false} />);
    }

    // ── The merged next-step marks (req #3498) ──────────────────────────────
    // Pushed after the row loop so they sit above every bead, and counter-scaled
    // the same way the dot itself is: `nextMarkDotRadius` already returns a
    // world radius that lands at a fixed screen size, so the COUNT beside it
    // divides by `curK` for the identical reason. A count drawn at a world font
    // would be invisible at exactly the scale this mark exists for.
    if (dotClusters) {
        for (const c of dotClusters) {
            const color = c.suppressed ? PAUSE_PAUSED_COLOR : P.eligibleRing;
            worldNodes.push(
                <Circle key={`next-c${c.ids[0]}`} name="next-halo"
                        x={c.x} y={c.y} radius={dotRadius} fill={color}
                        opacity={NEXT_HALO_OPACITY} listening={false} />);
            if (c.ids.length > 1) {
                // Inside the dot, centred — the mark is big by construction at
                // this scale, so the number rides it rather than sitting beside
                // it where it would collide with the next cluster.
                const fs = NEXT_MARK_COUNT_FONT_PX / curK;
                const text = String(c.ids.length);
                worldNodes.push(
                    <Text key={`nextn-c${c.ids[0]}`}
                          x={c.x - (fs * 0.6 * text.length) / 2}
                          y={c.y - fs / 2}
                          text={text} fontSize={fs} fontFamily={MONO}
                          fontStyle="bold" fill={P.bg} listening={false} />);
            }
        }
    }

    // ── Hover regions on the TEXT (req #3213 D1/D2) ─────────────────────────
    // The words are the larger, more obvious target than the bead beside them,
    // and until req #3213 they did not listen at all — so hovering a step name
    // fell THROUGH to the dashed launch-unit rectangle underneath and produced
    // that rectangle's card where a step card was wanted. The rectangle left
    // with req #3371, and these regions stay: they are the reason a step name
    // answers with its own step at all.
    //
    // The region is the label's OWN world rect — the exact x/y/w/h
    // pipelinePlanLayout exports and the zero-overlap invariant already sweeps.
    // A hit target grown past its text is precisely how that invariant gets
    // broken silently, so nothing here is larger than the words it covers. The
    // TEXT stays `listening={false}`: one node answers for one label.
    const labelHit = (key, label, handlers) => (
        <Rect key={key} x={label.x} y={label.y} width={label.w} height={label.h}
              fill="transparent" {...handlers} />);

    // ── THE RULER'S TYPE IS SCREEN-SIZED (req #3365) ────────────────────────
    // `t.k` cancels the sticky Group's own scale, so `F.slot * rulerLabelMag`
    // lands at a constant `F.slot` PIXELS however far out the reader is zoomed.
    // The date strip is the one text on this canvas that is not about a step:
    // it is the axis every bead is read AGAINST, so it earns a fixed size where
    // the step and requirement labels — which belong to marks that shrink —
    // correctly do not.
    //
    // CLAMPED AT 1, so this only ever makes the type BIGGER. Past k = 1 the
    // world scale already exceeds the screen size we want and dividing would
    // start SHRINKING the labels below `F.slot` — the opposite of the
    // directive, and a second extreme in place of the one being removed.
    //
    // It is `rulerScreenMag(t)` and no longer a private `max(1, 1/t.k)` here:
    // the strip's plate, baseline and ticks are counter-scaled by the same
    // factor (see `stickyRulerNodes` above) and `rulerScreenBottom` reports the
    // resulting edge, so three call sites now share one derivation. A literal
    // in any of them would let the plate and the type it backs disagree about
    // their own size, which is exactly the defect req #3365 fixed.
    // ── LEAVING THIS PAGE CARRIES A WAY BACK (req #3498, user directive) ────
    // The steps-editor link is the one control here that leaves the plan, and it
    // left with no return: the reader landed in the Steps grid with the plan,
    // its panel and the camera they had set all to be found again by hand. This
    // is the SAME state the requirement links have carried since req #3252 —
    // `from`/`pipelineId`/`mode` — read by the receiving page to render its own
    // "Back to Plan". One vocabulary for every exit from this surface.
    const stepsBackState = pipeline?.id
        ? { state: planExitState(pipeline.id, 'plan') }
        : undefined;

    const rulerLabelMag = rulerScreenMag(t);
    // The layout's own greedy thinning rule, re-applied to the widths
    // counter-scaling actually produces (`drawnRulerLabelKeys`). Cheap — one
    // pass over the slots, which number in the handfuls.
    //
    // req #3793 — MAXIMIZED, the full screen switch sits in this strip's
    // upper-left corner, so it is the strip's first occupant: the pass starts
    // from its right edge (`maximizeSwitchWorldRight`), and a date that would
    // begin under it is thinned like any label with no room — back as soon as a
    // pan clears the corner. Not maximized, the pass starts from nothing.
    const visibleRulerLabels = drawnRulerLabelKeys(
        drawLayout.ruler?.slots || [], rulerLabelMag,
        (maximized && onToggleMaximized) ? maximizeSwitchWorldRight(t) : -Infinity);

    // req #3661 — the requirement title editor's box, found while its row is
    // drawn below (it needs the row's own pill packing to place line 1).
    let reqEditor = null;
    const drawLabel = (label, i) => {
        if (!drawsKind(label.kind)) return;
        if (label.kind === 'step') {
            // Wrapped at layout time (req #3498) — the step name takes a
            // second line before it truncates, exactly as a requirement row
            // does, because a 28-character line leaves it nineteen otherwise.
            // Not drawn while its in-place editor is open (req #3580): the
            // editor is one line and the name may be two, so the second line
            // would show through beneath it.
            if (stepEditor?.row.id !== label.stepId) {
                worldNodes.push(
                    <Text key={`lbl-${i}`} x={label.x} y={label.y}
                          text={(label.lines || [label.text]).join('\n')}
                          fontSize={CF.label} fontFamily={MONO} fill={P.text}
                          lineHeight={CARD_LINE_H / CF.label}
                          listening={false} />);
            }
            // HOVER ONLY — deliberately NOT the bead's third handler (review
            // finding). The bead's hit circle also carries `onActivate`, which
            // (until req #3641 made it frame the step instead) switched the
            // whole page to Table mode and, because the visualizer unmounted,
            // discarded the reader's pan and zoom. Mirroring it here
            // would grow the click-to-leave surface from 0.22% of the world to
            // 1.25% — measured on the live 97-step plan — and make the step
            // name the largest click target on the canvas, while the manual
            // hit-test tolerates 4px of drag before it stops calling a gesture
            // a click. D1 asks for the CARD; a click on the words did nothing
            // before this change.
            //
            // req #3580 — THE WORDS TAKE THREE GESTURES: a quick click opens
            // the step's single editor (req #3742; it framed the step before),
            // a double click zooms to it, a long press edits the name in place.
            // `pressStepId` is how the canvas's pointer listeners find them —
            // see the STEP-TITLE PRESSES block. None of the three leaves the
            // page: the editor opens over the canvas.
            const row = rowById.get(label.stepId);
            if (row) {
                worldNodes.push(labelHit(`lblhit-${i}`, label, {
                    pressStepId: row.id,
                    onMouseEnter: (e) => cursorPointer(e, true),
                    onMouseLeave: (e) => cursorPointer(e, false),
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
            // satisfied by the NEUTRAL POSITION, not overridden by it — by that
            // position rather than by the number of scales beside it, which is
            // why a third scale (req #3422) does not re-open the question:
            // neutral is a real position of the control, and a colour appears
            // only when a reader turns a key on and the key is on screen naming
            // the scale.
            // What that directive rejected was an unlabelled colour reading as
            // the STEP's status; `state` here is the REQUIREMENT's own status,
            // which is the fact the bead's aggregate was derived from.
            const rs = reqIdStyle({
                colorKey: activeColorKey,
                views: reqColorViews,
                reqId: label.reqId,
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
            // ── THE SECOND LINE IS L3's (req #3498, user directive) ─────────
            // The LAYOUT wrapped it and reserved the room at every level; this
            // only decides what goes in that room. At L2 the row is the bare id
            // on the first reserved line and the second sits empty — reserving
            // it either way is what keeps a level change a pure transform.
            // Joined with a newline and handed to ONE Konva.Text with an
            // explicit `lineHeight`, so the two lines cannot drift apart from
            // the box the overlap sweep measured.
            const reqLines = showTitle && Array.isArray(label.lines)
                ? label.lines : null;
            // req #3661 — a row whose title is open in its in-place editor
            // draws everything BUT the title (id, pills, separator): the editor
            // draws the title itself, in the room the layout gave it.
            const editingTitle = showTitle && reqEdit?.reqId === label.reqId
                && reqEdit?.stepId === label.stepId;
            const reqText = editingTitle
                ? `${label.idText ?? label.reqId}${' '.repeat(CARD_SEP_CHARS)}`
                : reqLines ? reqLines.join('\n')
                    : (showTitle ? label.text : (label.idText ?? label.text));
            // ── LEFT-ANCHORED, NOT CENTRED IN THE TITLE'S BOX (req #3498) ───
            // The id used to be centred inside the room the title reserved,
            // because the layout centred the title on the node's x. A card's
            // rows are LEFT-ALIGNED on one text column, so centring the id
            // inside a box whose width varies per requirement scattered the ids
            // across the card — measured, five ids at five different x inside
            // one card at L2, under a left-aligned step name. It also made each
            // id's click target a small box floating at that offset.
            const reqX = label.x;
            // ── PACKED TIGHT AT L1/L2, NOT SPREAD ACROSS THE TITLE'S ROOM
            // (req #3503 review: "bring all the numbers into a nice vertical
            // line up with no white space") ──────────────────────────────────
            // `label.y` is the TITLE-wrapped position — sized for what THIS row
            // would need at L3, which is 1-2 lines depending on the actual
            // title text — and using it for the bare id left the id sitting at
            // the top of a slot mostly empty below it, repeated down the card:
            // exactly the sparse, big-gapped list the review is about.
            // `label.idY` is the alternative the layout computes ALONGSIDE it
            // (never instead — see its own comment there): every row packed at
            // one line's pitch, regardless of what the corresponding title
            // would have wrapped to. The card's own height is UNCHANGED either
            // way — it is still sized off the title-wrapped total, so this
            // never resizes the card or moves a neighbour when the reader
            // crosses the L2/L3 line, only where the ids sit inside a box that
            // was always this tall.
            const reqY = showTitle ? label.y : label.idY;
            // ── THE ID→TITLE GAP IS 1.5 CHARACTERS (req #3683) ──────────────
            // The layout's text carries a two-space separator; everything after
            // the id — the title, its continuation lines, the pills, the editor
            // — is drawn `REQ_SEP_PULL` (half a character) further left, so the
            // gap reads as half the three spaces it was. The id itself stays on
            // the text column and is drawn as its own Text. A bare id (L1/L2
            // with no pills) has nothing after it to pull.
            const idStr = String(label.reqId);
            const pull = reqText.length > idStr.length ? REQ_SEP_PULL : 0;
            const restX = reqX - pull;
            // req #3581 — the mark the reader has picked up stays where it was,
            // GREYED OUT, until the drop: the copy riding the cursor is the
            // requirement in flight, and this is the hole it left.
            const lifted = reqDrag?.reqId === label.reqId;
            // ── THE TERMINAL / DEV SERVER PILLS (req #3587) ─────────────────
            // The layout put the tokens in the text and handed back their
            // character ranges on the first line. The row is drawn with those
            // characters BLANKED, and each pill — box and label — is drawn on
            // top in the room they reserved: box over the measured span, y
            // centred on the first line (Konva draws a line's glyphs
            // `middle`-baselined at half its line height), label centred in
            // the box. See `REQ_PILL_STYLE` for why the label is not the row's.
            const pillsHere = label.pills || [];
            const pillInfo = pillsHere.length ? (reqPills?.get?.(label.reqId) || null) : null;
            let rowText = reqText;
            let pillBoxes = [];
            // The first line's text AFTER the last pill, redrawn flush against
            // it (see the packing note below); null leaves it in the row Text.
            let rowTail = null;
            // req #3661 — the same packed position for a row whose title is
            // open in the editor: its tail is the blank separator alone, which
            // draws nothing, but the editor's line 1 starts where it ends.
            let editTail = null;
            if (pillsHere.length) {
                const rowLines = reqText.split('\n');
                const firstLine = rowLines[0];
                pillBoxes = pillsHere.map((pl, j) => {
                    const h = CF.req * REQ_PILL_H_EM;
                    const lead = pl.start === 0 ? 0
                        : measureReqText(firstLine.slice(0, pl.start), CF.req, rs.bold);
                    const span = measureReqText(firstLine.slice(pl.start, pl.start + pl.len),
                        CF.req, rs.bold);
                    const text = firstLine.slice(pl.start, pl.start + pl.len).replace(/\u00a0/g, ' ');
                    // Hug the label (see `REQ_PILL_LABEL_PAD_EM`), centred on the
                    // reserved span; unmeasurable → the span itself, as before.
                    const labelSize = CF.req * REQ_PILL_FONT_EM;
                    const labelW = measureReqText(text, labelSize, false,
                        `normal normal 600 ${labelSize}px ${REQ_PILL_FONT}`);
                    const spanW = span ?? pl.len * CHW_REQ;
                    const maxW = spanW + 2 * REQ_PILL_PAD_X;
                    const w = labelW == null ? maxW
                        : Math.min(maxW, labelW + 2 * labelSize * REQ_PILL_LABEL_PAD_EM);
                    const slotX = restX + (lead ?? pl.start * CHW_REQ);
                    return {
                        ...pl,
                        text,
                        measured: labelW != null && lead != null && span != null,
                        // The first pill's slot starts ON the title column, so
                        // it never centres out past that edge into the id's
                        // (req #3601) — the unmeasured path included.
                        x: j === 0 ? Math.max(slotX, slotX + spanW / 2 - w / 2)
                            : slotX + spanW / 2 - w / 2,
                        y: reqY + REQ_LINE_H / 2 - h / 2,
                        w,
                        h,
                        style: REQ_PILL_STYLE[pl.kind] || REQ_PILL_STYLE.terminal,
                    };
                });
                rowLines[0] = pillsHere.reduce((ln, pl) => ln.slice(0, pl.start)
                    + ' '.repeat(pl.len) + ln.slice(pl.start + pl.len), firstLine);
                // ── PACKED, NOT CENTRED IN THEIR SLOTS (user review, 2026-10-17:
                // "too much space between Terminal pill and the dash") ────────
                // A pill hugs its sans label (`REQ_PILL_LABEL_PAD_EM`) but the
                // layout reserves the label's MONO width, so a pill centred in its
                // slot left the slack beside it — between the last pill and the
                // title most visibly. So when every width is measurable the
                // pills are laid one after another — the first with its left edge
                // ON THE TITLE COLUMN the layout put its range on (req #3601: never
                // inside the id's column), then ONE SPACE of air from each other
                // and from the title — and the first line's tail
                // (`   Title…`, the layout's blank gap — redrawn here with ONE
                // space, req #3660) is redrawn flush after the last pill. The row Text keeps the layout's characters
                // (tail blanked) and so stays the hover/click/drag target over the
                // whole row; the layout's reservation is an upper bound the packed
                // line never exceeds, so wrap, card height and overlap are untouched.
                const spaceW = measureReqText(' ', CF.req, rs.bold);
                const last = pillsHere[pillsHere.length - 1];
                const tailStart = last.start + last.len;
                const tailText = firstLine.slice(tailStart);
                const measured = spaceW != null && pillsHere.every((pl, j) =>
                    pl.start > 0 && pillBoxes[j].measured);
                if (measured) {
                    let x = restX + measureReqText(firstLine.slice(0, pillsHere[0].start),
                        CF.req, rs.bold);
                    pillBoxes = pillBoxes.map((b) => {
                        const placed = { ...b, x };
                        x += b.w + spaceW;
                        return placed;
                    });
                    // The upper bound is ENFORCED, not assumed: a 4-digit port's
                    // label plus its air is a little wider than the four
                    // characters reserved for it, and with the first pill no
                    // longer stepping back a space into the id column (req #3601)
                    // nothing else absorbs that. The last pill gives up the
                    // excess from its own air, so the line ends where the layout's
                    // characters do.
                    const reservedW = measureReqText(firstLine.slice(0, tailStart),
                        CF.req, rs.bold);
                    const reservedEnd = reservedW == null ? null : restX + reservedW;
                    const lastPacked = pillBoxes[pillBoxes.length - 1];
                    if (reservedEnd != null && lastPacked.x + lastPacked.w > reservedEnd) {
                        pillBoxes[pillBoxes.length - 1] = {
                            ...lastPacked, w: reservedEnd - lastPacked.x,
                        };
                    }
                    const lastBox = pillBoxes[pillBoxes.length - 1];
                    const tailLead = tailText.length - tailText.trimStart().length;
                    const tail = {
                        x: lastBox.x + lastBox.w,
                        text: ` ${tailText.trimStart()}`,
                        // req #3661 — the line-1 character index `text` begins
                        // at (its one space is the last of the lead it
                        // replaced), so the title editor can find where the
                        // title starts inside it.
                        start: tailStart + Math.max(0, tailLead - 1),
                    };
                    if (editingTitle) editTail = tail;
                    if (tailText.trim()) {
                        rowTail = tail;
                        rowLines[0] = rowLines[0].slice(0, tailStart)
                            + ' '.repeat(tailText.length);
                    }
                }
                rowText = rowLines.join('\n');
            }
            // The id is drawn by its own Text at `reqX`; the row Text, pulled
            // left, carries blanks in its place — still the row's hover, click
            // and drag target over the id, since a Text's hit box is its
            // whole run, blanks included.
            if (pull) rowText = ' '.repeat(idStr.length) + rowText.slice(idStr.length);
            if (editingTitle) {
                reqEditor = {
                    reqId: label.reqId,
                    stepId: label.stepId,
                    label,
                    color: rs.fill,
                    bold: rs.bold,
                    box: reqTitleEditorBox({
                        label, firstLine: reqText.split('\n')[0],
                        measure: (str) => measureReqText(str, CF.req, rs.bold),
                        chw: CHW_REQ, tail: rowTail || editTail, t, pull,
                        lineH: REQ_LINE_H, fontSize: CF.req,
                        insetTop: initiativeOverlayTopInset,
                    }),
                };
            }
            // A row that carries pills is drawn as ONE Group — text, pills and
            // their targets — so the drag ghost (req #3581, a snapshot of the
            // node under the pointer) shows the row as the reader sees it,
            // pills included, rather than the bare text with blanks in it.
            // `dragRowGroup` on the text is what tells the snapshot to take the
            // parent. So does a row whose id is drawn apart from its title
            // (req #3683). A bare id stays a lone Text, exactly as before.
            const rowGroup = pillBoxes.length > 0 || pull > 0;
            const rowNodes = [];
            rowNodes.push(
                <Text key={`lbl-${i}`} x={restX} y={reqY} text={rowText}
                      fontSize={CF.req} fontFamily={MONO}
                      lineHeight={REQ_LINE_H / CF.req}
                      fill={lifted ? P.dim : rs.fill}
                      opacity={lifted ? 0.4 : 1}
                      fontStyle={rs.bold ? 'bold' : 'normal'}
                      // What the drag hit test reads off the node it lands on
                      // (req #3581): the mark IS the handle.
                      dragReqId={label.reqId}
                      dragStepId={label.stepId}
                      dragRowGroup={rowGroup}
                      onMouseEnter={(e) => cursorPointer(e, true)}
                      onMouseLeave={(e) => cursorPointer(e, false)}
                      // Carry the plan's identity so the requirement page's Back
                      // returns HERE and not to the Roadmap (req #3119).
                      //
                      // `mode: 'plan'` (req #3252) is the other half of "HERE".
                      // The route alone names the PLAN, not the panel: which
                      // panel it opens is a stored preference, and a reader who
                      // reached the visualizer through a `?mode=plan` link never
                      // persisted `plan` — that override is transient by design.
                      // So Back landed them in the TABLE, where the camera this
                      // requirement restores is not even on screen. Naming the
                      // mode makes Back return to the panel they left.
                      //
                      // The pan and zoom now come back too, which is what retires
                      // the old closing clause of this comment ("only pan/zoom
                      // re-fits") — see the saved-viewport block near the top.
                      // req #3463 named `era` here because Back had to rebuild
                      // a plan route and an id with no era was not an address
                      // — TWO eras meant one id space was ambiguous without it.
                      // req #3356 removed the second era, so the state below
                      // deliberately carries no `era` any more: there is only
                      // one id space now, `RequirementDetail.jsx` ignores a
                      // stale `era` if an old state object still carries one,
                      // and reintroducing this field would resurrect exactly
                      // the two-facts-in-two-places shape req #3462's outage
                      // was caused by.
                      onActivate={() => navigate(`/swarm/requirement/${label.reqId}`,
                          pipeline?.id
                              ? { state: planExitState(pipeline.id, 'plan') }
                              : undefined)} />);
            if (pull) {
                rowNodes.push(
                    <Text key={`lbl-${i}-id`} x={reqX} y={reqY} text={idStr}
                          fontSize={CF.req} fontFamily={MONO}
                          lineHeight={REQ_LINE_H / CF.req}
                          fill={lifted ? P.dim : rs.fill}
                          opacity={lifted ? 0.4 : 1}
                          fontStyle={rs.bold ? 'bold' : 'normal'}
                          wrap="none" listening={false} />);
            }
            if (rowTail) {
                rowNodes.push(
                    <Text key={`lbl-${i}-tail`} x={rowTail.x} y={reqY} text={rowTail.text}
                          fontSize={CF.req} fontFamily={MONO}
                          lineHeight={REQ_LINE_H / CF.req}
                          fill={lifted ? P.dim : rs.fill}
                          opacity={lifted ? 0.4 : 1}
                          fontStyle={rs.bold ? 'bold' : 'normal'}
                          wrap="none" listening={false} />);
            }
            pillBoxes.forEach((b, j) => {
                rowNodes.push(
                    <Rect key={`lbl-${i}-pill-${j}`} x={b.x} y={b.y} width={b.w} height={b.h}
                          cornerRadius={b.h / 2} fill={b.style.fill}
                          stroke={b.style.stroke} strokeWidth={REQ_PILL_STROKE}
                          opacity={lifted ? 0.4 : 1} listening={false} />);
                rowNodes.push(
                    <Text key={`lbl-${i}-pilltxt-${j}`} x={b.x} y={b.y} width={b.w} height={b.h}
                          text={b.text} align="center" verticalAlign="middle"
                          fontSize={CF.req * REQ_PILL_FONT_EM} fontFamily={REQ_PILL_FONT}
                          fontStyle="600" fill={b.style.text} wrap="none"
                          opacity={lifted ? 0.4 : 1} listening={false} />);
            });
            // A pill that can DO something gets its own target ON TOP of the
            // row's text — the port opens the dev server (the Swarm
            // visualizer's port pill's action), a terminal on this machine is
            // brought to the front (the Sessions grid chip's). A pill that can
            // do nothing gets no target, so a click on it still opens the
            // requirement like the rest of the row.
            pillBoxes.forEach((b, j) => {
                const action = b.kind === 'devserver' && pillInfo?.devServer?.local
                    ? () => {
                        try { window.open(pillInfo.devServer.url, '_blank', 'noopener,noreferrer'); }
                        catch (e) { /* popup blocked — no-op */ }
                    }
                    : (b.kind === 'terminal' && pillInfo?.terminal?.href
                        ? () => { window.location.href = pillInfo.terminal.href; }
                        : null);
                if (!action) return;
                rowNodes.push(
                    <Rect key={`lbl-${i}-pillhit-${j}`} x={b.x} y={b.y} width={b.w} height={b.h}
                          fill="transparent"
                          onMouseEnter={(e) => cursorPointer(e, true)}
                          onMouseLeave={(e) => cursorPointer(e, false)}
                          onActivate={action} />);
            });
            if (rowGroup) {
                worldNodes.push(<Group key={`lbl-${i}-row`}>{rowNodes}</Group>);
            } else {
                worldNodes.push(...rowNodes);
            }
        } else if (label.kind === 'badge') {
            // req #3503, round 4 — drawn as an HTML overlay now (`floatingBadges`
            // below), not in Konva at all. Three rounds of hand-fighting canvas's
            // `textBaseline: 'middle'` (font-box centring, not glyph-ink centring
            // — see the git history on this branch for the measurement-based
            // nudge that used to live here) never converged, because canvas has
            // no real vertical-centring primitive and CSS flexbox does — the
            // same reason the initiative chip's own controls are HTML, not Konva. This
            // branch is kept, EMPTY, so a `badge` label is a deliberate no-op
            // here rather than an unhandled kind silently falling through the
            // chain below to whatever the next `else if` happens to match.
        } else if (label.kind === 'barrier') {
            // req #3673 — drawn as an HTML icon button now (`floatingFlags`
            // below), not in Konva: the user found the stroked ⚑ unreadable,
            // and a real icon, a hover title and a focusable button are all
            // HTML's. Kept, EMPTY, for the `badge` branch's reason — a
            // deliberate no-op, never a fall-through.
        } else if (label.kind === 'title') {
            worldNodes.push(
                <Text key={`lbl-${i}`} x={label.x} y={label.y} text={label.text}
                      fontSize={CF.title} fontFamily={MONO} fill={P.dim}
                      listening={false} />);
            // The reserved title slot is the step's own name in a second place
            // (req #3213 D2): it answers with the step it belongs to, exactly
            // as the step label above does, rather than leaving half a step's
            // text silent.
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
                    onMouseEnter: (e) => cursorPointer(e, true),
                    onMouseLeave: (e) => cursorPointer(e, false),
                }));
            }
        } else if (label.kind === 'slot') {
            // Dropped by the draw-time re-thin — see the counter-scale note
            // below. `return`, not `continue`: this sweep is a `forEach`, so
            // returning skips this label alone.
            if (!visibleRulerLabels.has(label.slotKey)) return;
            // The FUTURE tick is the accent: it names the tinted REGION beside
            // it rather than a boundary, and it is the mark the plan is most
            // often opened to find. A DATE and an UNDATED tick are both dim —
            // `undated` is the absence of a claim, and giving it the accent
            // would make a plan with no timestamps read as a plan that is
            // entirely in the future, which is the opposite claim.
            const accented = label.slotKind === 'future';
            // STICKY (req #3254): part of the header strip, not the world —
            // see `stickyRulerNodes`'s own comment above. `label.x`/`label.y`
            // are unchanged (the vitest zero-overlap sweep, which runs at a
            // fixed transform with no pan, still covers this rect exactly as
            // it did before), but the sweep's guarantee is a LAYOUT-time one:
            // it does NOT extend across a live pan, because this is now the
            // one label kind whose SCREEN position is `stickyRulerY(t)` where
            // every other label's is `t.y`. Once the strip pins (`t.y` below the
            // ruler's excess, `rulerExcessY` — 0 at k ≥ 1),
            // a step or requirement label scrolled up near the viewport top
            // can land under it on screen — the same trade-off the sticky
            // initiative chips already accept (their own comment: "a sticky chip
            // landed on a live bead" was a known, documented cost, not a
            // defect to chase to zero). Nothing here gets obstacle avoidance
            // either — the layout has run no such pass, for any label kind,
            // since req #3257 — so this is the identical cost paid a second
            // time, not a special case carved out for slot labels.
            // ── THE DATE LABEL IS SIZED ON SCREEN, NOT IN THE WORLD (req
            //    #3365 user directive: "the Date information needs a larger
            //    typeface … they are quite tiny when scrolled out [and] become
            //    increasingly larger. possibly its a fixed typeface or one that
            //    has lesser extremes") ─────────────────────────────────────────
            // The strip is drawn inside a Group scaled by `t.k`, so a 13px world
            // font rendered at **2.7px** at the scale the plan now opens in
            // (k = 0.2077 on plan 7) and grew linearly from there — the two
            // extremes the directive names. Dividing by `k` cancels the Group's
            // scale, so the glyphs are a FIXED size on screen at every zoom,
            // which is the "lesser extremes" end of what was asked for.
            //
            // NOTHING ABOUT WHERE IT SITS OR HOW IT SCROLLS CHANGES, which the
            // directive was explicit about: `x`, `y` and the sticky
            // `stickyRulerY(t)` Group are untouched, so the strip still pins to
            // the viewport top and still pans and zooms horizontally with the
            // columns. Only the glyph size is counter-scaled.
            //
            // AND THE THINNING IS RE-RUN, which is the half that is not
            // optional. `showLabel` was decided at layout time against WORLD
            // widths, and counter-scaling inflates a label's world width by
            // exactly `rulerLabelMag` — so at low `k` labels that the layout
            // spaced correctly would collide. `visibleRulerLabels` re-applies
            // the layout's own greedy rule to the inflated widths, so a label
            // is dropped rather than drawn on top of its neighbour. It can only
            // ever REMOVE labels the layout allowed, never add one it refused.
            //
            // `y` is counter-scaled TOO, and that half arrived with the plate
            // (req #3365, second pass). Sizing the glyphs on screen while
            // leaving their baseline at a world `y` put the text at `12 · k` =
            // 2.5px from the strip's top and 13px tall — most of it hanging out
            // the bottom of a 7.5px plate. Screen size and screen POSITION are
            // one decision; `x` stays world because the label names a column.
            stickyRulerNodes.push(
                <Text key={`lbl-${i}`} x={label.x} y={label.y * rulerLabelMag}
                      text={label.text}
                      fontSize={F.slot * rulerLabelMag} fontFamily={MONO}
                      fill={accented ? P.accent : P.dim}
                      opacity={accented ? 0.9 : 0.95}
                      listening={false} />);
        } else if (label.kind === 'initiative') {
            // Drawn as an HTML overlay below, not in the world — see
            // `floatingInitiatives`. Nothing is pushed here.
        } else if (label.kind === 'collapse') {
            // req #3650 — an HTML button over its reserved box, like the run
            // pill — see `floatingCollapses`. Nothing is pushed here.
        }
        // THE LABEL KINDS THIS SWEEP HANDLES ARE THE LABEL KINDS THE LAYOUT
        // EMITS, and req #3371 narrowed both by one. `computePlanLayout` used
        // to emit a fifth kind — the launch unit's letter, with an optional
        // leader line down to its dashed rectangle — and it is gone from the
        // layout, so there is no branch for it here. Deliberately NOT left as
        // a defensive `else`: a case no data can reach is a case no test can
        // cover, and the zero-overlap label contract is narrower by exactly
        // one text kind rather than looser by an unreachable one.
    };
    drawLayout.labels.forEach((label, i) => {
        const mark = worldNodes.length;
        drawLabel(label, i);
        fadeFoldFrom(mark, label.reveal != null ? drawLayout.nodes.get(label.stepId) : null,
            `lbl-${i}`);
    });

    // ── THE ADD-STEP MARKS (req #3586) ──────────────────────────────────────
    // A "+" on every dependency arc (split it: A -> new -> B), one at the end
    // of a dashed stub off every card's right side (dependent: a new step gated on
    // that step alone), and one off the left side of every card no arc lands on
    // (precede, req #3617: a new step that card then waits on). ONE shape,
    // pushed last so it sits above the labels; its geometry is `insertGeom` and its clicks are resolved by `insertHitRef`.
    if (insertGeom) {
        worldNodes.push(
            <Shape key="insert-marks" sceneFunc={insertSceneFunc} geom={insertGeom}
                   drawR={insertR}
                   listening={false} perfectDrawEnabled={false} />);
        // req #3719 — the add-initiative "+" is the one mark that is not on a card, so
        // it is the one that says what it adds.
        const initiativeMark = insertGeom.marks.find((m) => m.kind === 'initiative');
        if (initiativeMark) {
            worldNodes.push(
                <Text key="insert-initiative-label" x={initiativeMark.x + insertR + 6}
                      y={initiativeMark.y - 6} text="Add initiative" fontSize={12}
                      fontFamily={MONO} fill={P.arc} listening={false} />);
        }
    }

    return (
        // req #3665 — the drag surface the Orchestrables rows lift through: the
        // shared sensors, press timeline and overlay, with the canvas's own
        // step hit test as its collision detection.
        <DarwinDndContext collisionDetection={seatCollision}
                          overlaySx={QUIET_LIFT_SX}
                          onDragMove={onUnseatDragMove}
                          onDragEnd={onUnseatDragEnd}
                          onDragCancel={onUnseatDragCancel}>
        <Box>
            <OrderViolationsAlert plan={plan} />

            {/* req #3721 — the Active box. A viewport-fixed AnchoredPanel,
                mounted OUTSIDE the canvas pane so d3-zoom never sees its
                pointer or wheel. */}
            <PlanActiveBox items={activeItems} reqPills={reqPills}
                           idStyleOf={activeIdStyleOf}
                           isLoading={sessionStatus == null}
                           maximized={maximized}
                           onOpen={openActiveReq} />

            {/* Req #3235 — the `?initiative=` deep link named an initiative no band on THIS
                plan carries (see focusInitiativeNotOnPlan above). Saying so beats a
                default view with no explanation for why nothing focused. */}
            {focusInitiativeNotOnPlan && (
                <Alert severity="info" variant="outlined" sx={{ mb: 2 }}
                       data-testid="pipeline-viz-initiative-not-on-plan">
                    That initiative isn&apos;t shown on this plan — none of its steps are here.
                </Alert>
            )}

            {/* Req #3253 — the `?step=` deep link named a step this plan does not
                carry. Same reasoning as the initiative alert above. */}
            {focusStepNotOnPlan && (
                <Alert severity="info" variant="outlined" sx={{ mb: 2 }}
                       data-testid="pipeline-viz-step-not-on-plan">
                    That step isn&apos;t on this plan.
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
                 // `slots,labelled` — the time ruler (req #3207), published
                 // because canvas geometry is
                 // otherwise only observable as pixels, and the DEGRADATION rule
                 // is the half that a screenshot cannot distinguish from a plan
                 // that simply has fewer days. The two numbers differing IS the
                 // proof that thinning ran.
                 data-ruler={`${layout.ruler.slots.length},${
                     layout.ruler.slots.filter((s) => s.showLabel).length}`}
                 // The sticky ruler's actual rendered Y (req #3254) — same
                 // device and same reason as `data-transform`: whether the
                 // strip is genuinely pinned to the viewport top rather than
                 // scrolling off with the world is otherwise only observable
                 // as pixels. `stickyRulerY(t)` is exactly what the sticky
                 // Group below is drawn at, so this can never drift from what
                 // the canvas actually did.
                 data-ruler-y={stickyRulerY(t).toFixed(2)}
                 // THE LEVEL THE CANVAS DREW — one level, so this and the
                 // toolbar's soft mark and `data-drawn` can no longer disagree
                 // (req #3324). It used to publish the LADDER's answer while the
                 // control was told the drawn one, which is how a pinned L2 could
                 // read as L1 on the chips.
                 data-level={level}
                 data-drawn={drawnKinds}
                 // req #3581 — the requirement in flight and the step it would
                 // land on, for the same reason as `data-transform`: a canvas
                 // drag is otherwise observable only as changed pixels.
                 data-req-drag={reqDrag ? reqDrag.reqId : ''}
                 data-drop-step={dropStepId ?? ''}
                 // req #3586 — how many add-step marks the canvas drew, by kind,
                 // for the same reason: they are otherwise only pixels.
                 data-insert-edges={insertGeom ? insertGeom.edgeCount : 0}
                 data-insert-dependents={insertGeom ? insertGeom.dependentCount : 0}
                 data-insert-precedes={insertGeom ? insertGeom.precedeCount : 0}
                 data-insert-initiatives={insertGeom ? insertGeom.initiativeCount : 0}
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
                        minHeight: maximized ? 0 : 480, overflow: 'hidden',
                        // req #3658 — maximized, the canvas IS the window: no
                        // rounded frame drawn inside the screen's edge.
                        borderRadius: maximized ? 0 : '8px',
                        border: maximized ? 'none' : `1px solid ${P.line}`,
                        background: P.panel,
                        touchAction: 'none',
                        // req #3665 — a finger held on the plan lifts a
                        // requirement or opens an editor; never the iOS
                        // text loupe or link callout.
                        userSelect: 'none', WebkitUserSelect: 'none',
                        WebkitTouchCallout: 'none',
                        // ...except in the in-place editors, which are text.
                        '& input, & textarea, & [contenteditable="true"], & [contenteditable=""]': {
                            userSelect: 'text', WebkitUserSelect: 'text' } }}>
                {size.w > 0 && (
                    <Stage ref={stageRef} width={size.w} height={size.h}>
                        <Layer ref={layerRef}>
                            <Group x={t.x} y={t.y} scaleX={t.k} scaleY={t.k}>
                                {worldNodes}
                            </Group>
                            {/* The sticky ruler strip (req #3254) — SAME x/scale
                                as the world Group above (so ticks and labels
                                still pan/zoom horizontally with the columns
                                beneath them), but `y` is pinned via
                                `stickyRulerY(t)` instead of `t.y`, decoupling it
                                from vertical pan. Drawn AFTER the world Group so
                                it floats on top of scrolled-under content, the
                                same z-order a sticky header always wants. */}
                            <Group x={t.x} y={stickyRulerY(t)} scaleX={t.k}
                                   scaleY={t.k} listening={false}>
                                {stickyRulerNodes}
                            </Group>
                        </Layer>
                    </Stage>
                )}

                {/* req #3581 — the requirement in flight: a FULL-SIZE copy of the
                    mark, snapshotted from its own Konva node at drag start, so
                    it is the requirement exactly as the canvas draws it — same
                    zoom, same colour key, id or title per level. Lifted onto a
                    panel-coloured plate with a soft shadow so it reads as
                    picked up. Positioned by `transform` written straight to
                    the DOM per pointermove (see the drag effect); React sets
                    it once and never again, so dragging re-renders nothing.
                    `pointerEvents: none` — it must never be what the drop
                    lands on. */}
                {reqDrag && (
                    <Box ref={dragPreviewRef}
                         data-testid="pipeline-viz-req-drag-preview"
                         data-req-id={reqDrag.reqId}
                         style={{ transform: `translate(${reqDrag.x}px, ${reqDrag.y}px)` }}
                         // Over a box parked on the plan, which floats at
                         // UNSEATED_FLOAT_Z once placed (req #3687). FIXED in
                         // the window (req #3817), like a placed box — it
                         // escapes the pane's `overflow: hidden` the same way —
                         // so it can be carried to a box on the navbar.
                         sx={{ position: 'fixed', left: 0, top: 0,
                                zIndex: UNSEATED_FLOAT_Z + 2,
                                pointerEvents: 'none', willChange: 'transform',
                                px: `${reqDrag.padX}px`, py: `${reqDrag.padY}px`,
                                borderRadius: '6px',
                                background: rgba(P.panel, 0.94),
                                // OUTLINE, not border: it takes no layout space, so
                                // the snapshot sits exactly `pad` in from the box
                                // edge the grab offset was computed against.
                                outline: `1px solid ${P.accent}`,
                                boxShadow: `0 10px 28px rgba(0, 0, 0, 0.55), 0 0 0 3px ${rgba(P.accent, 0.12)}`,
                                cursor: 'grabbing',
                                // req #3665 — THE LIFT IS A HIGHLIGHT, NOT A
                                // JUMP (user directive: "it should more just
                                // become highlighted or show its preview rather
                                // than jump"). The copy appears exactly over the
                                // mark, at its size, and only its outline and
                                // shadow fade in; it moves when the pointer does.
                                '@keyframes planReqLift': {
                                    '0%': { outlineColor: 'transparent', boxShadow: '0 0 0 rgba(0,0,0,0)' },
                                },
                                animation: 'planReqLift 140ms ease-out',
                                '@media (prefers-reduced-motion: reduce)': { animation: 'none' } }}>
                        <img src={reqDrag.src} alt="" draggable={false}
                             width={reqDrag.w} height={reqDrag.h}
                             style={{ display: 'block' }} />
                    </Box>
                )}

                {/* Floating initiative labels — each at the top-left corner of its own
                    band's rectangle intersected with the visible content area
                    (req #3257). The strip ignores the pointer so it can never
                    swallow a drag-pan; each label re-enables it so the initiative
                    stays clickable.

                    `overflow: 'hidden'` on the strip is load-bearing, not
                    housekeeping: a name is pushed off the top (or the left) BY
                    ITS OWN RECTANGLE as that rectangle leaves the screen, so
                    its box legitimately extends past the panel edge for the
                    last few pixels of its band's life, and this is what cuts it
                    off at the edge instead of letting it spill.

                    Clicking the STATUS LIGHT or the CLOSURE COUNT focuses that
                    band (req #3204; it was the name until req #3580 made the
                    name an in-place editor). Every band is focusable, "No initiative"
                    included — it is a band with steps like any other, and with
                    no row to rename its NAME keeps the zoom. The ↗ beside it
                    keeps the navigation, and only it needs the id.

                    Re-enabling pointer events does not cost the drag-pan: the
                    chip is a DESCENDANT of the container d3-zoom is bound to, so
                    a mousedown on the chip still bubbles and still starts a pan.
                    Only the click is the chip's.

                    Req #3210's STICKY prev/next entries are GONE (req #3257):
                    the clamp now applies to EVERY band, so a focused band's
                    neighbours keep their names by the ordinary rule instead of
                    by a special case pinned to the viewport edge. Their
                    guarantee is re-asserted in vitest against the new rule. */}
                <Box sx={{ position: 'absolute', top: initiativeOverlayTopInset, left: 0,
                            right: 0, bottom: 0, pointerEvents: 'none',
                            overflow: 'hidden' }}
                     data-testid="pipeline-viz-initiative-layer">
                    {floatingInitiatives.map((e) => {
                        // req #3580 — THREE GESTURES ON THE NAME (user
                        // directive: "fast click to zoom, long click to edit,
                        // double click to double zoom"). Since req #3742 a quick
                        // click on the name opens the initiative's SINGLE EDITOR (user
                        // directive: "single click of initiative and step to take you
                        // to the single editor"); a double click goes straight
                        // to the step stop; a long press opens the in-place
                        // editor. The status light and the closure count keep
                        // the quick-click zoom — req #3297's band → step cycle
                        // — and edit nothing. The "No initiative" band has no row to
                        // edit or rename, so its name keeps the zoom and takes
                        // no long press.
                        const renamable = e.initiativeId != null;
                        const editing = renamable && initiativeEdit?.key === e.key;
                        const zoomLabel = `Zoom pipeline initiative ${e.name ?? e.text}`
                            + initiativeZoomHintSuffix(initiativeWorkByInitiative.get(e.key));
                        // A long press hands the press point (the caret goes
                        // there); F2 hands none (the name is selected).
                        const startEdit = (at = null) => setInitiativeEdit({ key: e.key, saving: false, at });
                        const gestures = {
                            onClick: () => activateInitiativeName(e.band),
                            onDoubleClick: () => activateInitiativeName(e.band, { deep: true }),
                        };
                        // Pointer, not click — see `planPressGesture.js`. The
                        // tracker is shared, so the key names this chip's part.
                        const press = (part, cbs) => ({
                            onPointerDown: (ev) => {
                                if (ev.button !== 0) return;
                                pressRef.current.down(`initiative-${e.key}-${part}`,
                                    ev.clientX, ev.clientY, cbs);
                            },
                            onPointerMove: (ev) => pressRef.current.move(ev.clientX, ev.clientY),
                            onPointerUp: () => pressRef.current.up(`initiative-${e.key}-${part}`),
                            onPointerCancel: () => pressRef.current.cancel(),
                            onPointerLeave: () => pressRef.current.cancel(),
                        });
                        // Enter/Space zoom from the keyboard through the SAME
                        // function the pointer does, so keyboard parity stays
                        // structural (req #3297); F2 — the platform's own
                        // rename key — is the keyboard's long press.
                        const zoomHandlers = {
                            role: 'button',
                            tabIndex: 0,
                            ...press('zoom', gestures),
                            onKeyDown: (ev) => {
                                if (ev.key !== 'Enter' && ev.key !== ' ') return;
                                ev.preventDefault();     // Space must not scroll
                                ev.stopPropagation();
                                activateInitiativeName(e.band);
                            },
                        };
                        return (
                        <Box
                            key={e.key}
                            data-testid={`pipeline-viz-initiative-${e.key}`}
                            data-editing={editing ? 'true' : undefined}
                            data-bar={e.bar > 0 ? e.bar.toFixed(2) : undefined}
                            sx={{
                                // `e.y` is screen-absolute (panel-origin), but
                                // this chip's containing block now starts at
                                // `initiativeOverlayTopInset` (req #3374 P1) — not 0
                                // — so it is charged BACK OUT here. Without
                                // it every chip would sit `initiativeOverlayTopInset`
                                // px lower than `placeInitiativeChips` placed it: the
                                // clearance the container inset already pays
                                // for, charged a second time.
                                position: 'absolute', left: e.x,
                                top: e.y - initiativeOverlayTopInset,
                                // The height and font the placement pass MEASURED
                                // — both come back from `placeInitiativeChips`, because
                                // it now scales the chip to fit its own initiative lane
                                // at low zoom (req #3168). Drawing at any other
                                // size means the clamp decided against a box that
                                // is not on screen. `gap` is req #3204's, for the
                                // ↗ control that rides beside the name.
                                height: e.h, lineHeight: 1,
                                // WIDTH IS CAPPED ONLY WHEN IT WAS CUT (req
                                // #3257): `e.clipped` says something ate the
                                // tail of this chip, and the cap plus
                                // `overflow: hidden` is what stops the name
                                // running past it. THREE things can, and the
                                // renderer must not care which (req #3272): the
                                // on-screen key, the panel's own right edge, and
                                // the BAND'S right edge — a rectangle narrower
                                // on screen than the name it carries, which used
                                // to drop the name instead. So `clipped` is
                                // reached with no key present. None of the three
                                // may ever be dodged by sliding the chip
                                // sideways out of its rectangle.
                                // Capping UNCONDITIONALLY would hand the drawn
                                // box to `INITIATIVE_CHIP_CHAR_W`, an ESTIMATE: a hair
                                // short and every name on the plan truncates.
                                // …EXCEPT WHILE ITS NAME IS BEING EDITED (req
                                // #3580): a cut box would hide the very text
                                // being typed. The layer's own `overflow:
                                // hidden` still stops it at the panel edge.
                                ...(e.clipped && !editing
                                    ? { maxWidth: e.w, overflow: 'hidden' }
                                    : null),
                                // req #3695 — A FOLDED INITIATIVE IS A FLOATING TITLE
                                // BAR: no rectangle beneath it, so the chip is
                                // drawn at the bar width `placeInitiativeChips`
                                // measured (never narrower than its name), in
                                // the initiative's own colour, lifted off the plan by
                                // a shadow. `e.bar` is the band's folded
                                // fraction, so the bar grows out of the chip and
                                // back into it with the fold's animation.
                                ...(e.bar > 0 && !e.clipped && !editing
                                    ? { minWidth: e.w }
                                    : null),
                                display: 'flex', alignItems: 'center', gap: '4px',
                                fontFamily: MONO, fontSize: e.fontSize,
                                fontWeight: 700,
                                color: e.color,
                                // 60% opaque (user directive 2026-08-01). It was
                                // fully opaque, which read as a tile punched into
                                // the plan; the band's own colour now tints
                                // through while the name still wins over what it
                                // crosses.
                                background: e.bar > 0
                                    ? `linear-gradient(90deg, ${rgba(e.color, 0.3 * e.bar)}, `
                                        + `${rgba(e.color, 0.08 * e.bar)}), ${chipBg}`
                                    : chipBg,
                                boxShadow: e.bar > 0
                                    ? `0 2px 10px rgba(0, 0, 0, ${0.35 * e.bar})` : 'none',
                                px: 0.9, py: 0, borderRadius: '5px',
                                border: `1px solid ${e.color}55`,
                                whiteSpace: 'nowrap', userSelect: 'none',
                                pointerEvents: 'auto',
                                // An affordance you cannot see is not a feature
                                // (req #3204): the border firms up on hover, the
                                // name underlines, and the light and the count
                                // ring — every one of them zooms on a click, and
                                // the name's tooltip names its long press.
                                transition: 'border-color 120ms',
                                '&:hover': { borderColor: e.color },
                                '& .pipeline-viz-initiative-name': { cursor: 'pointer' },
                                '& .pipeline-viz-initiative-name:hover': {
                                    textDecoration: 'underline',
                                    textDecorationThickness: '1px',
                                    textUnderlineOffset: '2px',
                                },
                            }}
                        >
                            {/* NOTHING further may be added in flow here
                                without reserving it in `placeInitiativeChips`' own
                                width measurement first: `e.w` is what keeps
                                the name inside its own rectangle and clear of
                                the on-screen key, so unmeasured content is
                                content that hangs past the edge it was
                                clamped to. The two things that ARE reserved —
                                the pause bubble and the ↗ — say so below. */}
                            {/* The pause status bubble (req #3226) — a FLAT,
                                unscaled dot (unlike the name text, which
                                scales with the chip): its footprint is
                                reserved unconditionally in
                                `placeInitiativeChips`' own width measurement, so
                                nothing here can draw past what the clamp
                                measured. Every band gets one,
                                "No initiative" included — pause is a scope fact,
                                and the unlabelled band's scope is exactly
                                the whole plan's. */}
                            {/* req #3580 — THE STATUS LIGHT IS A ZOOM CONTROL.
                                Its drawn footprint is unchanged (the reserved
                                `INITIATIVE_PAUSE_BUBBLE_W`); the HIT target is grown
                                by padding cancelled with an equal negative
                                margin, so an 8px dot is not an 8px target and
                                nothing the placement measured moves. */}
                            {/* req #3650 — THE CHIP'S COLLAPSE HEAD, leading it:
                                its upper-left, where the TPU 3D panels keep
                                theirs. Folds THIS initiative's steps and nothing
                                else. The chevron alone since req #3648 — no
                                "STEPS" word. Its width is reserved in `placeInitiativeChips`
                                (`INITIATIVE_CHIP_COLLAPSE_W`) and drawn at exactly
                                that, at the TPU head's own unscaled 10px. */}
                            <PlanCollapseHead
                                open={!e.band?.collapsed}
                                onToggle={() => toggleInitiativeFold(e.initiativeId ?? null)}
                                label={null}
                                name={`Steps of initiative ${e.name ?? e.text}`}
                                testId={`pipeline-viz-initiative-collapse-${e.key}`}
                                style={{ width: INITIATIVE_CHIP_COLLAPSE_HEAD_W, fontSize: 10,
                                    justifyContent: 'center' }}
                            />
                            <Box
                                component="span"
                                {...zoomHandlers}
                                aria-label={zoomLabel
                                    + (e.band?.paused ? ' — paused' : ' — active')}
                                data-testid={`pipeline-viz-initiative-pause-${e.key}`}
                                sx={{
                                    flexShrink: 0, display: 'inline-flex',
                                    p: '5px', m: '-5px', borderRadius: '50%',
                                    cursor: 'pointer',
                                    '&:hover > span, &:focus-visible > span': {
                                        boxShadow: `0 0 0 2px ${e.color}`,
                                    },
                                    outline: 'none',
                                }}
                            >
                                <Box
                                    component="span"
                                    sx={{
                                        width: INITIATIVE_PAUSE_BUBBLE_D,
                                        height: INITIATIVE_PAUSE_BUBBLE_D,
                                        borderRadius: '50%',
                                        bgcolor: pauseBubbleColor(!!e.band?.paused),
                                    }}
                                />
                            </Box>
                            {editing ? (
                                <PlanInPlaceInput
                                    initial={e.name ?? e.text}
                                    saving={!!initiativeEdit?.saving}
                                    ariaLabel={`Rename initiative ${e.name ?? e.text}`}
                                    testId={`pipeline-viz-initiative-edit-${e.key}`}
                                    onCommit={(raw) => commitInitiativeTitle(e.band, raw)}
                                    onCancel={() => setInitiativeEdit(null)}
                                    caretAt={initiativeEdit?.at}
                                    growCh
                                    style={{ fontSize: e.fontSize, height: e.h - 4 }}
                                    sx={{ color: e.color }}
                                />
                            ) : (
                                <Box component="span" className="pipeline-viz-initiative-name"
                                     data-testid={`pipeline-viz-initiative-name-${e.key}`}
                                     {...zoomHandlers}
                                     {...(renamable ? {
                                         ...press('name', {
                                             ...gestures,
                                             onClick: () => openPlanEditor('initiative', e.initiativeId),
                                             onLongPress: startEdit,
                                         }),
                                         // A touch long press would otherwise
                                         // also open the browser's own menu.
                                         onContextMenu: (ev) => ev.preventDefault(),
                                         // Enter/Space open the editor, as the
                                         // quick click does; F2 is the keyboard's
                                         // long press.
                                         onKeyDown: (ev) => {
                                             if (ev.key === 'F2') {
                                                 ev.preventDefault();
                                                 ev.stopPropagation();
                                                 startEdit();
                                                 return;
                                             }
                                             if (ev.key !== 'Enter' && ev.key !== ' ') return;
                                             ev.preventDefault();
                                             ev.stopPropagation();
                                             openPlanEditor('initiative', e.initiativeId);
                                         },
                                         'aria-label': `Edit initiative ${e.name ?? e.text}`
                                             + ' — double click to zoom, press F2 to rename',
                                     } : {
                                         'aria-label': zoomLabel,
                                     })}
                                >
                                    {e.name ?? e.text}
                                </Box>
                            )}
                            {/* req #3580 — THE CLOSURE COUNT, ITS OWN ELEMENT and
                                the second zoom control. Its text was always part
                                of the measured label (`initiativeLabel` = name + " " +
                                count), so drawing it as a sibling costs no width
                                the placement did not already reserve. */}
                            {e.countText && (
                                <Box component="span"
                                     {...zoomHandlers}
                                     {...press('count', gestures)}
                                     aria-label={`${zoomLabel} — ${e.countText} requirements closed`}
                                     data-testid={`pipeline-viz-initiative-count-${e.key}`}
                                     sx={{
                                         cursor: 'pointer', fontWeight: 400,
                                         opacity: 0.9, px: '3px', mx: '-3px',
                                         borderRadius: '4px', outline: 'none',
                                         '&:hover, &:focus-visible': {
                                             opacity: 1,
                                             boxShadow: `inset 0 0 0 1px ${e.color}`,
                                         },
                                     }}
                                >
                                    {e.countText}
                                </Box>
                            )}
                            {/* The req #3119 target, RE-POINTED by req #3373: the
                                browsable-catalog route it used to open was retired
                                (req #3357), and `/swarm/steps?initiative=<id>` is the
                                only remaining destination that answers the
                                question this control always asked — "show me
                                the work under this initiative" — with step and
                                requirement detail rather than one initiative row.
                                THIS CONTROL IS WHAT ADDS THE FILTER: StepsPage
                                only filtered by pipeline before this. Kept as
                                its OWN visible control now that the chip body
                                focuses instead. Its click must not also focus,
                                hence stopPropagation; the react-router navigate
                                leaves the page anyway, but relying on that would
                                make the ordering matter. */}
                            {e.initiativeId != null && (
                                <Box
                                    component="span"
                                    role="link"
                                    tabIndex={0}
                                    aria-label={`Open ${e.text}'s steps`}
                                    data-testid={`pipeline-viz-initiative-open-${e.key}`}
                                    onClick={(ev) => {
                                        ev.stopPropagation();
                                        navigate(`/swarm/steps?initiative=${e.initiativeId}`,
                                            stepsBackState);
                                    }}
                                    onKeyDown={(ev) => {
                                        if (ev.key !== 'Enter') return;
                                        // Without this the chip's own handler
                                        // also fires and focuses the band the
                                        // user is navigating away from.
                                        ev.stopPropagation();
                                        ev.preventDefault();
                                        navigate(`/swarm/steps?initiative=${e.initiativeId}`,
                                            stepsBackState);
                                    }}
                                    sx={{
                                        fontSize: INITIATIVE_CHIP_FONT, fontWeight: 400,
                                        opacity: 0.85,
                                        lineHeight: 1, px: '3px',
                                        '&:hover': { opacity: 1 },
                                    }}
                                >
                                    ↗
                                </Box>
                            )}
                            {/* req #3428 — the SECOND destination this chip
                                offers: the initiative's own requirements, as task
                                cards, on the ordinary requirements page under a
                                dismissable filter.

                                THE MARK IS THE PAGE'S OWN VOCABULARY, not a new
                                glyph: `ViewModuleIcon` is literally what
                                `SwarmView`'s Cards toggle draws
                                (`SWARM_VIEW_CHROME.cards`), so a reader who has
                                seen that toggle recognises where this goes. A
                                second arrow would have been wrong — ↗ already
                                means "leave the page", and two arrows read as
                                one control drawn twice.

                                Its width is RESERVED in `placeInitiativeChips`
                                (`INITIATIVE_CHIP_CARDS_LINK_W`) under the same
                                `initiativeId != null` condition that renders it — see
                                the keep-out note above this whole flex row.

                                `stopPropagation` on BOTH handlers for the reason
                                the ↗'s own comment gives: without it the chip's
                                handler also fires and focuses the band the user
                                is navigating away from. */}
                            {/* The render condition is `initiativeId != null` and NOTHING
                                ELSE, because that is exactly the condition
                                `placeInitiativeChips` reserves the width under. An extra
                                truthiness term here (e.g. on the built href) would
                                let a band reserve 24px it never draws — a small
                                lie, but the whole point of the reservation is that
                                the two cannot drift. The href is checked inside the
                                handlers instead, where a null simply does nothing. */}
                            {e.initiativeId != null && (
                                <Box
                                    component="span"
                                    role="link"
                                    tabIndex={0}
                                    aria-label={`Open ${e.text} requirements in the task cards view`}
                                    data-testid={`pipeline-viz-initiative-cards-${e.key}`}
                                    onClick={(ev) => {
                                        ev.stopPropagation();
                                        const to = swarmInitiativeLinkTo(e.initiativeId);
                                        if (to) navigate(to);
                                    }}
                                    onKeyDown={(ev) => {
                                        if (ev.key !== 'Enter') return;
                                        ev.stopPropagation();
                                        ev.preventDefault();
                                        const to = swarmInitiativeLinkTo(e.initiativeId);
                                        if (to) navigate(to);
                                    }}
                                    sx={{
                                        display: 'inline-flex', alignItems: 'center',
                                        lineHeight: 1, px: '3px', opacity: 0.85,
                                        '&:hover': { opacity: 1 },
                                    }}
                                >
                                    <ViewModuleIcon sx={{ fontSize: INITIATIVE_CHIP_FONT + 2 }} />
                                </Box>
                            )}
                            {/* req #3649 — THE INITIATIVE'S PADLOCK, the chip's one
                                authoring control. Reserved in `placeInitiativeChips`
                                (`INITIATIVE_LOCK_W`) under the same `initiativeId != null`
                                condition. Closed when the initiative is locked in
                                its own right OR under a locked plan; a click
                                flips the initiative's own flag, and names the plan
                                when that is what holds it. */}
                            {e.initiativeId != null && (
                                <Box
                                    component="span"
                                    role="button"
                                    tabIndex={0}
                                    aria-pressed={!!e.band?.locked}
                                    aria-label={e.band?.locked
                                        ? `Initiative ${e.text} is locked${e.band?.lockedBy === 'pipeline'
                                            ? ' by its plan' : ''} — unlock`
                                        : `Lock initiative ${e.text}`}
                                    data-testid={`pipeline-viz-initiative-lock-${e.key}`}
                                    data-locked={e.band?.locked ? '1' : '0'}
                                    onClick={(ev) => {
                                        ev.stopPropagation();
                                        toggleInitiativeLock(e.band);
                                    }}
                                    onKeyDown={(ev) => {
                                        if (ev.key !== 'Enter') return;
                                        ev.stopPropagation();
                                        ev.preventDefault();
                                        toggleInitiativeLock(e.band);
                                    }}
                                    sx={{
                                        display: 'inline-flex', alignItems: 'center',
                                        lineHeight: 1, px: '2px', cursor: 'pointer',
                                        opacity: e.band?.locked ? 1 : 0.6,
                                        // req #3673 — the step card's padlock
                                        // colours: orange shut, chip colour open.
                                        color: e.band?.locked ? P.lockOn : undefined,
                                        '&:hover': { opacity: 1 },
                                    }}
                                >
                                    <PlanLockIcon locked={!!e.band?.locked}
                                                  sx={{ fontSize: INITIATIVE_LOCK_D }} />
                                </Box>
                            )}
                        </Box>
                        );
                    })}
                </Box>

                {/* ── THE REQUIREMENT-COUNT BADGE LAYER (req #3503, round 4;
                    ruler inset added on review) ────────────────────────────
                    See `floatingBadges`' own comment above for why this is HTML
                    rather than Konva. INSET LIKE THE INITIATIVE LAYER (req #3503
                    review) — a badge lives on its own card, but that card
                    scrolls under the pinned ruler exactly like an initiative band
                    does, and this layer is HTML drawn unconditionally above
                    the whole canvas (Konva paints the ruler Group after the
                    world Group, but that ordering means nothing to a sibling
                    DOM layer). Without the inset a panned-down badge drew OVER
                    the ruler; `top: initiativeOverlayTopInset` + `overflow: 'hidden'`
                    is the initiative layer's own fix for the identical defect
                    (req #3374 P1), reused rather than re-derived.

                    THE LAYER STAYS `pointerEvents: 'none'` AND THE BADGE TURNS
                    IT BACK ON (req #3503). The layer is a full-viewport div: any
                    pointer state on IT swallows every click on the canvas
                    beneath, which is the card's own title-area hit rect (req
                    #3213; it frames the step since req #3641). Only the badge itself — a ~20px pill sitting on its
                    own card — takes `pointerEvents: 'auto'`, the same one-clickable-
                    thing-inside-a-transparent-container override the initiative layer
                    above uses for its chips.

                    THE BADGE IS NO LONGER DECORATION. It counts one step's
                    requirements, so the obvious question it raises is "which
                    ones?", and the answer is a page that already exists: the
                    initiative chip's ↗-adjacent Cards link, scoped to a STEP instead
                    of an initiative. `stopPropagation` on BOTH handlers for that
                    control's reason — without it the card's own handler fires
                    too and focuses the step the reader is navigating away from. */}
                <Box sx={{ position: 'absolute', top: initiativeOverlayTopInset, left: 0,
                            right: 0, bottom: 0, pointerEvents: 'none',
                            overflow: 'hidden' }}
                     data-testid="pipeline-viz-badge-layer">
                    {floatingBadges.map((b) => (
                        <Box key={b.key}
                             role="link"
                             tabIndex={0}
                             aria-label={`Open step ${b.stepId}'s ${b.text} requirements in the Task Cards view`}
                             data-testid={`pipeline-viz-badge-open-${b.stepId}`}
                             onClick={(ev) => {
                                 ev.stopPropagation();
                                 const to = swarmStepLinkTo(b.stepId);
                                 if (to) navigate(to);
                             }}
                             onKeyDown={(ev) => {
                                 if (ev.key !== 'Enter') return;
                                 ev.stopPropagation();
                                 ev.preventDefault();
                                 const to = swarmStepLinkTo(b.stepId);
                                 if (to) navigate(to);
                             }}
                             // GEOMETRY IN `style`, NOT `sx` (req #3503 review
                             // — performance). `transform` is React state, so
                             // every pan/zoom frame re-renders this component,
                             // and `floatingBadges` is one entry per step on
                             // the WHOLE plan (unculled) — up to ~100 on a
                             // live plan. `sx` re-serializes through Emotion
                             // and inserts a stylesheet rule on every value
                             // change; a plain `style` object is a DOM
                             // property write, no CSS-in-JS involved. The
                             // static chrome below — colour, font, shape —
                             // never changes per frame and stays in `sx`.
                             style={{
                                 left: b.left,
                                 // Charged back against the container's own
                                 // inset — the initiative chip's identical note
                                 // applies verbatim: without it every badge
                                 // sits `initiativeOverlayTopInset` px lower than
                                 // `floatingBadges` placed it.
                                 top: b.top - initiativeOverlayTopInset,
                                 width: b.width, height: b.height,
                                 fontSize: b.fontSize,
                                 ...b.fold,
                             }}
                             sx={{
                                 position: 'absolute',
                                 pointerEvents: 'auto',
                                 cursor: 'pointer',
                                 display: 'flex', alignItems: 'center',
                                 justifyContent: 'center',
                                 borderRadius: '999px',
                                 bgcolor: P.badgeFill,
                                 color: P.badgeText,
                                 fontFamily: MONO, fontWeight: 700,
                                 lineHeight: 1,
                             }}
                        >
                            {b.text}
                        </Box>
                    ))}
                    {/* req #3650 — EVERY STEP CARD'S COLLAPSE HEAD, in the
                        box the layout reserved at the title line's left. Folds
                        THIS step's requirement rows and nothing else. The
                        chevron alone since req #3648 — `text` names it for
                        assistive tech only. Rendered BEFORE the run pills so
                        keyboard focus reaches a card's chevron first, the way
                        the line reads. */}
                    {floatingCollapses.map((c) => (
                        <PlanCollapseHead key={c.key}
                            open={c.open}
                            onToggle={() => toggleStepFold(c.stepId)}
                            label={null}
                            name={`${c.text} of step ${c.stepId}`}
                            testId={`pipeline-viz-step-collapse-${c.stepId}`}
                            style={{
                                position: 'absolute',
                                left: c.left,
                                top: c.top - initiativeOverlayTopInset,
                                width: c.width, height: c.height,
                                fontSize: c.fontSize,
                                justifyContent: 'center',
                                ...c.fold,
                            }}
                        />
                    ))}
                    {/* req #3580 — THE RUN-MODE PILL. Displays the step's run
                        mode as the word and IS the control that changes it:
                        green "auto", blue "manual" (user directive). Geometry
                        in `style` for the badge's per-frame reason;
                        `stopPropagation` so the card's own handlers never also
                        fire. */}
                    {floatingRuns.map((r) => {
                        const manual = r.run === 'manual';
                        const next = manual ? 'auto' : 'manual';
                        return (
                            <Box key={r.key}
                                 component="button"
                                 type="button"
                                 data-testid={`pipeline-viz-run-${r.stepId}`}
                                 data-run={r.run}
                                 aria-label={`Step ${r.stepId} runs ${r.run} — switch to ${next}`}
                                 title={`Runs ${r.run} — click to switch to ${next}`}
                                 aria-busy={r.pending || undefined}
                                 onClick={(ev) => {
                                     ev.stopPropagation();
                                     toggleRun(r.stepId, r.run);
                                 }}
                                 style={{
                                     left: r.left,
                                     top: r.top - initiativeOverlayTopInset,
                                     width: r.width, height: r.height,
                                     fontSize: r.fontSize,
                                     background: manual ? P.runManual : P.runAuto,
                                     ...r.fold,
                                     opacity: (r.pending ? 0.55 : 1) * (r.fold?.opacity ?? 1),
                                 }}
                                 sx={RUN_PILL_SX}
                            >
                                {CARD_RUN_WORDS[r.run]}
                            </Box>
                        );
                    })}
                    {/* req #3673 — THE BARRIER GATE. It shows its state as a
                        picture that differs in SHAPE and COLOUR — barrier arm
                        down (orange/white) or raised (grey) — and IS the control
                        that flips it. The hover title says what the state
                        means and what a click does. */}
                    {floatingFlags.map((f) => {
                        const row = rowById.get(f.stepId);
                        const onColor = P.barrierOn;
                        const color = f.on ? onColor : P.dim;
                        const title = barrierTitle(f.on, row?.lockedBy);
                        return (
                            <Box key={f.key}
                                 component="button"
                                 type="button"
                                 data-testid={`pipeline-viz-${f.kind}-${f.stepId}`}
                                 data-on={f.on ? '1' : '0'}
                                 aria-pressed={f.on}
                                 aria-label={`Step ${f.stepId}: ${title}`}
                                 title={title}
                                 onClick={(ev) => {
                                     ev.stopPropagation();
                                     if (row) toggleBarrier(row);
                                 }}
                                 style={{
                                     left: f.left,
                                     top: f.top - initiativeOverlayTopInset,
                                     width: f.size, height: f.size,
                                     fontSize: f.size * 0.74,
                                     color,
                                     borderColor: f.on ? onColor : rgba(P.dim, 0.8),
                                     borderStyle: 'solid',
                                     borderWidth: Math.max(1, CARD_TITLE_BTN_STROKE * t.k),
                                     background: f.on ? rgba(onColor, 0.16) : 'transparent',
                                     ...f.fold,
                                 }}
                                 sx={FLAG_BTN_SX}
                            >
                                <BarrierGateIcon closed={f.on}
                                                 stripe={P.barrierOn}
                                                 light={P.barrierLight}
                                                 fontSize="inherit" />
                            </Box>
                        );
                    })}
                    {/* req #3580 — THE STEP-NAME EDITOR, over the name's own
                        reserved room on its card. */}
                    {stepEditor && (
                        <PlanInPlaceInput
                            key={`step-edit-${stepEditor.row.id}`}
                            initial={stepEditor.row.title || ''}
                            saving={!!stepEdit?.saving}
                            ariaLabel={`Rename step ${stepEditor.row.id}`}
                            testId={`pipeline-viz-step-edit-${stepEditor.row.id}`}
                            onCommit={(raw) => commitStepTitle(stepEditor.row, raw)}
                            onCancel={() => setStepEdit(null)}
                            caretAt={stepEdit?.at}
                            style={{
                                position: 'absolute',
                                left: stepEditor.left,
                                top: stepEditor.top - initiativeOverlayTopInset,
                                width: stepEditor.width,
                                height: stepEditor.height,
                                fontSize: stepEditor.fontSize,
                            }}
                            sx={{ pointerEvents: 'auto', fontWeight: 400 }}
                        />
                    )}
                    {/* req #3661 — THE REQUIREMENT TITLE EDITOR, on the title's
                        own room in its row: same font, colour and lines as the
                        row draws, so editing changes nothing on screen but the
                        caret and the outline. */}
                    {reqEditor && (
                        <PlanInPlaceTitleArea
                            key={`req-edit-${reqEditor.reqId}-${reqEditor.stepId}`}
                            initial={layoutTitles.get(reqEditor.reqId) || ''}
                            label={reqEditor.label}
                            saving={!!reqEdit?.saving}
                            ariaLabel={`Rename requirement ${reqEditor.reqId}`}
                            testId={`pipeline-viz-req-edit-${reqEditor.reqId}`}
                            caretAt={reqEdit?.at}
                            onDraft={(title) => {
                                const reqId = reqEditor.reqId;
                                startTransition(() => setReqDrafts(
                                    (m) => new Map(m).set(reqId, title)));
                            }}
                            onCommit={(raw, opened) => commitReqTitle(
                                reqEditor.reqId, reqEditor.stepId, raw, opened)}
                            onCancel={() => {
                                dropReqDraft(reqEditor.reqId);
                                setReqEdit(null);
                            }}
                            indent={reqEditor.box.indent}
                            lineHeight={reqEditor.box.lineHeight}
                            color={reqEditor.color}
                            bold={reqEditor.bold}
                            style={{
                                position: 'absolute',
                                left: reqEditor.box.left,
                                top: reqEditor.box.top,
                                width: reqEditor.box.width,
                                height: reqEditor.box.height,
                                fontSize: reqEditor.box.fontSize,
                                pointerEvents: 'auto',
                            }}
                        />
                    )}
                </Box>

                {/* req #3583 — the step card a box row would land on. An HTML
                    outline over the canvas rather than a Konva shape, so the
                    world draws nothing new mid-drag: accent when the step takes
                    the requirement, dashed red when it will not (a locked
                    step). */}
                {seatTargetRect && (
                    <Box data-testid="pipeline-viz-seat-target"
                         data-step-id={seatTarget.stepId}
                         data-ok={seatTarget.ok ? '1' : '0'}
                         sx={{ position: 'absolute', pointerEvents: 'none',
                                left: seatTargetRect.left - 3, top: seatTargetRect.top - 3,
                                width: seatTargetRect.width + 6,
                                height: seatTargetRect.height + 6,
                                borderRadius: '9px',
                                border: seatTarget.ok
                                    ? `2px solid ${P.accent}` : '2px dashed #ff6b6b',
                                boxShadow: seatTarget.ok
                                    ? `0 0 0 4px ${P.accent}33` : 'none',
                                // Above the box while it is carried, so the
                                // outlined step shows through (req #3614) — and a
                                // carried box is a PLACED one, fixed in the window
                                // at UNSEATED_FLOAT_Z (req #3687); it takes no
                                // pointer, so hit-testing is unchanged.
                                zIndex: boxCarrying
                                    ? (boxFromRack ? RACK_DRAG_Z + 1 : UNSEATED_FLOAT_Z + 1) : 1 }} />
                )}

                {/* req #3583 — swarm-ready work no step carries yet, opening in
                    the top-right corner the key vacated for the bottom (req
                    #3255); its title bar moves it anywhere in the window, over
                    the navbar included (req #3687), and dropped ON the navbar it
                    racks there with the other Action Popups (req #3735). Its rows drag onto a step
                    card to seat them. Its type
                    is the requirement ids' own ON-SCREEN size — the card font
                    `CF.req` (world px) through the live zoom — so it shrinks and
                    grows with the marks it feeds (user directive), held within
                    9–16px so it stays usable at both zoom extremes (user
                    ruling). Its WIDTH is a step card's on-screen frame width,
                    whatever the Step Width rung and zoom (req #3620). The
                    reader may stretch it by its corner on top of that, its text
                    stepping one size up or down — the box owns that (req #3654).
                    Never bigger than at six steps across (req #3648 —
                    `unseatedBoxZoom`). */}
                <UnorchestratedReqBox
                    items={unseatedItems}
                    categoryColors={unseated.categoryColors}
                    isLoading={unseated.isLoading}
                    isError={unseated.isError}
                    fontPx={unseatedBoxFontPx(unseatedBoxZoom(t.k, size.w, layout.colPitch))}
                    widthPx={unseatedBoxWidthPx(layout.cardFrameW,
                        unseatedBoxZoom(t.k, size.w, layout.colPitch))}
                    statusColor={planPalette(activePalette).status?.swarm_ready || P.req}
                    idStyleOf={unseatedIdStyleOf}
                    onMoveOver={onBoxMoveOver}
                    onMoveDrop={onBoxMoveDrop}
                    onCarryingChange={setBoxCarrying}
                    // req #3817 — a requirement dragged off a step drops here
                    // to leave the plan.
                    dropTargetRef={unseatBoxRef}
                    dropArmed={reqDrag
                        ? (canUnseatFrom(rowById.get(reqDrag.fromStepId)) ? 'ok' : 'refused')
                        : null}
                    dropOver={dropOnBox}
                    onOpen={(id) => navigate(`/swarm/requirement/${id}`,
                        pipeline?.id
                            ? { state: planExitState(pipeline.id, 'plan') }
                            : undefined)} />

                {/* ── THE COLOUR HELP (req #3722; was THE KEY — req #3168) ───
                    A HOVER popup on the toolbar's chips. The key used to be a
                    panel parked at the canvas's bottom centre with a +/− that
                    read as "add something" (user: *"get that plus sign help off
                    the bottom of the visualizer"*); then a `?` chip beside the
                    colour chips (user: *"Remove the ?"*). Now each colour chip
                    explains ITSELF when the pointer rests on it — active or not
                    — and the Step chip explains the step marks. The page owns
                    the toolbar, so the hovered chip arrives as `keyHover`.
                    A LONG PRESS on a chip pins it (req #3766): `keyHover`
                    arrives with `pinned: true` and the toolbar holds it there
                    until the next press anywhere — see `useKeyHelp`.

                    The popup lives HERE because the key's data does (the ids
                    this plan draws decide whether an `unknown` swatch is
                    listed; the palette decides every colour), and every colour
                    still comes from the same pure module the canvas draws from,
                    so the key cannot describe a colour the plan is not using.
                    `pointerEvents: none` so the popup never takes the pointer
                    from the chip that opened it (it would flicker closed).
                    A Popper and not a Popover: a Popover is a Modal and
                    aria-hides the whole app, chip included, while open. */}
                {keyHover?.el?.isConnected && !maximized && (
                    <Popper
                        open
                        anchorEl={keyHover.el}
                        placement="bottom-start"
                        // Above the page's modals' floor but not a modal itself:
                        // a Popover would aria-hide the whole app while open.
                        sx={{ zIndex: 1400, pointerEvents: 'none' }}>
                        <Paper
                            role="tooltip"
                            data-testid="pipeline-viz-legend"
                            data-key={keyHover.key}
                            data-pinned={keyHover.pinned ? 'true' : 'false'}
                            sx={{
                                mt: 0.5, px: 1.25, py: 0.9, borderRadius: '10px',
                                background: 'rgba(13, 20, 32, 0.97)',
                                backgroundImage: 'none',
                                border: `1px solid ${P.line}`,
                                boxShadow: '0 6px 18px rgba(0, 0, 0, 0.45)',
                                userSelect: 'none', maxWidth: 'calc(100vw - 16px)',
                                '@keyframes pipeKeyPulse': {
                                    '0%, 100%': { opacity: 1 },
                                    '50%': { opacity: 0.45 },
                                },
                                '@keyframes pipeKeyBreathe': {
                                    '0%, 100%': { opacity: 1 },
                                    '50%': { opacity: 0.25 },
                                },
                            }}>
                        <Stack direction="column" spacing={0} useFlexGap>
                            {keyHover.key === 'step' ? (
                                <>
                            <KeyGroup title={KEY_GROUP_TITLES[0]} first>
                                {/* req #3742 — the STEP COLOUR, the card's
                                    border: one colour per step, first match
                                    wins in this order. */}
                                {[[P.lockedFrame, 'Locked', 'locked'],
                                    [P.stepManual, 'Manual', 'manual'],
                                    [P.stepBarrier, 'Barrier', 'barrier'],
                                    [P.stepWillRun, 'Will run', 'will-run']]
                                    .map(([color, label, key]) => (
                                        <LegendIcon key={key} label={label} color={color}>
                                            <Box component="span" aria-hidden="true"
                                                 data-testid={`pipeline-viz-legend-${key}-frame`}
                                                 sx={{ display: 'inline-block', width: 14,
                                                       height: 10, borderRadius: '3px',
                                                       border: `2px solid ${color}` }} />
                                        </LegendIcon>
                                    ))}
                                {/* Scheduled / Complete are the L1 bead's
                                    fill only — a card's bar is always its
                                    border colour (req #3775). */}
                                <LegendDot fill={P.pendingFill} ring="#5b7293"
                                           label="Scheduled (dot)" />
                                {/* req #3775 — Running is the MOTION, not a
                                    hue: the card's bar (the bead at L1)
                                    pulses in the step's own colour above, so
                                    the swatch is neutral and pulses. */}
                                <LegendDot fill={P.text} label="Running (pulses)"
                                           animated="pipeKeyPulse" />
                                <LegendDot fill={P.doneFill} label="Complete (dot)" />
                                {/* "Up Next" and not "eligible now" because the
                                    mark answers the question in the plan's own
                                    words: these are the steps that run next.
                                    Below k ≈ 0.3 the canvas swaps this dashed
                                    ring for a filled dot of the same on-screen
                                    size, in the SAME colour (req #3299,
                                    `nextMarkIsDot` in pipelinePlanLayout.js) —
                                    the ring cannot survive that deep a
                                    zoom-out, the fact it marks does not
                                    change, so the key does not grow a second
                                    swatch for it. */}
                                <LegendDot ring={P.eligibleRing} label="Up Next"
                                           dashed animated="pipeKeyBreathe" />
                            </KeyGroup>
                                </>
                            ) : (reqKeyScales[keyHover.key] && (
                                <Box data-testid="pipeline-viz-legend-reqscale">
                                    <KeyGroup title={reqColorScale(keyHover.key)?.keyTitle
                                        || KEY_GROUP_TITLES[1]} first>
                                        {reqKeyScales[keyHover.key].map((e) => (
                                            <LegendWord key={e.key} color={e.color}
                                                        label={e.label} />
                                        ))}
                                    </KeyGroup>
                                </Box>
                            ))}
                        </Stack>
                        </Paper>
                    </Popper>
                )}

                {/* ── MAXIMIZE (req #3658; placement req #3793) ─────────────
                    The TPU 3D views' Full screen switch, borrowed (user
                    direction: "Borrow the button"), now the shared
                    `FullscreenSwitch`. ONE switch, two homes, by the user's
                    rule (req #3793): with the controls on screen it sits in
                    the controls' header row (PipelineDetail draws it there,
                    right of the plan's title); MAXIMIZED the header row is
                    hidden, so no controls are on screen and it sits HERE, in
                    the canvas's UPPER-LEFT corner — and only here, so the one
                    `pipeline-viz-maximize` is always the switch on screen.

                    This SUPERSEDES req #3658's bottom-right corner in both
                    states, which rested on "a switch should not move when
                    clicked". The user's placement rule (req #3793) outranks
                    that: the switch now moves from the header to the corner
                    as the header goes, as the TPU views' switch stays with
                    their controls' header.

                    The corner, and why nothing important is under it: it sits
                    INSIDE the pinned time ruler's strip (`MAXIMIZE_SWITCH`, 5 +
                    26 px of the strip's ≥ 36 px), which is chrome. The initiative
                    names are clamped below `rulerScreenBottom(t)` (≥ 36 px), so
                    none reaches it; the one ruler date that could start under
                    it is THINNED there (`drawnRulerLabelKeys` starts from the
                    switch's right edge, `maximizeSwitchWorldRight`), the
                    strip's own rule for a label with no room, and comes back
                    as soon as a pan clears it. The
                    Active box is home bottom-left and the Orchestration Ready
                    box top-right — and either can be dragged here, so the
                    switch sits ABOVE both (`MAXIMIZE_SWITCH_Z`): it must never
                    be covered, it is the only way back on screen.
                    `data-viz-chrome` keeps d3-zoom and the bead hit-test off
                    it. */}
                {maximized && onToggleMaximized && (
                    <FullscreenSwitch
                        on
                        onToggle={onToggleMaximized}
                        variant="floating"
                        testid="pipeline-viz-maximize"
                        data-viz-chrome="maximize"
                        enterLabel={MAXIMIZE_LABELS.enterLabel}
                        leaveLabel={MAXIMIZE_LABELS.leaveLabel}
                        enterTitle={MAXIMIZE_LABELS.enterTitle}
                        leaveTitle={MAXIMIZE_LABELS.leaveTitle}
                        sx={{ position: 'absolute',
                              left: MAXIMIZE_SWITCH.left, top: MAXIMIZE_SWITCH.top,
                              zIndex: MAXIMIZE_SWITCH_Z }} />
                )}

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
            </Box>

            {/* req #3608 — the whole swarm-ready box dropped on a step. The
                list is the box as it stood at the drop, so what is approved is
                what was shown. */}
            <Dialog open={bulkSeatOpen} onClose={closeBulkSeat} fullWidth maxWidth="xs"
                    slotProps={{ transition: { onExited: () => setBulkSeat(null) } }}
                    data-testid="pipeline-viz-bulk-seat-dialog">
                <DialogTitle>
                    {bulkSeat && `Move ${bulkSeat.reqs.length === 1
                        ? 'this requirement' : `these ${bulkSeat.reqs.length} requirements`}?`}
                </DialogTitle>
                <DialogContent>
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}
                                data-testid="pipeline-viz-bulk-seat-summary">
                        {bulkSeat && `Onto "${bulkSeat.stepTitle}". Every swarm-ready `
                            + 'requirement not yet on a step is seated there.'}
                    </Typography>
                    <Box component="ul" data-testid="pipeline-viz-bulk-seat-list"
                         sx={{ m: 0, p: 0, listStyle: 'none', maxHeight: 280, overflowY: 'auto' }}>
                        {(bulkSeat?.reqs || []).map((r) => (
                            <Typography component="li" variant="body2" key={r.id} noWrap
                                        sx={{ py: 0.25 }}>
                                <Box component="span" sx={{ fontWeight: 700, mr: 1 }}>{r.id}</Box>
                                {r.title}
                            </Typography>
                        ))}
                    </Box>
                </DialogContent>
                <DialogActions>
                    <Button onClick={closeBulkSeat} disabled={bulkSeating || !bulkSeatOpen}
                            data-testid="pipeline-viz-bulk-seat-cancel">Cancel</Button>
                    <Button variant="contained" onClick={commitBulkSeat}
                            disabled={bulkSeating || !bulkSeatOpen}
                            autoFocus data-testid="pipeline-viz-bulk-seat-confirm">
                        {bulkSeating ? 'Moving…' : 'Move'}
                    </Button>
                </DialogActions>
            </Dialog>

            {/* req #3586 — the add-step dialog. Portalled to the body, so a
                click inside it never reaches the canvas's own click test. */}
            {/* req #3742 — the single editor a click on a step or an initiative opens. */}
            {planEditor.kind === 'step' && (
                <StepEditDialog
                    key={`plan-step-editor-${planEditor.key}`}
                    open={planEditor.open}
                    step={planEditor.target}
                    initiativeOptions={insertInitiativeOptions}
                    onClose={closePlanEditor}
                    onSaved={refreshPlan}
                />
            )}
            {planEditor.kind === 'initiative' && (
                <InitiativeEditDialog
                    key={`plan-initiative-editor-${planEditor.key}`}
                    open={planEditor.open}
                    initiative={planEditor.target}
                    pipelineOptions={pipeline ? [{ id: pipeline.id, title: pipeline.title }] : []}
                    onClose={closePlanEditor}
                    onSaved={refreshPlan}
                />
            )}
            <Dialog open={insertReq != null} onClose={closeInsert} fullWidth maxWidth="xs"
                    data-testid="pipeline-viz-insert-dialog">
                <DialogTitle data-testid="pipeline-viz-insert-heading">
                    {{
                        edge: 'Insert a step',
                        precede: 'Add a step before',
                        dependent: 'Add a dependent step',
                    }[insertReq?.kind]}
                </DialogTitle>
                <DialogContent>
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}
                                data-testid="pipeline-viz-insert-summary">
                        {insertReq?.kind === 'edge'
                            ? `Between "${insertReq.fromTitle}" and "${insertReq.toTitle}". `
                              + 'The new step waits on the first; the second waits on the new step.'
                            : insertReq?.kind === 'precede'
                                ? `"${insertReq.toTitle}" will wait on the new step.`
                            : insertReq
                                ? `Depends on "${insertReq.fromTitle}" only.`
                                : ''}
                    </Typography>
                    <TextField autoFocus fullWidth size="small" label="Title"
                               value={insertTitle}
                               onFocus={(e) => e.target.select()}
                               onChange={(e) => setInsertTitle(e.target.value)}
                               onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commitInsert(); } }}
                               inputProps={{ 'data-testid': 'pipeline-viz-insert-title' }}
                               sx={{ mb: 2 }} />
                    <TextField select fullWidth size="small" label="Initiative"
                               value={insertInitiative}
                               onChange={(e) => setInsertInitiative(e.target.value)}
                               inputProps={{ 'data-testid': 'pipeline-viz-insert-initiative' }}>
                        {insertInitiativeOptions.map((e) => (
                            <MenuItem key={e.id} value={e.id}>{e.title || `Initiative ${e.id}`}</MenuItem>
                        ))}
                    </TextField>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => closeInsert()} disabled={inserting}>Cancel</Button>
                    <Button variant="contained" onClick={commitInsert}
                            disabled={inserting || !insertTitle.trim()}
                            data-testid="pipeline-viz-insert-create">
                        {inserting ? 'Creating…' : 'Create'}
                    </Button>
                </DialogActions>
            </Dialog>

            {/* req #3719 — the add-initiative dialog (the "+" under the last initiative). */}
            <Dialog open={initiativeAddOpen} onClose={closeInitiativeAdd} fullWidth maxWidth="xs"
                    data-testid="pipeline-viz-initiative-add-dialog">
                <DialogTitle>Add an initiative</DialogTitle>
                <DialogContent>
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                        Added at the end of this plan, with a first step so it shows on the canvas.
                    </Typography>
                    <TextField autoFocus fullWidth size="small" label="Title"
                               value={initiativeAddTitle}
                               onFocus={(e) => e.target.select()}
                               onChange={(e) => setInitiativeAddTitle(e.target.value)}
                               onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commitInitiativeAdd(); } }}
                               inputProps={{ 'data-testid': 'pipeline-viz-initiative-add-title' }}
                               sx={{ mb: 2 }} />
                    <TextField select fullWidth size="small" label="Category"
                               value={initiativeAddCategory}
                               onChange={(e) => setInitiativeAddCategory(e.target.value)}
                               inputProps={{ 'data-testid': 'pipeline-viz-initiative-add-category' }}>
                        {initiativeAddCategories.map((c) => (
                            <MenuItem key={c.id} value={c.id}>{c.category_name}</MenuItem>
                        ))}
                    </TextField>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => closeInitiativeAdd()} disabled={initiativeAdding}>Cancel</Button>
                    <Button variant="contained" onClick={commitInitiativeAdd}
                            disabled={initiativeAdding || !initiativeAddTitle.trim() || initiativeAddCategory === ''}
                            data-testid="pipeline-viz-initiative-add-create">
                        {initiativeAdding ? 'Creating…' : 'Create'}
                    </Button>
                </DialogActions>
            </Dialog>
        </Box>
        </DarwinDndContext>
    );
}
