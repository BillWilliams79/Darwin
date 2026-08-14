// pipelinePlanLayout.js — pure geometry for the Plan visualizer (req #3115),
// the product form of the POC viz-generate.py Plan mode archived in req #3080.
//
// PURE LOGIC ONLY: engine PlanRows in, world-space geometry out.
// No React, no Konva, no DOM text measurement — widths come from a fixed
// monospace character metric so the zero-overlap guarantee is decidable here and
// testable in vitest without a canvas (the konvaSwarmModel.js separation).
//
// The layout language (POC, kept verbatim unless noted):
//   - Epic bands stacked vertically, one per DOMINANT epic (design rule 10), in
//     `epics.sort_order` since req #3430 — the AUTHORITATIVE epic display order
//     (user ruling 2026-08-09), and this stack is the surface that ruling is
//     about. An epic with NO `sort_order` is UNORDERED and falls back to the
//     req #3201 rule, below every ordered epic: DERIVED-START order,
//     earliest-starting epic on top, never-started epics last, epic id
//     ascending as the tie-break. (Before #3201 that fallback was
//     first-appearance over display order, which had two problems: it made a
//     band's position move whenever a step was appended, and it said nothing at
//     all about time.)
//   - TIME-SLOT columns left-to-right (req #3201). A column is a position on a
//     calendar proxy, no longer raw dependency depth — see the block comment
//     above `computeTimeColumns` for the whole model. Dependency depth survives
//     as the HARD FLOOR: a step's column is never less than 1 + the maximum of
//     its dependencies', so every arc still points forward.
//   - Chain-aware swim lanes inside each band: a step takes its first same-epic
//     dependency's lane when free, and that lane is RESERVED across the columns
//     the chain spans, so no unrelated bead sits on an arc's path.
//   - Requirement ids BELOW the bead: 'horizontal' lays them on one line and the
//     column grows to fit; 'vertical' stacks one per line and the lane pitch
//     grows instead. Step label ABOVE the bead: the step id, or the step title
//     (req #3080 POC addendum 2026-07-27 — the ID/Title toggle #3115 inherits);
//     column widths account for whichever is drawn. Zero label overlap holds in
//     all four combinations BY CONSTRUCTION, and the exported label rects let
//     tests assert it rather than trust it.
//   - THE STEP IS THE LAUNCH UNIT (Pipeline 2.0, req #3371). The multi-step
//     launch grouping this surface used to draw — a dashed teal rectangle, a
//     letter, a leader line, a contiguous lane run holding its members together
//     and 16px of extra band header reserving a strip for that letter — is gone
//     entirely. A step carries its own `/swarm-start` argument list, so the plan
//     TABLE renders that command on the step's own row and the canvas draws one
//     bead per launch. Do not re-introduce a launch-unit rectangle here: with
//     one step per command there is nothing left for it to group, and its
//     geometry is what bounded the next-up halo's ceiling (see
//     NEXT_HALO_CLEARANCES).
//
// THE COLOUR LANGUAGE LIVES HERE TOO (req #3168). Geometry and colour are the
// two things this surface decides, both are pure, and both are things the
// on-screen key has to render — so one module owns both and the key is a
// RENDERING of the language rather than a second copy of it. See the
// "THE COLOUR LANGUAGE" block below the palette, and `beadStyle` at the bottom.
//
// Two deliberate deviations from the POC, both documented for the PR:
//   1. Band header height 40 (POC 34): the POC's epic label and a lane-0 step
//      label could brush within a pixel; the taller header buys a real gap so
//      the overlap invariant is provable, not marginal.
//   2. Every lane reserves a TITLE SLOT under the requirement ids (pitch grows
//      ~14px): the 'in' zoom level draws the step title there, truncated to the
//      column width. Reserving it unconditionally keeps zoom a pure transform —
//      level changes never relayout, so the overlap guarantee holds at every k.

import { STEP_DONE, STEP_RUNNING, STEP_PENDING } from './pipelineModel';
// THE LADDER ITSELF, imported rather than passed in (req #3324): `planLevelFor`
// below is the ONE place the four modes are resolved, and a resolution that took
// the ladder's answer as an argument would leave half of Auto at the call site —
// which is where the two-levels-at-once confusion #3324 fixes came from. The
// same ladder the swarm canvas uses, deliberately (`semanticLevel`'s own note).
import { semanticLevel } from '../konvaSwarmModel';

// ── POC design language (viz-generate.py palette, kept verbatim) ────────────
export const PLAN_VIZ_PALETTE = {
    bg: '#0d1420',
    panel: '#111b2b',
    line: '#26374f',
    wire: '#3a5580',
    // The dependency-arc stroke connecting steps (req #3366) — brightened from
    // `#3d5a86`/0.65 (measured ~1.75:1 against `panel`, under the 3:1 WCAG AA
    // floor for graphical marks) to `#5c87c9`/0.85 (~3.80:1).
    // ── THE DEPENDENCY ARCS READ AGAINST THE PANEL (req #3365 user directive:
    //    "make sure the dependency lines are showing up better against the dark
    //    background") ────────────────────────────────────────────────────────
    // `#5c87c9` measured **4.74:1** on this panel and was drawn at 0.85 opacity
    // on top of that, so the effective contrast of a 1.2px line was lower still
    // — a wire a reader had to look for. `#8fb6f0` is **8.32:1**, the same hue
    // family (it is still the blue the plan's wires are), and the renderer now
    // draws it at full opacity: the arcs are the plan's actual SEQUENCE and had
    // been the faintest thing on a surface whose beads and bands are both
    // brighter than them.
    arc: '#8fb6f0',
    text: '#d7e3f4',
    dim: '#6f83a0',
    accent: '#4ad9c8',
    req: '#7fb4ff',
    doneFill: '#2e7d32',
    doneRing: '#7ee08a',
    doneCheck: '#c9f7cf',
    runningFill: '#FFB300',
    runningRing: '#ffd769',
    pendingFill: '#22314b',
    pendingRing: '#5b729355',
    manualRing: '#ff9bf5',
    eligibleRing: '#7ee08a',
    // The pause status bubble's two colours (req #3226) — a NEW channel
    // (SCOPE: is this band's launch suppressed?), so neither reuses an
    // existing entry outright even where a hue is nearby, to avoid the bubble
    // reading as a restatement of an existing mark (`doneFill`/`doneRing`/
    // `eligibleRing` are all green already, at the STEP/REQUIREMENT levels the
    // colour-language table below enumerates). Both MEASURED against `panel`
    // (`#111b2b`), 2026-08-01: `pauseActive` 8.22:1, `pausePaused` 5.41:1 —
    // both clear WCAG AA (4.5:1) with room to spare, and neither collides with
    // an existing entry closely enough to be mistaken for it at the bubble's
    // own size. IN the palette object itself, not beside it — "no hardcoded
    // colours" means every colour this surface draws lives HERE.
    pauseActive: '#2ecc71',
    pausePaused: '#ff5252',
    // The step card's requirement-count badge (req #3503, user directive:
    // "that ridiculous green count badge we had before"). `badgeFill` is
    // `KonvaSwarmCanvas.jsx`'s day-header pill VERBATIM (`.ts-bead-day-count-
    // inline`'s light-mode fill — this canvas has no light/dark split of its
    // own to pick a variant from). `badgeText` DEVIATES from that source's
    // white: measured, white-on-`badgeFill` is 2.80:1, under even the 3:1
    // floor for large/graphical text, because the copied CSS was never put
    // through this file's own contrast discipline. `bg` (this canvas's own
    // near-black) measures **6.60:1** against it — comfortably past WCAG AA
    // (4.5:1) — and reads as the badge cut out of the panel rather than as an
    // unrelated colour landing on top of it.
    badgeFill: '#6fa86f',
    badgeText: '#0d1420',
};

// Epic band palette (POC EPAL) — band index cycles through it.
//
// RETUNED (req #3219, user directive 2026-08-01): the POC's brown (`#5d4037`)
// read as dirt on the dark panel, not as a colour, and is gone outright. Orange
// and indigo were re-judged in situ rather than kept on the strength of the
// first three: `#f57c00` measured a passable 6.39:1 against the panel
// (`PLAN_VIZ_PALETTE.panel`, `#111b2b`) but stayed mid-luminance for a fully
// saturated warm hue, which is exactly the "clears the floor yet still reads
// muddy" case the warm-hue guard below exists to catch; `#3949ab` measured only
// 2.23:1, "low separation from the panel" made concrete. Both are replaced with
// brighter, more separated values at the same hue family — orange stays orange,
// indigo stays indigo — plus two further entries (cyan, magenta) so the palette
// covers the live epic count (7 on pipeline 2, measured 2026-08-01) with no
// wraparound collision. Purple, teal and pink measured "fine" and are kept
// verbatim. Every entry, at whatever length this array grows to, is enforced by
// the 'epic band palette' guard in pipelinePlanLayout.test.js — see that suite
// for the thresholds and the one-line reason behind each.
//
// POSITIONAL, DELIBERATELY IMPERMANENT (req #3219's second half — "decide
// whether a colour should be STABLE per epic"): this palette answers "what
// colour is band position N", never "what colour is epic X". Colour is
// assigned AFTER the bands are sorted into DERIVED-START order (below), so an
// epic's colour is a function of where it currently sits in that stack — it
// moves when an earlier epic starts, finishes, or a new one is added ahead of
// it. That was already true before this requirement (see the "Colour AFTER the
// sort" comment at the assignment site) and is kept rather than replaced with a
// stored or hashed per-epic colour, because a hash collides exactly when it
// matters most: two epics landing on the same slot is the one failure this
// surface cannot afford, and only a positional cycle over a palette at least as
// long as the band count can GUARANTEE zero collisions. A stored colour would
// fix identity at the cost of a schema field and a fallback path for every epic
// that predates it, for a question ("what colour IS epic X") this surface does
// not currently ask anywhere — the chip, the legend and the band all read the
// SAME band's colour, never one epic's colour recalled from a past render. If
// a future surface needs epic-X-is-always-blue, that is the point to add
// stored colour; today it would be speculative machinery for a fact nothing
// reads.
// ── FOUR, AND THEY REPEAT (req #3365 user directive) ───────────────────────
// *"Enjoyable as the multiple colors are for the epic title, they are too hard
// to read some of them. let's pick a palette of four distinct color (they can
// repeat from top to bottom) but that show up nicely in the visualizer as a
// contrast against the background."*
//
// SEVEN was the count, and the count was the problem. The palette had to fill
// seven slots that were mutually distinguishable, which forced entries down
// into the dark end of the wheel where a hue can be told apart but not READ:
// `#00897b` teal at 3.1:1 and `#c2185b` pink at 3.3:1 against this panel are
// the ones the directive is about — they cleared the 2.7 general floor and
// still made an epic's NAME (which is drawn in the band's colour) hard work.
//
// At four, every entry can sit in the bright band: the measured range is
// **5.94:1 to 7.75:1**, minimum pairwise CIE76 ΔE **54.0**, and the four hues
// are spread 188° / 22° / 264° / 334° around the wheel — a quarter-turn apart
// or better, so a repeat is the only way two bands can share a colour.
//
// REPEATING IS THE POINT, not a compromise. `bandByKey.get(key).color =
// EPIC_PALETTE[i % EPIC_PALETTE.length]` already cycled; with seven entries a
// reader could believe colour identified an epic, which it never did (colour is
// band POSITION — see the ONE FACT, ONE CHANNEL note above). Four makes the
// cycle short enough to be obvious.
//
// None of the four collides with a STATE hue: the closest approach to Running
// amber, Complete green or `deployed` green is ΔE 39.3 (orange vs amber), well
// past the 25 the autonomy scale is held to.
export const EPIC_PALETTE = [
    '#00b8d4', // cyan   — 7.25:1, hue 188°
    '#ff9152', // orange — 7.75:1, hue 22°  (clears the raised WARM floor)
    '#b07dff', // violet — 5.94:1, hue 264°
    '#ff6fae', // rose   — 6.69:1, hue 334°
];

// Named exports for the two pause colours — FROM the palette above, never a
// second literal, so "no hardcoded colours" holds for every reader of this
// module and not only for `PLAN_VIZ_PALETTE`'s own callers.
export const PAUSE_ACTIVE_COLOR = PLAN_VIZ_PALETTE.pauseActive;  // may launch
export const PAUSE_PAUSED_COLOR = PLAN_VIZ_PALETTE.pausePaused;  // paused
export const pauseBubbleColor = (paused) => (paused ? PAUSE_PAUSED_COLOR : PAUSE_ACTIVE_COLOR);

// ════════════════════════════════════════════════════════════════════════════
// THE COLOUR LANGUAGE (req #3168, user directives 2026-08-01)
// ════════════════════════════════════════════════════════════════════════════
//
// Every colour on this surface is decided in THIS module, so the panel has one
// vocabulary with one home and the on-screen key (the `KeyGroup`s inside
// `PipelinePlanVisualizer`) is a rendering of it rather than a second,
// hand-maintained list.
//
// ── The channels, and the ONE rule that keeps them apart ───────────────────
//
// `COLOR_CHANNELS` below IS this table — DATA, not prose (req #3374 P3), so a
// test can hold it and the rendered key together instead of trusting a
// markdown comment to stay in sync with a JSX `Stack` by hand.
//
// | Channel                | Encodes                                   | Level       |
// |------------------------|-------------------------------------------|-------------|
// | bead FILL              | derived step state (rule 1)               | STEP        |
// | bead RING              | run mode — magenta = manual               | STEP        |
// | outer HALO (dashed)    | eligible now — "Up Next"                  | STEP        |
// | requirement-id TEXT    | the ACTIVE colour key: requirement status | REQUIREMENT |
// |                        | · machine pin · nothing                    |             |
//
// EPIC IDENTITY IS A CHANNEL WITHOUT A KEY ROW, on purpose (req #3374 P3,
// superseding an earlier draft of this table that listed "epic BAND
// tint/stroke" as its fifth row — sixth counting the launch-unit box #3371
// removed — a row the on-screen key never rendered). A key row would be a
// swatch-per-band list duplicating what the bands already say: each band's
// tint IS its floating name's own chip, drawn
// in situ on the band it colours, and a plan can carry more bands than a
// legend has room for while the chips never run out of room to name
// themselves. See P6 for what a key row would have cost in the dimension
// this surface is most expensive in.
//
// The table had a sixth row until req #3371: a dashed teal BOX at the LAUNCH
// UNIT level, meaning "one `/swarm-start` launches these". In 2.0 the launch
// unit IS the step, so that channel would restate the bead's own level — the
// rule below, exactly — and it is gone rather than re-pointed.
//
// > **ONE FACT, ONE CHANNEL, ONE LEVEL.** No two channels may encode the same
// > fact at the same level. The bead speaks for the STEP — an aggregate the
// > engine derived. The requirement id speaks for the REQUIREMENT — the atomic
// > stored fact the aggregate was derived FROM. They are different questions, so
// > both may be on screen at once; what may never happen is a second channel
// > restating the bead's own derived state, which is what a "step state" colour
// > on the ids would have been.
//
// The corollary, and the reason the scale below is NOT Darwin's chip palette:
// **the panel's state hues are RESERVED — amber means in flight, green means
// done, anywhere on this surface.** A scale drawn here either AGREES with them
// or avoids them. So `development` takes the Running amber and `met` takes the
// Complete green (agreement: the requirement fact and the step fact genuinely
// coincide there, and one meaning gets one colour at both levels), while
// Darwin's `authoring` yellow and `development` green are deliberately NOT
// carried — on this panel they would read as Running and Complete respectively,
// which is the exact confusion this rule exists to prevent.
//
// ── What ANIMATES, and why only two things do ──────────────────────────────
// Motion is the loudest channel on the surface, so it is spent on the two
// questions a plan is opened to answer: what is running (the Running step
// PULSES — the card at L2/L3, the bead at L1) and what runs next (the halo
// BREATHES). They ride ONE Konva.Animation
// on different curves — 0.45→1.0 at ~480ms, 0.25→1.0 at ~900ms — so a running
// step and a next step never read as the same rhythm. Nothing else moves.
//
// ── What SIZE means: nothing ───────────────────────────────────────────────
// Every card is one WIDTH and every bead one radius. A card's HEIGHT does vary
// — it grows by one line per requirement (req #3498) — and that is a container
// fitting its contents, the same way a paragraph is as tall as its text; it is
// not a magnitude anybody should read a value off. Column width is uniform,
// lane and band heights are content spacing, and the type scale is a reading
// hierarchy (step name > requirement row > step title). **No mark is sized by
// data.** Stated because a key that covers colour and motion but leaves size
// unexplained invites the reader to infer an encoding that is not there.

// The channel table above, as DATA (req #3374 P3). `PipelinePlanVisualizer`'s
// two `KeyGroup`s read their titles from `KEY_GROUP_TITLES`, derived below
// rather than hand-typed a second time, so the on-screen key cannot drift
// from the set of channels marked `inKey`. `epic` is the one channel with
// `inKey: false` — see the table comment above for why the key omits it.
// req #3498 — the three STEP channels are named for the mark that carries them
// at L2/L3, which is the CARD. They are the same three facts in the same three
// colours; the bead still carries all three at L1, where no card is drawn.
export const COLOR_CHANNELS = [
    { channel: 'card STATE BAR (bead fill at L1)', level: 'step', inKey: true },
    { channel: 'card BORDER (bead ring at L1)', level: 'step', inKey: true },
    { channel: 'outer HALO (dashed)', level: 'step', inKey: true },
    { channel: 'requirement-id TEXT', level: 'requirement', inKey: true },
    { channel: 'epic BAND tint/stroke', level: 'epic', inKey: false },
];
export const KEY_GROUP_TITLES = [...new Set(
    COLOR_CHANNELS.filter((c) => c.inKey).map((c) => c.level),
)];

// ── Requirement-id scale 1 of 3: REQUIREMENT STATUS (the 'state' key) ──────
// `requirements.requirement_status`, the requirement's OWN stored field — not
// the derived step state, which the bead already owns.
//
// This is what makes a multi-requirement step legible: an amber `development`
// id beside two green `met` ids says exactly WHICH requirement is holding the
// step Running, which is a question the bead cannot answer at all.
//
// The 2026-07-27 directive that made these ids white — "a requirement number is
// an identifier, and colouring it was reading as a status" — is honoured rather
// than reversed: the ids are neutral unless a reader turns a key ON, the key
// then names the scale on screen, and the scale really is a status. What was
// wrong before was an unlabelled colour that read as the STEP's status.
//
// ── FOUR OF SEVEN ARE CROSS-SCALE REFERENCES, NOT COPIES (req #3365, extended
// req #3503) ────────────────────────────────────────────────────────────
// `authoring`/`approved` TRACK `AUTONOMY_COLORS.discuss`/`.planned` (req #3365
// user directive: *"authoring and approved should be the colors like Discuss
// and Planned"*). `met` TRACKS `AUTONOMY_COLORS.deployed` (req #3503 user
// directive — a LATER ruling than req #3365's own "keep... met as is", which
// this supersedes rather than restates). `development` TRACKS
// `PLAN_VIZ_PALETTE.runningRing` (req #3503 review: "same for authoring and
// approved, they should track too" — extended here to the state-hue agreement
// this scale already made by VALUE, now made by REFERENCE).
//
// ASSIGNED AS A PATCH, BELOW, RIGHT AFTER `AUTONOMY_COLORS` — not written
// inline here — because `AUTONOMY_COLORS` and `PLAN_VIZ_PALETTE` are declared
// AFTER this object in the file (`PLAN_VIZ_PALETTE` above; `AUTONOMY_COLORS`
// far below, beside the autonomy scale's own colour discipline), and a
// forward reference inside an object literal is a TDZ crash, not a lint nit
// — the same reason `CARD_BADGE_FONT` mirrors `CARD_FONT.label` BY VALUE
// elsewhere in this file rather than importing it. The difference here is
// that a `const` object's OWN properties may still be assigned after
// declaration (only the binding itself is frozen), so a four-line patch
// achieves a TRUE reference — these four values cannot drift from the
// scale they track — without reordering the two colour blocks or copying a
// hex string that silently goes stale.
//
// WHY TRACKING MATTERS: a copied hex is exactly the STEP_FOCUS_CONTEXT
// failure mode this codebase has already paid for once (see that constant's
// own history) — a value two call sites agree on today and silently
// disagree on the day only one of them is edited. `pipelinePlanLayout.test.js`
// asserts these four by IDENTITY (`toBe`, not proximity) for the same reason.
//
// SWARM_READY, DEFERRED, WONTFIX STAY LITERAL — the three req #3365 named as
// unchanged, and req #3503 named no reason to touch: they answer questions
// (queued; postponed; never) that no OTHER scale on this canvas asks.
export const REQ_STATUS_COLORS = {
    // Stop ramp = waiting on a human, releasing toward launchable.
    // `authoring`/`approved` assigned below — see the block comment above.
    swarm_ready: '#4d9bff',    // vivid blue — queued; the actionable one
    // `development`/`met` assigned below too — see the block comment above.
    // Terminal, but the work never happened.
    deferred: '#ff9800',       // orange — postponed
    wontfix: '#9e9e9e',        // grey — never
};

// Key order: the lifecycle, not the alphabet. The on-screen key renders in this
// order and shows only the statuses the plan actually contains.
export const REQ_STATUS_ORDER = [
    'authoring', 'approved', 'swarm_ready', 'development', 'met', 'deferred', 'wontfix',
];

// A status this build does not know — a value added to the enum server-side
// before the UI caught up, or a requirement the read did not resolve. Dim, and
// labelled 'unknown' in the key, because inventing a colour for it would make a
// new status silently masquerade as an existing one.
export const REQ_STATUS_UNKNOWN_COLOR = PLAN_VIZ_PALETTE.dim;

// `Object.hasOwn`, not a lookup + `||` fallback: the same discipline
// `isStepWidth` documents. A bracket lookup for 'constructor' or 'toString'
// resolves to an inherited FUNCTION, and a function handed to Konva's `fill`
// paints nothing with no error to see.
export const reqStatusColor = (status) => (Object.hasOwn(REQ_STATUS_COLORS, status)
    ? REQ_STATUS_COLORS[status] : REQ_STATUS_UNKNOWN_COLOR);

// ── Requirement marks: STACK order under a step, DRIVEN BY THE ACTIVE COLOUR
// KEY (req #3503, supersedes req #3363's fixed ladder) ─────────────────────
// Until req #3503 this stack sorted ONE fixed way regardless of what the
// on-screen key showed — met first, then the ladder, deferred/wontfix last —
// so a reader who turned the Autonomy key on saw ids ordered by a status
// ladder the key was not even naming. The user's directive: sort the stack
// "purple to green" for WHICHEVER key is on screen, so the visual ORDER
// always agrees with the visual MEANING it is reading off the same canvas.
//
//   State (the default):  Authoring → Met     — `REQ_STATUS_ORDER` itself,
//                                                the legend's own reading order.
//   Autonomy:              Discuss → Deployed  — `AUTONOMY_ORDER` itself.
//   Machine:                its own order       — ascending `machine_fk`, the
//                                                same ascending-id order
//                                                `buildMachineColorView` legends
//                                                the used machines in; a
//                                                requirement with no machine
//                                                pinned sinks last.
//   none (the key off):    falls back to State's ladder — there is no colour
//                          to sort by, and State is this scale's own default.
//
// A status/coordination_type this build does not resolve sinks below every
// recognised member of ITS ladder — the same discipline the retired fixed
// sort used. `UNPINNED_MACHINE_RANK` is `Number.MAX_SAFE_INTEGER`, not
// `Infinity`: two unpinned ids would both rank `Infinity`, and
// `Infinity - Infinity` is `NaN` — a sort comparator returning `NaN` is
// unspecified across engines, where the sentinel subtracts to a clean `0`.
function rankInOrder(order, value) {
    const i = order.indexOf(value);
    return i === -1 ? order.length : i;
}
const UNPINNED_MACHINE_RANK = Number.MAX_SAFE_INTEGER;

/**
 * Rank a requirement id for the mark stack under its step (or the plan
 * table's own id list) by the ladder the ACTIVE colour key names (req
 * #3503). `AUTONOMY_ORDER` is declared further down this file — safe to
 * reference here because this is a function BODY, evaluated only when
 * called, never at module-eval time the way an object literal's own
 * properties are (see `REQ_STATUS_COLORS`' own note on that hazard).
 *
 * @param {number} reqId
 * @param {Object} args
 * @param {string} [args.colorKey]                    a REQ_COLOR_KEYS value
 * @param {(id: number) => ?string} [args.statusOf]    id -> requirement_status
 * @param {(id: number) => ?string} [args.autonomyOf]  id -> coordination_type
 * @param {(id: number) => ?number} [args.machineOf]   id -> machine_fk
 * @returns {number}
 */
export function reqSortRank(reqId, { colorKey, statusOf, autonomyOf, machineOf } = {}) {
    const key = normalizeColorKey(colorKey);
    if (key === 'autonomy') return rankInOrder(AUTONOMY_ORDER, autonomyOf?.(reqId));
    if (key === 'machine') {
        const m = machineOf?.(reqId);
        if (m == null) return UNPINNED_MACHINE_RANK;
        // Coerced, not trusted raw (review finding): a blank/non-numeric
        // `machine_fk` is not `null`, but it is not a rank either, and
        // sorting it as `NaN` (or as a string via `<`) reads as "before
        // every real machine" rather than sinking last like every other
        // unresolved value here does.
        const n = Number(m);
        return Number.isFinite(n) ? n : UNPINNED_MACHINE_RANK;
    }
    // 'state' and 'none' both read the status ladder — 'none' because there
    // is no colour to sort by and State is this scale's own default.
    return rankInOrder(REQ_STATUS_ORDER, statusOf?.(reqId));
}

/**
 * Sort a step's linked requirement ids for on-canvas / on-table display (req
 * #3363, generalized to the active colour key by req #3503). Stable: ids
 * sharing a rank keep the order the caller gave them, rather than the sort
 * tie-breaking on id or anything else.
 *
 * @param {number[]} reqIds
 * @param {Object} [args]  see `reqSortRank`
 * @returns {number[]}
 */
export function sortReqIdsByColorKey(reqIds, args = {}) {
    const ids = Array.isArray(reqIds) ? reqIds : [];
    return ids
        .map((id, i) => [id, i])
        .sort(([aId, aI], [bId, bI]) =>
            (reqSortRank(aId, args) - reqSortRank(bId, args)) || (aI - bI))
        .map(([id]) => id);
}

// ── Requirement-id scale 2 of 3: MACHINE (the 'machine' key) ───────────────
// The high-contrast ecosystem pairing (user directive 2026-07-27): each machine
// reads as its PLATFORM at a glance, so the two are told apart by association
// rather than by consulting a key.
//
// Keyed on `machines.platform`, NOT on position in the plan's machine list. A
// positional palette makes a machine's colour depend on which OTHER machines a
// plan happens to use, so the Mac mini would be one colour on a two-machine plan
// and another on a three-machine one — and the whole value of an ecosystem
// pairing is that it is the same everywhere.
//
// MEASURED against the panel (#111b2b): red 5.78:1, blue 3.82:1, no-pin 6.81:1.
//
// LIVES HERE, not in the component (req #3168): it is a pure decision about
// colour, it is half of what the on-screen key has to render, and the two
// requirement-id scales have to be provably distinct — none of which is
// checkable while one of them is inside a JSX file.
export const MACHINE_MAC_COLOR = '#FF5F56';       // Apple traffic-light red
export const MACHINE_WINDOWS_COLOR = '#0078D4';   // Microsoft blue
export const MACHINE_ANY_COLOR = '#8fa4c4';       // no pin — not a machine
// A machine outside the pairing still has to be distinguishable, so it takes a
// hue that is neither ecosystem colour.
export const MACHINE_FALLBACK_PALETTE = ['#8ce99a', '#c8a2ff', '#6ee7e7', '#ffb86b', '#f78ca0'];

// Which ecosystem a MACHINE ROW belongs to. Colour is resolved per machine id —
// the requirement carries `machine_fk` and that id decides the colour — but the
// id itself says nothing about the ecosystem, so the machine record does.
// `platform` first because it is the field that means this; hostname/title only
// as a backstop, since a machine registered without a platform would otherwise
// silently drop out of the pairing into a fallback hue.
export function machineEcosystem(machine) {
    const hay = `${machine?.platform || ''} ${machine?.title || ''} ${machine?.hostname || ''}`
        .toLowerCase();
    if (/darwin|mac|osx|os x/.test(hay)) return 'mac';
    if (/wsl|win32|windows|cygwin|msys|mchp/.test(hay)) return 'windows';
    return null;
}

/**
 * Resolve every requirement's machine colour, plus the key entries for the
 * machines this plan actually uses.
 *
 * @param {Object} args
 * @param {Object[]} [args.requirements]  the plan's light requirement rows
 * @param {Object[]} [args.machines]      the machine dictionary
 * @returns {{colorOf: function(number): string, legend: Object[]}}
 */
export function buildMachineColorView({ requirements = [], machines = [] } = {}) {
    const reqMachine = new Map((requirements || [])
        .map((r) => [r.id, r.machine_fk == null ? null : r.machine_fk]));
    const machineById = new Map((machines || []).map((m) => [m.id, m]));
    const used = [...new Set([...reqMachine.values()].filter((v) => v != null))]
        .sort((a, b) => a - b);
    let fallbackNext = 0;
    const colorById = new Map(used.map((id) => {
        const eco = machineEcosystem(machineById.get(id));
        if (eco === 'mac') return [id, MACHINE_MAC_COLOR];
        if (eco === 'windows') return [id, MACHINE_WINDOWS_COLOR];
        const c = MACHINE_FALLBACK_PALETTE[fallbackNext % MACHINE_FALLBACK_PALETTE.length];
        fallbackNext += 1;
        return [id, c];
    }));
    const anyPresent = [...reqMachine.values()].some((v) => v == null);
    return {
        colorOf: (reqId) => {
            const m = reqMachine.get(reqId);
            return m == null ? MACHINE_ANY_COLOR : (colorById.get(m) || MACHINE_ANY_COLOR);
        },
        legend: [
            ...used.map((id) => ({
                key: id,
                color: colorById.get(id),
                label: machineById.get(id)?.title || `Machine ${id}`,
            })),
            ...(anyPresent ? [{ key: 'any', color: MACHINE_ANY_COLOR, label: 'Any' }] : []),
        ],
    };
}

// ── Requirement-id scale 3 of 3: AUTONOMY (the 'autonomy' key, req #3422) ──
// `requirements.coordination_type` — how much of the work the requirement's
// session is trusted to do without the user: `discuss` (do nothing until
// spoken to) → `planned` (build a plan, wait for approval) → `implemented`
// (build it, stop for review) → `deployed` (build, merge and ship).
//
// IT IS AN ORDINAL LADDER, so the palette is a RAMP and not four labels. A
// STOPLIGHT, on the user's original directive (2026-08-09): the ends carry
// the metaphor — `discuss` STOPS (a human speaks first) and `deployed` GOES
// (green, full delegation). Amber, the obvious stoplight middle, is already
// Running on this panel, so the two interior rungs are told apart by hue
// instead — a warm STOP-family colour for `discuss`, a cooler one leaning
// toward `implemented`'s violet for `planned`. `implemented` and `deployed`
// are UNCHANGED by everything below.
//
// ── REQ #3503: DISCUSS AND PLANNED MOVED TO REDDISH-PURPLE (user directive:
// "shift discuss and planned to be much more reddish purple, distinguishable
// from Implemented") ─────────────────────────────────────────────────────
// The prior pair — `discuss` a plain signal red (#ff3b30), `planned` a wine
// rose (#db5795) nudged toward violet by one channel (req #3365's own
// history, kept below for the record) — read as "red, then a duller red" to
// the eye this directive is about, not as a family distinct from
// `implemented`'s violet. Both rungs now sit in the MAGENTA band — warmer
// and more saturated than `implemented`, cooler than a pure stop-sign red —
// with `discuss` the hotter/brighter of the two (STOP) and `planned` rotated
// further toward violet (NEARLY STOP), preserving the ramp's original
// direction.
//
// MEASURED against the panel (#111b2b), 2026-08-14: contrast 5.00:1
// (`discuss`) and 4.65:1 (`planned`, the new lowest — the same "no rung of
// this scale can be a true burgundy" constraint req #3365 already measured:
// WCAG AA 4.5:1 is the floor, and the darkest magenta this panel can show at
// 13.75px type lives at ~4.6:1, same as the wine it replaces). Minimum
// pairwise CIE76 ΔE across all four rungs 38.5 (`planned`/`implemented` —
// UP from the prior scale's 45.9 low, still clear of the 20 floor by a wide
// margin); `discuss`/`planned` themselves 44.6. Nearest RESERVED state hue
// (`runningFill`/`runningRing`/`doneFill`/`doneRing`) 89.1, against a 25
// floor — this pair reads nothing like a step's own running or done colour.
// `deployed` is untouched, so its own history (green chosen ΔE 26.4 from
// `doneRing`, the widest separation any recognisable green achieves here)
// still stands and is not repeated.
//
// SINCE req #3365, EXTENDED req #3503: `discuss`/`planned` are ALSO the
// state scale's `authoring`/`approved`, and `deployed` is ALSO `met` —
// by REFERENCE now, not by a copied hex (see REQ_STATUS_COLORS' own
// comment for why the assignment lives in a patch just below this object,
// and why a reference is the fix a repeated by-value copy earned). Editing
// any of `discuss`/`planned`/`deployed` here moves both scales; the tests
// that pin the shared values by identity are what make that impossible to
// do by accident.
export const AUTONOMY_COLORS = {
    discuss: '#ff3388',       // hot magenta — STOP; a human speaks first
    planned: '#e236ce',       // violet-leaning magenta — nearly stop
    implemented: '#c58cff',   // violet — builds, then stops for review
    deployed: '#39d353',      // green — GO; full delegation, merges and ships
};

// Key order: the ladder, not the alphabet — same rule as REQ_STATUS_ORDER, and
// for the same reason (the on-screen key renders in this order).
export const AUTONOMY_ORDER = ['discuss', 'planned', 'implemented', 'deployed'];

// ── THE FOUR REQ_STATUS_COLORS PATCH (req #3365, extended req #3503) ──────
// See REQ_STATUS_COLORS' own comment for the full why. `authoring`/`approved`
// track the stop ramp just above; `met` tracks `deployed` (req #3503 — a
// LATER ruling than req #3365's "keep... met as is", which this supersedes);
// `development` tracks `PLAN_VIZ_PALETTE.runningRing`, the "same fact at two
// levels" agreement this scale already made by value and now makes by
// reference too.
REQ_STATUS_COLORS.authoring = AUTONOMY_COLORS.discuss;
REQ_STATUS_COLORS.approved = AUTONOMY_COLORS.planned;
REQ_STATUS_COLORS.met = AUTONOMY_COLORS.deployed;
REQ_STATUS_COLORS.development = PLAN_VIZ_PALETTE.runningRing;

// A coordination type this build does not know. The column is NOT NULL with a
// default, so in practice this is a value added to the enum server-side before
// the UI caught up — the same case REQ_STATUS_UNKNOWN_COLOR covers, so it is
// the same swatch rather than a second dim grey that means the same thing.
export const AUTONOMY_UNKNOWN_COLOR = REQ_STATUS_UNKNOWN_COLOR;

// `Object.hasOwn` for the third time, and for the original reason: this value
// arrives from the API and is handed to Konva as a `fill`, where an inherited
// FUNCTION paints nothing and reports nothing.
export const autonomyColor = (ct) => (Object.hasOwn(AUTONOMY_COLORS, ct)
    ? AUTONOMY_COLORS[ct] : AUTONOMY_UNKNOWN_COLOR);

// ════════════════════════════════════════════════════════════════════════════
// PALETTE THEMES (req #3365 user directive)
// ════════════════════════════════════════════════════════════════════════════
//
// *"Give me a UI option to show the current palette and: Status and Autonomy
// color palettes (2) from requirement inside pipeline visualizer. These are
// just colors so stoplight is not necessary. maybe propose a more boring
// business version or two. and anything you think is modern."*
//
// ONE THEME OVER ALL THREE SCALES, not three settings. The epic bands, the
// requirement STATUS scale and the AUTONOMY scale are read together on one
// panel, so a per-scale choice would let someone assemble a combination nobody
// chose and nobody measured. A theme is a complete set, and EVERY theme is held
// to the same measured floors: `pipelinePlanLayout.test.js` sweeps all three
// rather than the chosen one only.
//
// ── THERE IS NO CONTROL, AND THAT IS THE POINT (req #3365, second directive) ─
// A `Palette:` chip group shipped in the plan toolbar for exactly as long as it
// took the user to see the three themes side by side and say *"Remove UI option
// / Select Aurora"*. So the choice was made ONCE, in code, and the toolbar went
// back to the controls that answer questions about the DATA. The registry stays
// because it is what makes the choice reviewable — three measured alternatives
// and the numbers that separate them — and because changing it is one line
// rather than a colour hunt through a 4700-line module.
//
// ── WHAT "BORING" TURNED OUT TO MEAN, MEASURED ──────────────────────────────
// The first cut of `slate` was a single blue-grey RAMP per scale, on the
// reasoning that the directive's "stoplight is not necessary" frees a scale to
// carry its ladder in lightness alone. **That does not fit on this panel and the
// numbers say so plainly**: seven entries pairwise ΔE 20 apart along one hue
// needs a lightness range of roughly 120 L*, which does not exist at all, and
// what does not have to be measured twice is that every entry must ALSO clear
// 4.5:1 against `#111b2b`, which floors the dark end around L* 55. The first cut
// measured a minimum ΔE of **8.9** — two statuses that read as the same colour,
// which is the exact defect the four-entry epic palette above was cut down to
// fix.
//
// So restraint is carried by SATURATION, not by collapsing the hues. Measured
// mean HSL saturation across all three scales: **Signal 0.836, Slate 0.350,
// Aurora 0.828** — Slate is under half the default's chroma and keeps its hue
// separation, which is what makes it legible AND calm. `aurora` is deliberately
// as saturated as the default: "modern" is a different axis from "restrained",
// and offering two calm themes would be one theme with two names. Every scale
// in every theme clears contrast 4.78:1 and pairwise ΔE 20.4, asserted over the
// REGISTRY so a fourth theme is covered the day it is added.
//
// `stoplight` is assembled FROM `EPIC_PALETTE`/`REQ_STATUS_COLORS`/
// `AUTONOMY_COLORS` rather than restating them, so there is exactly one copy of
// those values and the entry cannot drift from the constants this module
// documents at length above. It is no longer what the canvas draws — see
// `DEFAULT_PLAN_PALETTE` — but those constants are still what
// `reqStatusColor`/`autonomyColor` answer for every caller OUTSIDE this canvas,
// which is why they stay where they are rather than moving into the registry.
export const PLAN_PALETTES = [
    {
        key: 'stoplight',
        label: 'Signal',
        tip: 'Signal — hue carries meaning: amber is Running, green is Complete, '
            + 'red is "a human speaks first".',
        epic: EPIC_PALETTE,
        status: REQ_STATUS_COLORS,
        autonomy: AUTONOMY_COLORS,
    },
    {
        key: 'slate',
        label: 'Slate',
        tip: 'Slate — a restrained business palette: the same hue separation at '
            + 'a little over half the chroma. No stoplight.',
        epic: ['#7f9fc4', '#c4a37f', '#a98cc4', '#7fc4a8'],
        // Ordered by the LIFECYCLE, and the hues walk violet → blue → teal →
        // gold → green so the ladder is legible without any of them shouting.
        // `deferred` and `wontfix` sit off that walk deliberately: they are the
        // two statuses that mean the work is not going to happen, and putting
        // them on the same axis as "nearly done" would make them read as a
        // later stage of it.
        status: {
            authoring:   '#ab84c4',
            approved:    '#6f8fbe',
            swarm_ready: '#6fd0c4',
            development: '#d4b35c',
            met:         '#8fbf7a',
            deferred:    '#cf8050',
            wontfix:     '#909090',
        },
        autonomy: {
            discuss:     '#b08a8a',
            planned:     '#a98cc4',
            implemented: '#8c9fc4',
            deployed:    '#7fb08c',
        },
    },
    {
        key: 'aurora',
        label: 'Aurora',
        tip: 'Aurora — a modern dark-UI palette: teal through indigo and violet, '
            + 'with the status scale a cool-to-warm walk rather than a stoplight.',
        epic: ['#5eead4', '#818cf8', '#f0abfc', '#fcd34d'],
        // COOL TO WARM as the work advances, so the scale reads as heat rather
        // than as a set of labels — the "not a stoplight" the directive asked
        // for, arrived at by ordering rather than by muting. `deferred` and
        // `wontfix` leave the walk for Slate's reason.
        status: {
            authoring:   '#818cf8',
            approved:    '#38bdf8',
            swarm_ready: '#22d3ee',
            development: '#5eead4',
            met:         '#a3e635',
            deferred:    '#fcd34d',
            wontfix:     '#94a3b8',
        },
        autonomy: {
            discuss:     '#f472b6',
            planned:     '#c4b5fd',
            implemented: '#7dd3fc',
            deployed:    '#4ade80',
        },
    },
];

