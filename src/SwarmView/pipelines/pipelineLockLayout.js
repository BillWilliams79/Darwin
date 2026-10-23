// pipelineLockLayout.js — the Lock view's model and geometry (req #3761).
//
// The Lock view is the plan visualizer condensed to THREE tiers — pipeline,
// initiatives, epics — with no requirement drawn. It answers one question at a
// glance: which parts of this plan are locked or paused, and where is each
// engine working? This module is the whole of its logic; `PipelineLockView.jsx`
// only draws what is computed here (the `pipelinePlanLayout.js` / canvas split).
//
// NO JSX and no React: a pure module vitest runs without a DOM.
//
// ── THE FACTS ARE ALL INPUTS, NONE IS DERIVED FROM A REQUIREMENT ─────────────
//   locked     the stored flag at each tier. It CASCADES (req #3649's gateway
//              rule): an initiative under a locked pipeline, and an epic under
//              a locked initiative or pipeline, is as frozen as one locked in its
//              own right. `cascadeLock` is the one place that is decided and
//              `lockedBy` names the OUTERMOST lock, the one that has to be lifted.
//   paused     `pipelines.pipeline_status = 'paused'` and
//              `initiatives.initiative_status = 'paused'`. Pause SUPPRESSES
//              launching and is not a lifecycle; a paused pipeline pauses every
//              initiative in it (`derived.pause`), which `pausedBy` records.
//   holders    `orchestration_claims`, rendered by `orchestrationHolder.js` — the
//              same lead / subscriber vocabulary and tones as the plan header's
//              badges. A whole-pipeline claim outlines the pipeline; an
//              initiative claim outlines that initiative.
//   epic colour  `beadStyle` — the colour the full canvas draws (red locked,
//              orange manual, yellow barrier, green will-run), so the two views
//              never disagree about an epic.

import { beadStyle } from './pipelinePlanLayout';
import {
    resolveRoles, isStale, holderView, machinePlatformLabel,
    ROLE_LEAD, ROLE_REFUSED, BADGE_LEAD, BADGE_SUBSCRIBER, BADGE_STALE,
} from './orchestrationHolder';

const asArray = (v) => (Array.isArray(v) ? v : []);
const flagOn = (v) => v === true || (v != null && v !== '' && Number(v) !== 0 && Number.isFinite(Number(v)));

export const LOCK_BY_PIPELINE = 'pipeline';
export const LOCK_BY_INITIATIVE = 'initiative';
export const LOCK_BY_EPIC = 'epic';

/**
 * The OUTERMOST lock holding a row, or null — the cascade in one expression.
 * `'pipeline'` beats `'initiative'` beats `'epic'` because unlocking the epic
 * helps nobody while its pipeline is locked (the gateway's `locked_by`).
 */
export function cascadeLock({ pipelineLocked = false, initiativeLocked = false, epicLocked = false } = {}) {
    if (pipelineLocked) return LOCK_BY_PIPELINE;
    if (initiativeLocked) return LOCK_BY_INITIATIVE;
    if (epicLocked) return LOCK_BY_EPIC;
    return null;
}

// ── HOLDERS ─────────────────────────────────────────────────────────────────

/**
 * Every reservation on this pipeline, as display holders, split by scope:
 * `{ pipeline: Holder[], byInitiative: Map<initiativeId, Holder[]> }`.
 *
 * Holder: `{ key, claimId, scope, initiativeId, machineFk, machine, platform,
 * role, tone, stale, label, title }`. `role` is `'lead'` / `'subscriber'` for a
 * live claim and null for a stale one; `tone` is the badge vocabulary
 * (`BADGE_LEAD` green, `BADGE_SUBSCRIBER` orange, `BADGE_STALE` grey). A
 * REFUSED claim launches nothing and gets no holder, as it gets no badge.
 */
