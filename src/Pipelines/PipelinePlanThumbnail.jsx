// PipelinePlanThumbnail.jsx — a window onto the plan, on a pipeline card
// (req #3365 user directive: *"Similar to map view, can we have a small
// visualizer window appear in the Pipeline card view."*).
//
// ── IT IS AN L3 CROP, NOT AN L1 OVERVIEW (req #3641 user directive) ─────────
// *"Cards of pipelines has a preview that is a full view L1 detail. Let's get a
// full view L3 detail instead … like cutting a nice center out with L3 detail
// will look legit. Make that fill the whole view port in the card instead of
// just the center."* So this no longer fits the WHOLE plan into the strip as
// beads. It draws the plan's L3 formation — cards, state bars, epic names,
// requirement titles in their colour key — at a fixed scale, and cuts the
// frame out of the plan's middle, the full width of the card.
//
// What it is NOT is a second visualizer: no camera, no d3-zoom, no wheel
// handler, no hit targets, no initiative overlay, no key, no tooltips. One
// `<Stage listening={false}>`; the card underneath owns the click.
//
// ── IT SHARES THE REAL GEOMETRY, IT DOES NOT APPROXIMATE IT ─────────────────
// `computePlanLayout` is the same function the full canvas calls, with the
// same options PipelineDetail pins (`epicLabel`/`reqLabel` = 'title', the
// requirement titles, the time axis, the pause), over rows adapted with the
// same `now` `usePlanSources` passes (an empty epic sits on TODAY, req #3618 —
// without it the thumbnail would put that epic in a different column and crop
// a different picture), so every card here is the card the plan page draws,
// wrapped at the same characters. `beadStyle`,
// `reqIdStyle` and the palette are the shared functions and entries. A
// thumbnail drawn from a private simplification would drift from the page it
// is a preview OF. What is genuinely this component's own is the SCALE and
// the CROP, and the marks it leaves out (below).
//
// ── THE SCALE: THREE EPICS ACROSS THE FRAME ─────────────────────────────────
// `THUMB_EPICS_ACROSS` columns of the plan's own pitch (`layout.colPitch`)
// span the frame. The layout runs at the DEFAULT Epic Width rung, not the
// reader's chosen one: that preference belongs to the plan page's toolbar, and
// a card preview is the plan at its factory width. At a ~420px card that is
// k ≈ 0.30 — the scale the plan page's own L3 view lands at on a wide
// monitor, which is the "legit" look the directive points at: cards that read
// as cards, with lettering that reads as lettering, if not word for word.
//
// ── THE CROP: THE FULLEST FRAME, NEAREST THE MIDDLE ─────────────────────────
// The literal centre of the world is often open band — the time axis spreads a
// plan's cards across columns, and a frame centred on nothing is an empty panel
// that looks broken. So `thumbnailFrame` picks the crop that shows the most
// card, breaking ties toward the middle, clamped so the frame never runs past
// the world's edge. A card taller than the strip is pinned by its top, so its
// epic name — the thing a reader recognises — is what shows. The measurement
// behind this is on `thumbnailFrame` itself.
//
// ── WHAT IS LEFT OUT, AND WHY ───────────────────────────────────────────────
//   · the ruler STRIP (its dates, ticks and baseline) and the initiative names —
//     the strip is pinned viewport chrome on the plan page and the names sit
//     at the world's left edge; neither belongs to the region a crop shows.
//     The ruler's full-height slot rules and the future-region tint ARE drawn:
//     they are background guides through the plan, not the header;
//   · the terminal / dev-server pills (`reqPills`) — they are live session
//     state from two more reads, and a card thumbnail is not where that is
//     owed; the layout is run without them, so the rows simply carry no pill;
//   · the running pulse — a card grid of animating thumbnails is noise.
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
import { Stage, Layer, Group, Rect, Line, Path, Text } from 'react-konva';