// ── THE AURORA STATUS PATCH (req #3503 — THE LIVE THEME) ───────────────────
// `DEFAULT_PLAN_PALETTE` is 'aurora' and NOTHING ANYWHERE EVER SUPPLIES A
// DIFFERENT ONE: `PipelinePlanVisualizer.jsx`'s `palette` prop has no writer
// in this codebase — no toolbar control, no persisted preference, nothing —
// so `activePalette` resolves to 'aurora' on every render, unconditionally.
// 'stoplight' (Signal), the theme `REQ_STATUS_COLORS`/`AUTONOMY_COLORS`
// above belong to, is UNREACHABLE.
//
// THIS IS WHY SEVERAL ROUNDS OF THIS SAME USER DIRECTIVE — "authoring/
// approved should track discuss/planned", "met should be the green used for
// Deployed" — kept landing on `REQ_STATUS_COLORS` and shipping invisible: the
// edits were correct and the target was wrong. Caught only when the user,
// looking at the one theme that actually renders, reported the identical
// mismatch a second time. This incident is CLAUDE.md's Reasoned Non-Delivery
// exemplar list's own req #3503 entry — read it there before repeating the
// shape of this mistake on a future colour directive.
//
// Same tracking discipline as the Signal patch above, applied to the theme
// that is actually seen: `authoring`/`approved` track aurora's OWN
// `discuss`/`planned` (the user confirmed these two are already correct);
// `met` tracks aurora's OWN `deployed` (the user's own call: autonomy's
// green reads better than status's previous `#a3e635`). `development` is
// DELIBERATELY NOT patched to `PLAN_VIZ_PALETTE.runningRing` here — doing so
// collides with aurora's own `deferred` (`#fcd34d` vs `#ffd769`, measured ΔE
// 10.4, under the 20 floor this file holds every scale to) and the user has
// not been asked which of the two should move. `swarm_ready`/`deferred`/
// `wontfix` stay aurora's own literal values, matching Signal's identical
// exemption.
const auroraPalette = PLAN_PALETTES.find((p) => p.key === 'aurora');
auroraPalette.status.authoring = auroraPalette.autonomy.discuss;
auroraPalette.status.approved = auroraPalette.autonomy.planned;
auroraPalette.status.met = auroraPalette.autonomy.deployed;

export const PLAN_PALETTE_KEYS = PLAN_PALETTES.map((p) => p.key);
// AURORA, on the user's own directive after seeing all three on the live plan.
// Named EXPLICITLY rather than by taking `PLAN_PALETTE_KEYS[0]`: the registry's
// order is a narrative — the default first, then calmer, then more modern — and
// reordering it to move the default would make one array carry two meanings and
// silently repaint the plan on the next person's tidy-up.
export const DEFAULT_PLAN_PALETTE = 'aurora';
export const isPlanPalette = (v) => PLAN_PALETTE_KEYS.includes(v);

/**
 * The palette a key names, or the default.
 *
 * A miss resolves to the DEFAULT rather than to null: the value arrives from
 * localStorage, where a stale or hostile string is ordinary input, and a canvas
 * with no palette at all draws nothing. Same discipline `normalizeColorKey` and
 * `isStepWidth` apply to their own stored values.
 */
export function planPalette(key) {
    return PLAN_PALETTES.find((p) => p.key === key) || PLAN_PALETTES[0];
}


// ── The colour key is N SCALES PLUS NONE (req #3168; third scale req #3422) ─
// `state` · `machine` · `autonomy` · `none`. It was TRI-STATE when req #3168
// wrote this note and the count is no longer the point — what survives verbatim
// is that `none` IS NOT A BUTTON. MUI's exclusive ToggleButtonGroup already
// fired `onChange(_, null)` when the selected button was clicked again and the
// old handlers (`v && setPref(v)`) swallowed exactly that event; the chips that
// replaced it spell the same rule out at the call site. Making the deselection
// MEAN something costs the toolbar no width, which is what lets a THIRD scale be
// added to a row that already carries four control groups.
//
// The gesture the directive names, unchanged by the addition: State selected →
// click Machine → machine colouring → click Machine again → NO colouring, every
// id neutral. Every scale reaches `none` through its own chip.
//
// `none` paints `PLAN_VIZ_PALETTE.text` (near-white) and there is no light-mode
// branch, because THIS PANEL HAS NO LIGHT MODE: `PLAN_VIZ_PALETTE` is a fixed
// dark palette and the container's background is `P.panel` (#111b2b) in both app
// themes by design (see PipelinePlanVisualizer's header — "the directive is to
// keep THIS page's look"). A theme branch here could never fire, so writing one
// would be dead code claiming to handle a case that does not exist.
// ── How TALL the on-screen key may be, and why the cap MOVED to height ─────
// (req #3374 P6 — this constant was `PLAN_KEY_MAX_W` until this requirement.)
//
// The key's measured rect is the keep-out `placeEpicChips` resolves the epic
// names against, and the resolution is HORIZONTAL ONLY by design — moving a
// chip vertically would put it on another band's line, which is a wrong label
// rather than a missing one.
//
// SINCE req #3257 that resolution is a CLIP-OR-DROP, not a displacement: an
// epic name is pinned to its own band's rectangle and may not slide sideways
// out of it, so whatever runs under the key is cut off, or dropped outright
// once too few characters would be left to read.
//
// **THE OLD INVARIANT — "the key's WIDTH is its entire cost; its HEIGHT is
// free" — IS FALSE UNDER THAT RULE.** It was a property of the displacement
// pass this module no longer has: a chip that met the key used to slide
// sideways and still draw, so a taller key only changed WHICH chips moved.
// With nowhere to slide, a taller key exposes more band rows to the keep-out
// and those chips are lost instead.
//
// **THE KEY ALSO MOVED.** Req #3255 put it at BOTTOM-CENTER, which changed
// both the magnitude and WHICH AXIS IS STEEPER. MEASURED 2026-08-02 on the
// Substrate fixture (1500×900 panel) over k ∈ {0.2 … 2} × 4 pans × 29
// x-offsets, 1566 chips drawn with no key, against that bottom-center
// geometry (`w=470` was the width cap of the day):
//
//   at w=470   height    30    60   100   140   180
//              dropped   11    22    44    55    77
//
//   at h=30    width     90   300   420   470   600   900  1100
//              dropped    3     7    10    11    13    19    23
//
// **WHY THE MOVE WAS WORTH MAKING, which is the one number this module did not
// carry** (rescued from the deleted `memory/pipeline-plan-visualizer.md` by
// req #3356; it was the only surviving justification for req #3255's
// placement). Against the SAME 470x30 geometry, the OLD top-right key dropped
// **187** names where bottom-center drops **11** — **the move made the key
// ~17x cheaper.** The cause is the clip-or-drop rule above: an epic name is
// pinned to its band's LEFT edge, and a bottom-center box is simply not where
// those names land.
//
// HEIGHT WAS THE STEEPER AXIS — 66 names lost across the height range against
// 20 across the width range — because a bottom-anchored box grows UPWARD into
// more band rows while its width only ever spans the panel's middle. A cap
// named `PLAN_KEY_MAX_W` was, from that point on, capping the CHEAPER
// dimension: recorded rather than fixed at the time, because changing the cap
// belonged to req #3255's own surface, not to the requirement that found it.
//
// **REQ #3374 P6 IS THAT FIX**, RE-MEASURED (2026-08-10) rather than assumed
// still true — #3371 and #3373 emptied the key's launch-unit and epic-band
// rows since, and the Substrate fixture itself is not the same shape it was
// on 2026-08-02. Same fixture, same sweep, the OLD table's OWN `w`/`h` ranges
// so the two are comparable:
//
//   at w=470   height    30    60   100   140   180
//              dropped   33    33    44    66    77
//
//   at h=30    width     90   300   420   470   600   900  1100
//              dropped    9    21    30    33    39    57    69
//
// The absolute counts moved (33 vs 11, 69 vs 23 — a different fixture, a
// different key), but the SLOPE is what "steeper axis" actually claims, and
// it still favours height: 44 dropped over the 150px height range (≈0.29 per
// px) against 60 over the 1010px width range (≈0.06 per px) — height costs
// roughly 5x more per pixel of growth. The direction #3257 found survives;
// only the exact counts were stale.
//
// **WHERE THE CAP ITSELF LANDS.** #3371/#3373 also mean the key's height no
// longer grows with CONTENT the way its width still can: every group left is
// a fixed "caption line, then one `flexWrap: 'nowrap'` row" (see `KeyGroup`),
// so a machine scale with many machines only ever widens its one row now,
// never wraps it into a taller key. RE-SWEPT at a representative w=300 (the
// key no longer needs 470 of width — see below) to size the cap itself:
//
//   at w=300   height    30    50    78   110   140
//              dropped   21    21    21    28    42
//
// Flat from 30 through 78 (the real two-group content height, estimated
// below) — the cap only starts costing names past it. 110 costs 7 more than
// the flat floor and stays well inside the cheap part of the curve, so it
// carries real headroom without buying into the steep part of the slope.
//
// **THE NUMBER ITSELF IS ESTIMATED FROM THE COMPONENT'S OWN TYPOGRAPHY
// CONSTANTS**, the same way `470` was derived from character counts rather
// than a live DOM measurement (no browser mounts in this test run either):
// container `py: 0.9` (14.4px), the STEP group (caption 9px + 2.4px gap +
// a `LegendDot` row at MUI's default caption line-height, 12px × 1.66 ≈
// 19.9px ⇒ ~31.3px), the REQUIREMENT group (`pt`/`mt`/border ≈ 7px + caption
// 9px + 2.4px gap + a `LegendWord` row at its own 10.5px × 1.35 ≈ 14.2px ⇒
// ~32.6px) — ≈78px of estimated content, matching the flat part of the
// re-measured curve above. 110 carries ~40% headroom over that, the same
// margin 470 carried for width, for a font-metrics difference this estimate
// did not account for exactly, or a future third channel.
//
// **WIDTH IS DELIBERATELY UNCAPPED NOW.** Content-driven width was always the
// cheaper axis, and P3 already reduced the key to exactly two rows that never
// wrap — nothing left on this surface grows a key's width without bound the
// way an unmeasured future row could grow its height. MEASURED at h=78 (the
// real content height), width still costs real names as it grows —
//
//   at h=78    width    150   300   470   600   900  1100
//              dropped   12    21    33    39    57    69
//
// — a genuine, accepted cost on a many-machine plan, not an oversight: the
// trade this requirement's own doc names for capping the STEEPER axis instead.
//
// TWO EDGES THIS SWEEP DOES NOT COVER (code review finding, req #3374 P7),
// named rather than silently accepted:
//   1. `PipelinePlanVisualizer`'s `keepOut.x = (viewportW − key.w) / 2` goes
//      NEGATIVE once the key is wider than the viewport, which then drops
//      every epic chip whose y overlaps the key's band regardless of x. The
//      old 470 cap made that unreachable above a ~500px panel; uncapped width
//      makes it reachable on a many-machine plan viewed on a narrow window.
//      The sweep above stops at w=1100 on a 1500px viewport and never
//      exercises this.
//   2. `110` is an ESTIMATE from typography constants (below), never checked
//      in a live browser — `deployed` coordination skips manual UI review.
//      An overflow here would clip the bottom of the requirement group
//      outside the panel's own background and border, a quieter failure than
//      the width overflow it replaces.
// Neither is asserted against; both are one look at the rendered key (any
// machine-heavy plan, narrow window) away from being closed or ruled out.
//
// The cap is enforced in the component's `sx` (`maxHeight`, not `maxWidth`)
// and swept in pipelinePlanLayout.test.js from this constant, so the two
// cannot drift.
export const PLAN_KEY_MAX_H = 110;

// ── THE SCALE REGISTRY (req #3422) ─────────────────────────────────────────
// Two scales were spelled out BY NAME in five places: an `if` in `reqIdStyle`,
// an `if` in `reqIdKeyEntries`, a labels object here, the toolbar's own array of
// chips, and the visualizer's list of key blocks. Adding the third — autonomy —
// meant five edits that had to agree, and the requirement that asked for it says
// plainly that more are coming (AI model, effort). So the scale becomes DATA:
// one entry describes a scale completely, and every consumer maps over the list.
//
// WHAT AN ENTRY OWNS, and why each field is here rather than at a call site:
//
//   key       the stored preference value, the test id suffix, the key-block id
//   chipLabel/chipTip/chipName  the toolbar's three strings. They live WITH the
//             scale because they name what the colour MEANS, which is this
//             module's subject — the same argument req #3168 used to move the
//             machine pairing out of the JSX. `chipName` is the accessible name
//             and starts with `chipLabel`, which is WCAG 2.5.3 "Label in Name"
//             (see the toolbar for why MUI's Tooltip makes that load-bearing).
//   keyTitle  what the on-screen key calls the scale.
//   build()   the ONE resolver: `{requirements, machines, presentReqIds}` in,
//             `{colorOf(reqId), legend[]}` out. A scale that needs a dictionary
//             the others do not takes it from the same argument bag and ignores
//             the rest, so a fourth scale cannot widen anyone else's signature.
//
// `presentReqIds` is the set of requirement ids the plan actually DRAWS (null =
// no filter). It is what keeps a seven-entry status scale down to the two or
// three a given plan contains, which is what stops the key stealing the space
// the epic chips need.
//
// `none` IS NOT IN THE REGISTRY. It is the ABSENCE of a scale, it has no chip,
// no builder and no data behind it, and giving it a fake entry would put an
// `if (key === 'none')` inside every consumer's map instead of the one place the
// tri-state gesture already lives.

/**
 * The shared body of every scale that colours by an ENUM COLUMN on the
 * requirement row. Status and autonomy are the same shape — a column, a colour
 * per value, a fixed display order, one swatch for a value this build does not
 * know — and writing that twice is how the two drift.
 *
 * THE SCALE'S OWN VALUE RESOLVER PAINTS EVERY SWATCH — `paint` is called for the
 * canvas mark, for each key entry and for the unknown entry alike, so the three
 * cannot disagree and the scale's public one-value helper (`reqStatusColor`,
 * `autonomyColor`) is the live path rather than a second copy of it sitting
 * beside this one. `colors` is here to answer a different question — IS this
 * value on the scale — which decides key membership and cannot be read off a
 * hex.
 *
 * @param {Object} args
 * @param {Object[]} [args.requirements]     the plan's light requirement rows
 * @param {?Set<number>} [args.presentReqIds] ids the plan draws; null = all
 * @param {string} args.field                the column to read
 * @param {Object} args.colors               the scale's membership: value → hex
 * @param {string[]} args.order              key order (the lifecycle/ladder)
 * @param {function(?string): string} args.paint  value → hex, unknown included
 * @param {function(string): string} [args.labelOf]  value → key label
 * @returns {{colorOf: function(number): string, legend: Object[]}}
 */
function buildEnumColorView({
    requirements = [], presentReqIds = null, field, colors, order,
    paint, labelOf = (v) => v,
}) {
    const valueById = new Map((requirements || []).map((r) => [r.id, r[field]]));
    // `Object.hasOwn`, not a lookup + `||`: an id whose value is missing reads
    // `undefined`, and a bracket lookup for an INHERITED key ('constructor',
    // 'toString') resolves to a function that Konva paints as nothing at all.
    // `paint` applies the same discipline to the colour it returns.
    const known = (v) => Object.hasOwn(colors, v);
    const ids = presentReqIds ? [...presentReqIds] : [...valueById.keys()];
    const present = new Set();
    let unknown = false;
    for (const id of ids) {
        const v = valueById.get(id);
        if (known(v)) present.add(v);
        else unknown = true;   // includes an id with no requirement row at all
    }
    const legend = order.filter((v) => present.has(v))
        .map((v) => ({ key: v, color: paint(v), label: labelOf(v) }));
    if (unknown) legend.push({ key: 'unknown', color: paint(undefined), label: 'unknown' });
    return {
        colorOf: (reqId) => paint(valueById.get(reqId)),
        legend,
    };
}

// The registry. ORDER IS THE TOOLBAR'S ORDER, and it is STATE, AUTONOMY,
// MACHINE (req #3365 user directive). It was state, machine, autonomy — the
// two original scales first so a reader's muscle memory for the chip positions
// survived autonomy's arrival at req #3422. That reason has expired: the chips
// have moved, so the muscle memory being protected is the memory of an order
// nobody will see again, and what the order buys now is that the two scales
// describing the REQUIREMENT (its status, then how autonomously it runs) sit
// together, with the one describing the MACHINE that ran it last.
//
// This array is the single place the order is stated. The toolbar maps it, the
// on-screen key maps it, and neither carries a sort of its own.
export const REQ_COLOR_SCALES = [
    {
        key: 'state',
        chipLabel: 'State',
        chipTip: 'Colour the requirement marks by requirement STATUS — '
            + 'click again for none',
        chipName: 'State — colour the requirement marks by requirement status',
        keyTitle: 'Requirement id = status',
        // `pal` is the resolved theme (req #3365). The ORDER and the unknown
        // swatch are the scale's, never the theme's: a theme chooses hues, it
        // does not get to re-order a lifecycle or invent a member.
        build: ({ requirements, presentReqIds, pal = planPalette() }) => buildEnumColorView({
            requirements,
            presentReqIds,
            field: 'requirement_status',
            colors: pal.status,
            order: REQ_STATUS_ORDER,
            paint: (v) => (Object.hasOwn(pal.status, v)
                ? pal.status[v] : REQ_STATUS_UNKNOWN_COLOR),
            // 'swarm_ready' reads as two words on the key and as one in the
            // database. The key is for a person.
            labelOf: (v) => v.replace('_', '-'),
        }),
    },
    {
        key: 'autonomy',
        chipLabel: 'Autonomy',
        chipTip: 'Colour the requirement marks by AUTONOMY — the coordination '
            + 'type, discuss through deployed — click again for none',
        chipName: 'Autonomy — colour the requirement marks by coordination type',
        keyTitle: 'Requirement id = autonomy',
        build: ({ requirements, presentReqIds, pal = planPalette() }) => buildEnumColorView({
            requirements,
            presentReqIds,
            field: 'coordination_type',
            colors: pal.autonomy,
            order: AUTONOMY_ORDER,
            paint: (v) => (Object.hasOwn(pal.autonomy, v)
                ? pal.autonomy[v] : AUTONOMY_UNKNOWN_COLOR),
        }),
    },
    {
        key: 'machine',
        chipLabel: 'Machine',
        chipTip: 'Colour the requirement marks by the MACHINE that ran them — '
            + 'click again for none',
        chipName: 'Machine — colour the requirement marks by the machine that ran them',
        keyTitle: 'Requirement id = machine',
        // DELIBERATELY NOT `presentReqIds`-filtered, unlike the two enum scales.
        // A machine's colour is keyed on its PLATFORM and its key entry is NAMED
        // FROM THE MACHINE RECORD, so its entry set is the plan's machine
        // dictionary — a property of the plan's machines, not of which steps
        // happen to carry them. That is the whole reason, and it is asserted
        // directly, so the asymmetry cannot be "tidied away" by someone who
        // assumes it was an oversight.
        //
        // NOT because a filtered legend would move with the zoom: `presentReqIds`
        // is derived from `rows`, which is level-independent, so the enum scales'
        // legends do not change with the level either. Recorded because the wrong
        // reason was written here first, and a false premise invites the very
        // change the true one forbids.
        build: ({ requirements, machines }) => buildMachineColorView({ requirements, machines }),
    },
];

// The scale for a key, or undefined. A plain `find` over three entries — no
// index to keep in step, and `undefined` is the honest answer for 'none' and for
// a hostile value alike.
export const reqColorScale = (key) => REQ_COLOR_SCALES.find((s) => s.key === key);

// Every position the control and the key have: the registry, then `none`.
export const REQ_COLOR_KEYS = [...REQ_COLOR_SCALES.map((s) => s.key), 'none'];

export const DEFAULT_COLOR_KEY = 'state';
// A `COLOR_KEY_LABELS` object held these positions until req #3422, and
// `Object.hasOwn` on it was the guard. The object is GONE rather than renamed:
// its values were control labels, they drifted into key titles when the registry
// took over naming, and NOTHING EVER RENDERED THEM — a map whose keys are the
// only live part is a list wearing an object's costume.
//
// The hazard it guarded against is unchanged and so is the guard's strength:
// this value is read straight out of localStorage, where "constructor" and
// "toString" are reachable strings that resolve to inherited FUNCTIONS on any
// object — and an array membership test answers them the same way it answers
// '__proto__', a number, `{}` or `[]`, which is: no.
export const isColorKey = (v) => REQ_COLOR_KEYS.includes(v);
export const normalizeColorKey = (v) => (isColorKey(v) ? v : DEFAULT_COLOR_KEY);

/**
 * Build EVERY scale's view in one pass, keyed by scale.
 *
 * All of them, not just the live one, for the reason the key already stacks all
 * of them: the key reserves ONE footprint that cannot move when the colour mode
 * does, and a cell can only be sized by children that exist. It is cheap —
 * each builder is one pass over rows already in hand, no read and no fetch.
 *
 * @param {Object} args
 * @param {Object[]} [args.requirements]      the plan's light requirement rows
 * @param {Object[]} [args.machines]          the machine dictionary
 * @param {?Set<number>} [args.presentReqIds] ids the plan draws; null = all
 * @returns {Object<string, {colorOf: function, legend: Object[]}>}
 */
export function buildReqColorViews({ requirements, machines, presentReqIds = null,
    palette = DEFAULT_PLAN_PALETTE } = {}) {
    const pal = planPalette(palette);
    return Object.fromEntries(REQ_COLOR_SCALES.map((s) => [
        s.key, s.build({ requirements, machines, presentReqIds, pal }),
    ]));
}

/**
 * The requirement-id text style for the active colour key. ONE resolver, so the
 * canvas and the on-screen key can never disagree about what a colour means.
 *
 * Bold in EVERY coloured scale and regular in `none`: weight is the "this
 * channel is carrying a signal" affordance, and it costs the zero-overlap
 * contract nothing because the ids are set in a MONOSPACE face, whose advance
 * width is weight-invariant — which is why `CHW_REQ` stays one number.
 *
 * IT TAKES THE VIEWS, NOT A COLOUR PER SCALE (req #3422). The old signature
 * named one parameter per scale (`status`, `machineColor`), so every new scale
 * widened it and every caller had to know which parameter that scale read. The
 * views bag is the same for all of them, so a fourth scale changes nothing here.
 *
 * @param {Object} args
 * @param {string} args.colorKey   a REQ_COLOR_KEYS value
 * @param {Object} [args.views]    buildReqColorViews() output
 * @param {number} [args.reqId]    the requirement the mark stands for
 * @returns {{fill: string, bold: boolean}}
 */
export function reqIdStyle({ colorKey, views, reqId } = {}) {
    const key = normalizeColorKey(colorKey);
    if (key === 'none') return { fill: PLAN_VIZ_PALETTE.text, bold: false };
    const view = views?.[key];
    // No view for a real scale means the caller has not built one yet (an empty
    // model, a first render). The dim unknown swatch is the honest answer and
    // the one thing that must NOT happen is an undefined `fill`, which Konva
    // paints as nothing with no error to see.
    return { fill: view ? view.colorOf(reqId) : REQ_STATUS_UNKNOWN_COLOR, bold: true };
}

/**
 * The key entries for the requirement-id channel under the active colour key.
 *
 * The entry list is the scale's own — built by its registry `build()`, which is
 * the SAME view object `reqIdStyle` colours the canvas from, so the key cannot
 * name a colour the marks do not use. Each enum scale lists only the values the
 * plan actually contains, which is what keeps the key compact enough not to
 * steal the viewport middle-bottom (req #3255; was the top-right corner) from
 * the epic chips.
 *
 * @param {Object} args
 * @param {string} args.colorKey  a REQ_COLOR_KEYS value
 * @param {Object} [args.views]   buildReqColorViews() output
 * @returns {{title: string, entries: Object[]}}
 */
export function reqIdKeyEntries({ colorKey, views } = {}) {
    const key = normalizeColorKey(colorKey);
    if (key === 'none') {
        return {
            title: 'Requirement id',
            entries: [{ key: 'none', color: PLAN_VIZ_PALETTE.text, label: 'no colour key' }],
        };
    }
    // `normalizeColorKey` has already guaranteed a registry key or 'none', so
    // the scale is present; the fallback is for a views bag that has not been
    // built, which yields a titled but empty key rather than a crash.
    return { title: reqColorScale(key).keyTitle, entries: views?.[key]?.legend || [] };
}

// ── World-space metrics ─────────────────────────────────────────────────────
const LEFT = 66;
const RIGHT = 14;
const MIN_WORLD_W = 1180;       // POC viewBox floor
// Type scale (user directive 2026-07-31): step label +50%, requirement ids
// +25%, epic label +25% over the POC's font-11/12 base. Char-width metrics
// scale linearly with font size (mono: ~0.609 px/pt per char) — they MUST move
// with PLAN_VIZ_FONT or the zero-overlap contract silently rots.
// ── THE CARD'S TYPE SCALE (req #3498, user directive: "make the visualizer step
//    card typeface 40% larger") ───────────────────────────────────────────────
// ONE NUMBER, and everything the card draws is derived from it — the three glyph
// widths below, the four font sizes in `CARD_FONT`, the line height, the
// between-rows gap, the card's padding and the two reserved slots in its title
// area. A 40% type change touching fourteen literals is fourteen chances for one
// of them to be missed; this way the next retune is one edit and a test that
// re-derives from it cannot agree with a half-applied change.
//
// WHAT IT COSTS, AND WHY THAT IS THE FAITHFUL READING. The card's width is
// `CARD_TEXT_CHARS` glyphs wide, so scaling the glyph scales the card:
// **407 -> 573 px**, and live plan 7's world **20,320 -> ~26,500** (+31%). The
// alternative — hold the width and drop the character budget from 40 to 25 —
// would silently undo a number the user set explicitly, and would undo it on the
// axis they had just spent a SECOND LINE protecting. The width was the
// provisional quantity from the start ("we will go from there"); the character
// count and now the type size are the stated ones.
//
// IT IS THE CARD'S ALONE. `PLAN_VIZ_FONT.epic` (the band label) and `.slot` (the
// date ruler) are NOT scaled — neither is on the card, and the epic chip is an
// HTML overlay with its own screen-space sizing rules besides.
export const CARD_TYPE_SCALE = 1.4;

// EXPORTED (req #3498): a test that re-typed these as literals would agree with
// a half-applied type scale, which is the one failure `CARD_TYPE_SCALE` exists
// to make impossible.
export const CHW_LABEL = 10.05 * CARD_TYPE_SCALE;   // px per mono char, step name
export const CHW_REQ = 8.4 * CARD_TYPE_SCALE;       // px per mono char, req row
export const CHW_TITLE = 5.8 * CARD_TYPE_SCALE;     // px per mono char, the L3 own-title line
export const CHW_EPIC = 9.15;   // px per mono char at font 15 (epic band label)
const BEAD_R = 10;
// ── The epic gets its OWN LANE (req #3168, user directive) ─────────────────
// This was 46, and 46 was never enough. The band header is reserved in WORLD px
// while the epic chip is drawn at a fixed SCREEN height (it is an HTML overlay,
// deliberately — req #3119 — so the name stays legible at any zoom). Only ~25 of
// those 46 px sat above lane 0's step label, so the chip fitted only while
// k ≥ 24/25 ≈ 0.96 — and the page's own default scale is 0.8. At the scale the
// visualizer OPENS AT, the epic name overlapped the first row of step labels.
//
// A lane is the unit this layout already uses for "content that may not be drawn
// over", so the epic takes one: BAND_HEADER is now a full lane's height, and
// nothing else is ever placed in it. That moves the fit threshold to k ≈ 0.39.
//
// **THE OPENING VIEW IS NO LONGER ABOVE THAT THRESHOLD** (req #3312, found in
// review). The margin recorded here — "well below the 0.8 default and below
// fit-to-width on every real plan" — was measured against a landing pinned at
// `readableDefaultScale`; the landing is now `factoryDefaultScale`, and on the
// 34-step fixture at 1280x720 that is k = 0.354-0.373, i.e. BELOW 0.39. The
// argument recorded here was that a DIFFERENT fact made the collision
// unreachable — below `K_READABLE` no step label is drawn at all, so there is
// nothing for the epic name to overlap — which made `K_READABLE` load-bearing
// for this reservation.
//
// **THAT ARGUMENT IS DEAD (req #3324, found in review), AND SO IS ITS FALLBACK.**
// A PINNED L2/L3 draws step labels at EVERY scale (`planLevelFor` — legibility is
// now Auto's own demotion and decides nothing under a pin), so "no label is
// drawn down there" is simply false, and `K_READABLE` protects nothing here. The
// sentence that followed it — that `placeEpicChips` SCALES the chip down to its
// lane rather than overflowing it — stopped being true one requirement earlier:
// since req #3272 the chip is FLOORED at `EPIC_CHIP_MIN_H`, and that function's
// own comment says a lane too short for the floored chip "gets the chip anyway,
// drawn over the first row of step labels on its 60%-opaque panel."
//
// So the honest statement of the reservation is: it is a WORLD-px lane against a
// SCREEN-height chip, so it holds while `k >= ~0.348`
// (`(EPIC_CHIP_MIN_H + 2·CHIP_MARGIN_Y) / epicLaneH`, i.e. 21.6/62) and the
// floored chip is drawn over lane 0's step labels below that — reachable by
// wheel (the live plan's zoom floor is 0.11) and on landing/Reset on any plan
// whose `factoryDefaultScale` is smaller. Nothing PREVENTS it — `placeEpicChips`
// has run no obstacle-avoidance pass at all since #3257 (its only `keepOut` is
// the legend) — but it is MEASURED, at exactly this boundary, and pinned in
// vitest so a future change to the constants above cannot move it silently
// (req #3374 P5). The overlap itself was accepted by #3272 on the user's own
// directive (a floored, legible name over a 60%-opaque panel beats a name too
// small to read); #3324 only removes the claim that a pin could not reach it.
// If that trade is ever revisited, the fix is a taller reservation or an
// obstacle entry — not a legibility gate on the pin.
// 83, not 62, because THE HEADER IS NOT THE CLEAR STRIP. A lane-0 step label is
// drawn 31px ABOVE its bead, and the bead sits 10px below the header — so the
// label reaches 21px back UP into the header (a further STAGGER_GAP on top of
// that in title mode). The clear strip is `headerH − STEP_LABEL_RISE`, and
// sizing the epic's lane as though it were `headerH` is the same
// off-by-a-reservation the 46px version made. 83 leaves a genuine 62 — one full
// lane — clear in BOTH label modes; `band.epicLaneH` carries the derived value
// so no consumer has to re-derive it and get it wrong.
// ── THE RESERVATION IS TALLER, ON THE USER'S DIRECTIVE (req #3365) ──────────
// *"Epic title does a better job of staying the right size, but it needs to
// have a separate swim lane so it doesn't overlap steps/requirements."*
//
// The paragraphs above name this exact trade and name its remedy: the lane is
// WORLD px against a SCREEN-height chip, so it held only while
// `k >= (EPIC_CHIP_MIN_H + 2·CHIP_MARGIN_Y) / epicLaneH` = 21.6/62 = **0.348**,
// and below that the floored chip was drawn over lane 0's step labels. Plan 7
// LANDS at k = 0.2077 — comfortably under it — so on the plan this surface is
// most often opened on, the overlap was not an edge case reachable by wheel, it
// was the default view. That comment ends "if that trade is ever revisited, the
// fix is a taller reservation or an obstacle entry"; this is the taller
// reservation.
//
// DERIVED FROM THE SCALE IT MUST HOLD AT, not chosen. `EPIC_LANE_CLEAR_K` is
// the lowest scale the clear strip is guaranteed at, and the clear strip
// (`headerH − STEP_LABEL_RISE`, the same subtraction the 83 above got right)
// must be at least the floored chip's screen box converted into world px at
// that scale. Editing the chip's font or its margins therefore moves this
// automatically, which is the property the previous hand-set 83 did not have.
//
// WHAT IT COSTS, measured on plan 7: the header goes 83 → 125 world px, so each
// of the 4 bands is 42px taller and the world grows 4430 → ~4598, about 3.8%.
// At the landing scale that is ~35 screen px of extra plan height, and it buys
// a name that never sits on a step label at any scale the reader can land on.
// It does NOT hold all the way to the zoom floor (0.11) — a world-px lane
// against a screen-px chip cannot, by construction — so the guarantee is stated
// as a scale, not as an absolute.
// A LITERAL, PINNED BY A TEST — not the expression that derives it. Every term
// of that expression (`EPIC_CHIP_H`, `EPIC_CHIP_MIN_SCALE`, `CHIP_MARGIN_Y`) is
// declared ~2000 lines BELOW this one, so evaluating it here is a temporal dead
// zone and throws at module load. Reordering a 4,400-line module to satisfy one
// constant is the larger risk, so the derivation lives in `EPIC_LANE_CLEAR_K`'s
// own test instead — `pipelinePlanLayout.test.js` recomputes it from those four
// constants and fails if this number stops matching, which is the same
// protection with none of the load-order hazard.
//
//   ceil(STEP_LABEL_RISE + (EPIC_CHIP_H·EPIC_CHIP_MIN_SCALE + 2·CHIP_MARGIN_Y)
//        / EPIC_LANE_CLEAR_K)
//   = ceil(24 + (24·(11/15) + 4) / 0.2) = ceil(24 + 21.6/0.2) = 132
//
// The lowest scale at which the epic chip's floored screen box is guaranteed to
// fit inside the band header's clear strip. Everything about `BAND_HEADER` below
// is derived FROM this number, which is why it is declared beside it.
export const EPIC_LANE_CLEAR_K = 0.2;
// ── 132 → 108, BECAUSE NOTHING REACHES INTO THE HEADER ANY MORE (req #3498) ─
// Every version of this constant above is one long argument about a single
// subtraction: the header had to be `STEP_LABEL_RISE` TALLER than the strip it
// was reserving, because a lane-0 step label floated ABOVE its bead and reached
// back up into the header. `epicLaneH` was `BAND_HEADER − STEP_LABEL_RISE` for
// that reason, and the paragraphs above are the record of getting that
// off-by-a-reservation wrong twice.
//
// A card starts AT its lane's top and draws nothing above itself. There is no
// overhang, so the clear strip IS the header and the subtraction is gone
// (`epicLaneH === headerH`). The strip the derivation demands is unchanged at
// 108 world px — the chip's floored screen box divided by `EPIC_LANE_CLEAR_K` —
// so the header simply stops paying for an overhang that no longer exists.
// Every band is **24px shorter in `id` mode and 60px shorter in `title` mode**,
// which is the shipped one — the old header also carried `STAGGER_SPAN` (36)
// whenever the step label staggered, and that term is gone with the stagger.
//
//   ceil((EPIC_CHIP_H·EPIC_CHIP_MIN_SCALE + 2·CHIP_MARGIN_Y) / EPIC_LANE_CLEAR_K)
//   = ceil((24·(11/15) + 4) / 0.2) = ceil(21.6/0.2) = 108
//
// A LITERAL, PINNED BY A TEST — not the expression that derives it. Every term
// of that expression (`EPIC_CHIP_H`, `EPIC_CHIP_MIN_SCALE`, `CHIP_MARGIN_Y`) is
// declared ~2000 lines BELOW this one, so evaluating it here is a temporal dead
// zone and throws at module load. The derivation lives in `EPIC_LANE_CLEAR_K`'s
// own test instead, which recomputes it from those constants and fails if this
// number stops matching.
const BAND_HEADER = 108;
// `STEP_LABEL_RISE`, `LANE_BASE_H` and `BEAD_LANE_OFFSET` left with req #3498.
// The first was how far a floating step label reached above its bead, the second
// the lane's height before the requirement stack was added, the third where the
// bead sat inside its lane — all three describe a step whose parts were placed
// individually, and `cardHeight` now answers for all of them at once. A consumer
// that wants the height a lane is CONNECTED at reads `band.laneCardH` and takes
// half of it: that is the midpoint the arcs anchor on.
const BAND_GAP = 8;
// ── THE COLUMN FLOORS AND THE TITLE SLOT ARE GONE (req #3498) ───────────────
// `COL_MIN_W_HORIZONTAL` / `COL_MIN_W_VERTICAL` were the floor a CONTENT-SIZED
// column could not shrink below. Columns are no longer content-sized — every
// one of them is exactly `CARD_W + CARD_GAP_X` — so a floor has nothing to
// floor, and the NEXT-STEP HALO's clearances (req #3271) read the card pitch
// directly, which is the same "one copy, not two that only have to agree"
// discipline the deleted comment was defending.
//
// `TITLE_SLOT` reserved a per-lane line BELOW the requirement stack for the
// step's title. The title is inside the card now (`CARD_SUBTITLE_H`), so the
// reservation moved into `cardHeight` with it.
// One requirement mark per line at font 13.75. EXPORTED since the swim-lane
// directive: it is the exact vertical cost a lane pays when titles stagger, and
// a test that re-typed the number could agree with a changed layout by accident.
//
// +25% (req #3242 user directive, "a little more space between the lanes...
// for readability") — was 15. This is the SAME constant that sets the
// staggered-column vertical offset (the per-band `reqOffsets` sweep, req
// #3362), which is what was
// actually reported: two single-requirement steps in ADJACENT columns
// (`Dual-Path Purge` -> `Wontfix Fold-In` on the live plan), both eligible to
// stagger, landed on lines only 1px apart vertically while overlapping ~60px
// horizontally — inside the zero-overlap contract (rects never touch) but
// with no visual breathing room at all. One shared constant, so the fix is
// generic rather than a special case for that pair: every lane, every
// staggered pair, gets the same extra room.
// ── THE GAP IS DOUBLED (req #3365 user directive: "double the whitespace
//    between a step's requirement stacks, vertically in the visualizer") ──────
// A requirement mark's own box is 14px tall, so at 18.75 the WHITESPACE between
// two marks in a stack was 4.75px — the number the directive doubles, giving
// 9.5 and a line height of 23.5. It is the gap that doubles, not the pitch:
// doubling 18.75 outright would have put 23px of air between two lines of text
// and made a 5-requirement stack taller than its own lane.
//
// It is the same constant the swim-lane offsets are counted in, so every stack
// pushed down to clear a neighbour moves in the new unit automatically and the
// lane pitch (which multiplies it) reserves the extra room without a second
// edit — the property this constant's history above is entirely about.
// The requirement row's own text box, and the pitch one line sits on. Both
// scale with the card's type — a 40% larger glyph on a 23.5px line would have
// the rows touching.
export const REQ_TEXT_H = 14 * CARD_TYPE_SCALE;
export const REQ_LINE_H = 23.5 * CARD_TYPE_SCALE;

