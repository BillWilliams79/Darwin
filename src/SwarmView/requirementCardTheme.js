// requirementCardTheme.js — the pipeline plan's look, applied to the
// Requirements page cards (req #3644, user directive: "use the design rules from
// pipeline — that general look and feel and apply that to the requirements
// page").
//
// PURE: no React, no MUI. The plan's palette and colour scales are imported, not
// copied — `PLAN_VIZ_PALETTE` and `buildReqColorViews` are the plan canvas's own
// sources, so a retune there reaches these cards with no edit here.
//
// THE PALETTE IS THE PLAN'S DEFAULT ('aurora'), the one the plan canvas actually
// draws (`DEFAULT_PLAN_PALETTE`). The `REQ_STATUS_COLORS` / `AUTONOMY_COLORS`
// registries back only the 'stoplight' theme, which nothing selects — colouring
// these cards from them would match a plan nobody sees (CLAUDE.md, req #3503).
//
// WHY THE CARDS ARE DARK PANELS IN BOTH APP THEMES. The plan's canvas is a dark
// surface in light mode too, and its colour scales were tuned for that surface:
// aurora's `met` lime measures ~1.6:1 against white. Text that must carry a
// colour has to sit on the background the colour was chosen for.

import {
    PLAN_VIZ_PALETTE, DEFAULT_PLAN_PALETTE, REQ_COLOR_SCALES, planPalette,
    REQ_STATUS_UNKNOWN_COLOR, CARD_RADIUS,
} from './pipelines/pipelinePlanLayout';
import { requirementStatusLabel } from './statusChipStyles';
import { AI_MODEL_COLOR, AI_MODELS, aiModelLabel } from './modelChipStyles';
import { EFFORT_COLOR, EFFORTS, effortLabel } from './effortChipStyles';

const P = PLAN_VIZ_PALETTE;

/** The plan's monospace — the face it sets requirement ids in. */
export const REQ_CARD_MONO = '"SF Mono", "JetBrains Mono", Menlo, monospace';

/** Card + row surface tokens, every one of them a plan palette entry. */
export const REQ_CARD_THEME = {
    panel: P.panel,        // the card
    field: P.bg,           // a title box sits in the plan's near-black
    fieldHover: '#16233a', // UnorchestratedReqBox's row hover
    line: P.line,          // card edge
    text: P.text,
    dim: P.dim,
    accent: P.accent,      // drop-target highlight, the aggregator's brand
    radius: CARD_RADIUS,   // the plan step card's own corner
    fieldRadius: 8,
};

/** The neutral colour: what a row the colour key has nothing to say about
 *  resolves to, and an uncoloured category's brand band. The plan's dim text
 *  colour — ~4.6:1 on the field (`P.wire` measured 2.45:1 and read as nothing). */
export const NEUTRAL_OUTLINE = P.dim;

// ── THIS PAGE'S COLOUR SCALES (req #3644) ──────────────────────────────────
// User directive: the Color bar's choices "should be the display elements from
// the original like status autonomy model effort etc whatever it had" — the
// four indicator columns the rows used to carry (Status, whose glyph also
// showed the live SESSION, Autonomy, Model, Effort). So:
//
//   State · Session · Autonomy  — the plan's own registry entries, REUSED (same
//                                 builders, same aurora palette the plan draws)
//   Model · Effort              — this page's, in the ORIGINAL columns' colours
//                                 (`AI_MODEL_COLOR` / `EFFORT_COLOR`, the dark
//                                 ramp — these cards are dark panels)
//
// The plan's Machine scale is NOT here: the original rows never displayed the
// machine. The plan keeps it; this list is the page's, not the registry's.
//
// Same entry shape as `REQ_COLOR_SCALES`, so `ReqColorKeyControl` renders
// either list with no special case.

/** An enum column coloured value-by-value; a null/unknown value takes the
 *  column's backfill default, as the original icons did (opus / high). */
function enumScale({ key, chipLabel, field, colors, order, fallback, labelOf }) {
    return {
        key,
        chipLabel,
        chipTip: `Colour each requirement's id and title by ${chipLabel.toUpperCase()} `
            + '— click again for none',
        chipName: `${chipLabel} — colour each requirement by ${chipLabel.toLowerCase()}`,
        keyTitle: `Requirement id = ${chipLabel.toLowerCase()}`,
        build: ({ requirements = [] }) => {
            const paint = (v) => colors[Object.hasOwn(colors, v) ? v : fallback];
            const valueById = new Map(requirements.map((r) => [r.id, r[field]]));
            return {
                colorOf: (reqId) => paint(valueById.get(reqId)),
                legend: order.map((v) => ({ key: v, color: paint(v), label: labelOf(v) })),
            };
        },
    };
}

const PLAN_SCALES_REUSED = ['state', 'session', 'autonomy'];

export const REQUIREMENT_COLOR_SCALES = [
    ...REQ_COLOR_SCALES.filter((s) => PLAN_SCALES_REUSED.includes(s.key)),
    enumScale({ key: 'model', chipLabel: 'Model', field: 'ai_model', colors: AI_MODEL_COLOR,
        order: AI_MODELS, fallback: 'opus', labelOf: aiModelLabel }),
    enumScale({ key: 'effort', chipLabel: 'Effort', field: 'effort', colors: EFFORT_COLOR,
        order: EFFORTS, fallback: 'high', labelOf: effortLabel }),
];

