// PipelinePlanThumbnail.jsx — the whole plan, small, on a pipeline card
// (req #3365 user directive: *"Similar to map view, can we have a small
// visualizer window appear in the Pipeline card view."*).
//
// ── AN L1/L2 OVERVIEW OF THE WHOLE PLAN (req #3804 user directive) ──────────
// *"redesign it like level 2 … L1 look and feel but with a count of issues
// badge and its condensed … excellent taste in white space and sizing and fits
// the whole view of the initiatives and steps."* It replaced req #3641's L3
// crop, which showed a few cards out of the plan's middle and never the plan.
// Every initiative is a tinted band in its own colour; every epic is an L1
// bead — the plan page's own `beadStyle` fill and ring, its dashed "next" halo
// — carrying the L2 count badge (its requirement count); dependency arcs join
// them. The layout is `planOverview` (planOverview.js): the plan's own bands,
// dependency columns and lanes from `computePlanLayout`, re-spaced to the frame.
//
// What it is NOT is a second visualizer: no camera, no hit targets, no
// tooltips, no labels but the counts. One `<Stage listening={false}>`; the card
// underneath owns the click, which opens the plan.
//
// ── THE READ, AND ITS HONEST COST ──────────────────────────────────────────
// `useComposedPipeline` is ONE call of the composing route per plan drawn — a
// fan-out over the list, so it is not free and is not hidden: CACHED per plan
// under the same key the plan page reads (opening a plan after seeing its
// preview is a cache hit), it never gates the card (loading and failure render
// a quiet frame, never a spinner that reflows the grid), and the Pipelines page
// refreshes it at half the rate of its list reads (req #3804).

import { useEffect, useMemo, useState } from 'react';
import Box from '@mui/material/Box';
import { Stage, Layer, Group, Rect, Line, Path, Text, Circle } from 'react-konva';

import { useComposedPipeline } from '../hooks/useDataQueries';
import { adaptComposedPipeline } from '../SwarmView/pipelines/pipelineAdapter';
import { localDayOf } from '../SwarmView/pipelines/pipelinePlanTime';
import {
    computePlanLayout,
    beadStyle,
    DEFAULT_PLAN_PALETTE,
    PLAN_VIZ_PALETTE,
    NEXT_HALO_OPACITY,
} from '../SwarmView/pipelines/pipelinePlanLayout';
import { planOverview, overviewArcPath, OVERVIEW } from './planOverview';
import {
    CLEAN_COLOR, DEFAULT_PREVIEW_COLOR, PERCENT_MODE, epicPercent, percentColor,
} from './previewColor';

// A bead's ring: neutral — the fill carries the one meaning (progress).
const NEUTRAL_RING = 'rgba(255,255,255,0.55)';

// The frame. Height is the card's to spend and is kept short — a glance, not a
// reading surface — but tall enough for a plan of six initiative bands to keep
// beads a reader can tell apart (measured on production plan 10: 6 bands, 9
// lanes).
export const THUMB_H = 160;

// The plan page's monospace stack — the badge digits match the plan's.
const MONO = '"SF Mono", "JetBrains Mono", Menlo, monospace';

/**
 * The count badge: a pill tucked onto the bead's upper right like a
 * notification count, a circle for one digit. Sized to the bead, floored at a
 * legible 8px, so a dense plan's badges do not tower over its lanes.
 */
function badgeBox(bead, r) {
    // Sized from the bead's UNSCALED radius, then scaled with it, so the badge
    // grows by exactly `markScale` (req #3804 review) — its 8–11px clamp is
    // the base size's.
    const base = Math.max(8, Math.min(11, Math.round((r / OVERVIEW.markScale) * 1.7)));
    const h = base * OVERVIEW.markScale;
    const font = Math.round(h * 0.72);
    const text = String(bead.count);
    const w = Math.max(h, Math.round(text.length * font * 0.62 + h * 0.5));
    return { x: bead.x + r * 0.25, y: bead.y - r * 0.4 - h, w, h, font, text };
}