export function lockHolders(claims, pipelineId, machines, now = new Date()) {
    const out = { pipeline: [], byInitiative: new Map() };
    if (pipelineId == null) return out;
    const onPlan = asArray(claims).filter((c) => c && c.pipeline_fk === pipelineId);
    const live = onPlan.filter((c) => !isStale(c, now));
    const roles = resolveRoles(live);
    const machineOf = (c) => asArray(machines).find((m) => m.id === c.machine_fk) || null;

    // Live claims first, by id — the order `orchestrationBadges` uses — so the
    // first holder of a scope is its lead and a stale one never sets the outline.
    const ordered = onPlan.slice().sort((a, b) => Number(isStale(a, now)) - Number(isStale(b, now))
        || (Number.isInteger(a.id) ? a.id : Infinity) - (Number.isInteger(b.id) ? b.id : Infinity));
    for (const claim of ordered) {
        const verdict = roles.get(claim.id);
        if (verdict && verdict.role === ROLE_REFUSED) continue;
        const stale = !verdict;
        const view = holderView(claim, machines, now);
        const role = stale ? null : (verdict.role === ROLE_LEAD ? 'lead' : 'subscriber');
        const holder = {
            key: `claim-${claim.id}`,
            claimId: claim.id,
            scope: claim.initiative_fk == null ? 'pipeline' : 'initiative',
            initiativeId: claim.initiative_fk ?? null,
            machineFk: claim.machine_fk ?? null,
            machine: view.machine,
            platform: machinePlatformLabel(machineOf(claim)),
            role,
            tone: stale ? BADGE_STALE : role === 'lead' ? BADGE_LEAD : BADGE_SUBSCRIBER,
            stale,
            label: stale ? `${view.machine} (stale)` : `${view.machine} · ${role}`,
            title: view.title,
        };
        if (holder.scope === 'pipeline') {
            out.pipeline.push(holder);
        } else {
            if (!out.byInitiative.has(holder.initiativeId)) out.byInitiative.set(holder.initiativeId, []);
            out.byInitiative.get(holder.initiativeId).push(holder);
        }
    }
    return out;
}

// ── THE MODEL ───────────────────────────────────────────────────────────────

/** `pipelines.pipeline_status` values the pause control may write between. */
export const PAUSABLE_PIPELINE_STATUSES = ['active', 'paused'];

/**
 * @param {Object} args
 * @param {Object} args.pipeline       the plan row (`id`, `title`, `pipeline_status`, `locked`)
 * @param {Object} args.plan           `adaptComposedPipeline`'s output (`rows`, `locked`, `pause`)
 * @param {Object[]} [args.initiatives] the payload's `initiatives[]` (so an empty one is drawn too)
 * @param {Object[]} [args.claims]     `orchestration_claims` rows
 * @param {Object[]} [args.machines]
 * @param {Date} [args.now]
 */