// ── THE GAP BETWEEN ONE REQUIREMENT AND THE NEXT (req #3498, user directive:
//    "double white space between requirement titles") ────────────────────────
// SEPARATE FROM `REQ_LINE_H`, and that separation is the whole point. Until the
// second line landed there was one kind of vertical gap on a card and
// `REQ_LINE_H` was it — 14px of text on a 23.5px pitch, so 9.5px of air. Now a
// row can be TWO lines of one sentence, and those two need to stay tight
// together or the title stops reading as a title. Doubling `REQ_LINE_H` would
// have pushed them apart exactly as far as it pushed two different
// requirements, which is the opposite of what makes a wrapped row legible.
//
// So the doubling is spent HERE, between rows: 9.5px of extra air after each
// requirement takes the gap between two of them from 9.5 to 19, while the gap
// INSIDE a wrapped row stays at `REQ_LINE_H`'s own 9.5.
export const REQ_ROW_GAP = 9.5 * CARD_TYPE_SCALE;

// ── THE STEP IS A CARD (req #3498) ──────────────────────────────────────────
// *"Make each step a card that contains the requirements inside. Use a round
// rectangle card with the step name in the title area. Separate the step name
// with a horizontal line, the requirements listed top to bottom inside the card
// in the order."*
//
// This is the single change every other number in this section answers to. Until
// now a step was a POINT — a bead — with its text scattered around it: the step
// name floating above, the requirement ids stacked below, a reserved title slot
// below those. None of that text belonged to anything, so none of it could be
// bounded by anything, and the module grew an entire apparatus (the stagger: see
// the constants this block REPLACES) whose only job was to stop free-floating
// text from colliding with the free-floating text of the neighbouring column.
//
// A card cannot collide with its neighbour's text, because its text is INSIDE
// it and clipped to its width. That is why this change deletes more than it
// adds.
//
// ── THE WIDTH IS FIXED AND UNIFORM, ON THE USER'S DIRECTIVE ─────────────────
// *"Uniform, but not as wide as the widest requirement. We need a fixed width
// and the requirement title can fit vertically. Make the card at req# plus 40
// chars wide and we will go from there."*
//
// So the width is NOT derived from content — deliberately, and that is the
// reversal. Every column used to be sized to the widest thing drawn in it, and
// `TITLE_COL_MIN`, the S/M/L width control and the whole stagger budget existed
// to manage the consequences. One number replaces all of it, and a requirement
// title too long for it is truncated into the room the card already has rather
// than pushing the column wider.
//
// IT COSTS WIDTH, AND A LOT OF IT — stated plainly because the sentence this
// replaced read as though fixing the width SHRANK the world. Measured on the
// 34-row Substrate fixture in the shipped configuration: **3288 -> 10060 px
// wide**, a little over 3x, while the height fell 2258 -> 1773. A card is 407px
// where a bead was 20, so the drawing is now as wide as its dependency chain is
// long. That is the trade the directive buys: every requirement legible in
// place, at the price of a plan you scroll sideways.
//
// ── THE LINE BUDGET IS THE PRIMARY NUMBER NOW (req #3498, 2026-08-13) ───────
// It started as *"req# plus 40 chars wide"* — a TITLE budget, with the width
// falling out of it. The user's second measurement moved the primary number to
// the LINE, and the reason is arithmetic worth writing down:
//
//   **On-screen type = viewport / (visible columns x characters per line).**
//
// The world font size CANCELS. A 40% larger glyph widens the card by 40%, so at
// any fixed number of visible columns the text lands at exactly the same screen
// size — which is why the type still read small after `CARD_TYPE_SCALE`. The
// only lever that makes a card readable at six columns is FEWER CHARACTERS PER
// LINE, and the title survives by wrapping onto more of them.
//
// MEASURED at six columns in a 1730px panel: 47 chars -> 8.3px of requirement
// text; **28 -> 12.4px**; 20 -> 15.7px. 28 is the user's choice, with the wrap
// raised to three lines so a long title still arrives whole.
//
// Counted against WHAT THE ROW ACTUALLY DRAWS: `reqLabelText`'s
// `${reqId} - ${title}`, so the prefix is a 4-digit id plus the three-character
// " - " separator — SEVEN characters, and no '#' anywhere (ids render bare on
// this surface, production directive).
export const CARD_TEXT_CHARS = 28;
export const CARD_ID_CHARS = 4;
export const CARD_SEP_CHARS = 3;        // " - ", written by `reqLabelText`
// What is left for the title on the FIRST line. Derived, not stated: the line is
// the budget now, so a title budget written beside it would be a second number
// to keep in step.
export const CARD_TITLE_CHARS = CARD_TEXT_CHARS - CARD_ID_CHARS - CARD_SEP_CHARS;
// ── WHERE THE BEAD'S FILL WENT (req #3498) ─────────────────────────────────
// The bead carried four channels — FILL (step state), RING (run mode /
// eligible), outer HALO (launchable next), and the ✓ — and it is not drawn at
// L2/L3 any more, because a circle at the card's centre would sit on top of the
// requirement rows the card exists to show.
//
// Every channel is kept, re-homed onto the card rather than dropped: the RING
// becomes the card's border (same colour, same two weights), the HALO becomes a
// dashed outline around the whole card, the ✓ moves into the title area, and
// the FILL becomes this — a state bar down the card's leading edge.
//
// A BAR RATHER THAN A TINTED TITLE AREA, and that is a contrast decision, not a
// taste one: `runningFill` is `#FFB300` and the label colour is `#d7e3f4`, so
// filling the title area with the state colour would have put ~1.6:1 text on
// the one card a reader most needs to read. A bar carries the same colour at
// full saturation next to text that keeps its own contrast.
//
// ── OUTSIDE THE FRAME, ON THE LEFT (user directive, 2026-08-13) ────────────
// It began flush INSIDE the card's left border, where it ate into the text
// column and read as part of the lettering. It is now BESIDE the frame, still
// on the left: the rounded rect starts `CARD_STATE_BAR_W + CARD_BAR_GAP` in,
// and the bar stands free in the strip before it. The node's box still spans
// both, so the bar costs the card its own width rather than the text's, and
// nothing about the arcs, the lanes or the columns changes.
export const CARD_STATE_BAR_W = 6 * CARD_TYPE_SCALE;
// The air between the frame's right border and the bar. Without it the bar reads
// as a thick edge on the rect rather than as a mark of its own.
export const CARD_BAR_GAP = 6 * CARD_TYPE_SCALE;
// Horizontal padding inside the card's rounded rect, per side.
export const CARD_PAD_X = 10 * CARD_TYPE_SCALE;
// Vertical padding at the card's top and bottom edges.
export const CARD_PAD_Y = 8 * CARD_TYPE_SCALE;
// ── CARD WIDTH IS A SCALE, NOT JUST A NUMBER (req #3503, "Step Width") ─────
// The four ladder rungs the toolbar control offers — 1 the card every
// existing pixel-exact test in this suite already assumes, 2 through 4 each
// 25% more TEXT room than the last. Linear, not compounding: rung 4 is 1.75x
// the base, not 1.25^3 — a reader picking "4" is asking for "generous", not
// doing exponent arithmetic in their head.
export const STEP_WIDTH_SCALES = [1, 1.25, 1.5, 1.75];
export const DEFAULT_STEP_WIDTH_LEVEL = 1;

/**
 * The card's own width geometry, AS A FUNCTION of the text-room scale.
 *
 * `CARD_W`/`CARD_FRAME_W`/`CARD_TEXT_W` below are this at scale 1 — the
 * ORIGINAL, fixed-forever size every existing caller already assumes — so
 * nothing that reads those three constants directly has to change: they are
 * this function evaluated once, at the default rung.
 *
 * ONLY THE TEXT ROOM SCALES. `CARD_TEXT_CHARS` is the one term multiplied;
 * the padding, the state bar and its gap are fixed chrome, at every rung,
 * exactly the way `CARD_CHECK_W`/`CARD_STEP_LINK_W`/`CARD_BADGE_W` already
 * are — "wider" is a promise about how much of a title or a requirement
 * fits on one line, not about how thick the card's own furniture gets.
 *
 * `ceil`, not `round`, for the same reason the scale-1 number always was: at
 * `round` the ideal width can land one character short of what `cardChars`
 * — which floors — then reports, so the budget stops being a guarantee.
 */
export function cardGeometryFor(widthScale = 1) {
    const cardW = Math.ceil(CARD_TEXT_CHARS * widthScale * CHW_REQ + 2 * CARD_PAD_X
        + CARD_STATE_BAR_W + CARD_BAR_GAP);
    const cardFrameW = cardW - CARD_STATE_BAR_W - CARD_BAR_GAP;
    const cardTextW = cardFrameW - 2 * CARD_PAD_X;
    return { cardW, cardFrameW, cardTextW };
}

const BASE_CARD_GEOMETRY = cardGeometryFor(1);
export const CARD_W = BASE_CARD_GEOMETRY.cardW;
// The card's drawn FRAME — the rounded rect — which is narrower than the node's
// box by the state bar and its gap (req #3498, user directive: *"make the color
// bar on the right edge of the step render outside the current frame of the
// requirement, so it doesn't crowd the letter but rather sits a little wider"*).
// The bar is beside the frame, not inside it; the node box still spans both, so
// arcs, lanes and columns are unaffected.
export const CARD_FRAME_W = BASE_CARD_GEOMETRY.cardFrameW;
// How far the frame starts in from the node's left edge — the strip the state
// bar stands in. Every piece of card furniture is placed from `n.left + this`
// rather than from `n.left`, so the bar's width lives in ONE expression.
export const CARD_FRAME_X = CARD_STATE_BAR_W + CARD_BAR_GAP;
// The text column inside the padding — what every string in the card is fitted
// to. Read rather than re-derived, so a padding change cannot desync the two.
export const CARD_TEXT_W = BASE_CARD_GEOMETRY.cardTextW;
// The gutter between one card and the next — and, because a card fills its
// column edge to edge, THE ONLY ROOM A DEPENDENCY ARC HAS TO TURN IN.
//
// That is what sizes it, not the look of the whitespace. The user asked for the
// steps to be *"linked from their midpoints and fan out nicely"*, and a fan-out
// is a cubic whose horizontal run is comparable to its vertical drop. A bead
// took ~20px of its column, so an arc between two adjacent columns had most of
// a column to bend in; a card takes ALL of it, so whatever is left here is the
// entire budget. At the old 26px a one-lane drop would have been drawn as a
// near-vertical kink between two card edges.
export const CARD_GAP_X = 90;
// The gap BELOW a card, before the next lane's card starts. The user's
// "respectful gap / white space", charged once per lane by `lanePitch`.
export const CARD_GAP_Y = 22;
// The title area: the step name on one line, and — when the step name is the ID
// — the step's own TITLE on a second line below it. See `cardTitleH` for why the
// second line is a property of the LAYOUT and never of the zoom level.
export const CARD_LINE_H = 21 * CARD_TYPE_SCALE;      // the step-name line
export const CARD_SUBTITLE_H = 14 * CARD_TYPE_SCALE;  // the step-title line
// The horizontal rule under the title area, and the air either side of it.
export const CARD_RULE_GAP = 7 * CARD_TYPE_SCALE;
export const CARD_RULE_H = 1;
export const CARD_RULE_BAND = 2 * CARD_RULE_GAP + CARD_RULE_H;
export const CARD_RADIUS = 10 * CARD_TYPE_SCALE;


/**
 * The height of a card's title area.
 *
 * TWO LINES OR ONE IS A PROPERTY OF `stepLabel`, NOT OF THE LEVEL — and the
 * distinction is the oldest invariant in this module. `stepLabel` is a user
 * control ('Step: ID | Title'), so changing it may relayout; the semantic LEVEL
 * (L1/L2/L3) may not, because it is also resolved from the zoom scale and a
 * geometry that changed with zoom would make every card jump as the reader
 * scrolled the wheel.
 *
 * So in ID mode the card reserves the step-title line at EVERY level and draws
 * it only at L3 — the room is spent either way, exactly as the old reserved
 * title slot spent it. In TITLE mode the step name already IS the title, so
 * there is no second line to draw and none is reserved (the old code skipped
 * the slot for the same reason).
 */
export const cardTitleH = (stepLabel, nameLines = 1) => CARD_PAD_Y
    + Math.max(1, nameLines) * CARD_LINE_H
    + (stepLabel === 'title' ? 0 : CARD_SUBTITLE_H);

// ── THE STEP NAME WRAPS TOO (req #3498, 2026-08-13) ─────────────────────────
// It has to, and the reason is the same arithmetic that narrowed the card: at a
// 28-character line the name's own budget — the text column less the four
// title-row reserves (req #3503: the ✓, the link button, the badge and its
// gap), at the LABEL glyph which is wider than the row glyph — is seventeen
// characters (measured — see `cardChars(CHW_LABEL, CARD_CHECK_W +
// CARD_STEP_LINK_W + CARD_BADGE_W + CARD_BADGE_GAP)`). "Feature Eradication
// - MCP, Scripts, Frontend…" is the actual data, and it truncates well short
// of one line at that budget.
//
// So the card's title area takes up to two lines by the same rule the rows do:
// wrapped at layout time, RESERVED at every level, and per-step, so a card with
// a short name stays short.
export const NAME_MAX_LINES = 2;

/**
 * A card's full height: title area, rule, then one line per requirement.
 *
 * `reqBlockH` is the block's PIXEL height, from `reqBlockHeight` above — not a
 * count. It was a requirement count, then a line count, and neither survived the
 * gap becoming a second quantity; a pixel height is the one form that cannot go
 * stale the next time the block gains a term.
 *
 * A step with NO requirements still gets a card — it is a step, it has a name,
 * and its emptiness is a fact worth seeing — so the requirement block floors at
 * zero lines rather than at one.
 */
/**
 * The exact height of a card's requirement block, from the wrapped rows.
 *
 * LINES are charged at `REQ_LINE_H` and the GAPS BETWEEN ROWS at `REQ_ROW_GAP`
 * — two different quantities since the user's 2026-08-13 directive, because a
 * wrapped row's own two lines are one sentence and must not be pushed apart by
 * the air that separates two different requirements. `n - 1` gaps, not `n`:
 * the last row's air is `CARD_PAD_Y`, which the card already charges.
 */
export const reqBlockHeight = (rowLines) => {
    const rows = rowLines || [];
    if (rows.length === 0) return 0;
    const lines = rows.reduce((t, l) => t + (l.length || 1), 0);
    return lines * REQ_LINE_H + (rows.length - 1) * REQ_ROW_GAP;
};

export const cardHeight = (reqBlockH, stepLabel, nameLines = 1) =>
    Math.max(CARD_MIN_H, cardTitleH(stepLabel, nameLines) + CARD_RULE_BAND
        + Math.max(0, reqBlockH) + CARD_PAD_Y);

// ── THE FLOOR, AND IT IS DERIVED (req #3498) ────────────────────────────────
// It binds ONLY the requirement-less card: `cardHeight(0, 'title')` is 52px of
// title area, rule and padding, and every card with even one requirement is
// taller than this floor already.
//
// 68 = 2 x 34, and the 34 is not a taste: it is the clearance the NEXT-STEP HALO
// needs above a LANE-0 bead before it reaches the epic chip's strip
// (`NEXT_HALO_CLEARANCES.epicChipStrip`, which is HALF A CARD because the bead
// sits at the card's midpoint and the card's top IS that strip's bottom). Under
// the old geometry that room was `STEP_LABEL_RISE + BEAD_LANE_OFFSET` = 34, and
// three requirements — #3271, #3280, #3299 — went into making the halo READ at
// Overview inside exactly that budget. A squat empty card would have cut it to
// 26 and shrunk the one mark that answers "what runs next?" at the zoom it is
// most often asked at.
//
// So the floor is written where the number comes FROM. It also happens to be
// the right look — a card with no rows still reads as a card rather than as a
// label with a line under it — but that is the bonus, not the derivation.
const CARD_MIN_H = 68 * CARD_TYPE_SCALE;

// The room the DONE ✓ occupies at the title area's right edge — reserved out of
// the step label's budget rather than drawn over it (req #3498 review finding).
// Every one of the 34 step titles on the live fixture is longer than the card
// can draw, so an unreserved glyph is not an edge case: it landed on the
// truncated title's ellipsis on all 23 completed cards.
export const CARD_CHECK_W = 13 * CARD_TYPE_SCALE;

// ── "VIEW IN TABLE, HIGHLIGHTED" — A VISIBLE BUTTON, NOT JUST A HIDDEN HIT
// RECT (req #3503, user directive: "place a proper sized button for the
// requirements link — use same button as epic's requirement link, that is the
// pattern") ──────────────────────────────────────────────────────────────
// The card's title area has carried this action since req #3213
// (`onStepFocus`, wired to an invisible hit rect over the step name) — this
// only gives it a glyph a reader can actually SEE and aim at, the same way
// the epic chip's own ↗ does for "open this epic's steps". Same glyph, same
// idea: click here to jump to this row, filtered and highlighted, elsewhere.
// Reserved out of the step name's budget the same way the ✓ is, so it never
// draws over a truncated title.
//
// SIZED LIKE THE ✓ IT SITS BESIDE (req #3503 review — "align further to the
// right edge to give the step title more room"), not like the epic chip's
// own 30 SCREEN px: that reservation is a fixed screen-px HTML overlay
// control, unscaled by zoom, while this one is WORLD px on a card that is
// itself fixed-width — the two numbers are not the same unit and comparing
// them literally over-reserved this. A glyph the size of the ✓ needs a
// target the size of the ✓'s own reserve, not a larger one, and every world
// px given back here is a world px the title gets to keep.
export const CARD_STEP_LINK_W = CARD_CHECK_W;

// ── THE TOTAL REQUIREMENT COUNT, AS A BADGE LEFT OF THE TITLE (req #3503,
// user directive: "add a count badge to the left of the title — use that
// green count badge we had before") ─────────────────────────────────────
// Moved here from the title area's RIGHT edge (where it drew as dim, dead
// "(N)" text — see the removed `CARD_COUNT_W` block this replaces) to a
// pill reusing `KonvaSwarmCanvas.jsx`'s day-header "requirements met" badge
// (`.ts-bead-day-count-inline`)'s FILL verbatim — its text colour does not
// carry over; see the `badgeFill`/`badgeText` entries in `PLAN_VIZ_PALETTE`
// for why. A count of what's already visible below is a fact worth a
// reader's eye going TO, so it earns the more prominent position and the
// brighter mark.
// It is still the TOTAL requirement count, not met/total — that is the epic
// chip's vocabulary and answers a different question; a step's own progress
// is already on the card as its coloured rows, so restating it as a
// fraction would be the same fact twice at the same level.
// Reserved out of the step name's budget the same way the ✓ and the link
// button are, so a long title starts AFTER the badge rather than under it.
// No parens: a pill's own shape is what used to say "this is a count", so
// the two characters spent on `()` are room the badge doesn't need back.
export const CARD_BADGE_GAP = CHW_REQ;
// The pill's own height, and — for a one-digit count — its WIDTH too, so it
// draws as a CIRCLE rather than a stretched capsule (req #3503 review, round
// 1: the first cut always drew the full RESERVED width regardless of digit
// count, stretching a single digit into an oval; round 2, a SECOND review —
// the digit didn't even FIT the circle: `REQ_TEXT_H`, this used to be pinned
// to, is 19.6 world px, and the badge's own font (below) draws at 23.1 —
// larger than the box meant to hold it). Pinned to `CARD_LINE_H` instead —
// the title's own line height, since the badge sits IN that line and is
// meant to fill it the way the title's own type does, not the shallower
// single-text-row metric `REQ_TEXT_H` measures. `− 4` leaves 2 world px of
// margin top and bottom so the pill's round cap clears the line box.
export const CARD_BADGE_H = CARD_LINE_H - 4;
// The digit's own font size — the TITLE's size, not the row glyph's (round
// 1's choice, and part of why round 2 was needed): the badge sits beside
// the title on its own line, not among the requirement rows below, and
// reads as a peer of the title's own type rather than a caption.
//
// `16.5` IS `PLAN_VIZ_FONT.label` — MIRRORED BY VALUE, not imported, because
// `PLAN_VIZ_FONT` (and `CARD_FONT`, its derived form) are both declared
// FURTHER DOWN this file: referencing either here would be a forward
// reference to a `const` that has not initialised yet, a TDZ crash rather
// than a lint nit. `pipelinePlanLayout.test.js` asserts
// `CARD_BADGE_FONT === CARD_FONT.label` so the two cannot quietly drift
// apart the way `STEP_FOCUS_CONTEXT`'s history (req #3503, elsewhere in
// this file) shows a copied-by-value constant can.
export const CARD_BADGE_FONT = 16.5 * CARD_TYPE_SCALE;
// Breathing room around the digits ONCE they are wider than the circle
// itself — i.e. two digits or more. A single digit needs none: centring it
// inside `CARD_BADGE_H` already leaves (`CARD_BADGE_H` − one glyph) / 2 of
// air on each side, which is what makes it read as a circle rather than a
// digit touching a ring.
export const CARD_BADGE_PAD_X = 4 * CARD_TYPE_SCALE;
/**
 * The badge's own drawn width for a count of `charCount` digits — a CIRCLE
 * up to whatever fits inside `CARD_BADGE_H` at zero pad, a STADIUM beyond
 * that. `CHW_LABEL`, matching `CARD_BADGE_FONT` — the same char-width-per-
 * font-size pairing every other measurement in this module keeps (`CHW_REQ`
 * with `CF.req`, `CHW_TITLE` with the L3 line). ONE formula, used both for a
 * real row's actual width (fewer digits, usually a circle) and for
 * `CARD_BADGE_W` below (the worst case, always a stadium) — so the two can
 * never quietly disagree about what "a count this wide" measures.
 */
export const badgeWidthFor = (charCount) =>
    Math.max(CARD_BADGE_H, charCount * CHW_LABEL + CARD_BADGE_PAD_X);
// The RESERVED width — used for the title's own indent and its character-
// wrap budget, so both stay CONSTANT across every card on the plan
// regardless of what any one step's count happens to be.
//
// SIZED FOR TWO DIGITS, NOT THREE (req #3503 review, round 2: "lost space to
// the left of the badge"). A step's OWN linked-requirement count — not a
// plan-wide total — is the quantity here, and double digits already covers
// every count this file's own fixtures exercise; reserving a third digit
// bought room a card is realistically never going to spend, and every world
// px of that room was the exact "lost space" the review measured. The DRAWN
// badge is still almost always narrower than even this (see `badgeWidthFor`
// above, called again per-row with the row's real digit count) and sits
// flush against the reserve's own right edge — against the gap before the
// title — so freeing width only ever opens air on the badge's OWN left,
// never moves the title. A step that somehow carries 100+ requirements
// would draw a badge wider than the reserve rather than clip — see
// `badgeWidthFor`'s own uncapped formula — encroaching on the gap before
// the title rather than the title itself.
export const CARD_BADGE_W = badgeWidthFor(2);

// How many characters of a given mono width fit the card's text column.
// `reserve` is total room taken off the column, from either edge — the ✓,
// the link button and the badge, whichever of them the caller's own budget
// is for. `textW` defaults to the scale-1 column (`CARD_TEXT_W`) but takes
// any `cardGeometryFor(scale).cardTextW` too — the SAME formula at whatever
// rung "Step Width" is on, never a second one.
export const cardChars = (chw, reserve = 0, textW = CARD_TEXT_W) =>
    Math.max(3, Math.floor((textW - reserve) / chw));

// ── A REQUIREMENT ROW TAKES A SECOND LINE BEFORE IT TRUNCATES ───────────────
// User directive, 2026-08-13, looking at the live card: *"Give the title a
// second line before cutting off the length."* At 40 characters a real
// requirement title is cut mid-word — *"3434 - Give requirements.ai_model and
// effort a…"* — and the second line is what makes the row a sentence again.
//
// THREE LINES, NOT N. A row is a list item; a paragraph inside a card stops the
// card being scannable, and the card's height is already the plan's vertical
// budget. Past the limit the text truncates exactly as it did before.
//
// It was TWO while the line held 47 characters. The line is 28 now (see
// `CARD_TEXT_CHARS`), so three lines carry 84 characters where two carried 94 —
// close to the same title, at half again the on-screen size.
export const REQ_MAX_LINES = 3;

/**
 * Break one row's text into at most `REQ_MAX_LINES` lines of `maxChars`.
 *
 * WORD BOUNDARIES WHERE THERE IS ONE, a hard break where there is not — a
 * requirement title is prose but it contains identifiers (`requirements.ai_model`,
 * `--dangerously-skip-permissions`) longer than the line, and refusing to break
 * those would leave the line short and the text lost.
 *
 * The LAST line it produces is the only one that may carry an ellipsis, and it
 * carries one only when text was actually dropped — `truncate`'s own rule.
 */
export function wrapReqText(text, maxChars, maxLines = REQ_MAX_LINES) {
    const full = String(text == null ? '' : text);
    if (full.length <= maxChars) return [full];
    const lines = [];
    let rest = full;
    while (rest.length > 0 && lines.length < maxLines) {
        if (lines.length === maxLines - 1) {
            lines.push(truncate(rest, maxChars));
            rest = '';
            break;
        }
        if (rest.length <= maxChars) { lines.push(rest); rest = ''; break; }
        // The last space that still fits, so the break lands between words.
        const cut = rest.lastIndexOf(' ', maxChars);
        const at = cut > 0 ? cut : maxChars;
        lines.push(rest.slice(0, at));
        rest = rest.slice(cut > 0 ? at + 1 : at);
    }
    return lines;
}
// ── THE CHARACTER CEILING IS THE CARD (req #3498) ──────────────────────────
// `LABEL_MAX_CHARS` (60) and `STEP_LABEL_MAX` (60) were two names for one
// number: the hard cap that stopped a pathological title running forever
// through a world where the only other bound was a STAGGER BUDGET derived from
// the neighbouring columns. Both are gone, and so is the budget, because the
// card answers the question they were both approximating — how much text fits?
// — exactly: `cardChars(chw)`, the card's own text column divided by the glyph
// width. There is no cap to keep in step with the room any more, because the
// room IS the cap.
//
// ── AND SO IS THE STAGGER (req #3498) ──────────────────────────────────────
// `STAGGER_GAP`, `STAGGER_PHASES`, `STAGGER_SPAN`, `STAGGER_REACH`,
// `TITLE_COL_MIN` and `MIN_LANE_PITCH` were ONE mechanism, built over req
// #3119 / #3362 / #3365, and its entire purpose was to let text OVERFLOW its
// own column into the neighbours without colliding: odd columns drew a line
// lower, reaches were bounded to a fraction of the narrower neighbour, and a
// per-band first-fit sweep pushed busier stacks down to clear the columns
// within the phase window.
//
// A CARD CANNOT OVERFLOW ITS COLUMN. Its text is inside a rounded rect of fixed
// width and is truncated to it, and the columns are uniform and gapped
// (`CARD_GAP_X`), so no two cards can be closer than the gap and no string can
// leave the card that owns it. Every proof the stagger existed to supply — the
// pairwise reach bound, the phase window, the offset sweep, the extra line each
// lane and band header reserved — is discharged by construction instead. The
// mechanism is not retuned or disabled; it has no subject.
//
// What that DELETES, and it is the whole point of the change: two column-floor
// constants, four stagger constants, `TITLE_SLOT`, `MIN_LANE_PITCH`,
// `staggerBudget`, `staggerOf`, the `reqOffsets` first-fit sweep and its
// `countAt` helper, the `staggerLabels`/`staggerReqs` flags and every
// conditional that read them.
export const PLAN_VIZ_FONT = {
    label: 16.5, req: 13.75, title: 9.5, epic: 15, check: 9, slot: 13,
};

// The CARD's own type, `PLAN_VIZ_FONT` through `CARD_TYPE_SCALE`. Derived rather
// than written out, so the glyph widths above and the sizes drawn here cannot
// scale by different factors — which is exactly how a fitted string starts
// overflowing the box that was measured for it.
//
// `check` appears in BOTH: the card's ✓ scales with the card, and the BEAD's ✓
// at L1 keeps `PLAN_VIZ_FONT.check`, because it is drawn inside a 10px bead that
// did not grow.
export const CARD_FONT = {
    label: PLAN_VIZ_FONT.label * CARD_TYPE_SCALE,
    req: PLAN_VIZ_FONT.req * CARD_TYPE_SCALE,
    title: PLAN_VIZ_FONT.title * CARD_TYPE_SCALE,
    check: PLAN_VIZ_FONT.check * CARD_TYPE_SCALE,
};

export const BEAD_RADIUS = BEAD_R;

// The bead's own ring, in the two weights `beadStyle` picks between. EXPORTED
// and named rather than left as literals because the next-step halo's ceiling
// is measured against the EMPHASIS weight (req #3271): what bounds the halo's
// growth at Overview is the distance to the neighbouring bead's outer edge, and
// that edge is `BEAD_RADIUS + BEAD_RING_W_EMPHASIS / 2`. A literal there and a
// literal here would only agree by accident.
export const BEAD_RING_W_EMPHASIS = 2.5;   // manual, or eligible-now
export const BEAD_RING_W_BASE = 1.5;
// The outer edge of the widest bead ring drawn — 11.25.
export const BEAD_OUTER_RADIUS = BEAD_R + BEAD_RING_W_EMPHASIS / 2;

// The bead's invisible HIT circle, slightly larger than the bead so a small
// target stays easy to point at. It lives here rather than as a literal in the
// renderer because req #3213 made it an INVARIANT: the label hit regions are
// pushed above these circles, so a label rect that reached into a DIFFERENT
// step's hit circle would silently take ownership of it and answer with the
// wrong step's card. The layout tests assert that clearance, and a test can
// only assert the number the renderer actually uses.
export const BEAD_HIT_RADIUS = BEAD_R + 5;

// ── Step width (req #3168, "UI option for step width") ──────────────────────
// A MULTIPLIER on the computed column width, never a replacement for it. The
// column width is the zero-overlap contract's first half: it is derived from the
// widest thing actually drawn in the column, so a factor BELOW 1 would push the
// requirement ids out of their own column slab — the exact invariant
// `req labels stay inside their column slab` asserts. Only widening is offered,
// and `compact` is the identity so the default plan is byte-identical to the
// pre-#3168 geometry.
// ── THE WIDTH CONTROL IS GONE (req #3498, user directive) ──────────────────
// *"Remove the width UI option S/M/L as part of this, won't need it any more."*
//
// `STEP_WIDTH_FACTORS` multiplied every CONTENT-SIZED column by 1.1 / 1.1836 /
// 1.428, and it existed because content sizing produced columns the reader kept
// wanting more air in. Columns are not content-sized any more — every one of
// them is `CARD_W + CARD_GAP_X` — so the multiplier has nothing to scale and the
// question it answered ("how much room does this text need?") is answered once,
// by the card, for the whole plan. `MIN_STEP_WIDTH_FACTOR` went with it: the
// next-step halo's ceiling measured against the tightest column any SETTING
// could produce, and there is now exactly one column width to measure.

// ── The requirement-mark VIEW: one control, TWO positions (req #3498) ──────
// It had three, and the third was `horizontal` — every requirement of a step on
// ONE line, sharing the column N ways and paying the (N−1) separators out of the
// same room. The user's answer when asked what should happen to it:
//
// > *"Why was there still horizontal. You failed to deprecate properly. Remove."*
//
// The requirement says the card lists *"the requirements top to bottom inside the
// card in the order"*, so a horizontal row is not a layout the card HAS. What is
// left is the only distinction that still means anything — whether a row says the
// requirement's ID or its TITLE — and `reqLayout` disappears with the option,
// since there is nothing left for it to select.
//
// A READER HOLDING 'horizontal' IN localStorage normalizes to the default rather
// than to itself. That is the one behavioural difference from the old three-value
// control, and it is deliberate: the alternative is rendering a layout that no
// longer exists.
export const REQ_VIEWS = {
    vertical: { reqLabel: 'id', label: 'Reqs: IDs' },
    titles: { reqLabel: 'title', label: 'Reqs: Titles' },
};
export const DEFAULT_REQ_VIEW = 'vertical';
// `Object.hasOwn`, not a truthiness test on the lookup (review finding, kept
// with the rule it protects). The value arrives from localStorage, so
// `"toString"` and `"constructor"` are both reachable — and both resolve to an
// inherited FUNCTION, which is truthy, and would put a function body where a
// label belongs.
export const isReqView = (v) => Object.hasOwn(REQ_VIEWS, v);
export const normalizeReqView = (v) => (isReqView(v) ? v : DEFAULT_REQ_VIEW);
export const reqViewOptions = (v) => REQ_VIEWS[normalizeReqView(v)];

// ── STEPS-ACROSS: ZOOM BY HOW MANY STEPS YOU WANT TO SEE (req #3498) ───────
// User directive, 2026-08-13: buttons for 10 through 2 on evens, left of View,
// numbers only. Each one takes the CENTRE of the viewport and zooms so that
// many steps span it.
//
// It is the natural control for this canvas, and the measurements are why: a
// card's on-screen size is `viewport / (columns x chars-per-line)`, so "how many
// columns fit" is the quantity a reader is actually choosing when they zoom.
// The semantic-level chips beside it pick WHAT IS DRAWN; these pick HOW MUCH.
export const STEPS_ACROSS_OPTIONS = [10, 8, 6, 4, 2];

// TWO IS THE EXCEPTION THE USER NAMED — *"fitting ... with tight white space
// except when 2 is selected"*. Every other option fits its columns edge to
// edge; two of them filling a 1730px viewport puts a single card at ~690px and
// its text at ~37px, which is past reading and into filling. So 2 fits its pair
// into a FRACTION of the viewport and leaves the rest as air: still the closest
// look the control offers, without the canvas becoming a poster.
export const STEPS_ACROSS_TIGHT_FROM = 4;
export const STEPS_ACROSS_LOOSE_FILL = 0.8;

/**
 * The scale at which `n` steps span the viewport.
 *
 * A step is a COLUMN — `colW` — because that is the pitch the plan actually
 * repeats at; fitting `n` cards and forgetting the gutters would land every
 * option one card too wide.
 *
 * `colW` DEFAULTS TO THE SCALE-1 PITCH (`CARD_W + CARD_GAP_X`) but a caller
 * holding a live `layout` MUST pass `layout.colPitch` instead (req #3503
 * review — NOT `layout.colW`, which is the PER-COLUMN array `colPitch` was
 * built from; `Number.isFinite` on that array silently fails rather than
 * throwing, so a wrong pick here does not announce itself). Step Width
 * scales the card, not the gap, so `layout.colPitch` already carries
 * whichever rung is active — the default here exists only for a caller with
 * no layout in hand (a fixed-geometry test, or code that predates Step
 * Width), and using it where a layout DOES exist under-counts every rung
 * above 1: measured, "fit 5 across" landed 5.00 / 4.25 / 3.70 / 3.27 columns
 * at rungs 1-4 while claiming 5 at all of them.
 *
 * Returns null on a viewport or an `n` that cannot produce a scale, so the
 * caller does nothing rather than driving the camera to NaN.
 */
export function stepsAcrossScale(n, viewportW, colW = CARD_W + CARD_GAP_X) {
    if (!Number.isFinite(n) || n <= 0) return null;
    if (!Number.isFinite(viewportW) || viewportW <= 0) return null;
    if (!Number.isFinite(colW) || colW <= 0) return null;
    const fill = n >= STEPS_ACROSS_TIGHT_FROM ? 1 : STEPS_ACROSS_LOOSE_FILL;
    return (viewportW * fill) / (n * colW);
}

/**
 * The transform that holds ONE SCREEN POINT still while changing scale.
 *
 * Pure arithmetic on the transform, so it is testable without a canvas: the
 * world point under a screen pixel is `(px - x) / k`, and the new `x` is
 * whatever puts that same world point back under the same pixel at `nextK`.
 */
export function zoomAboutPoint(t, point, nextK) {
    if (!t || !point || !(t.k > 0) || !(nextK > 0)) return null;
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
    const wx = (point.x - t.x) / t.k;
    const wy = (point.y - t.y) / t.k;
    return { k: nextK, x: point.x - wx * nextK, y: point.y - wy * nextK };
}

/**
 * The transform that holds the viewport's CENTRE still while changing scale.
 *
 * THE CENTRE, not the origin, because that is what the steps-across directive
 * asks for and because it is what a reader expects of a zoom BUTTON: the thing
 * you were looking at stays where it is. Anchoring at the origin would fling the
 * plan off-screen at every step of the ladder — the world is 18,000px wide.
 *
 * The WHEEL anchors on the pointer instead (`zoomAboutPoint` above), because
 * that is what a wheel has always done here and snapping is not a reason to
 * change it.
 */
export function zoomAboutViewportCentre(t, size, nextK) {
    if (!size || !(size.w > 0) || !(size.h > 0)) return null;
    return zoomAboutPoint(t, { x: size.w / 2, y: size.h / 2 }, nextK);
}

// ── SNAP THE WHEEL TO THE SAME LADDER THE BUTTONS USE (req #3498) ──────────
// User directive, 2026-08-13: a toggle that makes the zoom *"go up/down in
// jumps of two cards instead of smooth"*.
//
// THE LADDER IS THE BUTTONS' OWN — every rung is a `stepsAcrossScale`, so
// wheeling to eight steps across and pressing "8" land on the SAME scale rather
// than two that merely look alike. It extends past 10 as far as the zoom extent
// allows: the buttons stop at 10 because a toolbar has to stop somewhere, the
// ladder does not.
export const SNAP_COLUMNS_STEP = 2;
// The floor: `STEPS_ACROSS_OPTIONS`' own tightest rung.
export const SNAP_COLUMNS_MIN = 2;

/**
 * How many columns currently span the viewport — the ladder's own unit.
 *
 * `colW` defaults to the scale-1 pitch for a caller with no layout in hand —
 * see `stepsAcrossScale`'s own note on why a live `layout.colPitch` must be
 * passed instead wherever one exists.
 */
export function columnsAcross(k, viewportW, colW = CARD_W + CARD_GAP_X) {
    if (!(k > 0) || !(viewportW > 0) || !(colW > 0)) return null;
    return viewportW / (k * colW);
}

/**
 * The next rung, or null when there is nowhere to go.
 *
 * `dir` is the WHEEL's direction in the reader's terms: negative zooms IN
 * (fewer steps across), positive zooms OUT (more).
 *
 * THE EPSILON IS WHAT MAKES IT STEP RATHER THAN STICK. Landing exactly on a
 * rung is the normal case — it is where the last notch put you — so "the
 * largest even below the current count" has to mean strictly below, or every
 * further notch would re-select the rung the reader is already standing on.
 *
 * Rung 2 is LOOSE (`STEPS_ACROSS_LOOSE_FILL`), so the count there reads 2.5
 * rather than 2. That is deliberate and it behaves: zooming out from it finds 4,
 * and zooming in finds the floor and stays.
 */
