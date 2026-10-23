// pipelineThumbnailFrame.js — where the pipeline card's plan thumbnail looks
// (req #3641). Pure arithmetic over a `computePlanLayout` result, kept out of
// the component so the crop is testable without a canvas. The design — why an
// L3 crop, why three epics across — is in
// `PipelinePlanThumbnail.jsx`'s header.

// The frame. Height is the card's to spend and is deliberately short — this is
// a glance, not a reading surface, and every pixel here is one the description
// and the pill row do not get.
export const THUMB_H = 132;

// How many epic columns span the frame — see the header. The one number that
// sets how close the crop is.
export const THUMB_EPICS_ACROSS = 3;

// Air above a card pinned by its top (a card taller than the strip), so its
// frame and epic name do not sit flush against the thumbnail's border.
const THUMB_TOP_PAD = 8;

// Keep the world under the frame: no open panel past the plan's edge on an
// axis where the plan is bigger than the frame, centred where it is not.
const clampOffset = (o, worldPx, framePx) => (worldPx >= framePx
    ? Math.min(0, Math.max(framePx - worldPx, o))
    : (framePx - worldPx) / 2);

/**
 * The frame's transform: the scale, and the offset of the crop that shows the
 * MOST CARD — clamped to the world where the world is bigger than the frame.
 * Pure, so the crop is testable without a canvas.
 *
 * ── WHY COVERAGE, NOT "THE CARD NEAREST THE MIDDLE" (req #3641 review) ─────
 * The first cut centred the card nearest the world's centre. Measured on the
 * three live plans at a 420px card, that crop covered 48% / 34% / 19% of the
 * frame with cards against 79% / 72% / 69% for the best crop at the same scale
 * — the time axis spreads a plan's cards across columns, so the middle of the
 * world is reliably a SPARSE spot, and plan 7 showed one lone card in a field
 * of band wash. The directive is a crop that fills the viewport, so the crop
 * is chosen by what fills it.
 *
 * CANDIDATES: every card, framed three ways — centred on it, and half a column
 * either side (so a pair of neighbours can share the frame rather than one
 * being centred and the other cut in half). Vertically a candidate centres its
 * card, or pins a card taller than the strip by its top so the epic name
 * shows. Each candidate is clamped first and SCORED AS CLAMPED, so the score is
 * the crop that would actually be drawn. Score = card area inside the frame.
 * Ties go to the candidate nearer the world's middle, so among equally full
 * crops the one that reads as "the centre" wins — the directive's own words.
 *
 * O(3n²) rectangle intersections: ~77k on a 160-epic plan, a few ms, run once
 * per payload and frame width.
 *
 * @returns {?{k:number, ox:number, oy:number}} null when nothing can be framed
 */
export function thumbnailFrame(layout, frameW, frameH = THUMB_H,
    epicsAcross = THUMB_EPICS_ACROSS) {
    if (!layout || !(frameW > 0) || !(frameH > 0)) return null;
    if (!(layout.width > 0) || !(layout.height > 0)) return null;
    const pitch = layout.colPitch;
    if (!(pitch > 0) || !(epicsAcross > 0)) return null;
    const k = frameW / (epicsAcross * pitch);
    const worldW = layout.width * k;
    const worldH = layout.height * k;

    const nodes = [...(layout.nodes?.values?.() || [])];
    if (!nodes.length) {
        // No card at all: the middle of the world.
        return {
            k,
            ox: clampOffset(frameW / 2 - (layout.width / 2) * k, worldW, frameW),
            oy: clampOffset(frameH / 2 - (layout.height / 2) * k, worldH, frameH),
        };
    }

    // Card area (screen px²) inside the frame at offset (ox, oy).
    const coverage = (ox, oy) => {
        let area = 0;
        for (const n of nodes) {
            const w = Math.min(n.right * k + ox, frameW) - Math.max(n.left * k + ox, 0);
            if (w <= 0) continue;
            const h = Math.min(n.bottom * k + oy, frameH) - Math.max(n.top * k + oy, 0);
            if (h > 0) area += w * h;
        }
        return area;
    };

    // Where the frame's centre sits in the world, normalised by the world's own
    // aspect — the tie-break toward the middle.
    const offCentre = (ox, oy) => {
        const wx = (frameW / 2 - ox) / k;
        const wy = (frameH / 2 - oy) / k;
        return ((wx - layout.width / 2) / layout.width) ** 2
            + ((wy - layout.height / 2) / layout.height) ** 2;
    };

    let best = null;
    for (const n of nodes) {
        const oy = clampOffset(n.h * k <= frameH - 2 * THUMB_TOP_PAD
            ? frameH / 2 - (n.top + n.h / 2) * k
            : THUMB_TOP_PAD - n.top * k, worldH, frameH);
        for (const dx of [0, -pitch / 2, pitch / 2]) {
            const ox = clampOffset(frameW / 2 - (n.x + dx) * k, worldW, frameW);
            const score = coverage(ox, oy);
            const centre = offCentre(ox, oy);
            if (!best || score > best.score + 1e-6
                || (Math.abs(score - best.score) <= 1e-6 && centre < best.centre)) {
                best = { ox, oy, score, centre };
            }
        }
    }
    return { k, ox: best.ox, oy: best.oy };
}
