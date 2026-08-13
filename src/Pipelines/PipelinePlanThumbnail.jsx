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

// ── LINES ARE FLOORED AT A MINIMUM SCREEN WIDTH, NOT LEFT PURE WORLD (req
//    #3501 user directive: "the visualizer... is also too dark. Try
//    improving the visiblity... by making the lines brighter") ───────────
// The full canvas draws its dependency arcs at a uniform 1.4 world-space
// stroke (req #3365/#3366's own brightening pass) — this file drew the same
// marks thinner, at 1.2. Both are FINE at the canvas's own scales, but this
// frame reaches much further out: `k` here is the WHOLE PLAN fit into a
// ~130px strip, measured at 0.041 on a live plan, well below anywhere the
// canvas's own zoom behaviour lands it. At that k a 1.2 world-px stroke
// drawn inside the scaled `<Group>` above collapses to 1.2 * 0.041 = 0.049
// screen px and anti-aliases to almost nothing, REGARDLESS of how bright or
// saturated its colour is. `P.arc` already measures 8.32:1 against the panel
// at full size — the colour was never the problem, the WIDTH was, and no hex
// value fixes a stroke that resolves to a twentieth of a pixel. (The full
// canvas's own arcs are not immune to this at ITS zoom floor either — that
// is a separate, undisclosed gap left for a canvas-scoped requirement; this
// fix is deliberately scoped to the thumbnail, which is what was asked.)
//
// `Math.max(naturalWidth, floorScreenPx / view.k)` — never a pure division —
// because the bead RADIUS drawn below is NOT given the same treatment (a
// bead is a shape, not a line, and is outside this requirement's literal
// ask), so it stays world-scaled and shrinks with `k` same as always. A pure
// screen-constant line width would hold steady while the bead kept shrinking
// underneath it — at this frame's measured k the bead's own screen diameter
// is only 2 * BEAD_RADIUS * k = 0.82px, and a first attempt at this fix
// pinned the line to 1.4 screen px unconditionally: 1.4 / 0.041 = 34.1 world
// px, HALF of which (17.1) exceeds the bead's 10px world radius outright, so
// the connector bar was wider than the bead sitting on it and swallowed the
// status colour the frame exists to show (caught in review before merge).
//
// `THUMB_LINE_SCREEN_FLOOR` is chosen to stay under the bead's own screen
// diameter (20k) down to k = 0.03 — comfortably below the measured live-plan
// value of 0.041, so the arcs/leaders on that plan land at a real, visible
// 0.6 screen px (12x the un-floored 0.049px) while staying narrower than the
// 0.82px bead sitting on them. Below k = 0.03 the floor and the (unfloored)
// bead cross again — a busier plan than the one measured could reach that,
// and is the next thing to check if this needs the fine-tuning the
// requirement's own text expects. `Math.max` means the floor only ever
// ACTIVATES below k = floorScreenPx / naturalWidth (0.5 for the 1.2px arcs);
// above that the line renders exactly as it did before this fix, unchanged.
const THUMB_LINE_SCREEN_FLOOR = 0.6;

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
                                the ones they recognise here. The outline is
                                the only mark delineating one epic from the
                                next (the fill alone does not read as a
                                border), so it gets the same floored width as
                                the arcs below (req #3501) — a plain
                                `strokeWidth={1}` here collapsed to 0.041
                                screen px on the live plan, fainter even than
                                the arcs this requirement was filed about. */}
                            {view.layout.bands.map((band) => (
                                <Group key={`band-${band.key}`}>
                                    <Rect x={2} y={band.y}
                                          width={view.layout.width - 4}
                                          height={band.height}
                                          fill={band.color} opacity={0.06} />
                                    <Rect x={2} y={band.y}
                                          width={view.layout.width - 4}
                                          height={band.height}
                                          stroke={band.color}
                                          strokeWidth={Math.max(1,
                                              THUMB_LINE_SCREEN_FLOOR / view.k)}
                                          opacity={0.35} />
                                </Group>
                            ))}

                            {/* Dependency arcs, under the beads exactly as on
                                the full canvas — but width-floored (req
                                #3501, see THUMB_LINE_SCREEN_FLOOR above) and
                                at full opacity, since a world-space stroke at
                                this frame's k collapses to a sub-pixel
                                hairline no colour can rescue. */}
                            {view.layout.arcs.map((arc, i) => (arc.straight ? (
                                <Line key={`arc-${i}`}
                                      points={[arc.x1, arc.y1, arc.x2, arc.y2]}
                                      stroke={P.arc}
                                      strokeWidth={Math.max(1.2,
                                          THUMB_LINE_SCREEN_FLOOR / view.k)}
                                      opacity={1} />
                            ) : (
                                <Path key={`arc-${i}`} data={arc.path}
                                      stroke={P.arc}
                                      strokeWidth={Math.max(1.2,
                                          THUMB_LINE_SCREEN_FLOOR / view.k)}
                                      opacity={1} />
                            )))}

                            {/* Beads. `beadStyle` is the shared function, so
                                state colour, the manual ring and the eligible
                                ring all match the plan page. The next-up HALO
                                is deliberately not drawn: it is a fixed-screen
                                -size mark designed for a camera this frame does
                                not have, and at this scale it would swamp the
                                bead it points at.

                                THE THUMBNAIL IS AN L1 VIEW (req #3498), so it
                                draws the bead and never the card — a `CARD_W`
                                card rendered into a frame this size is a grey
                                rectangle with unreadable text in it. It
                                therefore needs the plan page's LEADERS for the
                                same reason: the arcs anchor on the card's edge
                                midpoints, so without them every bead would float
                                a half-card clear of the wire it sits on.

                                WHAT THIS COST THE THUMBNAIL, measured: the
                                world is ~3x wider, so `k` falls 0.075 -> 0.041
                                and a bead draws at 0.83 screen px against 1.50
                                before. The leaders used to help less than they
                                looked like they did — at their own WORLD-space
                                1.2px they rendered as a 0.049px hairline
                                regardless of colour. req #3501 is the
                                thumbnail-only floor this comment used to call
                                the honest next move: the leaders below now
                                draw at the same floored width as this frame's
                                own arcs above (`THUMB_LINE_SCREEN_FLOOR`), so
                                they hold a real, visible width at this plan's
                                k — DELIBERATELY kept under the bead's own
                                0.83px screen diameter, so the wire never
                                outweighs the coloured dot riding on it (an
                                unbounded floor did exactly that in review: a
                                34px-world stroke swallowed a 10px-world
                                bead). The bead RADIUS itself is still
                                world-scaled and untouched — a bead is a shape
                                at a scanned location, not a line, and is not
                                what req #3501 asked to brighten. */}
                            {view.rows.map((row) => {
                                const n = view.layout.nodes.get(row.id);
                                if (!n) return null;
                                const style = beadStyle(
                                    row, view.eligible.has(row.id));
                                return (
                                    <Group key={`bead-${row.id}`}>
                                        {/* Same weight and opacity as this
                                            frame's own arcs above — a leader is
                                            a continuation of the wire, not a
                                            second kind of mark. */}
                                        <Line points={[n.left, n.y, n.right, n.y]}
                                              stroke={P.arc}
                                              strokeWidth={Math.max(1.2,
                                                  THUMB_LINE_SCREEN_FLOOR / view.k)}
                                              opacity={1} />
                                        <Circle
                                            x={n.x} y={n.y}
                                            radius={BEAD_RADIUS}
                                            fill={style.fill}
                                            stroke={style.ring}
                                            strokeWidth={style.ringWidth} />
                                    </Group>
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