export const REQUIREMENT_COLOR_KEYS = [...REQUIREMENT_COLOR_SCALES.map((s) => s.key), 'none'];
export const DEFAULT_REQUIREMENT_COLOR_KEY = 'state';
/** A stored key this page can paint, or the default. Array membership, so an
 *  inherited name ('constructor') or a retired scale ('machine') lands on it. */
export const normalizeRequirementColorKey = (v) => (REQUIREMENT_COLOR_KEYS.includes(v)
    ? v : DEFAULT_REQUIREMENT_COLOR_KEY);

const scaleFor = (key) => REQUIREMENT_COLOR_SCALES.find((s) => s.key === key);

/**
 * Every scale's view over a card's rows. The plan's scales are coloured from
 * the plan's DEFAULT palette. `session_status` is attached here the way
 * `pipelineAdapter` attaches it for the plan ('no_session' when no session has
 * touched the requirement), because the requirement rows do not carry it.
 *
 * @param {Object} args
 * @param {Object[]} [args.requirements]     the card's rows (template included is fine)
 * @param {Object} [args.sessionStatusMap]   requirement id -> latest swarm_status
 * @returns {Object<string, {colorOf: function, legend: Object[]}>}
 */
export function requirementColorViews({ requirements = [], sessionStatusMap = {} } = {}) {
    const rows = (requirements || [])
        .filter((r) => r && r.id !== '')
        .map((r) => ({ ...r, session_status: sessionStatusMap?.[r.id] ?? 'no_session' }));
    const pal = planPalette(DEFAULT_PLAN_PALETTE);
    return Object.fromEntries(REQUIREMENT_COLOR_SCALES.map((s) => [
        s.key, s.build({ requirements: rows, presentReqIds: null, pal }),
    ]));
}

/**
 * The colour a requirement wears under the active key — its id and title text.
 * 'none' (or the template row) is unkeyed: the plan's plain text colour.
 *
 * @returns {{color: string, keyed: boolean}}
 */
export function requirementKeyColor({ colorKey, views, reqId }) {
    const key = normalizeRequirementColorKey(colorKey);
    if (key === 'none' || reqId === '' || reqId == null) {
        return { color: NEUTRAL_OUTLINE, keyed: false };
    }
    const view = views?.[key];
    // No view yet (a first render) is the dim unknown swatch, never undefined.
    return { color: view ? view.colorOf(reqId) : REQ_STATUS_UNKNOWN_COLOR, keyed: true };
}

/**
 * The hover key for a scale: its title + every value it can paint.
 * `null` when no scale is on — nothing is coloured, so there is nothing to key.
 */
export function requirementKeyLegend({ colorKey, views }) {
    const key = normalizeRequirementColorKey(colorKey);
    if (key === 'none') return null;
    return {
        title: scaleFor(key).keyTitle.replace(/^Requirement id = /, ''),
        entries: views?.[key]?.legend || [],
    };
}

/**
 * The id's tooltip — the facts the removed indicator columns used to show, in
 * one line, so dropping the icons loses no information.
 */
export function requirementSpecSummary(requirement, sessionStatus) {
    if (!requirement || requirement.id === '') return '';
    const parts = [
        `#${requirement.id}`,
        requirementStatusLabel(requirement.requirement_status || 'unknown'),
        requirement.coordination_type || 'no autonomy',
        requirement.ai_model,
        requirement.effort,
        sessionStatus ? `session ${sessionStatus}` : null,
    ];
    return parts.filter(Boolean).join(' · ');
}

/**
 * A category card's brand colour: the category's own colour, or the neutral
 * colour when it has none (inventing a hue would claim a choice nobody made).
 */
export const categoryBrandColor = (category) => category?.color || NEUTRAL_OUTLINE;

/** The frame's stroke, px — between the plan step card's two ring weights
 *  (`BEAD_RING_W_BASE` 1.5 / `BEAD_RING_W_EMPHASIS` 2.5). */
export const CARD_FRAME_STROKE = 2;

/**
 * A card's frame, drawn the way the plan draws a STEP CARD (user directive:
 * "make each card's perimeter be entirely its color ... like the steps cards
 * look like in the pipeline visualizer"): the plan panel, the step card's own
 * corner radius, and ONE even stroke all the way round in the card's colour —
 * no band, no second edge. Depth is a soft shadow; a drop target gets an accent
 * ring OUTSIDE the stroke, so the card's own colour never disappears under it.
 *
 * @param {string} color                 the card's colour (category / accent)
 * @param {Object} [opts]
 * @param {boolean} [opts.dashed]        the "add a category" template card
 * @param {boolean} [opts.highlight]     a requirement is being dragged over it
 * @returns {Object} an `sx` fragment
 */
export function cardFrameSx(color, { dashed = false, highlight = false } = {}) {
    return {
        bgcolor: REQ_CARD_THEME.panel,
        backgroundImage: 'none',
        color: REQ_CARD_THEME.text,
        borderRadius: `${REQ_CARD_THEME.radius}px`,
        border: `${CARD_FRAME_STROKE}px ${dashed ? 'dashed' : 'solid'} ${color}`,
        boxShadow: highlight
            ? `0 0 0 3px ${REQ_CARD_THEME.panel}, 0 0 0 5px ${REQ_CARD_THEME.accent}`
            : '0 6px 18px rgba(0, 0, 0, 0.26)',
    };
}