import { useComposedPipeline } from '../hooks/useDataQueries';
import { adaptComposedPipeline, buildPlanModel } from '../SwarmView/pipelines/pipelineAdapter';
import { localDayOf } from '../SwarmView/pipelines/pipelinePlanTime';
import {
    computePlanLayout,
    beadStyle,
    reqIdStyle,
    buildReqColorViews,
    orderEpicReqs,
    CARD_DONE_RULE_DASH,
    CARD_DONE_RULE_OPACITY,
    DEFAULT_COLOR_KEY,
    DEFAULT_PLAN_PALETTE,
    PLAN_VIZ_PALETTE,
    CARD_FONT,
    CARD_BADGE_FONT,
    CARD_RUN_FONT,
    CARD_LINE_H,
    REQ_LINE_H,
    REQ_SEP_PULL,
    CARD_RADIUS,
    CARD_PAD_X,
    CARD_RULE_GAP,
    CARD_STATE_BAR_W,
    MIN_CARD_H,
    NEXT_HALO_STROKE,
    NEXT_HALO_OPACITY,
    NEXT_HALO_DASH,
    DEFAULT_PLAN_EPIC_WIDTH,
} from '../SwarmView/pipelines/pipelinePlanLayout';
import { thumbnailFrame, THUMB_H } from './pipelineThumbnailFrame';

// The plan page's monospace stack — the same font the card was measured for.
const MONO = '"SF Mono", "JetBrains Mono", Menlo, monospace';

