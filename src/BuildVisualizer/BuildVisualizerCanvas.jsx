// Build Visualizer — pure React SVG renderer (req #2694 / #2720).
//
// Consumes the output of `computeLayout` and emits SVG primitives. Adds:
//   - Stratum band labels along the left edge (one per non-empty stratum)
//   - Mouse-drag panning (click anywhere outside dots/labels and drag)
//   - Build-dot click targets (cursor: pointer; onClick callback to parent)

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';

import { computeLayout } from './d3LayoutEngine';
import { BRANCH_TYPES } from './branchTypeChipStyles';
import paletteFor from './d3ThemePalettes';
import {
    DEFAULT_DARK_VARIANT,
    LIGHT_TRANSPORT_VARIANT,
} from './themeVariants';

const ARROW_ID = 'bv-d3-arrow';
const ARROW_WHISPY_ID = 'bv-d3-arrow-whispy';

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

function customerColor(name) {
    let h = 0;
    for (let i = 0; i < name.length; i++) h = ((h << 5) - h + name.charCodeAt(i)) | 0;
    const hue = Math.abs(h) % 360;
    return `hsl(${hue}, 70%, 55%)`;
}

function GoldStar({ pos, customers }) {
    const cx = pos.x;
    const cy = pos.y + 22;
    const ro = 9;
    const ri = ro * 0.45;
    return (
        <g>
            <polygon points={starPoints(cx, cy, ro, ri, 5)} fill="#fbbf24" stroke="#b45309" strokeWidth={1.1} strokeLinejoin="round" />
            <text x={cx} y={cy + 3.2} textAnchor="middle" fontSize={9} fontWeight="bold" fill="#1a1a1a">{customers.length}</text>
        </g>
    );
}
function Halo({ pos, customers }) {
    const ringR = 12;
    const n = customers.length;
    return (
        <g>
            {customers.map((name, i) => {
                const angle = (i / n) * Math.PI * 2 - Math.PI / 2;
                return <circle key={`${name}-${i}`} cx={(pos.x + Math.cos(angle) * ringR).toFixed(2)} cy={(pos.y + Math.sin(angle) * ringR).toFixed(2)} r={2.5} fill={customerColor(name)} stroke="#1a1a1a" strokeWidth={0.5} />;
            })}
        </g>
    );
}
function Pennant({ pos, customers }) {
    const baseY = pos.y - 6;
    const tipY = baseY - 32;
    const baseX = pos.x;
    const tipX = pos.x + 22 + Math.max(0, customers.length - 1) * 4;
    return (
        <g>
            <line x1={baseX} y1={pos.y - 6} x2={baseX} y2={tipY + 2} stroke="#1a1a1a" strokeWidth={1} />
            <polygon points={`${baseX},${tipY} ${tipX},${(tipY + baseY) / 2} ${baseX},${baseY}`} fill="#fbbf24" stroke="#b45309" strokeWidth={0.8} />
            {customers.map((name, i) => {
                const y = tipY + 6 + i * 8;
                if (y > baseY - 2) return null;
                return <text key={`${name}-${i}`} x={baseX + 3} y={y} fontSize={7} fontFamily='"Consolas", "Menlo", monospace' fill="#1a1a1a">{name.slice(0, 8)}</text>;
            })}
        </g>
    );
}
function Sunburst({ pos, customers }) {
    const n = customers.length;
    const rayLen = 16;
    const startR = 8;
    return (
        <g>
            {customers.map((name, i) => {
                const angle = (i / n) * Math.PI * 2 - Math.PI / 2;
                const cos = Math.cos(angle); const sin = Math.sin(angle);
                return (
                    <g key={`${name}-${i}`}>
                        <line x1={(pos.x + cos * startR).toFixed(2)} y1={(pos.y + sin * startR).toFixed(2)} x2={(pos.x + cos * (startR + rayLen)).toFixed(2)} y2={(pos.y + sin * (startR + rayLen)).toFixed(2)} stroke="#fbbf24" strokeWidth={1.4} strokeLinecap="round" />
                        <text x={(pos.x + cos * (startR + rayLen + 5)).toFixed(2)} y={(pos.y + sin * (startR + rayLen + 5) + 3).toFixed(2)} textAnchor="middle" fontSize={8} fontWeight="bold" fill="#1a1a1a">{name.charAt(0).toUpperCase()}</text>
                    </g>
                );
            })}
        </g>
    );
}
function ChipRow({ pos, customers }) {
    const chipW = 14; const chipH = 10; const gap = 2;
    const totalW = customers.length * chipW + (customers.length - 1) * gap;
    const startX = pos.x - totalW / 2;
    const y = pos.y + 16;
    return (
        <g>
            {customers.map((name, i) => {
                const x = startX + i * (chipW + gap);
                return (
                    <g key={`${name}-${i}`}>
                        <rect x={x} y={y} width={chipW} height={chipH} rx={3} ry={3} fill={customerColor(name)} stroke="#1a1a1a" strokeWidth={0.5} />
                        <text x={x + chipW / 2} y={y + chipH - 2} textAnchor="middle" fontSize={7} fontWeight="bold" fill="#ffffff">{name.charAt(0).toUpperCase()}</text>
                    </g>
                );
            })}
        </g>
    );
}
function ReleaseOverlay({ style, pos, customers }) {
    switch (style) {
        case 2: return <Halo pos={pos} customers={customers} />;
        case 3: return <Pennant pos={pos} customers={customers} />;
        case 4: return <Sunburst pos={pos} customers={customers} />;
        case 5: return <ChipRow pos={pos} customers={customers} />;
        case 1:
        default: return <GoldStar pos={pos} customers={customers} />;
    }
}

