// KonvaBuildCanvas.jsx — Konva render layer for the Build Visualizer (req #2864).
//
// Re-platforms the build diagram from React-rendered SVG (BuildVisualizerCanvas's
// old body) onto a Konva canvas, mirroring the Swarm Visualizer migration
// (req #2841): a single <Stage>/<Layer> with ONE wrapping <Group> whose
// {x, y, k} transform is supplied by the d3-zoom BEHAVIOR (drag-pan + cursor-
// centered wheel zoom). The diagram LAYOUT lives in world coordinates and the
// Group scales it by k, so the graph spreads apart as you zoom; every GLYPH size
// (dot radius, stroke width, font size) is multiplied by `inv = 1/k`, so on a
// k-scaled group its on-screen size is `size * inv * k = size` — constant and
// crisp at any zoom (the same trick the swarm canvas uses for beads/labels).
//
// Continuous zoom drives SEMANTIC level-of-detail: the zoom ratio (k / kBase)
// auto-selects L1 (out, most compact) → L2 (mid) → L3 (full detail), and a
// toolbar control can PIN a level. The level + the per-token expand set feed
// `computeSemanticModel`, which collapses build-runs into `__gap__` sentinels;
// `computeLayout` is collapse-aware and emits clickable "…" tokens.
//
// Interactions are resolved through Konva's hit-graph (getIntersection + a fired
// 'activate' event, exactly like the swarm canvas, because d3-zoom can swallow
// Konva's synthetic click): build dots open the page's MUI dot-menu (hover +
// click, positioned at the pointer's clientX/clientY); branch labels open the
// branch editor; "…" tokens toggle expansion; release stars and empty-branch
// anchors hover. The build-dot rich menu stays an MUI Popover in the page — only
// the release-star tooltip becomes a shared HTML overlay.

import {
    memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState,
} from 'react';
import { Stage, Layer, Group, Rect, Circle, Text, Path, Arrow, Star } from 'react-konva';
import { select } from 'd3-selection';
import { zoom as d3zoom, zoomIdentity } from 'd3-zoom';

import { computeLayout } from './d3LayoutEngine';
import { computeSemanticModel, autoLevel, isGapId } from './semanticModel';
import { BRANCH_TYPES } from './branchTypeChipStyles';
import { computeHiddenBranchIds } from './visibilityRules';
import paletteFor from './d3ThemePalettes';
import { starColorFor } from './starColors';
import { DEFAULT_DARK_VARIANT, LIGHT_TRANSPORT_VARIANT } from './themeVariants';

// On-screen glyph sizes (px) — multiplied by inv at draw time so they stay
// constant regardless of zoom.
const LINE_W = 1.4;
const STAR_OUTER = 7;
const VERSION_FONT = 9;
const LABEL_FONT = 14;
const TOKEN_FONT = 16;
const HOVER_OPEN_DELAY = 260;   // ms the pointer must rest on a dot before its menu opens

// Parse "M x1 y1 L x2 y2" (the only shape layout emits for straight lines) into
// [x1, y1, x2, y2]. Beziers are rendered as Path and never parsed here.
function lineEndpoints(d) {
    const nums = (d.match(/-?\d+(?:\.\d+)?/g) || []).map(Number);
    if (nums.length < 4) return null;
    return [nums[0], nums[1], nums[nums.length - 2], nums[nums.length - 1]];
}

function dotColors(record, palette) {
    if (record.dotColor === 'green')  return palette.dotGreen;
    if (record.dotColor === 'red')    return palette.dotRed;
    if (record.dotColor === 'yellow') return palette.dotYellow;
    if (record.dotColor === 'gray')   return palette.dotGray;
    if (!record.dotColor && record.approvedForRelease) return palette.dotApproved;
    return palette.dotDefault;
}

function formatReleaseDate(d) {
    if (!d) return '';
    const dt = new Date(d);
    return Number.isNaN(dt.getTime()) ? '' : dt.toLocaleDateString();
}