export function buildLockModel({ pipeline, plan, initiatives = [], claims = [], machines = [], now = new Date() }) {
    const rows = asArray(plan && plan.rows);
    const pipelineLocked = flagOn(pipeline && pipeline.locked) || Boolean(plan && plan.locked);
    const pauseInfo = (plan && plan.pause) || {};
    const status = pipeline && pipeline.pipeline_status != null
        ? pipeline.pipeline_status : (pauseInfo.pipelineStatus ?? null);
    const pipelinePaused = status === 'paused' || Boolean(pauseInfo.pipelinePaused);
    const pausedIds = new Set(asArray(pauseInfo.pausedInitiativeIds));
    const holders = lockHolders(claims, pipeline && pipeline.id, machines, now);

    const rawById = new Map(asArray(initiatives).map((i) => [i.id, i]));
    const lockedIds = new Set(asArray(initiatives).filter((i) => flagOn(i.locked)).map((i) => i.id));
    for (const id of (plan && plan.lockedInitiativeIds) || []) lockedIds.add(id);

    // Group epics by initiative in the plan's own display order.
    const groups = new Map();
    const firstSeen = new Map();
    rows.forEach((row, index) => {
        const key = row.initiativeId != null ? row.initiativeId : null;
        if (!groups.has(key)) { groups.set(key, []); firstSeen.set(key, index); }
        groups.get(key).push(row);
    });
    const keys = new Set([...groups.keys(), ...rawById.keys()]);

    const sortOrderOf = (key) => {
        const raw = rawById.get(key);
        const v = raw && raw.sort_order != null ? Number(raw.sort_order) : NaN;
        return Number.isFinite(v) ? v : null;
    };
    const ordered = [...keys].sort((a, b) => {
        const sa = sortOrderOf(a);
        const sb = sortOrderOf(b);
        if (sa != null && sb != null && sa !== sb) return sa - sb;
        if ((sa != null) !== (sb != null)) return sa != null ? -1 : 1;
        const fa = firstSeen.has(a) ? firstSeen.get(a) : Infinity;
        const fb = firstSeen.has(b) ? firstSeen.get(b) : Infinity;
        if (fa !== fb) return fa - fb;
        return (a ?? Infinity) - (b ?? Infinity);
    });

    const built = ordered.map((key) => {
        const raw = rawById.get(key) || null;
        const groupRows = groups.get(key) || [];
        const initiativeLocked = key != null && lockedIds.has(key);
        const initiativeLockedBy = cascadeLock({ pipelineLocked, initiativeLocked });
        const ownPaused = key != null
            && ((raw && raw.initiative_status === 'paused') || pausedIds.has(key));
        const epics = groupRows.map((row) => {
            const epicLocked = flagOn(row.locked);
            const lockedBy = cascadeLock({ pipelineLocked, initiativeLocked, epicLocked });
            const effectiveLocked = lockedBy != null;
            const suppressed = Boolean(row.launchSuppressed);
            return {
                id: row.id,
                title: row.title || `Epic ${row.id}`,
                locked: epicLocked,
                lockedBy,
                effectiveLocked,
                barrier: row.checkpoint !== false && row.checkpoint !== 0,
                manual: row.run === 'manual',
                state: row.state,
                eligible: Boolean(row.eligible),
                suppressed,
                // The colour the full canvas draws, with the cascade applied.
                style: beadStyle({ ...row, effectiveLocked }, Boolean(row.eligible), suppressed),
            };
        });
        const title = (raw && raw.title) || (groupRows[0] && groupRows[0].initiative)
            || (key == null ? 'No initiative' : `Initiative ${key}`);
        return {
            key,
            id: key,
            title,
            locked: initiativeLocked,
            lockedBy: initiativeLockedBy,
            effectiveLocked: initiativeLockedBy != null,
            paused: ownPaused,
            pausedBy: pipelinePaused ? 'pipeline' : ownPaused ? 'initiative' : null,
            effectivePaused: pipelinePaused || ownPaused,
            holders: key != null ? (holders.byInitiative.get(key) || []) : [],
            epics,
            counts: {
                epics: epics.length,
                lockedEpics: epics.filter((e) => e.effectiveLocked).length,
            },
        };
    });

    return {
        pipeline: {
            id: pipeline ? pipeline.id : null,
            title: (pipeline && pipeline.title) || '',
            status,
            locked: pipelineLocked,
            lockedBy: pipelineLocked ? LOCK_BY_PIPELINE : null,
            paused: pipelinePaused,
            canPause: PAUSABLE_PIPELINE_STATUSES.includes(status),
            holders: holders.pipeline,
        },
        initiatives: built,
        totals: {
            initiatives: built.length,
            lockedInitiatives: built.filter((i) => i.effectiveLocked).length,
            pausedInitiatives: built.filter((i) => i.effectivePaused).length,
            epics: built.reduce((n, i) => n + i.counts.epics, 0),
            lockedEpics: built.reduce((n, i) => n + i.counts.lockedEpics, 0),
        },
    };
}

// ── GEOMETRY ────────────────────────────────────────────────────────────────

export const LOCK_GEOM = Object.freeze({
    PAD: 16,            // canvas margin around the pipeline frame
    FRAME_PAD: 12,      // pipeline frame's inner padding
    HEAD_H: 64,         // the pipeline tier's header
    BAND_GAP: 10,       // between initiative bands
    BAND_PAD: 10,       // inside a band, around its epics
    BAND_HEAD_W: 212,   // the initiative's own header cell
    BAND_MIN_H: 96,     // room for the header's title, counts, controls and holders
    CARD_W: 168,
    CARD_H: 52,
    CARD_GAP: 8,
    MIN_WIDTH: 520,
});