// `refetchInterval` (req #3804): the Pipelines cards keep the picture live, so
// a plan that moves on while the page is open is redrawn rather than frozen.
// `colorMode` (req #4063, narrowed by req #4184) is what the beads are coloured by:
// progress, or the clean all-green look — see previewColor.js.
export default function PipelinePlanThumbnail({ pipelineId, machines = [],
    enabled = true, refetchInterval, colorMode = DEFAULT_PREVIEW_COLOR }) {
    const { data, isLoading, isError } = useComposedPipeline(pipelineId, {
        enabled: enabled && Number.isFinite(pipelineId),
        refetchInterval,
    });

    // IT MEASURES ITSELF rather than taking a width prop: a card is a cell of
    // a `repeat(auto-fill, minmax(...))` grid, so its width is decided at paint
    // time and changes on every window resize, and Konva needs pixels.
    const [el, setEl] = useState(null);
    const [width, setWidth] = useState(0);
    useEffect(() => {
        if (!el) return undefined;
        const apply = (w) => setWidth((prev) => (prev === w ? prev : w));
        const ro = new ResizeObserver((entries) => {
            const cr = entries[0]?.contentRect;
            if (cr) apply(Math.round(cr.width));
        });
        ro.observe(el);
        apply(Math.round(el.clientWidth));
        return () => ro.disconnect();
    }, [el]);

    // THE PLAN'S STRUCTURE — independent of the frame's width, so a resize
    // re-spaces without re-running the layout. No time axis: the overview's
    // columns are DEPENDENCY depth, so a plan reads as the chain it is rather
    // than as a calendar of mostly empty columns. `today` keys the memo for the
    // same reason `usePlanSources` does: empty and running epics sit on the
    // reader's local today.
    const today = localDayOf(new Date());
    const structure = useMemo(() => {
        if (!data) return null;
        let adapted;
        try {
            adapted = adaptComposedPipeline(data, { machines, now: new Date() });
        } catch {
            // A payload this cannot read is a BLANK FRAME: the plan page owes the
            // reader the diagnostic, a card does not.
            return null;
        }
        const rows = adapted?.rows;
        if (!rows || !rows.length) return null;
        const layout = computePlanLayout(rows, { palette: DEFAULT_PLAN_PALETTE });
        if (!layout || layout.empty) return null;
        return { layout, rows, eligible: new Set(adapted?.eligibleEpicIds || []) };
    }, [data, machines, today]);

    const view = useMemo(() => (structure && width > 0
        ? planOverview(structure.layout, structure.rows, width, THUMB_H) : null),
    [structure, width]);

    const P = PLAN_VIZ_PALETTE;

    // The frame is drawn in EVERY state — loading, failed, empty and drawn — at
    // one height, so the card never changes height under the reader.
    return (
        <Box
            ref={setEl}
            data-testid={`pipelines-card-thumb-${pipelineId}`}
            data-color-mode={colorMode}
            data-thumb-state={isLoading ? 'loading' : isError ? 'error'
                : view ? 'drawn' : 'empty'}
            sx={{
                height: THUMB_H,
                mb: 1.5,
                borderRadius: 2,
                overflow: 'hidden',
                border: '1px solid',
                borderColor: 'divider',
                // The canvas's own panel colour: a window onto the visualizer.
                background: P.panel,
            }}
        >
            {view && (
                <Stage width={width} height={THUMB_H} listening={false}>
                    <Layer listening={false}>
                        {/* Initiative bands, in the colours the plan page uses. */}
                        {view.bands.map((b) => (
                            <Group key={`band-${b.key}`}>
                                <Rect x={b.x} y={b.y} width={b.w} height={b.h} cornerRadius={6}
                                      fill={b.color} opacity={0.07} />
                                <Rect x={b.x} y={b.y} width={b.w} height={b.h} cornerRadius={6}
                                      stroke={b.color} strokeWidth={1} opacity={0.3} />
                            </Group>
                        ))}
                        {view.wires.map((w, i) => (
                            <Line key={`wire-${i}`} points={[w.x1, w.y, w.x2, w.y]}
                                  stroke={P.wire} strokeWidth={1} opacity={0.2} />
                        ))}
                        {view.arcs.map((a, i) => (
                            <Path key={`arc-${i}`} data={overviewArcPath(a)}
                                  stroke={P.arc} strokeWidth={1.1} opacity={0.75} />
                        ))}
                        {view.beads.map((bead) => {
                            const style = beadStyle(bead.row, structure.eligible.has(bead.id),
                                bead.row.launchSuppressed);
                            return (
                                <Group key={`bead-${bead.id}`}>
                                    {style.next && (
                                        <Circle x={bead.x} y={bead.y} radius={view.r + 2.5}
                                                stroke={style.haloColor} strokeWidth={1.2}
                                                opacity={NEXT_HALO_OPACITY} dash={[2, 2]} />
                                    )}
                                    <Circle x={bead.x} y={bead.y} radius={view.r}
                                            fill={colorMode === PERCENT_MODE
                                                ? percentColor(epicPercent(bead.row))
                                                : CLEAN_COLOR}
                                            stroke={NEUTRAL_RING} strokeWidth={1} />
                                </Group>
                            );
                        })}
                        {/* The L2 count badges, last, so no arc crosses a digit. */}
                        {view.beads.map((bead) => {
                            const b = badgeBox(bead, view.r);
                            return (
                                <Group key={`badge-${bead.id}`}>
                                    <Rect x={b.x} y={b.y} width={b.w} height={b.h}
                                          cornerRadius={b.h / 2} fill={P.badgeFill} />
                                    <Text x={b.x} y={b.y} width={b.w} height={b.h} text={b.text}
                                          align="center" verticalAlign="middle"
                                          fontSize={b.font} fontFamily={MONO} fontStyle="bold"
                                          fill={P.badgeText} wrap="none" />
                                </Group>
                            );
                        })}
                    </Layer>
                </Stage>
            )}
        </Box>
    );
}