const KonvaBuildCanvas = ({
    model,
    projectId,
    selectedTypes,
    staggerOn,
    showReleases,
    appMode,
    darkVariant,
    pinnedLevel = null,            // null = auto-by-zoom; 1|2|3 = pinned
    onEffectiveLevel,              // report the active level back to the toolbar
    onBuildClick,
    onBuildLeave,
    onBranchClick,
    onEmptyAnchorClick,
    resetViewNonce = 0,
}) => {
    const themeKey = appMode === 'dark'
        ? (darkVariant || DEFAULT_DARK_VARIANT)
        : LIGHT_TRANSPORT_VARIANT;
    const palette = useMemo(() => paletteFor(themeKey), [themeKey]);

    const containerRef = useRef(null);
    const stageRef = useRef(null);
    const zoomRef = useRef(null);
    const downRef = useRef(null);
    const draggingRef = useRef(false);
    const hoveredBuildRef = useRef(null);   // last build id whose hover opened the menu
    const hoverTimerRef = useRef(null);     // hover-intent open timer (req #2864)

    // Hover-intent: the build menu opens only after the pointer RESTS on a dot for
    // HOVER_OPEN_DELAY, so sweeping the mouse across many builds no longer pops the
    // first one it crosses. Leaving a dot (or starting a drag) cancels the pending
    // open. Clicks bypass the delay and open immediately.
    const cancelHoverOpen = useCallback(() => {
        if (hoverTimerRef.current) { clearTimeout(hoverTimerRef.current); hoverTimerRef.current = null; }
    }, []);
    useEffect(() => cancelHoverOpen, [cancelHoverOpen]);
    const kBaseRef = useRef(0.8);            // fit-to-width scale, set at framing
    const lastFramedProjectRef = useRef(null);
    const [size, setSize] = useState({ w: 0, h: 0 });
    const [transform, setTransform] = useState(null);
    const [tooltip, setTooltip] = useState(null);
    // Per-token expand set (sticky within a level; cleared on level switch).
    const [expandedTokens, setExpandedTokens] = useState(() => new Set());

    useLayoutEffect(() => {
        const el = containerRef.current;
        if (!el) return;
        const ro = new ResizeObserver((entries) => {
            const cr = entries[0]?.contentRect;
            if (cr) setSize({ w: Math.round(cr.width), h: Math.round(cr.height) });
        });
        ro.observe(el);
        setSize({ w: el.clientWidth, h: el.clientHeight });
        return () => ro.disconnect();
    }, []);

    const kBase = kBaseRef.current || 0.8;
    const curK = transform ? transform.k : kBase;
    const ratio = kBase > 0 ? curK / kBase : 1;
    const level = pinnedLevel != null ? pinnedLevel : autoLevel(ratio);

    // Reset the per-token expansions whenever the effective level changes — the
    // collapse runs (and therefore the token ids) differ across levels, so a
    // stale expansion would never match (assumption #3 in the requirement).
    const prevLevelRef = useRef(level);
    useEffect(() => {
        if (prevLevelRef.current !== level) {
            prevLevelRef.current = level;
            setExpandedTokens(prev => (prev.size ? new Set() : prev));
        }
    }, [level]);

    useEffect(() => { onEffectiveLevel?.(level); }, [level, onEffectiveLevel]);

    // Toolbar type-filter hidden set (union base for the semantic transform).
    const baseHiddenBranchIds = useMemo(() => {
        if (!model?.branches?.length) return new Set();
        return computeHiddenBranchIds({
            branches: model.branches,
            selectedTypes: selectedTypes || BRANCH_TYPES,
            allTypes: BRANCH_TYPES,
        });
    }, [model, selectedTypes]);

    // Semantic transform → collapse-aware layout.
    const semantic = useMemo(
        () => computeSemanticModel(model || { branches: [] }, {
            level, expandedTokens, baseHiddenBranchIds,
        }),
        [model, level, expandedTokens, baseHiddenBranchIds],
    );
    const layout = useMemo(
        () => computeLayout(
            semantic.model || { branches: [], builds: {}, releaseEvents: {} },
            { versionLanes: !!staggerOn, hiddenBranchIds: semantic.hiddenBranchIds },
        ),
        [semantic, staggerOn],
    );

    const branchNameById = useMemo(() => {
        const m = new Map();
        for (const br of layout.branches || []) m.set(br.id, br.name);
        return m;
    }, [layout]);
    const mainBranchId = useMemo(
        () => (layout.branches || []).find(b => b.isMain)?.id || null,
        [layout],
    );
    const buildById = useMemo(() => {
        const m = new Map();
        for (const b of layout.builds || []) m.set(b.id, b);
        return m;
    }, [layout]);

    // The latest (last) real build on each branch — used to thin version labels
    // at L1 (req #2864 follow-up): L1 shows the build number ONLY for release
    // builds and the latest build on any branch; everything else is unlabeled to
    // keep the overview uncluttered.
    const latestBuildIds = useMemo(() => {
        const s = new Set();
        for (const b of (semantic.model?.branches || [])) {
            const ids = b.buildIds || [];
            for (let i = ids.length - 1; i >= 0; i--) {
                if (!isGapId(ids[i])) { s.add(ids[i]); break; }
            }
        }
        return s;
    }, [semantic]);

    // ── Fit-to-width framing — once per project, and on Reset view ──────────────
    const frame = useCallback(() => {
        const el = containerRef.current;
        const zb = zoomRef.current;
        if (!el || !zb || size.w === 0 || size.h === 0) return;
        if (!layout.width || !layout.branches.length) return;
        const pad = 40;
        const k = Math.max(0.05, Math.min(2.5, (size.w - pad) / layout.width));
        kBaseRef.current = k;
        const tx = (size.w - layout.width * k) / 2;
        const ty = size.h / 2 - (layout.mainY || 0) * k;
        select(el).call(zb.transform, zoomIdentity.translate(tx, ty).scale(k));
    }, [size.w, size.h, layout]);

    // d3-zoom behavior (drag-pan + cursor-centered wheel zoom). Mirrors the
    // swarm canvas: the handler only stores {x,y,k}; the open-hand/closed-hand
    // cursor is managed on start/end; programmatic transforms (framing) carry no
    // sourceEvent so they don't touch the cursor.
    useEffect(() => {
        const el = containerRef.current;
        if (!el || size.w === 0) return;
        const sel = select(el);
        const zb = d3zoom()
            .scaleExtent([0.02, 8])
            .filter((ev) => (ev.type === 'wheel' ? true : !ev.button))
            .clickDistance(5)
            .on('zoom', (ev) => {
                const tr = ev.transform;
                setTransform({ x: tr.x, y: tr.y, k: tr.k });
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
    }, [size.w, size.h]);

    // Frame once per project identity (data loads async → wait for branches).
    useEffect(() => {
        if (projectId == null) { lastFramedProjectRef.current = null; return; }
        if (!layout.branches.length || size.w === 0) return;
        if (lastFramedProjectRef.current === projectId) return;
        lastFramedProjectRef.current = projectId;
        frame();
    }, [projectId, layout, size.w, frame]);

    // Explicit Reset view (toolbar). nonce 0 = initial → skip.
    const frameRef = useRef(frame);
    frameRef.current = frame;
    useEffect(() => {
        if (!resetViewNonce) return;
        frameRef.current();
    }, [resetViewNonce]);

    // Click resolution (d3-zoom can swallow Konva's synthetic click): on a
    // non-drag click, hit-test the topmost shape and fire 'activate'.
    useEffect(() => {
        const el = containerRef.current;
        if (!el) return;
        const onDown = (e) => { downRef.current = { x: e.clientX, y: e.clientY }; };
        const onClick = (e) => {
            const d = downRef.current;
            if (d && Math.hypot(e.clientX - d.x, e.clientY - d.y) > 4) return;
            const stage = stageRef.current;
            if (!stage) return;
            const rect = el.getBoundingClientRect();
            const node = stage.getIntersection({ x: e.clientX - rect.left, y: e.clientY - rect.top });
            if (node) node.fire('activate', { evt: e }, false);
        };
        el.addEventListener('mousedown', onDown);
        el.addEventListener('click', onClick);
        return () => { el.removeEventListener('mousedown', onDown); el.removeEventListener('click', onClick); };
    }, []);

    const t = transform || {
        x: 0, y: 0, k: kBase,
    };
    const inv = t.k > 0 ? 1 / t.k : 1;

    const cursorPointer = (e, on) => {
        const stage = e?.target?.getStage?.();
        if (!stage || draggingRef.current) return;
        stage.container().style.cursor = on ? 'pointer' : 'grab';
    };

    // Anchor the hover menu to the DOT's live screen position (just below it),
    // NOT to the pointer (req #2864). Opening under a resting cursor made the
    // paper cover it, which fired a spurious Konva mouseleave on the dot and shut
    // the menu while the mouse was stopped. Placing the paper's top edge a hair
    // below the dot — still inside the dot's hit-circle so the move down bridges
    // seamlessly — keeps the cursor on the canvas (no leave) when it opens.
    const dotScreenAnchor = (wx, wy, rWorld) => {
        const el = containerRef.current;
        if (!el) return null;
        const rect = el.getBoundingClientRect();
        return {
            clientX: rect.left + t.x + wx * t.k,
            clientY: rect.top + t.y + wy * t.k + rWorld + 2,
        };
    };

    const toggleToken = useCallback((tokenId) => {
        setExpandedTokens(prev => {
            const next = new Set(prev);
            if (next.has(tokenId)) next.delete(tokenId); else next.add(tokenId);
            return next;
        });
    }, []);

    const showReleaseTip = useCallback((build, e) => {
        const p = e?.target?.getStage?.()?.getPointerPosition?.();
        if (p) setTooltip({ x: p.x, y: p.y, build });
    }, []);
    const hideTip = useCallback(() => setTooltip(null), []);

    // ── Render ──────────────────────────────────────────────────────────────
    const nodes = [];
    if (layout.branches.length) {
        const lineW = LINE_W * inv;
        const whispyW = 0.9 * inv;

        // 0. Stratum bands + labels.
        for (const s of layout.strata || []) {
            nodes.push(
                <Rect key={`band-${s.id}`} x={0} y={s.yTop} width={layout.width}
                      height={s.yBottom - s.yTop} fill={s.bandFill || 'transparent'} listening={false} />,
                <Text key={`band-lbl-${s.id}`} x={6} y={(s.yTop + s.yBottom) / 2 - 6 * inv}
                      text={`${s.label}${s.laneCount > 1 ? ` (${s.laneCount} lanes)` : ''}`}
                      fontSize={10 * inv} fontStyle="600" fill={palette.label} opacity={0.45}
                      listening={false} />,
            );
        }

        // 1. Main trunk path (always arrowed).
        if (layout.mainPath) {
            const ep = lineEndpoints(layout.mainPath.d);
            if (ep) {
                nodes.push(<Arrow key="mainline" points={ep} stroke={palette.line} fill={palette.line}
                                  strokeWidth={lineW} pointerLength={7 * inv} pointerWidth={6 * inv}
                                  pointerAtEnding={!!layout.mainPath.hasArrow} listening={false} />);
            }
        }

        // 1b. Connectors — curve (may be whispy) + horizontal data line (solid, arrowed).
        for (const c of layout.connectors || []) {
            nodes.push(<Path key={`curve-${c.branchId}`} data={c.curveD} stroke={c.curveWhispy ? palette.lineWhispy : palette.line}
                             strokeWidth={c.curveWhispy ? whispyW : lineW}
                             dash={c.curveWhispy ? [3 * inv, 2 * inv] : undefined}
                             opacity={c.curveWhispy ? 0.85 : 1} listening={false} />);
            const ep = lineEndpoints(c.lineD);
            if (ep) {
                nodes.push(<Arrow key={`line-${c.branchId}`} points={ep} stroke={palette.line} fill={palette.line}
                                  strokeWidth={lineW} pointerLength={7 * inv} pointerWidth={6 * inv}
                                  pointerAtEnding={!!c.hasArrow} listening={false} />);
            }
        }

        // 2. Branch labels (multi-line) + main endpoint labels.
        for (const b of layout.branches) {
            if (b.isMain || b.labelX == null || !b.name) continue;
            const lines = String(b.name).split('\n');
            lines.forEach((line, i) => {
                // Inter-line gap is counter-scaled (× inv) like the font so the
                // on-screen spacing stays constant at any zoom — an un-scaled
                // world gap would let lines overlap when zoomed out.
                nodes.push(<Text key={`lbl-${b.id}-${i}`} x={b.labelX}
                                 y={(b.labelY - (lines.length - 1 - i) * 18 * inv) - LABEL_FONT * inv}
                                 text={line} fontSize={LABEL_FONT * inv} fontStyle="600" fill={palette.label}
                                 onActivate={onBranchClick ? () => onBranchClick(b.id) : undefined}
                                 onMouseEnter={onBranchClick ? (e) => cursorPointer(e, true) : undefined}
                                 onMouseLeave={onBranchClick ? (e) => cursorPointer(e, false) : undefined} />);
            });
        }
        if (layout.mainEndpointLabels) {
            const L = layout.mainEndpointLabels;
            nodes.push(<Text key="main-lbl-left" x={L.leftX - 130} y={L.leftY - LABEL_FONT * inv} width={130}
                             align="right" text={L.leftText} fontSize={LABEL_FONT * inv} fontStyle="600"
                             fill={palette.label}
                             onActivate={(onBranchClick && mainBranchId) ? () => onBranchClick(mainBranchId) : undefined}
                             onMouseEnter={(onBranchClick && mainBranchId) ? (e) => cursorPointer(e, true) : undefined}
                             onMouseLeave={(onBranchClick && mainBranchId) ? (e) => cursorPointer(e, false) : undefined} />);
            if (L.rightText) {
                nodes.push(<Text key="main-lbl-right" x={L.rightX} y={L.rightY - LABEL_FONT * inv}
                                 text={L.rightText} fontSize={LABEL_FONT * inv} fontStyle="600"
                                 fill={palette.label} listening={false} />);
            }
        }

        // 3. Build dots + version labels + hit target (hover/click → page menu).
        for (const b of layout.builds) {
            const col = dotColors(b, palette);
            const r = b.radius * inv;
            const openMenu = () => {
                if (draggingRef.current) return;
                cancelHoverOpen();
                hoveredBuildRef.current = b.id;
                const a = dotScreenAnchor(b.x, b.y, b.radius);
                if (onBuildClick && a) onBuildClick(b, a);
            };
            // Arm the hover-intent timer; the menu is anchored to the dot (not the
            // pointer), so its position is computed at fire time and stays correct
            // even though the pointer may have drifted within the dot during the
            // delay. Cancel if the pointer leaves first.
            const scheduleOpen = () => {
                if (draggingRef.current) return;
                cancelHoverOpen();
                hoverTimerRef.current = setTimeout(() => {
                    hoverTimerRef.current = null;
                    if (draggingRef.current) return;
                    const a = dotScreenAnchor(b.x, b.y, b.radius);
                    if (!a) return;
                    hoveredBuildRef.current = b.id;
                    onBuildClick?.(b, a);
                }, HOVER_OPEN_DELAY);
            };
            // L1 declutter (req #2864): label only release builds + each branch's
            // latest build. L2/L3 label every build (full version detail).
            const showVersion = level !== 1
                || b.branchType === 'release'
                || (b.releaseCustomers?.length > 0)
                || latestBuildIds.has(b.id);
            nodes.push(
                <Circle key={`dot-${b.id}`} x={b.x} y={b.y} radius={r}
                        fill={col.fill} stroke={col.stroke} strokeWidth={lineW} listening={false} />,
                ...(showVersion ? [
                    // No width box → the build number NEVER wraps; it flows on one
                    // line and is centered on the dot via offsetX. The version font
                    // is monospace, so natural width ≈ chars × fontSize × 0.6 — used
                    // to center exactly without measuring (req #2864 follow-up: do
                    // not warp build numbers).
                    <Text key={`ver-${b.id}`} x={b.versionX} y={b.versionY}
                          text={b.version} fontSize={VERSION_FONT * inv} fontFamily={palette.versionFont}
                          offsetX={(String(b.version).length * VERSION_FONT * inv * 0.6) / 2}
                          fill={palette.version} listening={false} />,
                ] : []),
                <Circle key={`hit-${b.id}`} x={b.x} y={b.y} radius={Math.max(r + 4 * inv, 10 * inv)}
                        fill="transparent"
                        onActivate={openMenu}
                        // Hover ARMS the intent timer (only for a different build, so
                        // returning from the menu paper to the same dot doesn't churn
                        // the page's dotMenu state); a click opens immediately.
                        onMouseEnter={(e) => { cursorPointer(e, true); if (hoveredBuildRef.current !== b.id) scheduleOpen(); }}
                        onMouseLeave={(e) => { cursorPointer(e, false); cancelHoverOpen(); hoveredBuildRef.current = null; onBuildLeave?.(); }} />,
            );
        }

        // 3b. Empty-branch anchors (hover → Execute-Build-only menu).
        for (const a of layout.emptyAnchors || []) {
            const openAnchor = () => {
                if (draggingRef.current) return;
                cancelHoverOpen();
                const c = dotScreenAnchor(a.x, a.y, a.radius);
                if (c) onEmptyAnchorClick?.(a.branchId, c);
            };
            const scheduleAnchor = () => {
                if (draggingRef.current) return;
                cancelHoverOpen();
                hoverTimerRef.current = setTimeout(() => {
                    hoverTimerRef.current = null;
                    if (draggingRef.current) return;
                    const c = dotScreenAnchor(a.x, a.y, a.radius);
                    if (c) onEmptyAnchorClick?.(a.branchId, c);
                }, HOVER_OPEN_DELAY);
            };
            nodes.push(<Circle key={`empty-${a.branchId}`} x={a.x} y={a.y}
                               radius={Math.max(a.radius * inv + 4 * inv, 10 * inv)} fill="transparent"
                               onActivate={openAnchor}
                               onMouseEnter={(e) => { cursorPointer(e, true); scheduleAnchor(); }}
                               onMouseLeave={(e) => { cursorPointer(e, false); cancelHoverOpen(); onBuildLeave?.(); }} />);
        }

        // 3c. Collapse "…" tokens (req #2864) — clickable; toggles expansion.
        for (const tok of layout.collapseTokens || []) {
            const meta = semantic.tokenMeta?.get(tok.id);
            const count = meta?.hiddenBuildIds?.length || 0;
            const halfW = 13 * inv, halfH = 9 * inv;
            nodes.push(
                <Rect key={`tok-bg-${tok.id}`} x={tok.x - halfW} y={tok.y - halfH}
                      width={2 * halfW} height={2 * halfH} cornerRadius={halfH}
                      fill={palette.bg} stroke={palette.line} strokeWidth={lineW} opacity={0.92}
                      onActivate={() => toggleToken(tok.id)}
                      onMouseEnter={(e) => { cursorPointer(e, true); }}
                      onMouseLeave={(e) => { cursorPointer(e, false); }} />,
                <Text key={`tok-txt-${tok.id}`} x={tok.x - halfW} y={tok.y - TOKEN_FONT * inv * 0.62}
                      width={2 * halfW} align="center" text="…" fontSize={TOKEN_FONT * inv}
                      fontStyle="bold" fill={palette.label} listening={false} />,
                ...(count ? [
                    // Count sits BELOW the token's circle/pill (tok.y + halfH is its
                    // bottom edge); a +5px gap clears the stroke so the "+N" no
                    // longer overlaps the ring (req #2864 follow-up).
                    <Text key={`tok-cnt-${tok.id}`} x={tok.x - halfW} y={tok.y + halfH + 5 * inv}
                          width={2 * halfW} align="center" text={`+${count}`} fontSize={11.2 * inv}
                          fill={palette.version} listening={false} />,
                ] : []),
            );
        }

        // 4. Release stars (hover → shared HTML datacard).
        if (showReleases) {
            for (const b of layout.builds) {
                if (!b.releaseCustomers?.length) continue;
                const col = starColorFor(b.branchType);
                const n = b.releaseCustomers.length;
                const ro = STAR_OUTER * inv;
                const pitch = (2 * STAR_OUTER + 2) * inv;
                const cy = b.y - 22 * inv;
                const startX = b.x - ((n - 1) * pitch) / 2;
                b.releaseCustomers.forEach((name, i) => {
                    nodes.push(<Star key={`star-${b.id}-${i}`} x={startX + i * pitch} y={cy}
                                     numPoints={5} innerRadius={ro * 0.45} outerRadius={ro}
                                     fill={col.fill} stroke={col.stroke} strokeWidth={1.1 * inv}
                                     onMouseEnter={(e) => { cursorPointer(e, true); showReleaseTip(b, e); }}
                                     onMouseLeave={(e) => { cursorPointer(e, false); hideTip(); }} />);
                });
            }
        }
    }

    const dark = appMode === 'dark';
    return (
        <div ref={containerRef} data-testid="build-visualizer-canvas"
             style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden',
                      background: palette.bg, fontFamily: palette.labelFont, touchAction: 'none' }}>
            {size.w > 0 && (
                <Stage ref={stageRef} width={size.w} height={size.h}>
                    <Layer>
                        <Group x={t.x} y={t.y} scaleX={t.k} scaleY={t.k}>
                            {nodes}
                        </Group>
                    </Layer>
                </Stage>
            )}

            {/* Zoom-level chip (mirrors the swarm canvas's level readout). */}
            <div style={{
                position: 'absolute', bottom: 8, right: 10, fontSize: 11,
                color: dark ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.55)',
                background: dark ? 'rgba(0,0,0,0.45)' : 'rgba(255,255,255,0.82)',
                padding: '2px 8px', borderRadius: 10, pointerEvents: 'none', userSelect: 'none',
            }} data-testid="bv-zoom-level">
                {level === 1 ? 'L1 · Overview' : level === 3 ? 'L3 · Full detail' : 'L2 · Detail'}
                {pinnedLevel != null ? ' · pinned' : ''} · drag to pan · scroll to zoom
            </div>

            {tooltip && (
                <ReleaseCard build={tooltip.build} branchName={branchNameById.get(tooltip.build.branchId)}
                             x={tooltip.x} y={tooltip.y} containerW={size.w} containerH={size.h} dark={dark} />
            )}
        </div>
    );
};

