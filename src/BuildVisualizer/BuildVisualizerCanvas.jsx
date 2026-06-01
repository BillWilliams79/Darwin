// Build Visualizer — pure React SVG renderer (req #2694 / #2720).
//
// Consumes the output of `computeLayout` and emits SVG primitives. Adds:
//   - Stratum band labels along the left edge (one per non-empty stratum)
//   - Mouse-drag panning (click anywhere outside dots/labels and drag)
//   - Build-dot click targets (cursor: pointer; onClick callback to parent)

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';

import { computeLayout } from './d3LayoutEngine';
import { BRANCH_TYPES } from './branchTypeChipStyles';
import { computeHiddenBranchIds } from './visibilityRules';
import paletteFor from './d3ThemePalettes';
import { frameView } from './frameStrategies';
import { starColorFor } from './starColors';
import {
    DEFAULT_DARK_VARIANT,
    LIGHT_TRANSPORT_VARIANT,
} from './themeVariants';

const ARROW_ID = 'bv-d3-arrow';
const ARROW_WHISPY_ID = 'bv-d3-arrow-whispy';

// frameView imported from './frameStrategies' — single source of truth (req #2741).
// See that module for FRAME_STRATEGIES and the centerMain algorithm.

function dotFill(record, palette) {
    if (record.dotColor === 'green')  return palette.dotGreen;
    if (record.dotColor === 'red')    return palette.dotRed;
    if (record.dotColor === 'yellow') return palette.dotYellow;
    if (record.dotColor === 'gray')   return palette.dotGray;
    if (!record.dotColor && record.approvedForRelease) return palette.dotApproved;
    return palette.dotDefault;
}

function starPoints(cx, cy, ro, ri, tips) {
    const step = Math.PI / tips;
    let a = -Math.PI / 2;
    const pts = [];
    for (let i = 0; i < tips * 2; i++) {
        const r = i % 2 === 0 ? ro : ri;
        pts.push(`${(cx + Math.cos(a) * r).toFixed(2)},${(cy + Math.sin(a) * r).toFixed(2)}`);
        a += step;
    }
    return pts.join(' ');
}

// starColorFor imported from './starColors' — single source of truth (req #2741).

function StarRow({ pos, customers, color }) {
    // One star PER release event (req #2741) — 6 releases ⇒ 6 stars — in a row
    // centered on the build, ABOVE the bubble. `color` is chosen from the build's
    // branch type by the caller (gold / silver / red).
    const n = customers.length;
    const ro = 7;
    const ri = ro * 0.45;
    const pitch = 2 * ro + 2;            // star width + gap
    const cy = pos.y - 22;
    const startX = pos.x - ((n - 1) * pitch) / 2;
    return (
        <g>
            {customers.map((name, i) => (
                <polygon
                    key={`${name}-${i}`}
                    points={starPoints(startX + i * pitch, cy, ro, ri, 5)}
                    fill={color.fill}
                    stroke={color.stroke}
                    strokeWidth={1.1}
                    strokeLinejoin="round"
                />
            ))}
        </g>
    );
}

function formatReleaseDate(d) {
    if (!d) return '';
    const dt = new Date(d);
    return Number.isNaN(dt.getTime()) ? '' : dt.toLocaleDateString();
}

// Hover content for a release bubble (req #2741) — the build it shipped, the
// branch, and each customer release event with its date. Falls back to the
// plain customer-name list when no dated details are available.
function ReleaseTooltipContent({ build, branchName }) {
    const details = build.releaseDetails?.length
        ? build.releaseDetails
        : (build.releaseCustomers || []).map(name => ({ name, date: null }));
    return (
        <Box sx={{ py: 0.25 }}>
            <Typography variant="caption" sx={{ fontWeight: 700, display: 'block' }}>
                Released — Build {build.version}
            </Typography>
            {branchName ? (
                <Typography variant="caption" sx={{ display: 'block', opacity: 0.8 }}>
                    {branchName}
                </Typography>
            ) : null}
            <Box component="ul" sx={{ m: 0, mt: 0.5, pl: 2 }}>
                {details.map((d, i) => (
                    <Box component="li" key={`${d.name}-${i}`} sx={{ fontSize: '0.72rem', lineHeight: 1.5 }}>
                        {d.name}{d.date ? ` — ${formatReleaseDate(d.date)}` : ''}
                    </Box>
                ))}
            </Box>
        </Box>
    );
}

