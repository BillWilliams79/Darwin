// Pure layout math for the visualizer's sticky per-day date/count headers.
//
// Each day row gets a header. The topmost visible day's header pins just under the
// time axis and is PUSHED up by the next day's header as it scrolls in, so the new
// date shoves the old one out and locks into position instead of the old one
// vanishing and the new one popping in (req #2852). Extracted from KonvaSwarmCanvas
// so the geometry can be unit-tested in isolation (same spirit as swarmGeometry.js).
//
// `visibleRows` is ordered top→bottom (increasing world `top`). `t` is the d3-zoom
// transform { k, x, y }; a row's screen Y is `r.top * t.k + t.y` (smaller = higher).
//
// Returns an array of { key, date, count, top, left, isSel } in screen space.
export function computeDayHeaders(visibleRows, t, sizeH, noonScreenX, selectedDate, axisH, headerH) {
    if (!visibleRows || !visibleRows.length) return [];
    const out = [];
    let lastBottom = -Infinity;
    let prevPinnedPush = false;                        // the header just emitted is a pinned (sticky) one being pushed up by THIS one
    for (let i = 0; i < visibleRows.length; i++) {
        const r = visibleRows[i];
        const screenY = r.top * t.k + t.y;
        const next = visibleRows[i + 1];
        const nextScreenY = next ? next.top * t.k + t.y : Infinity;
        const pinned = screenY < axisH;               // row scrolled above the axis → sticky-pinned to it
        let hy = Math.max(axisH, screenY);            // stick under the axis
        const pushedUp = hy + headerH > nextScreenY;  // next day's header is shoving this one up
        if (pushedUp) hy = nextScreenY - headerH;     // pushed up, flush above the incoming day's header
        if (hy > sizeH || hy + headerH <= axisH) continue;  // <= so a header fully behind the axis yields to the next (no swap flicker)
        // Declutter Overview's stacked headers — but never drop the header that is actively
        // pushing the pinned (sticky) top header up. The push makes the two flush by construction
        // (lastBottom === hy), which the +2 overlap test would otherwise treat as a collision and
        // skip, making the incoming date vanish during the slide then pop in once the old one is
        // filtered behind the axis. Exempting the pusher lets the new date ride up flush behind the
        // old one and lock into position (req #2852). `pinned &&` keeps this from cascading in deep
        // Overview, where every short row "pushes" the next — only the one straddling the axis qualifies.
        if (hy < lastBottom + 2) {                     // would overlap the previous header
            if (!prevPinnedPush) continue;             // ordinary clutter → skip (declutters Overview)
            hy = lastBottom;                           // exempt pusher → clamp flush instead of overlapping (deep-zoom safety; a no-op at normal zoom where lastBottom === hy)
        }
        lastBottom = hy + headerH;
        prevPinnedPush = pinned && pushedUp;
        out.push({ key: r.date, date: r.date, count: r.model.count,
                   top: hy, left: noonScreenX, isSel: r.date === selectedDate });
    }
    return out;
}