export function snapZoomScale(k, viewportW, dir, colW = CARD_W + CARD_GAP_X) {
    const c = columnsAcross(k, viewportW, colW);
    if (c == null || !Number.isFinite(dir) || dir === 0) return null;
    const S = SNAP_COLUMNS_STEP;
    const EPS = 0.01;
    let n;
    if (dir < 0) {
        n = Math.floor((c - EPS) / S) * S;
        if (n >= c) n -= S;                  // never re-select the current rung
        n = Math.max(SNAP_COLUMNS_MIN, n);
    } else {
        n = Math.ceil((c + EPS) / S) * S;
        if (n <= c) n += S;
        n = Math.max(SNAP_COLUMNS_MIN + S, n);
    }
    const next = stepsAcrossScale(n, viewportW, colW);
    // At the floor, zooming in further has nowhere to go — report that rather
    // than handing back the scale the reader is already at.
    return next === k ? null : next;
}

// ── The semantic-level selector (req #3168, user directive 2026-08-01) ─────
// "in the option bar, show me the L1, L2, L3 and Auto selector used elsewhere" —
// the Build Visualizer's (`BuildVisualizerControls.jsx`, req #2864). That control
// speaks 1|2|3 + null-for-auto; this canvas speaks `semanticLevel()`'s
// 'out'|'mid'|'in'. The two vocabularies meet HERE so neither the shared control
// nor the canvas has to know about the other's.
//
// PINNING CHANGES WHAT IS DRAWN, NOT WHERE THE CAMERA IS — no transform is
// touched, exactly as `KonvaBuildCanvas` does it
// (`pinnedLevel != null ? pinnedLevel : autoLevel(ratio)`).
//
// AND NOTHING QUALIFIES THAT (req #3324). There is no exception, no scale at
// which a pin decides less than the whole of what is drawn, and no camera move
// belonging to the selector. `planLevelFor` below is the one place the four
// modes are resolved; read its docstring before adding a condition to either
// side of it.
export const PLAN_LEVEL_BY_PREF = { auto: null, 1: 'out', 2: 'mid', 3: 'in' };
export const PLAN_LEVEL_NUMBER = { out: 1, mid: 2, in: 3 };
export const DEFAULT_PLAN_LEVEL_PREF = 'auto';
// Numeric keys stringify, so `Object.hasOwn(map, '2')` is true and
// `Object.hasOwn(map, 'constructor')` is false — which is the whole point.
export const isPlanLevelPref = (v) => (typeof v === 'string' || typeof v === 'number')
    && Object.hasOwn(PLAN_LEVEL_BY_PREF, v);
export const normalizePlanLevelPref = (v) => (isPlanLevelPref(v)
    ? String(v) : DEFAULT_PLAN_LEVEL_PREF);
// The pinned semantic level, or null for auto-by-zoom.
export const pinnedLevelOf = (v) => PLAN_LEVEL_BY_PREF[normalizePlanLevelPref(v)];

// ── Readable default zoom (req #3168, "Default size = readable") ────────────
// The smallest on-screen size the plan's smallest REQUIRED text may render at.
// The requirement ids are that text: the step label is bigger and the title slot
// is a level-gated extra, so a scale that keeps the ids legible keeps everything
// a reader needs legible. 11px is the floor MUI itself uses for `caption`-class
// type, and it is what the fit-to-width default fails on the live plan — 64
// steps across a 1600px panel puts the ids near 4px.
export const READABLE_MIN_PX = 11;
export const K_READABLE = READABLE_MIN_PX / PLAN_VIZ_FONT.req;

/**
 * Is the plan's smallest REQUIRED text legible at this scale (req #3280)?
 *
 * THE LEVEL LADDER ANSWERS A RELATIVE QUESTION AND LEGIBILITY IS AN ABSOLUTE
 * ONE, and until this existed the ladder was asked both. `semanticLevel()` takes
 * `curK / kDefault`, so "how far in from where you started" decides WHAT IS
 * DRAWN — and on a large plan the level that starts drawing the step names and
 * the requirement ids begins at an absolute `k` where neither can be read.
 * MEASURED on live pipeline 2 (136 rows, world width 3620.2, `kDefault` 0.8):
 * L2 begins at k = 0.400, which renders the step label at 6.6px and the
 * requirement ids at 5.5px, against the 11px floor two lines above.
 *
 * So the two questions are separated, and the ladder is NOT MOVED — req #3168
 * anchored it on `kDefault` deliberately and PIPE-09 pins its wheel behaviour.
 * The level still says which kinds this view is FOR; this says whether the
 * reader could actually use them.
 *
 * IT IS AUTO'S CONDITION, NOT THE DRAWING'S (req #3324). This was ANDed into
 * `drawsLabelKind` for every level, pinned or not, which made the level chips
 * inert below the threshold and is the defect #3324 is about — the reader's
 * explicit ruling is that L1/L2/L3 are a fixed rule set "regardless of the size
 * of the viewport [or] the zoom level". So it now sits inside `planLevelFor`,
 * on the AUTO branch alone: a resolution-driven demotion is exactly what Auto
 * is FOR, and "Auto only works when it is enabled" is what puts it there rather
 * than one line lower. The threshold, the font it is measured on and the
 * arithmetic are all untouched.
 *
 * THE REQUIREMENT IDS ARE THE TEXT THIS IS MEASURED ON, exactly as `K_READABLE`
 * itself is: the step label is bigger and the title slot is a level-gated extra,
 * so a scale that keeps the ids legible keeps everything a reader needs legible.
 * One threshold for all three gated kinds, not one per font — three thresholds
 * would be three places for the halo's magnification to step (see
 * `nextHaloMagnify`, which freezes at exactly this scale and would have to
 * choose one of them).
 *
 * IT IS TRUE AT `readableDefaultScale` BY CONSTRUCTION — that function's own
 * floor IS this threshold. A plan that already fits at a legible size never
 * reaches this gate at all, so nothing about a small plan's view changes.
 *
 * IT IS NOT TRUE AT THE VIEW A PLAN OPENS IN, and this comment said it was
 * until req #3312 moved the landing off `readableDefaultScale` and onto
 * `factoryDefaultScale`. On a plan too tall to fit at the readable scale the
 * canvas now opens BELOW this threshold and draws no gated labels at all —
 * which is what the header's Reset has done on those plans since req #3216, and
 * is the view #3312 asked the page to open in. The gate itself is unchanged;
 * only the claim about where the reader first meets it was.
 */
export function labelsLegible(k) {
    return Number.isFinite(k) && k >= K_READABLE;
}

/**
 * THE FOUR MODES, RESOLVED IN ONE PLACE (req #3324).
 *
 * > *"There are four modes only. Auto — algorithm changes the display settings
 * > between L1, L2 and L3 based on the resolution; Auto only works when it is
 * > enabled. L1 through L3 are a rule set and formation for what gets displayed
 * > at the three levels, and the buttons are sticky and keep the formatting
 * > selected applied to the visualizer regardless of the size of the viewport
 * > [or] the zoom level. It's fixed until Auto is selected."*
 *
 * That is the whole contract, and it is TWO BRANCHES with nothing between them:
 *
 *   · **A PIN RETURNS ITSELF.** No scale condition, no viewport condition, no
 *     correction. `k` is not consulted at all on this branch, which is what
 *     "regardless of the zoom level" means as code — and "regardless of the size
 *     of the viewport" comes free with it, because every resolution-derived
 *     number this canvas has (`kFit` → `kDefault` → the ladder's ratio) reaches
 *     the level only through the other branch.
 *   · **AUTO IS THE ALGORITHM.** The ladder answers from the ratio, and a scale
 *     that cannot render the level's own text demotes it to `'out'` — the
 *     resolution-driven decision `labelsLegible` was written for (req #3280),
 *     now on the only branch entitled to make one.
 *
 * ── WHY THE DEMOTION IS A LEVEL AND NOT A SECOND GATE ───────────────────────
 * It was an `&& labelsLegible(k)` inside `drawsLabelKind`, ANDed for every level
 * alike, and that is exactly the defect: below `K_READABLE` all four chips drew
 * one identical canvas. Req #3310 tried to rescue the chips by MOVING THE CAMERA
 * to meet a pin; the user's answer to that was #3324 — "still broken" — because
 * a control that changes the zoom to honour itself is not a rule set about what
 * is displayed. Demoting instead is exactly equivalent to the old AND for all
 * three gated kinds ('mid' and 'in' drew none of them below the threshold, and
 * 'out' draws none at any scale), so nothing about AUTO's rendering changed
 * while the pinned branch became unconditional.
 *
 * It also collapses two "levels" into one. The component used to carry the
 * ladder's answer AND the level actually drawn, publishing one as `data-level`
 * and reporting the other to the toolbar — which is why the selector could sit
 * on L1 while the canvas was pinned to L2, the reported symptom. There is one
 * level now, and the chip, the attribute and the drawing all name it.
 *
 * @param {?('out'|'mid'|'in')} pinnedLevel  `pinnedLevelOf(pref)`; null = Auto
 * @param {number} ratio  `curK / kDefault` — the ladder's input, Auto only
 * @param {number} k      the absolute world→screen scale, Auto only
 * @returns {'out'|'mid'|'in'} the level the canvas draws
 */
export function planLevelFor(pinnedLevel, ratio, k) {
    if (pinnedLevel != null) return pinnedLevel;
    const auto = semanticLevel(ratio);
    return labelsLegible(k) ? auto : 'out';
}

/**
 * THE READABLE SCALE (req #3168) — fit-to-width, floored at legible.
 *
 * NO LONGER THE SCALE A PLAN OPENS IN, which is what this was introduced as and
 * what its name still says. Req #3312 moved the landing onto
 * `factoryDefaultScale` — the header's Reset — so that opening a plan and
 * clicking Reset produce the same viewport. What this number still IS, and why
 * it is not merely dead:
 *
 *   · the ANCHOR of the semantic level ladder (`semanticLevel(curK / kDefault)`)
 *     and of the zoom behavior's `scaleExtent`, both of which req #3168 pinned
 *     to it deliberately and PIPE-09 asserts;
 *   · the base scale the epic and step focus transforms clamp against.
 *
 * EXPORTED as a function rather than left as `Math.max(kFit, K_READABLE)` inline
 * in the component (req #3280), because a test can only reach the number the
 * renderer actually uses — an inline formula could only be re-derived in the
 * test and asserted against itself.
 *
 * `factoryDefaultScale` is the SIBLING, not a duplicate. The two were the
 * landing and Reset respectively between req #3216 and req #3312; they are now
 * the ladder's anchor and the base view.
 *
 * A non-finite `kFit` resolves to `K_READABLE` rather than propagating NaN —
 * `size.w / layout.width` is a division the caller performs on measured values,
 * and a NaN scale silently blanks the canvas rather than erroring.
 */
export function readableDefaultScale(kFit) {
    return Number.isFinite(kFit) ? Math.max(kFit, K_READABLE) : K_READABLE;
}

/**
 * THE LEVEL'S RULE SET — is this label kind drawn (req #3221)?
 *
 * ONE CONDITION, AND IT IS THE LEVEL (req #3324). 'out' carries no per-step
 * detail; the title slot is 'in' only. That is the whole of it, so the three
 * chips and this function say the same thing and a reader who pins L2 gets L2's
 * formation at every scale and every panel width — the contract #3324 states.
 *
 * IT TOOK A `k` UNTIL #3324, ANDed with `labelsLegible`, and that is what made
 * the chips inert below `K_READABLE`. The condition is not gone: it moved into
 * `planLevelFor`'s AUTO branch, where a resolution-driven decision belongs. So
 * this function is now given a level that has already accounted for legibility
 * where legibility is Auto's business, and answers the level's own question
 * only. See `planLevelFor` for the ruling and for why demotion is equivalent.
 *
 * IT LIVES HERE RATHER THAN IN THE RENDERER because the halo's whole guarantee
 * is a relationship between this answer and `nextHaloMagnify`'s: a magnified
 * halo reaches past the 14-world-px box a step label and the first requirement
 * id sit in, so it may only grow where they are not drawn. While the predicate
 * was three lines inside the component and the magnification was a function in
 * this module, NOTHING COULD ASSERT THE PAIR — the component's own test would
 * have had to rasterise a canvas to see it, which is precisely why the
 * component publishes `data-drawn` at all. With both here, one sweep over
 * (kind × level × k) proves it, and breaking the pair reddens that sweep
 * instead of shipping. Since #3324 the pair is closed by CONSTRUCTION as well:
 * `nextHaloMagnify` and `nextMarkIsDot` take this answer as an argument, rather
 * than relying on both sides happening to turn on the same threshold — an
 * arithmetic coincidence a pin drawing labels at any scale would have voided.
 *
 * `true` for everything else, and that fallback is load-bearing rather than a
 * default nobody reaches: the ruler's slot ticks, the launch-unit letters and
 * the epic band names are drawn at every level and are not gated at all.
 *
 * This is DRAW-ONLY. `computePlanLayout` reserves every label's rect at every
 * level regardless — the zero-overlap invariant is asserted against it
 * unconditionally — so a kind going dark never moves anything else.
 */
export function drawsLabelKind(kind, level) {
    // `badge` and `step-link` ride the CARD (req #3498, extended req #3503) —
    // both are drawn in the title area, so they appear exactly where the card
    // does and never float beside a bare bead.
    if (kind === 'step' || kind === 'req' || kind === 'badge' || kind === 'step-link') {
        return level !== 'out';
    }
    if (kind === 'title') return level === 'in';
    return true;
}

// ── THE PIN NEVER MOVES THE CAMERA (req #3324) ──────────────────────────────
// `levelPinTransform` stood here between req #3310 and req #3324: a pin naming a
// level the current SCALE could not draw zoomed the camera to the smallest scale
// that could. It existed because `drawsLabelKind` ANDed the level with
// `labelsLegible`, so below `K_READABLE` all four chips drew one canvas — and
// moving the camera was chosen over exempting the pin, on the grounds that an
// exempt pin would break the halo's guarantee and would draw text nobody could
// read. The user's answer was #3324, *"L1, L2 and L3 are still broken"*: a
// selector that changes the zoom to honour itself is not a rule set about what
// is displayed, and it left AUTO's resolution algorithm running while a level was
// pinned. The rejected fix is the shipped one now, with the halo's guarantee
// carried as an ARGUMENT (see `drawsLabelKind`, `nextHaloMagnify`,
// `nextMarkIsDot`) instead of as an arithmetic coincidence between two
// thresholds, and legibility kept as AUTO's own demotion in `planLevelFor`.
// Nothing replaces the function: the selector owns no camera move at all.

// ── The time axis (req #3201) ───────────────────────────────────────────────
// Sentinel slot prefixes. Sorting the composed keys lexicographically IS the
// chronological order: '0' < '1' < '2', and ISO days sort as strings.
const SLOT_UNKNOWN = '0:unknown';
const SLOT_FUTURE = '2:future';
const slotOfDay = (at) => `1:${String(at).slice(0, 10)}`;

// Comparable rank for a step's derived start. UNKNOWN sorts BEFORE every date
// and FUTURE AFTER every date, which is what makes the monotone max below mean
// "the latest thing this step is downstream of".
const TIME_RANK = { unknown: 0, dated: 1, future: 2 };
const rankOf = (t) => TIME_RANK[t && t.kind] || 0;
function timeCmp(a, b) {
    const ra = rankOf(a);
    const rb = rankOf(b);
    if (ra !== rb) return ra - rb;
    const xa = (a && a.at) || '';
    const xb = (b && b.at) || '';
    return xa === xb ? 0 : (xa < xb ? -1 : 1);
}

/**
 * Turn derived START TIMES into COLUMNS, with dependency depth as a hard floor.
 *
 * The axis is a sequence of TIME SLOTS: one leading slot for steps whose start
 * is UNKNOWN, one per distinct calendar DAY that carries work, and one trailing
 * slot for steps that have positively not begun. Day granularity is a choice: a
 * slot per distinct timestamp degenerates the drawing into a one-step-per-column
 * diagonal and hides every bit of parallelism, while a slot per day puts the
 * work of one day side by side, which is how the plan is actually read.
 *
 * Four steps, and the order matters:
 *
 * 1. **Monotonize.** A step's effective time is `max(its own, every
 *    dependency's)`. A step cannot begin before its gate; where the stored
 *    timestamps disagree — and they DO, twice, in live pipeline 2 — the gate
 *    wins. This is the same "topology outranks presentation" ruling design rule
 *    3 makes, applied to the DATA so that step 4 below needs no special case.
 *    It also resolves UNKNOWN for free: a req-less step inherits the time of the
 *    work it gates, exactly as it already inherits that work's epic label.
 * 2. **Local depth.** Inside one slot, a step's offset is its dependency depth
 *    counting only same-slot dependencies. A chain done in one day reads as
 *    consecutive columns.
 * 3. **Origins.** `origin[k] = Σ (span[i] + 1)` over earlier slots, where
 *    `span[i]` is slot i's deepest local chain. Every slot therefore starts at
 *    least one column past the last column any earlier slot can reach.
 * 4. **Columns.** `col(r) = max(origin[slot] + localDepth, 1 + max col(deps))`.
 *
 * TWO PROPERTIES FALL OUT, and both are asserted in the tests:
 *
 * - **Every arc points forward**, unconditionally, from the second term. No
 *   step can render left of something it depends on because a date said so —
 *   the constraint this requirement was told not to break.
 * - **Slot k renders strictly right of slot j < k.** Proof: by induction, a
 *   same-slot dep contributes `1 + col(d) ≤ origin[k] + localDepth(r)`, and an
 *   earlier-slot dep contributes `1 + col(d) ≤ origin[j] + span[j] + 1 ≤
 *   origin[k]`. Step 1 is what guarantees there is no LATER-slot dep to break
 *   the induction. So a never-started epic renders right of every started one
 *   with no synthetic dependency edge anywhere.
 *
 * DEGENERATE CASE, and it is the reason there is no second code path: with no
 * time axis supplied every step is UNKNOWN, so there is ONE slot, local depth is
 * global dependency depth and `col` is exactly the pre-#3201 depth column.
 *
 * @param {Object[]} rows                 PlanRows
 * @param {Map<number, Object>} byId
 * @param {(r: Object) => number[]} depsOf  in-set dependency ids
 * @param {?Object} timeAxis              planTimeAxis() output, or null
 * @returns {{colOf: Map<number, number>, maxCol: number,
 *            slotKeys: string[], slotOf: Map<number, number>,
 *            origins: number[], spans: number[]}}
 */
export function computeTimeColumns(rows, byId, depsOf, timeAxis) {
    const starts = (timeAxis && timeAxis.stepStarts) || new Map();
    const own = (r) => starts.get(r.id) || { at: null, kind: 'unknown' };

    // 1. Monotonize along the dep graph.
    const effMemo = new Map();
    const eff = (r) => {
        if (effMemo.has(r.id)) return effMemo.get(r.id);
        effMemo.set(r.id, own(r)); // cycle guard — a cycle keeps its own time
        let best = own(r);
        for (const d of depsOf(r)) {
            const up = eff(byId.get(d));
            if (timeCmp(up, best) > 0) best = up;
        }
        effMemo.set(r.id, best);
        return best;
    };
    const slotKeyOf = (r) => {
        const t = eff(r);
        if (t.kind === 'dated' && t.at) return slotOfDay(t.at);
        return t.kind === 'future' ? SLOT_FUTURE : SLOT_UNKNOWN;
    };
    // UNKNOWN GETS NO SLOT OF ITS OWN when any dated slot exists (review
    // finding). A dedicated leading slot put every UNKNOWN step one column
    // LEFT of all dated work — "earlier than everything", which is precisely
    // the claim UNKNOWN means we cannot make, and the opposite of this
    // module's own rule that topology alone should place it. Sharing the
    // EARLIEST dated slot gives it the weakest lower bound there is (that
    // slot's origin is 0), so its column comes from its dependencies and
    // nothing else. It keeps a slot of its own only when there is no dated
    // slot to share — otherwise it would fall into FUTURE, which is a claim
    // in the other direction.
    const rawKeys = new Set(rows.map(slotKeyOf));
    const hasUnknown = rawKeys.delete(SLOT_UNKNOWN);
    const slotKeys = [...rawKeys].sort();
    if (hasUnknown && (slotKeys.length === 0 || slotKeys[0] === SLOT_FUTURE)) {
        slotKeys.unshift(SLOT_UNKNOWN);
    }
    const slotIndex = new Map(slotKeys.map((k, i) => [k, i]));
    const slotFor = (r) => {
        const k = slotKeyOf(r);
        const i = slotIndex.get(k);
        return i === undefined ? 0 : i;   // UNKNOWN folded into the first slot
    };
    const slotOf = new Map(rows.map((r) => [r.id, slotFor(r)]));

    // 2. Local depth, counting only same-slot dependencies.
    const ldMemo = new Map();
    const slotIdx = (id) => {
        const i = slotOf.get(id);
        return i === undefined ? 0 : i;   // a caller's byId may exceed rows
    };
    const ld = (r) => {
        if (ldMemo.has(r.id)) return ldMemo.get(r.id);
        ldMemo.set(r.id, 0); // cycle guard
        const v = 1 + Math.max(-1, ...depsOf(r)
            .filter((d) => slotIdx(d) === slotIdx(r.id))
            .map((d) => ld(byId.get(d))));
        ldMemo.set(r.id, v);
        return v;
    };
    rows.forEach(ld);

    // 3. Slot spans and cumulative origins.
    const spans = slotKeys.map(() => 0);
    for (const r of rows) {
        const k = slotIdx(r.id);
        if (ldMemo.get(r.id) > spans[k]) spans[k] = ldMemo.get(r.id);
    }
    const origins = [];
    {
        let acc = 0;
        for (let k = 0; k < slotKeys.length; k++) { origins.push(acc); acc += spans[k] + 1; }
    }

    // 4. Columns — the time position, floored by topology.
    const colOf = new Map();
    const col = (r) => {
        if (colOf.has(r.id)) return colOf.get(r.id);
        colOf.set(r.id, 0); // cycle guard — a cycle collapses toward column 0
        const v = Math.max(origins[slotIdx(r.id)] + ldMemo.get(r.id),
            ...depsOf(r).map((d) => 1 + col(byId.get(d))));
        colOf.set(r.id, v);
        return v;
    };
    rows.forEach(col);
    const maxCol = Math.max(0, ...rows.map((r) => colOf.get(r.id)));
    return { colOf, maxCol, slotKeys, slotOf, origins, spans };
}

// ── The TIME RULER (req #3207) ─────────────────────────────────────────────
// #3201 made the columns a calendar and stopped there: `layout.slots` was
// exported and tested, and nothing drew it. The columns were ORDERED by time
// and a reader could not READ them as dates.
//
// Three marks, because each answers a different question and none of them is a
// restatement of another (the ONE FACT, ONE CHANNEL rule above):
//
//   · the STRIP says WHICH day a column is. Sticky to the viewport top since
//     req #3254 (`stickyRulerY`, below) — it used to be world text that
//     scrolled off when you panned down, which was the ORIGINAL reason it
//     could not be the only mark. Now pinned, it still is not the only mark:
//     a reader scrolled deep into one band has no strip-adjacent reference
//     for a column that is off past the right or left edge, which the
//     separators and future tint answer without moving.
//   · the SEPARATORS say WHERE a day begins. Full-height rules at slot origins,
//     readable at any vertical pan (deliberately NOT sticky — they mark
//     content, not chrome, so they stay world-space and scroll with it).
//   · the FUTURE TINT says where the not-yet-begun region starts. That boundary
//     is the single thing a plan is most often opened to find, and a rule alone
//     does not say which SIDE of it is the future.
//
// THE HEIGHT IS RESERVED UNCONDITIONALLY. Zoom is a pure transform on this
// surface (deviation 2) — no semantic level and no plan shape may change the
// geometry — so the strip costs `RULER_H` on every plan including the
// degenerate no-time-axis one, where the single slot is honestly labelled
// `undated` rather than the reservation being conditionally skipped.
export const RULER_H = 36;
const RULER_LABEL_Y = 12;
const RULER_LABEL_H = 15;
// px per mono char at font 13. Derived from the module's own ~0.61 px/pt mono
// metric (CHW_REQ 8.4/13.75, CHW_LABEL 10.05/16.5, CHW_EPIC 9.15/15 are all
// 0.609–0.611), not eyeballed separately — a ruler metric that drifted from the
// others would make the overlap contract narrower for this one class of text.
const CHW_SLOT = 7.93;
// The clear gap two consecutive ruler labels must leave. Drives the degradation
// pass below; a plan with more slots than room simply draws fewer labels.
// EXPORTED since req #3365: the renderer counter-scales the ruler's type to a
// fixed SCREEN size, which inflates each label's world width, so it has to
// re-apply this same thinning rule against the inflated widths. Exporting the
// constant is what stops that becoming a second copy of the number — the two
// passes are one rule applied to two widths, and a literal `10` in the
// component would drift from this one silently.
export const RULER_LABEL_GAP = 10;
const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Whole days between two ISO 'YYYY-MM-DD' strings. Parsed as UTC midnights on
// purpose: a slot key IS a calendar day with no time and no zone, and
// `new Date('2026-07-28')` in a browser west of UTC is the 27th locally — which
// would make a same-day pair read as a one-day gap.
const dayNumber = (iso) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
    if (!m) return null;
    return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 86400000;
};

/**
 * The text one ruler tick draws.
 *
 * `showYear` is decided by the CALLER, not by this function, because it is a
 * property of the SEQUENCE rather than of the date. `computeRuler` sets it on
 * the FIRST dated slot and on every slot whose year differs from its
 * predecessor — so a plan that never crosses a year reads
 * `Jul 21 '26, Jul 22, Jul 23…`: ONE anchored label, bare days after it.
 *
 * The anchor is not free — it costs the first tick ~40px, and on a tight ruler
 * that is enough to thin the tick beside it (measured: `Jul 22` on the timed
 * Substrate fixture). It is still the right trade. Two ambiguous `Jul 28`s a
 * year apart on one axis is the lie this exists to prevent, and an axis with
 * no year ANYWHERE is a date strip a reader cannot resolve at all — the year
 * has to be on the first tick to anchor the whole sequence, not only the half
 * that follows a boundary.
 */
export function slotTickText(slot, showYear = false) {
    if (!slot) return '';
    if (slot.kind === 'future') return 'future';
    if (slot.kind !== 'dated' || !slot.day) return 'undated';
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(slot.day);
    if (!m) return String(slot.day);
    const base = `${MONTH_ABBR[Number(m[2]) - 1] || m[2]} ${Number(m[3])}`;
    return showYear ? `${base} '${m[1].slice(2)}` : base;
}

/**
 * Turn the ordered slots into drawable ruler geometry.
 *
 * PURE, and separated from `computePlanLayout` so the degradation rule is
 * testable on a synthetic 200-slot axis without building a 200-column plan.
 *
 * @param {Object[]} slots   `layout.slots` shape — {key, kind, day, origin}
 * @param {number[]} colX    column centres
 * @param {number[]} colW    column widths
 * @param {number} totalW    world width
 * @returns {{h: number, slots: Object[], futureX: ?number}}
 */
export function computeRuler(slots, colX, colW, totalW) {
    const out = [];
    let prevDay = null;
    let prevYear = null;
    for (let i = 0; i < slots.length; i++) {
        const s = slots[i];
        const d = colX[s.origin] === undefined
            ? 0 : colX[s.origin] - colW[s.origin] / 2;
        // The slot's right edge is where the NEXT slot begins — not the right
        // edge of its own last column. Columns between two origins belong to
        // this slot (that is what `origin` means), so bounding by the origin
        // column alone would draw a day one column wide on a day that ran five.
        const next = slots[i + 1];
        const nx = next && colX[next.origin] !== undefined
            ? colX[next.origin] - colW[next.origin] / 2
            : Math.max(d, totalW - RIGHT);
        const dn = s.kind === 'dated' ? dayNumber(s.day) : null;
        const year = s.kind === 'dated' && s.day ? s.day.slice(0, 4) : null;
        out.push({
            key: s.key, kind: s.kind, day: s.day, origin: s.origin,
            x: d, w: Math.max(0, nx - d),
            // Sparse in TIME though dense in COLUMNS: 07-28 and 07-31 are
            // adjacent slots two days apart. `gapDays` is that distance, and the
            // renderer draws a gapped boundary DASHED — the dashes are the gap.
            // null on a non-dated slot and on the first dated one: there is no
            // predecessor to measure from, and 0 would claim there was.
            gapDays: (dn != null && prevDay != null) ? dn - prevDay : null,
            label: slotTickText(s, year != null && year !== prevYear),
            showLabel: true,
        });
        if (dn != null) prevDay = dn;
        if (year != null) prevYear = year;
    }
    // The drawn rect, decided HERE and not by the renderer, because the
    // degradation pass below has to thin the boxes that actually get drawn. The
    // last tick is clamped off the right edge of the world it is measured
    // against; clamping in the caller instead would move a box the pass had
    // already cleared, which is how a "checked" invariant stops being one.
    for (const r of out) {
        r.labelW = r.label.length * CHW_SLOT;
        r.labelX = Math.max(0, Math.min(r.x + 4, totalW - RIGHT - r.labelW));
    }
    // ── Degradation, measured rather than counted ───────────────────────────
    // "Every Nth day" is the obvious rule and it is the wrong one here: columns
    // have VARIABLE widths (a column is as wide as the widest thing drawn in
    // it), so a fixed stride drops a label in front of 300px of empty ruler and
    // keeps two that collide. A greedy left-to-right pass against the actual
    // rects degrades exactly as much as the room requires and no more.
    let lastRight = -Infinity;
    for (const r of out) {
        if (r.labelX < lastRight + RULER_LABEL_GAP) { r.showLabel = false; continue; }
        r.showLabel = true;
        lastRight = r.labelX + r.labelW;
    }
    // The FUTURE tick is forced back on if the pass dropped it. It is the one
    // boundary a plan is opened to find, so it outranks whatever dated label
    // happens to precede it — that label is displaced, not shrunk. Safe to do
    // after the pass because FUTURE always sorts last (SLOT_FUTURE is '2:'), so
    // nothing downstream of it needs re-thinning.
    const fut = out.length > 0 && out[out.length - 1].kind === 'future'
        ? out[out.length - 1] : null;
    if (fut && !fut.showLabel) {
        fut.showLabel = true;
        for (const r of out) {
            if (r === fut || !r.showLabel) continue;
            if (r.labelX < fut.labelX + fut.labelW + RULER_LABEL_GAP
                && fut.labelX < r.labelX + r.labelW + RULER_LABEL_GAP) {
                r.showLabel = false;
            }
        }
    }
    return {
        h: RULER_H,
        slots: out,
        futureX: fut ? fut.x : null,
    };
}

// ── The sticky ruler pin (req #3254) ────────────────────────────────────────
// The ruler used to be plain world content — baseline, ticks and slot labels
// all sat at world y ∈ [0, RULER_H], "attached to the top item in the stack"
// (the requirement's own words) — so panning down scrolled it away with the
// rest of the plan and left nothing on screen naming which column is which
// day. `stickyRulerY` is the SAME pin primitive `computeDayHeaders`
// (`dayHeaderLayout.js`) and the sticky prev/next epic chips above
// (`placeEpicChips`) both use — draw at the natural screen position until it
// scrolls past the viewport edge, then clamp flush to it — simplified to the
// one-strip case: there is exactly one ruler, so nothing pushes it and it
// never drops behind (it is a standing fact about the whole plan, not a
// per-row banner that can be superseded). Only the Y anchor decouples from
// vertical pan; X is untouched, so slot ticks and labels still pan and zoom
// with the columns beneath them.
export function stickyRulerY(t) {
    const ty = (t && typeof t.y === 'number') ? t.y : 0;
    return Math.max(0, ty);
}

// ── THE STRIP IS SCREEN-SIZED VERTICALLY (req #3365) ───────────────────────
// The counter-scale the renderer applies to the strip's own geometry, and the
// ONE place the number is derived. `rulerLabelMag` in the visualizer was the
// first user of it (the date TYPE, which req #3365 pinned to a fixed screen
// size); this is now also what the strip's PLATE, baseline and ticks are
// multiplied by, so the whole strip is one object at one size instead of type
// floating over a plate a fifth of its height.
//
// CLAMPED AT 1, so it only ever makes the strip BIGGER than the world would.
// Past k = 1 the world scale already exceeds the screen size wanted and
// dividing would start SHRINKING the strip below `RULER_H` — the opposite of
// the point, and a second extreme in place of the one being removed. So the
// strip's SCREEN height is `RULER_H · max(k, 1)`: constant below k = 1, and
// identical to the old world-scaled behaviour at and above it.
export function rulerScreenMag(t) {
    const k = (t && typeof t.k === 'number' && t.k > 0) ? t.k : 1;
    return Math.max(1, 1 / k);
}

// The pinned strip's bottom edge in SCREEN space — req #3254's contract with
// req #3257 (the concurrent epic-name work): "the date header owns the
// topmost strip and the epic names stop just below it" needs ONE readable
// number, not a guessed pixel offset. A caller reading the SAME transform gets
// the exact edge the ruler is drawn at, pinned or not.
//
// It used to be `stickyRulerY(t) + rulerH · k` — the strip as pure world
// content, growing and shrinking with zoom (deviation 2). Since req #3365 the
// strip's vertical axis is SCREEN space, so the `· k` is multiplied by
// `rulerScreenMag(t)` and collapses to `max(k, 1)`. Above k = 1 nothing about
// this number changed; below it, it stops reporting a 7px strip that is
// actually 36px tall and letting the epic names park inside it.
export function rulerScreenBottom(t, rulerH = RULER_H) {
    const k = (t && typeof t.k === 'number' && t.k > 0) ? t.k : 1;
    return stickyRulerY(t) + rulerH * k * rulerScreenMag(t);
}

const truncate = (s, n) => {
    const str = String(s == null ? '' : s);
    return str.length > n ? `${str.slice(0, n - 1)}…` : str;
};

// The text drawn in the card's TITLE AREA (req #3498 — it was above the bead
// until the step became a card). NO '#' anywhere — ids render bare (production
// directive), titles render verbatim (stored plan content).
//
// The default ceiling is the CARD's own text column rather than a hand-set
// `STEP_LABEL_MAX`: one width, measured where it is drawn, so there is no cap
// left to drift out of step with the room.
export function stepLabelText(row, stepLabel,
    maxChars = cardChars(CHW_LABEL, CARD_CHECK_W + CARD_STEP_LINK_W + CARD_BADGE_W + CARD_BADGE_GAP)) {
    return stepLabel === 'title'
        ? truncate(row.title || `step ${row.id}`, Math.max(4, maxChars))
        : String(row.id);
}

// ── Requirement labels: the id, or the requirement's TITLE (user directive
//    2026-08-01, "option to display the title of the requirement (35 chars)") ──
//
// THE TITLE JOIN IS AN ARGUMENT, NOT A ROW FIELD, and that is a decision worth
// stating. The alternative — putting `reqTitles` on the engine's PlanRows — would
// put DISPLAY data on the structure `pipelineModel.js` produces, and since req
// #3184 that structure has a SECOND implementation (`pipeline_derive.py`) kept
// honest by a shared conformance corpus. A field only the browser draws would
// have to be either mirrored into Python for nothing or excluded by hand from
// every comparison; both are the "speculative code in a second implementation"
// that document explicitly refuses. A lookup passed in as an option keeps the
// engine's shape untouched, keeps this module pure (a Map is data, not a fetch),
// and stays testable without a component.
//
// Accepts a Map (what the component already has as `reqInfo`) or a plain object.
const titleLookup = (reqTitles, reqId) => {
    if (!reqTitles) return '';
    if (typeof reqTitles.get === 'function') return reqTitles.get(reqId) || '';
    // `Object.hasOwn`, the house rule: a plain-object lookup for a key like
    // 'constructor' returns an inherited function, and `String(fn)` would draw a
    // function body onto the canvas.
    return Object.hasOwn(reqTitles, reqId) ? String(reqTitles[reqId] || '') : '';
};

/**
 * The text drawn for ONE requirement under a bead.
 *
 * `maxChars` is the room the COLUMN actually has — the geometry is frozen, so
 * the text is fitted to the column rather than the column to the text. A
 * requirement with no resolvable title falls back to its ID rather than to
 * nothing: a blank slot under a bead reads as a rendering fault, and the id is
 * always true.
 */
export function reqLabelText(reqId, { reqLabel = 'id', reqTitles = null,
    maxChars = cardChars(CHW_REQ) } = {}) {
    if (reqLabel !== 'title') return String(reqId);
    const t = titleLookup(reqTitles, reqId);
    // The id rides ALONGSIDE the title, not instead of it (user directive) — an
    // id-only mark reading "3242" gives no hint what's under it without a
    // hover; "3242 - Pipeline Visualizer Polish" answers that at the same L3
    // glance the title itself was added for. Built BEFORE truncation, same as
    // the bare id below, so the id survives the cut and the title is what
    // gives way on a tight column — the id is the one piece of this string a
    // reader can always resolve to the actual requirement.
    return t ? truncate(`${reqId} - ${t}`, Math.max(4, maxChars))
        : String(reqId);
}

const reqStr = (row) => (row.reqIds || []).join(' ');

// ── Epic band label text (req #3225) ─────────────────────────────────────
//
// THE COUNT SUFFIX IS AN ARGUMENT, NOT A ROW FIELD — the same reasoning as
// `reqTitles` above: `epicCounts` is display data, and the engine's PlanRows
// stay untouched by it. Unlike `reqTitles` though, this is measured into the
// band's own label rectangle rather than a per-requirement mark, because the
// zero-overlap contract is asserted over `layout.labels` and a count drawn
// beside the name in a second rectangle would not be covered by it — exactly
// the failure the requirement calls out by name.
//
// Absent for the "No epic" band (epicId null): a bead with no epic has no
// requirement set to count against, and a stray "0/0" would claim an answer
// that does not exist. Absent equally when `epicCounts` carries no entry for
// a real epic — a truncated or stale counts map degrades to the plain name
// rather than a wrong number.
//
// @param {?number} epicId
// @param {string} epicName
// @param {?(Map|Object)} epicCounts  epicId -> {met, total}, or null/undefined
//                                    to leave every band's plain name alone
// @returns {string}
function epicBandLabelText(epicId, epicName, epicCounts) {
    if (!epicCounts || epicId == null) return epicName;
    const counts = typeof epicCounts.get === 'function'
        ? epicCounts.get(epicId)
        : (Object.hasOwn(epicCounts, epicId) ? epicCounts[epicId] : null);
    return counts ? `${epicName} ${counts.met}/${counts.total}` : epicName;
}

/**
 * Compute the full Plan-mode layout.
 *
 * @param {Object[]} rows      engine PlanRows, DISPLAY order (steps sort within
 *                             a band by column, so pass displayOrder output)
 * @param {Object} [opts]      NOTE: this was the THIRD parameter until req
 *                             #3371 removed the launch-grouping argument
 *                             between the two. A caller that still passes an
 *                             array here silently loses its options, so the
 *                             guard below refuses one loudly instead.
 * @param {('id'|'title')} [opts.reqLabel]   what a requirement ROW inside the
 *                             card says. `reqLayout` and `stepWidth` left with
 *                             req #3498 — a card stacks its requirements and is
 *                             a fixed width, so neither had anything to select.
 * @param {(Map|Object)} [opts.reqTitles]    requirement id -> title, for 'title'
 * @param {('id'|'title')} [opts.stepLabel]  what the card's TITLE AREA says
 * @param {?Object} [opts.timeAxis]  planTimeAxis() output (req #3201). Omitted,
 *                             the axis degenerates to pure dependency depth and
 *                             bands stack by `epics.sort_order` (req #3430),
 *                             then epic id — see computeTimeColumns.
 * @param {?(Map|Object)} [opts.epicCounts]  req #3225 — epicId -> {met, total}.
 *                             Null/omitted (the toggle-off state) leaves every
 *                             band's label exactly as it reads today.
 * @param {?Object} [opts.pauseInfo]  req #3226 — `pauseState()`'s
 *                             `{pipelinePaused, pausedEpicIds}`. Null/omitted
 *                             leaves every band unpaused, matching a caller
 *                             (a test, a hand-built probe) with no pause
 *                             concept at all.
 * @returns {Object} layout — see the shape assembled at the bottom
 */