// ── LINES ARE FLOORED AT A MINIMUM SCREEN WIDTH (req #3501) ─────────────────
// The full canvas draws its dependency arcs and band outlines at a fixed WORLD
// width, which at this frame's k (~0.3) lands under half a pixel and
// anti-aliases to almost nothing. `Math.max(naturalWidth, floor / k)` holds
// them at a visible screen width without ever drawing them thinner than the
// plan page does.
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

    // THE PLAN, ADAPTED AND LAID OUT — independent of the frame's width, so a
    // window resize re-crops without re-running the layout. Each stage is pure
    // and the inputs change only when the payload does, so a card re-rendering
    // for an unrelated reason (a status filter toggle, a sibling's refetch)
    // re-runs none of it. `today` is a memo key for `usePlanSources`'
    // reason: empty and running epics sit on the reader's local today, so a
    // render after local midnight must re-place them even when the cached
    // payload object is unchanged.
    const today = localDayOf(new Date());
    const drawing = useMemo(() => {
        if (!data) return null;
        let adapted;
        let model;
        try {
            adapted = adaptComposedPipeline(data, { machines, now: new Date() });
            model = buildPlanModel(data, machines);
        } catch {
            // A payload this component cannot read is a BLANK FRAME, never a
            // thrown error: the plan detail page is the surface that owes the
            // reader a diagnostic for a withheld derivation (it renders one),
            // and a card is not the place to learn about it.
            return null;
        }
        // `adaptComposedPipeline` RETURNS THE PLAN, it does not wrap one — see
        // `usePlanSources`, which assigns it straight to `plan`.
        const baseRows = adapted?.rows;
        if (!baseRows || !baseRows.length) return null;

        // The requirement rows in each card, in the order the plan page shows
        // them — orchestration order (req #3676), the same `orderEpicReqs`
        // pass the visualizer runs over the same rows.
        const reqById = new Map(model.requirements.map((r) => [r.id, r]));
        const rows = orderEpicReqs(baseRows, {
            statusOf: (id) => reqById.get(id)?.requirement_status,
            autonomyOf: (id) => reqById.get(id)?.coordination_type,
        });

        const reqTitles = new Map(model.requirements.map((r) => [r.id, r.title]));
        const layout = computePlanLayout(rows, {
            epicLabel: 'title', reqLabel: 'title', reqTitles,
            palette: DEFAULT_PLAN_PALETTE,
            timeAxis: adapted.timeAxis || null,
            pauseInfo: adapted.pause || null,
            // The plan page's own card width (req #3648 — 25% wider), so the
            // thumbnail draws the cards the reader will open, not the base card.
            epicWidthLevel: DEFAULT_PLAN_EPIC_WIDTH,
        });
        if (!layout || layout.empty || !(layout.width > 0)) return null;

        const presentReqIds = new Set(rows.flatMap((r) => r.reqIds || []));
        const reqColorViews = buildReqColorViews({
            requirements: model.requirements, machines: model.machines, presentReqIds,
            palette: DEFAULT_PLAN_PALETTE,
        });
        return {
            layout,
            // Always a ruler, never a missing one — `computePlanLayout`
            // publishes an inert one on an empty plan for exactly this reader.
            ruler: layout.ruler || { slots: [], futureX: null },
            rows,
            reqColorViews,
            // Already a Set on the adapted plan; copied rather than aliased so
            // a later edit here cannot mutate the cached plan object.
            eligible: new Set(adapted?.eligibleEpicIds || []),
        };
    }, [data, machines, today]);

    const frame = useMemo(
        () => (drawing && width > 0 ? thumbnailFrame(drawing.layout, width) : null),
        [drawing, width]);

    // Only the cards the frame can show are drawn — a crop of a 100-epic plan
    // shows a handful, and each card is a dozen Konva nodes.
    const visibleIds = useMemo(() => {
        if (!drawing || !frame) return null;
        const { k, ox, oy } = frame;
        const ids = new Set();
        for (const [id, n] of drawing.layout.nodes) {
            if (n.right * k + ox >= 0 && n.left * k + ox <= width
                && n.bottom * k + oy >= 0 && n.top * k + oy <= THUMB_H) ids.add(id);
        }
        return ids;
    }, [drawing, frame, width]);

    const P = PLAN_VIZ_PALETTE;
    const CF = CARD_FONT;
    const view = drawing && frame && visibleIds ? { ...drawing, ...frame } : null;
    const lineW = (natural) => (view
        ? Math.max(natural, THUMB_LINE_SCREEN_FLOOR / view.k) : natural);

    // The frame is drawn in EVERY state — loading, failed, empty and drawn —
    // and always spans the card, so the card's height never changes underneath
    // the reader. A thumbnail that collapsed while its read was in flight would
    // reflow the whole grid.
    return (
        <Box
            ref={setEl}
            data-testid={`pipelines-card-thumb-${pipelineId}`}
            data-thumb-state={isLoading ? 'loading' : isError ? 'error'
                : view ? 'drawn' : 'empty'}
            sx={{
                height: THUMB_H,
                mb: 1.5,
                borderRadius: 2,
                overflow: 'hidden',
                border: '1px solid',
                borderColor: 'divider',
                // The canvas's own panel colour, so the thumbnail reads as a
                // window onto the visualizer rather than as a chart on a card.
                background: P.panel,
            }}
        >
            {view && width > 0 && (
                <Stage width={width} height={THUMB_H} listening={false}>
                    <Layer listening={false}>
                        <Group x={view.ox} y={view.oy} scaleX={view.k} scaleY={view.k}>
                            {/* Initiative bands — the same two rounded rects the
                                full canvas draws, at the same opacities, so the
                                initiative colours a reader learns on the plan page
                                are the ones they recognise here — and each
                                lane's wire through its cards' midpoints. */}
                            {view.layout.bands.map((band) => (
                                <Group key={`band-${band.key}`}>
                                    <Rect x={2} y={band.y}
                                          width={view.layout.width - 4}
                                          height={band.height} cornerRadius={8}
                                          fill={band.color} opacity={0.06} />
                                    <Rect x={2} y={band.y}
                                          width={view.layout.width - 4}
                                          height={band.height} cornerRadius={8}
                                          stroke={band.color}
                                          strokeWidth={lineW(1)}
                                          opacity={0.35} />
                                    {Array.from({ length: band.sub || 0 }, (_, l) => {
                                        // The canvas's own wire y — see its
                                        // comment on `laneCardH`.
                                        const wy = band.y + band.headerH + band.laneY[l]
                                            + (band.laneCardH?.get(l) ?? MIN_CARD_H) / 2;
                                        return (
                                            <Line key={`wire-${l}`}
                                                  points={[36, wy, view.layout.width - 14, wy]}
                                                  stroke={P.wire} strokeWidth={lineW(1.2)}
                                                  opacity={0.18} />
                                        );
                                    })}
                                </Group>
                            ))}

                            {/* The time ruler's background guides — the future
                                tint and the full-height slot rules, as the
                                canvas draws them over the bands and under the
                                arcs. The strip itself is left out (header). */}
                            {view.ruler.futureX != null
                                && view.ruler.futureX < view.layout.width && (
                                <Rect x={view.ruler.futureX} y={0}
                                      width={view.layout.width - view.ruler.futureX}
                                      height={view.layout.height}
                                      fill={P.wire} opacity={0.07} />
                            )}
                            {view.ruler.slots.map((slot, i) => {
                                if (i === 0) return null;
                                const gapped = slot.gapDays != null && slot.gapDays > 1;
                                return (
                                    <Line key={`rule-${slot.key}`}
                                          points={[slot.x, 6, slot.x, view.layout.height - 6]}
                                          stroke={gapped ? P.dim : P.line}
                                          strokeWidth={lineW(1)}
                                          dash={gapped ? [5, 5] : undefined}
                                          opacity={gapped ? 0.5 : 0.55} />
                                );
                            })}

                            {/* Dependency arcs, under the cards exactly as on
                                the full canvas, width-floored. */}
                            {view.layout.arcs.map((arc, i) => (arc.straight ? (
                                <Line key={`arc-${i}`}
                                      points={[arc.x1, arc.y1, arc.x2, arc.y2]}
                                      stroke={P.arc} strokeWidth={lineW(1.4)} />
                            ) : (
                                <Path key={`arc-${i}`} data={arc.path}
                                      stroke={P.arc} strokeWidth={lineW(1.4)} />
                            )))}

                            {/* The cards — frame, state bar and the rule under
                                the title, as the plan page paints them at L3,
                                with the next-epic halo as the card's dashed
                                outline. */}
                            {view.rows.map((row) => {
                                if (!visibleIds.has(row.id)) return null;
                                const n = view.layout.nodes.get(row.id);
                                if (!n) return null;
                                const style = beadStyle(row, view.eligible.has(row.id),
                                    row.launchSuppressed);
                                const ruleY = n.top + n.titleH + CARD_RULE_GAP;
                                return (
                                    <Group key={`card-${row.id}`}>
                                        {style.next && (
                                            <Rect x={n.frameLeft - NEXT_HALO_STROKE}
                                                  y={n.top - NEXT_HALO_STROKE}
                                                  width={n.frameW + 2 * NEXT_HALO_STROKE}
                                                  height={n.h + 2 * NEXT_HALO_STROKE}
                                                  cornerRadius={CARD_RADIUS + NEXT_HALO_STROKE}
                                                  stroke={style.haloColor}
                                                  strokeWidth={NEXT_HALO_STROKE}
                                                  opacity={NEXT_HALO_OPACITY}
                                                  dash={NEXT_HALO_DASH} />
                                        )}
                                        <Rect x={n.frameLeft} y={n.top}
                                              width={n.frameW} height={n.h}
                                              cornerRadius={CARD_RADIUS}
                                              fill={P.panel} stroke={style.ring}
                                              strokeWidth={style.ringWidth} />
                                        <Rect x={n.left} y={n.top}
                                              width={CARD_STATE_BAR_W} height={n.h}
                                              cornerRadius={CARD_STATE_BAR_W / 2}
                                              fill={style.bar} />
                                        <Line points={[
                                            n.frameLeft + CARD_PAD_X, ruleY,
                                            n.frameLeft + n.frameW - CARD_PAD_X, ruleY,
                                        ]} stroke={P.line} strokeWidth={lineW(1)} />
                                        {n.doneRule && (
                                            <Line points={[
                                                n.frameLeft + CARD_PAD_X, n.doneRule.y,
                                                n.frameLeft + n.frameW - CARD_PAD_X,
                                                n.doneRule.y,
                                            ]} stroke={P.dim} strokeWidth={lineW(1)}
                                                  dash={CARD_DONE_RULE_DASH}
                                                  opacity={CARD_DONE_RULE_OPACITY} />
                                        )}
                                    </Group>
                                );
                            })}

                            {/* The lettering, from the layout's own label
                                boxes — L3's formation: the epic name, each
                                requirement's TITLE row (wrapped by the layout,
                                never re-wrapped here) in its colour key, the
                                count badge and the run pill. */}
                            {view.layout.labels.map((label, i) => {
                                if (label.epicId == null || !visibleIds.has(label.epicId)) {
                                    return null;
                                }
                                if (label.kind === 'epic') {
                                    return (
                                        <Text key={`lbl-${i}`} x={label.x} y={label.y}
                                              text={(label.lines || [label.text]).join('\n')}
                                              fontSize={CF.label} fontFamily={MONO}
                                              fill={P.text}
                                              lineHeight={CARD_LINE_H / CF.label} />
                                    );
                                }
                                if (label.kind === 'req') {
                                    const rs = reqIdStyle({
                                        colorKey: DEFAULT_COLOR_KEY,
                                        views: view.reqColorViews,
                                        reqId: label.reqId,
                                    });
                                    const text = Array.isArray(label.lines)
                                        ? label.lines.join('\n') : label.text;
                                    // req #3683 — the id→title gap is 1.5
                                    // characters, as on the plan canvas: the id
                                    // stays put and the rest is drawn
                                    // `REQ_SEP_PULL` further left.
                                    const id = String(label.reqId);
                                    const font = {
                                        fontSize: CF.req, fontFamily: MONO,
                                        lineHeight: REQ_LINE_H / CF.req, fill: rs.fill,
                                        fontStyle: rs.bold ? 'bold' : 'normal',
                                    };
                                    if (text.length <= id.length) {
                                        return (
                                            <Text key={`lbl-${i}`} x={label.x} y={label.y}
                                                  text={text} {...font} />
                                        );
                                    }
                                    return (
                                        <Group key={`lbl-${i}`}>
                                            <Text x={label.x} y={label.y} text={id} {...font} />
                                            <Text x={label.x - REQ_SEP_PULL} y={label.y}
                                                  text={' '.repeat(id.length) + text.slice(id.length)}
                                                  {...font} />
                                        </Group>
                                    );
                                }
                                if (label.kind === 'badge' || label.kind === 'run') {
                                    const run = label.kind === 'run';
                                    return (
                                        <Group key={`lbl-${i}`}>
                                            <Rect x={label.x} y={label.y}
                                                  width={label.w} height={label.h}
                                                  cornerRadius={label.h / 2}
                                                  fill={run
                                                      ? (label.run === 'manual'
                                                          ? P.runManual : P.runAuto)
                                                      : P.badgeFill} />
                                            <Text x={label.x} y={label.y}
                                                  width={label.w} height={label.h}
                                                  text={label.text}
                                                  align="center" verticalAlign="middle"
                                                  fontSize={run ? CARD_RUN_FONT : CARD_BADGE_FONT}
                                                  fontFamily={MONO} fontStyle="bold"
                                                  fill={run ? P.panel : P.badgeText}
                                                  wrap="none" />
                                        </Group>
                                    );
                                }
                                return null;
                            })}
                        </Group>
                    </Layer>
                </Stage>
            )}
        </Box>
    );
}
