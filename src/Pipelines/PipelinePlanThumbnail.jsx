// PipelinePlanThumbnail.jsx — the plan, drawn small, on a pipeline card
// (req #3365 user directive: *"Similar to map view, can we have a small
// visualizer window appear in the Pipeline card view. It would be a fixed,
// 'reset zoom' view of the visualizer depiction of the pipeline."*).
//
// THE MAP ANALOGY IS EXACT AND IT IS THE DESIGN. `RouteMapThumbnail` draws a
// ride's real track at a fixed frame with no controls; this draws a plan's real
// geometry the same way. What it is NOT is a second visualizer: no camera, no
// d3-zoom, no wheel handler, no hit targets, no epic overlay, no key, no
// tooltips. One `<Stage listening={false}>` and three kinds of mark.
//
// ── IT SHARES THE REAL GEOMETRY, IT DOES NOT APPROXIMATE IT ─────────────────
// `computePlanLayout` is the same function the full canvas calls, `beadStyle`
// is the same style function, and the band/bead/arc marks below are the same
// shapes with the same palette entries. That matters more here than it looks:
// a thumbnail drawn from a private simplification would drift from the page it
// is a preview OF, and a reader would learn to distrust it. The one thing that
// is genuinely this component's own is the SCALE.
//
// ── "RESET ZOOM" IS `factoryDefaultScale`, NOT A FIT OF MY OWN ──────────────
// The directive says a fixed "reset zoom" view, and Reset on the full canvas is
// `factoryDefaultScale(layout, size, kFit, kFloor)` — so this calls that,
// rather than dividing width by width and calling it the same thing. `kFloor`
// is passed as 0 deliberately: the full canvas floors the scale at the zoom
// behaviour's own configured minimum so a reader cannot zoom out past
// usefulness, and a thumbnail has no zoom behaviour and no reader to protect —
// what it needs is the whole plan inside a small box, which is the unfloored
// fit. Then the world is CENTRED in the frame, which the full canvas does not
// do (it pins the world's top-left to the panel's), because a thumbnail is a
// picture rather than a starting position.
//
// ── NO LABELS, AND THAT IS THE MODULE'S OWN RULE, NOT A SHORTCUT ────────────
// Nothing here draws text. At thumbnail scale `k` is far below `K_READABLE`,
// where `drawsLabelKind` already answers false for every label kind — so
// drawing step names or requirement ids would be this component overriding the
// legibility gate the whole surface is built on, to render type a few tenths of
// a pixel tall. The bands, the beads and the arcs are what survive at this
// size, and they are exactly what makes a plan recognisable at a glance:
// how many epics, how much is green, where the work is on the calendar.
//
// ── THE READ, AND ITS HONEST COST ──────────────────────────────────────────
// `useComposedPipeline` is ONE call of the composing route per plan drawn, and
// the composed payload is sized for rendering one plan. On a list of N plans
// that is N calls, which is a FAN-OUT — the shape design rule 5 exists to
// discourage — so it is not free and is not hidden:
//
//   · it is LAZY. The card passes `enabled` only when the thumbnail is
//     actually being shown, so a reader who turns the preview off pays
//     nothing at all;
//   · it is CACHED per plan under `pipelineComposeKeys.byId`, which is the
//     SAME key the plan detail page reads — so opening a plan after seeing its
//     thumbnail is a cache hit, and returning to the list is another;
//   · it never gates the card. `isLoading` and a failed read both render a
//     quiet frame, never a spinner that reflows the grid and never an error
//     box on a decorative element.
//
// If the plan list ever grows to where N matters, the fix is a batched compose
// route, not a private re-derivation here.

import { useEffect, useMemo, useState } from 'react';
import Box from '@mui/material/Box';
import { Stage, Layer, Group, Rect, Circle, Line, Path } from 'react-konva';