export function computePlanLayout(rows, opts = {}) {
    // THE ONE PIECE OF DEFENSIVE CODE IN THIS MODULE, and it earns its place.
    // This function took a middle argument — the engine's launch groupings —
    // through nine requirements and ~100 call sites, and req #3371 deleted it.
    // A stale caller does not fail: it hands that array in as `opts`, every
    // option falls back to its default, and the plan renders CORRECTLY but in
    // the wrong requirement layout, with the wrong step width and no time axis.
    // That is the failure mode a silent argument shift always has — plausible
    // output, no error, no test to catch it. Refusing an array here turns it
    // into a stack trace at the call site.
    if (Array.isArray(opts)) {
        throw new TypeError(
            'computePlanLayout(rows, opts): the launch-grouping argument was '
            + 'removed (req #3371). Drop the second argument from this call.');
    }
    const {
        stepLabel = 'id',
        reqLabel = 'id', reqTitles = null, timeAxis = null, epicCounts = null,
        pauseInfo = null,
        // req #3503 — "Step Width". A relayout, deliberately: the ladder's own
        // four rungs (`STEP_WIDTH_SCALES`) are the only legal values, and the
        // caller is what turns an out-of-range number into the default rather
        // than this module guessing which rung was meant.
        stepWidthLevel = DEFAULT_STEP_WIDTH_LEVEL,
    } = opts || {};
    const widthScale = STEP_WIDTH_SCALES[stepWidthLevel - 1] ?? 1;
    const { cardW, cardFrameW, cardTextW } = cardGeometryFor(widthScale);
    const safeRows = Array.isArray(rows) ? rows : [];
    if (safeRows.length === 0) {
        return {
            width: MIN_WORLD_W, height: 120, bands: [], nodes: new Map(),
            arcs: [], labels: [], colW: [], colX: [],
            slots: [], slotOf: new Map(),
            // An INERT ruler, not a missing one: `layout.ruler.h` is the
            // reservation and every consumer reads it unconditionally, so an
            // absent key here would be the one shape that makes the renderer
            // need a null check the other path never exercises.
            ruler: { h: RULER_H, slots: [], futureX: null },
            stepLabel, reqLabel, empty: true,
        };
    }

    const byId = new Map(safeRows.map((r) => [r.id, r]));
    const depsOf = (r) => (r.depIds || []).filter((d) => byId.has(d));

    // ── Time-slot columns, floored by dependency depth (req #3201) ──────────
    const { colOf, maxCol, slotKeys, slotOf, origins: slotOrigins } =
        computeTimeColumns(safeRows, byId, depsOf, timeAxis);

    // ── EVERY ROW'S TEXT, WRAPPED, DERIVED ONCE (req #3498) ─────────────────
    // The card's HEIGHT depends on how many LINES its requirements take, and the
    // lane sweep, the node boxes and the label emission all need the same
    // answer. Computing it three times from the same inputs is the shape that
    // lets a card's box and its contents disagree, so it is computed here and
    // read everywhere.
    //
    // IT IS RESERVED AT EVERY LEVEL AND DRAWN ONLY AT L3, which is the module's
    // oldest invariant applied to the new line: the level also decides whether
    // the card is painted at all, so a geometry that changed with it would move
    // every card on the plan as the reader zoomed. At L2 the row shows the bare
    // id on the first of its reserved lines and the second sits empty — the same
    // trade the old reserved title slot made, for the same reason.
    const reqRowMax = cardChars(CHW_REQ, 0, cardTextW);
    const rowLinesOf = new Map();      // step id -> [[line, line?], …]
    for (const r of safeRows) {
        const ids = r.reqIds || [];
        rowLinesOf.set(r.id, ids.map((reqId) => wrapReqText(
            reqLabelText(reqId, {
                reqLabel, reqTitles, maxChars: reqRowMax * REQ_MAX_LINES,
            }), reqRowMax)));
    }
    const reqBlockOf = (r) => reqBlockHeight(rowLinesOf.get(r.id) || []);
    // The card's TITLE AREA, wrapped by the same rule and reserved the same way.
    // `stepLabelText` is asked for the whole name (the budget times the line
    // count) and `wrapReqText` breaks it; a short name still returns one line,
    // so only the cards that need the room pay for it.
    const nameBudget = cardChars(CHW_LABEL,
        CARD_CHECK_W + CARD_STEP_LINK_W + CARD_BADGE_W + CARD_BADGE_GAP, cardTextW);
    const nameLinesOf = new Map();
    for (const r of safeRows) {
        nameLinesOf.set(r.id, wrapReqText(
            stepLabelText(r, stepLabel, nameBudget * NAME_MAX_LINES),
            nameBudget, NAME_MAX_LINES));
    }
    const nameLineCount = (r) => (nameLinesOf.get(r.id) || ['']).length;

    // ── Column widths: UNIFORM, AT THE CARD (req #3498) ─────────────────────
    // Every column is one card wide plus the gutter, and that is the whole rule.
    //
    // It used to be "as wide as the widest thing DRAWN in it", which is why this
    // block measured requirement-id strings and step labels and then multiplied
    // the result by the S/M/L width factor. Content-sized columns are what made
    // the world 5800px wide on the live plan, and they are what the stagger
    // existed to claw room back from. The user's directive replaces the whole
    // negotiation with a number — *"we need a fixed width... make the card at
    // req# plus 40 chars wide"* — so a long requirement title now costs VERTICAL
    // room inside its card instead of pushing every card in its column sideways.
    //
    // `colSteps` survives: the lane sweep below still needs to know which steps
    // share a column, it just no longer asks them how wide they are.
    const colSteps = [];
    for (const r of safeRows) {
        const d = colOf.get(r.id);
        (colSteps[d] ||= []).push(r);
    }
    const COL_W = cardW + CARD_GAP_X;
    const colW = [];
    for (let d = 0; d <= maxCol; d++) colW.push(COL_W);

    const colX = [];
    {
        let acc = LEFT;
        for (let d = 0; d <= maxCol; d++) {
            colX.push(acc + colW[d] / 2);
            acc += colW[d];
        }
    }
    const totalW = Math.max(MIN_WORLD_W, colX[maxCol] + colW[maxCol] / 2 + RIGHT + 40);

    // ── The time ruler (req #3207) ──────────────────────────────────────────
    // Built HERE, before the bands, because its height is what the first band's
    // y is offset by. The slot descriptors are the same objects `layout.slots`
    // exports — one derivation, not two, so the drawn ruler and the tested axis
    // can never disagree about where a day begins.
    const slots = slotKeys.map((key, i) => ({
        key,
        kind: key === SLOT_UNKNOWN ? 'unknown' : key === SLOT_FUTURE ? 'future' : 'dated',
        day: key === SLOT_UNKNOWN || key === SLOT_FUTURE ? null : key.slice(2),
        origin: slotOrigins[i],
    }));
    const ruler = computeRuler(slots, colX, colW, totalW);

    // ── Epic bands (dominant label), stacked by `epics.sort_order` (req #3430),
    //    then by DERIVED START (req #3201) for the epics nobody has ordered ────
    //
    // **THE USER'S ORDER WINS.** `epics.sort_order` is the AUTHORITATIVE epic
    // display order (user ruling, 2026-08-09), and THIS is the surface that
    // ruling was about: the band stack is what a person looking at the Pipeline
    // Visualizer reads as "the order of the epics". An epic carrying a
    // `sort_order` is placed by it and by nothing else — derived start does not
    // get a vote, because a rule that sometimes overrides the order the user
    // typed is a rule the user cannot use.
    //
    // Everything below is the FALLBACK, unchanged, for epics whose `sort_order`
    // is NULL: an unordered plan stacks exactly as it did before req #3430, and
    // an ordered epic always sits above an unordered one.
    //
    // The vertical axis reads as time too: the epic whose work began first sits
    // on top. An epic's start is the minimum over its requirements — there is no
    // `epics.started_at` and design rule 1 says there never will be — and
    // `pipelinePlanTime.js` owns the derivation, including the ruling that a
    // requirement which completed without ever being stamped `started_at`
    // counts as started.
    //
    // THREE TIERS, then tie-breaks, stated rather than left to sort stability:
    //   1. `dated`   — sort ascending on the derived start;
    //   2. `unknown` — no start, but evidence of work whose timing was never
    //                  recorded. A NULL start alone used to mean both this and
    //                  tier 3, which let a pure BACKLOG epic stack above an
    //                  ACTIVE one on an id tie-break (review finding);
    //   3. `future`  — every step positively has not begun. Sorts LAST.
    // Within a tier: EPIC ID ascending, the label-less "No epic" band last of
    // all. Id rather than first appearance on purpose — first appearance moved
    // a band down the stack whenever a step was appended to another epic, a
    // documented wart of the old rule, and it carried no time meaning.
    const bandStarts = (timeAxis && timeAxis.bandStarts) || new Map();
    const bandKinds = (timeAxis && timeAxis.bandKinds) || new Map();
    const BAND_TIER = { dated: 0, unknown: 1, future: 2 };
    const bandTierOf = (key) => {
        const t = BAND_TIER[bandKinds.get(key)];
        return t === undefined ? BAND_TIER.future : t;
    };
    // req #3226 — a band is PAUSED when the whole plan is paused (every band
    // suppressed alike, "No epic" included — pause is a plan-wide fact there
    // too) OR when this band's OWN epic is paused. Resolved once, here, rather
    // than at render time in every consumer of `band`, the same reasoning
    // `bandStartOf` below is memoized for.
    const pausedEpicIdSet = new Set(pauseInfo?.pausedEpicIds || []);
    const planPaused = !!pauseInfo?.pipelinePaused;
    const bandPausedOf = (key) => planPaused || (key != null && pausedEpicIdSet.has(key));

    // req #3372 (2026-08-10) — the requirement asked for the "No epic" band
    // (the `key == null` case throughout this file) to be deleted outright,
    // on the premise that `epic_fk` is a NOT NULL column upstream by the time
    // a row reaches this module. MEASURED WRONG the same day: req #3462
    // reverted req #3381's cutover of the browser onto the 2.0 composed read
    // (a production outage — no 1.0<->2.0 pipeline id mapping exists), so
    // `computePlanLayout`'s only live caller — `PipelinePlanVisualizer.jsx`,
    // mounted by `PipelineDetail.jsx` via `pipelineDetailModes.js`, fed by
    // `pipelineModel.js`'s dominant-epic tally + label inheritance — can
    // still hand this module a row with `epicId == null`. Deleting the
    // branch here would misrender or throw on that still-reachable case, so
    // it is kept — see `pipelinePlanLayout.test.js` "a band is a plain
    // column read" for the fixture proving it is exercised on purpose, not
    // defensively. This module's own job is unaffected either way: it never
    // re-tallies an epic itself, it only reads `row.epicId` as handed to it.
    const bandKeys = [];
    const bandByKey = new Map();
    // req #3430 — epic id -> `epics.sort_order`, or null for UNORDERED. Taken
    // from the row, which `pipelineModel.js::buildPlanRows` resolved from the
    // one epics dictionary; this module never re-reads the table, so there is
    // no second answer to keep in step. Every row of one band carries the same
    // value (it is a property of the epic), so first-writer-wins is not a
    // choice between candidates.
    const bandSortOrders = new Map();
    for (const r of safeRows) {
        const key = r.epicId != null ? r.epicId : null;
        if (!bandByKey.has(key)) {
            const epic = r.epic || 'No epic';
            bandSortOrders.set(key, key != null && Number.isFinite(r.epicSortOrder)
                ? r.epicSortOrder : null);
            bandByKey.set(key, {
                key, epicId: key, epic,
                // req #3225 — the SAME string measures the zero-overlap label
                // rect and the floating chip; see the helper's own comment.
                epicLabel: epicBandLabelText(key, epic, epicCounts),
                paused: bandPausedOf(key),
                steps: [],
            });
            bandKeys.push(key);
        }
        bandByKey.get(key).steps.push(r);
    }
    const bandStartOf = (key) => {
        const v = bandStarts.get(key);
        return v == null ? null : String(v);
    };
    bandKeys.sort((a, b) => {
        // req #3430 — the user's order, ahead of everything derived. NULL is
        // UNORDERED, not zeroth: it sorts after every ordered epic and then
        // falls through to the req #3201 tiers below, so the "No epic" band
        // (which can never carry a `sort_order`) stays last of all exactly as
        // it was. Equal values fall through too rather than tie arbitrarily.
        const oa = bandSortOrders.get(a);
        const ob = bandSortOrders.get(b);
        if ((oa == null) !== (ob == null)) return oa == null ? 1 : -1;
        if (oa != null && oa !== ob) return oa - ob;
        const ta = bandTierOf(a);
        const tb = bandTierOf(b);
        if (ta !== tb) return ta - tb;
        const sa = bandStartOf(a);
        const sb = bandStartOf(b);
        if ((sa === null) !== (sb === null)) return sa === null ? 1 : -1;
        if (sa !== null && sa !== sb) return sa < sb ? -1 : 1;
        if (a === b) return 0;
        if (a === null) return 1;
        if (b === null) return -1;
        return a < b ? -1 : 1;
    });
    // Colour AFTER the sort: the palette cycles on the band's position in the
    // stack, so assigning at discovery time would hand two adjacent bands the
    // same hue once the order stopped being discovery order.
    // THE PALETTE IS THE THEME'S (req #3365). `planPalette` resolves an unknown
    // or absent key to the default, so a caller that passes nothing gets exactly
    // the colours this module documented before themes existed.
    const epicPalette = planPalette(opts.palette).epic;
    bandKeys.forEach((key, i) => {
        bandByKey.get(key).color = epicPalette[i % epicPalette.length];
    });

    // ── Chain-aware lanes with cross-column reservation ─────────────────────
    // Steps place in ascending depth order, so by the time a step chooses a
    // lane every shallower column is FINAL — checking the arc's intermediate
    // cells at inheritance time is complete, not heuristic. (The POC reserved
    // cells only after placement, which the ascending order made unreachable:
    // an arc could still run straight through an unrelated bead placed earlier
    // at an intermediate depth. Found in code review; fixed by checking the
    // corridor BEFORE inheriting — a blocked corridor falls back to a fresh
    // lane, turning the arc curved instead of driving it through a bead.)
    // Transitive dependency closure — corridor cells occupied by an IN-CHAIN
    // bead (a transitive dependent of the arc's tail and dependency of its
    // head, e.g. 13 on the 12→14 arc where 14 gates on both) are legitimate:
    // the chain reads as one line through its own members. Only unrelated
    // occupants and foreign reservations block a corridor.
    const reachMemo = new Map();
    const reach = (id) => {
        if (reachMemo.has(id)) return reachMemo.get(id);
        const out = new Set();
        reachMemo.set(id, out); // cycle guard
        const row = byId.get(id);
        for (const d of (row ? depsOf(row) : [])) {
            out.add(d);
            for (const dd of reach(d)) out.add(dd);
        }
        return out;
    };

    const laneById = new Map();
    const bands = [];
    const bandUsed = [];       // bandIndex -> the band's cell map (kept for arc routing)
    const RESERVED = Symbol('reserved');
    for (const key of bandKeys) {
        const band = bandByKey.get(key);
        // COLUMN-MAJOR, and that is now the whole sort (req #3371). Two further
        // keys used to follow it — grouped steps ahead of ungrouped ones, then
        // by the group's letter — so a launch unit's members were adjacent
        // inside a column and its dashed rectangle could enclose exactly them.
        // With no rectangle there is nothing to keep adjacent, and a tie-break
        // that orders nothing only makes the placement harder to reason about.
        const steps = [...band.steps].sort((a, b) =>
            (colOf.get(a.id) - colOf.get(b.id)));
        const used = new Map(); // depth -> Map(lane -> step id | RESERVED)
        const laneBeads = new Map(); // lane -> [{id, d}] — real beads only
        // Every lane this band has ASSIGNED, whether or not the cell was free
        // when the bead got there. `laneBeads` cannot answer that question —
        // see the dep-adjacent insertion path below (req #3229).
        const lanesUsed = new Set();
        const take = (d, lane, occupant) => {
            if (!used.has(d)) used.set(d, new Map());
            const cells = used.get(d);
            if (!cells.has(lane)) {
                cells.set(lane, occupant);
                if (occupant !== RESERVED) {
                    if (!laneBeads.has(lane)) laneBeads.set(lane, []);
                    laneBeads.get(lane).push({ id: occupant, d });
                }
            }
        };
        const occupant = (d, lane) =>
            (used.has(d) ? used.get(d).get(lane) : undefined);
        const free = (d, lane) => occupant(d, lane) === undefined;
        const corridorOk = (a, r, lane) => {
            for (let dd = colOf.get(a.id) + 1; dd < colOf.get(r.id); dd++) {
                const o = occupant(dd, lane);
                if (o === undefined) continue;
                if (o === RESERVED) return false;
                if (!(reach(o).has(a.id) && reach(r.id).has(o))) return false;
            }
            return true;
        };
        const sameEpicDepsOf = (r) => depsOf(r).map((x) => byId.get(x))
            .filter((a) => (a.epicId != null ? a.epicId : null) === key);
        // Same-band dependents, for the corridor-aware placement check below.
        const dependentsInBand = new Map(); // id -> [dependent ids]
        for (const r of steps) {
            for (const a of sameEpicDepsOf(r)) {
                if (!dependentsInBand.has(a.id)) dependentsInBand.set(a.id, []);
                dependentsInBand.get(a.id).push(r.id);
            }
        }
        // A lane is usable only if (1) the cell is free, (2) every same-lane
        // dependency arc into it crosses only in-chain beads, and (3) — the
        // corridor-aware rule (user directive, epic #6 plan) — no shallower
        // bead already on the lane still owes an arc PAST this column to a
        // deeper same-band dependent: parking here would sit this bead on that
        // arc's horizontal run (the 50-under-49 spaghetti). Exempt when the
        // shallower bead is one of r's own deps (r continues that chain — the
        // arc anchors elsewhere or reroutes) or when r is in-chain between the
        // two ends.
        //
        // A FOURTH CHECK LEFT WITH THE LAUNCH GROUPING (req #3371): a lane
        // strictly inside ANOTHER launch unit's contiguous lane run was refused,
        // so the dashed rectangle drawn around a run could never enclose a
        // foreign bead. There are no runs and no rectangles now, so that clause
        // has no subject — and the one invariant it shared with the rest of this
        // predicate, *no two beads on one `(band, column, lane)` cell*, is check
        // (1) and is untouched.
        const laneOk = (r, d, lane) => {
            if (!free(d, lane)) return false;
            for (const a of sameEpicDepsOf(r)) {
                const al = laneById.get(a.id);
                if (al === lane && !corridorOk(a, r, lane)) {
                    return false;
                }
                // Cross-lane dep: the arc will need EITHER its source-lane
                // corridor (late bend) or this candidate lane's corridor
                // (early bend). If both are already blocked, any drawing of
                // the arc runs over an unrelated bead — reject the lane and
                // let dep-adjacent insertion open a clean one. (Found live:
                // a two-dep step parked where one dep's arc had no clear
                // corridor on either lane and overdrew two beads.)
                if (al !== undefined && al !== lane
                    && !corridorOk(a, r, al) && !corridorOk(a, r, lane)) {
                    return false;
                }
            }
            const rDeps = new Set(depsOf(r));
            for (const { id: sid, d: ds } of laneBeads.get(lane) || []) {
                if (ds >= d || rDeps.has(sid)) continue;
                for (const tid of dependentsInBand.get(sid) || []) {
                    if (tid === r.id) continue;
                    if (colOf.get(tid) <= d) continue;
                    if (reach(r.id).has(sid) && reach(tid).has(r.id)) continue;
                    return false;
                }
            }
            return true;
        };
        // ONE LANE RULE FOR EVERY STEP (req #3371). Until the launch grouping
        // left there were two: a launch-unit member took the next lane of a
        // CONTIGUOUS RUN allocated when its first mate placed, and everything
        // else took the rule below. That run existed to keep a dashed rectangle
        // around exactly its own members, and keeping it honest took five
        // functions, two invariants and a 400-plan fuzz corpus (req
        // #3229/#3256). With no rectangle there is nothing to keep contiguous,
        // so the whole allocator is gone and the enclosure invariant it
        // protected has no subject. THE OTHER INVARIANT — no two beads on one
        // `(band, column, lane)` cell — is the oldest rule on this surface,
        // survives unchanged, and is still swept over the same fuzz corpus: the
        // run is what used to VIOLATE it, never what established it.
        for (const r of steps) {
            const d = colOf.get(r.id);
            let lane = null;
            for (const a of sameEpicDepsOf(r)) {
                const al = laneById.get(a.id);
                if (al !== undefined && laneOk(r, d, al)) { lane = al; break; }
            }
            if (lane === null) {
                // Dep-adjacent lane INSERTION (user directive, epic #6 plan
                // image review): when every anchored lane is occupied or
                // corridor-blocked, a branch step opens a FRESH lane
                // directly below its parent instead of scanning downward
                // past every reserved corridor — the scan banished the
                // branch below unrelated roots and its dependency arc then
                // dove across all of their outgoing corridors. Lanes are
                // fractional during placement (0.5 sits between 0 and 1)
                // and renumbered ordinally at band close, so a fresh value
                // carries no cells, no corridors, and always places.
                //
                // "FRESH" IS DECIDED AGAINST `lanesUsed`, NOT `laneBeads`
                // (req #3229) — and this one is LATENT: no plan in the fuzz
                // corpus reaches it, so it is hardening rather than a
                // measured repro.
                // Kept because it is what makes the paragraph above TRUE as
                // written. `laneBeads` is populated by `take()`, which is a
                // deliberate no-op on an occupied cell, so a bead that
                // landed on an already-taken cell is ABSENT from it — a
                // later `below` scan steps over that lane and `al + 1`
                // resolves onto something that is anything but fresh. (That
                // is the mechanism req #3229 was filed against; measuring it
                // REFUTED it as this defect's cause, and left it standing as
                // a way the invariant could break next.) `lanesUsed` records
                // every lane this band has ASSIGNED, however the bead got
                // there, so `al + 1` is fresh only when nothing sits above
                // `al` at all, and otherwise the midpoint falls strictly
                // between two used values with nothing in between.
                //
                // This is the ONE path that bypasses `laneOk`. It used to
                // have a second obligation for that reason — honour every
                // published launch-unit lane run and re-anchor below one it
                // landed inside — and req #3371 removed those runs, so the
                // midpoint is simply taken.
                const anchors = sameEpicDepsOf(r)
                    .map((a) => laneById.get(a.id))
                    .filter((v) => v !== undefined);
                if (anchors.length > 0) {
                    const al = Math.min(...anchors);
                    // ── RE-USE BEFORE YOU INSERT (req #3498) ────────────────
                    // THIS IS THE VERTICAL COMPRESSION THE REQUIREMENT ASKED
                    // FOR, and until now a branch never got it. A step that
                    // could not inherit one of its dependencies' lanes went
                    // straight to the insertion below and opened a BRAND NEW
                    // lane — every time, whether or not a lane this band had
                    // already opened was standing empty at that column.
                    //
                    // MEASURED on live plan 7's "First Principles Pipeline":
                    // **17 lanes for work that never puts more than 5 steps in
                    // one column**, six of those lanes holding a single card
                    // and still taking their full height across all 40 columns.
                    // The band was 2,827px tall.
                    //
                    // The requirement's own words are *"over time there is an
                    // ability to re-use swim lanes making the parallel threads
                    // of epics to have better vertical compression"* — a lane
                    // whose chain has finished is free for a later one, exactly
                    // as the Build Visualizer packs its branches.
                    //
                    // NEAREST TO THE PARENT FIRST, which is the other half of
                    // the same sentence (*"produce branches into adjacent swim
                    // lanes"*): a branch belongs beside the thread it came
                    // from, so proximity to the anchor orders the search and
                    // the lane's own value breaks ties. `laneOk` is the SAME
                    // predicate the dep-less scan already trusts — cell free,
                    // arc corridors clear, no shallower bead still owing an arc
                    // past this column — so re-use cannot admit a placement
                    // that path would refuse.
                    const candidates = [...lanesUsed]
                        .filter((v) => v !== al)
                        .sort((p, q) => Math.abs(p - al) - Math.abs(q - al)
                            || p - q);
                    for (const cand of candidates) {
                        if (laneOk(r, d, cand)) { lane = cand; break; }
                    }
                    if (lane === null) {
                        const below = [...lanesUsed]
                            .filter((v) => v > al)
                            .sort((p, q) => p - q)[0];
                        lane = below === undefined ? al + 1 : (al + below) / 2;
                    }
                } else {
                    lane = 0;
                    while (!laneOk(r, d, lane)) lane += 1;
                }
            }
            laneById.set(r.id, lane);
            lanesUsed.add(lane);
            take(d, lane, r.id);
            // Reserve the corridor of every straight (same-lane) arc into this
            // step, so no LATER chain inherits a lane through it. take() never
            // overwrites, so an in-chain bead already in the corridor keeps its
            // identity for later corridorOk checks.
            for (const a of sameEpicDepsOf(r)) {
                if (laneById.get(a.id) === lane) {
                    for (let dd = colOf.get(a.id) + 1; dd < d; dd++) {
                        take(dd, lane, RESERVED);
                    }
                }
            }
        }
        // Ordinal renumber: fractional inserted lanes become whole rows here.
        // Everything downstream — bandUsed (arc-corridor checks), laneReqs,
        // laneY, node positions — speaks the renumbered values, so the
        // fractions never escape this loop.
        const laneVals = [...new Set(steps.map((r) => laneById.get(r.id)))].sort((p, q) => p - q);
        const laneRemap = new Map(laneVals.map((v, i) => [v, i]));
        for (const r of steps) laneById.set(r.id, laneRemap.get(laneById.get(r.id)));
        for (const [dd, cells] of used) {
            const remapped = new Map();
            for (const [lv, occ] of cells) {
                remapped.set(laneRemap.has(lv) ? laneRemap.get(lv) : lv, occ);
            }
            used.set(dd, remapped);
        }
        const sub = Math.max(1, ...steps.map((r) => laneById.get(r.id) + 1));

        // ── THE REQUIREMENT SWIM-LANE SWEEP IS GONE (req #3498) ─────────────
        // `countAt` plus a greedy first-fit used to push a column's requirement
        // stack down far enough to clear the stacks of the columns within the
        // stagger window, because those stacks OVERFLOWED their columns and
        // could otherwise land on each other. Requirement rows are inside a card
        // now — clipped to `CARD_TEXT_W`, gapped from the next card by
        // `CARD_GAP_X` — so two columns' rows cannot reach each other at any
        // count, and there is nothing left to offset. `band.reqOffsets` goes
        // with it; the marks are placed from the card's own top edge below.

        // ── LANE PITCH IS THE TALLEST CARD IN THE LANE (req #3498) ──────────
        // The zero-overlap contract's second half, and it got much simpler. A
        // lane's envelope used to be assembled from parts that did not belong to
        // each other — a step label floating above the bead, the bead, the
        // requirement stack below it, a reserved title slot below that, plus a
        // stagger line — and the pitch had to reserve the deepest of each. All
        // of those are now ONE box whose height `cardHeight` already knows, so
        // the pitch is that box plus the gap, and nothing else.
        //
        // PER-LANE, exactly as req #3119 made it: a lane is as tall as ITS OWN
        // tallest card, never as tall as the band's. That is what stops one
        // five-requirement step setting the pitch for eight single-requirement
        // lanes beneath it (~380px of dead space in one band on the live plan,
        // which is the measurement that bought the per-lane rule in the first
        // place).
        //
        // THE FALLBACK IS UNREACHABLE, AND IS KEPT AS A FLOOR RATHER THAN AS A
        // CLAIM. The renumber above maps the set of OCCUPIED lane values onto
        // `0..sub-1`, so every lane in that range has at least one card and this
        // `||` never fires. (An earlier version of this comment said an empty
        // lane was reachable through the fractional insert path; it is not —
        // the insert is renumbered away in the same loop.) It stays because a
        // zero pitch would stack two lanes on one y, and because `laneY` is
        // built by iterating the range rather than the map. Any consumer
        // reading `laneCardH` must use THIS fallback, not `|| 0`.
        const laneCardH = new Map();
        for (const r of steps) {
            const lane = laneById.get(r.id);
            const h = cardHeight(reqBlockOf(r), stepLabel, nameLineCount(r));
            if (h > (laneCardH.get(lane) || 0)) laneCardH.set(lane, h);
        }
        // THE RESPECTFUL GAP (user directive: *"there has to be a respectful gap
        // / white space but otherwise we want the compression"*). It is charged
        // once per lane, below the card, so two vertically adjacent cards are
        // always `CARD_GAP_Y` apart whatever their heights.
        const lanePitch = (lane) =>
            (laneCardH.get(lane) || cardHeight(0, stepLabel, 1)) + CARD_GAP_Y;
        // Cumulative lane tops, so a lane's y is the SUM of the lanes above it
        // rather than index × a single pitch. `laneY` is exported on the band:
        // every consumer that draws per-lane furniture (the visualizer's lane
        // wires) must use it or the wires detach from the cards.
        const laneY = [];
        {
            let acc = 0;
            for (let l = 0; l < sub; l++) { laneY.push(acc); acc += lanePitch(l); }
            laneY.push(acc); // sentinel: total lane height
        }
        // Retained for consumers that want a representative pitch; band height
        // comes from laneY, never from sub × pitch.
        const pitch = lanePitch(0);
        // EVERY BAND TAKES THE SAME HEADER, AND NOTHING REACHES INTO IT ANY MORE
        // (req #3498). The header used to absorb the stagger in title mode, and
        // `epicLaneH` had to subtract `STEP_LABEL_RISE` on top of that, because a
        // lane-0 step label floated ABOVE its bead and reached back up into the
        // header — the "off-by-a-reservation" this constant's own history is made
        // of. A card starts AT its lane's top and nothing is drawn above it, so
        // the header's clear strip is now the header itself.
        const headerH = BAND_HEADER;
        // The EPIC'S OWN LANE: the part of the header no step content can reach.
        // That is the whole header now — kept as a named field because the
        // visualizer's floating epic chip clamps to THIS rather than re-deriving
        // it, and the two must not drift apart again.
        const epicLaneH = headerH;
        bands.push({ ...band, steps, sub, pitch, laneY, laneCardH,
            headerH, epicLaneH });
        bandUsed.push(used);
    }
    // The ruler's reservation, charged ONCE and unconditionally (see RULER_H).
    // Every band, node and arc is derived from this y, so the whole plan shifts
    // by one constant and nothing below has to know about the strip.
    let y = 8 + ruler.h;
    for (const band of bands) {
        band.y = y;
        band.height = band.headerH + band.laneY[band.sub];
        y += band.height + BAND_GAP;
    }
    const totalH = y + 8;

    // ── Node positions: A NODE IS A BOX (req #3498) ─────────────────────────
    // `x`/`y` remain the node's CENTRE, and that is deliberate rather than
    // incidental: the user asked for the steps to be *"linked from their
    // midpoints"*, so the centre is exactly what every arc, focus rect and hit
    // test already wants, and keeping the two field names meaning what they
    // always meant is what lets the arc routing below stay untouched.
    //
    // The box comes with it — `w`/`h` and the `left`/`top` corner — because a
    // card is drawn from its corner while it is CONNECTED at its edge midpoints,
    // and making every consumer re-derive one from the other is how two copies
    // of a number start disagreeing.
    //
    // ── CARDS IN ONE LANE ARE CENTRE-ALIGNED, AND THAT IS LOAD-BEARING ──────
    // A card's height grows with its requirement count, so cards in one lane are
    // different heights. Top-aligning them reads well — the title areas line up
    // across a lane — but it puts every card's MIDPOINT at a different y, and
    // the midpoints are what the arcs connect. A one-requirement step feeding a
    // three-requirement step in the SAME lane would stop being a straight line
    // and become a cubic, so a chain running along its own lane — *"the primary
    // threads of execution stay in the swim lane"* — would zigzag between every
    // pair of cards for no reason a reader could see.
    //
    // Centred, every card in a lane shares one midpoint y: same-lane links are
    // straight, the lane wire runs exactly through every card it passes, and a
    // curve means what it should mean — a BRANCH into another lane.
    const nodes = new Map();
    bands.forEach((band, bandIndex) => {
        for (const r of band.steps) {
            const d = colOf.get(r.id);
            const lane = laneById.get(r.id);
            const h = cardHeight(reqBlockOf(r), stepLabel, nameLineCount(r));
            const laneH = band.laneCardH.get(lane) || h;
            // ── THE MIDPOINT IS COMPUTED FIRST, AND THE CORNER FROM IT ──────
            // Algebraically `top + h/2` and `laneTop + laneH/2` are the same
            // number; in floating point they are not. Deriving the centre from
            // the card's own height gave two cards in one lane midpoints one ULP
            // apart (measured after the type scale made the constants
            // non-terminating: 1835.9499999999998 vs 1835.95), and the arc
            // router tests `y1 === y2` EXACTLY to decide whether a link is
            // straight — so a chain running along its own lane would have
            // silently become a row of imperceptible S-curves.
            //
            // Computing the lane's centre once and hanging the corner off it
            // makes every card in the lane share one `y` bit-for-bit, which is
            // what the straight-link rule actually depends on.
            const laneTop = band.y + band.headerH + band.laneY[lane];
            const cy = laneTop + laneH / 2;
            const top = cy - h / 2;
            nodes.set(r.id, {
                id: r.id,
                x: colX[d],
                y: cy,
                w: cardW,
                h,
                left: colX[d] - cardW / 2,
                right: colX[d] + cardW / 2,
                top,
                bottom: top + h,
                // The card's TITLE AREA height. Published because the step name
                // may wrap (req #3498), so it varies per card and the renderer
                // must not re-derive it — the rule under the title and the
                // card's activate region are both placed from this number, and
                // a second derivation is how a divider and the text it divides
                // start disagreeing.
                titleH: cardTitleH(stepLabel, nameLineCount(r)),
                // ── THE FRAME'S OWN BOX (req #3498) ─────────────────────────
                // The rounded rect does NOT start at `left`: the state bar owns
                // the strip before it. Published so every consumer reads one
                // answer — the halo, the hover region and the activate region
                // each re-derived it from `left`/`w` and each was silently a
                // bar's width too wide once the bar moved outside the frame.
                frameLeft: colX[d] - cardW / 2 + CARD_FRAME_X,
                frameW: cardFrameW,
                depth: d,
                lane,
                bandIndex,
            });
        }
    });

    // ── Dependency arcs: straight same-lane, cubic cross-lane ───────────────
    // Cross-lane routing is ADAPTIVE (user directive, epic #6 plan — "less
    // crossover"). The POC bent EARLY: the arc joined the DESTINATION lane's y
    // right after the source column and ran horizontally through every
    // intermediate column at that height — straight through any bead parked on
    // the destination lane (the convergence into a penultimate step overdrew
    // the whole main chain). Now an arc runs the horizontal on its SOURCE lane
    // and dives just before the destination column (LATE bend) whenever that
    // corridor is clear of unrelated beads and reservations; if only the
    // destination-lane corridor is clear it bends early as before; if neither
    // is clear, early is the fallback. Corridor-aware PLACEMENT (laneOk above)
    // keeps source corridors clear in the common case, so late is the norm.
    const corridorClear = (bandIndex, lane, dFrom, dTo, aId, rId) => {
        const used = bandUsed[bandIndex];
        if (!used) return true;
        for (let dd = dFrom + 1; dd < dTo; dd++) {
            const o = used.has(dd) ? used.get(dd).get(lane) : undefined;
            if (o === undefined) continue;
            if (o === RESERVED) return false;
            if (!(reach(o).has(aId) && reach(rId).has(o))) return false;
        }
        return true;
    };
    const arcs = [];
    for (const r of safeRows) {
        for (const dId of depsOf(r)) {
            const a = nodes.get(dId);
            const b = nodes.get(r.id);
            if (!a || !b) continue;
            // FROM THE MIDPOINTS (req #3498, user directive). `a.y`/`b.y` are
            // the cards' vertical centres and `± w/2` their left and right
            // edges, so an arc leaves one card's right-edge midpoint and lands
            // on the next card's left-edge midpoint. The 1px is the same hair of
            // clearance the bead radius carried, so the stroke starts beside the
            // card's border rather than under it.
            const x1 = a.x + a.w / 2 + 1;
            const y1 = a.y;
            const x2 = b.x - b.w / 2 - 1;
            const y2 = b.y;
            if (y1 === y2) {
                arcs.push({
                    fromId: dId, toId: r.id, straight: true, route: 'straight', x1, y1, x2, y2,
                });
                continue;
            }
            // req #3372 gate-delta F1 (2026-08-08) — a cross-epic dependency
            // edge is LEGAL, not a defect to report. `sameBand` stays a pure
            // boolean routing input: a cross-band arc simply takes the
            // 'early' shape below, same as any other cross-band arc always
            // has. No assertion, no violation, no side-channel field — see
            // "cross-epic dependency edges stay legal" in
            // `pipelinePlanLayout.test.js` for the positive fixture.
            const sameBand = a.bandIndex === b.bandIndex;
            const late = sameBand
                && corridorClear(a.bandIndex, a.lane, a.depth, b.depth, dId, r.id);
            // The arc carried a `bbox` (the convex hull of its own Bézier
            // control points) from req #3210 until req #3257: its ONLY consumer
            // was the sticky epic chips' obstacle-avoidance pass, and that pass
            // is gone along with it — an epic name is pinned to its band's
            // rectangle now and draws OVER whatever it crosses. Computed on
            // every arc of every layout, it was dead weight the moment the pass
            // was, so it goes with it rather than waiting to be rediscovered as
            // a field nobody reads.
            // ── THE BEND IS THE GUTTER (req #3498, review finding) ─────────
            // It was `colW * 0.9`, and that was right while a column was mostly
            // air: a 158px column holding a 20px bead had ~140px of free run to
            // turn in. A column is a CARD now, so `colW * 0.9` is 447px of
            // descent against 90px of actual free space — the curve completed
            // its dive INSIDE the next column's card, which paints over it.
            // Measured on the 34-row fixture: 2 arc/card crossings before, 9
            // after, all 7 new ones on this branch.
            //
            // `CARD_GAP_X` is the entire horizontal room an arc has between two
            // cards, so the descent is bounded by it and completes in the gutter
            // where nothing is drawn. On the adjacent-column case this is
            // exactly what the old expression already produced by coincidence
            // (`x2 - x1` bound it to 88), which is why those arcs crossed
            // nothing and the distant ones did.
            const gutter = Math.max(40, CARD_GAP_X - 2);
            const bend = Math.min(gutter, Math.max(40, x2 - x1));
            let path;
            if (late) {
                const xb = Math.max(x1, x2 - bend);
                path = `M${x1},${y1} L${xb},${y1} C${xb + bend * 0.45},${y1} `
                    + `${xb + bend * 0.55},${y2} ${x2},${y2}`;
            } else {
                path = `M${x1},${y1} C${x1 + bend * 0.45},${y1} ${x1 + bend * 0.55},${y2} `
                    + `${x1 + bend},${y2} L${Math.max(x2, x1 + bend)},${y2}`;
            }
            arcs.push({
                fromId: dId, toId: r.id, straight: false,
                route: late ? 'late' : 'early', x1, y1, x2, y2, path,
            });
        }
    }

    // ── Label rectangles — every piece of text the canvas draws, as world
    // boxes, so the zero-overlap invariant is a testable property of THIS
    // module's output rather than a hope about the renderer.
    const labels = [];
    for (const r of safeRows) {
        const n = nodes.get(r.id);
        // ── THE STEP NAME, IN THE CARD'S TITLE AREA (req #3498) ─────────────
        // It floated 34px ABOVE the bead until now, fitted to a stagger budget
        // assembled from the neighbouring columns. It sits inside the card's own
        // title area instead, fitted to the card, LEFT-ALIGNED rather than
        // centred: a row of centred titles over left-aligned requirement rows
        // reads as two different lists, and the title is the thing a reader
        // scans down a lane. NOT on the requirement rows' own `textLeft` since
        // req #3503, though — see `titleTextLeft` below for why the title's
        // line alone is indented past the badge.
        // The ✓'s room and the link button's come off the right (CARD_CHECK_W,
        // CARD_STEP_LINK_W); the badge's comes off the left (CARD_BADGE_W,
        // CARD_BADGE_GAP) — all four drawn on the title area's own line, so a
        // budget that ignored any of them would put the step name under one.
        const nameLines = nameLinesOf.get(r.id) || [''];
        const label = nameLines.join(' ');
        const lw = Math.max(...nameLines.map((l) => l.length)) * CHW_LABEL;
        const textLeft = n.left + CARD_FRAME_X + CARD_PAD_X;
        // ONLY the title's own line moves for the badge — the requirement rows
        // below it, and the reserved L3 title-duplicate line, still start at
        // the column's own `textLeft`. The badge answers for the title's row
        // alone (the day-header pill it is copied from sits beside ONE date,
        // not an indented list under it), and shifting rows that never draw
        // beside it would cost every card width for no reason on any of them.
        const titleTextLeft = textLeft + CARD_BADGE_W + CARD_BADGE_GAP;
        labels.push({
            kind: 'step', stepId: r.id, text: label,
            // The lines AS DRAWN, so the renderer never re-wraps — the same
            // contract the requirement rows carry.
            lines: nameLines,
            // In `title` mode this label IS the step's stored name.
            prose: stepLabel === 'title',
            x: titleTextLeft,
            y: n.top + CARD_PAD_Y,
            w: lw, h: nameLines.length * CARD_LINE_H,
        });
        const ids = r.reqIds || [];
        // ── THE REQUIREMENT ROWS, TOP TO BOTTOM, IN ORDER ───────────────────
        // *"the requirements listed top to bottom inside the card in the order"*.
        // `reqIds` order is the order — this module does not re-sort it (that is
        // `sortReqIdsByStatus`' job, and its caller's choice).
        //
        // There is ONE room now, and it is the card's text column. The old code
        // had to compute a per-mark budget out of the column width, the stagger
        // reach, the mark count and — in `horizontal` — the mono spaces gluing
        // the marks together, which is the arithmetic that once put a 3-req
        // step's row 14.4px outside its own column slab. A row is one line in a
        // fixed-width box; there is nothing left to divide.
        const showTitles = reqLabel === 'title';
        const rowsTop = n.top + cardTitleH(stepLabel, nameLines.length)
            + CARD_RULE_BAND;
        // The wrapped lines this step's rows occupy — derived once at the top of
        // this function, so the box that was measured and the text drawn into it
        // are the same answer.
        const rowLines = rowLinesOf.get(r.id) || [];
        let rowY = rowsTop;
        // ── THE ID-ONLY PACKING, ALONGSIDE THE TITLE ONE (req #3503 review:
        //    "bring all the numbers into a nice vertical line up with no white
        //    space") ────────────────────────────────────────────────────────
        // `rowY` above spends every row the TITLE-WRAPPED height it may need
        // (1-2 lines, since `reqLabel` is pinned to `'title'` — see the block
        // this one sits beside) so the card's own height, and every OTHER
        // row's y, stay a pure function of the level exactly as the comment
        // below still promises: a level change moves no box. But at L1/L2 the
        // RENDERER draws the bare id, one line, in that same reserved (often
        // taller) slot — which is exactly what "sparse, big gaps between
        // consecutive ids" is a report of. `idY` is the id-only alternative:
        // packed at a FIXED one-line-plus-gap pitch from the same `rowsTop`,
        // walked in lockstep with `rowY` so it never has to re-derive
        // anything the wrapped counter already computed.
        //
        // PROVABLY NEVER BELOW ITS OWN `y` (and so never a NEW overlap the
        // zero-overlap sweep has not already cleared): `idY` accumulates
        // `REQ_LINE_H + REQ_ROW_GAP` per row while `rowY` accumulates AT
        // LEAST that much (`lines.length >= 1`), so `idY <= y` at every row —
        // asserted directly in `pipelinePlanLayout.test.js` rather than
        // re-run as a second full pairwise sweep over a geometry that is a
        // strict subset of space the first sweep already proved empty.
        let idRowY = rowsTop;
        rowLines.forEach((lines, i) => {
            const w = Math.max(...lines.map((l) => l.length)) * CHW_REQ;
            const t = lines.join(' ');
            const thisY = rowY;
            const thisIdY = idRowY;
            // The next row starts below THIS row's lines plus the between-rows
            // gap — the two quantities `reqBlockHeight` charges, walked in the
            // same order so the boxes and the block height cannot disagree.
            rowY += lines.length * REQ_LINE_H + REQ_ROW_GAP;
            idRowY += REQ_LINE_H + REQ_ROW_GAP;
            labels.push({
                kind: 'req', stepId: r.id, reqId: ids[i], text: t,
                // The lines AS DRAWN, so the renderer never re-wraps. `text` is
                // kept as the joined string because the overlap sweep, the
                // no-'#' audit and the hover regions all read it.
                lines,
                // A TITLE is stored user content and renders verbatim; an id is
                // generated. The no-'#' audit keys on this flag rather than on
                // `kind`, so a mark that switched from generated to prose cannot
                // silently change which side of that line it is on (PIPE-07).
                prose: showTitles,
                x: textLeft,
                y: thisY,
                // The box spans EVERY line the row occupies — the zero-overlap
                // sweep and the hover region both have to cover the whole row,
                // not just its first line.
                w, h: REQ_TEXT_H + (lines.length - 1) * REQ_LINE_H,
                // ── The id, alongside the title (user directive 2026-08-01:
                //    "L3 can have the req titles on by default")
                // The mark shows the ID at L1/L2 and the TITLE at L3, and the
                // RENDERER picks — not the layout. Relayouting on a level change
                // would break this module's oldest invariant, and now that the
                // level also decides whether the card is drawn at all, breaking
                // it would move every card on the plan as the reader zoomed.
                // Both strings are left-anchored at the same x and the id is
                // strictly narrower, so it cannot leave a box the title fits.
                idText: String(ids[i]),
                idW: String(ids[i]).length * CHW_REQ,
                // The RENDERER picks this instead of `y` at L1/L2 (`!showTitle`)
                // — see the block comment above `idRowY`.
                idY: thisIdY,
            });
        });
        // ── THE TOTAL REQUIREMENT COUNT, AS A BADGE (req #3503; originally
        // req #3498, "Provide a count") ──────────────────────────────────
        // LEFT of the title now, in the room `CARD_BADGE_W` + `CARD_BADGE_GAP`
        // reserved out of the step name's budget — see `CARD_BADGE_W`'s own
        // comment for why the pill replaced the dim "(N)" text this used to
        // draw at the title's right edge. Emitted for EVERY card including the
        // empty one — 0 is a fact about the step, and a count that disappears
        // is a count a reader cannot rely on.
        {
            const countText = String(ids.length);
            // The DRAWN width, not the reserve: `badgeWidthFor` (per-row,
            // real digit count) is almost always narrower than `CARD_BADGE_W`
            // (worst case), and RIGHT-aligning it against the reserve's own
            // right edge is what makes a one-digit badge a circle rather
            // than the reserve's full width stretched into a capsule.
            const badgeW = badgeWidthFor(countText.length);
            labels.push({
                kind: 'badge', stepId: r.id, text: countText,
                // Generated from a row count, never stored user content — so
                // the no-'#' audit governs it (the `prose` note on req marks).
                prose: false,
                x: textLeft + CARD_BADGE_W - badgeW,
                // On the FIRST name line, whatever the name wrapped to — the
                // count belongs to the card, not to the last line of its title.
                y: n.top + CARD_PAD_Y + 1,
                w: badgeW, h: CARD_BADGE_H,
            });
        }
        // ── "VIEW IN TABLE" LINK BUTTON (req #3503) ──────────────────────────
        // Right of the title, in the room `CARD_STEP_LINK_W` reserved out of
        // the step name's budget, left of the ✓ — see `CARD_STEP_LINK_W`'s own
        // comment. `onStepFocus` already exists (req #3213) as a hit rect over
        // the whole title area; this is that SAME action, given a mark a
        // reader can see and aim at, so it draws for every card exactly where
        // the ✓ and the reserve agree it will, whether or not the step is done.
        {
            labels.push({
                kind: 'step-link', stepId: r.id, text: '↗',
                prose: false,
                // Off the FRAME's right edge — which, unlike its LEFT edge, IS
                // the node box's: the state bar owns a strip before the frame
                // only on the left, so `n.right` already is that edge, at
                // whatever `cardW` this plan's Step Width rung resolved to
                // (req #3503 review — this line named `CARD_FRAME_W`, the
                // fixed scale-1 constant, and stayed put while the frame it
                // was meant to track widened around it). Left of the ✓'s own
                // reserve, the same order the old count/✓ pair drew in.
                x: n.right - CARD_PAD_X - CARD_CHECK_W - CARD_STEP_LINK_W,
                y: n.top + CARD_PAD_Y,
                w: CARD_STEP_LINK_W, h: REQ_TEXT_H,
            });
        }
        // ── THE STEP'S OWN TITLE, ON THE L3 LINE ────────────────────────────
        // Skipped when the step label already IS the title — it would duplicate,
        // which is why `cardTitleH` does not reserve the line in that mode
        // either. The two agree by reading the same condition.
        if (stepLabel !== 'title') {
            const t = truncate(r.title || '', cardChars(CHW_TITLE));
            if (t) {
                labels.push({
                    kind: 'title', stepId: r.id, text: t,
                    // Stored plan content — see the `prose` note on req marks.
                    prose: true,
                    x: textLeft,
                    y: n.top + CARD_PAD_Y + nameLines.length * CARD_LINE_H,
                    w: t.length * CHW_TITLE, h: 11,
                });
            }
        }
    }
    // ── Ruler ticks join `labels` (req #3207 constraint) ────────────────────
    // Deliberately NOT a second, separately-checked class of text. The
    // zero-overlap contract is asserted over `layout.labels` in all four
    // reqLayout × stepLabel combinations, and a date strip that carried its own
    // rects would be text on this surface that no invariant covers — which is
    // how an epic-label collision got shipped once already (against the
    // launch-unit letter, itself since deleted by req #3371).
    // Left-anchored just inside the tick, because a ruler label belongs to a
    // BOUNDARY, not to the middle of a region whose width is an accident of how
    // many columns that day happened to need.
    for (const r of ruler.slots) {
        if (!r.showLabel) continue;
        labels.push({
            kind: 'slot', slotKey: r.key, slotKind: r.kind, day: r.day,
            text: r.label,
            // Generated from a date, never stored user content — so the no-'#'
            // audit governs it (see the `prose` note on requirement marks).
            prose: false,
            // Clamped off the right edge so the last tick's text stays in the
            // world it is measured against.
            x: r.labelX, y: RULER_LABEL_Y, w: r.labelW, h: RULER_LABEL_H,
        });
    }
    for (const band of bands) {
        // req #3225 — `epicLabel` already carries the count suffix when the
        // toggle is on (identical to `band.epic` when it is off), so this
        // rectangle — the one the zero-overlap contract asserts over — grows
        // to cover it rather than a second, unchecked box drawn beside it.
        const bandText = band.epicLabel || band.epic;
        labels.push({
            kind: 'epic', epicId: band.epicId, text: bandText,
            x: 12, y: band.y + 6,
            // req #3226 — the SAME reservation `placeEpicChips` measures the
            // floating chip against, grown onto the rect the zero-overlap
            // invariant actually sweeps (req #3225 set this precedent: the
            // count suffix grew both together, never just the chip).
            w: bandText.length * CHW_EPIC + EPIC_PAUSE_BUBBLE_W, h: 16,
        });
    }
    return {
        width: totalW,
        height: totalH,
        bands: bands.map(({ steps, ...b }) => ({ ...b, stepIds: steps.map((s) => s.id) })),
        nodes,
        arcs,
        labels,
        colW,
        // The column pitch as ONE NUMBER (req #3503 review) — `colW` above is
        // per-column (an array, uniform today but shaped for a future that
        // is not), so a caller that wants "the" pitch — `stepsAcrossScale`'s
        // `colW` parameter, at every call site that holds a live layout —
        // needs the scalar `COL_W` this was built from, not `colW[0]` typed
        // as a number by accident. `Number.isFinite` on the array silently
        // fails this check without ever calling it wrong (JS coerces an
        // array to NaN on arithmetic, never throws), which is exactly the
        // failure this field exists to make impossible to reach for again.
        colPitch: COL_W,
        colX,
        // The time axis as GEOMETRY (req #3201): the ordered slots and the
        // column each one starts at. Exported so the axis is assertable from
        // this module's output — "slot k begins right of everything in slot
        // k-1" is the property the whole design rests on, and a test that
        // re-derives it from the input would be a second implementation.
        slots,
        slotOf,
        // The DRAWN axis (req #3207): the same slots with world x-extents, the
        // calendar gap at each boundary, and which ticks survived degradation.
        // The text rects are ALSO in `labels` above — this carries the rules,
        // the ticks and the future region, which are not text and therefore not
        // subject to the overlap contract.
        ruler,
        reqLabel,
        stepLabel,
        empty: false,
    };
}