// Shared HTML datacard for a release-bearing build (replaces the per-glyph MUI
// Tooltip). Lists the shipped build, its branch, and each customer/date.
const ReleaseCard = ({ build, branchName, x, y, containerW, containerH, dark }) => {
    const CARD_W = 240;
    const left = Math.min(Math.max(8, x + 14), Math.max(8, containerW - CARD_W - 8));
    const top = Math.min(Math.max(8, y + 14), Math.max(8, containerH - 40));
    const details = build.releaseDetails?.length
        ? build.releaseDetails
        : (build.releaseCustomers || []).map(name => ({ name, date: null }));
    const releaseType = details.find(d => d.releaseType)?.releaseType;
    return (
        <div style={{
            position: 'absolute', left, top, maxWidth: CARD_W, zIndex: 20, pointerEvents: 'none',
            background: dark ? '#21201d' : '#ffffff', color: dark ? '#e8e1d5' : '#1a1a1a',
            border: `1px solid ${dark ? '#3a3833' : '#d8d8d8'}`, borderRadius: 6,
            boxShadow: '0 4px 16px rgba(0,0,0,0.28)', padding: '8px 10px', fontSize: 12,
        }}>
            <div style={{ fontWeight: 700 }}>
                {releaseType ? `${releaseType} release` : 'Released'} — Build {build.version}
            </div>
            {branchName ? <div style={{ opacity: 0.8, marginTop: 2 }}>{branchName}</div> : null}
            <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                {details.map((d, i) => (
                    <li key={`${d.name}-${i}`} style={{ fontSize: 11, lineHeight: 1.5 }}>
                        {d.name}{d.date ? ` — ${formatReleaseDate(d.date)}` : ''}
                    </li>
                ))}
            </ul>
        </div>
    );
};

// Memoized so a parent re-render (e.g. the page opening its MUI dot-menu Popover
// on hover) cannot re-render the canvas and make react-konva recompute the hit
// graph — that recomputation fired a spurious mouseleave on the hovered dot's
// hit target, which scheduled the menu's close and made it flicker shut even
// while the cursor stayed on the bubble. All props from the page are
// referentially stable (useCallback/useMemo + stable setters), so the canvas
// only re-renders on real input/zoom/level changes.
export default memo(KonvaBuildCanvas);