const BuildVisualizerCanvas = ({
    model,
    projectId,
    isLoading,
    error,
    selectedTypes,
    staggerOn,
    showReleases,
    appMode,
    darkVariant,
    onBuildClick,
    onBuildLeave,
    onBranchClick,
    onEmptyAnchorClick,
    resetViewNonce,
}) => {
    const themeKey = appMode === 'dark'
        ? (darkVariant || DEFAULT_DARK_VARIANT)
        : LIGHT_TRANSPORT_VARIANT;
    const palette = paletteFor(themeKey);

    const hiddenBranchIds = useMemo(() => {
        if (!model?.branches?.length) return new Set();
        return computeHiddenBranchIds({
            branches: model.branches,
            selectedTypes: selectedTypes || BRANCH_TYPES,
            allTypes: BRANCH_TYPES,
        });
    }, [model, selectedTypes]);

    const layout = useMemo(
        () => computeLayout(
            model || { branches: [], builds: {}, releaseEvents: {} },
            { versionLanes: !!staggerOn, hiddenBranchIds },
        ),
        [model, staggerOn, hiddenBranchIds],
    );

    // branch extId → display name, for the release hover tooltip.
    const branchNameById = useMemo(() => {
        const m = new Map();
        for (const br of layout.branches || []) m.set(br.id, br.name);
        return m;
    }, [layout]);

    // extId of the trunk, so its endpoint label opens the same branch editor.
    const mainBranchId = useMemo(
        () => (layout.branches || []).find(b => b.isMain)?.id || null,
        [layout],
    );

    // Open the branch editor from a name-label click — suppressed mid-drag so
    // panning across a label doesn't pop the editor (mirrors the dot menu).
    const handleBranchLabelClick = useCallback((branchId, e) => {
        if (dragRef.current.active || dragRef.current.moved) return;
        e.stopPropagation();
        if (onBranchClick && branchId) onBranchClick(branchId);
    }, [onBranchClick]);

    // ─── Mouse-drag panning ────────────────────────────────────────────
    // Click anywhere on the viewport background and drag to pan the SVG.
    // Mirrors the iframe's OmniScroller. Build dots / labels keep their
    // own click behavior because the dragger only fires on mousedown that
    // doesn't propagate from those (we don't preventDefault inside dot
    // / label elements; their parent gets the event after).
    const viewportRef = useRef(null);
    const [pan, setPan] = useState({ x: 0, y: 0 });
    const dragRef = useRef({ active: false, startX: 0, startY: 0, panX: 0, panY: 0 });

    const onMouseDown = useCallback((e) => {
        // Only the primary button starts a pan.
        if (e.button !== 0) return;
        dragRef.current = {
            active: true,
            moved: false,
            startX: e.clientX,
            startY: e.clientY,
            panX: pan.x,
            panY: pan.y,
        };
        if (viewportRef.current) viewportRef.current.style.cursor = 'grabbing';
    }, [pan.x, pan.y]);

    const onMouseMove = useCallback((e) => {
        const d = dragRef.current;
        if (!d.active) return;
        const dx = e.clientX - d.startX;
        const dy = e.clientY - d.startY;
        // Mark as a real drag once the mouse moves more than 3 px — prevents
        // accidental micro-movements from suppressing dot clicks.
        if (!d.moved && (Math.abs(dx) > 3 || Math.abs(dy) > 3)) {
            d.moved = true;
        }
        setPan({ x: d.panX + dx, y: d.panY + dy });
    }, []);

    const endDrag = useCallback(() => {
        dragRef.current.active = false;
        if (viewportRef.current) viewportRef.current.style.cursor = 'grab';
    }, []);

    useEffect(() => {
        // Window-level listeners so a drag still tracks if the mouse leaves
        // the viewport bounds.
        window.addEventListener('mousemove', onMouseMove);
        window.addEventListener('mouseup', endDrag);
        return () => {
            window.removeEventListener('mousemove', onMouseMove);
            window.removeEventListener('mouseup', endDrag);
        };
    }, [onMouseMove, endDrag]);

    // Measure the live viewport + apply a framing strategy — the ONE place pan
    // is (re)computed (req #2741). Retries across animation frames until the
    // viewport element reports a NON-ZERO height: a freshly-created/switched
    // project can read clientHeight === 0 (box still mounting / CSS grid sizing)
    // at the moment the framing effect fires. The old code papered over that
    // with a `|| 600` fallback, so main was centered against a phantom 600px
    // viewport and landed ~1/3 from the top on a taller monitor. We never apply
    // a guessed height now — we wait for the real one, call `onFramed` only on
    // success, and return a canceller. `frameView` stays the single source of
    // truth for WHERE the trunk lands; this wrapper only handles measurement.
    const runFrame = useCallback((onFramed) => {
        let raf = 0;
        let tries = 0;
        const attempt = () => {
            const height = viewportRef.current?.clientHeight || 0;
            if (height > 0) {
                setPan(frameView(layout, { height }));
                onFramed?.();
                return;
            }
            if (tries++ < 120) raf = requestAnimationFrame(attempt); // ~2s budget
        };
        attempt();
        return () => { if (raf) cancelAnimationFrame(raf); };
    }, [layout]);

    // Frame the default view ONCE per project identity (req #2737). Keyed on
    // `projectId`, not on `layout`, so filter/stagger toggles — which change
    // `layout` but not the project — never yank the user's current pan. Waits
    // for this project's layout to have branches (data load is async), then
    // frames; the project is marked framed ONLY after a real height is measured
    // (`onFramed`), so a transient 0px read can't lock in a wrong pan. Covered
    // cases: first mount, project switch, new-project create, post-delete
    // fallback.
    const lastFitProjectId = useRef(null);
    useEffect(() => {
        if (projectId == null) { lastFitProjectId.current = null; return; }
        if (!layout.branches.length) return;          // layout not ready yet
        if (lastFitProjectId.current === projectId) return; // already framed
        return runFrame(() => { lastFitProjectId.current = projectId; });
    }, [projectId, layout, runFrame]);

    // Explicit "Reset view" trigger (req #2741). Keyed ONLY on `resetViewNonce`
    // (bumped by the toolbar control) so it fires on demand and NEVER on
    // filter/stagger/layout changes — preserving the user's pan otherwise. A ref
    // holds the latest `runFrame` so the effect re-centers against the current
    // layout without taking `runFrame` (→ `layout`) as a dependency. `nonce` is
    // 0 on mount, so the first real reset is 1 — the initial value is skipped.
    const runFrameRef = useRef(runFrame);
    runFrameRef.current = runFrame;
    useEffect(() => {
        if (!resetViewNonce) return; // 0 = initial, no reset requested
        return runFrameRef.current();
    }, [resetViewNonce]);

    // Keep the view STABLE across in-place layout reflows (req #2741). Hiding a
    // branch type (e.g. Release) collapses a whole stratum, so `mainY` shrinks
    // and EVERY branch Y shifts up. With a fixed pan the graph would visibly
    // jump. To preserve "what the user was looking at", compensate the pan by
    // the change in `mainY` — the trunk (and everything anchored to it) keeps
    // its on-screen position; only the toggled branches appear/disappear.
    //
    // Gated on DATA IDENTITY (`model` reference): a filter/stagger toggle
    // recomputes `layout` while `model` stays the same object, so we compensate;
    // a project switch / data reload gives a NEW `model`, so we skip and let
    // runFrame own positioning. This is strategy-agnostic — it does NOT assume
    // the framing function is linear in `mainY`, so new FRAME_STRATEGIES stay
    // safe. Also skipped until the project is initially framed.
    const prevMainYRef = useRef(null);
    const prevModelRef = useRef(null);
    useEffect(() => {
        const mainY = layout?.mainY ?? null;
        const prevMainY = prevMainYRef.current;
        const sameData = model != null && prevModelRef.current === model;
        prevMainYRef.current = mainY;
        prevModelRef.current = model;
        if (!sameData) return;                              // project switch / reload
        if (prevMainY == null || mainY == null) return;     // nothing to compare
        if (lastFitProjectId.current !== projectId) return; // not yet framed
        const delta = prevMainY - mainY;
        if (delta !== 0) setPan(p => ({ ...p, y: p.y + delta }));
    }, [layout, model, projectId]);

    if (isLoading) {
        return (
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
                <CircularProgress />
            </Box>
        );
    }
    if (error) {
        return (
            <Box sx={{ p: 2, color: 'error.main' }}>
                Error loading build data: {error?.message || String(error)}
            </Box>
        );
    }
    if (!layout.branches.length) {
        return (
            <Box sx={{ p: 2, color: 'text.secondary' }}>
                No branches in the selected project.
            </Box>
        );
    }

    return (
        <Box
            ref={viewportRef}
            onMouseDown={onMouseDown}
            sx={{
                width: '100%',
                height: '100%',
                overflow: 'hidden',
                bgcolor: palette.bg,
                cursor: 'grab',
                position: 'relative',
                userSelect: 'none',
            }}
            data-testid="build-visualizer-canvas"
        >
            <svg
                width={layout.width}
                height={layout.height}
                className="build-graph"
                style={{
                    display: 'block',
                    fontFamily: palette.labelFont,
                    transform: `translate(${pan.x}px, ${pan.y}px)`,
                    transformOrigin: '0 0',
                }}
            >
                {/* New branch/build groups mount with a fresh key → fade in
                    once (req #2737). Existing elements have stable keys, so they
                    never remount and never replay the animation. */}
                <style>{'@keyframes bvFadeIn{from{opacity:0}to{opacity:1}}.bv-fade{animation:bvFadeIn 240ms ease-out}'}</style>
                <defs>
                    <marker id={ARROW_ID} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
                        <path d="M0,0 L10,5 L0,10 z" fill={palette.line} />
                    </marker>
                    <marker id={ARROW_WHISPY_ID} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
                        <path d="M0,0 L10,5 L0,10 z" fill={palette.lineWhispy} />
                    </marker>
                </defs>

                {/* 0. Stratum bands — per-stratum background tint (req #2720) */}
                <g className="strata">
                    {layout.strata.map((s) => (
                        <g key={s.id}>
                            <rect
                                x={0}
                                y={s.yTop}
                                width={layout.width}
                                height={s.yBottom - s.yTop}
                                fill={s.bandFill || 'transparent'}
                                pointerEvents="none"
                            />
                            <text
                                x={6}
                                y={(s.yTop + s.yBottom) / 2 + 4}
                                fontSize={10}
                                fontWeight={600}
                                fill={palette.label}
                                opacity={0.45}
                                pointerEvents="none"
                            >
                                {s.label} {s.laneCount > 1 ? `(${s.laneCount} lanes)` : ''}
                            </text>
                        </g>
                    ))}
                </g>

                {/* 1. Connectors — curve (arrow) and branch line rendered as
                   SEPARATE paths. The curve may go whispy when it crosses
                   another display item (so underlying labels stay readable),
                   but the branch's own horizontal data line ALWAYS stays
                   solid — it carries the branch identity and the build dots. */}
                <g className="lines">
                    {layout.mainPath && (
                        <path
                            d={layout.mainPath.d}
                            fill="none"
                            stroke={palette.line}
                            strokeWidth={1.4}
                            markerEnd={layout.mainPath.hasArrow ? `url(#${ARROW_ID})` : undefined}
                        />
                    )}
                    {layout.connectors.map(c => (
                        <g key={c.branchId} className="bv-fade">
                            <path
                                d={c.curveD}
                                fill="none"
                                stroke={c.curveWhispy ? palette.lineWhispy : palette.line}
                                strokeWidth={c.curveWhispy ? 0.9 : 1.4}
                                strokeDasharray={c.curveWhispy ? '3 2' : undefined}
                                opacity={c.curveWhispy ? 0.85 : 1}
                            />
                            <path
                                d={c.lineD}
                                fill="none"
                                stroke={palette.line}
                                strokeWidth={1.4}
                                markerEnd={c.hasArrow ? `url(#${ARROW_ID})` : undefined}
                            />
                        </g>
                    ))}
                </g>

                {/* 2. Labels */}
                <g className="labels">
                    {layout.branches.map(b => {
                        if (b.isMain) return null;
                        if (b.labelX == null || !b.name) return null;
                        const lines = String(b.name).split('\n');
                        return (
                            <g
                                key={`label-${b.id}`}
                                className="bv-fade"
                                data-branch-id={b.id}
                                style={{ cursor: onBranchClick ? 'pointer' : 'default' }}
                                onClick={(e) => handleBranchLabelClick(b.id, e)}
                            >
                                {lines.map((line, i) => (
                                    <text
                                        key={`${b.id}-line-${i}`}
                                        x={b.labelX}
                                        y={b.labelY - (lines.length - 1 - i) * 18}
                                        fontSize={14}
                                        fontWeight={600}
                                        fill={palette.label}
                                        textAnchor="start"
                                    >
                                        {line}
                                    </text>
                                ))}
                            </g>
                        );
                    })}
                    {layout.mainEndpointLabels && (
                        <g>
                            <text
                                x={layout.mainEndpointLabels.leftX}
                                y={layout.mainEndpointLabels.leftY}
                                fontSize={14}
                                fontWeight={600}
                                fill={palette.label}
                                textAnchor="end"
                                data-branch-id={mainBranchId || undefined}
                                style={{ cursor: (onBranchClick && mainBranchId) ? 'pointer' : 'default' }}
                                onClick={(e) => handleBranchLabelClick(mainBranchId, e)}
                            >
                                {layout.mainEndpointLabels.leftText}
                            </text>
                            {layout.mainEndpointLabels.rightText && (
                                <text
                                    x={layout.mainEndpointLabels.rightX}
                                    y={layout.mainEndpointLabels.rightY}
                                    fontSize={14}
                                    fontWeight={600}
                                    fill={palette.label}
                                    textAnchor="start"
                                >
                                    {layout.mainEndpointLabels.rightText}
                                </text>
                            )}
                        </g>
                    )}
                </g>

                {/* 3. Dots + version labels + click targets */}
                <g className="dots">
                    {layout.builds.map(b => {
                        const color = dotFill(b, palette);
                        // Open the build menu on HOVER (req #2737). Suppressed
                        // mid-pan so dragging across the canvas doesn't pop menus.
                        const openMenu = (e) => {
                            if (dragRef.current.active || dragRef.current.moved) return;
                            e.stopPropagation();
                            if (onBuildClick) onBuildClick(b, e);
                        };
                        return (
                            <g
                                key={b.id}
                                className="bv-fade"
                                style={{ cursor: 'pointer' }}
                                onMouseEnter={openMenu}
                                onClick={openMenu}
                                onMouseLeave={() => { if (onBuildLeave) onBuildLeave(); }}
                            >
                                <circle cx={b.x} cy={b.y} r={b.radius} fill={color.fill} stroke={color.stroke} strokeWidth={1.4} />
                                {/* Transparent hit-area — easier to click than the 5.5 px dot */}
                                <circle cx={b.x} cy={b.y} r={Math.max(b.radius + 4, 10)} fill="transparent" pointerEvents="all" />
                                <text x={b.versionX} y={b.versionY} textAnchor="middle" fontSize={9} fontFamily={palette.versionFont} fill={palette.version}>{b.version}</text>
                            </g>
                        );
                    })}
                </g>

                {/* 3b. Empty-branch anchors — hover targets at the first-build
                    slot on branches with zero builds. Opens an Execute-Build-only
                    menu via onEmptyAnchorClick. */}
                {(layout.emptyAnchors || []).length > 0 && (
                    <g className="empty-anchors">
                        {layout.emptyAnchors.map(a => {
                            const openAnchorMenu = (e) => {
                                if (dragRef.current.active || dragRef.current.moved) return;
                                e.stopPropagation();
                                if (onEmptyAnchorClick) onEmptyAnchorClick(a.branchId, e);
                            };
                            return (
                                <g
                                    key={`empty-${a.branchId}`}
                                    style={{ cursor: 'pointer' }}
                                    onMouseEnter={openAnchorMenu}
                                    onClick={openAnchorMenu}
                                    onMouseLeave={() => { if (onBuildLeave) onBuildLeave(); }}
                                >
                                    <circle
                                        cx={a.x}
                                        cy={a.y}
                                        r={Math.max(a.radius + 4, 10)}
                                        fill="transparent"
                                        pointerEvents="all"
                                    />
                                </g>
                            );
                        })}
                    </g>
                )}

                {/* 4. Release overlays — each carries a hover tooltip with the
                    release event details (req #2741). The tooltip triggers on
                    the glyph's own painted shapes; we intentionally do NOT lay a
                    transparent hit-rect over the dot, so the build dot still
                    opens its own menu on hover. */}
                {showReleases && (
                    <g className="release-overlays">
                        {layout.builds
                            .filter(b => b.releaseCustomers?.length)
                            .map(b => (
                                <Tooltip
                                    key={`release-${b.id}`}
                                    title={<ReleaseTooltipContent build={b} branchName={branchNameById.get(b.branchId)} />}
                                    placement="top"
                                    arrow
                                    enterDelay={120}
                                    enterTouchDelay={120}
                                >
                                    <g style={{ cursor: 'help' }}>
                                        <StarRow
                                            pos={{ x: b.x, y: b.y }}
                                            customers={b.releaseCustomers}
                                            color={starColorFor(b.branchType)}
                                        />
                                    </g>
                                </Tooltip>
                            ))}
                    </g>
                )}
            </svg>
        </Box>
    );
};

export default BuildVisualizerCanvas;