import { useComposedPipeline } from '../hooks/useDataQueries';
import { adaptComposedPipeline } from '../SwarmView/pipelines/pipelineAdapter';
import {
    computePlanLayout,
    factoryDefaultScale,
    beadStyle,
    BEAD_RADIUS,
    PLAN_VIZ_PALETTE,
} from '../SwarmView/pipelines/pipelinePlanLayout';

// The frame. Height is the card's to spend and is deliberately short — this is
// a glance, not a reading surface, and every pixel here is one the description
// and the pill row do not get.
export const THUMB_H = 132;

export default function PipelinePlanThumbnail({ pipelineId, machines = [],
    enabled = true }) {
    const { data, isLoading, isError } = useComposedPipeline(pipelineId, {
        enabled: enabled && Number.isFinite(pipelineId),
    });

    // IT MEASURES ITSELF rather than taking a width prop. A card is a cell of
    // a `repeat(auto-fill, minmax(...))` grid, so its width is decided by the
    // grid at paint time and changes on every window resize; a number passed
    // down from the page would be either stale or a second measurement of the
    // same box. Konva needs a pixel width — a Stage has no percentage sizing —
    // so this is measured, not styled.
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

    // ONE memo for the whole pipeline of work — adapt, lay out, scale. Each
    // stage is pure and the inputs change only when the payload or the frame
    // does, so a card re-rendering for an unrelated reason (a status filter
    // toggle, a sibling's refetch) re-runs none of it.
    const view = useMemo(() => {
        if (!data || !width) return null;
        let adapted;
        try {
            adapted = adaptComposedPipeline(data, { machines });
        } catch {
            // A payload this component cannot read is a BLANK FRAME, never a
            // thrown error: the plan detail page is the surface that owes the
            // reader a diagnostic for a withheld derivation (it renders one),
            // and a card is not the place to learn about it.
            return null;
        }
        // `adaptComposedPipeline` RETURNS THE PLAN, it does not wrap one: its
        // result IS the `plan` shape (`rows`, `eligibleStepIds`, `pause`, …),
        // which is why `usePlanSources` assigns it straight to `plan`. Reading
        // `adapted.plan.rows` here silently produced `undefined`, so the memo
        // returned null and the card drew an empty frame with no error —
        // exactly the "renders as blank, looks like no data" failure this
        // component's own error path is written to avoid.
        const rows = adapted?.rows;
        if (!rows || !rows.length) return null;
        const layout = computePlanLayout(rows, {});
        if (!layout || layout.empty || !(layout.width > 0)) return null;

        const size = { w: width, h: THUMB_H };
        const kFit = width / layout.width;
        // `kFloor` 0 — see the header. The thumbnail wants the whole plan, not
        // the interactive canvas's usefulness floor.
        const k = factoryDefaultScale(layout, size, kFit, 0);
        if (!(k > 0)) return null;
        // ── THE FRAME IS THE DRAWING'S SIZE, NOT THE CARD'S ─────────────────
        // A plan is normally taller than this strip is deep, so "the whole plan
        // at reset zoom" fits by HEIGHT and leaves the frame's width unused —
        // measured on plan 7 at a 415px card, the drawing was 183px wide inside
        // a 415px box, so 56% of a bordered, filled panel was empty. Letting
        // the box hug what is actually drawn removes the dead area outright,
        // which no choice of THUMB_H can: the plan's aspect is the plan's, and
        // a frame picked to suit one plan letterboxes the next one.
        //
        // NOT a crop. Cropping to fill would show part of the plan at a bigger
        // scale, and the directive asked for the RESET-ZOOM view — the whole
        // plan — so the scale is untouched and only the box around it moves.
        const drawnW = Math.max(1, Math.round(layout.width * k));
        return {
            layout,
            rows,
            k,
            drawnW,
            // Centred vertically in the strip; horizontally the frame IS the
            // drawing, so there is nothing left to centre.
            ox: 0,
            oy: Math.max(0, (THUMB_H - layout.height * k) / 2),
            // Already a Set on the adapted plan; copied rather than aliased so
            // a later edit here cannot mutate the cached plan object.
            eligible: new Set(adapted?.eligibleStepIds || []),
        };
    }, [data, width, machines]);

    const P = PLAN_VIZ_PALETTE;

    // The frame is drawn in EVERY state — loading, failed, empty and drawn —
    // so the card's height never changes underneath the reader. A thumbnail
    // that collapsed while its read was in flight would reflow the whole grid.
    return (
        // The OUTER box measures and reserves the height; it draws nothing, so
        // the card's layout never changes underneath the reader while the read
        // is in flight. The INNER box is the frame, and it is the drawing's
        // width — see `drawnW`. Before the plan is measured the frame spans the
        // card, which is the honest placeholder: at that point nothing is known
        // about the plan's shape.
        <Box
            ref={setEl}
            data-testid={`pipelines-card-thumb-${pipelineId}`}
            data-thumb-state={isLoading ? 'loading' : isError ? 'error'
                : view ? 'drawn' : 'empty'}
            sx={{ height: THUMB_H, mb: 1.5, display: 'flex',
                  justifyContent: 'center' }}
        >
            <Box sx={{
                height: THUMB_H,
                width: view ? view.drawnW : '100%',
                borderRadius: 2,
                overflow: 'hidden',
                border: '1px solid',
                borderColor: 'divider',
                // The canvas's own panel colour, so the thumbnail reads as a
                // window onto the visualizer rather than as a chart on a card.
                background: P.panel,
            }}>
            {view && width > 0 && (
                <Stage width={view.drawnW} height={THUMB_H} listening={false}>
                    <Layer listening={false}>
                        <Group x={view.ox} y={view.oy}
                               scaleX={view.k} scaleY={view.k}>
                            {/* Epic bands — the same two rects the full canvas
                                draws, at the same opacities, so the epic
                                colours a reader learns on the plan page are
                                the ones they recognise here. */}
                            {view.layout.bands.map((band) => (
                                <Group key={`band-${band.key}`}>
                                    <Rect x={2} y={band.y}
                                          width={view.layout.width - 4}
                                          height={band.height}
                                          fill={band.color} opacity={0.06} />
                                    <Rect x={2} y={band.y}
                                          width={view.layout.width - 4}
                                          height={band.height}
                                          stroke={band.color} strokeWidth={1}
                                          opacity={0.35} />
                                </Group>
                            ))}

                            {/* Dependency arcs, under the beads exactly as on
                                the full canvas. */}
                            {view.layout.arcs.map((arc, i) => (arc.straight ? (
                                <Line key={`arc-${i}`}
                                      points={[arc.x1, arc.y1, arc.x2, arc.y2]}
                                      stroke={P.arc} strokeWidth={1.2}
                                      opacity={0.85} />
                            ) : (
                                <Path key={`arc-${i}`} data={arc.path}
                                      stroke={P.arc} strokeWidth={1.2}
                                      opacity={0.85} />
                            )))}

                            {/* Beads. `beadStyle` is the shared function, so
                                state colour, the manual ring and the eligible
                                ring all match the plan page. The next-up HALO
                                is deliberately not drawn: it is a fixed-screen
                                -size mark designed for a camera this frame does
                                not have, and at this scale it would swamp the
                                bead it points at. */}
                            {view.rows.map((row) => {
                                const n = view.layout.nodes.get(row.id);
                                if (!n) return null;
                                const style = beadStyle(
                                    row, view.eligible.has(row.id));
                                return (
                                    <Circle key={`bead-${row.id}`}
                                            x={n.x} y={n.y}
                                            radius={BEAD_RADIUS}
                                            fill={style.fill}
                                            stroke={style.ring}
                                            strokeWidth={style.ringWidth} />
                                );
                            })}
                        </Group>
                    </Layer>
                </Stage>
            )}
            </Box>
        </Box>
    );
}