// ── Floating epic chips (req #3119, de-collided #3168, RE-RULED req #3257) ─
// The epic name rides its band's own rectangle and clamps to the visible
// content area while any part of that rectangle is on screen. This function is
// the whole placement decision, in SCREEN space, as a pure function of the world
// transform — it lives here rather than in the component for the same reason
// every other rectangle in this module does: overlap is a geometric property and
// it should be decidable in vitest without mounting a canvas.
//
// ONE RULE, and it is the whole behaviour (user directive 2026-08-02, req #3257):
//
//   THE NAME IS DRAWN AT THE TOP-LEFT CORNER OF THE INTERSECTION OF ITS BAND'S
//   RECTANGLE WITH THE VISIBLE CONTENT AREA, CARRYING THE SAME MARGIN IT WOULD
//   HAVE FROM THE BAND'S OWN TOP-LEFT CORNER.
//
// In two expressions, per band, with the band's screen rect `left/right/top/
// bottom` and the visible content area `0..vw × topInset..vh`:
//
//   x = min( max(left, 0)     + CHIP_MARGIN_X , right  - CHIP_MARGIN_X - w )
//   y = min( max(top, topInset) + CHIP_MARGIN_Y , bottom - CHIP_MARGIN_Y - h )
//
// The first term of each `min` is the clamp — panning down or right slides the
// name along its own rectangle's edge and parks it at the viewport's. The second
// is what makes the name LEAVE WITH ITS BAND rather than linger at the clamp
// line: as the band's bottom (or right) edge reaches the clamp, the name is
// pushed off by its own rectangle. **The name never escapes its band, on any
// edge, at any zoom or pan** — and when the band is gone, the name is gone.
//
// WHAT THIS REPLACES, and why it is FEWER moving parts rather than more:
//
//   · #3168's OBSTACLE-DRIVEN HORIZONTAL DISPLACEMENT SEARCH is GONE. Under the
//     rule above x is fully determined by the rectangle and the viewport, so
//     there is nothing left for a candidate search to decide — and a name that
//     wandered sideways out of its own rectangle was the defect being fixed, not
//     a collision being avoided. The chip draws on a 60%-opaque panel; where it
//     crosses a bead, an arc or a step label it draws OVER it, deliberately.
//   · #3210's NEIGHBOUR-ONLY STICKY PASS is GONE, subsumed: clause 2 now applies
//     to EVERY band, so a focused band's neighbours keep their names by the same
//     rule as everything else instead of by a special case. Its guarantee is
//     re-asserted in vitest against the new rule rather than assumed.
//   · CHIP-ON-CHIP OVERLAP was, under #3257 alone, IMPOSSIBLE BY CONSTRUCTION —
//     bands never overlap in world Y, the chip was sized to its band's own epic
//     lane (`h + 2·CHIP_MARGIN_Y ≤ epicLaneH·k ≤ band.height·k`) and clamped
//     inside its band's rectangle, so two chips would have had to share a
//     rectangle to touch. **REQ #3272 ENDS THAT PREMISE** by flooring `h`, and
//     the guarantee is restored by an explicit VERTICAL de-collision pass — see
//     the block below and `placeEpicChips`' own stack pass. The sweep asserted
//     it before and asserts it now; what changed is whether the geometry alone
//     is the proof.
//
// ── THE LEGIBILITY FLOOR IS ON THE FONT, NOT ON THE BOX (req #3272) ─────────
//
// The two sentences immediately below this one used to read "below
// `EPIC_CHIP_MIN_H` the chip is DROPPED rather than drawn over the first row of
// steps", and that is exactly what a zoomed-out reader saw: a screenshot of
// production on 2026-08-02 showing the whole plan with NO EPIC NAMES AT ALL,
// and — one zoom step in — names at `15 × 11/24 ≈ 6.9px`. Both were deliberate
// choices, correctly implemented. **THE USER OVERRULED THE CHOICE**: the name
// must not shrink to nothing, it must hold a minimum legible size, and small is
// fine.
//
// So the floor moved to the thing it was always about. `EPIC_CHIP_MIN_FONT` is
// the input and the BOX is derived from it (`EPIC_CHIP_MIN_H` is now a
// consequence, 17.6px, not a constant anybody picks). TWO documented decisions
// are REVERSED here, and both are reversals rather than fixes:
//
//   1. THE DROP IS GONE. A lane too short for the floored chip no longer
//      refuses the name — the chip is drawn over the first row of step labels.
//      That collision is the one the epic lane exists to prevent, and paying it
//      is acceptable for two reasons already in this code: the chip draws on a
//      60%-OPAQUE PANEL, and #3257 already ruled that where it crosses a bead,
//      an arc or a step label IT DRAWS OVER IT. A name present and slightly
//      overlapping beats a name absent, which is the user's whole point.
//   2. THE VERTICAL CLAMP GAINS ONE `max`. `bottom − CHIP_MARGIN_Y − h` is what
//      makes a name leave WITH its rectangle; once `h` is floored it can exceed
//      the band's own on-screen height, and that term then parks the name ABOVE
//      its band's top — where it reads as the band ABOVE's name, which is worse
//      than either symptom being fixed. `max(top + CHIP_MARGIN_Y, …)` stops it,
//      and it is PROVABLY INERT wherever `h + 2·CHIP_MARGIN_Y ≤ band.height·k`,
//      i.e. everywhere the geometry is unchanged from #3257.
//
// WHAT IS NOT REVERSED: the placement rule itself (top-left of the band
// rectangle ∩ the visible content area, clamped), the refusal to move a name
// SIDEWAYS out of its own rectangle, the clip-or-drop resolution of the key and
// the panel edge, and the `EPIC_CHIP_MIN_CHARS` floor — that one is stated in
// CHARACTERS OF THE NAME and is a different rule from this one.
//
// WHAT SURVIVES:
//
//   · THE PER-BAND SCALE SHRINK, now BOUNDED. The chip is a fixed SCREEN height
//     and the epic lane reserving room for it is WORLD px, so below some k the
//     lane is genuinely shorter on screen than the chip. Shrinking still keeps
//     the name out of lane 0's step labels for as long as it can — it simply
//     stops at `EPIC_CHIP_MIN_FONT` instead of running to 6.9px and then to
//     nothing.
//   · THE LEGEND'S MEASURED KEEP-OUT — the one obstacle that may still bind.
//     Resolved by CLIPPING the chip's width at the key's edge, and by dropping it
//     when too little of the NAME is left to read; NEVER by sliding it sideways
//     out of its own rectangle. The PANEL'S OWN RIGHT EDGE is resolved the same
//     way and by the same code, because the reader cannot tell the two apart —
//     and because dropping at one while clipping at the other let the key SAVE a
//     chip the panel edge alone would have dropped. See `PLAN_KEY_MAX_H` for what
//     the key costs, re-measured: "the key's height is free" was a property of
//     the displacement pass and is FALSE under clip-or-drop — false enough that
//     height, not width, is what the key is capped on now (req #3374 P6).
const CHIP_PAD = 8;
// The margins the name carries from its rectangle's corner — the SAME numbers
// the chip has always been inset by, now named because the rule above is stated
// in terms of them on both axes and at both ends.
const CHIP_MARGIN_X = 6;
const CHIP_MARGIN_Y = 2;

// The chip's own metrics, OWNED HERE (review finding). The component used to
// carry its own `CHAR_W = 7.3`, a leftover from the pre-type-scale 12px chip,
// while the chip has rendered at 15px bold mono since req #3119 — the same font
// this module already measures as `CHW_EPIC`. Every estimate was ~22% short (the
// fixture's four epic names came out 33–67px narrow), which is not a cosmetic
// error once a DISPLACEMENT PASS is reading it: an under-measured chip is
// declared clear of an obstacle it in fact overlaps, and the vitest sweep that
// proves the pass works reads the same wrong number, so it cannot notice.
// One constant, one source, and the tests inherit it by default.
export const EPIC_CHIP_H = 24;      // the HTML chip's own height, in SCREEN px
export const EPIC_CHIP_CHAR_W = CHW_EPIC;
export const EPIC_CHIP_PAD_W = 18;  // px + border, both sides
export const EPIC_CHIP_FONT = PLAN_VIZ_FONT.epic;
// The "open in features view" ↗ control's own footprint (req #3204) — a
// FLAT, unscaled screen-px reservation, not part of `EPIC_CHIP_PAD_W`
// (review finding, req #3210): the control is a fixed `fontSize: 12` glyph
// plus its own padding and the chip's `gap`, none of which shrinks when the
// chip does, unlike the name text `EPIC_CHIP_PAD_W` already accounts for. A
// natural chip did not use to have this reserved — under #3168 it was checked
// only against the legend and other chips, both comfortably clear at the sizes
// this surface reaches in practice.
//
// req #3257 RESERVES IT ON EVERY CHIP. The measured box is now the thing that
// keeps the name INSIDE ITS OWN RECTANGLE (and clear of the key), not merely
// clear of some other floating chip — so 24 unmeasured px is 24 px of name that
// can hang past the band's right edge or under the key, which is the exact
// under-measurement bug this module's own header comment warns about.
// ── BOTH CHIP LINKS GREW (req #3498, user directive: the steps link is "way
//    too small") ─────────────────────────────────────────────────────────────
// 24px reserved a 12px glyph at 70% opacity — a target under the 24x24 minimum
// every accessibility guideline names, on the one control that leaves this page.
// The glyph is the chip's own font size now (15) and the reservation grew with
// it. BOTH links move together: they are siblings on one chip, and one of them
// growing alone would read as an error rather than as emphasis.
export const EPIC_CHIP_OPEN_LINK_W = 30;
// The "open this epic's requirements as task cards" control (req #3428) — a
// SECOND link control riding beside the ↗, and the SAME kind of flat, unscaled
// screen-px reservation for the identical reason: a fixed `fontSize: 14` MUI
// glyph plus the chip's own flex `gap`, neither of which shrinks when the chip
// does. It renders under exactly the same condition as the ↗ (`epicId != null`)
// and is measured under the same condition, so the two can never drift apart.
//
// UNMEASURED CONTENT IS CONTENT THAT HANGS PAST THE EDGE IT WAS CLAMPED TO —
// this file's own header warning, and since req #3257 the measured box is what
// keeps the name inside its own rectangle and clear of the key, not merely clear
// of another floating chip. 24 px of unreserved glyph is 24 px of name over the
// band's right edge.
export const EPIC_CHIP_CARDS_LINK_W = 30;
// The pause status bubble (req #3226) — a small filled circle immediately left
// of the epic name, the SAME kind of flat, unscaled reservation as the ↗
// control above and for the identical reason: it is a fixed-diameter dot plus
// the chip's own flex `gap`, neither of which shrinks with the chip.
//
// The requirement calls this out by
// name ("a bubble is width the label did not have before") because, unlike
// the ↗ link, the bubble renders on EVERY band unconditionally (the ↗ link is
// absent for the "No epic" band; the bubble is not carved out for it because
// pause is meaningful there too — the whole-plan pause suppresses it same as
// any other band).
export const EPIC_PAUSE_BUBBLE_D = 8;    // the dot's own diameter, screen px
const EPIC_PAUSE_BUBBLE_GAP = 4;         // matches the chip's flex `gap`
export const EPIC_PAUSE_BUBBLE_W = EPIC_PAUSE_BUBBLE_D + EPIC_PAUSE_BUBBLE_GAP;
// ── THE FLOOR (req #3272) ──────────────────────────────────────────────────
// The smallest size the epic NAME may ever render at. This is the whole of the
// requirement: a floor on the FONT, with the box derived from it, replacing a
// floor on the BOX whose font came out at 6.9px and whose failure mode below
// that was to drop the name entirely.
//
// 11px, and it carries no new magic: it is the number `READABLE_MIN_PX` already
// uses for the plan's smallest REQUIRED text (the requirement ids, which
// `K_READABLE` is derived from), it is the floor MUI itself uses for
// `caption`-class type, and it is the number this file already had in hand —
// the old `EPIC_CHIP_MIN_H`. 11px bold mono is small and legible, which is
// exactly what the user asked for ("it may be small").
export const EPIC_CHIP_MIN_FONT = 11;
// The scale the floor corresponds to. The chip's font is `EPIC_CHIP_FONT ×
// h / labelH`, so a font floor IS a scale floor and the box follows from it.
const EPIC_CHIP_MIN_SCALE = EPIC_CHIP_MIN_FONT / EPIC_CHIP_FONT;   // 11/15
// The shortest box a chip is ever drawn in — 17.6px. **A CONSEQUENCE, NOT AN
// INPUT** (req #3272 reversed which of the two is which). Exported because the
// tests and any future caller need the derived number, never so that somebody
// can pick it: editing it here would silently desync the box from the font it
// is supposed to hold, which is the defect this requirement exists to fix.
// Callers passing a non-default `labelH` get `labelH × EPIC_CHIP_MIN_SCALE`;
// this constant is that value for the default chip.
export const EPIC_CHIP_MIN_H = EPIC_CHIP_H * EPIC_CHIP_MIN_SCALE;
// The clearance between two chips the de-collision pass stacks (req #3272).
// `CHIP_MARGIN_Y` itself rather than a fresh number: it is already "the gap a
// chip keeps from the thing above it", and two stacked names want the same
// breathing room a name keeps from its band's own top edge.
const CHIP_STACK_GAP = CHIP_MARGIN_Y;
// The floor a CLIPPED chip stops at (req #3257), stated in CHARACTERS OF THE
// NAME rather than in pixels — that is the thing the chip exists to show. The
// key's keep-out is resolved by cutting the chip's width off at the key's edge
// (never by sliding it out of its own rectangle), and a chip clipped to its
// padding plus the pause dot would render THE DOT AND NOTHING ELSE: box, border,
// colour, and none of the name. That is not "a bit of the name", it is a
// different mark. Dropping is the honest outcome there.
//
// **THIS FLOOR IS UNTOUCHED BY REQ #3272, DELIBERATELY.** That requirement
// removed the drop below `EPIC_CHIP_MIN_H` — a floor on the chip's HEIGHT,
// which controls how big the name is drawn. This one is a floor on how much of
// the name SURVIVES A CLIP, which is a different question with a different
// answer: a name that is present but too small to read is now refused (the
// font floor), and a box that is present but contains none of the name is
// still refused (this). The requirement says so in as many words.
//
// The floor is applied SCALED, in the same units as the chip's own measured
// width (`EPIC_CHIP_PAD_W * scale + … + n * charW * scale`) — comparing a
// scaled box against an unscaled floor is the units error this module's header
// warns about, just with the operands swapped.
export const EPIC_CHIP_MIN_CHARS = 3;
// Background opacity of the chip (user directive 2026-08-01: 40% transparent,
// i.e. 60% opaque). It was fully opaque, which read as a solid tile punched into
// the plan; at 0.6 the band beneath shows through as tint while the name still
// wins over whatever it crosses.
export const EPIC_CHIP_BG_ALPHA = 0.6;

/**
 * Where every epic band's name is drawn, in SCREEN px.
 *
 * ONE RULE — see this section's header comment: the top-left corner of the
 * INTERSECTION of the band's rectangle with the visible content area, plus the
 * margin the name would carry from the band's own corner, clamped so the name
 * never escapes its rectangle on the far edge of either axis.
 *
 * @param {Object} [args]
 * @param {Object[]} [args.bands] `computePlanLayout().bands`, top-to-bottom
 * @param {{x:number,y:number,k:number}} [args.transform] the world transform
 * @param {{w:number,h:number}} [args.viewport] the panel's measured size
 * @param {number} [args.worldWidth] `computePlanLayout().width`
 * @param {number} [args.labelH] the chip's unscaled screen height
 * @param {number} [args.charW] px per character at that height
 * @param {?{x:number,y:number,w:number,h:number}} [args.keepOut] the on-screen
 *   key's measured rect — clipped against, never displaced around
 * @param {number} [args.topInset] the bottom edge, in SCREEN px, of whatever
 *   chrome is PINNED above the plan. The name stops just BELOW it, never
 *   underneath it (clause 2). On the plan panel this is req #3254's pinned time
 *   ruler and the caller passes `rulerScreenBottom(t)` — the ONE readable number
 *   that requirement exposes for exactly this, rather than a guessed offset; it
 *   scales with zoom because the strip's own ticks and text do. 0 means "the top
 *   of the panel is the top of the content area" and is the right answer only
 *   for a caller with no pinned chrome at all.
 * @returns {Object[]} one entry per band with a name on screen
 */
export function placeEpicChips({
    bands = [], transform, viewport, worldWidth,
    labelH = EPIC_CHIP_H, charW = EPIC_CHIP_CHAR_W, keepOut = null,
    topInset = 0,
} = {}) {
    const t = transform || { x: 0, y: 0, k: 1 };
    const vw = viewport?.w || 0;
    const vh = viewport?.h || 0;
    // `worldWidth` is guarded like the transform and the viewport, and for the
    // same reason: without it the band's right edge is NaN, every comparison
    // below is silently false, and the function emits chips with `x: NaN` that
    // the renderer turns into `left: NaN`. Refusing is what the other two
    // degenerate inputs already do.
    if (!(t.k > 0) || vw <= 0 || vh <= 0 || !(worldWidth > 0)) return [];
    // The VISIBLE CONTENT AREA: the panel minus whatever is pinned above the
    // plan. A negative or absurd inset is nonsense rather than a clamp to
    // nothing, so it is bounded here once instead of at every use.
    const viewTop = Math.min(Math.max(0, topInset), vh);
    if (viewTop >= vh) return [];

    const out = [];
    // The bottom edge of the last chip the VERTICAL DE-COLLISION PASS placed
    // (req #3272), or `-Infinity` before the first one. Bands arrive top to
    // bottom and never overlap in world Y, so one running value is the whole
    // pass: each name is pushed DOWN to clear the one above it, and the stack
    // stays in band order because the natural positions already are.
    //
    // WHY A PASS EXISTS AT ALL, when #3257 deleted the last one: it deleted a
    // pass over OBSTACLES, resolved SIDEWAYS, which is the defect that
    // requirement names. This one resolves purely VERTICALLY and only against
    // other chips. It became necessary the moment `h` gained a floor — a chip
    // taller than its band's on-screen height cannot be contained by that band,
    // so "two chips would have to share a rectangle to touch" stopped being
    // true. The alternative to pushing is dropping, and dropping the name is
    // the symptom this requirement exists to remove.
    //
    // It is updated BEFORE the key's clip and never after it, so `y` is a pure
    // function of the bands and the transform. That is not tidiness: #3257's
    // invariant is that the key may take WIDTH off a name or take the name
    // away, and may NEVER move it. A stack that reserved space only for chips
    // the key had spared would move every name below a dropped one.
    let stackBottom = -Infinity;

    // The band rectangle's x-extent is the SAME one the canvas draws (`x={2}`,
    // `width={layout.width - 4}` in the component's band Rects) — every band
    // shares it, so it is hoisted out of the loop.
    const left = t.x + 2 * t.k;
    const right = t.x + (worldWidth - 2) * t.k;

    // TOP-TO-BOTTOM, ENFORCED RATHER THAN ASSUMED (req #3272). `computePlanLayout`
    // assigns `band.y` in one ascending sweep so a live caller is always ordered,
    // and until the de-collision pass existed the order was cosmetic. It is now
    // load-bearing — a running `stackBottom` only means "the chip above" if the
    // bands arrive in that order — and the callers this module cannot see are
    // hand-built band lists in tests. MEASURED on a shuffled 4-band list: one
    // name landed 67px below its own band's top, past three others. One sorted
    // copy of a 4-to-10-element array per frame is not a cost worth arguing over.
    const ordered = bands.length > 1
        ? [...bands].sort((a, b) => (a.y || 0) - (b.y || 0))
        : bands;

    for (const band of ordered) {
        const top = t.y + band.y * t.k;
        const bottom = t.y + (band.y + band.height) * t.k;

        // THE INTERSECTION. Empty on either axis means the band has no pixel in
        // the content area — and a name whose band is not on screen is a name
        // for nothing, so there is nothing to draw and nothing to clamp.
        const ix0 = Math.max(left, 0);
        const ix1 = Math.min(right, vw);
        const iy0 = Math.max(top, viewTop);
        const iy1 = Math.min(bottom, vh);
        if (ix1 <= ix0 || iy1 <= iy0) continue;

        // SIZE — from the band's own EPIC LANE, unchanged from req #3168. The
        // lane is the reserved strip above lane 0 that no step content can
        // reach; the fallback keeps this function usable with hand-built bands.
        // Note this is pan-INDEPENDENT (`laneBottom - top` is `epicLaneH · k`),
        // so the chip's size is a function of zoom alone — the clamp below moves
        // the name, it never resizes it.
        const laneBottom = t.y + (band.y + (band.epicLaneH ?? band.headerH)) * t.k;
        const laneH = Math.max(0, laneBottom - top);
        // THE FLOOR IS ON THE FONT, AND THE BOX IS DERIVED FROM IT (req #3272).
        // The chip shrinks INTO its lane exactly as it always did — and stops at
        // the size below which the name stops being a name. There is no `continue`
        // here any more: a lane too short for the floored chip gets the chip
        // anyway, drawn over the first row of step labels on its 60%-opaque
        // panel. See this section's header for why that reversal is the
        // requirement rather than a regression.
        const h = Math.max(labelH * EPIC_CHIP_MIN_SCALE,
            Math.min(labelH, laneH - 2 * CHIP_MARGIN_Y));
        // Font and character width track the box, so a scaled chip's WIDTH is
        // measured at the size it is actually drawn.
        const scale = h / labelH;
        // req #3225 — `epicLabel` carries the met/total suffix when the toggle
        // is on; band fixtures that predate the field fall back to the plain
        // name, so this stays the identity transform for callers that never set
        // it.
        const bandText = band.epicLabel || band.epic;
        // The FLAT, unscaled reservations: the two link controls — the ↗ to the
        // features view and the cards control to the epic's requirements (req
        // #3428) — which render only when there is an epic to open, and the
        // pause bubble, which renders on every band, "No epic" included. None of
        // them shrinks with the chip, and all are in the measured box before
        // anything is clamped or clipped against it.
        const wFull = bandText.length * charW * scale + EPIC_CHIP_PAD_W * scale
            + (band.epicId != null ? EPIC_CHIP_OPEN_LINK_W + EPIC_CHIP_CARDS_LINK_W : 0)
            + EPIC_PAUSE_BUBBLE_W;

        // ── THE RULE ────────────────────────────────────────────────────────
        // First term: the intersection's own corner, plus the margin. Second:
        // the band's far edge, so the name is pushed off BY ITS OWN RECTANGLE
        // as that rectangle leaves, instead of lingering at the clamp line.
        //
        // …and BOTH far-edge terms are floored at the band's OWN near corner
        // (req #3272), because the floor can make the chip bigger than the space
        // the far edge leaves, and the two terms then CROSS. On x that used to
        // be a DROP; it is now a clip, for the reason below.
        //
        // A RECTANGLE NARROWER THAN ITS OWN NAME IS A CLIP, NOT A DROP. `wFull`
        // scales with `h`, so flooring the height WIDENS every floored chip by
        // 20–60% — and the crossing test that used to refuse a name only at
        // absurd zooms now refuses it at zooms the reader can reach. MEASURED:
        // a 29-character epic name on a 900px panel over a 900px-wide world is
        // drawn by the pre-#3272 code at k = 0.25 (its own reachable zoom floor)
        // and REFUSED by the floored one, i.e. the fix re-created the vanishing
        // name on the other axis. So the band's right edge now joins the panel
        // edge and the key as a thing that takes WIDTH off the chip, resolved by
        // the identical clip-or-drop below and by the identical
        // `EPIC_CHIP_MIN_CHARS` floor. That is one rule for width where there
        // were two, and it is the rule #3257 already argued for: the reader
        // cannot tell one right-hand obstacle from another.
        const x = Math.min(ix0 + CHIP_MARGIN_X,
            Math.max(left + CHIP_MARGIN_X, right - CHIP_MARGIN_X - wFull));
        // …and the far-edge term is itself floored at the band's OWN top corner
        // (req #3272). `h` now has a floor, so it can exceed `band.height · k`,
        // and where it does the far-edge term resolves ABOVE the band's top —
        // parking the name over the band BEFORE it, where a reader reads it as
        // that band's name. Reading it as the wrong epic is a worse failure than
        // either symptom this requirement fixes.
        //
        // INERT ABOVE THE FLOOR, and that is the point: whenever
        // `h + 2·CHIP_MARGIN_Y ≤ band.height · k` we have
        // `bottom − CHIP_MARGIN_Y − h ≥ top + CHIP_MARGIN_Y`, so the `max`
        // returns its second argument and this expression is #3257's, character
        // for character. Every clause that requirement proved — the top-left
        // corner, the clamp below pinned chrome, the push-off as the rectangle
        // leaves — is untouched wherever the chip still fits its band.
        //
        // Where it is NOT inert (a chip taller than its band on screen) the name
        // tracks its band's TOP edge: it sits at the band's corner while the
        // band is in view and slides up and off with that corner as the band
        // leaves, which is the same push-off, taken from the other edge because
        // that is the only edge the name can still be anchored to.
        const yNatural = Math.min(iy0 + CHIP_MARGIN_Y,
            Math.max(top + CHIP_MARGIN_Y, bottom - CHIP_MARGIN_Y - h));
        let y = yNatural;

        // A DEGENERATE BAND POISONS THE PASS, so it is refused here rather than
        // carried. `stackBottom` is the first state this function has ever held
        // ACROSS bands, and NaN propagates through it: a band with no `height`
        // makes `bottom` NaN, every comparison against NaN is false so the
        // intersection test above does not fire, and `stackBottom = NaN` then
        // silently disables de-collision for the band AFTER it. Refusing is what
        // the other degenerate inputs already do (see the transform/viewport/
        // worldWidth guard above); this is the same posture, applied to the one
        // thing the pass carries between iterations.
        if (!Number.isFinite(y) || !Number.isFinite(h)) continue;

        // ── VERTICAL DE-COLLISION (req #3272) ───────────────────────────────
        // Two epic names must never overlap each other, and a floored chip can
        // be taller than its band, so the guarantee #3257 got from the geometry
        // now needs a pass. It is the smallest one that can work: push DOWN,
        // never sideways (that is the defect #3257 deleted) and never by
        // shrinking (that is the floor this requirement just installed).
        //
        // Pushing down rather than up because the name belongs to the band at
        // its TOP: a name may run into the bands below it and still read
        // correctly — it starts at its own band — while a name pushed up starts
        // inside somebody else's.
        //
        // **THE PUSH IS BOUNDED BY THE BAND, AND PAST THE BOUND IT DROPS.** An
        // unbounded push is misattribution with extra steps: each floored chip
        // consumes `h + CHIP_STACK_GAP` of vertical budget while a band supplies
        // only `band.height · k`, so on a plan of short bands the shortfall
        // ACCUMULATES with nothing to stop it — MEASURED at the reachable zoom
        // floor of a 900px panel, the worst name landed FIVE WHOLE BANDS below
        // the band it names, and the chip is a click target that zooms to its
        // epic (req #3204), so it also becomes the wrong control sitting over
        // another epic's beads. That is the same failure the `max` above exists
        // to prevent, taken in the other direction, and "the reader can see a
        // name" is worth nothing if the name is attached to the wrong thing.
        //
        // THE BOUND IS THE BAND'S OWN RECTANGLE: the name's top-left corner —
        // the corner the eye reads from — stays inside the band it names, at
        // every zoom. A push that would break it drops the name instead.
        // `yNatural` is in the cap so a chip that had NO conflict is never
        // refused by this: the bound limits how far de-collision may MOVE a
        // name, never whether it may exist.
        //
        // The invariant is therefore `top ≤ y ≤ max(bottom, top + CHIP_MARGIN_Y)`
        // and NOT the tidier `top ≤ y ≤ bottom` (review finding). The second
        // term is `yNatural`'s own floor showing through: a band less than
        // `CHIP_MARGIN_Y` TALL ON SCREEN has no room even for the margin, so its
        // natural position is already past its own bottom edge — measured, 1.84px
        // past, on bands under 0.1px high. The push never causes it. Stating the
        // stronger bound would be stating something this code does not do.
        //
        // WHAT THE BOUND COSTS, measured rather than assumed. On the LIVE plan
        // (pipeline 2 read 2026-08-02: 139 steps, seven bands of 616/197/4550/
        // 1040/616/885/522 world px) it costs NOTHING — all seven names are
        // drawn at full zoom out on a 1200, 1500, 1900 and 2400px panel, which
        // is this requirement's own acceptance criterion. Drift only accumulates
        // across CONSECUTIVE bands too short to pay for their own name, and a
        // real plan's short bands have tall neighbours. It bites only on a plan
        // of UNIFORMLY minimum-height bands — 24 of them at `MIN_LANE_PITCH`'s
        // 177 world px, laid out at this module's own 185px pitch (`+ BAND_GAP`,
        // review finding: 177 was the band, not the pitch) — a shape no live
        // plan has: 14/24 named at a 900px panel, 18/24 at 1200px, and 24/24
        // from 1500px up, against 0/24 before this requirement at every one of
        // them. The full table is in the vitest block, which fails if it rots.
        if (y < stackBottom + CHIP_STACK_GAP) {
            y = stackBottom + CHIP_STACK_GAP;
            if (y > Math.max(yNatural, bottom) + 0.01) continue;
        }

        // HEIGHT IS NOT CLIPPABLE, and it is not shrinkable either since req
        // #3272 put the floor on the font — so a band ENTERING from the BOTTOM
        // still simply waits until its name fits, rather than emitting a box
        // below the panel that the reader cannot see (measured pre-#3272: a band
        // with 2px on screen put its whole 24px chip past `vh`). This is also
        // where the de-collision pass DROPS rather than pushes: a name shoved
        // past the panel's bottom edge by the stack above it is a name nobody
        // can read, and the push has nowhere further to go.
        //
        // A band LEAVING over the top is the opposite case and is deliberately
        // NOT caught here: its own rectangle is pushing the name off, which is
        // clause 3, and this test cannot fire on it — such a band's `bottom` is
        // near the content area's TOP, not past `vh`, and `y + h` is bounded by
        // `bottom` plus one chip on either branch of the `max` above (review
        // finding: the old wording gave `y + h = bottom − CHIP_MARGIN_Y`, which
        // is the un-floored branch only).
        //
        // ORDER MATTERS AND IS LOAD-BEARING: this drop, and the stack reservation
        // below it, are decided BEFORE the key is consulted, so neither depends
        // on the key. That is what keeps `y` a pure function of the transform —
        // #3257's "the key takes width, never position" invariant.
        if (y + h > vh + 0.01) continue;
        stackBottom = y + h;

        // ── WIDTH IS CLIPPABLE ──────────────────────────────────────────────
        // THREE things cut the chip short on its right, and they are resolved
        // IDENTICALLY because the reader cannot tell them apart: the BAND'S OWN
        // RIGHT EDGE (req #3272 — a rectangle narrower on screen than the name
        // it carries, which used to be a drop), the panel edge (a band ENTERING
        // from the right, whose name genuinely starts inside the content area
        // and runs out of it) and the on-screen key. All three take WIDTH off
        // the chip — never move it, which is the defect req #3257 names — and
        // all three drop it when less than the floor would survive: padding +
        // the pause dot + `EPIC_CHIP_MIN_CHARS` of the actual name.
        //
        // Clipping the panel edge rather than dropping there is what keeps them
        // consistent. Dropping instead made the KEY able to SAVE a chip: a
        // name too wide for the panel was dropped with no key present and drawn
        // with one, because the key had already narrowed it to fit.
        let w = wFull;
        let clipped = false;
        // The band's own right edge is a limit like any other. INERT wherever
        // the name already fitted: `x ≤ right − CHIP_MARGIN_X − wFull` there, so
        // `x + wFull ≤ limit` and nothing is cut.
        let limit = Math.min(vw, right - CHIP_MARGIN_X);
        if (keepOut && keepOut.x + keepOut.w > x
            && y < keepOut.y + keepOut.h && keepOut.y < y + h) {
            limit = Math.min(limit, keepOut.x - CHIP_PAD);
        }
        if (x + w > limit) {
            const room = limit - x;
            const minW = EPIC_CHIP_PAD_W * scale + EPIC_PAUSE_BUBBLE_W
                + EPIC_CHIP_MIN_CHARS * charW * scale;
            if (room < minW) continue;
            w = room;
            clipped = true;
        }

        // THE LAST FRAME OF THE PUSH-OFF. A name leaving with its band ends up
        // wholly outside the content area for the final margin's worth of the
        // rectangle's life — `x + w` is `right - CHIP_MARGIN_X` and `y + h` is
        // `bottom - CHIP_MARGIN_Y`, while the intersection test above only
        // guarantees `right > 0` and `bottom > viewTop`. Measured: a 6px window
        // horizontally and a 2px one vertically in which an empty flex box is
        // emitted with its click target off the panel. Cosmetically a no-op
        // (`overflow: hidden` on the layer already cuts it), but "drawn and
        // invisible" is not a state worth having, and closing it costs one test
        // that cannot touch clauses 3 and 4 — both are about the frames BEFORE
        // this one.
        if (x + w <= 0 || y + h <= viewTop) continue;

        out.push({
            key: band.key == null ? 'none' : band.key,
            epicId: band.epicId,
            text: bandText,
            color: band.color,
            // The band itself, so a click can fit it (req #3204). Carried rather
            // than re-looked-up by key: `band.key` is null for the "No epic"
            // band and a find() on that would be a second place to get the null
            // handling right.
            band,
            x, y, w, h,
            // Whether `w` is a CUT rather than a measurement — the renderer must
            // cap and hide overflow only in that case. Capping unconditionally
            // would hand the drawn box over to an ESTIMATED width (`charW`), and
            // an estimate a hair short would truncate every name on the plan.
            clipped,
            // The renderer must draw at the size this was MEASURED at, or the
            // whole placement is decided against a box that does not exist.
            fontSize: EPIC_CHIP_FONT * scale,
        });
    }

    return out;
}

