// pipelineUrgentReview.js — the pure half of the Plan visualizer's "Urgent
// Review" box (req #3622).
//
// User directive: *"a dashboard that is step width and replicates the
// requirements that have a session that is waiting for my input. So an urgent
// review dashboard"*. It is the Orchestration Ready box's sibling — same
// floating, movable, zoom-sized panel — listing the work that is stopped on the
// USER rather than the work waiting for a step.
//
// ── "WAITING FOR MY INPUT" IS THE LATEST SESSION'S STATUS ──────────────────
// The two session states that are, by the swarm contract, a stop for a human:
// `waiting` (a `discuss` worker says nothing until spoken to) and `review` (a
// worker that has finished and stopped for manual review). `paused` is
// deliberately NOT one — it is a parking the user chose, not a question put to
// them — and `planning` cannot say whether a plan is waiting for approval or
// still being written.
//
// "Latest" is `buildSessionStatusIndex`'s answer — the highest linked session
// id, the same one the Session colour key paints — so a requirement that was
// relaunched reports the session working it now, never an abandoned one.
//
// ── STEP WIDTH, AND NEVER NARROWER THAN A STEP'S LINE ──────────────────────
// A step card's FRAME is `cardFrameW` world px at the live Step Width rung, so
// on screen it is `cardFrameW × k`. Zoomed in, the box is exactly that wide
// (user ruling: step width at every zoom, over an em-sized box that matched a
// card only between ~0.47x and ~0.83x).
//
// Zoomed OUT that number alone is wrong, and was measured wrong by the user —
// *"narrow like pencil"*: the plan lands on an overview where a card is well
// under 100px, but the box's TYPE is clamped at ≥ 9px so it stays legible
// (`unseatedBoxFontPx`), and a 9px row in an ~80px box holds a handful of
// characters. So the width has a FLOOR: a step card's frame at the box's own
// type size (`cardFrameW / CARD_FONT.req` em) — the box always holds at least
// the line a step card holds, at the size it is drawn. Above the floor it is
// the card's on-screen width; at the floor it is a step card scaled to its
// type. The pane caps it (`maxWidth`).

import {
    CARD_FONT, STEP_WIDTH_SCALES, DEFAULT_STEP_WIDTH_LEVEL, cardGeometryFor,
} from './pipelinePlanLayout';

/** The session statuses that mean the work is stopped on the user. */
export const URGENT_SESSION_STATUSES = ['waiting', 'review'];

/**
 * The box's on-screen width in px — one step card frame at the given Step
 * Width rung through the live zoom, floored at that frame drawn at the box's
 * own type size.
 *
 * @param {number} [stepWidthLevel]  1-based rung of `STEP_WIDTH_SCALES`
 * @param {number} [k]  the live zoom scale; non-positive or missing reads as 1
 * @param {number} [fontPx]  the box's type size, screen px; missing → no floor
 */
export function urgentBoxWidthPx(stepWidthLevel = DEFAULT_STEP_WIDTH_LEVEL, k = 1,
    fontPx = 0) {
    const scale = STEP_WIDTH_SCALES[stepWidthLevel - 1] ?? 1;
    const frameW = cardGeometryFor(scale).cardFrameW;
    const onScreen = frameW * (Number.isFinite(k) && k > 0 ? k : 1);
    const floor = Number.isFinite(fontPx) && fontPx > 0
        ? frameW * (fontPx / CARD_FONT.req) : 0;
    return Math.max(onScreen, floor);
}

/**
 * Requirements whose latest session is waiting on the user, ascending by id.
 *
 * Each row is `{id, title, sessionStatus}`. A requirement the title read does
 * not carry still lists, titled by its id alone — a session waiting on the
 * user is the urgent fact, and hiding it for want of a title would be silence.
 *
 * @param {?Map<number, string>} statusIndex  `buildSessionStatusIndex` output;
 *   null while the session reads are in flight
 * @param {Object[]} [requirements]  requirement rows carrying `id`, `title`
 * @returns {Array<{id: number, title: string, sessionStatus: string}>}
 */
export function urgentReviewRequirements(statusIndex, requirements) {
    if (!statusIndex || typeof statusIndex.forEach !== 'function') return [];
    const titleById = new Map();
    for (const r of Array.isArray(requirements) ? requirements : []) {
        if (r && r.id != null) titleById.set(Number(r.id), r.title ?? '');
    }
    const out = [];
    statusIndex.forEach((status, rid) => {
        if (!URGENT_SESSION_STATUSES.includes(status)) return;
        const id = Number(rid);
        if (!Number.isFinite(id)) return;
        out.push({ id, title: titleById.get(id) ?? '', sessionStatus: status });
    });
    return out.sort((a, b) => a.id - b.id);
}