/**
 * Where everything goes at a canvas `width`. The only thing width changes is how
 * many epic cards fit across a band, so a resize is a re-wrap and never a rescale.
 *
 * @returns {{ width, height, frame, header, bands: Array<{key, x, y, w, h, head, body, cols, epics: Array<{id, x, y, w, h}>}> }}
 */
export function layoutLockModel(model, width = 1100) {
    const g = LOCK_GEOM;
    const canvasW = Math.max(g.MIN_WIDTH, Math.round(width));
    const frameX = g.PAD;
    const frameY = g.PAD;
    const frameW = canvasW - 2 * g.PAD;
    const innerX = frameX + g.FRAME_PAD;
    const innerW = frameW - 2 * g.FRAME_PAD;
    const header = { x: innerX, y: frameY + g.FRAME_PAD, w: innerW, h: g.HEAD_H };

    const bodyW = innerW - g.BAND_HEAD_W - g.BAND_PAD;
    const cols = Math.max(1, Math.floor((bodyW - g.BAND_PAD + g.CARD_GAP) / (g.CARD_W + g.CARD_GAP)));

    let y = header.y + header.h + g.BAND_GAP;
    const bands = model.initiatives.map((band) => {
        const n = band.epics.length;
        const rows = Math.max(1, Math.ceil(n / cols));
        const h = Math.max(g.BAND_MIN_H, 2 * g.BAND_PAD + rows * g.CARD_H + (rows - 1) * g.CARD_GAP);
        const placed = {
            key: band.key,
            x: innerX, y, w: innerW, h,
            head: { x: innerX, y, w: g.BAND_HEAD_W, h },
            body: { x: innerX + g.BAND_HEAD_W, y, w: innerW - g.BAND_HEAD_W, h },
            cols,
            epics: band.epics.map((epic, i) => ({
                id: epic.id,
                x: innerX + g.BAND_HEAD_W + g.BAND_PAD + (i % cols) * (g.CARD_W + g.CARD_GAP),
                y: y + g.BAND_PAD + Math.floor(i / cols) * (g.CARD_H + g.CARD_GAP),
                w: g.CARD_W, h: g.CARD_H,
            })),
        };
        y += h + g.BAND_GAP;
        return placed;
    });

    const frameH = (bands.length ? y - g.BAND_GAP : header.y + header.h) + g.FRAME_PAD - frameY;
    return {
        width: canvasW,
        height: frameY + frameH + g.PAD,
        frame: { x: frameX, y: frameY, w: frameW, h: frameH },
        header,
        bands,
    };
}

// ── THE OPENING FIT ─────────────────────────────────────────────────────────

/** The opening camera never shrinks the picture past legibility; a taller one pans. */
export const LOCK_MIN_FIT = 0.5;

/**
 * The layout and the camera scale that put the WHOLE picture on one screen.
 *
 * Shrinking by `k` leaves the surface `width * k` wide, so the layout is drawn
 * at `width / k` — wide enough that the scaled picture spans the viewport edge
 * to edge — and `k` is re-solved against the height that wider layout has. Three
 * passes do NOT reliably converge, so the final `k` is also capped by the width
 * the returned layout needs; the result is never scaled UP past 1 nor below
 * `LOCK_MIN_FIT`.
 *
 * @returns {{ layout: Object, k: number }}
 */
export function fitLockLayout(model, { width = 1100, height = 640 } = {}) {
    const clamp = (k) => Math.max(LOCK_MIN_FIT, Math.min(1, k));
    let layout = layoutLockModel(model, width);
    let k = clamp(height / layout.height);
    for (let pass = 0; pass < 3 && k < 1; pass += 1) {
        layout = layoutLockModel(model, width / k);
        k = clamp(height / layout.height);
    }
    // The passes do not settle on one answer — a wider layout is shorter, which
    // lets `k` grow, which narrows the layout again — so the loop can end with
    // `k` larger than the one the layout was drawn for. Take the smaller of the
    // two fits so the layout and the scale returned always agree: the scaled
    // picture then never spans more than the viewport's width.
    k = clamp(Math.min(k, width / layout.width));
    return { layout, k };
}