// Bead visual roles (POC vocabulary): fill/ring/width per state, manual ring,
// eligible-now ring. Kept here so the component and any test agree on one
// mapping. `eligible` wins the ring color (POC behavior); manual and eligible
// both draw the thick ring.
//
// This is the STEP end of the colour language documented under the palette: the
// fill is derived state, the ring is run mode, the halo is eligibility. Nothing
// here ever encodes a REQUIREMENT-level fact — that is the ids' channel.
//
// `suppressed` (req #3226) does NOT touch the ring: the ring still answers
// "is this step eligible" and that fact does not change under pause — the
// engine's own `eligibility()` is deliberately independent of `pauseState()`.
// It touches only the outer HALO's colour, because the halo is what a reader
// takes as "about to launch", and that reading IS wrong under pause. Ring
// green + halo red is the "eligible AND suppressed" combination rendered
// side by side, never one replacing the other.
export function beadStyle(row, eligible, suppressed = false) {
    const P = PLAN_VIZ_PALETTE;
    const done = row.state === STEP_DONE;
    const running = row.state === STEP_RUNNING;
    const fill = done ? P.doneFill : running ? P.runningFill : P.pendingFill;
    const baseRing = row.run === 'manual'
        ? P.manualRing
        : done ? P.doneRing : running ? P.runningRing : P.pendingRing;
    return {
        fill,
        ring: eligible ? P.eligibleRing : baseRing,
        ringWidth: row.run === 'manual' || eligible
            ? BEAD_RING_W_EMPHASIS : BEAD_RING_W_BASE,
        pulse: running,
        check: done,
        // Req #3168 — "highlight for next steps". The ring alone carried this,
        // at the same weight as the magenta manual ring and drawn in a palette
        // neighbouring the Complete green, so the one question the plan exists to
        // answer was the hardest mark on it to find. `next` drives an animated
        // OUTER halo the renderer draws at every zoom level, including Overview,
        // where "what runs next" is asked most and a 1px ring reads as nothing.
        // Drawing it there was never enough on its own — see
        // `nextHaloMagnify` for what it took to make it READ there (req #3271).
        next: !!eligible,
        haloColor: suppressed ? PAUSE_PAUSED_COLOR : P.eligibleRing,
    };
}

// The next-step halo (req #3168): a second ring outside the bead's own, so the
// two read as a target rather than as one thickened edge.
//
// The radius is BOUNDED BY THE TEXT, not chosen for impact (review finding). A
// step label's box ends 14px above the bead centre and the first requirement id
// starts 14px below it, so any mark whose outer edge passes 14 crosses type that
// the module's zero-overlap contract is otherwise responsible for. 12.5 + half a
// 2px stroke is 13.5, which clears both with 0.5px to spare.
//
// THAT LEAVES ONLY 0.25px between this ring and the eligible ring beneath it
// (r=10, stroke 2.5 → outer 11.25, against this ring's inner edge at 11.5), and
// two solid rings of the SAME green a quarter-pixel apart read as one thick
// annulus with a seam, not as two marks. There is no room to open the gap — the
// text bound is 14 and the bead is 10 — so the separation is carried by FORM
// instead of distance: the halo is DASHED and the bead's ring is not. Combined
// with the pulse, that is what makes it a second mark rather than a fatter edge.
export const NEXT_HALO_RADIUS = BEAD_R + 2.5;
export const NEXT_HALO_STROKE = 2;
export const NEXT_HALO_OPACITY = 0.85;
export const NEXT_HALO_DASH = [3, 3];

// ── The halo has to survive Overview (req #3271) ────────────────────────────
// Every world node draws inside `<Group scaleX={k} scaleY={k}>`, and Konva's
// `strokeScaleEnabled` defaults to TRUE — so radius, stroke width AND dash
// pitch above are all multiplied by k. MEASURED on the live plan (pipeline 2,
// 136 rows, world width 3620): `kDefault = max(kFit, K_READABLE)` is 0.8 at
// every realistic panel width, so the 'out' level is by definition k < 0.4, and
// since req #3312 the plan OPENS at or below that on a 1440px panel — the
// landing is `factoryDefaultScale ≤ kFit = 0.398`. At k = 0.4 this mark
// renders as a 0.8px stroke with 1.2px dashes at 85% opacity, and its inner
// edge sits 0.1px from the bead's own eligible ring — a sub-pixel dashed
// outline touching a solid one. It is not that the halo is not drawn at
// Overview; it is that at Overview it is not a ring.
//
// THE MARK MUST MOVE OUTWARD, and there is no alternative. Thickening it in
// place is arithmetically impossible: the text bound below caps the outer edge
// at 13.75 and the bead's ring caps the inner edge at 11.5, so the world stroke
// can be at most 2 — exactly what it already is. Making the stroke
// screen-constant while pinning the radius merges the two rings for all k < 0.8.
// The only room is the room the LABELS vacate, which is why the magnification
// stops exactly where the labels start being drawn — `K_READABLE`, the same
// scale `labelsLegible` gates them on (req #3280). It is one scale answering
// both halves, so "the halo never crosses a drawn label" needs no coordination
// between two predicates: it is true by arithmetic.
//
// ONE MAGNIFICATION FOR THE WHOLE MARK, never per-property. Radius, stroke and
// dash all scale by the same `m`, so the halo is always the same SHAPE — the
// dash-to-circumference ratio is fixed, and because only the halo grows while
// the bead does not, the gap between the two rings can only OPEN. A fix that
// counter-scaled the stroke alone would close it.
//
// `m` targets a fixed on-screen radius, so below that scale the apparent
// thickness is flat and the dash pitch is flat — one appearance, held constant
// as you zoom out instead of thinning to nothing. THE CEILING BINDS BELOW
// k = 0.4 and the flat band runs from there up to K_READABLE: on the live plan
// the request is 2.0× at k = 0.4 (exactly the ceiling), 1.6× at k = 0.5, 1.0× at
// k = 0.8, and 9.65× at the zoom floor (0.0829, a 1200px panel) against a
// ceiling of 2.0. Measured at k = 0.398 — fit-to-width on a 1440px panel, at or
// just above where the plan now lands: radius 9.94px, stroke 1.59px, dash
// 2.39px, ten dash cycles, and 4.67px of clear space to the bead — against
// 4.97 / 0.80 / 1.19 / 0.10 before. The mark is unambiguous at the scale the
// question is asked at, which is what was actually broken.
//
// **WHICH IS THE VIEW THE PLAN OPENS IN AGAIN, after two corrections in
// opposite directions.** #3271 said it was; reviewing req #3280 found that
// false, because `resetView` then landed on `kDefault` = 0.8 (ratio 1, level
// 'mid', ids at 11.0px) and the broken band was reached by zooming OUT of the
// landing view rather than into it. Req #3312 moved the landing onto
// `factoryDefaultScale`, so on the live plan the reader once again ARRIVES in
// this band. The arithmetic below never depended on which end the reader comes
// from — only these descriptions did, three times now, which is the argument
// for stating the measured scale and letting the landing be named separately.
//
// ── AND THE SCALE IT FREEZES AT IS DERIVED, NEVER CHOSEN (req #3280) ────────
// #3271 aimed the mark at its own world radius, i.e. at the k = 1 appearance,
// and switched the magnification off with the LABEL PREDICATE — which is binary
// on the semantic level. That put a 2.0× → 1.0× step one wheel-click wide at the
// L1/L2 boundary (k = 0.400 on the live plan): the mark HALVED as the reader
// zoomed in, and what it halved to was the 0.80px stroke with 1.20px dashes,
// 0.10px from the bead's own ring, that #3271 was filed to remove.
//
// The magnification now stops at `K_READABLE` — the scale at which the labels
// start being drawn (`labelsLegible`) — and the screen size it holds is the size
// the UNMAGNIFIED mark has AT that scale. That identity is the whole fix:
//
//     NEXT_HALO_SCREEN_RADIUS === NEXT_HALO_RADIUS * K_READABLE
//     ⇒  m(K_READABLE⁻) = 1  =  m(K_READABLE⁺)
//
// so the two branches MEET rather than meeting-with-a-step.
//
// AND THE LEVEL BOUNDARIES ARE NOT CROSSINGS AT ALL ANY MORE — that is the
// stronger statement, and the reason it holds on every plan size. The CURVE is a
// function of `k` ALONE, continuous on each of its three pieces and at both
// joins (`m(0.4) = 2` from either side; `m(K_READABLE) = 1` from either side),
// so where the level ladder happens to put L1/L2 is irrelevant to it.
//
// (Req #3324 added a `labelsDrawn` SHORT-CIRCUIT in front of that curve, for the
// pinned case the arithmetic above cannot cover. It changes no value Auto ever
// computes — the curve is already exactly 1 at every legible `k`, and Auto draws
// no label below that — so every claim in this block still describes the mark a
// reader sees while the selector is on Auto. See `nextHaloMagnify`.) The
// live plan's boundary lands at k = 0.400, which IS one of the joins — the
// arithmetic is continuous there anyway, and that is the coincidence the first
// draft of this comment mistook for the reason.
//
// A CHOSEN number here would break that. 12.5 was chosen, and it is what made
// the k = 0.8 halo (10.00px radius, the unmagnified mark) 25% smaller than the
// k = 0.79 halo. The derivation is the invariant; the value 10 is its output.
export const NEXT_HALO_SCREEN_RADIUS = NEXT_HALO_RADIUS * K_READABLE;
// The halo's outer edge at m = 1: 13.5 against the 14 the text bound allows.
const NEXT_HALO_OUTER = NEXT_HALO_RADIUS + NEXT_HALO_STROKE / 2;
// HOW FAR IT MAY GROW: the SMALLEST clearance to any piece of world furniture
// the halo would otherwise cross. Enumerated, because picking one and reasoning
// about it is how this got written twice and reviewed wrong twice:
//
//  - HALF A COLUMN PITCH was the first ceiling (2.37×). Wrong in the other
//    direction: under #3271's target the live plan asked for 2.51 at k = 0.398,
//    so the screen-constant branch would never once have executed on the very
//    plan this was filed against.
//    **THAT MEASUREMENT NO LONGER REFUTES IT** (found in review of req #3280).
//    The target is now `K_READABLE / k`, so the same k asks for 2.011 — below
//    2.37 — and a 2.37 ceiling would leave the branch reachable. The candidate
//    is still rejected, but on the SECOND ground below rather than this one:
//    half a column pitch is a one-constraint answer that says nothing about the
//    rest of the furniture. Kept with its refutation corrected rather than
//    deleted, because this list exists so a future reader does not re-derive a
//    ceiling that was already tried.
//  - "NEVER REACHES ANOTHER BEAD" was the second (3.76×). It cleared beads and
//    crossed everything else — the epic chip's strip at every k below 0.371
//    (which INCLUDES the opening view on a 1200px panel), and the launch-unit
//    box on all four sides through essentially the whole 'out' band. Both
//    found in review, measured, not hypothetical.
//
// THE CEILING MOVED WHEN THE LAUNCH RECTANGLE LEFT, AND THAT WAS A DECISION
// (req #3371). THREE of the seven entries were that rectangle's own edges —
// below (28, the binding one across the whole module), above (40) and to the
// side (31.2) — and deleting it deleted them. The remaining
// entries are unchanged, so the binding constraint simply moved to the next
// one: `epicChipStrip` at 31, i.e. `NEXT_HALO_MAX_OUTER` 27 -> 30 and
// `NEXT_HALO_MAX_MAGNIFY` 2.0x -> 2.222x. The mark req #3271 exists for is 11%
// larger at Overview at zero cost, and `NEXT_MARK_FLOOR_K` (below) moves with
// it, so the ring survives 10% further out.
//
// PINNING THE CEILING AT THE OLD LITERAL 27 WAS CONSIDERED AND REFUSED. It
// would have kept every measured figure in the halo record byte-valid
// ([[pipeline-2-visualizer-design]] § 2.2 tabulates both ceilings, today and
// "with the box gone") and changed no pixel — at the cost of a constant
// nothing derives, which is exactly the failure the
// `min()`-over-an-enumerated-list shape was built to prevent. The list is
// exhaustive by construction; a hand-pinned number is a fourth wrong ceiling
// waiting to be discovered.
//
// So the ceiling is `min()` over the real list, and each entry is DERIVED from
// the constant that actually places that furniture. A new mark near a bead adds
// an entry here; it does not get to be discovered on screen.
//
// TWO DELIBERATE EXCLUSIONS, named so the rule above is not read too literally:
//
//  - DEPENDENCY ARCS radiate FROM the bead — `x1 = a.x + BEAD_R + 1`, so every
//    arc starts 11 world px from the centre, on the bead's own row. They passed
//    through the halo at m = 1 too. Entering them here would force the ceiling
//    below the UNMAGNIFIED radius, i.e. it would forbid the mark that already
//    exists. An arc is not furniture the halo runs into; it is the bead's own
//    connection, and crossing it reads as attachment rather than collision.
//  - LANE WIRES run straight THROUGH bead centres by construction, for the same
//    reason.
//
// ONE PIECE OF FURNITURE USED TO BE UNBOUNDABLE HERE, and it left with the
// launch grouping. The launch-unit LETTER belonged to a NEIGHBOURING column's
// rectangle, so no per-bead clearance could reach it and the fix lived in the
// letter's own placement search instead (`beadRectsOf`, which sized its rects
// on `max(BEAD_HIT_RADIUS, NEXT_HALO_MAX_OUTER)` for exactly that reason).
// Req #3371 deleted the letter, the search and that function, so every piece of
// furniture a halo can reach is now IN the list below — which is what this list
// has always claimed to be.
//
// The test for this lives in the halo's own describe block and measures against
// the layout's OUTPUT — chip strips, bead pairs — not against the constants
// below, because measuring against the constants is exactly what let two wrong
// ceilings through review.
// THE SMALLEST CARD THIS LAYOUT CAN PRODUCE (req #3498): no requirements, and
// `stepLabel: 'title'`, which is the mode that reserves no L3 title line. Every
// clearance below is stated against it, because a clearance has to hold for the
// TIGHTEST geometry, not the typical one.
export const MIN_CARD_H = cardHeight(0, 'title');
export const NEXT_HALO_CLEARANCES = {
    // The epic chip's strip, above a LANE-0 bead — still the binding entry.
    // A LANE's top is the band header's bottom (for lane 0), which is where the
    // chip's strip ends, and every card is CENTRED in its lane — so a lane-0
    // bead sits half a LANE below the strip, and the lane is at least one card
    // tall. The room is therefore `laneCardH/2 >= MIN_CARD_H/2`, and `headerH`
    // cancels, the same way it did when the room was the step label's rise (req
    // #3498 — the label does not float above the bead any more, so that
    // derivation went with it). NOT `h/2` of this card: a short card in a tall
    // lane sits lower, never higher, so the minimum lane is the binding case.
    // It describes the chip's RESTING position: `placeEpicChips` pins a chip
    // down into the band body while its band is partly scrolled off, and in that
    // state the chip overlaps beads and halos alike. Pre-existing sticky
    // behaviour, not something a world clearance can promise about.
    epicChipStrip: MIN_CARD_H / 2,
    // The time axis's vertical slot rules, drawn at column LEFT EDGES — so half
    // the column pitch, which is now uniform. Non-binding by a long way (248.5
    // against the chip strip's 34) and listed because a list that quietly drops
    // an entry stops being the index it claims to be.
    slotRule: (CARD_W + CARD_GAP_X) / 2,
    // The BAND rectangle, the last piece of world geometry a bead can reach:
    // the deepest lane's bead is half a card above its lane's bottom, plus the
    // gap that lane reserves below it.
    bandRect: MIN_CARD_H / 2 + CARD_GAP_Y,
    // The nearest other bead's own outer ring. VERTICALLY that is two half-cards
    // plus the lane gap; horizontally it is the whole column pitch, which is
    // several times larger now that a column is a card wide — so the vertical
    // neighbour is the one that binds, and the old horizontal derivation
    // (a column floor times the smallest width factor) has no terms left.
    neighbourBead: MIN_CARD_H + CARD_GAP_Y - BEAD_OUTER_RADIUS,
};
// ── THE MARK'S OWN SIZE IS A DESIGN LIMIT, NOT WHATEVER FITS (req #3498) ────
// The clearances above say what the halo MAY NOT exceed; they have never said
// what it should be. Three requirements — #3271, #3280, #3299 — tuned this mark
// against what a reader needs to SEE at Overview, and they landed on 33.
//
// Growing the card by the type scale widened every clearance with it (the
// binding one is half a card), which would have inflated the mark to 46.6 as a
// side effect of a TYPEFACE change nobody connected to it. A mark that changes
// size because an unrelated constant moved is exactly the drift this module's
// derived-not-chosen discipline exists to prevent — so the derivation is now
// `min(what fits, what was designed)` and the second term is stated.
const NEXT_HALO_DESIGN_MAX = 33;
// One world pixel of margin, so "clears it" is not "touches it".
export const NEXT_HALO_MAX_OUTER = Math.min(
    NEXT_HALO_DESIGN_MAX,
    Math.min(...Object.values(NEXT_HALO_CLEARANCES)) - 1);
export const NEXT_HALO_MAX_MAGNIFY = NEXT_HALO_MAX_OUTER / NEXT_HALO_OUTER;

/**
 * The magnification applied to the next-step halo's radius, stroke width and
 * dash pattern (req #3271, made continuous by req #3280).
 *
 * CONTINUOUS IN `k`, AND SHORT-CIRCUITED BY THE LABELS. #3271 took a boolean
 * "does this level draw the labels?" — because the halo may only grow into room
 * the labels are not using — and a BOOLEAN BOUND PRODUCES A STEP: the mark
 * halved in one wheel-click at whatever absolute scale the level ladder happened
 * to put the boundary at. #3280 deleted the argument, because `labelsLegible`
 * gated the labels on `K_READABLE` and this stops magnifying at `K_READABLE`, so
 * **labels drawn ⇒ `m === 1`** followed by ARITHMETIC and the two could not
 * disagree.
 *
 * REQ #3324 VOIDED THAT COINCIDENCE and the argument is back, deliberately: a
 * PINNED level draws its labels at every scale, including the whole band below
 * `K_READABLE` where this magnifies, so nothing about `k` alone can still imply
 * the labels are absent. The guarantee is therefore stated rather than inferred —
 * and it protects the same 14-world-px text bound that fixes
 * `NEXT_HALO_RADIUS`.
 *
 * **#3280's SMOOTHNESS IS NOT GIVEN BACK.** The step it deleted came from the
 * boolean turning over during a WHEEL, at the ladder's L1/L2 boundary. It cannot
 * now: on the AUTO branch `labelsDrawn` implies `labelsLegible(k)`
 * (`planLevelFor` demotes an illegible level to 'out'), and this function is
 * already exactly 1 at every legible `k` — so the argument changes nothing Auto
 * ever computes, at any scale, and the continuous meet at `K_READABLE` stands.
 * The one place it bites is a PIN held below that scale, where the mark's size
 * changes at the moment the reader clicks a chip: a discrete act, with the
 * canvas visibly changing anyway, which is the opposite of an unexplained jump
 * mid-gesture.
 *
 * It is 1 at and above `K_READABLE`, so zooming IN never changes the mark and
 * the halo at 'in' — and across the top half of 'mid' — is byte-identical to
 * what it was before any of these requirements existed.
 *
 * @param {number} k  the world→screen scale actually being drawn at
 * @param {boolean} labelsDrawn  `drawsLabelKind('step', level)` for this
 *   frame. **REQUIRED (req #3374 P4)** — it used to default to `false`, the
 *   permissive answer, which is exactly what let a SECOND renderer that forgot
 *   the argument magnify over its own drawn labels in silence. There is
 *   exactly one production caller (`PipelinePlanVisualizer`'s `labelsDrawn`,
 *   read from the same `drawsKind` the label loop uses); a second one must
 *   pass it too, loudly enforced below rather than assumed. A caller that only
 *   wants #3280's bare-`k` curve passes `false` explicitly.
 * @returns {number} a factor in [1, NEXT_HALO_MAX_MAGNIFY], monotone
 *   non-increasing in `k` and continuous everywhere
 */
export function nextHaloMagnify(k, labelsDrawn) {
    if (typeof labelsDrawn !== 'boolean') {
        throw new Error('nextHaloMagnify: labelsDrawn is required (req #3374 P4) — '
            + 'pass false explicitly for the bare-k curve');
    }
    if (labelsDrawn) return 1;
    if (!Number.isFinite(k) || k <= 0) return 1;
    const want = NEXT_HALO_SCREEN_RADIUS / (NEXT_HALO_RADIUS * k);
    if (!(want > 1)) return 1;
    return Math.min(want, NEXT_HALO_MAX_MAGNIFY);
}

// ── Below the ring's reach: a different MARK (req #3299) ───────────────────
// #3271/#3280 made the halo hold a flat 10px screen radius from `K_READABLE`
// down to `K_READABLE / NEXT_HALO_MAX_MAGNIFY` (k = 0.4 on the live plan) by
// magnifying it. Below that the magnification is already AT its ceiling —
// `NEXT_HALO_CLEARANCES` forbids growing the ring's WORLD radius any further,
// on pain of running into the launch-unit box — so the mark's ON-SCREEN size
// resumes shrinking with `k`: `stroke(k) = NEXT_HALO_STROKE * NEXT_HALO_MAX_MAGNIFY * k`,
// linear in `k` with nothing left to counteract it.
//
// THE ACCEPTANCE FLOOR: a stroke needs to read as an outline rather than as a
// blur, and 1.2 world/screen px is that floor (half the weight of the flat
// band's own 1.6px stroke — the flattest a form this thin can go and still be
// legible, measured against the flat band already shipping). Solving
// `stroke(k) >= NEXT_MARK_MIN_STROKE_PX` for `k` gives the derived floor below
// — DERIVED, not chosen, so a future change to the stroke width or the
// magnification ceiling moves this floor with it rather than silently
// disagreeing (the same discipline `NEXT_HALO_MAX_OUTER` and
// `NEXT_HALO_SCREEN_RADIUS` already follow). **THIS FLOOR IS NOW k = 0.27**,
// measured by evaluating this module — matching the split asserted in
// `pipelinePlanLayout.test.js` ("cannot reach the deep zoom-out band, and
// says where it stops").
//
// IT MOVED, AND THE DERIVATION IS WHY IT MOVED CORRECTLY (req #3371). It read
// k = 0.3 for as long as `NEXT_HALO_MAX_MAGNIFY` was 2.0; removing the launch
// rectangle's three entries from `NEXT_HALO_CLEARANCES` raised the ceiling to
// 2.222x and this floor fell with it, so the RING survives 10% further out
// instead of handing over to the dot. `NEXT_MARK_SCREEN_RADIUS` is INVARIANT
// across that change (8.100 both ways — `NEXT_HALO_MAX_OUTER x NEXT_MARK_FLOOR_K`,
// and the two terms cancel exactly), which is the whole reason a moving ceiling
// is a note here rather than a redesign.
//
// BELOW IT NO RING CAN WORK, at any ceiling: `NEXT_HALO_CLEARANCES` bounds the
// ring's WORLD size, and world size buys nothing once the ENTIRE mark is under
// a handful of screen px — the ring is already smaller than the stroke it
// would need (`NEXT_HALO_MAX_OUTER * k` is under 3 screen px at the live
// zoom floor, asserted alongside the split above). So the fix is not a bigger
// or thicker ring; it is a DIFFERENT MARK, built the opposite way round:
//
//   - THE RING is sized in WORLD units and scaled by the camera, which is
//     exactly why it disappears — it was always going to, past some k.
//   - THE DOT below is sized in SCREEN units and counter-scaled against the
//     camera (`NEXT_MARK_SCREEN_RADIUS / k` as a world radius, so the camera's
//     own `× k` cancels it back to a fixed on-screen size) — a FLAT mark that
//     cannot vanish because nothing about it depends on how far zoomed out the
//     camera is. This is the "screen-space marker anchored at the bead" the
//     requirement asked to be investigated, not a tuning of the ring.
//
// IT DOES NOT RECOLOUR THE BEAD, and the colour language is untouched: the
// dot is drawn as its OWN node, in the halo's existing colour
// (`style.haloColor` — eligible green, or suppressed red), replacing only the
// RING's geometry below this floor. The bead's own fill (state) and ring (run
// mode) keep drawing at their own — now sub-pixel — world size beneath it,
// exactly as they always have; nothing here adds a fourth channel or repaints
// an existing one. What changes is FORM, the same axis the ring-vs-bead
// separation already spends: a filled dot needs no minimum stroke width to
// read, so it has no floor at all, whereas a stroked ring fundamentally does.
//
// OVERLAP WITH NEIGHBOURS IS ACCEPTED, not solved here. Beads sit ~26 world px
// apart, i.e. a handful of screen px at the zoom floor, so any mark that reads
// at that scale necessarily spans several columns — the clearance list above
// cannot bound it because the clearances are stated in world units and this
// mark deliberately is not. Concretely, at the live zoom floor (k = 0.0829)
// the dot's WORLD radius is `NEXT_MARK_SCREEN_RADIUS / k` ≈ 97.7 world px
// against that ~26px pitch — several columns each side, wider than the ring
// it replaces ever reached even at its own ceiling. That trade only matters
// when many neighbouring steps are eligible at once, which is not the common
// case this deep in Overview; a plan where it is stays legible as "a lot is
// eligible here", which is still true.
//
// `ZOOM_MIN_RATIO` is left AT 0.25 (not tightened, not loosened): the
// requirement asked whether it is the right floor "measured against what a
// reader can actually do at the scales it admits", and what a reader can now
// do at the floor is see which steps are eligible, which they could not
// before. Raising the floor would remove scales this fix just made useful;
// lowering it is a separate, unmeasured question this fix does not answer.
export const NEXT_MARK_MIN_STROKE_PX = 1.2;
export const NEXT_MARK_FLOOR_K = NEXT_MARK_MIN_STROKE_PX
    / (NEXT_HALO_STROKE * NEXT_HALO_MAX_MAGNIFY);
// The dot's fixed on-screen radius — DERIVED, not chosen, for the same reason
// `NEXT_HALO_SCREEN_RADIUS` is (line ~3320 above): a chosen number here makes
// the two branches disagree at the crossing, exactly the "mark HALVES in one
// wheel-click" defect req #3280 was filed to remove, reintroduced at a new
// threshold. Below the floor the ring's magnification is already capped, so
// its WORLD outer edge is pinned at `NEXT_HALO_MAX_OUTER` and its SCREEN outer
// edge is `NEXT_HALO_MAX_OUTER * k` — shrinking, which is the whole defect,
// but CONTINUOUS, so matching the dot's fixed screen size to that edge AT the
// floor makes the two branches meet with no step:
//
//     NEXT_MARK_SCREEN_RADIUS === NEXT_HALO_MAX_OUTER * NEXT_MARK_FLOOR_K
//
// (mirrors `NEXT_HALO_SCREEN_RADIUS === NEXT_HALO_RADIUS * K_READABLE` at the
// OTHER join). This also fixes a second defect found in review: the dot is
// drawn UNDER the bead's own Group (same draw order the ring always used), so
// it is only visible as the annulus outside the bead's own outer edge —
// `NEXT_MARK_SCREEN_RADIUS - BEAD_OUTER_RADIUS * k`. A CHOSEN 4px radius put
// that annulus under the 1.2px acceptance floor for k in (0.249, 0.300) —
// solid, same eligible green as the bead's own ring, reading as "the ring got
// thicker" rather than as a second mark, exactly what the ring's own dashing
// exists to prevent (see the comment above `NEXT_HALO_RADIUS`). The derived
// value clears the bead by >= 4.7px at every k this mark draws at (worst case
// is the top of the band, k -> NEXT_MARK_FLOOR_K, where the bead is largest);
// asserted in pipelinePlanLayout.test.js rather than left as an accident of
// the chosen number.
export const NEXT_MARK_SCREEN_RADIUS = NEXT_HALO_MAX_OUTER * NEXT_MARK_FLOOR_K;

/**
 * Is `k` below the ring's reach, i.e. must the deep-zoom-out DOT be drawn
 * instead of the halo ring (req #3299)?
 *
 * `false` everywhere the ring already reads (`k >= NEXT_MARK_FLOOR_K`,
 * `NEXT_MARK_FLOOR_K` itself included) — the whole of the k >= 0.3 band this
 * requirement is forbidden from moving stays on the ring, byte-identical.
 *
 * AND `false` WHEREVER THE LABELS ARE DRAWN (req #3324), for the same reason
 * `nextHaloMagnify` returns 1 there: the dot holds a FIXED SCREEN SIZE, so in
 * world units it is the largest this mark ever gets — larger than the magnified
 * ring it replaces — and a pinned level draws its labels at every scale,
 * including this whole band. It never fires in AUTO, where `planLevelFor`
 * demotes an illegible level to 'out' and `NEXT_MARK_FLOOR_K` sits far below
 * `K_READABLE`, so req #3299's mark is untouched at every scale Auto can reach.
 *
 * THE RESIDUAL COST, stated rather than left to be discovered: a reader pinned to
 * L2/L3 below `NEXT_MARK_FLOOR_K` gets the sub-pixel RING that req #3299 was
 * filed about, because the room the dot needs is room the pinned labels are
 * occupying. One click on Auto restores the dot. The alternative — drawing the
 * dot over the pin's own (by then ~4px) labels — trades a mark that is hard to
 * see for a mark drawn through text, which is what `NEXT_HALO_CLEARANCES` exists
 * to forbid.
 *
 * @param {number} k  the world→screen scale actually being drawn at
 * @param {boolean} labelsDrawn  `drawsLabelKind('step', level)` for this
 *   frame. **REQUIRED (req #3374 P4)**, for the identical reason
 *   `nextHaloMagnify`'s own argument is — see its docblock. Pass `false`
 *   explicitly for the pre-#3324 bare-`k` answer.
 * @returns {boolean}
 */
// ── ONE MARK PER CLUSTER (req #3498, user directive) ────────────────────────
// *"one mark per cluster"* — the answer to what the deep-zoom-out next-step DOT
// does when several eligible steps sit close together.
//
// THE DEFECT IT FIXES, measured on live plan 7 at its landing scale (k = 0.072):
// `nextMarkDotRadius` returns a WORLD radius chosen so the dot lands at a fixed
// SCREEN size, and at that scale it is **112.6 world px** — a 225px circle —
// while the six eligible Catch-Up cards are **97.5px apart** vertically. Six
// marks drew as one red capsule. That is not a tuning problem: the whole point
// of the fixed-screen-size dot is that it STOPS shrinking with the camera, so
// the closer you zoom out the more certain the overlap becomes.
//
// Capping the dot was the alternative and it is worse: it re-introduces exactly
// the sub-pixel mark req #3299 added the dot to escape. Merging keeps every
// mark at its readable size and tells the truth about how many steps are under
// it — which is the fact a reader zoomed this far out actually wants.
//
// SINGLE-LINKAGE, and deliberately so: A near B near C is ONE blob on screen
// even when A and C do not touch, so it must be one mark. Union-find over
// pairwise distance; the input is the ELIGIBLE steps only, which number in the
// handful, so the O(n²) sweep is free.
//
// The centroid is the plain mean of the members. It is not any member's own
// position, which is correct — the mark stands for the group, and putting it on
// one member would claim that step in particular.
export function clusterNextMarks(marks, radius) {
    const list = (marks || []).filter((m) => m
        && Number.isFinite(m.x) && Number.isFinite(m.y));
    const n = list.length;
    if (n === 0) return [];
    const parent = list.map((_, i) => i);
    const find = (i) => {
        let r = i;
        while (parent[r] !== r) r = parent[r];
        while (parent[i] !== r) { const p = parent[i]; parent[i] = r; i = p; }
        return r;
    };
    // Touching circles merge, so the threshold is the DIAMETER. A zero or
    // negative radius merges nothing, which is the right answer for a mark with
    // no extent rather than a reason to special-case the caller.
    const reach = 2 * Math.max(0, radius);
    for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
            const dx = list[i].x - list[j].x;
            const dy = list[i].y - list[j].y;
            if (Math.hypot(dx, dy) < reach) {
                const a = find(i);
                const b = find(j);
                if (a !== b) parent[a] = b;
            }
        }
    }
    const groups = new Map();
    list.forEach((m, i) => {
        const root = find(i);
        if (!groups.has(root)) groups.set(root, []);
        groups.get(root).push(m);
    });
    return [...groups.values()].map((members) => ({
        x: members.reduce((t, m) => t + m.x, 0) / members.length,
        y: members.reduce((t, m) => t + m.y, 0) / members.length,
        ids: members.map((m) => m.id),
        // The mark's own colour is the group's: a SUPPRESSED member makes the
        // whole cluster read as held, because "some of these are held" is the
        // more cautious of the two readings and the reader cannot see which.
        suppressed: members.some((m) => m.suppressed),
    })).sort((a, b) => a.ids[0] - b.ids[0]);
}