const BuildVisualizerCanvas = ({
    model,
    isLoading,
    error,
    selectedTypes,
    staggerOn,
    showReleases,
    releaseStyle,
    appMode,
    darkVariant,
    onBuildClick,
}) => {
    const themeKey = appMode === 'dark'
        ? (darkVariant || DEFAULT_DARK_VARIANT)
        : LIGHT_TRANSPORT_VARIANT;
    const palette = paletteFor(themeKey);

    const hiddenBranchIds = useMemo(() => {
        if (!model?.branches?.length) return new Set();
        const allTypes = new Set(BRANCH_TYPES);
        const allowedTypes = new Set(selectedTypes || BRANCH_TYPES);
        allowedTypes.add('main');
        const hidden = new Set();
        for (const b of model.branches) {
            if (allTypes.has(b.type) && !allowedTypes.has(b.type)) hidden.add(b.id);
        }
        return hidden;
    }, [model, selectedTypes]);

    const layout = useMemo(
        () => computeLayout(
            model || { branches: [], builds: {}, releaseEvents: {} },
            { versionLanes: !!staggerOn, hiddenBranchIds },
        ),
        [model, staggerOn, hiddenBranchIds],
    );

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

    // Reset pan whenever the project changes (req #2720). Translate so the
    // first main build sits ~20 px from the viewport's left edge AND vertically
    // centered. Without the vertical centering, dense patterns (Sprint Cycle:
    // 5 above-strata + main + dev) push main hundreds of pixels down — at
    // pan.y=0 the user only sees the top strata and main is below the fold.
    useEffect(() => {
        const firstBuildX = layout?.mainPath
            ? Math.max(0, (layout.mainPath.firstBuildX ?? 0))
            : 0;
        const firstBuildY = layout?.mainPath
            ? Math.max(0, (layout.mainPath.firstBuildY ?? 0))
            : 0;
        const initX = firstBuildX > 0 ? -(firstBuildX - 20) : 0;
        // Place main near vertical center of the viewport. Falls back to a
        // sensible default (300 px) when the viewport hasn't measured yet.
        const viewportH = viewportRef.current?.clientHeight || 600;
        const initY = firstBuildY > 0 ? -(firstBuildY - viewportH / 2) : 0;
        setPan({ x: initX, y: initY });
    }, [model, layout]);

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
                No branches in the selected pattern.
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
                        <g key={c.branchId}>
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
                            <g key={`label-${b.id}`}>
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
                        const handleClick = (e) => {
                            // Suppress click when the user was dragging (pan).
                            if (dragRef.current.moved) return;
                            e.stopPropagation();
                            if (onBuildClick) onBuildClick(b, e);
                        };
                        return (
                            <g key={b.id} style={{ cursor: 'pointer' }} onClick={handleClick}>
                                <circle cx={b.x} cy={b.y} r={b.radius} fill={color.fill} stroke={color.stroke} strokeWidth={1.4} />
                                {/* Transparent hit-area — easier to click than the 5.5 px dot */}
                                <circle cx={b.x} cy={b.y} r={Math.max(b.radius + 4, 10)} fill="transparent" pointerEvents="all" />
                                <text x={b.versionX} y={b.versionY} textAnchor="middle" fontSize={9} fontFamily={palette.versionFont} fill={palette.version}>{b.version}</text>
                            </g>
                        );
                    })}
                </g>

                {/* 4. Release overlays */}
                {showReleases && (
                    <g className="release-overlays">
                        {layout.builds
                            .filter(b => b.releaseCustomers?.length)
                            .map(b => (
                                <ReleaseOverlay
                                    key={`release-${b.id}`}
                                    style={releaseStyle || 1}
                                    pos={{ x: b.x, y: b.y }}
                                    customers={b.releaseCustomers}
                                />
                            ))}
                    </g>
                )}
            </svg>
        </Box>
    );
};

export default BuildVisualizerCanvas;