export function nextMarkIsDot(k, labelsDrawn) {
    if (typeof labelsDrawn !== 'boolean') {
        throw new Error('nextMarkIsDot: labelsDrawn is required (req #3374 P4) — '
            + 'pass false explicitly for the bare-k curve');
    }
    if (labelsDrawn) return false;
    return Number.isFinite(k) && k > 0 && k < NEXT_MARK_FLOOR_K;
}

/**
 * The deep-zoom-out dot's WORLD radius for this frame — the value that,
 * multiplied by the camera's own `k`, always renders at
 * `NEXT_MARK_SCREEN_RADIUS` screen px regardless of how small `k` gets.
 *
 * Only meaningful where `nextMarkIsDot(k, labelsDrawn)` is true; the caller picks the
 * branch, this only sizes it.
 *
 * @param {number} k  the world→screen scale actually being drawn at
 * @returns {number} a world radius, or `NEXT_MARK_SCREEN_RADIUS` unscaled if
 *   `k` is non-finite or non-positive (never reached under a real camera, but
 *   never a division by zero either)
 */
// The merged mark's COUNT, in SCREEN px (req #3498). Screen rather than world
// for the same reason the dot's radius is: this mark exists at scales where a
// world-sized glyph is a fraction of a pixel. Sized to sit inside
// `NEXT_MARK_SCREEN_RADIUS` with margin, so the digits never reach the dot's
// edge — two digits is the realistic maximum and three still fits.
export const NEXT_MARK_COUNT_FONT_PX = 9;

export function nextMarkDotRadius(k) {
    return Number.isFinite(k) && k > 0 ? NEXT_MARK_SCREEN_RADIUS / k : NEXT_MARK_SCREEN_RADIUS;
}

// ── Epic focus geometry (req #3204) ─────────────────────────────────────────
// Clicking an epic's name fits that epic's steps to the viewport. This is pure
// geometry over a layout that is already computed, so it lives beside the
// layout rather than in the component: the component's job is to hand the
// resulting {x, y, k} to the d3-zoom BEHAVIOR, and nothing else.
//
// IT IS NOT A MODE. Nothing here is remembered — the two functions below take
// a band and return a transform, and the caller retains neither.

// Margin left on all four sides, in SCREEN px. Screen, not world: it is
// subtracted from the viewport BEFORE the scale is chosen, so the whitespace is
// the same handful of pixels whether the fit lands at k=0.2 or k=2. A world-space
// pad would shrink to nothing on a wide epic and swallow the view on a narrow one.
export const FOCUS_PAD = 44;
// The zoom behavior's scale extent, as multiples of kBase (the fit-to-width
// scale). Exported so the component's `scaleExtent` call, the focus clamp and
// the tests all read ONE pair of numbers instead of three copies.
export const ZOOM_MIN_RATIO = 0.25;
export const ZOOM_MAX_RATIO = 8;
// The focus ceiling and floor, in the same units. The ceiling exists because
// "as close as possible" on a one-step epic is absurd magnification; 2.6 is
// past SEMANTIC_IN_MIN (1.9), so a small epic lands on the Detail level, which
// is the level a reader focusing on one epic wants.
//
// The clamp is NOT a belt-and-braces duplicate of the behavior's own extent.
// `zoom.transform` applies what it is given VERBATIM — unlike `scaleTo` /
// `translateBy` it never calls `constrain`, so nothing re-clamps this at write
// time (verified against d3-zoom 3.0.0's source). What it does do is clamp the
// NEXT wheel gesture against `scaleExtent`, so an out-of-extent k here would
// look fine until the user's first scroll and then jump. Hence: the clamp is
// load-bearing, and it has to agree with the extent — which is why both now
// come from the constants above.
export const FOCUS_MAX_RATIO = 2.6;
export const FOCUS_MIN_RATIO = ZOOM_MIN_RATIO;

// ── AND THE FLOOR IS THE CALLER'S OWN, NOT A RE-DERIVED COPY (req #3274) ────
// `kBase * FOCUS_MIN_RATIO` was that copy, and it had already silently
// desynced. The behaviour's configured floor is
// `Math.min(kFit, kDefault) * ZOOM_MIN_RATIO` (PipelinePlanVisualizer's
// `kZoomFloor`), and since req #3168 `kDefault = Math.max(kFit, K_READABLE)`
// — so on any plan where the READABLE floor binds, `kDefault > kFit` and the
// two expressions are different numbers. MEASURED on live pipeline 2 at a
// 1600px-wide panel: `kFit = 0.275`, `kDefault = 0.8`, so the behaviour's
// floor is 0.069 and the focus refused to go below 0.200 — 2.9× stricter than
// the extent it exists to agree with.
//
// **THAT IS WHAT PINNED THE BAND THIS REQUIREMENT IS ABOUT.** The `Pipeline`
// band wants `k ≈ 0.14` on an 800px panel; clamped up to 0.20 it is 910 screen
// px tall in a panel that is not, so it overflowed BOTH reserves, both
// neighbours left the viewport, and no pad on either side could have helped.
// The reserve above is necessary and this is the other half of sufficient.
//
// The clamp is NOT weakened — it still applies, after the fit, and `k` still
// lands inside `scaleExtent` so the next wheel gesture does not jump. What
// changed is that it now clamps to the extent the behaviour actually has.
// `factoryDefaultScale` takes its floor as a parameter for exactly this reason
// and says so at length; this is that argument applied to the other function,
// after the copy it warned about did the thing it warned about.
//
// **IT IS REQUIRED, AND A MISSING ONE REFUSES THE FIT** (second review). The
// first cut made it optional and fell back to `kBase * FOCUS_MIN_RATIO` — the
// very expression this exists to retire — which turns "somebody dropped the
// argument" into a SILENT restoration of the bug. Measured: with the fallback
// in place, deleting `kZoomFloor` from both of the visualizer's call sites
// re-introduced the defect and the whole suite, E2E included, stayed green,
// because the E2E's fixture plan is small enough that the floor never binds on
// it. Refusing instead makes the same slip a camera that does not move, which
// PIPE-14 fails on immediately and a reader would notice in a second.
//
// So the floor joins the viewport and `kBase` in the guard below rather than
// getting a default. `factoryDefaultScale` takes its own floor positionally
// with no default for the same reason, and this is the same argument.

// ── The NEIGHBOUR'S NAME IS PART OF THE FIT (req #3274) ─────────────────────
// `FOCUS_PAD` used to be the whole of the space the bands above and below got,
// and nothing in the transform knew that a neighbour needs a SPECIFIC amount of
// room to render its name. On a large epic — the `Pipeline` band of pipeline 2
// is the case reported — the fit filled the panel with one band and the reader
// lost all sense of where in the plan they had landed.
//
// So the vertical pad is now TWO things added, not one constant reused:
//
//   · `FOCUS_PAD` — the focused band's own breathing room, keeping it off the
//     viewport edge. Unchanged, on all four sides.
//   · `FOCUS_LABEL_H` — the strip the NEIGHBOUR draws its name in, DERIVED from
//     the chip's own metrics rather than a number that happens to be 44.
//
// They are added rather than `max`ed because they are different jobs: a name
// jammed against the focused band's edge is legible but reads as chrome, and
// the reserve exists so the neighbour's name sits in clear space.
//
// **THIS IS THE FULL CHIP, not the floored one.** `placeEpicChips` sizes a chip
// from its band's own epic lane and floors it at `EPIC_CHIP_MIN_H` (req #3272),
// so the height it actually draws at is somewhere in `[EPIC_CHIP_MIN_H,
// EPIC_CHIP_H]` and depends on a `k` this function has not chosen yet.
// Reserving the maximum is the answer that is right at every scale and needs no
// second pass; the difference is 6.4px.
//
// THE CONSEQUENCE, STATED RATHER THAN HIDDEN: a large epic is fitted slightly
// smaller than it was. That is the trade the requirement asks for — orientation
// beats maximum magnification — and it is the same trade `FOCUS_MAX_RATIO`
// already makes in the other direction for a one-step epic.
export const FOCUS_LABEL_H = EPIC_CHIP_H + 2 * CHIP_MARGIN_Y;

/**
 * Does `band` have another band ABOVE it, BELOW it, or both (req #3274)?
 *
 * The answer decides which sides of the focus get the label reserve, because
 * "an epic at the very top of the plan" has no name to protect above it and
 * reserving the strip there would spend the viewport on nothing.
 *
 * Decided from WORLD Y ALONE, never from the position of `band` in the array.
 * `bandFitRect` keeps the same discipline and for the same reason (req #3201
 * changes the order `computePlanLayout` emits bands in), and it costs one pass
 * over 4–10 bands.
 *
 * A band is "above" when it ends at or before this one starts AND begins
 * strictly higher; "below" is the mirror. The second half of each test is what
 * makes `band` fail both against itself WITHOUT an identity check (review
 * finding): the tolerance alone let a band of height ≤ 1e-6 satisfy
 * `b.y + b.height <= top + 1e-6` against its own row, and an identity check
 * would only have worked for the callers that pass the same object back.
 * Bands never overlap in world Y, so for every OTHER band exactly one holds.
 *
 * @returns {{above: boolean, below: boolean}} both false when there is nothing
 *   to compare against — a one-band plan, or a degenerate input.
 */
export function epicFocusNeighbours(layout, band) {
    const none = { above: false, below: false };
    const bands = layout?.bands;
    if (!Array.isArray(bands) || !band) return none;
    if (!Number.isFinite(band.y) || !(band.height > 0)) return none;
    const top = band.y;
    const bottom = band.y + band.height;
    let above = false;
    let below = false;
    for (const b of bands) {
        if (!b || !Number.isFinite(b.y) || !(b.height > 0)) continue;
        if (b.y < top && b.y + b.height <= top + 1e-6) above = true;
        else if (b.y + b.height > bottom && b.y >= bottom - 1e-6) below = true;
    }
    return { above, below };
}

/**
 * The world-space rectangle an epic band occupies.
 *
 * Vertically: the band's own extent, which the layout already computed
 * (`band.y` → `band.y + band.height`, header strip included — the epic name
 * lives there and belongs inside its own fit).
 *
 * Horizontally: everything the band's OWN steps DRAW, not the whole plan's
 * width. That is the union of
 *   - the columns those steps occupy (min depth → max depth), and
 *   - the beads and every label belonging to those steps.
 *
 * The second term is not redundant. Since req #3119 a step label is CENTRED on
 * its column and sized to `staggerBudget()` — its own column plus 40% of the
 * narrower neighbour on each side — so a label in the band's first or last
 * column legitimately draws OUTSIDE the column extent. Fitting to columns alone
 * clips it, and does so worst in the production default view (`vertical` +
 * `title`, PipelineDetail.jsx), where the labels are longest. Measured on the
 * live plan before this was fixed: the rightmost title of one band landed 7px
 * PAST the viewport edge with the pad supposedly reserving 44.
 *
 * Non-contiguous columns are spanned rather than skipped: an epic with steps at
 * depth 0 and depth 4 wants both on screen, and there is no meaningful fit that
 * omits the middle.
 *
 * Reads only `band.stepIds`, `layout.nodes` and `layout.labels`, so it makes no
 * assumption about the ORDER of `layout.bands` (req #3201 changes that order
 * and introduces per-band horizontal origins).
 *
 * @returns {{x:number,y:number,w:number,h:number}|null} null when the band has
 *   no placed steps or the layout has no columns — the caller must not fit.
 */
export function bandFitRect(layout, band) {
    if (!layout || !band || !layout.nodes || !Array.isArray(layout.colX)) return null;
    if (!(band.height > 0) || !Number.isFinite(band.y)) return null;
    const ids = new Set(band.stepIds || []);
    let left = Infinity;
    let right = -Infinity;
    const span = (a, b) => {
        if (!Number.isFinite(a) || !Number.isFinite(b)) return;
        if (a < left) left = a;
        if (b > right) right = b;
    };
    for (const id of ids) {
        const n = layout.nodes.get(id);
        if (!n || !Number.isFinite(n.depth)) continue;
        // The column, and the CARD drawn in it (req #3498 — it was the bead's
        // radius until the step became a box, and a card is wider than a bead
        // by a factor of twenty).
        span(layout.colX[n.depth] - layout.colW[n.depth] / 2,
             layout.colX[n.depth] + layout.colW[n.depth] / 2);
        span(n.left, n.right);
    }
    if (right <= left) return null;
    // Every label this band's steps draw — step titles/ids, requirement ids and
    // the reserved title slot all carry `stepId`. The epic label does not, and
    // must not: it renders as an HTML overlay pinned to the viewport, not in the
    // world, so its world x=12 would drag every band's fit back to the gutter.
    for (const l of (layout.labels || [])) {
        if (l.stepId == null || !ids.has(l.stepId)) continue;
        span(l.x, l.x + (l.w || 0));
    }
    if (!Number.isFinite(left) || !Number.isFinite(right) || right <= left) return null;
    return { x: left, y: band.y, w: right - left, h: band.height };
}

/**
 * The {x, y, k} that fits `band` into a `size.w` × `size.h` viewport with
 * FOCUS_PAD screen px of margin on all four sides — plus, on each vertical side
 * that HAS a neighbouring band, FOCUS_LABEL_H more for that neighbour's own
 * epic name (req #3274).
 *
 * The scale is the tighter of the two axis fits, clamped into the behavior's
 * scale extent; the translation then places the rect inside the reserved
 * window, spending the slack on the non-binding axis as equal margin rather
 * than piling it on one side.
 *
 * @param {number} kFloor the caller's OWN configured `scaleExtent` minimum.
 *   REQUIRED — omitting it returns null rather than re-deriving one. See the
 *   FLOOR block above for why a re-derived copy is the bug this closes, and why
 *   refusing beats defaulting.
 * @returns {{x:number,y:number,k:number}|null} null when there is nothing
 *   sensible to fit (no viewport yet, no columns, degenerate band, no floor).
 */
export function epicFocusTransform(layout, band, size, kBase, kFloor) {
    return fitTransform(bandFitRect(layout, band), size, kBase,
        epicFocusNeighbours(layout, band), kFloor);
}

/**
 * The world-space rectangle ONE STEP occupies (req #3253).
 *
 * Exactly `bandFitRect`'s union, narrowed from a band's steps to one:
 *   - the column that step sits in, and the bead drawn in it, and
 *   - every label belonging to it — the step's own title, its requirement marks,
 *     and the reserved title slot, all of which carry `stepId`.
 *
 * The second term is what makes the rect right rather than merely centred. A
 * step's requirement marks stack BELOW its bead (`n.y + 14 + reqDy + i *
 * REQ_LINE_H` — `reqDy` is the swim-lane offset, req #3362) and its title sits
 * ABOVE it, so a fit to the bead alone would centre the bead
 * and push the requirement ids — the thing the reader followed the link to see —
 * off the bottom of a tight viewport. The band case fits vertically to
 * `band.height`, which already contains all of that; a single step has no such
 * precomputed extent and has to take the union itself.
 *
 * The COLUMN is included for the same reason it is in `bandFitRect`: it keeps a
 * step whose label happens to be short from being magnified past its neighbours
 * into a view with no context. The `FOCUS_MAX_RATIO` clamp handles the rest.
 *
 * THE RECT IS THE STEP'S OWN EXTENT AND NOTHING MORE — what keeps a single
 * bead from filling the panel is `stepFocusTransform`'s own framing choice
 * (a stated "N across" scale for one step, req #3498; `FOCUS_PAD`'s fixed
 * screen margin for a set, req #3503), not anything baked in here. This rect
 * answers "what does the step occupy", full stop; nothing about framing
 * belongs in it.
 *
 * @returns {{x:number,y:number,w:number,h:number}|null} null when the step is
 *   not placed on this layout — the caller must not fit.
 */
export function stepFitRect(layout, stepId) {
    if (!layout || !layout.nodes || !Array.isArray(layout.colX)) return null;
    const n = layout.nodes.get(stepId);
    if (!n || !Number.isFinite(n.depth) || !Number.isFinite(n.x) || !Number.isFinite(n.y)) {
        return null;
    }
    let left = Infinity;
    let right = -Infinity;
    let top = Infinity;
    let bottom = -Infinity;
    const span = (x0, x1, y0, y1) => {
        if (!Number.isFinite(x0) || !Number.isFinite(x1)
            || !Number.isFinite(y0) || !Number.isFinite(y1)) return;
        if (x0 < left) left = x0;
        if (x1 > right) right = x1;
        if (y0 < top) top = y0;
        if (y1 > bottom) bottom = y1;
    };
    // req #3498 — the step's own extent is its CARD, and the card's box already
    // contains every label that carries this `stepId`, so the label sweep below
    // can no longer widen the rect. It is kept regardless: it is what makes this
    // function's answer true BY MEASUREMENT rather than by an assumption about
    // where the labels were put.
    const colW = layout.colW?.[n.depth];
    if (Number.isFinite(layout.colX[n.depth]) && Number.isFinite(colW)) {
        span(layout.colX[n.depth] - colW / 2, layout.colX[n.depth] + colW / 2,
             n.top, n.bottom);
    }
    span(n.left, n.right, n.top, n.bottom);
    for (const l of (layout.labels || [])) {
        if (l.stepId !== stepId) continue;
        span(l.x, l.x + (l.w || 0), l.y, l.y + (l.h || 0));
    }
    if (!(right > left) || !(bottom > top)) return null;
    return { x: left, y: top, w: right - left, h: bottom - top };
}

/**
 * The {x, y, k} that centres ONE STEP in the viewport (req #3253).
 *
 * The receiving end of the requirement page's "view on plan" link. Shares
 * `epicFocusTransform`'s arithmetic verbatim — including the scale clamp, which
 * is load-bearing rather than defensive: `zoom.transform` applies what it is
 * given without calling `constrain`, so a k outside the behaviour's own
 * `scaleExtent` would look correct until the reader's first wheel event snapped
 * it back. A second copy of that clamp that "only had to agree" is the desync
 * this file has already taken two review findings on, so there is one.
 *
 * `kFloor` is REQUIRED here for the same reason it is on the band fit — see the
 * FLOOR block above `bandFitRect`.
 *
 * @returns {{x:number,y:number,k:number}|null} null when the step is not on this
 *   layout, there is no viewport yet, or no floor was handed in.
 */
export function stepFocusTransform(layout, stepId, size, kBase, kFloor) {
    return stepsFocusTransform(layout, [stepId], size, kBase, kFloor);
}

/**
 * The rect a SET of steps occupies — the union of their own fit rects.
 *
 * Added at req #3365, when the epic name's second click was re-pointed from
 * "the next launch step" to "the active and pending work in this epic" (user
 * directive). Ids that resolve to nothing are SKIPPED rather than failing the
 * whole union: a set is a request to frame what exists, and one unlaid step
 * must not cost the reader the other nine.
 *
 * @param {Object} layout
 * @param {Iterable<number>} stepIds
 * @returns {?{x:number,y:number,w:number,h:number}}
 */
export function stepsFitRect(layout, stepIds) {
    let left = Infinity;
    let right = -Infinity;
    let top = Infinity;
    let bottom = -Infinity;
    for (const id of (stepIds || [])) {
        const r = stepFitRect(layout, id);
        if (!r) continue;
        if (r.x < left) left = r.x;
        if (r.x + r.w > right) right = r.x + r.w;
        if (r.y < top) top = r.y;
        if (r.y + r.h > bottom) bottom = r.y + r.h;
    }
    if (!(right > left) || !(bottom > top)) return null;
    return { x: left, y: top, w: right - left, h: bottom - top };
}

// ── A SINGLE CARD IS FRAMED BY THE STEPS-ACROSS CONTROL, NOT BY A FIT ──────
// User directive, 2026-08-13: *"when zooming into a single step card ... the
// viewport will center on the card vertically and horizontally and provide a
// 5 card width viewport ... anytime we click and the zoom is to a single card"*.
//
// WHY A SCALE AND NOT A FIT. Every other focus target answers "how big is this
// thing?" and derives `k` from it, which is right for a band — bands differ in
// size, and the reader wants the whole of whichever one they picked. A CARD is
// the one target on this canvas whose world size is FIXED and UNIFORM (req
// #3498 made it so), so fitting to it re-derives, every time, a number that
// could simply be stated. Stating it is also what makes the answer STABLE: a
// step with two requirements and a step with ten are two different rect
// heights, and a vertical fit would land them at two different magnifications
// for no reason the reader can see. Five columns is five columns.
//
// It is the SAME quantity the toolbar's `10 8 6 4 2` buttons pick, through the
// same `stepsAcrossScale`, so arriving at a card by link and arriving by button
// put the canvas in states a reader can compare. 5 is deliberately NOT on that
// ladder: the buttons are a coarse ladder for browsing, this is the one rung
// that says "this card, in its context", and it sits between the ladder's 4 and
// 6 rather than pretending to be either.
//
// This scale, and its clamp, are therefore the WHOLE of the single-card
// path — no `fitTransform` margin ever runs on it (the multi-step case is a
// tight fit; see `stepsFocusTransform`), and the clamp is the zoom
// behaviour's own extent rather than `FOCUS_MAX_RATIO`. That aesthetic
// ceiling exists to stop a fit magnifying a small target into a view with no
// context; here the context is the request, so the only clamp that may bind
// is the hard one — a `k` outside `scaleExtent` would look right until the
// reader's first wheel event snapped it back.
export const STEP_FOCUS_STEPS_ACROSS = 5;

/**
 * The camera that frames a SET of steps.
 *
 * ONE STEP IS THE EXCEPTION, AND IT IS HANDLED HERE rather than in
 * `stepFocusTransform` so that BOTH ways of arriving at a single card take it —
 * the `?step=` deep link from the requirement editor, and an epic whose second
 * click resolves to one step. A rule that lived in the single-id wrapper would
 * have covered the first and silently missed the second.
 *
 * TWO OR MORE STEPS GET A TIGHT FIT, NOT A PADDED ONE (req #3503). This used
 * to inflate the raw rect by a proportional margin (`STEP_FOCUS_CONTEXT`,
 * inherited from the single-launch-rectangle framing req #3297 drew, then
 * carried across two more subjects it was never re-derived for — see the
 * removed constant's git history) before fitting. Retuning that fraction
 * fixed a fixture in isolation but not the general case: measured on the
 * reported epic (9 open steps in a single-row sequence, no vertical binding),
 * `k ∝ 1/(1 + 2·C)` regardless of C's value, so ANY proportional-of-content
 * margin scales with the very thing the reader asked to see tightly — 9
 * columns rendered at ~12 card widths at the old 0.25, and would still have
 * rendered at ~11.25 retuned to 0.125. A margin that is a FRACTION OF THE
 * CONTENT cannot converge on "as tight as the viewport allows"; only a margin
 * that is a fraction of the VIEWPORT can.
 *
 * So this is now `fitTransform` on the RAW rect, with no inflation at all —
 * exactly `epicFocusTransform`'s own arithmetic, reused rather than
 * reinvented. `fitTransform` already reserves `FOCUS_PAD` fixed screen px on
 * every side and picks whichever axis — width or height — actually needs the
 * tighter scale, so a SET of steps is framed by the same "identify the
 * horizontal and vertical extent, fit both at a small fixed screen margin"
 * rule the whole-epic view already uses, just over a smaller rect. Measured
 * on the reported epic (9 open steps, single row): a fixed 44px edge on
 * whatever scale the fit chooses, not a fraction of 9 that grows or shrinks
 * with it — 9.28 columns of viewport on a 1730px panel, a little more on a
 * narrower one, in contrast to the retired proportional margin's 11.6–13.9.
 */
export function stepsFocusTransform(layout, stepIds, size, kBase, kFloor) {
    const rect = stepsFitRect(layout, stepIds);
    if (!rect) return null;
    if (placedStepCount(layout, stepIds) === 1) {
        // `layout.colPitch` — req #3503 review: without it this framed a step
        // at the scale-1 pitch regardless of the active Step Width rung, so
        // "5 across" measured 3.27 at rung 4.
        const t = centreTransform(rect, size,
            stepsAcrossScale(STEP_FOCUS_STEPS_ACROSS, size?.w, layout?.colPitch), kBase, kFloor);
        // Falls through to the fit only when `size.w` is non-finite (e.g.
        // `Infinity`) — the one input where `stepsAcrossScale` nulls but
        // `fitTransform`'s own `w > 0` guard does not. Not reachable with a
        // real viewport; kept so a degenerate one still gets a transform
        // rather than none at all.
        if (t) return t;
    }
    return fitTransform(rect, size, kBase, null, kFloor);
}

/**
 * How many of `stepIds` are actually PLACED on this layout (req #3498).
 *
 * The single-card rule turns on the number of steps the reader will SEE, which
 * is not `stepIds.length`: `stepsFitRect` deliberately skips ids that resolve to
 * nothing (req #3365), so a two-id set with one unlaid step frames exactly one
 * card and must be framed as one. Counting the input instead would give that
 * reader a fit, and the two would differ for a reason invisible on screen.
 *
 * Duplicate ids collapse — a set is a set — so the same id twice is one card.
 */
export function placedStepCount(layout, stepIds) {
    const seen = new Set();
    for (const id of (stepIds || [])) {
        if (seen.has(id)) continue;
        if (stepFitRect(layout, id)) seen.add(id);
    }
    return seen.size;
}

/**
 * Put a rect's CENTRE at the viewport's centre, at a scale that is GIVEN rather
 * than derived (req #3498).
 *
 * The counterpart to `fitTransform` for a target whose magnification is already
 * decided. It reserves nothing for neighbouring band names and nothing for the
 * pinned ruler, and that is correct for its one caller: the subject is at the
 * viewport's middle, where neither can reach it.
 *
 * `kBase`/`kFloor` are here only for the clamp, which is the zoom behaviour's
 * `scaleExtent` verbatim — see the block above `STEP_FOCUS_STEPS_ACROSS`.
 *
 * @returns {{x:number,y:number,k:number}|null} null on any input that cannot
 *   produce a transform, so the caller does something else rather than driving
 *   the camera to NaN.
 */
export function centreTransform(rect, size, k, kBase, kFloor) {
    if (!rect) return null;
    const w = size?.w || 0;
    const h = size?.h || 0;
    if (!(w > 0) || !(h > 0) || !(k > 0) || !(kBase > 0) || !(kFloor > 0)) return null;
    const kc = Math.min(Math.max(k, kFloor), kBase * ZOOM_MAX_RATIO);
    const cx = rect.x + rect.w / 2;
    const cy = rect.y + rect.h / 2;
    return { k: kc, x: w / 2 - cx * kc, y: h / 2 - cy * kc };
}

// The centring itself, shared by both focus targets (extracted req #3253).
// A rect, a viewport and the base scale in; the transform d3-zoom is handed out.
//
// `neighbours` (req #3274) is the ONLY thing that differs between the two
// callers now. `epicFocusTransform` hands in which vertical sides have a band
// whose name needs room; `stepFocusTransform` hands in nothing, and with both
// flags false every line below reduces — algebraically, not approximately — to
// the symmetric arithmetic this function has always done. That reduction is
// asserted in vitest rather than asserted here.
function fitTransform(rect, size, kBase, neighbours, kFloor) {
    if (!rect) return null;
    const w = size?.w || 0;
    const h = size?.h || 0;
    // `kFloor` sits in this guard rather than carrying a default — see the
    // FLOOR block above. A caller that drops it gets no transform, which is a
    // camera that visibly does not move, instead of a fit clamped against a
    // re-derived floor that silently disagrees with the zoom behaviour's.
    if (!(w > 0) || !(h > 0) || !(kBase > 0) || !(kFloor > 0)) return null;
    // ── THE VERTICAL RESERVE (req #3274) ────────────────────────────────────
    // One label strip per side that has a neighbour to draw one. See
    // FOCUS_LABEL_H for why it is added to FOCUS_PAD rather than maxed with it,
    // and why it is the full chip height rather than the floored one.
    const labelTop = neighbours?.above ? FOCUS_LABEL_H : 0;
    const labelBottom = neighbours?.below ? FOCUS_LABEL_H : 0;
    // ── AND THE PINNED RULER, ON THE TOP SIDE ONLY ──────────────────────────
    // The strip above the focused band is not all usable: req #3254 pins the
    // time ruler to the viewport top and req #3257 stops every epic name just
    // BELOW it (`topInset: rulerScreenBottom(t)` in the visualizer), so a
    // reserve that ignored the ruler would park the neighbour's name underneath
    // it. Charged only when there IS a band above, which is NOT the same claim
    // as "the ruler is pinned" and must not be written as one (review finding):
    // pinning is `t.y ≤ 0`, and a fit whose world origin lands BELOW the panel
    // top draws the ruler at its natural world position instead, where the
    // strip it costs is `(band.y − RULER_H)·k` and this charge buys nothing.
    // The charge is therefore an UPPER BOUND on what the ruler can take, not a
    // measurement of what it did — deliberately, because the alternative reads
    // `t.y`, which is the value being solved for. It over-reserves only where
    // the plan's first band is within `72/k + RULER_H` world px of the origin,
    // which on live pipeline 2 is band 0 alone — and band 0 has no band above
    // it, so the branch is not taken there at all.
    //
    // Its height is `RULER_H · max(k, 1)` — see `rulerScreenMag`. It used to be
    // `RULER_H · k`, a pure WORLD height, and the closed form below was derived
    // from exactly that: `rect.h · k ≤ h − padTop(k) − padBottom` with
    // `padTop(k) = FOCUS_PAD + labelTop + RULER_H · k` is LINEAR in k, so the
    // ruler simply joined the rect on the fitted side of the inequality.
    //
    // req #3365 made the strip screen-sized below k = 1, so that reserve is now
    // PIECEWISE-LINEAR and the single closed form is wrong on one side of the
    // hinge — it under-reserved by the whole difference (7px charged against a
    // 36px strip at the scale this plan opens in), which is precisely the
    // "neighbour's name parked underneath the ruler" this block exists to
    // prevent. Both pieces still have closed forms and they SELECT rather than
    // combine, because each is valid on one side of k = 1:
    //
    //   k ≤ 1: the strip is a CONSTANT `RULER_H` screen px, so it belongs with
    //          the two pads — `k ≤ (availH − RULER_H) / rect.h`.
    //   k ≥ 1: the strip is `RULER_H · k`, the old world charge — `k ≤ availH /
    //          (rect.h + RULER_H)`, unchanged.
    //
    // The two agree at k = 1 and the choice between them is not a guess: the
    // low-branch answer is ≤ 1 exactly when the high-branch answer is, since
    // both reduce to `availH ≤ rect.h + RULER_H`. So solving the low branch and
    // asking whether its answer lands in its own domain decides it outright,
    // with no iteration and no discontinuity at the hinge.
    const rulerTop = neighbours?.above ? RULER_H : 0;
    // A viewport narrower than twice the pad has no room for the margin at all.
    // `max(half, minus-the-pads)` rather than a conditional: the conditional has
    // a cliff at exactly the pad sum where one pixel of growth changes the
    // available width from 88 to 1 and zooms out ~88×. Never reachable in
    // production (the panel has `minHeight: 480`), but a discontinuity that
    // sharp is a trap for the next caller, not a saved branch. The vertical
    // sum is now the reserve above plus the reserve below rather than 2 × one
    // constant, and the guard is the same shape over the new value.
    const availW = Math.max(w * 0.5, w - 2 * FOCUS_PAD);
    const availH = Math.max(h * 0.5, h - 2 * FOCUS_PAD - labelTop - labelBottom);
    // The vertical fit, on whichever side of the hinge its own answer lives.
    // With no ruler charged, both branches collapse to `availH / rect.h`.
    const kFitLow = (availH - rulerTop) / rect.h;
    const kFitH = kFitLow <= 1 ? kFitLow : availH / (rect.h + rulerTop);
    const kFit = Math.min(availW / rect.w, kFitH);
    const k = Math.min(Math.max(kFit, kFloor), kBase * FOCUS_MAX_RATIO);
    // The reserve at the scale actually chosen. `k` may be well below `kFit`
    // (the width bound), or above it (the FOCUS_MIN_RATIO floor), so these are
    // re-read from `k` rather than assumed to be what the fit solved for.
    // `max(k, 1)` for the same reason the fit above branches — the strip's
    // screen height, read at the scale actually chosen rather than at the one
    // the fit solved for.
    const padTop = FOCUS_PAD + labelTop + rulerTop * Math.max(k, 1);
    const padBottom = FOCUS_PAD + labelBottom;
    const padSum = padTop + padBottom;
    // The rect sits inside the window `[padTop, h − padBottom]`, centred in it —
    // so the slack on a non-binding axis is still split evenly, and the reserve
    // still lands on the side that asked for it. The reserved height is split in
    // the padTop : padBottom RATIO rather than assigned outright, which is what
    // keeps this continuous through the `max(half, …)` guard above: where the
    // guard does not bind, `h − availY` IS `padSum` and the first term is
    // exactly `padTop`; where it does, both reserves shrink together instead of
    // one of them eating the whole viewport.
    const availY = Math.max(h * 0.5, h - padSum);
    return {
        x: w / 2 - (rect.x + rect.w / 2) * k,
        y: (h - availY) * (padTop / padSum)
            + (availY - rect.h * k) / 2 - rect.y * k,
        k,
    };
}

// ── THE BASE VIEW = FACTORY DEFAULT (req #3216 D1, req #3312) ───────────────
// "Reset" used to mean "back to `kDefault`", the READABLE landing scale (req
// #3168, `K_READABLE` above) — fit-to-width floored at a legible text size.
// #3216 redefined what the control returns to: fully zoomed out so the whole
// plan's VERTICAL extent is visible, one click, from any pan or zoom. "reset
// that lands somewhere the user still has to zoom out from is not reset." On a
// plan with many epic bands the readable floor can sit ABOVE the scale that
// needs, which is exactly the failure mode this function exists to rule out —
// it is deliberately NOT `kDefault`, and legibility is not a concern it weighs
// at all.
//
// **AND SINCE req #3312 IT IS THE LANDING VIEW TOO.** #3216 left the two apart,
// so a plan OPENED at `kDefault` — zoomed in past fit-to-width with the world
// origin at the panel's top-left, i.e. on the top epic's name — and the reader
// had to click Reset to see the plan they had just opened. There is now ONE
// base view and this function computes it; the component's `resetView` applies
// it for the landing and for the header's Reset alike, so the two cannot
// disagree. THE COST, stated because a reader meets it on open: on a plan too
// tall to fit at `K_READABLE` the landing is below `labelsLegible` and opens as
// bare beads — precisely what Reset has shown on those plans since #3216, and
// what was asked for.
//
// PURE and exported for the same reason `epicFocusTransform` is (the comment
// two functions up): this is a fit computation over `layout`/`size`, testable
// with plain numbers, and the canvas component's job is only to draw what it
// returns.
/**
 * The scale at which the WHOLE plan — both axes, not just the width `kFit`
 * already fits — is visible in a `size.w` × `size.h` viewport.
 *
 * The tighter of the two axis fits, exactly `epicFocusTransform`'s own
 * "contain" idiom applied to the whole world instead of one band's rect.
 * Floored at `kFloor` — the CALLER's own configured `scaleExtent` minimum,
 * taken as a parameter rather than re-derived here, because
 * `zoom.transform` applies what it is given VERBATIM and does not clamp it
 * (see PipelinePlanVisualizer's `scaleExtent` comment): a k below the floor
 * would look right until the next wheel event snapped it back, the same bug
 * class `epicFocusTransform`'s own clamp exists to avoid. A re-derived
 * `kFit * ZOOM_MIN_RATIO` here would only agree with the real floor by
 * algebraic coincidence (today, `Math.min(kFit, kDefault) === kFit` because
 * `kDefault = Math.max(kFit, K_READABLE)`) — a future caller whose floor
 * formula changes would silently desync a copy but cannot desync a value it
 * hands in itself. Where that floor actually binds, the zoom behavior itself
 * already refuses to scroll out any further on this plan — the honest edge
 * of what panning it allows, not this function failing its own definition.
 *
 * @param {{width:number,height:number}} layout the world dimensions
 * @param {{w:number,h:number}} size the viewport, in screen px
 * @param {number} kFit the fit-to-width scale the caller already has
 * @param {number} kFloor the caller's own zoom behavior's configured minimum
 * @returns {number} `kFit` itself when the viewport or the plan has not
 *   measured yet — the same "nothing to fit" fallback `kFit` uses.
 */
export function factoryDefaultScale(layout, size, kFit, kFloor) {
    if (!(size?.h > 0) || !(layout?.height > 0) || !(kFit > 0)) return kFit || 0;
    const kVertFit = size.h / layout.height;
    return Math.max(Math.min(kFit, kVertFit), kFloor);
}

// ── The legal region of a transform (req #3168's bound, extracted req #3252) ──
// The "scroll pane" rule: the world may overshoot the panel by at most HALF A
// PANEL on each side, measured on screen at every scale, so a pan can never
// carry the whole plan out of view. It lived as a closure inside
// PipelinePlanVisualizer's zoom behaviour, which was correct while the zoom
// behaviour was the only thing that could produce a transform.
//
// Req #3252 gave it a second producer: a viewport RESTORED from storage. That
// one arrives through `zoom.transform`, which applies what it is given verbatim
// and calls neither `constrain` nor `scaleExtent` (the `epicFocusTransform`
// comment above, verified against d3-zoom 3.0.0) — so a camera saved when the
// panel was tall, restored into a short one, would sit outside the bound until
// the reader's first gesture snapped it. Two copies of this arithmetic that
// "only have to agree" is the desync `factoryDefaultScale`'s own comment already
// argues against, so there is one copy and both callers read it.
//
// `Math.min(0, …)` / `Math.max(0, …)` is what keeps the DEFAULT view — world
// origin at the panel's top-left — legal on a plan smaller than the panel.
// Without it the bound would force a re-centre on the very first transform.
/**
 * `t` clamped into the pan bound, and its scale into `[kMin, kMax]`.
 *
 * Pass `t.k` for both bounds to clamp the translation only, which is what the
 * zoom behaviour's own `constrain` wants — d3 has already applied `scaleExtent`
 * by the time it calls that.
 *
 * @param {{x:number,y:number,k:number}} t
 * @param {{w:number,h:number}} size the viewport, in screen px
 * @param {{width:number,height:number}} layout the world dimensions
 * @param {number} kMin
 * @param {number} kMax
 * @returns {{x:number,y:number,k:number}}
 */
export function clampPlanTransform(t, size, layout, kMin, kMax) {
    const k = Math.min(Math.max(t.k, kMin), kMax);
    const w = size?.w || 0;
    const h = size?.h || 0;
    const loX = Math.min(0, w / 2 - k * (layout?.width || 0));
    const loY = Math.min(0, h / 2 - k * (layout?.height || 0));
    return {
        x: Math.min(Math.max(t.x, loX), Math.max(0, w / 2)),
        y: Math.min(Math.max(t.y, loY), Math.max(0, h / 2)),
        k,
    };
}

export { STEP_DONE, STEP_RUNNING, STEP_PENDING };
