// pipelinePlanLayout.js — pure geometry for the Plan visualizer (req #3115),
// the product form of the POC viz-generate.py Plan mode archived in req #3080.
//
// PURE LOGIC ONLY: engine PlanRows in, world-space geometry out.
// No React, no Konva, no DOM text measurement — widths come from a fixed
// monospace character metric so the zero-overlap guarantee is decidable here and
// testable in vitest without a canvas (the konvaSwarmModel.js separation).
//
// The layout language (POC, kept verbatim unless noted):
//   - Initiative bands stacked vertically, one per DOMINANT initiative (design rule 10), in
//     `initiatives.sort_order` since req #3430 — the AUTHORITATIVE initiative display order
//     (user ruling 2026-08-09), and this stack is the surface that ruling is
//     about. Since req #3861 the order is HARD: every creator appends a new initiative to
//     its plan, the reader re-orders by dragging the name bar, and every live NULL was
//     backfilled. An initiative with NO `sort_order` (a row cleared by hand) is UNORDERED
//     and falls back to the req #3201 rule, below every ordered initiative: DERIVED-START order,
//     earliest-starting initiative on top, never-started initiatives last, initiative id
//     ascending as the tie-break. (Before #3201 that fallback was
//     first-appearance over display order, which had two problems: it made a
//     band's position move whenever an epic was appended, and it said nothing at
//     all about time.)
//   - TIME-SLOT columns left-to-right (req #3201). A column is a position on a
//     calendar proxy, no longer raw dependency depth — see the block comment
//     above `computeTimeColumns` for the whole model. Dependency depth survives
//     as the HARD FLOOR: an epic's column is never less than 1 + the maximum of
//     its dependencies', so every arc still points forward.
//   - Chain-aware swim lanes inside each band: an epic takes its first same-initiative
//     dependency's lane when free, and that lane is RESERVED across the columns
//     the chain spans, so no unrelated bead sits on an arc's path. When several
//     dependents want one lane, the earliest-created (lowest epic id) is its
//     heir and a later branch opens a row beside it (req #3669).
//   - Requirement ids BELOW the bead: 'horizontal' lays them on one line and the
//     column grows to fit; 'vertical' stacks one per line and the lane pitch
//     grows instead. Epic label ABOVE the bead: the epic id, or the epic title
//     (req #3080 POC addendum 2026-07-27 — the ID/Title toggle #3115 inherits);
//     column widths account for whichever is drawn. Zero label overlap holds in
//     all four combinations BY CONSTRUCTION, and the exported label rects let
//     tests assert it rather than trust it.
//   - THE EPIC IS THE LAUNCH UNIT (Pipeline 2.0, req #3371). The multi-epic
//     launch grouping this surface used to draw — a dashed teal rectangle, a
//     letter, a leader line, a contiguous lane run holding its members together
//     and 16px of extra band header reserving a strip for that letter — is gone
//     entirely. An epic carries its own `/swarm-start` argument list, so the plan
//     TABLE renders that command on the epic's own row and the canvas draws one
//     bead per launch. Do not re-introduce a launch-unit rectangle here: with
//     one epic per command there is nothing left for it to group, and its
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
//   1. Band header height 40 (POC 34): the POC's initiative label and a lane-0 epic
//      label could brush within a pixel; the taller header buys a real gap so
//      the overlap invariant is provable, not marginal.
//   2. Every lane reserves a TITLE SLOT under the requirement ids (pitch grows
//      ~14px): the 'in' zoom level draws the epic title there, truncated to the
//      column width. Reserving it unconditionally keeps zoom a pure transform —
//      level changes never relayout, so the overlap guarantee holds at every k.

import {
    EPIC_DONE, EPIC_RUNNING, EPIC_PENDING, canFileIntoEpic, TERMINAL_REQUIREMENT_STATUSES,
} from './pipelineModel';
// THE LADDER ITSELF, imported rather than passed in (req #3324): `planLevelFor`
// below is the ONE place the four modes are resolved, and a resolution that took
// the ladder's answer as an argument would leave half of Auto at the call site —
// which is where the two-levels-at-once confusion #3324 fixes came from. The
// same ladder the swarm canvas uses, deliberately (`semanticLevel`'s own note).
import { semanticLevel } from '../konvaSwarmModel';
import { localDayOf } from './pipelinePlanTime';
import { formatClock, formatEndClock } from './planEpicTimes';

// ── POC design language (viz-generate.py palette, kept verbatim) ────────────
export const PLAN_VIZ_PALETTE = {
    bg: '#0d1420',
    panel: '#111b2b',
    line: '#26374f',
    wire: '#3a5580',
    // The dependency-arc stroke connecting epics (req #3366) — brightened from
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
    // `runningFill` (#FFB300) is GONE (req #3775, user directive: "Flashing
    // yellow for doing work should be eradicated from the pipeline area"). A
    // running epic pulses its bar (the bead's fill at L1) in its own EPIC
    // COLOUR now — see `beadStyle`. `runningRing` stays: it is the static
    // `development` requirement colour, not an epic mark.
    runningRing: '#ffd769',
    pendingFill: '#22314b',
    eligibleRing: '#7ee08a',
    // The run-mode pill (req #3580, user directive: "green auto and blue
    // manual"). Its own entries — a control's colours, not the bead's — and
    // deliberately NOT `eligibleRing` or `badgeFill`: the eligible ring means
    // "may launch now" and the count badge sits on the same line, so either
    // green reused would make the pill read as one of those. Dark panel text
    // on both (8.9:1 and 6.2:1).
    runAuto: '#4ade80',
    // ORANGE since req #3742 — the pill is the control for the epic colour
    // `epicManual`, so it wears it (it was blue, `#4d9bff`). Dark panel text
    // on it, 7.1:1.
    runManual: '#ff7a1a',
    // The pause status bubble's two colours (req #3226) — a NEW channel
    // (SCOPE: is this band's launch suppressed?), so neither reuses an
    // existing entry outright even where a hue is nearby, to avoid the bubble
    // reading as a restatement of an existing mark (`doneFill`/`doneRing`/
    // `eligibleRing` are all green already, at the EPIC/REQUIREMENT levels the
    // colour-language table below enumerates). Both MEASURED against `panel`
    // (`#111b2b`), 2026-08-01: `pauseActive` 8.22:1, `pausePaused` 5.41:1 —
    // both clear WCAG AA (4.5:1) with room to spare, and neither collides with
    // an existing entry closely enough to be mistaken for it at the bubble's
    // own size. IN the palette object itself, not beside it — "no hardcoded
    // colours" means every colour this surface draws lives HERE.
    pauseActive: '#2ecc71',
    pausePaused: '#ff5252',
    // The epic card's requirement-count badge (req #3503, user directive:
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
    // The epic card's two flag buttons (req #3673) — a control's colours, a
    // channel of their own. `lockOn` (orange, 9.1:1 on `panel`) is a LOCKED
    // padlock and is deliberately not `runningRing`'s amber, which a reader
    // already takes to mean "in flight". `barrierOn` is the striped barrier
    // arm of an epic that holds its downstream; `barrierLight` is the arm's
    // other stripe. YELLOW since req #3742 — the button is the control for the
    // epic colour `epicBarrier`, so it wears it (it was red, then briefly
    // orange in the same requirement).
    lockOn: '#ffa94d',
    barrierOn: '#ffd43b',
    barrierLight: '#ffffff',
    // A LOCKED epic's card perimeter (req #3742, user directive: "a locked epic
    // has a red perimeter") — it replaced the card's padlock button. Its own
    // entry, an epic-level channel: the card's frame is otherwise the run-mode /
    // eligibility ring, and a lock is a fact neither of those states. 5.3:1 on
    // `panel`.
    lockedFrame: '#ff4d4f',
    // ── THE EPIC COLOUR (req #3742, user directive: "simplify the epic color")
    // ONE colour per epic, on the card's border (and the bead's ring at L1),
    // answering "will the work placed here run on its own?":
    //   red     `lockedFrame`     locked — by the epic, its initiative or its plan
    //   orange  `epicManual`      manual — reported, never launched
    //   yellow  `epicBarrier`     a barrier — holds the epics after it
    //   green   `epicWillRun`     none of those: it will run
    // First match wins, in that order (`epicColorOf`). Every one clears WCAG AA
    // on `panel`: 5.3, 6.6, 12.1 and 9.9:1. The card's state bar wears it too
    // (req #3775) and PULSES while the epic is running; the bead's fill keeps
    // Scheduled / Complete at L1 and pulses in this colour while running. "Up
    // Next" stays on its dashed halo.
    epicWillRun: '#4ade80',
    epicBarrier: '#ffd43b',
    epicManual: '#ff7a1a',
    // The Lock view's tints (req #3761): a LOCKED row reads as a red wash over
    // the panel — `lockedFrame`'s hue, at an alpha that keeps text on it past
    // WCAG AA — and the wash CASCADES, so an epic under a locked initiative wears
    // it too. Palette entries, not literals in the view: "no hardcoded colours".
    lockTint: 'rgba(255, 77, 79, 0.18)',
    lockBandTint: 'rgba(255, 77, 79, 0.09)',
    // A holder's outline and badge (req #3761) — the SAME two fills the plan
    // header's orchestration badges wear (`OrchestrationBadges.jsx`: green the
    // lead, orange a subscriber), so one machine reads as one colour on both.
    // 3.3:1 and 7.5:1 on `panel`, past the 3:1 floor for a graphical mark.
    holderLead: '#2e7d32',
    holderSubscriber: '#f57c00',
};

// Initiative band palette (POC EPAL) — band index cycles through it.
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
// covers the live initiative count (7 on pipeline 2, measured 2026-08-01) with no
// wraparound collision. Purple, teal and pink measured "fine" and are kept
// verbatim. Every entry, at whatever length this array grows to, is enforced by
// the 'initiative band palette' guard in pipelinePlanLayout.test.js — see that suite
// for the thresholds and the one-line reason behind each.
//
// POSITIONAL, DELIBERATELY IMPERMANENT (req #3219's second half — "decide
// whether a colour should be STABLE per initiative"): this palette answers "what
// colour is band position N", never "what colour is initiative X". Colour is
// assigned AFTER the bands are sorted into DERIVED-START order (below), so an
// initiative's colour is a function of where it currently sits in that stack — it
// moves when an earlier initiative starts, finishes, or a new one is added ahead of
// it. That was already true before this requirement (see the "Colour AFTER the
// sort" comment at the assignment site) and is kept rather than replaced with a
// stored or hashed per-initiative colour, because a hash collides exactly when it
// matters most: two initiatives landing on the same slot is the one failure this
// surface cannot afford, and only a positional cycle over a palette at least as
// long as the band count can GUARANTEE zero collisions. A stored colour would
// fix identity at the cost of a schema field and a fallback path for every initiative
// that predates it, for a question ("what colour IS initiative X") this surface does
// not currently ask anywhere — the chip, the legend and the band all read the
// SAME band's colour, never one initiative's colour recalled from a past render. If
// a future surface needs initiative-X-is-always-blue, that is the point to add
// stored colour; today it would be speculative machinery for a fact nothing
// reads.
// ── FOUR, AND THEY REPEAT (req #3365 user directive) ───────────────────────
// *"Enjoyable as the multiple colors are for the initiative title, they are too hard
// to read some of them. let's pick a palette of four distinct color (they can
// repeat from top to bottom) but that show up nicely in the visualizer as a
// contrast against the background."*
//
// SEVEN was the count, and the count was the problem. The palette had to fill
// seven slots that were mutually distinguishable, which forced entries down
// into the dark end of the wheel where a hue can be told apart but not READ:
// `#00897b` teal at 3.1:1 and `#c2185b` pink at 3.3:1 against this panel are
// the ones the directive is about — they cleared the 2.7 general floor and
// still made an initiative's NAME (which is drawn in the band's colour) hard work.
//
// At four, every entry can sit in the bright band: the measured range is
// **5.94:1 to 7.75:1**, minimum pairwise CIE76 ΔE **54.0**, and the four hues
// are spread 188° / 22° / 264° / 334° around the wheel — a quarter-turn apart
// or better, so a repeat is the only way two bands can share a colour.
//
// REPEATING IS THE POINT, not a compromise. `bandByKey.get(key).color =
// INITIATIVE_PALETTE[i % INITIATIVE_PALETTE.length]` already cycled; with seven entries a
// reader could believe colour identified an initiative, which it never did (colour is
// band POSITION — see the ONE FACT, ONE CHANNEL note above). Four makes the
// cycle short enough to be obvious.
//
// None of the four collides with a STATE hue: the closest approach to Running
// amber, Complete green or `deployed` green is ΔE 39.3 (orange vs amber), well
// past the 25 the autonomy scale is held to.
export const INITIATIVE_PALETTE = [
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
// | bead FILL              | derived epic state (rule 1)               | EPIC        |
// | bead RING              | run mode — magenta = manual               | EPIC        |
// | outer HALO (dashed)    | eligible now — "Up Next"                  | EPIC        |
// | requirement-id TEXT    | the ACTIVE colour key: requirement status | REQUIREMENT |
// |                        | · machine pin · nothing                    |             |
//
// INITIATIVE IDENTITY IS A CHANNEL WITHOUT A KEY ROW, on purpose (req #3374 P3,
// superseding an earlier draft of this table that listed "initiative BAND
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
// unit IS the epic, so that channel would restate the bead's own level — the
// rule below, exactly — and it is gone rather than re-pointed.
//
// > **ONE FACT, ONE CHANNEL, ONE LEVEL.** No two channels may encode the same
// > fact at the same level. The bead speaks for the EPIC — an aggregate the
// > engine derived. The requirement id speaks for the REQUIREMENT — the atomic
// > stored fact the aggregate was derived FROM. They are different questions, so
// > both may be on screen at once; what may never happen is a second channel
// > restating the bead's own derived state, which is what a "epic state" colour
// > on the ids would have been.
//
// The corollary, and the reason the scale below is NOT Darwin's chip palette:
// **the panel's state hues are RESERVED — amber means in flight, green means
// done, anywhere on this surface.** A scale drawn here either AGREES with them
// or avoids them. So `development` takes the Running amber and `met` takes the
// Complete green (agreement: the requirement fact and the epic fact genuinely
// coincide there, and one meaning gets one colour at both levels), while
// Darwin's `authoring` yellow and `development` green are deliberately NOT
// carried — on this panel they would read as Running and Complete respectively,
// which is the exact confusion this rule exists to prevent.
//
// ── What ANIMATES, and why only two things do ──────────────────────────────
// Motion is the loudest channel on the surface, so it is spent on the two
// questions a plan is opened to answer: what is running (the Running epic
// PULSES — the card at L2/L3, the bead at L1) and what runs next (the halo
// BREATHES). They ride ONE Konva.Animation
// on different curves — 0.45→1.0 at ~480ms, 0.25→1.0 at ~900ms — so a running
// epic and a next epic never read as the same rhythm. Nothing else moves.
//
// ── What SIZE means: nothing ───────────────────────────────────────────────
// Every card is one WIDTH and every bead one radius. A card's HEIGHT does vary
// — it grows by one line per requirement (req #3498) — and that is a container
// fitting its contents, the same way a paragraph is as tall as its text; it is
// not a magnitude anybody should read a value off. Column width is uniform,
// lane and band heights are content spacing, and the type scale is a reading
// hierarchy (epic name > requirement row > epic title). **No mark is sized by
// data.** Stated because a key that covers colour and motion but leaves size
// unexplained invites the reader to infer an encoding that is not there.

// The channel table above, as DATA (req #3374 P3). `PipelinePlanVisualizer`'s
// two `KeyGroup`s read their titles from `KEY_GROUP_TITLES`, derived below
// rather than hand-typed a second time, so the on-screen key cannot drift
// from the set of channels marked `inKey`. `initiative` is the one channel with
// `inKey: false` — see the table comment above for why the key omits it.
// req #3498 — the three EPIC channels are named for the mark that carries them
// at L2/L3, which is the CARD. They are the same three facts in the same three
// colours; the bead still carries all three at L1, where no card is drawn.
export const COLOR_CHANNELS = [
    { channel: 'card STATE BAR (bead fill at L1)', level: 'epic', inKey: true },
    { channel: 'card BORDER (bead ring at L1)', level: 'epic', inKey: true },
    { channel: 'outer HALO (dashed)', level: 'epic', inKey: true },
    { channel: 'requirement-id TEXT', level: 'requirement', inKey: true },
    { channel: 'initiative BAND tint/stroke', level: 'initiative', inKey: false },
];
export const KEY_GROUP_TITLES = [...new Set(
    COLOR_CHANNELS.filter((c) => c.inKey).map((c) => c.level),
)];

// ── Requirement-id scale 1 of 3: REQUIREMENT STATUS (the 'state' key) ──────
// `requirements.requirement_status`, the requirement's OWN stored field — not
// the derived epic state, which the bead already owns.
//
// This is what makes a multi-requirement epic legible: an amber `development`
// id beside two green `met` ids says exactly WHICH requirement is holding the
// epic Running, which is a question the bead cannot answer at all.
//
// The 2026-07-27 directive that made these ids white — "a requirement number is
// an identifier, and colouring it was reading as a status" — is honoured rather
// than reversed: the ids are neutral unless a reader turns a key ON, the key
// then names the scale on screen, and the scale really is a status. What was
// wrong before was an unlabelled colour that read as the EPIC's status.
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
// WHY TRACKING MATTERS: a copied hex is exactly the EPIC_FOCUS_CONTEXT
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

// Key order: the lifecycle, not the alphabet. The on-screen key renders every
// status in this order, whether or not the plan contains it (req #3621).
export const REQ_STATUS_ORDER = [
    'authoring', 'approved', 'swarm_ready', 'development', 'met', 'deferred', 'wontfix',
];

// A status this build does not know — a value added to the enum server-side
// before the UI caught up, or a requirement the read did not resolve. Dim, and
// labelled 'unknown' in the key, because inventing a colour for it would make a
// new status silently masquerade as an existing one.
export const REQ_STATUS_UNKNOWN_COLOR = PLAN_VIZ_PALETTE.dim;

// `Object.hasOwn`, not a lookup + `||` fallback: the same discipline
// `isEpicWidth` documents. A bracket lookup for 'constructor' or 'toString'
// resolves to an inherited FUNCTION, and a function handed to Konva's `fill`
// paints nothing with no error to see.
export const reqStatusColor = (status) => (Object.hasOwn(REQ_STATUS_COLORS, status)
    ? REQ_STATUS_COLORS[status] : REQ_STATUS_UNKNOWN_COLOR);

// ── Requirement marks: STACK order under an epic, ORCHESTRATION ORDER, under
// EVERY colour key (req #3676, supersedes req #3503's colour-key sort) ──────
// The user's directive: *"Always display the requirements in an epic by
// orchestration sorted order"*. Req #3503 sorted the stack by whichever colour
// key was on screen, so the same epic listed its work in a different order
// every time the reader changed the key, and none of those orders was the one
// the plan actually runs in. The order is now one fact about the epic, and the
// key only colours it:
//
//   1. NOT COMPLETE above COMPLETE — the major split. Complete is
//      `TERMINAL_REQUIREMENT_STATUSES` (met / deferred / wontfix), the one
//      definition of terminal used everywhere. A status this build does not
//      resolve is NOT terminal: unknown work stays with the open work rather
//      than vanishing below the line.
//   2. `deployed` first, then every other autonomy — the engine's own
//      within-epic preference (`launch_queue`, req #3597/#3649): full autonomy
//      closes itself and drains the plan.
//   3. FIFO — lowest requirement id first, the queue's own tie-break.
//
// The same three keys order the complete group, so a finished epic still
// reads in the order it ran. `doneFrom` is the index of the first complete
// id (`ids.length` when there is none) — the layout draws the complete line
// there, which is what keeps the split visible when the active key colours
// something other than status.
const TERMINAL_REQ_STATUSES = new Set(TERMINAL_REQUIREMENT_STATUSES);

/**
 * Sort an epic's linked requirement ids into orchestration order (req #3676).
 * Ids are compared numerically, and an id that is not a finite number sorts after every
 * numeric one in its group, so the comparator never returns `NaN`.
 *
 * @param {number[]} reqIds
 * @param {Object} [args]
 * @param {(id: number) => ?string} [args.statusOf]    id -> requirement_status
 * @param {(id: number) => ?string} [args.autonomyOf]  id -> coordination_type
 * @returns {{ids: number[], doneFrom: number}}
 */
export function sortReqIdsByOrchestration(reqIds, { statusOf, autonomyOf } = {}) {
    const ids = Array.isArray(reqIds) ? reqIds : [];
    const keyed = ids.map((id) => {
        // `Number(null)` is 0, so a null id is caught before the coercion.
        const n = id == null ? NaN : Number(id);
        return {
            id,
            done: TERMINAL_REQ_STATUSES.has(statusOf?.(id)) ? 1 : 0,
            auto: autonomyOf?.(id) === 'deployed' ? 0 : 1,
            fifo: Number.isFinite(n) ? n : Number.MAX_SAFE_INTEGER,
        };
    });
    keyed.sort((a, b) => (a.done - b.done) || (a.auto - b.auto) || (a.fifo - b.fifo));
    const doneFrom = keyed.findIndex((k) => k.done);
    return { ids: keyed.map((k) => k.id), doneFrom: doneFrom === -1 ? keyed.length : doneFrom };
}

/**
 * Drop each row's CLOSED requirements (req #3686) from rows already run through
 * `orderEpicReqs`: closed ids are the tail from `reqDoneFrom`, so the open ones
 * are a leading slice. `reqDoneFrom` becomes the new length, so the complete
 * line (drawn only at `i === reqDoneFrom`, `i > 0`) is never drawn. A row with
 * nothing closed is returned as the same object.
 */
export function hideClosedReqs(rows) {
    return (rows || []).map((r) => {
        const ids = r.reqIds || [];
        const open = ids.slice(0, r.reqDoneFrom ?? ids.length);
        return open.length === ids.length ? r : { ...r, reqIds: open, reqDoneFrom: open.length };
    });
}

/**
 * The rows a canvas lays out, each with its `reqIds` in orchestration order and
 * `reqDoneFrom` stamped for the complete line (req #3676). Only the ORDER of
 * each row's `reqIds` changes. The row array keeps the engine's own order (bead
 * z-stacking, column and lane placement all key off it), and every other field
 * (`launchReqIds`, `trackingReqIds`, `swarmStartCommand`) is the engine's answer,
 * untouched. Re-ordering the display therefore never changes what `/swarm-start`
 * launches.
 *
 * @param {Object[]} rows
 * @param {Object} [args]  see `sortReqIdsByOrchestration`
 * @returns {Object[]}
 */
export function orderEpicReqs(rows, args = {}) {
    return (rows || []).map((r) => {
        const { ids, doneFrom } = sortReqIdsByOrchestration(r.reqIds, args);
        return { ...r, reqIds: ids, reqDoneFrom: doneFrom };
    });
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
 * Resolve every requirement's machine colour, plus a key entry for EVERY
 * machine in the dictionary and for `Any` (req #3621, user directive: "show all
 * the possibilities instead so I can see the color choices" — the key used to
 * list only the machines this plan uses). A RETIRED machine (`closed`, which
 * `useMachines` keeps on purpose) is not a choice and is left out — unless a
 * requirement still points at it, and a `machine_fk` with no dictionary row
 * gets an entry too, so no mark on the canvas wears an unnamed colour.
 *
 * Fallback hues are dealt over that same full set, lowest id first, so the key
 * and the canvas read one assignment — and a non-Mac/non-Windows machine keeps
 * its hue whichever other machines a given plan happens to use.
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
    const keyed = [...new Set([
        ...(machines || []).filter((m) => !m.closed).map((m) => m.id),
        ...[...reqMachine.values()].filter((v) => v != null)])]
        .sort((a, b) => a - b);
    let fallbackNext = 0;
    const colorById = new Map(keyed.map((id) => {
        const eco = machineEcosystem(machineById.get(id));
        if (eco === 'mac') return [id, MACHINE_MAC_COLOR];
        if (eco === 'windows') return [id, MACHINE_WINDOWS_COLOR];
        const c = MACHINE_FALLBACK_PALETTE[fallbackNext % MACHINE_FALLBACK_PALETTE.length];
        fallbackNext += 1;
        return [id, c];
    }));
    return {
        colorOf: (reqId) => {
            const m = reqMachine.get(reqId);
            return m == null ? MACHINE_ANY_COLOR : (colorById.get(m) || MACHINE_ANY_COLOR);
        },
        legend: [
            ...keyed.map((id) => ({
                key: id,
                color: colorById.get(id),
                label: machineById.get(id)?.title || `Machine ${id}`,
            })),
            { key: 'any', color: MACHINE_ANY_COLOR, label: 'Any' },
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
// (`runningFill`/`runningRing`/`doneFill`/`doneRing`; `runningFill` since
// deleted, req #3775) 89.1, against a 25 floor — this pair reads nothing like
// an epic's own running or done colour.
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

// ── Requirement-id scale: AI MODEL (the 'model' key, req #3863) ────────────
// `requirements.ai_model` — which Claude model the requirement's session is
// launched on. The registry's own comment (req #3422) named it as coming.
//
// AN ORDINAL LADDER LIKE AUTONOMY, so a RAMP: smallest to frontier. The hues
// are the app's MODEL CHIP ramp (`SwarmView/modelChipStyles.js`'s
// `AI_MODEL_COLOR`: haiku red → sonnet amber → opus light green → fable dark
// green), so a requirement's model reads as the same colour on the plan as on
// every card and table chip that shows it. Restated rather than imported:
// that module pulls MUI's colour helpers into what is otherwise a pure layout
// module, and its fable (#388e3c) measures 4.20:1 on this panel — under the
// 4.5:1 floor every swatch here is held to — so this scale lifts fable to
// #43a047 (5.23:1) and keeps the other three exactly.
//
// MEASURED against the panel (#111b2b): minimum contrast 5.23:1 (`fable`),
// minimum pairwise ΔE 21.8 (`opus`/`fable` — the two greens, which the chip
// ramp makes neighbours by design).
export const MODEL_COLORS = {
    haiku: '#e57373',    // red — smallest
    sonnet: '#ffd54f',   // amber
    opus: '#81c784',     // light green
    fable: '#43a047',    // deep green — the frontier
};

// Key order: the ladder, smallest first — same rule as AUTONOMY_ORDER.
export const MODEL_ORDER = ['haiku', 'sonnet', 'opus', 'fable'];

// The column is NOT NULL with a default, so unknown is a model added to the
// enum before the UI caught up — the shared unknown swatch, for autonomy's reason.
export const MODEL_UNKNOWN_COLOR = REQ_STATUS_UNKNOWN_COLOR;

// ── Requirement-id scale 4: SESSION STATUS (the 'session' key, req #3584) ──
// `swarm_sessions.swarm_status` of the requirement's LATEST session — what is
// actually happening to the work right now, which the requirement's own
// status cannot say: `development` covers a session that is planning, one
// that is waiting on the user, one parked in `paused` and one sitting in
// `review`. User directive: *"the session tracks what is happening actually.
// so that should be a color option in the pipeline visualizer"*.
//
// `no_session` is a real member, not the unknown swatch: a requirement no
// session has ever reached is a FACT about the plan (nothing launched it),
// where unknown means this build cannot say. It is only ever written once the
// session reads have SETTLED — see `buildSessionStatusIndex` — so a slow or
// failed read paints unknown rather than claiming nothing ran.
//
// Design rule 9 ("requirement-centric views carry NO session data") is about
// a requirement list turning into a session list. This scale adds one value
// PER REQUIREMENT on a channel the requirement already owns — no session
// identity, row or phase is drawn — so the view stays requirement-centric.
//
// Key order: the session lifecycle, `no_session` first because it precedes
// launch.
export const SESSION_STATUS_ORDER = [
    'no_session', 'starting', 'waiting', 'planning', 'active',
    'review', 'paused', 'completing', 'completed',
];

// Signal's session scale. Two members TRACK colours that already mean the
// same thing elsewhere on this panel, by reference for `REQ_STATUS_COLORS`'
// reason: `active` is Running, `completed` is GO/met. `waiting` and `review`
// are both "stopped for the human" and share ONE attention red (req #3656 user
// directive: *"waiting and review should both be red - the color of action for
// me"*) — a deliberate identical pair, exempt from the separability floor.
export const SESSION_STATUS_COLORS = {
    no_session: '#9e9e9e',                  // grey — nothing launched it
    starting: REQ_STATUS_COLORS.swarm_ready, // blue — launching
    waiting: '#ff3b30',                      // attention red — waiting on a human, same as review (req #3656)
    planning: AUTONOMY_COLORS.implemented,   // violet — building a plan
    active: PLAN_VIZ_PALETTE.runningRing,    // amber — working
    review: '#ff3b30',                       // attention red — stopped for review (req #3636)
    paused: '#e0a3a3',                       // dusty rose — parked
    completing: '#6ee7e7',                   // cyan — closing out
    completed: AUTONOMY_COLORS.deployed,     // green — done
};

// A session status this build does not know, or a requirement whose session
// reads have not loaded. Same swatch as the other unknowns, for their reason —
// and because that is a routine state on every page load, every theme's
// session members are held ≥ ΔE 20 from it (tested), so "not loaded yet" never
// reads as "nothing launched".
export const SESSION_UNKNOWN_COLOR = REQ_STATUS_UNKNOWN_COLOR;

// ════════════════════════════════════════════════════════════════════════════
// PALETTE THEMES (req #3365 user directive)
// ════════════════════════════════════════════════════════════════════════════
//
// *"Give me a UI option to show the current palette and: Status and Autonomy
// color palettes (2) from requirement inside pipeline visualizer. These are
// just colors so stoplight is not necessary. maybe propose a more boring
// business version or two. and anything you think is modern."*
//
// ONE THEME OVER ALL THREE SCALES, not three settings. The initiative bands, the
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
// which is the exact defect the four-entry initiative palette above was cut down to
// fix.
//
// So restraint is carried by SATURATION, not by collapsing the hues. Measured
// mean HSL saturation across all three scales: **Signal 0.836, Slate 0.350,
// Aurora 0.821** — Slate is under half the default's chroma and keeps its hue
// separation, which is what makes it legible AND calm. `aurora` is deliberately
// as saturated as the default: "modern" is a different axis from "restrained",
// and offering two calm themes would be one theme with two names. Every scale
// in every theme clears contrast 4.78:1 and pairwise ΔE 20.4, asserted over the
// REGISTRY so a fourth theme is covered the day it is added.
//
// `stoplight` is assembled FROM `INITIATIVE_PALETTE`/`REQ_STATUS_COLORS`/
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
        initiative: INITIATIVE_PALETTE,
        status: REQ_STATUS_COLORS,
        autonomy: AUTONOMY_COLORS,
        session: SESSION_STATUS_COLORS,
        model: MODEL_COLORS,
    },
    {
        key: 'slate',
        label: 'Slate',
        tip: 'Slate — a restrained business palette: the same hue separation at '
            + 'a little over half the chroma. No stoplight.',
        initiative: ['#7f9fc4', '#c4a37f', '#a98cc4', '#7fc4a8'],
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
        // req #3584. MEASURED minimum ΔE 22.7 (`paused`/`completed`); every
        // member ≥ 22.8 from SESSION_UNKNOWN_COLOR.
        session: {
            no_session:  '#c0c0c0',
            starting:    '#8aa8e6',
            waiting:     '#ff3b30',
            planning:    '#ab84c4',
            active:      '#d4b35c',
            review:      '#ff3b30',
            paused:      '#a0a070',
            completing:  '#6fd0c4',
            completed:   '#8fbf7a',
        },
        // req #3863 — the model-chip ramp at Slate's chroma. MEASURED minimum
        // ΔE 24.1 (`opus`/`fable`), minimum contrast 5.48:1 (`fable`).
        model: {
            haiku:       '#c4847f',
            sonnet:      '#cfb870',
            opus:        '#b0d4a0',
            fable:       '#5b9f74',
        },
    },
    {
        key: 'aurora',
        label: 'Aurora',
        tip: 'Aurora — a modern dark-UI palette: teal through indigo and violet, '
            + 'with in-progress work in yellow-green, on the way to green.',
        initiative: ['#5eead4', '#818cf8', '#f0abfc', '#fcd34d'],
        // Not a stoplight — the directive's ask, met by hue choice rather than
        // by muting.
        //
        // `met`, `wontfix` and `deferred` are THREE GREENS, darkest to lightest
        // (req #3905 user directive: *"Deferred and WONTFIX are both closed and
        // thus should be shades of green ... darkest being met, then the other
        // middle wontfix and last is deferred"*). All three are closed, so they
        // share green's "finished" meaning and differ only in lightness: `met`
        // (tracked to `deployed` in the aurora patch below, L* 79.2), `wontfix`
        // L* 88.4, `deferred` L* 96.5, hues 142°/132°/133°. `met` cannot get
        // darker without moving `deployed` too, so the two others go lighter.
        // MEASURED ΔE 26.7 `met`/`wontfix` (this scale's closest pair), 30.0
        // `wontfix`/`deferred`, ≥ 42.0 from every open status; contrast
        // 12.82:1 and 15.83:1. Slate keeps its own off-lifecycle pair:
        // nothing selects it (see `DEFAULT_PLAN_PALETTE`).
        //
        // `development` is YELLOW-GREEN (req #3588 user directive: *"the
        // difference between swarm-start and dev in the visualizer should be
        // more obvious. currently it is swarm ready blue and dev light blue.
        // its too subtle"*, then *"swarm-ready is blue and met is green"* →
        // *"try yellow green"* → *"make it more yellow"*). The old teal `#5eead4` was the blue-to-green
        // midpoint, inside `swarm_ready`'s own cyan family — ΔE 27.7, clearing
        // the floor of 20 while reading as one colour at a glance. Lime
        // approaches green from the WARM side instead, so it reads as "on the
        // way to green" without touching the blue. Hue 68° — pushed yellower
        // than lime's 83° on the user's call (the old `deferred`, `#fcd34d`
        // at 45°, was what held it there until req #3905 made `deferred`
        // green). MEASURED ΔE 52.6 from `met` (its nearest neighbour), 54.1
        // from `wontfix`, contrast 12.36:1.
        status: {
            authoring:   '#818cf8',
            approved:    '#38bdf8',
            swarm_ready: '#22d3ee',
            development: '#cfe635',
            met:         '#a3e635',
            deferred:    '#e0fce6',
            wontfix:     '#a0f0b0',
        },
        autonomy: {
            discuss:     '#f472b6',
            planned:     '#c4b5fd',
            implemented: '#7dd3fc',
            deployed:    '#4ade80',
        },
        // req #3584 — THE LIVE session scale. `active`/`completed`
        // are assigned in the aurora patch below (tracking, for Signal's
        // reason). `waiting` is the same attention red as `review` (req #3656). MEASURED minimum ΔE 27.0
        // (`starting`/`planning`), minimum contrast 4.87:1 (`review`). `no_session` is a
        // LIGHT neutral, not aurora's mid slate: it must not read as the
        // unknown swatch every mark wears while the session reads load (every
        // member ≥ 32.2 ΔE from it). Since req #3588 `active` (tracking
        // `status.development`) is yellow-green, the one working state on the
        // warm side — it is "on the way to" `completed`'s green, ΔE 52.6.
        //
        // `review` is ATTENTION RED (req #3636 user directive: *"Review is a
        // state that needs my immediate attention. lets try a brighter color
        // like red that is attention getting"*) — the same `#ff3b30` the
        // session chip, row icon and phase bars use, in every theme, so review
        // reads as one colour app-wide. MEASURED ΔE 41.3 from its nearest
        // neighbour (`paused`'s orange), contrast 4.87:1.
        session: {
            no_session:  '#cbd5e1',
            starting:    '#818cf8',
            planning:    '#c4b5fd',
            waiting:     '#ff3b30',
            review:      '#ff3b30',
            paused:      '#fb923c',
            completing:  '#38bdf8',
        },
        // req #3863 — THE LIVE model scale: the app's model-chip ramp (red →
        // amber → light green → deep green, see MODEL_COLORS) in Aurora's own
        // Tailwind-400/300/500 stops. MEASURED minimum ΔE 29.2 (`opus`/
        // `fable`), minimum contrast 6.25:1 (`haiku`).
        model: {
            haiku:       '#f87171',
            sonnet:      '#fcd34d',
            opus:        '#86efac',
            fable:       '#22c55e',
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
// DELIBERATELY NOT patched to `PLAN_VIZ_PALETTE.runningRing` here — it is
// aurora's own literal yellow-green (req #3588, see the registry entry; the
// old `deferred` collision that first kept it off `runningRing` went when req
// #3905 made `deferred` green). `swarm_ready`/`deferred`/`wontfix` stay
// aurora's own literal values — the last two the closed greens of req #3905.
const auroraPalette = PLAN_PALETTES.find((p) => p.key === 'aurora');
auroraPalette.status.authoring = auroraPalette.autonomy.discuss;
auroraPalette.status.approved = auroraPalette.autonomy.planned;
auroraPalette.status.met = auroraPalette.autonomy.deployed;
auroraPalette.session.active = auroraPalette.status.development;
auroraPalette.session.completed = auroraPalette.autonomy.deployed;

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
 * `isEpicWidth` apply to their own stored values.
 */
export function planPalette(key) {
    return PLAN_PALETTES.find((p) => p.key === key) || PLAN_PALETTES[0];
}


// ── The colour key is N SCALES PLUS NONE (req #3168; third scale req #3422) ─
// `state` · `session` · `autonomy` · `model` · `machine` · `none`. It was TRI-STATE when req #3168
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
// The key's measured rect is the keep-out `placeInitiativeChips` resolves the initiative
// names against, and the resolution is HORIZONTAL ONLY by design — moving a
// chip vertically would put it on another band's line, which is a wrong label
// rather than a missing one.
//
// SINCE req #3257 that resolution is a CLIP-OR-DROP, not a displacement: an
// initiative name is pinned to its own band's rectangle and may not slide sideways
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
// ~17x cheaper.** The cause is the clip-or-drop rule above: an initiative name is
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
// still true — #3371 and #3373 emptied the key's launch-unit and initiative-band
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
// container `py: 0.9` (14.4px), the EPIC group (caption 9px + 2.4px gap +
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
// — a genuine, accepted cost, not an oversight: the trade this requirement's
// own doc names for capping the STEEPER axis instead. SINCE REQ #3621 IT IS
// EVERY PLAN'S COST, not only a many-machine plan's: the key lists every value
// of every scale and they share one grid cell, so its width is the nine-member
// session row's (~535px, estimated from character counts) on any plan.
//
// TWO EDGES THIS SWEEP DOES NOT COVER (code review finding, req #3374 P7),
// named rather than silently accepted:
//   1. `PipelinePlanVisualizer`'s `keepOut.x = (viewportW − key.w) / 2` goes
//      NEGATIVE once the key is wider than the viewport, which then drops
//      every initiative chip whose y overlaps the key's band regardless of x. The
//      old 470 cap made that unreachable above a ~500px panel; uncapped width
//      makes it reachable on a panel narrower than the key (~560px since req
//      #3621's every-value key), where the key also clips at both edges.
//      The sweep above stops at w=1100 on a 1500px viewport and never
//      exercises this.
//   2. `110` is an ESTIMATE from typography constants (below), never checked
//      in a live browser — `deployed` coordination skips manual UI review.
//      An overflow here would clip the bottom of the requirement group
//      outside the panel's own background and border, a quieter failure than
//      the width overflow it replaces.
// Neither is asserted against; both are one look at the rendered key (any
// narrow window) away from being closed or ruled out.
//
// HISTORICAL since req #3722: the key left the canvas for a button-local popup,
// so nothing in the component enforces this cap or measures a keep-out any more
// (`PipelinePlanVisualizer` passes `keepOut: null`). The constant and the
// `keepOut` parameter of `placeInitiativeChips` stay for the sweeps in
// pipelinePlanLayout.test.js, which still pin the placement pass's behaviour
// against an arbitrary keep-out rectangle.
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
// THE KEY LISTS EVERY VALUE A SCALE CAN PAINT, not only the ones this plan
// contains (req #3621, user directive: "show all the possibilities instead so I
// can see the color choices"). It used to filter to the plan, to keep the key
// small for the initiative chips; the key's rect is MEASURED and the chips steer
// around whatever size it is, so the cost of the full list is a taller key,
// never an overlap.
//
// `presentReqIds` is the set of requirement ids the plan actually DRAWS (null =
// every requirement). It now decides only whether the `unknown` swatch is
// listed: unknown is not a member of any scale, it is a value this build does
// not recognise, so it appears exactly when a drawn mark is wearing it.
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
 * value on the scale — which decides whether a drawn mark is `unknown` and
 * cannot be read off a hex.
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
    // An id with no requirement row at all counts as unknown too.
    const unknown = ids.some((id) => !known(valueById.get(id)));
    // Every member, in the scale's order — whether or not this plan uses it
    // (req #3621, see the registry's comment above).
    const legend = order.map((v) => ({ key: v, color: paint(v), label: labelOf(v) }));
    if (unknown) legend.push({ key: 'unknown', color: paint(undefined), label: 'unknown' });
    return {
        colorOf: (reqId) => paint(valueById.get(reqId)),
        legend,
    };
}

// The registry. ORDER IS THE TOOLBAR'S ORDER, and it is STATE, SESSION,
// AUTONOMY, MODEL, MACHINE (req #3365 user directive; Session inserted second by
// req #3584's; Model beside Autonomy by req #3863). It was state, machine, autonomy — the
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
    // SECOND, directly after State (req #3584 user directive: "that could be
    // the second in the list after state") — the requirement's status, then
    // what its session is doing about it.
    {
        key: 'session',
        chipLabel: 'Session',
        chipTip: 'Colour the requirement marks by the STATUS of their latest swarm '
            + 'session — click again for none',
        chipName: 'Session — colour the requirement marks by session status',
        keyTitle: 'Requirement id = session',
        // Reads `session_status`, which `buildPlanModel` attaches to each
        // requirement row from the session reads — the composed plan read
        // carries no session data of its own.
        build: ({ requirements, presentReqIds, pal = planPalette() }) => buildEnumColorView({
            requirements,
            presentReqIds,
            field: 'session_status',
            colors: pal.session,
            order: SESSION_STATUS_ORDER,
            paint: (v) => (Object.hasOwn(pal.session, v)
                ? pal.session[v] : SESSION_UNKNOWN_COLOR),
            labelOf: (v) => v.replace('_', ' '),
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
    // After Autonomy (req #3863): both say HOW the requirement's work runs.
    {
        key: 'model',
        chipLabel: 'Model',
        chipTip: 'Colour the requirement marks by AI MODEL — haiku through '
            + 'fable — click again for none',
        chipName: 'Model — colour the requirement marks by AI model',
        keyTitle: 'Requirement id = model',
        build: ({ requirements, presentReqIds, pal = planPalette() }) => buildEnumColorView({
            requirements,
            presentReqIds,
            field: 'ai_model',
            colors: pal.model,
            order: MODEL_ORDER,
            paint: (v) => (Object.hasOwn(pal.model, v)
                ? pal.model[v] : MODEL_UNKNOWN_COLOR),
        }),
    },
    {
        key: 'machine',
        chipLabel: 'Machine',
        chipTip: 'Colour the requirement marks by the MACHINE that ran them — '
            + 'click again for none',
        chipName: 'Machine — colour the requirement marks by the machine that ran them',
        keyTitle: 'Requirement id = machine',
        // Takes no `presentReqIds`: since req #3621 the key lists every machine
        // in the dictionary plus `Any`, so nothing about which epics the plan
        // draws can change its entry set (`buildMachineColorView`).
        build: ({ requirements, machines }) => buildMachineColorView({ requirements, machines }),
    },
];

// The scale for a key, or undefined. A plain `find` over three entries — no
// index to keep in epic, and `undefined` is the honest answer for 'none' and for
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
 * name a colour the marks do not use. Since req #3621 every scale lists every
 * value it can paint, not only the ones the plan contains — the user asked to
 * see all the colour choices — so the key is wider, and the initiative chips steer
 * around its measured rect at the viewport middle-bottom (req #3255).
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
// Type scale (user directive 2026-07-31): epic label +50%, requirement ids
// +25%, initiative label +25% over the POC's font-11/12 base. Char-width metrics
// scale linearly with font size (mono: ~0.609 px/pt per char) — they MUST move
// with PLAN_VIZ_FONT or the zero-overlap contract silently rots.
// ── THE CARD'S TYPE SCALE (req #3498, user directive: "make the visualizer epic
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
// IT IS THE CARD'S ALONE. `PLAN_VIZ_FONT.initiative` (the band label) and `.slot` (the
// date ruler) are NOT scaled — neither is on the card, and the initiative chip is an
// HTML overlay with its own screen-space sizing rules besides.
export const CARD_TYPE_SCALE = 1.4;

// ── THE REQUIREMENT TITLE GETS 15% MORE OF THE CARD (req #3693) ─────────────
// User directive: *"epic has a fixed width which I like. but let's make the
// width of field given to the requirement title to be 15% wider than it is now
// with subsequent superior line wrapping."*
//
// THE CARD DOES NOT MOVE, so the room cannot come from the card. A requirement
// row already spans the whole text column (`cardChars(CHW_REQ, 0, …)` — no
// reserve), so the only lever left inside a fixed card is the row's own glyph:
// the requirement row is set this much narrower, and the same column carries
// this many times the characters. The CARD is still sized in `CHW_CARD`, the
// glyph it was always measured in, so every rung's width is unchanged to the
// pixel; only `CHW_REQ`, `CARD_FONT.req` and the row's line box divide by it.
//
// THE COST: requirement type is 1/1.15 (about 13%) smaller on screen, at every
// zoom. The epic name, the count badge and the Auto/Manual pill stay as they were.
export const REQ_TITLE_WIDEN = 1.15;

// EXPORTED (req #3498): a test that re-typed these as literals would agree with
// a half-applied type scale, which is the one failure `CARD_TYPE_SCALE` exists
// to make impossible.
export const CHW_LABEL = 10.05 * CARD_TYPE_SCALE;   // px per mono char, epic name
// The card's WIDTH unit — the requirement glyph as it was before req #3693.
// `cardGeometryFor` measures the card in this, so the card keeps its width.
export const CHW_CARD = 8.4 * CARD_TYPE_SCALE;
export const CHW_REQ = CHW_CARD / REQ_TITLE_WIDEN;  // px per mono char, req row
export const CHW_TITLE = 5.8 * CARD_TYPE_SCALE;     // px per mono char, the L3 own-title line
export const CHW_INITIATIVE = 9.15;   // px per mono char at font 15 (initiative band label)
const BEAD_R = 10;
// ── The initiative gets its OWN LANE (req #3168, user directive) ─────────────────
// This was 46, and 46 was never enough. The band header is reserved in WORLD px
// while the initiative chip is drawn at a fixed SCREEN height (it is an HTML overlay,
// deliberately — req #3119 — so the name stays legible at any zoom). Only ~25 of
// those 46 px sat above lane 0's epic label, so the chip fitted only while
// k ≥ 24/25 ≈ 0.96 — and the page's own default scale is 0.8. At the scale the
// visualizer OPENS AT, the initiative name overlapped the first row of epic labels.
//
// A lane is the unit this layout already uses for "content that may not be drawn
// over", so the initiative takes one: BAND_HEADER is now a full lane's height, and
// nothing else is ever placed in it. That moves the fit threshold to k ≈ 0.39.
//
// **THE OPENING VIEW IS NO LONGER ABOVE THAT THRESHOLD** (req #3312, found in
// review). The margin recorded here — "well below the 0.8 default and below
// fit-to-width on every real plan" — was measured against a landing pinned at
// `readableDefaultScale`; the landing is now `factoryDefaultScale`, and on the
// 34-epic fixture at 1280x720 that is k = 0.354-0.373, i.e. BELOW 0.39. The
// argument recorded here was that a DIFFERENT fact made the collision
// unreachable — below `K_READABLE` no epic label is drawn at all, so there is
// nothing for the initiative name to overlap — which made `K_READABLE` load-bearing
// for this reservation.
//
// **THAT ARGUMENT IS DEAD (req #3324, found in review), AND SO IS ITS FALLBACK.**
// A PINNED L2/L3 draws epic labels at EVERY scale (`planLevelFor` — legibility is
// now Auto's own demotion and decides nothing under a pin), so "no label is
// drawn down there" is simply false, and `K_READABLE` protects nothing here. The
// sentence that followed it — that `placeInitiativeChips` SCALES the chip down to its
// lane rather than overflowing it — stopped being true one requirement earlier:
// since req #3272 the chip is FLOORED at `INITIATIVE_CHIP_MIN_H`, and that function's
// own comment says a lane too short for the floored chip "gets the chip anyway,
// drawn over the first row of epic labels on its 60%-opaque panel."
//
// So the honest statement of the reservation is: it is a WORLD-px lane against a
// SCREEN-height chip, so it holds while `k >= ~0.348`
// (`(INITIATIVE_CHIP_MIN_H + 2·CHIP_MARGIN_Y) / initiativeLaneH`, i.e. 21.6/62) and the
// floored chip is drawn over lane 0's epic labels below that — reachable by
// wheel (the live plan's zoom floor is 0.11) and on landing/Reset on any plan
// whose `factoryDefaultScale` is smaller. Nothing PREVENTS it — `placeInitiativeChips`
// has run no obstacle-avoidance pass at all since #3257 (its only `keepOut` is
// the legend) — but it is MEASURED, at exactly this boundary, and pinned in
// vitest so a future change to the constants above cannot move it silently
// (req #3374 P5). The overlap itself was accepted by #3272 on the user's own
// directive (a floored, legible name over a 60%-opaque panel beats a name too
// small to read); #3324 only removes the claim that a pin could not reach it.
// If that trade is ever revisited, the fix is a taller reservation or an
// obstacle entry — not a legibility gate on the pin.
// 83, not 62, because THE HEADER IS NOT THE CLEAR STRIP. A lane-0 epic label is
// drawn 31px ABOVE its bead, and the bead sits 10px below the header — so the
// label reaches 21px back UP into the header (a further STAGGER_GAP on top of
// that in title mode). The clear strip is `headerH − EPIC_LABEL_RISE`, and
// sizing the initiative's lane as though it were `headerH` is the same
// off-by-a-reservation the 46px version made. 83 leaves a genuine 62 — one full
// lane — clear in BOTH label modes; `band.initiativeLaneH` carries the derived value
// so no consumer has to re-derive it and get it wrong.
// ── THE RESERVATION IS TALLER, ON THE USER'S DIRECTIVE (req #3365) ──────────
// *"Initiative title does a better job of staying the right size, but it needs to
// have a separate swim lane so it doesn't overlap epics/requirements."*
//
// The paragraphs above name this exact trade and name its remedy: the lane is
// WORLD px against a SCREEN-height chip, so it held only while
// `k >= (INITIATIVE_CHIP_MIN_H + 2·CHIP_MARGIN_Y) / initiativeLaneH` = 21.6/62 = **0.348**,
// and below that the floored chip was drawn over lane 0's epic labels. Plan 7
// LANDS at k = 0.2077 — comfortably under it — so on the plan this surface is
// most often opened on, the overlap was not an edge case reachable by wheel, it
// was the default view. That comment ends "if that trade is ever revisited, the
// fix is a taller reservation or an obstacle entry"; this is the taller
// reservation.
//
// DERIVED FROM THE SCALE IT MUST HOLD AT, not chosen. `INITIATIVE_LANE_CLEAR_K` is
// the lowest scale the clear strip is guaranteed at, and the clear strip
// (`headerH − EPIC_LABEL_RISE`, the same subtraction the 83 above got right)
// must be at least the floored chip's screen box converted into world px at
// that scale. Editing the chip's font or its margins therefore moves this
// automatically, which is the property the previous hand-set 83 did not have.
//
// WHAT IT COSTS, measured on plan 7: the header goes 83 → 125 world px, so each
// of the 4 bands is 42px taller and the world grows 4430 → ~4598, about 3.8%.
// At the landing scale that is ~35 screen px of extra plan height, and it buys
// a name that never sits on an epic label at any scale the reader can land on.
// It does NOT hold all the way to the zoom floor (0.11) — a world-px lane
// against a screen-px chip cannot, by construction — so the guarantee is stated
// as a scale, not as an absolute.
// A LITERAL, PINNED BY A TEST — not the expression that derives it. Every term
// of that expression (`INITIATIVE_CHIP_H`, `INITIATIVE_CHIP_MIN_SCALE`, `CHIP_MARGIN_Y`) is
// declared ~2000 lines BELOW this one, so evaluating it here is a temporal dead
// zone and throws at module load. Reordering a 4,400-line module to satisfy one
// constant is the larger risk, so the derivation lives in `INITIATIVE_LANE_CLEAR_K`'s
// own test instead — `pipelinePlanLayout.test.js` recomputes it from those four
// constants and fails if this number stops matching, which is the same
// protection with none of the load-order hazard.
//
//   ceil(EPIC_LABEL_RISE + (INITIATIVE_CHIP_H·INITIATIVE_CHIP_MIN_SCALE + 2·CHIP_MARGIN_Y)
//        / INITIATIVE_LANE_CLEAR_K)
//   = ceil(24 + (24·(11/15) + 4) / 0.2) = ceil(24 + 21.6/0.2) = 132
//
// The lowest scale at which the initiative chip's floored screen box is guaranteed to
// fit inside the band header's clear strip. Everything about `BAND_HEADER` below
// is derived FROM this number, which is why it is declared beside it.
export const INITIATIVE_LANE_CLEAR_K = 0.2;
// ── 132 → 108, BECAUSE NOTHING REACHES INTO THE HEADER ANY MORE (req #3498) ─
// Every version of this constant above is one long argument about a single
// subtraction: the header had to be `EPIC_LABEL_RISE` TALLER than the strip it
// was reserving, because a lane-0 epic label floated ABOVE its bead and reached
// back up into the header. `initiativeLaneH` was `BAND_HEADER − EPIC_LABEL_RISE` for
// that reason, and the paragraphs above are the record of getting that
// off-by-a-reservation wrong twice.
//
// A card starts AT its lane's top and draws nothing above itself. There is no
// overhang, so the clear strip IS the header and the subtraction is gone
// (`initiativeLaneH === headerH`). The strip the derivation demands is unchanged at
// 108 world px — the chip's floored screen box divided by `INITIATIVE_LANE_CLEAR_K` —
// so the header simply stops paying for an overhang that no longer exists.
// Every band is **24px shorter in `id` mode and 60px shorter in `title` mode**,
// which is the shipped one — the old header also carried `STAGGER_SPAN` (36)
// whenever the epic label staggered, and that term is gone with the stagger.
//
//   ceil((INITIATIVE_CHIP_H·INITIATIVE_CHIP_MIN_SCALE + 2·CHIP_MARGIN_Y) / INITIATIVE_LANE_CLEAR_K)
//   = ceil((24·(11/15) + 4) / 0.2) = ceil(21.6/0.2) = 108
//
// A LITERAL, PINNED BY A TEST — not the expression that derives it. Every term
// of that expression (`INITIATIVE_CHIP_H`, `INITIATIVE_CHIP_MIN_SCALE`, `CHIP_MARGIN_Y`) is
// declared ~2000 lines BELOW this one, so evaluating it here is a temporal dead
// zone and throws at module load. The derivation lives in `INITIATIVE_LANE_CLEAR_K`'s
// own test instead, which recomputes it from those constants and fails if this
// number stops matching.
const BAND_HEADER = 108;
// ── A FOLDED INITIATIVE'S HEADER IS SHORTER (req #3805) ───────────────────────────
// User direction: "reduce the white space between closed initiatives in up and
// down directions by 70%". A folded band draws no rectangle and no lanes — its
// floating title bar (the chip, `INITIATIVE_CHIP_H` = 24 screen px at
// `CHIP_MARGIN_Y` = 2 below the band's top) is all of it — yet it kept the open
// band's whole 108px header, so two stacked folded initiatives stood a full
// `BAND_HEADER + BAND_GAP` = 116px apart and the gap between their title bars
// was 116 − 24 = 92px at native scale (k = 1, world px = screen px).
//
//   gap' = 0.3 · 92 = 27.6   →   header = 24 + 27.6 − BAND_GAP = 43.6 → 44
//
// 44 leaves a 28px gap: −69.6%. A literal pinned by a test for `BAND_HEADER`'s
// reason (the chip constants are declared below it); the test recomputes it.
//
// WHAT IT COSTS. The chip is SCREEN-sized against a WORLD-px band, so this
// header also sets the lowest scale at which a run of folded names still fits
// without the de-collision pass pushing them: `initiativeLaneH` tracks the header, so
// the chip shrinks into the shorter lane, and every name sits at its band's
// corner while `(BAND_HEADER_FOLDED + BAND_GAP)·k ≥ INITIATIVE_CHIP_H·INITIATIVE_CHIP_MIN_SCALE
// + CHIP_STACK_GAP`, i.e. k ≥ 19.6/52 ≈ 0.377. Below that the pass pushes them
// down, and a run of folded bands SHARES its room (`placeInitiativeChips`' `runCap`):
// a name may ride down through the folded bands after it to the bottom of the
// next open band's header. With no open band after the run (every initiative folded,
// or the run below the open work) nothing is lost at any landing scale. A run
// ABOVE an open initiative is bounded by that initiative's header and drops names once it
// is full — MEASURED on six folded over one open: all named at k = 0.3, one
// lost at 0.25, two at 0.2, where the old 116px pitch still held all of them at
// 0.15 (pinned in vitest). The open initiative's own name is pushed below the run,
// onto its own lane 0 when the header is full — its own band, as #3272 allows.
export const BAND_HEADER_FOLDED = 44;
// `EPIC_LABEL_RISE`, `LANE_BASE_H` and `BEAD_LANE_OFFSET` left with req #3498.
// The first was how far a floating epic label reached above its bead, the second
// the lane's height before the requirement stack was added, the third where the
// bead sat inside its lane — all three describe an epic whose parts were placed
// individually, and `cardHeight` now answers for all of them at once. A consumer
// that wants the height a lane is CONNECTED at reads `band.laneCardH` and takes
// half of it: that is the midpoint the arcs anchor on.
const BAND_GAP = 8;
// req #3719 — the strip under the last initiative band that carries the add-initiative "+"
// (`buildInsertMarks` centres the mark in it), so the mark is inside the world
// rather than clipped by it. Charged only when the plan has a band.
export const INITIATIVE_ADD_RESERVE = 24;
// ── THE COLUMN FLOORS AND THE TITLE SLOT ARE GONE (req #3498) ───────────────
// `COL_MIN_W_HORIZONTAL` / `COL_MIN_W_VERTICAL` were the floor a CONTENT-SIZED
// column could not shrink below. Columns are no longer content-sized — every
// one of them is exactly `CARD_W + CARD_GAP_X` — so a floor has nothing to
// floor, and the NEXT-EPIC HALO's clearances (req #3271) read the card pitch
// directly, which is the same "one copy, not two that only have to agree"
// discipline the deleted comment was defending.
//
// `TITLE_SLOT` reserved a per-lane line BELOW the requirement stack for the
// epic's title. The title is inside the card now (`CARD_SUBTITLE_H`), so the
// reservation moved into `cardHeight` with it.
// One requirement mark per line at font 13.75. EXPORTED since the swim-lane
// directive: it is the exact vertical cost a lane pays when titles stagger, and
// a test that re-typed the number could agree with a changed layout by accident.
//
// +25% (req #3242 user directive, "a little more space between the lanes...
// for readability") — was 15. This is the SAME constant that sets the
// staggered-column vertical offset (the per-band `reqOffsets` sweep, req
// #3362), which is what was
// actually reported: two single-requirement epics in ADJACENT columns
// (`Dual-Path Purge` -> `Wontfix Fold-In` on the live plan), both eligible to
// stagger, landed on lines only 1px apart vertically while overlapping ~60px
// horizontally — inside the zero-overlap contract (rects never touch) but
// with no visual breathing room at all. One shared constant, so the fix is
// generic rather than a special case for that pair: every lane, every
// staggered pair, gets the same extra room.
// ── THE GAP IS DOUBLED (req #3365 user directive: "double the whitespace
//    between an epic's requirement stacks, vertically in the visualizer") ──────
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
//
// Both follow the row's glyph down too (req #3693, `REQ_TITLE_WIDEN`), so a
// row keeps the proportions it had and the room saved by fewer wrapped lines
// shows up as a shorter card. So does the gap between rows (`REQ_ROW_GAP`), which
// is defined as the air inside a wrapped row, doubled.
export const REQ_TEXT_H = 14 * CARD_TYPE_SCALE / REQ_TITLE_WIDEN;
export const REQ_LINE_H = 23.5 * CARD_TYPE_SCALE / REQ_TITLE_WIDEN;

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
export const REQ_ROW_GAP = 9.5 * CARD_TYPE_SCALE / REQ_TITLE_WIDEN;

// ── THE EPIC IS A CARD (req #3498) ──────────────────────────────────────────
// *"Make each epic a card that contains the requirements inside. Use a round
// rectangle card with the epic name in the title area. Separate the epic name
// with a horizontal line, the requirements listed top to bottom inside the card
// in the order."*
//
// This is the single change every other number in this section answers to. Until
// now an epic was a POINT — a bead — with its text scattered around it: the epic
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
// `${reqId}  ${title}`, so the prefix is a 4-digit id plus the two-character
// blank separator (req #3660 — it was " - "; req #3683 — it was three spaces) —
// SIX characters, and no '#' anywhere (ids render bare on this surface,
// production directive).
//
// SINCE REQ #3693 THIS IS THE CARD'S WIDTH, in the card's own glyph
// (`CHW_CARD`), and no longer the requirement line: the requirement row is set
// `REQ_TITLE_WIDEN` narrower, so the same column holds
// `floor(CARD_TEXT_CHARS x REQ_TITLE_WIDEN)` of its characters (`CARD_REQ_CHARS`).
export const CARD_TEXT_CHARS = 28;
export const CARD_ID_CHARS = 4;
export const CARD_SEP_CHARS = 2;        // two spaces, written by `reqLabelText`
// ── THE ID→TITLE GAP IS 1.5 CHARACTERS (req #3683, user directive: "reduce
// the white space between the requirement # and its description by 50%") ────
// It was three spaces. Half of that is not a whole number of mono characters,
// so the TEXT keeps two (every wrap, hanging indent and character offset in
// this module stays in whole characters) and the RENDERER draws everything
// after the id this much further left — the title, its continuation lines,
// the pills and the in-place title editor alike, so the hanging indent's
// column (req #3575) is still one column. Leftward, never rightward: the drawn
// line then ends half a character INSIDE the box the layout measured, so no
// overlap or wrap proof has to be re-made.
export const REQ_SEP_PULL = 0.5 * CHW_REQ;
// The requirement LINE at the base card, in the row's own (narrower) glyph —
// what `cardChars(CHW_REQ)` reports there (req #3693).
export const CARD_REQ_CHARS = Math.floor(CARD_TEXT_CHARS * REQ_TITLE_WIDEN);
// What is left for the title on the FIRST line. Derived, not stated: the line is
// the budget now, so a title budget written beside it would be a second number
// to keep in epic.
export const CARD_TITLE_CHARS = CARD_REQ_CHARS - CARD_ID_CHARS - CARD_SEP_CHARS;
// ── WHERE THE BEAD'S FILL WENT (req #3498) ─────────────────────────────────
// The bead carried four channels — FILL (epic state), RING (run mode /
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
// taste one: the bright epic colours (`epicBarrier` is `#ffd43b`) under the
// `#d7e3f4` label would put ~1.5:1 text on the card. A bar carries the colour
// at full saturation next to text that keeps its own contrast.
//
// ── THE BAR IS THE EPIC COLOUR, ALWAYS (req #3775, user directive) ────────
// *"have the color bar always be the same color as the perimeter of the
// epic."* It used to carry the state fill — Running amber, Complete green,
// Scheduled navy — and the amber, pulsing, was the one yellow flash on the
// surface that meant "work in progress". The bar now takes `beadStyle`'s
// `bar`, which IS the frame colour, and still PULSES while the epic runs:
// the motion says running, the colour says what the border says.
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
// ── CARD WIDTH IS A SCALE, NOT JUST A NUMBER (req #3503, "Epic Width") ─────
// Req #3503 shipped four rungs 1-4 (1.0, 1.25, 1.5, 1.75x); req #3648 replaced
// them with the quarter rungs below. Linear, not compounding, either way.
//
// ── THE RUNGS ARE QUARTERS OF THE BASE CARD: 6 5 4 3 (req #3648) ────────────
// User directive: "make the epic cards 25% wider", then "have it 6 5 4 3".
// A rung's number is the card's text room in QUARTERS of the original card —
// 4 is the original (scale 1, what every pixel-exact test assumes), 5 is the
// 25% wider card the plan now opens at, 6 is 1.5x, 3 is 0.75x. Listed in the
// order the toolbar draws them. The number IS the width, so the label needs no
// lookup table and a fifth rung would be one more integer.
export const EPIC_WIDTH_RUNGS = [6, 5, 4, 3];
export const isEpicWidthRung = (v) => EPIC_WIDTH_RUNGS.includes(v);
/** A rung's scale on the base card; anything that is not a rung is the base. */
export const epicWidthScale = (rung) => (isEpicWidthRung(rung) ? rung / 4 : 1);
// The LAYOUT's default is the base card (scale 1), so a caller that names no
// rung gets the geometry the exported `CARD_*` constants describe; the PAGE's
// default is the 25%-wider card (`DEFAULT_PLAN_EPIC_WIDTH`).
export const DEFAULT_EPIC_WIDTH_LEVEL = 4;
export const DEFAULT_PLAN_EPIC_WIDTH = 5;

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
 * exactly the way `CARD_CHECK_W`/`CARD_EPIC_LINK_W`/`CARD_BADGE_W` already
 * are — "wider" is a promise about how much of a title or a requirement
 * fits on one line, not about how thick the card's own furniture gets.
 *
 * `ceil`, not `round`, for the same reason the scale-1 number always was: at
 * `round` the ideal width can land one character short of what `cardChars`
 * — which floors — then reports, so the budget stops being a guarantee.
 */
export function cardGeometryFor(widthScale = 1) {
    const cardW = Math.ceil(CARD_TEXT_CHARS * widthScale * CHW_CARD + 2 * CARD_PAD_X
        + CARD_STATE_BAR_W + CARD_BAR_GAP);
    const cardFrameW = cardW - CARD_STATE_BAR_W - CARD_BAR_GAP;
    const cardTextW = cardFrameW - 2 * CARD_PAD_X;
    return { cardW, cardFrameW, cardTextW };
}

const BASE_CARD_GEOMETRY = cardGeometryFor(1);
export const CARD_W = BASE_CARD_GEOMETRY.cardW;
// The card's drawn FRAME — the rounded rect — which is narrower than the node's
// box by the state bar and its gap (req #3498, user directive: *"make the color
// bar on the right edge of the epic render outside the current frame of the
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
// epics to be *"linked from their midpoints and fan out nicely"*, and a fan-out
// is a cubic whose horizontal run is comparable to its vertical drop. A bead
// took ~20px of its column, so an arc between two adjacent columns had most of
// a column to bend in; a card takes ALL of it, so whatever is left here is the
// entire budget. At the old 26px a one-lane drop would have been drawn as a
// near-vertical kink between two card edges.
export const CARD_GAP_X = 90;
// The gap BELOW a card, before the next lane's card starts. The user's
// "respectful gap / white space", charged once per lane by `lanePitch`.
export const CARD_GAP_Y = 22;
// The title area: the epic name on one line, and — when the epic name is the ID
// — the epic's own TITLE on a second line below it. See `cardTitleH` for why the
// second line is a property of the LAYOUT and never of the zoom level.
export const CARD_LINE_H = 21 * CARD_TYPE_SCALE;      // the epic-name line
export const CARD_SUBTITLE_H = 14 * CARD_TYPE_SCALE;  // the epic-title line
// ── THE TIME LINE (req #3825) ───────────────────────────────────────────────
// The card's last line: the epic's START at its bottom-left, its END at its
// bottom-right, as `hh:mmAM/PM` (`planEpicTimes.js` derives and formats both);
// an END on a later local day than its START carries `+Nd`.
// Reserved below the requirement block on every card whose work has begun
// (`row.stampsReserved`), so a card does not grow when its times arrive.
export const CARD_STAMP_GAP = 4 * CARD_TYPE_SCALE;     // air above the line
export const CARD_STAMP_TEXT_H = 11 * CARD_TYPE_SCALE; // the line's own box
export const CARD_STAMP_H = CARD_STAMP_GAP + CARD_STAMP_TEXT_H;
// ── THE COLLAPSE HEAD (req #3650) ───────────────────────────────────────────
// The TPU 3D visualizer's collapse head (`.tpu3d-head`) — a ▾ that turns a
// quarter-turn when folded. It had its own row at the top-left of the title
// area, labelled "REQS", until req #3648 moved it onto the title line.
// What an epic's fold folds: its requirement rows. NO VISIBLE WORD since req
// #3648 (user directive: "there is a collapse element and the word 'reqs'
// what?") — the head is the chevron alone, on the title line, and this string
// is only its accessible name's first word.
export const CARD_HEAD_LABEL = 'Requirements';
// ── ONE TITLE ROW (req #3648, user directive) ───────────────────────────────
// "Collapse element, requirement count badge, epic title (left justified) /
// Auto/Manual, Plus, Arrow (right justified)". The collapse head left its own
// row above the name and became the title line's FIRST control: a chevron-only
// box the size of the "+" and ↗ buttons, then the count badge, then the name.
// The head's own row (`CARD_HEAD_BAND`) is no longer charged to the card.
// Req #3683 moved the badge into a 2x2 control cluster at the title area's
// right; req #3742 brought it back between the chevron and the name
// (`CARD_NAME_LEFT_RESERVE`).
export const CARD_COLLAPSE_W = 21 * CARD_TYPE_SCALE;      // = CARD_TITLE_BTN
export const CARD_COLLAPSE_GAP = 4 * CARD_TYPE_SCALE;     // = CARD_TITLE_BTN_GAP
// The chevron's type on the title line — the "+" button's own glyph scale.
export const CARD_COLLAPSE_FONT = 15 * CARD_TYPE_SCALE;
// The horizontal rule under the title area, and the air either side of it.
export const CARD_RULE_GAP = 7 * CARD_TYPE_SCALE;
export const CARD_RULE_H = 1;
export const CARD_RULE_BAND = 2 * CARD_RULE_GAP + CARD_RULE_H;
// ── THE COMPLETE LINE (req #3676) ───────────────────────────────────────────
// *"an actual complete line is lowlight type line that separates the two
// groups and shows all the time esp when the color's are set to non-status
// settings"*. A LOWLIGHT: dashed and in the palette's `dim`, so it can never be
// mistaken for the solid title rule above it, and it sits in the
// gap between two rows rather than taking a row of its own, so drawing it moves no box.
export const CARD_DONE_RULE_DASH = [4 * CARD_TYPE_SCALE, 3 * CARD_TYPE_SCALE];
// Full opacity: `dim` is already the low-contrast colour, and the line is drawn at
// plan scale, so any fade on top of it disappears at zoomed-out L2 and in the
// thumbnail (review finding).
export const CARD_DONE_RULE_OPACITY = 1;
export const CARD_RADIUS = 10 * CARD_TYPE_SCALE;


/**
 * The height of a card's title area.
 *
 * TWO LINES OR ONE IS A PROPERTY OF `epicLabel`, NOT OF THE LEVEL — and the
 * distinction is the oldest invariant in this module. `epicLabel` is a user
 * control ('Epic: ID | Title'), so changing it may relayout; the semantic LEVEL
 * (L1/L2/L3) may not, because it is also resolved from the zoom scale and a
 * geometry that changed with zoom would make every card jump as the reader
 * scrolled the wheel.
 *
 * So in ID mode the card reserves the epic-title line at EVERY level and draws
 * it only at L3 — the room is spent either way, exactly as the old reserved
 * title slot spent it. In TITLE mode the epic name already IS the title, so
 * there is no second line to draw and none is reserved (the old code skipped
 * the slot for the same reason).
 */
//
// AND IT IS NEVER LESS THAN TWO LINES (req #3683): "epic cards will always be
// two high". The control column that made it so (2x2, then one column by req
// #3742) is one row since req #3904, but the floor is the user's rule, not the
// cluster's, so it stands on its own constant (`CARD_TITLE_MIN_H`) and no card
// changed height. A one-line name, or an id with its subtitle, fits that room.
export const cardTitleH = (epicLabel, nameLines = 1) => CARD_PAD_Y
    + Math.max(CARD_TITLE_MIN_H, Math.max(1, nameLines) * CARD_LINE_H
        + (epicLabel === 'title' ? 0 : CARD_SUBTITLE_H));

// ── THE EPIC NAME WRAPS TOO (req #3498, 2026-08-13) ─────────────────────────
// It has to, and the reason is the same arithmetic that narrowed the card: at a
// 28-character line the name's own budget — the text column less the
// title-row reserves, at the LABEL glyph which is wider than the row glyph —
// was SEVEN characters at the base card once the chevron, badge, padlock,
// barrier and run pill all shared the one line, and is TWELVE since req
// #3683 stacked those controls into the 2x2 cluster
// (`cardChars(CHW_LABEL, CARD_NAME_RESERVE)`). "Feature Eradication
// - MCP, Scripts, Frontend…" is the actual data, and it truncates well short
// of one line at that budget.
//
// So the card's title area takes up to two lines by the same rule the rows do:
// wrapped at layout time, RESERVED at every level, and per-epic.
//
// Every card's title area is two lines (`cardTitleH`, req #3683), and the name
// has both of them at the controls' left (`CARD_NAME_RESERVE`). The controls
// are one row on the first line since req #3904, but the name keeps one budget
// for both lines: its label is ONE box, so a longer second line would reach
// under the controls in the zero-overlap sweep.
export const NAME_MAX_LINES = 2;
// The fewest name characters the title line must hold beside its controls
// before the name moves to a line of its own (req #3648). EIGHT since req
// #3683: a six-character line splits nearly every real word in half ("Featur"
// / "e Era…") — so below eight a TITLE goes under the controls at the text
// column's full width, which is the "more room" the requirement asked for.
// Since req #3904's one-row controls that is the narrowest rung (3) only. An
// epic ID never moves: it is a few digits, and fits beside them at every rung.
export const NAME_INLINE_MIN_CHARS = 8;

/**
 * A card's full height: title area, rule, then one line per requirement.
 *
 * `reqBlockH` is the block's PIXEL height, from `reqBlockHeight` above — not a
 * count. It was a requirement count, then a line count, and neither survived the
 * gap becoming a second quantity; a pixel height is the one form that cannot go
 * stale the next time the block gains a term.
 *
 * An epic with NO requirements still gets a card — it is an epic, it has a name,
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

// `stampH` is the time line's reserve (req #3825): `CARD_STAMP_H` on a card
// whose work has begun, else 0.
export const cardHeight = (reqBlockH, epicLabel, nameLines = 1, stampH = 0) =>
    Math.max(CARD_MIN_H, cardTitleH(epicLabel, nameLines) + CARD_RULE_BAND
        + Math.max(0, reqBlockH) + Math.max(0, stampH) + CARD_PAD_Y);

// ── THE FLOOR, AND IT IS DERIVED (req #3498) ────────────────────────────────
// It binds ONLY the requirement-less card: `cardHeight(0, 'title')` is 52px of
// title area, rule and padding, and every card with even one requirement is
// taller than this floor already.
//
// 68 = 2 x 34, and the 34 is not a taste: it is the clearance the NEXT-EPIC HALO
// needs above a LANE-0 bead before it reaches the initiative chip's strip
// (`NEXT_HALO_CLEARANCES.initiativeChipStrip`, which is HALF A CARD because the bead
// sits at the card's midpoint and the card's top IS that strip's bottom). Under
// the old geometry that room was `EPIC_LABEL_RISE + BEAD_LANE_OFFSET` = 34, and
// three requirements — #3271, #3280, #3299 — went into making the halo READ at
// Overview inside exactly that budget. A squat empty card would have cut it to
// 26 and shrunk the one mark that answers "what runs next?" at the zoom it is
// most often asked at.
//
// So the floor is written where the number comes FROM. It also happens to be
// the right look — a card with no rows still reads as a card rather than as a
// label with a line under it — but that is the bonus, not the derivation.
const CARD_MIN_H = 68 * CARD_TYPE_SCALE;

// The room the card's DONE ✓ used to occupy at the title area's right edge.
// Req #3603 removed the ✓ from the card header (the state bar and the buttons
// already say it), so the reserve is zero; the constant stays because every
// header-row offset is written in terms of it.
export const CARD_CHECK_W = 0;

// ── THE ↗ "VIEW IN TABLE" BUTTON IS GONE (req #3641) ─────────────────────────
// User directive: "remove the option to see the epics in the pipeline in a
// special viewer — just show the visualizer". The Table it opened was
// withdrawn from the plan page, so the button has nowhere to go and is no
// longer emitted; a click on the title area frames the epic on the canvas
// instead. Its reserve is zero, `CARD_CHECK_W`'s precedent: the constant
// stays because every title-row offset is written in terms of it, so the "+"
// and the run pill slide right into the room it held and the title keeps the
// rest. The history below is what the button WAS, kept for whoever restores
// the Table.
//
// ── "VIEW IN TABLE, HIGHLIGHTED" — A VISIBLE BUTTON, NOT JUST A HIDDEN HIT
// RECT (req #3503, user directive: "place a proper sized button for the
// requirements link — use same button as initiative's requirement link, that is the
// pattern") ──────────────────────────────────────────────────────────────
// The card's title area has carried this action since req #3213
// (`onEpicFocus`, wired to an invisible hit rect over the epic name) — this
// only gives it a glyph a reader can actually SEE and aim at, the same way
// the initiative chip's own ↗ does for "open this initiative's epics". Same glyph, same
// idea: click here to jump to this row, filtered and highlighted, elsewhere.
// Reserved out of the epic name's budget the same way the ✓ is, so it never
// draws over a truncated title.
//
// SIZED LIKE THE ✓ IT SITS BESIDE (req #3503 review — "align further to the
// right edge to give the epic title more room"), not like the initiative chip's
// own 30 SCREEN px: that reservation is a fixed screen-px HTML overlay
// control, unscaled by zoom, while this one is WORLD px on a card that is
// itself fixed-width — the two numbers are not the same unit and comparing
// them literally over-reserved this. A glyph the size of the ✓ needs a
// target the size of the ✓'s own reserve, not a larger one, and every world
// px given back here is a world px the title gets to keep.
//
// RESIZED BY REQ #3582 (user directive: "the plus sign and the popout buttons
// should be larger, commensurate with the font size of the epic — they are
// way too small and close together"). Sized to the ✓ they were each an
// 18-world-px sliver, flush against each other, reading as two specks beside
// a 23px title. Each is now a SQUARE BUTTON the full height of the title's own
// line (`CARD_LINE_H` — a second pass, "they could be a little bigger", took
// it up from the count badge's `CARD_LINE_H − 4`; the full line is the
// ceiling, since anything taller leaves the title area a one-line name
// reserves and crosses the rule under it), outlined so it reads as a control,
// its picture sized to the box (an HTML icon since req #3673), with
// `CARD_TITLE_BTN_GAP` between neighbours. The cost is title room, and it is
// paid knowingly.
export const CARD_TITLE_BTN = CARD_LINE_H;
export const CARD_TITLE_BTN_GAP = 4 * CARD_TYPE_SCALE;
// The button's outline (req #3607, user directive: "a thicker border so its
// more visible, like 100% more") — 2 world px, double the 1 it shipped with.
export const CARD_TITLE_BTN_STROKE = 2;

// (`titleBtnGlyph` and its `CARD_TITLE_BTN_GLYPH`/`_GLYPH_STROKE` — the
// strokes the "+", the ↗, and then req #3649's ⚑ and padlock were drawn with,
// req #3607 — went in req #3673: the ⚑ and padlock moved to the HTML overlay
// as real icons (`PlanEpicFlagIcons.jsx`), and nothing else drawn used them.)
// (`CARD_EPIC_LINK_GAP` / `CARD_EPIC_LINK_W` — the ↗'s reserve — went with the
// ↗ in req #3641 and req #3649.)

// ── "FILE A REQUIREMENT INTO THIS EPIC" — THE + BUTTON (req #3582) ─────────
// On the title row's right edge since req #3641 took the ↗ that stood there;
// sized like the ↗ was, for the same reason the ↗ was sized like the ✓: a
// glyph the size of its neighbours needs a target that size, and every
// world px not reserved here is one the title keeps. It opens the requirement
// editor in "new" mode carrying this epic, and the first save (picking a
// category, the aggregator template's own rule) seats the new requirement
// here. Reserved out of the epic name's budget like the other three: its
// button plus the gap between it and the ↗ (sizes above, req #3582).
// (`CARD_EPIC_ADD_W` — the "+"'s reserve — was deleted with the button by
// req #3649.)

// ── THE BARRIER FLAG (req #3649) ─────────────────────────────────────────────
// A title-area button sized like the "+" and the ↗ were for the same reason;
// the last item of the control row (`CARD_CLUSTER_W`, below), right of the
// run pill (req #3904). It is the epic's `checkpoint` flag (on by default: the epic holds
// everything downstream until it is done; off: a launch priority only) — drawn
// since req #3673 as a boom barrier, arm down or raised, in place of the ⚑ the
// user found unreadable. An HTML button on the overlay (req #3673), so this
// only reserves and places its box.
// The padlock that stood beside it went in req #3742 (user directive: "remove
// the lock button from the title row"): a locked epic is told by its RED
// PERIMETER instead (`PLAN_VIZ_PALETTE.lockedFrame`), and the lock is set in
// the epic's editor, which a click on the epic opens.


// ── THE TOTAL REQUIREMENT COUNT, AS A BADGE (req #3503, user directive: "add
// a count badge to the left of the title — use that green count badge we had
// before"; moved to the RIGHT by req #3683, "move the counter badge to the
// right hand side", as the top-right cell of the 2x2 control cluster; and back
// by req #3742, "badge counter between collapse/expand and title") ─────────
// Moved here from the title area's RIGHT edge (where it drew as dim, dead
// "(N)" text — see the removed `CARD_COUNT_W` block this replaces) to a
// pill reusing `KonvaSwarmCanvas.jsx`'s day-header "requirements met" badge
// (`.ts-bead-day-count-inline`)'s FILL verbatim — its text colour does not
// carry over; see the `badgeFill`/`badgeText` entries in `PLAN_VIZ_PALETTE`
// for why. A count of what's already visible below is a fact worth a
// reader's eye going TO, so it earns the more prominent position and the
// brighter mark.
// It is still the TOTAL requirement count, not met/total — that is the initiative
// chip's vocabulary and answers a different question; an epic's own progress
// is already on the card as its coloured rows, so restating it as a
// fraction would be the same fact twice at the same level.
// Reserved out of the epic name's budget as part of the cluster, so a long
// title stops BEFORE the badge rather than running under it.
// No parens: a pill's own shape is what used to say "this is a count", so
// the two characters spent on `()` are room the badge doesn't need back.
// The air between the badge and the name it stands left of — one requirement
// glyph, as it was before req #3683 took the badge away and req #3742 brought
// it back.
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
// The pill's top, from the name's first line. BESIDE THE NAME again since req
// #3742, so it sits at −1 (req #3606, user report: the count circle "sits
// lower than the text by a noticeable amount"). A `+ 1` centres the pill on the
// line BOX, but the name is drawn on a canvas `textBaseline: 'middle'` (em-box
// centring) and its ink sits ABOVE that box centre: measured in Chromium at
// CARD_TYPE_SCALE 1.4 with SF Mono, the name's baseline is 29.0 and the cap
// centre 20.4, while a `+ 1` pill's digit baseline was 31.0 and its centre 22.5
// — the circle hung 2 world px below the text it labels. −1 (2 world px up)
// lands the digit's baseline on the name's and the digit's centre on the caps'
// centre (within 0.5px).
export const CARD_BADGE_TOP = -1;
// The run pill's top, from the title line (req #3683): since req #3904 it
// stands BESIDE the barrier rather than over it, so it is centred on the
// barrier's square — the two controls share one centre line.
// (Declared below `CARD_RUN_H`, which it is derived from.)

// ── THE RUN-MODE PILL (req #3580, user directives: "have a display circle for
// epic's manual vs auto and let that be a configurable button in the UI", then
// "make it say auto or manual and be green auto and blue manual") ──────────
// Left of the "+", reserved out of the epic name's budget exactly the way the ✓
// and the "+" are, so a long title never draws under it. It carries the
// LETTER (A / M since req #3709), so it is sized for the longer of the two — one
// fixed width, so the pill does not change size (and the title's room does not
// move) when it is toggled.
// The same height as the count badge beside it in the cluster's top row, so
// the two pills read as one row.
//
// HISTORY: while it carried the full word ("Auto"/"Manual") it took about three
// more characters of each title line than the bare A/M circle; req #3709 went
// back to the single letter, so that cost is gone.
// The letter is set at 80% of the requirement-row type (`CARD_RUN_FONT`, below
// `CARD_FONT`), so its glyph width is that same fraction of the row's.
// Measured against the CARD's glyph (`CHW_CARD`), not the requirement row's, so
// req #3693's narrower requirement type leaves the pill exactly as it was.
const CARD_RUN_TYPE_RATIO = 0.8;
// req #3709 (user directive: "shrink the auto vs manual button down to a
// single character … make sure the 2x2 button grid is therefore horizontally
// narrower making space for more epic title"): one letter, A / M. The full
// word stays on the button's aria-label and hover title. One character fits
// inside the circle `CARD_BADGE_H` already makes, so the pill is that circle
// and column 1 of the cluster falls to the square buttons' width.
export const CARD_RUN_WORDS = { auto: 'A', manual: 'M' };
const CHW_RUN = CHW_CARD * CARD_RUN_TYPE_RATIO;
const CARD_RUN_PAD_X = 5 * CARD_TYPE_SCALE;
export const CARD_RUN_H = CARD_BADGE_H;
export const CARD_RUN_TOP = (CARD_TITLE_BTN - CARD_RUN_H) / 2;
export const CARD_RUN_W = Math.max(CARD_RUN_H, Math.ceil(
    Math.max(...Object.values(CARD_RUN_WORDS).map((w) => w.length)) * CHW_RUN
    + 2 * CARD_RUN_PAD_X));
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
// apart the way `EPIC_FOCUS_CONTEXT`'s history (req #3503, elsewhere in
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
// regardless of what any one epic's count happens to be.
//
// SIZED FOR TWO DIGITS, NOT THREE (req #3503 review, round 2: "lost space to
// the left of the badge"). An epic's OWN linked-requirement count — not a
// plan-wide total — is the quantity here, and double digits already covers
// every count this file's own fixtures exercise; reserving a third digit
// bought room a card is realistically never going to spend, and every world
// px of that room was the exact "lost space" the review measured. The DRAWN
// badge is still almost always narrower than even this (see `badgeWidthFor`
// above, called again per-row with the row's real digit count) and sits
// flush against the reserve's own right edge — against the gap before the
// title — so freeing width only ever opens air on the badge's OWN left,
// never moves the title. An epic that somehow carries 100+ requirements
// would draw a badge wider than the reserve rather than clip — see
// `badgeWidthFor`'s own uncapped formula — growing LEFT, over the gap and into
// the run pill beside it in the cluster (req #3683; before that, the collapse
// chevron). A third digit's reserve would cost every card on every plan a name
// character for a count no epic reaches.
export const CARD_BADGE_W = badgeWidthFor(2);

// ── THE CONTROL ROW (req #3683's 2x2 cluster, one column by req #3742, one
// ROW by req #3904) ─────────────────────────────────────────────────────────
// Req #3683 ("move the counter badge to the right hand side and make a 2x2
// button cluster … so epic cards will always be two high") stacked the four
// title-area controls two by two at the right. Req #3742 took two of them out
// of it — the count badge moved back between the chevron and the name, the
// padlock was removed — leaving the run pill over the barrier in one column.
// Req #3904 (user directive: "Auto/Manual and priority / barrier setting
// should be on the one row and right justified. let A/M be first and the other
// be rightmost") lays the two side by side on the title line:
//
//     … name …   [ A ] [⛩]        the title line, flush right
//
// One row, one title line (`CARD_LINE_H`) tall — the square button fills it,
// the pill is centred on it (`CARD_RUN_TOP`). The two keep the buttons' own
// gap (`CARD_TITLE_BTN_GAP`), and the row is the pill's fixed width plus the
// button's, so toggling either moves nothing. The title area's two-line floor
// is no longer the cluster's doing — see `CARD_TITLE_MIN_H`.
export const CARD_CLUSTER_ROWS = 1;
export const CARD_CLUSTER_H = CARD_CLUSTER_ROWS * CARD_LINE_H;
export const CARD_CLUSTER_W = CARD_RUN_W + CARD_TITLE_BTN_GAP + CARD_TITLE_BTN;
// "Epic cards will always be two high" (req #3683) — the title area's floor.
export const CARD_TITLE_MIN_H = 2 * CARD_LINE_H;
// The air between the epic name and the cluster — the gap the buttons keep
// from each other, and no more ("compress the white space for the title so it
// has more room").
export const CARD_NAME_CLUSTER_GAP = CARD_TITLE_BTN_GAP;
// What the name's line gives up on its LEFT: the chevron and its gap, then the
// count badge's reserve and its gap (req #3742).
export const CARD_NAME_LEFT_RESERVE = CARD_COLLAPSE_W + CARD_COLLAPSE_GAP
    + CARD_BADGE_W + CARD_BADGE_GAP;
// EVERYTHING the epic name's line gives up beside the name: the ✓'s room
// (zero), the chevron and the badge on the left, the control column and its
// gap on the right. One expression, so the name budget, the inline check and
// `epicLabelText`'s default can never count it differently.
export const CARD_NAME_RESERVE = CARD_CHECK_W + CARD_NAME_LEFT_RESERVE
    + CARD_NAME_CLUSTER_GAP + CARD_CLUSTER_W;

// How many characters of a given mono width fit the card's text column.
// `reserve` is total room taken off the column, from either edge — the ✓,
// the "+", the run pill and the badge, whichever of them the caller's own budget
// is for. `textW` defaults to the scale-1 column (`CARD_TEXT_W`) but takes
// any `cardGeometryFor(scale).cardTextW` too — the SAME formula at whatever
// rung "Epic Width" is on, never a second one.
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
//
// Since req #3575 the second and third lines HANG past the id column, so a row
// with a 4-digit id carries 28 + 21 + 21 = 70 characters, not 84 — the price of
// a left edge holding nothing but ids. (Req #3693's narrower requirement glyph
// made the base card's line 32, so that row now carries 32 + 26 + 26 = 84.)
export const REQ_MAX_LINES = 3;

// The narrowest continuation line a hanging indent may leave (req #3575).
export const REQ_MIN_HANG_CHARS = 8;

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
 *
 * `indent` is a HANGING INDENT (req #3575, user directive: *"a clear column at
 * the left edge occupied only by the requirement number and the titles will
 * wrap but stay out of the column"*). Every line after the first starts with
 * that many spaces and is budgeted at `maxChars - indent`, so the whole line
 * still fits the same column. The font is mono, so spaces ARE the column. An
 * indent that would leave a continuation line too narrow to carry a word is
 * dropped rather than honoured — a column of ids is not worth a title broken
 * one character per line (`REQ_MIN_HANG_CHARS`).
 */
/**
 * The hanging indent `wrapReqText` actually honours for a line of `maxChars`
 * — `indent`, or 0 where it would leave a continuation line narrower than
 * `REQ_MIN_HANG_CHARS`. Its own function because the in-place title editor
 * (req #3661) has to put its title column exactly where the wrap does.
 */
export function reqHangChars(maxChars, indent) {
    return maxChars - indent >= REQ_MIN_HANG_CHARS ? Math.max(0, indent) : 0;
}

export function wrapReqText(text, maxChars, maxLines = REQ_MAX_LINES, indent = 0) {
    const full = String(text == null ? '' : text);
    if (full.length <= maxChars) return [full];
    const hang = reqHangChars(maxChars, indent);
    const pad = ' '.repeat(hang);
    const lines = [];
    let rest = full;
    while (rest.length > 0 && lines.length < maxLines) {
        const room = lines.length === 0 ? maxChars : maxChars - hang;
        const lead = lines.length === 0 ? '' : pad;
        if (lines.length === maxLines - 1) {
            lines.push(lead + truncate(rest, room));
            rest = '';
            break;
        }
        if (rest.length <= room) { lines.push(lead + rest); rest = ''; break; }
        // The last space that still fits, so the break lands between words.
        const cut = rest.lastIndexOf(' ', room);
        const at = cut > 0 ? cut : room;
        lines.push(lead + rest.slice(0, at));
        rest = rest.slice(cut > 0 ? at + 1 : at);
    }
    return lines;
}
// ── THE CHARACTER CEILING IS THE CARD (req #3498) ──────────────────────────
// `LABEL_MAX_CHARS` (60) and `EPIC_LABEL_MAX` (60) were two names for one
// number: the hard cap that stopped a pathological title running forever
// through a world where the only other bound was a STAGGER BUDGET derived from
// the neighbouring columns. Both are gone, and so is the budget, because the
// card answers the question they were both approximating — how much text fits?
// — exactly: `cardChars(chw)`, the card's own text column divided by the glyph
// width. There is no cap to keep in epic with the room any more, because the
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
    label: 16.5, req: 13.75, title: 9.5, initiative: 15, check: 9, slot: 13,
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
    // req #3693 — narrower by `REQ_TITLE_WIDEN`, in epic with `CHW_REQ`.
    req: PLAN_VIZ_FONT.req * CARD_TYPE_SCALE / REQ_TITLE_WIDEN,
    title: PLAN_VIZ_FONT.title * CARD_TYPE_SCALE,
};
// req #3580 — the run pill's letter; see `CARD_RUN_W`. The card's own requirement
// size before req #3693, so the pill is unchanged.
export const CARD_RUN_FONT = PLAN_VIZ_FONT.req * CARD_TYPE_SCALE * CARD_RUN_TYPE_RATIO;

export const BEAD_RADIUS = BEAD_R;

// The bead's own ring weight — one since req #3742 made the ring the epic
// colour alone (it was this for manual / eligible-now, 1.5 otherwise). EXPORTED
// and named rather than left as a literal because the next-epic halo's ceiling
// is measured against the EMPHASIS weight (req #3271): what bounds the halo's
// growth at Overview is the distance to the neighbouring bead's outer edge, and
// that edge is `BEAD_RADIUS + BEAD_RING_W_EMPHASIS / 2`. A literal there and a
// literal here would only agree by accident.
export const BEAD_RING_W_EMPHASIS = 2.5;
// A locked card's red perimeter (req #3742) — heavier than the emphasis ring,
// so a frozen epic reads as one at a glance down a lane.
export const CARD_LOCKED_FRAME_W = 3;
// The outer edge of the widest bead ring drawn — 11.25.
export const BEAD_OUTER_RADIUS = BEAD_R + BEAD_RING_W_EMPHASIS / 2;

// The bead's invisible HIT circle, slightly larger than the bead so a small
// target stays easy to point at. It lives here rather than as a literal in the
// renderer because req #3213 made it an INVARIANT: the label hit regions are
// pushed above these circles, so a label rect that reached into a DIFFERENT
// epic's hit circle would silently take ownership of it and answer with the
// wrong epic's card. The layout tests assert that clearance, and a test can
// only assert the number the renderer actually uses.
export const BEAD_HIT_RADIUS = BEAD_R + 5;

// ── Epic width (req #3168, "UI option for epic width") ──────────────────────
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
// `EPIC_WIDTH_FACTORS` multiplied every CONTENT-SIZED column by 1.1 / 1.1836 /
// 1.428, and it existed because content sizing produced columns the reader kept
// wanting more air in. Columns are not content-sized any more — every one of
// them is `CARD_W + CARD_GAP_X` — so the multiplier has nothing to scale and the
// question it answered ("how much room does this text need?") is answered once,
// by the card, for the whole plan. `MIN_EPIC_WIDTH_FACTOR` went with it: the
// next-epic halo's ceiling measured against the tightest column any SETTING
// could produce, and there is now exactly one column width to measure.

// ── The requirement-mark VIEW: one control, TWO positions (req #3498) ──────
// It had three, and the third was `horizontal` — every requirement of an epic on
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

// ── EPICS-ACROSS: ZOOM BY HOW MANY EPICS YOU WANT TO SEE (req #3498) ───────
// User directive, 2026-08-13: buttons for 10 through 2 on evens, left of View,
// numbers only. Each one takes the CENTRE of the viewport and zooms so that
// many epics span it.
//
// It is the natural control for this canvas, and the measurements are why: a
// card's on-screen size is `viewport / (columns x chars-per-line)`, so "how many
// columns fit" is the quantity a reader is actually choosing when they zoom.
// The semantic-level chips beside it pick WHAT IS DRAWN; these pick HOW MUCH.
//
// 6 5 4 3, CENTRED ON THE ACTIVE EPICS (req #3648 user directive: "have it 6 5
// 4 3 … put it between Color and the view", "it's supposed to center that
// many active epics"). The numbers are still epics across; the centre is no
// longer the viewport's but the active epics' (`activeEpicIds`).
// 10 joined the ladder in req #3686 (user directive: "make the width button have 10
// as well as the other") — the widest look, widest first like the rest.
// 10 and 3 came off the toolbar again in req #3806 (user directive, title bar
// diet): the ladder is 6 5 4.
export const EPICS_ACROSS_OPTIONS = [6, 5, 4];

// TWO IS THE EXCEPTION THE USER NAMED — *"fitting ... with tight white space
// except when 2 is selected"*. Every other option fits its columns edge to
// edge; two of them filling a 1730px viewport puts a single card at ~690px and
// its text at ~37px, which is past reading and into filling. So 2 fits its pair
// into a FRACTION of the viewport and leaves the rest as air: still the closest
// look the control offers, without the canvas becoming a poster.
// 3 since req #3648: the smallest option on the toolbar is 3, and it fills
// the viewport like the rest — only a 2 (which the wheel ladder can still
// reach) keeps the loose fit.
export const EPICS_ACROSS_TIGHT_FROM = 3;
export const EPICS_ACROSS_LOOSE_FILL = 0.8;

/**
 * The scale at which `n` epics span the viewport.
 *
 * An epic is a COLUMN — `colW` — because that is the pitch the plan actually
 * repeats at; fitting `n` cards and forgetting the gutters would land every
 * option one card too wide.
 *
 * `colW` DEFAULTS TO THE SCALE-1 PITCH (`CARD_W + CARD_GAP_X`) but a caller
 * holding a live `layout` MUST pass `layout.colPitch` instead (req #3503
 * review — NOT `layout.colW`, which is the PER-COLUMN array `colPitch` was
 * built from; `Number.isFinite` on that array silently fails rather than
 * throwing, so a wrong pick here does not announce itself). Epic Width
 * scales the card, not the gap, so `layout.colPitch` already carries
 * whichever rung is active — the default here exists only for a caller with
 * no layout in hand (a fixed-geometry test, or code that predates Epic
 * Width), and using it where a layout DOES exist under-counts every rung
 * above 1: measured, "fit 5 across" landed 5.00 / 4.25 / 3.70 / 3.27 columns
 * at rungs 1-4 while claiming 5 at all of them.
 *
 * Returns null on a viewport or an `n` that cannot produce a scale, so the
 * caller does nothing rather than driving the camera to NaN.
 */
export function epicsAcrossScale(n, viewportW, colW = CARD_W + CARD_GAP_X) {
    if (!Number.isFinite(n) || n <= 0) return null;
    if (!Number.isFinite(viewportW) || viewportW <= 0) return null;
    if (!Number.isFinite(colW) || colW <= 0) return null;
    const fill = n >= EPICS_ACROSS_TIGHT_FROM ? 1 : EPICS_ACROSS_LOOSE_FILL;
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
 * THE CENTRE, not the origin, because that is what the epics-across directive
 * asks for and because it is what a reader expects of a zoom BUTTON: the thing
 * you were looking at stays where it is. Anchoring at the origin would fling the
 * plan off-screen at every epic of the ladder — the world is 18,000px wide.
 *
 * The WHEEL anchors on the pointer instead (`zoomAboutPoint` above), because
 * that is what a wheel has always done here and snapping is not a reason to
 * change it.
 */
export function zoomAboutViewportCentre(t, size, nextK) {
    if (!size || !(size.w > 0) || !(size.h > 0)) return null;
    return zoomAboutPoint(t, { x: size.w / 2, y: size.h / 2 }, nextK);
}

/**
 * The epics the epics-across buttons centre on (req #3648): the RUNNING ones;
 * failing that, the ones not yet done; failing that, every epic. Only epics the
 * layout placed (a folded initiative places none).
 *
 * @param {Object[]} rows   plan rows, each with `id` and `state`
 * @param {Object} layout   a `computePlanLayout` result
 * @returns {number[]}
 */
export function activeEpicIds(rows, layout) {
    const placed = (rows || []).filter((r) => layout?.nodes?.has(r.id));
    for (const pick of [(r) => r.state === EPIC_RUNNING, (r) => r.state !== EPIC_DONE,
        () => true]) {
        const ids = placed.filter(pick).map((r) => r.id);
        if (ids.length) return ids;
    }
    return [];
}

/**
 * Fit `n` epics across the viewport around the active epics (req #3648).
 *
 * WHOLE CARDS (user directive: "clicking four gives three cards in the centre
 * and half a card on either side — we agreed to show whole cards"). Centring on
 * the active epics' midpoint lands mid-column whenever that midpoint is not on
 * a column boundary, so the window is snapped to COLUMNS instead: the run of
 * `n` columns whose middle is nearest the active epics' middle, clamped to the
 * plan, with its left gutter on the viewport's left edge (or centred, when the
 * fit leaves air — `EPICS_ACROSS_LOOSE_FILL`). Vertically it still centres on
 * the active epics.
 *
 * WIDER THAN `n`, IT STARTS AT THE FIRST ACTIVE COLUMN (req #3648 code
 * review): centring an active set wider than the window shows its middle and
 * crops the epics that run NEXT — on production plan 7, the four leftmost
 * pending epics were off-screen at every rung. So a set that does not fit
 * shows its first `n` columns. If the zoom range clamped the scale, the window is no
 * longer `n` columns and the plain centring is returned.
 *
 * Null when there is nothing to centre on or no usable scale — the caller
 * falls back to zooming about the viewport's centre.
 */
export function epicsAcrossTransform(layout, rows, n, size, kBase, kFloor) {
    const k = epicsAcrossScale(n, size?.w, layout?.colPitch);
    if (!k) return null;
    const ids = activeEpicIds(rows, layout);
    const centred = centreTransform(epicsFitRect(layout, ids), size, k, kBase, kFloor);
    if (!centred || Math.abs(centred.k - k) > 1e-9) return centred;
    const colX = layout?.colX;
    const colW = layout?.colW;
    const depths = ids.map((id) => layout.nodes.get(id)?.depth).filter(Number.isFinite);
    if (!Array.isArray(colX) || !colX.length || !depths.length) return centred;
    const a0 = Math.min(...depths);
    const a1 = Math.max(...depths);
    const start = a1 - a0 + 1 > n ? a0 : Math.round((a0 + a1) / 2 - (n - 1) / 2);
    const first = Math.min(Math.max(0, start), Math.max(0, colX.length - n));
    const air = Math.max(0, size.w - n * layout.colPitch * k) / 2;
    return { k, x: air - (colX[first] - colW[first] / 2) * k, y: centred.y };
}

// ── SNAP THE WHEEL TO THE SAME LADDER THE BUTTONS USE (req #3498) ──────────
// User directive, 2026-08-13: a toggle that makes the zoom *"go up/down in
// jumps of two cards instead of smooth"*.
//
// EVERY RUNG IS A `epicsAcrossScale`, the buttons' own arithmetic, so the
// wheel and a button land on the SAME scale wherever they share a count (4 and
// 6 since req #3648 made the buttons 6 5 4). It extends as far as the zoom
// extent allows: a toolbar has to stop somewhere, the ladder does not.
export const SNAP_COLUMNS_EPIC = 2;
// The floor: two epics across — the closest look, below the buttons' 3.
export const SNAP_COLUMNS_MIN = 2;

/**
 * How many columns currently span the viewport — the ladder's own unit.
 *
 * `colW` defaults to the scale-1 pitch for a caller with no layout in hand —
 * see `epicsAcrossScale`'s own note on why a live `layout.colPitch` must be
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
 * (fewer epics across), positive zooms OUT (more).
 *
 * THE EPSILON IS WHAT MAKES IT EPIC RATHER THAN STICK. Landing exactly on a
 * rung is the normal case — it is where the last notch put you — so "the
 * largest even below the current count" has to mean strictly below, or every
 * further notch would re-select the rung the reader is already standing on.
 *
 * Rung 2 is LOOSE (`EPICS_ACROSS_LOOSE_FILL`), so the count there reads 2.5
 * rather than 2. That is deliberate and it behaves: zooming out from it finds 4,
 * and zooming in finds the floor and stays.
 */
export function snapZoomScale(k, viewportW, dir, colW = CARD_W + CARD_GAP_X) {
    const c = columnsAcross(k, viewportW, colW);
    if (c == null || !Number.isFinite(dir) || dir === 0) return null;
    const S = SNAP_COLUMNS_EPIC;
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
    const next = epicsAcrossScale(n, viewportW, colW);
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
// The requirement ids are that text: the epic label is bigger and the title slot
// is a level-gated extra, so a scale that keeps the ids legible keeps everything
// a reader needs legible. 11px is the floor MUI itself uses for `caption`-class
// type, and it is what the fit-to-width default fails on the live plan — 64
// epics across a 1600px panel puts the ids near 4px.
export const READABLE_MIN_PX = 11;
export const K_READABLE = READABLE_MIN_PX / PLAN_VIZ_FONT.req;

/**
 * Is the plan's smallest REQUIRED text legible at this scale (req #3280)?
 *
 * THE LEVEL LADDER ANSWERS A RELATIVE QUESTION AND LEGIBILITY IS AN ABSOLUTE
 * ONE, and until this existed the ladder was asked both. `semanticLevel()` takes
 * `curK / kDefault`, so "how far in from where you started" decides WHAT IS
 * DRAWN — and on a large plan the level that starts drawing the epic names and
 * the requirement ids begins at an absolute `k` where neither can be read.
 * MEASURED on live pipeline 2 (136 rows, world width 3620.2, `kDefault` 0.8):
 * L2 begins at k = 0.400, which renders the epic label at 6.6px and the
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
 * itself is: the epic label is bigger and the title slot is a level-gated extra,
 * so a scale that keeps the ids legible keeps everything a reader needs legible.
 * One threshold for all three gated kinds, not one per font — three thresholds
 * would be three places for the halo's magnification to epic (see
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
 *   · the base scale the initiative and epic focus transforms clamp against.
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
 * ONE CONDITION, AND IT IS THE LEVEL (req #3324). 'out' carries no per-epic
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
 * halo reaches past the 14-world-px box an epic label and the first requirement
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
 * the initiative band names are drawn at every level and are not gated at all.
 *
 * This is DRAW-ONLY. `computePlanLayout` reserves every label's rect at every
 * level regardless — the zero-overlap invariant is asserted against it
 * unconditionally — so a kind going dark never moves anything else.
 */
export function drawsLabelKind(kind, level) {
    // `badge` and `epic-link` ride the CARD (req #3498, extended req #3503) —
    // both are drawn in the title area, so they appear exactly where the card
    // does and never float beside a bare bead.
    // `run` (req #3580) and `epic-add` (req #3582) are title-area controls
    // too and ride the card the same way.
    // `collapse` (req #3650) is the card's own fold, on its title line.
    // `stamp` (req #3825) is the card's start/end time line, on its bottom.
    if (kind === 'epic' || kind === 'req' || kind === 'badge'
        || kind === 'run' || kind === 'barrier'
        || kind === 'collapse' || kind === 'stamp') {
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
// The day is the READER's local calendar day (req #3692 review) — see
// `localDayOf` for why the UTC day put tonight's open work under tomorrow.
const slotOfDay = (at) => `1:${localDayOf(at)}`;

// Comparable rank for an epic's derived start. UNKNOWN sorts BEFORE every date
// and FUTURE AFTER every date, which is what makes the monotone max below mean
// "the latest thing this epic is downstream of".
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
 * The axis is a sequence of TIME SLOTS: one leading slot for epics whose start
 * is UNKNOWN, one per distinct calendar DAY that carries work, and one trailing
 * slot for epics that have positively not begun. Day granularity is a choice: a
 * slot per distinct timestamp degenerates the drawing into a one-epic-per-column
 * diagonal and hides every bit of parallelism, while a slot per day puts the
 * work of one day side by side, which is how the plan is actually read.
 *
 * Four epics, and the order matters:
 *
 * 1. **Monotonize.** An epic's effective time is `max(its own, every
 *    dependency's)`. An epic cannot begin before its gate; where the stored
 *    timestamps disagree — and they DO, twice, in live pipeline 2 — the gate
 *    wins. This is the same "topology outranks presentation" ruling design rule
 *    3 makes, applied to the DATA so that epic 4 below needs no special case.
 *    It also resolves UNKNOWN for free: a req-less epic inherits the time of the
 *    work it gates, exactly as it already inherits that work's initiative label.
 * 2. **Local depth.** Inside one slot, an epic's offset is its dependency depth
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
 *   epic can render left of something it depends on because a date said so —
 *   the constraint this requirement was told not to break.
 * - **Slot k renders strictly right of slot j < k.** Proof: by induction, a
 *   same-slot dep contributes `1 + col(d) ≤ origin[k] + localDepth(r)`, and an
 *   earlier-slot dep contributes `1 + col(d) ≤ origin[j] + span[j] + 1 ≤
 *   origin[k]`. Epic 1 is what guarantees there is no LATER-slot dep to break
 *   the induction. So a never-started initiative renders right of every started one
 *   with no synthetic dependency edge anywhere.
 *
 * DEGENERATE CASE, and it is the reason there is no second code path: with no
 * time axis supplied every epic is UNKNOWN, so there is ONE slot, local depth is
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
    const starts = (timeAxis && timeAxis.epicStarts) || new Map();
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
    // finding). A dedicated leading slot put every UNKNOWN epic one column
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
// metric (CHW_REQ 8.4/13.75, CHW_LABEL 10.05/16.5, CHW_INITIATIVE 9.15/15 are all
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
// (`dayHeaderLayout.js`) and the sticky prev/next initiative chips above
// (`placeInitiativeChips`) both use — draw at the natural screen position until it
// scrolls past the viewport edge, then clamp flush to it — simplified to the
// one-strip case: there is exactly one ruler, so nothing pushes it and it
// never drops behind (it is a standing fact about the whole plan, not a
// per-row banner that can be superseded). Only the Y anchor decouples from
// vertical pan; X is untouched, so slot ticks and labels still pan and zoom
// with the columns beneath them.
//
// ── BELOW k = 1 THE STRIP HANGS FROM ITS BOTTOM EDGE (req #3648) ───────────
// The world reserves `RULER_H` (+ 8) WORLD px for the strip, but below k = 1 the
// strip is a constant `RULER_H` SCREEN px (`rulerScreenMag`, below). Hung from
// the world origin it was therefore `RULER_H·(1 − k)` px taller than the room
// made for it, and that excess lay over the TOP band's header — the initiative name
// was clamped below the strip and onto the lane-0 cards (the user's "one lane
// violation", on Reset, in the top initiative only). Unpinned, the strip now ENDS
// where its reservation ends and grows UPWARD; at and above k = 1 the excess is
// zero and this is exactly `max(0, t.y)` as before. The base view
// (`factoryDefaultView`) pulls the plan down by that excess so the strip has
// room at the top.
export function rulerExcessY(k) {
    return (typeof k === 'number' && k > 0) ? RULER_H * Math.max(0, 1 - k) : 0;
}
export function stickyRulerY(t) {
    const ty = (t && typeof t.y === 'number') ? t.y : 0;
    return Math.max(0, ty - rulerExcessY(t?.k));
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
// req #3257 (the concurrent initiative-name work): "the date header owns the
// topmost strip and the initiative names stop just below it" needs ONE readable
// number, not a guessed pixel offset. A caller reading the SAME transform gets
// the exact edge the ruler is drawn at, pinned or not.
//
// It used to be `stickyRulerY(t) + rulerH · k` — the strip as pure world
// content, growing and shrinking with zoom (deviation 2). Since req #3365 the
// strip's vertical axis is SCREEN space, so the `· k` is multiplied by
// `rulerScreenMag(t)` and collapses to `max(k, 1)`. Above k = 1 nothing about
// this number changed; below it, it stops reporting a 7px strip that is
// actually 36px tall and letting the initiative names park inside it.
export function rulerScreenBottom(t, rulerH = RULER_H) {
    const k = (t && typeof t.k === 'number' && t.k > 0) ? t.k : 1;
    return stickyRulerY(t) + rulerH * k * rulerScreenMag(t);
}

// ── THE DRAW-TIME RE-THIN (req #3365; lifted out of the renderer, req #3793) ─
// The layout's own greedy thinning rule ("labelX < lastRight + gap", in
// `buildRuler` above), re-applied to the widths counter-scaling actually
// produces (`mag` = `rulerScreenMag(t)`): the date type is a fixed SCREEN size,
// so in world units it is `mag` times wider than the layout measured. A
// re-application rather than a second rule, so the strip cannot thin one way at
// layout time and another way at draw time.
//
// `startRight` (req #3793) is the right edge, in WORLD x, of something already
// occupying the strip's left end — the maximized Plan page's full screen switch
// sits there — so a date that would begin under it is thinned like any label
// with no room. −∞ (the default) is an empty strip, exactly the old pass.
/**
 * @param {Object[]} slots `ruler.slots` — `{key, showLabel, labelX, labelW}`
 * @param {number} mag     `rulerScreenMag(t)`
 * @param {number} [startRight] world x the first label must clear
 * @returns {Set<string>} the keys of the slot labels drawn
 */
export function drawnRulerLabelKeys(slots = [], mag = 1, startRight = -Infinity) {
    const drawn = new Set();
    let lastRight = startRight;
    for (const s of slots) {
        if (!s.showLabel) continue;          // the layout already refused it
        if (s.labelX < lastRight + RULER_LABEL_GAP * mag) continue;
        drawn.add(s.key);
        lastRight = s.labelX + (s.labelW || 0) * mag;
    }
    return drawn;
}

// ── THE LEFT EDGE ALWAYS NAMES A DAY (req #3873, user directive: "the date bar
//    should hold the latest date element (even future) and stick it to the
//    left edge … similar to how initiatives are dragged off the top of the
//    screen") ────────────────────────────────────────────────────────────────
// Panned into the plan, the strip's dates are the ones whose boundary is ON
// screen, so a reader sitting inside one long day saw an empty strip. The
// sticky-header move the initiative chips make at the top edge
// (`placeInitiativeChips`), turned on its side: the slot whose label would
// begin at or left of the strip's visible left edge — any kind, so `future`
// and `undated` pin too — is drawn flush to that edge, and the next DRAWN
// label pushes it back off to the left as it arrives, so the two hand off
// with no gap and no overlap. Below the push it is that slot's own label,
// moved: its natural copy and any earlier label it would land on are not
// drawn (`hide`).
//
// Against the DRAWN set (`drawnRulerLabelKeys`), not a re-thin from the left
// edge: unmaximized the drawn set is a function of the zoom alone, so a pan
// never makes a date blink on or off; only the pinned one changes, and only as
// a boundary crosses the edge. The edge is the switch's right edge when the maximized
// Plan page's full screen switch occupies the strip's corner (`startRight`,
// the same reserve the re-thin honours).
export const RULER_PIN_PAD = 4;   // SCREEN px between the left edge and the pinned date
/**
 * @param {Object[]} slots `ruler.slots` — `{key, kind, label, labelX, labelW}`
 * @param {Set<string>} drawn `drawnRulerLabelKeys(...)` for the same `mag`
 * @param {{x:number,k:number}} t  the stage transform
 * @param {number} mag     `rulerScreenMag(t)`
 * @param {number} [startRight] world x the first label must clear
 * @returns {?{key:string, kind:string, text:string, x:number, y:number,
 *     hide:Set<string>}} the pinned label (world x), or null when the strip's
 *     first slot is itself on screen
 */
export function stickyRulerLabel(slots = [], drawn = new Set(), t,
    mag = 1, startRight = -Infinity) {
    if (!t || !(t.k > 0) || typeof t.x !== 'number' || !slots.length) return null;
    const gap = RULER_LABEL_GAP * mag;
    const edge = Math.max(-t.x / t.k + RULER_PIN_PAD / t.k, startRight + gap);
    // The first drawn label after slot `i` — the one that pushes it.
    const pusherX = (i) => {
        for (let j = i + 1; j < slots.length; j++) {
            if (drawn.has(slots[j].key)) return slots[j].labelX;
        }
        return Infinity;
    };
    // A THINNED day takes the pin only once it fits whole at the edge: handing
    // it over earlier would show it already pushed, cut off by the left edge.
    // Until then the day before it keeps the pin and is pushed off as usual.
    let idx = -1;
    for (let i = 0; i < slots.length; i++) {
        const s = slots[i];
        if (s.labelX > edge) continue;
        if (drawn.has(s.key)
            || edge + (s.labelW || 0) * mag + gap <= pusherX(i)) idx = i;
    }
    if (idx < 0) return null;
    const s = slots[idx];
    const w = (s.labelW || 0) * mag;
    const x = Math.min(edge, pusherX(idx) - gap - w);
    const hide = new Set([s.key]);
    for (let i = 0; i < idx; i++) {
        const p = slots[i];
        if (drawn.has(p.key) && p.labelX + (p.labelW || 0) * mag + gap > x) hide.add(p.key);
    }
    return { key: s.key, kind: s.kind, text: s.label, x, y: RULER_LABEL_Y, hide };
}

const truncate = (s, n) => {
    const str = String(s == null ? '' : s);
    return str.length > n ? `${str.slice(0, n - 1)}…` : str;
};

// The text drawn in the card's TITLE AREA (req #3498 — it was above the bead
// until the epic became a card). NO '#' anywhere — ids render bare (production
// directive), titles render verbatim (stored plan content).
//
// The default ceiling is the CARD's own text column rather than a hand-set
// `EPIC_LABEL_MAX`: one width, measured where it is drawn, so there is no cap
// left to drift out of epic with the room.
export function epicLabelText(row, epicLabel,
    maxChars = cardChars(CHW_LABEL, CARD_NAME_RESERVE)) {
    return epicLabel === 'title'
        ? truncate(row.title || `epic ${row.id}`, Math.max(4, maxChars))
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
    reqPills = null, maxChars = cardChars(CHW_REQ) } = {}) {
    const prefix = reqPillPrefix(reqId, reqPills).text;
    if (reqLabel !== 'title') return prefix;
    const t = titleLookup(reqTitles, reqId);
    // The id rides ALONGSIDE the title, not instead of it (user directive) — an
    // id-only mark reading "3242" gives no hint what's under it without a
    // hover; "3242   Pipeline Visualizer Polish" answers that at the same L3
    // glance the title itself was added for. Built BEFORE truncation, same as
    // the bare id below, so the id survives the cut and the title is what
    // gives way on a tight column — the id is the one piece of this string a
    // reader can always resolve to the actual requirement.
    return t ? truncate(`${prefix}${' '.repeat(CARD_SEP_CHARS)}${t}`, Math.max(4, maxChars))
        : prefix;
}

// ── THE TERMINAL AND DEV-SERVER PILLS (req #3587) ───────────────────────────
// *"If a requirement has a dev server or terminal show those pills in the
// visualizer so: 3572 Terminal 2 3002 - Title"*. The two tokens are part of the
// row's TEXT, between the id and the title, and the renderer draws a pill
// behind each one. That is the whole design, and it is why the pills need no
// geometry of their own: the wrap, the card height, the zero-overlap sweep and
// the hover box all measure them as the characters they are, so nothing this
// module proves about a row's box has to be re-proved for them.
//
// TWO SPACES between tokens, so a pill's padding (drawn by the renderer, inside
// the gap) leaves clear air between neighbours. The gap AFTER THE ID is the id
// column's own (`CARD_SEP_CHARS`, the width of the blank gap), so the first pill begins
// on the title column every row's title and wrapped lines start on (req #3575's
// hanging indent) and never inside the room reserved for the id (req #3601,
// user: "Terminal intrudes into the space when added and should never do so").
// A NO-BREAK SPACE inside
// "Terminal 2", because `wrapReqText` breaks on ' ' and a pill split across two
// lines is not a pill.
//
// The lookup is an ARGUMENT, never a row field — `reqTitles`' reasoning above:
// session state is display data the engine's PlanRows must not carry. Entries
// are `{terminal: {label}, devServer: {port}}` (`planReqPills.js` builds them);
// the layout reads only those two strings.
export const REQ_PILL_SEP = '  ';
const NBSP = '\u00a0';
const pillLookup = (reqPills, reqId) => {
    if (!reqPills) return null;
    if (typeof reqPills.get === 'function') return reqPills.get(reqId) || null;
    return Object.hasOwn(reqPills, reqId) ? reqPills[reqId] : null;
};

/**
 * The id plus its pill tokens, and WHERE each token sits in that string.
 *
 * @returns {{text: string, pills: Array<{kind: ('terminal'|'devserver'),
 *            start: number, len: number}>}}  `start`/`len` are character
 *            offsets into `text` — and so into the row's first line, which
 *            always begins with this prefix.
 */
export function reqPillPrefix(reqId, reqPills) {
    const p = pillLookup(reqPills, reqId);
    const tokens = [];
    if (p?.terminal?.label) {
        tokens.push({ kind: 'terminal', text: String(p.terminal.label).replace(/ /g, NBSP) });
    }
    if (p?.devServer?.port != null && p.devServer.port !== '') {
        tokens.push({ kind: 'devserver', text: String(p.devServer.port) });
    }
    let text = String(reqId);
    const pills = [];
    for (const t of tokens) {
        text += pills.length ? REQ_PILL_SEP : ' '.repeat(CARD_SEP_CHARS);
        pills.push({ kind: t.kind, start: text.length, len: t.text.length });
        text += t.text;
    }
    return { text, pills };
}

const reqStr = (row) => (row.reqIds || []).join(' ');

// ── Initiative band label text (req #3225) ─────────────────────────────────────
//
// THE COUNT SUFFIX IS AN ARGUMENT, NOT A ROW FIELD — the same reasoning as
// `reqTitles` above: `initiativeCounts` is display data, and the engine's PlanRows
// stay untouched by it. Unlike `reqTitles` though, this is measured into the
// band's own label rectangle rather than a per-requirement mark, because the
// zero-overlap contract is asserted over `layout.labels` and a count drawn
// beside the name in a second rectangle would not be covered by it — exactly
// the failure the requirement calls out by name.
//
// Absent for the "No initiative" band (initiativeId null): a bead with no initiative has no
// requirement set to count against, and a stray "0/0" would claim an answer
// that does not exist. Absent equally when `initiativeCounts` carries no entry for
// a real initiative — a truncated or stale counts map degrades to the plain name
// rather than a wrong number.
//
// @param {?number} initiativeId
// @param {string} initiativeName
// @param {?(Map|Object)} initiativeCounts  initiativeId -> {met, total}, or null/undefined
//                                    to leave every band's plain name alone
// @returns {string}
function initiativeBandLabelText(initiativeId, initiativeName, initiativeCounts) {
    const countText = initiativeBandCountText(initiativeId, initiativeCounts);
    return countText ? `${initiativeName} ${countText}` : initiativeName;
}

// req #3580 — the SAME suffix on its own, so the chip can draw the closure
// count as its own element (it is a zoom control; the name beside it is an
// in-place editor). `initiativeBandLabelText` above is built FROM this, so the
// measured label and the two drawn pieces can never disagree.
function initiativeBandCountText(initiativeId, initiativeCounts) {
    if (!initiativeCounts || initiativeId == null) return null;
    const counts = typeof initiativeCounts.get === 'function'
        ? initiativeCounts.get(initiativeId)
        : (Object.hasOwn(initiativeCounts, initiativeId) ? initiativeCounts[initiativeId] : null);
    return counts ? `${counts.met}/${counts.total}` : null;
}

/**
 * Compute the full Plan-mode layout.
 *
 * @param {Object[]} rows      engine PlanRows, DISPLAY order (epics sort within
 *                             a band by column, so pass displayOrder output)
 * @param {Object} [opts]      NOTE: this was the THIRD parameter until req
 *                             #3371 removed the launch-grouping argument
 *                             between the two. A caller that still passes an
 *                             array here silently loses its options, so the
 *                             guard below refuses one loudly instead.
 * @param {('id'|'title')} [opts.reqLabel]   what a requirement ROW inside the
 *                             card says. `reqLayout` and `epicWidth` left with
 *                             req #3498 — a card stacks its requirements and is
 *                             a fixed width, so neither had anything to select.
 * @param {(Map|Object)} [opts.reqTitles]    requirement id -> title, for 'title'
 * @param {(Map|Object)} [opts.reqPills]     req #3587 — requirement id ->
 *                             `{terminal: {label}, devServer: {port}}`, drawn as
 *                             pills between the id and the title
 * @param {('id'|'title')} [opts.epicLabel]  what the card's TITLE AREA says
 * @param {?Object} [opts.timeAxis]  planTimeAxis() output (req #3201). Omitted,
 *                             the axis degenerates to pure dependency depth and
 *                             bands stack by `initiatives.sort_order` (req #3430),
 *                             then initiative id — see computeTimeColumns.
 * @param {?(Map|Object)} [opts.initiativeCounts]  req #3225 — initiativeId -> {met, total}.
 *                             Null/omitted (the toggle-off state) leaves every
 *                             band's label exactly as it reads today.
 * @param {?Object} [opts.pauseInfo]  req #3226 — `pauseState()`'s
 *                             `{pipelinePaused, pausedInitiativeIds}`. Null/omitted
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
    // the wrong requirement layout, with the wrong epic width and no time axis.
    // That is the failure mode a silent argument shift always has — plausible
    // output, no error, no test to catch it. Refusing an array here turns it
    // into a stack trace at the call site.
    if (Array.isArray(opts)) {
        throw new TypeError(
            'computePlanLayout(rows, opts): the launch-grouping argument was '
            + 'removed (req #3371). Drop the second argument from this call.');
    }
    const {
        epicLabel = 'id',
        reqLabel = 'id', reqTitles = null, timeAxis = null, initiativeCounts = null,
        pauseInfo = null,
        // req #3649 — `{ planLocked, lockedInitiativeIds }`; a band is LOCKED when
        // the whole plan is or when its own initiative is, resolved once here like
        // `paused` below. Null = nothing locked.
        lockInfo = null,
        // req #3587 — requirement id -> {terminal, devServer}; see
        // `reqPillPrefix`. Null leaves every row reading exactly as before.
        reqPills = null,
        // req #3503 — "Epic Width". A relayout, deliberately: the ladder's own
        // rungs (`EPIC_WIDTH_RUNGS`, quarters of the base card since req
        // #3648) are the only legal values; anything else lays out the base
        // card.
        epicWidthLevel = DEFAULT_EPIC_WIDTH_LEVEL,
        // req #3650 — the boxes the reader folded with their own collapse
        // heads (`planCollapse.js`): initiative ids (null = the "No initiative" band) and
        // epic ids. Null folds nothing.
        collapsedInitiativeIds = null, collapsedEpicIds = null,
        // req #3695 — initiative key -> how far OPEN that band is drawn, 0..1, for
        // the bands whose fold is ANIMATING (`planFoldAnimation.js`). It
        // overrides the fold for drawing only; `collapsed` still reports the
        // reader's fold. Null (every settled layout) animates nothing.
        foldReveal = null,
    } = opts || {};
    const initiativeFolded = (key) => !!collapsedInitiativeIds?.has(key);
    // req #3695 — a band's REVEAL: 1 open, 0 folded, between while its fold
    // animates. Clamped, so a frame that overshoots cannot draw a band taller
    // than open or a negative one.
    const bandRevealOf = (key) => {
        if (foldReveal?.has(key)) {
            const v = Number(foldReveal.get(key));
            return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : (initiativeFolded(key) ? 0 : 1);
        }
        return initiativeFolded(key) ? 0 : 1;
    };
    const epicFolded = (r) => !!collapsedEpicIds?.has(r.id);
    const widthScale = epicWidthScale(epicWidthLevel);
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
            // req #3620 — the Orchestrables box mirrors this, so an empty
            // plan still answers the rung's frame width.
            cardFrameW,
            epicLabel, reqLabel, empty: true,
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
    const rowLinesOf = new Map();      // epic id -> [[line, line?], …]
    for (const r of safeRows) {
        const ids = r.reqIds || [];
        // The HANGING INDENT (req #3575): a wrapped title's continuation lines
        // start where `${id}   ` ends, so the left edge holds the ids alone. It
        // is the BARE id's width even on a row carrying pills — hanging under a
        // pill row's title start would leave three characters a line — so every
        // row's continuations line up on the one title column.
        rowLinesOf.set(r.id, ids.map((reqId) => wrapReqText(
            reqLabelText(reqId, {
                reqLabel, reqTitles, reqPills, maxChars: reqRowMax * REQ_MAX_LINES,
            }), reqRowMax, REQ_MAX_LINES, String(reqId).length + CARD_SEP_CHARS)));
    }
    // A FOLDED epic (req #3650) reserves no requirement block at all, so its
    // card is the title area alone. Its LANE is as tall as the tallest card
    // still in it, so the lane closes up only when nothing beside it is taller.
    const reqBlockOf = (r) => (epicFolded(r) ? 0
        : reqBlockHeight(rowLinesOf.get(r.id) || []));
    // The time line (req #3825) is the card's, not its rows', so a folded card
    // keeps it.
    const stampHOf = (r) => (r.stampsReserved ? CARD_STAMP_H : 0);
    // The card's TITLE AREA, wrapped by the same rule and reserved the same way.
    // `epicLabelText` is asked for the whole name (the budget times the line
    // count) and `wrapReqText` breaks it; a short name still returns one line,
    // so only the cards that need the room pay for it.
    //
    // ── A NAME WITH NO ROOM BESIDE THE CONTROLS GETS ITS OWN LINE (req #3648) ─
    // The title area carries the chevron and the count badge on the left and
    // the control column on the right (req #3683, #3742). On a narrow Epic Width that could leave
    // the name under `NAME_INLINE_MIN_CHARS`, and `cardChars` floors at 3 — so
    // the name would draw UNDER the controls (req #3648 code review). Below that
    // the controls keep their rows to themselves and the name starts under the
    // cluster, at the text column's full width; those rows are counted as title
    // area lines, so every height derived from the line count reserves them.
    const nameInlineReserve = CARD_NAME_RESERVE;
    const nameBelow = epicLabel === 'title'
        && Math.floor((cardTextW - nameInlineReserve) / CHW_LABEL) < NAME_INLINE_MIN_CHARS;
    const nameBudget = cardChars(CHW_LABEL, nameBelow ? 0 : nameInlineReserve, cardTextW);
    const nameLinesOf = new Map();
    for (const r of safeRows) {
        nameLinesOf.set(r.id, wrapReqText(
            epicLabelText(r, epicLabel, nameBudget * NAME_MAX_LINES),
            nameBudget, NAME_MAX_LINES));
    }
    // Title-area LINES, the cluster's rows included when the name is below it.
    const nameLineCount = (r) => (nameLinesOf.get(r.id) || ['']).length
        + (nameBelow ? CARD_CLUSTER_ROWS : 0);

    // ── Column widths: UNIFORM, AT THE CARD (req #3498) ─────────────────────
    // Every column is one card wide plus the gutter, and that is the whole rule.
    //
    // It used to be "as wide as the widest thing DRAWN in it", which is why this
    // block measured requirement-id strings and epic labels and then multiplied
    // the result by the S/M/L width factor. Content-sized columns are what made
    // the world 5800px wide on the live plan, and they are what the stagger
    // existed to claw room back from. The user's directive replaces the whole
    // negotiation with a number — *"we need a fixed width... make the card at
    // req# plus 40 chars wide"* — so a long requirement title now costs VERTICAL
    // room inside its card instead of pushing every card in its column sideways.
    //
    // `colEpics` survives: the lane sweep below still needs to know which epics
    // share a column, it just no longer asks them how wide they are.
    const colEpics = [];
    for (const r of safeRows) {
        const d = colOf.get(r.id);
        (colEpics[d] ||= []).push(r);
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

    // ── Initiative bands (dominant label), stacked by `initiatives.sort_order` (req #3430),
    //    then by DERIVED START (req #3201) for the initiatives nobody has ordered ────
    //
    // **THE USER'S ORDER WINS.** `initiatives.sort_order` is the AUTHORITATIVE initiative
    // display order (user ruling, 2026-08-09), and THIS is the surface that
    // ruling was about: the band stack is what a person looking at the Pipeline
    // Visualizer reads as "the order of the initiatives". An initiative carrying a
    // `sort_order` is placed by it and by nothing else — derived start does not
    // get a vote, because a rule that sometimes overrides the order the user
    // typed is a rule the user cannot use.
    //
    // Everything below is the FALLBACK, unchanged, for initiatives whose `sort_order`
    // is NULL: an unordered plan stacks exactly as it did before req #3430, and
    // an ordered initiative always sits above an unordered one.
    //
    // The vertical axis reads as time too: the initiative whose earliest epic sits
    // furthest left sits on top. An initiative's start is the minimum over its EPICS'
    // times — an epic's time being its LAST activity, or today when it is
    // running (req #3692) — there is no `initiatives.started_at` and design rule 1
    // says there never will be — and `pipelinePlanTime.js` owns the derivation,
    // including the ruling that a requirement which completed without ever
    // being stamped `started_at` counts as active on its `completed_at`.
    //
    // THREE TIERS, then tie-breaks, stated rather than left to sort stability:
    //   1. `dated`   — sort ascending on the derived start;
    //   2. `unknown` — no start, but evidence of work whose timing was never
    //                  recorded. A NULL start alone used to mean both this and
    //                  tier 3, which let a pure BACKLOG initiative stack above an
    //                  ACTIVE one on an id tie-break (review finding);
    //   3. `future`  — every epic positively has not begun. Sorts LAST.
    // Within a tier: INITIATIVE ID ascending, the label-less "No initiative" band last of
    // all. Id rather than first appearance on purpose — first appearance moved
    // a band down the stack whenever an epic was appended to another initiative, a
    // documented wart of the old rule, and it carried no time meaning.
    const bandStarts = (timeAxis && timeAxis.bandStarts) || new Map();
    const bandKinds = (timeAxis && timeAxis.bandKinds) || new Map();
    const BAND_TIER = { dated: 0, unknown: 1, future: 2 };
    const bandTierOf = (key) => {
        const t = BAND_TIER[bandKinds.get(key)];
        return t === undefined ? BAND_TIER.future : t;
    };
    // req #3226 — a band is PAUSED when the whole plan is paused (every band
    // suppressed alike, "No initiative" included — pause is a plan-wide fact there
    // too) OR when this band's OWN initiative is paused. Resolved once, here, rather
    // than at render time in every consumer of `band`, the same reasoning
    // `bandStartOf` below is memoized for.
    const pausedInitiativeIdSet = new Set(pauseInfo?.pausedInitiativeIds || []);
    const planPaused = !!pauseInfo?.pipelinePaused;
    const bandPausedOf = (key) => planPaused || (key != null && pausedInitiativeIdSet.has(key));
    const lockedInitiativeIdSet = new Set(lockInfo?.lockedInitiativeIds || []);
    const planLocked = !!lockInfo?.planLocked;
    const bandLockedByOf = (key) => (planLocked ? 'pipeline'
        : (key != null && lockedInitiativeIdSet.has(key)) ? 'initiative' : null);

    // req #3372 (2026-08-10) — the requirement asked for the "No initiative" band
    // (the `key == null` case throughout this file) to be deleted outright,
    // on the premise that `initiative_fk` is a NOT NULL column upstream by the time
    // a row reaches this module. MEASURED WRONG the same day: req #3462
    // reverted req #3381's cutover of the browser onto the 2.0 composed read
    // (a production outage — no 1.0<->2.0 pipeline id mapping exists), so
    // `computePlanLayout`'s only live caller — `PipelinePlanVisualizer.jsx`,
    // mounted by `PipelineDetail.jsx` via `pipelineDetailModes.js`, fed by
    // `pipelineModel.js`'s dominant-initiative tally + label inheritance — can
    // still hand this module a row with `initiativeId == null`. Deleting the
    // branch here would misrender or throw on that still-reachable case, so
    // it is kept — see `pipelinePlanLayout.test.js` "a band is a plain
    // column read" for the fixture proving it is exercised on purpose, not
    // defensively. This module's own job is unaffected either way: it never
    // re-tallies an initiative itself, it only reads `row.initiativeId` as handed to it.
    const bandKeys = [];
    const bandByKey = new Map();
    // req #3430 — initiative id -> `initiatives.sort_order`, or null for UNORDERED. Taken
    // from the row, which `pipelineModel.js::buildPlanRows` resolved from the
    // one initiatives dictionary; this module never re-reads the table, so there is
    // no second answer to keep in epic. Every row of one band carries the same
    // value (it is a property of the initiative), so first-writer-wins is not a
    // choice between candidates.
    const bandSortOrders = new Map();
    for (const r of safeRows) {
        const key = r.initiativeId != null ? r.initiativeId : null;
        if (!bandByKey.has(key)) {
            const initiative = r.initiative || 'No initiative';
            bandSortOrders.set(key, key != null && Number.isFinite(r.initiativeSortOrder)
                ? r.initiativeSortOrder : null);
            bandByKey.set(key, {
                key, initiativeId: key, initiative,
                // req #3225 — the SAME string measures the zero-overlap label
                // rect and the floating chip; see the helper's own comment.
                initiativeLabel: initiativeBandLabelText(key, initiative, initiativeCounts),
                initiativeCountText: initiativeBandCountText(key, initiativeCounts),
                paused: bandPausedOf(key),
                // req #3649 — `locked` is the band's EFFECTIVE lock (its initiative's
                // own, or the plan's); `lockedBy` says which.
                locked: bandLockedByOf(key) != null,
                lockedBy: bandLockedByOf(key),
                // req #3650 — folded by its own collapse head: the band keeps
                // its header (the chip that unfolds it) and draws no lanes.
                collapsed: initiativeFolded(key),
                // req #3695 — how far open the band is DRAWN (see
                // `bandRevealOf`). Equal to `!collapsed` on every settled
                // layout; only an animating fold puts it in between.
                reveal: bandRevealOf(key),
                epics: [],
            });
            bandKeys.push(key);
        }
        bandByKey.get(key).epics.push(r);
    }
    const bandStartOf = (key) => {
        const v = bandStarts.get(key);
        return v == null ? null : String(v);
    };
    bandKeys.sort((a, b) => {
        // req #3430 — the user's order, ahead of everything derived. NULL is
        // UNORDERED, not zeroth: it sorts after every ordered initiative and then
        // falls through to the req #3201 tiers below, so the "No initiative" band
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
    const initiativePalette = planPalette(opts.palette).initiative;
    bandKeys.forEach((key, i) => {
        bandByKey.get(key).color = initiativePalette[i % initiativePalette.length];
    });

    // ── Chain-aware lanes with cross-column reservation ─────────────────────
    // Epics place in ascending depth order, so by the time an epic chooses a
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
    // A corridor cell held for a straight arc. It records the arc's SOURCE
    // (req #3669): another arc out of that same epic may run along it, because
    // the two leave one card at one y and read as a trunk that forks. Anything
    // else is still blocked. Before, a reservation was anonymous, so a branch's
    // LATE bend along its parent's own row was refused and fell back to EARLY
    // — running along the branch's row over whatever beads sat there. That hole
    // was rare while a branch usually took the parent's row itself; the heir
    // rule below makes the trunk keep it, which makes the fork the common case.
    const RESERVED = Symbol('reserved');
    const reservedFor = (srcId) => ({ [RESERVED]: srcId });
    // `o` is a cell occupant: an epic id, a reservation, or undefined.
    const reservedBy = (o) => (o !== null && typeof o === 'object' ? o[RESERVED] : undefined);
    const isReserved = (o) => reservedBy(o) !== undefined;
    for (const key of bandKeys) {
        const band = bandByKey.get(key);
        // COLUMN-MAJOR, and that is now the whole sort (req #3371). Two further
        // keys used to follow it — grouped epics ahead of ungrouped ones, then
        // by the group's letter — so a launch unit's members were adjacent
        // inside a column and its dashed rectangle could enclose exactly them.
        // With no rectangle there is nothing to keep adjacent, and a tie-break
        // that orders nothing only makes the placement harder to reason about.
        const epics = [...band.epics].sort((a, b) =>
            (colOf.get(a.id) - colOf.get(b.id)));
        const used = new Map(); // depth -> Map(lane -> epic id | reservedFor(src))
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
                if (!isReserved(occupant)) {
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
                if (isReserved(o)) {
                    if (reservedBy(o) === a.id) continue;
                    return false;
                }
                if (!(reach(o).has(a.id) && reach(r.id).has(o))) return false;
            }
            return true;
        };
        const sameInitiativeDepsOf = (r) => depsOf(r).map((x) => byId.get(x))
            .filter((a) => (a.initiativeId != null ? a.initiativeId : null) === key);
        // Same-band dependents, for the corridor-aware placement check below.
        const dependentsInBand = new Map(); // id -> [dependent ids]
        for (const r of epics) {
            for (const a of sameInitiativeDepsOf(r)) {
                if (!dependentsInBand.has(a.id)) dependentsInBand.set(a.id, []);
                dependentsInBand.get(a.id).push(r.id);
            }
        }
        // ── A LANE HAS ONE HEIR, AND A NEW BRANCH IS NEVER IT (req #3669) ───
        // When two dependents of one epic both want that epic's lane, the one
        // that PLACES first used to win — and placement order is column, then
        // display order, neither of which says which thread was there first.
        // MEASURED on live plan 10's initiative 24: 320 → 321 → 324 → 322 was one
        // row; the user added 329 off 321. 329 and 324 share column 9, 329
        // sorts first, so 329 took 321's row and the ORIGINAL continuation
        // 324 → 322 dropped onto a new row below it. The user's words: *"I
        // would expected E to start a new lower row and be always visualized
        // there."*
        //
        // So the lane's heir is decided up front, by CREATION ORDER, and the
        // unit of creation order is the THREAD, not the epic: a dependent is
        // as old as the oldest epic it leads to inside the band (itself or any
        // same-band descendant), and the oldest thread is the heir. Comparing
        // the direct dependents' own ids is not enough — an epic INSERTED into
        // the trunk is newer than the branch it competes with, and live initiative
        // 24 was built exactly that way (324 was inserted in front of 322, 329
        // in front of 323). The trunk still reaches its old tail; a new branch
        // reaches only new epics. Ties (a branch that merges back into the
        // trunk) go to the older direct dependent. An epic id is allocated once
        // and never changes, so adding a branch can never displace the chain
        // it branches off — whatever the time axis does to the columns or the
        // derivation does to display order. Every other dependent is a BRANCH
        // and opens (or re-uses) a row beside its parent.
        //
        // Ids are integers from the derivation; the numeric collation keeps a
        // string-id fixture ordering '9' before '10' rather than as text.
        const idBefore = (p, q) => ((typeof p === 'number' && typeof q === 'number')
            ? p < q
            : String(p).localeCompare(String(q), undefined, { numeric: true }) < 0);
        const oldestMemo = new Map();
        const oldestIn = (id) => {
            if (oldestMemo.has(id)) return oldestMemo.get(id);
            oldestMemo.set(id, id); // cycle guard
            let best = id;
            for (const t of dependentsInBand.get(id) || []) {
                const o = oldestIn(t);
                if (idBefore(o, best)) best = o;
            }
            oldestMemo.set(id, best);
            return best;
        };
        const heirOf = new Map(); // dependency id -> heir epic id
        for (const [aid, deps] of dependentsInBand) {
            heirOf.set(aid, deps.reduce((p, q) => {
                const op = oldestIn(p);
                const oq = oldestIn(q);
                if (idBefore(oq, op)) return q;
                if (idBefore(op, oq)) return p;
                return idBefore(q, p) ? q : p;
            }));
        }
        // An epic tries the lanes it is HEIR to first, so the row held for it
        // is the row it takes rather than one of its other dependencies'.
        const inheritOrder = (r) => {
            const deps = sameInitiativeDepsOf(r);
            return [...deps.filter((a) => heirOf.get(a.id) === r.id),
                ...deps.filter((a) => heirOf.get(a.id) !== r.id)];
        };
        // A lane is usable only if (1) the cell is free, (2) every same-lane
        // dependency arc into it crosses only in-chain beads, and (3) — the
        // corridor-aware rule (user directive, initiative #6 plan) — no shallower
        // bead already on the lane still owes an arc PAST this column to a
        // deeper same-band dependent: parking here would sit this bead on that
        // arc's horizontal run (the 50-under-49 spaghetti). Exempt when r
        // CONTINUES the shallower bead's chain — see req #3512 below.
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
            for (const a of sameInitiativeDepsOf(r)) {
                const al = laneById.get(a.id);
                if (al === lane && !corridorOk(a, r, lane)) {
                    return false;
                }
                // Cross-lane dep: the arc will need EITHER its source-lane
                // corridor (late bend) or this candidate lane's corridor
                // (early bend). If both are already blocked, any drawing of
                // the arc runs over an unrelated bead — reject the lane and
                // let dep-adjacent insertion open a clean one. (Found live:
                // a two-dep epic parked where one dep's arc had no clear
                // corridor on either lane and overdrew two beads.)
                if (al !== undefined && al !== lane
                    && !corridorOk(a, r, al) && !corridorOk(a, r, lane)) {
                    return false;
                }
            }
            // ── THE EXEMPTION IS THE WHOLE CHAIN, NOT THE FIRST LINK (#3512) ─
            // This read `new Set(depsOf(r)).has(sid)` — r's DIRECT dependencies
            // — while the sentence it implements says *r continues that chain*.
            // A grandchild continues a chain exactly as a child does, so the
            // direct/transitive distinction refused lanes for no stated reason.
            //
            // MEASURED 2026-08-14 on the live composed read of pipeline 7,
            // "Technical Debt" (the requirement's own repro). 310
            // Beautifucation is the root; 306 Priority 1 → 307 Priority 2 → 311
            // Priority 3 → 312 Priority 4 is one chain off it, 308 Windows
            // Swarm Primary Cutover → 309 Windows Priority 1 the other. The
            // TIME AXIS is what exposes it: it moves 308 from column 1 to
            // column 4, so 310's arc to 308 now spans columns 0→4 and passes
            // over column 2, where Priority 2 wants to sit. `sid` is 310 and
            // `r` is 307 — 306 sits between them, the direct-dep exemption
            // missed, lane 0 was refused, and 307 fell through to dep-adjacent
            // insertion and opened a THIRD lane under a chain that needs two.
            // Priority 2/3/4 rendered on their own line, visually disconnected
            // from Priority 1 directly above them.
            //
            // WHAT THIS PREDICATE IS AND IS NOT. It is a GUESS about a
            // placement that has not happened yet — `tid` has no lane when this
            // runs — so it was never what holds the drawing invariants. Those
            // are held at the arc's other end, on stored placements, and they
            // are unaffected by widening the exemption:
            //   · when `tid` later tries this lane, its own `corridorOk(sid,
            //     tid, lane)` sees r in the corridor and admits it only if
            //     `reach(tid).has(r)` — i.e. only in the legitimate in-chain
            //     case `sid → r → tid` (the 12→14-over-13 shape). Otherwise the
            //     corridor is blocked and `tid` cannot inherit the lane. Two
            //     cases, both correct; the exemption itself says nothing about
            //     `reach(tid).has(r)` either way.
            //   · check (1), *no two beads on one `(band, column, lane)` cell*,
            //     never enters into it: it is `free(d, lane)` above, untouched.
            //
            // WHAT IT CAN MOVE, HONESTLY (code review finding, 2026-08-14). An
            // arc bends LATE only when its SOURCE-lane corridor is clear; when
            // that fails, EARLY is the unconditional fallback and NOTHING
            // checks the destination-lane corridor it then runs along (see the
            // `late` computation at the arc loop, and its own comment: *"if
            // neither is clear, early is the fallback"*). That hole predates
            // this requirement and is out of its scope — but it means granting
            // r a lane here CAN relocate a crossing onto an early arc. It is a
            // trade, not a free win, and the measurements say which way it goes:
            //
            //   400-plan timed fuzz corpus (804 bands), before → after
            //     total lanes        1897 → 1877 (with axis)  2122 → 2122 (without)
            //     arc crossings        17 →   11 (with axis)     3 →    3 (without)
            //     worst single plan     3 →    3 (with axis)     1 →    1 (without)
            //     per-plan            no plan gained a crossing; 5 plans lost
            //                         6 between them (seeds 9, 149, 223, 243,
            //                         309 — the last losing two)
            //   24,000-plan adversarial sweep (5-14 epics, 1-3 initiatives, dep
            //   densities 0.15-0.40, both axis modes — 48,000 layout pairs)
            //     total lanes    219,919 → 217,822 (-0.95%)
            //     arc crossings    5,938 →   5,659 (-4.7%)
            //     per-plan       600 plans gained one, 746 lost one — DOWN in
            //                    aggregate, NOT monotone per plan
            //     cell collisions, coincident beads, straight/late-arc
            //     violations: 0 before, 0 after
            //   live plan 7's "Technical Debt", 2026-08-14T19:00Z: 3 lanes → 2,
            //     with the Priority 1-4 chain whole on lane 0
            //
            // NO OTHER LIVE LANE COUNT IS QUOTED HERE, deliberately (design
            // rule 11). The first draft of this comment also carried "First
            // Principles 11 → 10" and it was WRONG within half an hour: a
            // review re-measured 12 → 10. Between the two reads the plan's
            // `epics`, `epic_deps`, `epic_requirements` and `initiatives` were
            // byte-identical and EXACTLY ONE requirement stamp moved — 3446
            // reaching `met` at 19:32:54Z — and that stamp provably changes
            // nothing: `epicStart` (then) took the MINIMUM `requirementStart`
            // over an epic's linked requirements, and 3447 on the same epic
            // carries an `started_at` 41 minutes earlier, so 3446's is never
            // the minimum. (Req #3692 since replaced the minimum with the
            // epic's LAST activity — `epicTime` in `pipelinePlanTime.js`.)
            // (Nulling both of 3446's stamps and re-laying out confirms it: the
            // count does not move. Its epic is in Technical Debt anyway.)
            //
            // So THE CAUSE WAS NEVER PINNED — and that is a RESULT, not a gap
            // in the investigation. A requirement's `started_at`/`completed_at`
            // feeds `planTimeAxis` (the STAMPS — `requirement_status` was then
            // consulted only via `isNotYetStarted`, when no stamp exists; since
            // req #3692 the derived RUNNING state places an epic on today too),
            // which feeds the columns, which feed the lanes. Sweeping every
            // stamped requirement on the plan under the shipped predicate, FIVE
            // move the First Principles count (3338, 3477, 3486, 3490, 3491),
            // every one of them seated in First Principles, none of them the
            // one that actually changed. A per-initiative count on an orchestrated
            // plan moves while nobody edits the plan, and no test can ever
            // re-check it.
            //
            // The Technical Debt line above survives that because its DURABLE
            // half is not the count: the Priority 1-4 chain is whole on lane 0
            // with the axis AND without it, so the fix holds that chain
            // together whatever the axis does with the columns. The figures
            // with a ratchet behind them are the corpus ones.
            //
            // So: fewer lanes and fewer crossings overall, every hard invariant
            // intact, and a per-plan distribution that moves both ways. The
            // corpus ratchet in `pipelinePlanLayout.test.js` pins totals AND
            // the worst single plan, because a sum alone cannot see that.
            //
            // THE CHAIN MAY LEAVE THE BAND. `reach` is band-agnostic, so
            // `rReach.has(sid)` is satisfiable by a path that detours through
            // another initiative and draws no arc in this band at all — measured,
            // 43% of the 7,949 firings on the shipped corpus. That is
            // DELIBERATE and consistent: `corridorOk`, `corridorClear` and the
            // test suite's own `assertStraightArcsClear` all use the identical
            // band-agnostic predicate, so narrowing it here alone would make
            // this check disagree with the three that consume its result.
            //
            // TWO GUARDS WENT WITH THE OLD PREDICATE, both strictly subsumed by
            // this one and both removed rather than left dead: the inner
            // `reach(r.id).has(sid) && reach(tid).has(r.id)` clause (its first
            // conjunct IS this exemption), and `if (tid === r.id) continue`
            // (`dependentsInBand` holds only DIRECT dependents of `sid`, so
            // `tid === r.id` implies `sid ∈ depsOf(r) ⊆ reach(r.id)` and the
            // outer `continue` already fired). The second was measured dead
            // before deletion: 0 hits in 47,492 iterations of the `tid` loop
            // across the shipped corpus plus 24,000 fuzz plans.
            //
            // AND IT IS DEAD FOR A SECOND, STRONGER REASON (review), which is
            // the one to lean on: the argument above rests on `byId.get(r.id)
            // === r`, and `byId` does not dedupe, so a duplicate-id input could
            // make the two `depsOf` disagree. The NEXT LINE closes that
            // unconditionally — all three `laneOk` call sites pass
            // `d = colOf.get(r.id)`, so `tid === r.id` gives
            // `colOf.get(tid) === d`, and `colOf.get(tid) <= d` continues. No
            // reachability, no `byId`, no `reach` involved: had the guard ever
            // been reachable, the line below would have handled it identically.
            // (4) THE HEIR'S ROW IS HELD FOR IT (req #3669). The bead this
            // lane ends on, short of column d, has an heir; until that heir has
            // placed, nobody else may sit on the lane at or before the heir's
            // column — it would take the heir's cell or block its corridor.
            // Exempt only an epic UPSTREAM of the heir (tail → r → heir), which
            // continues the heir's own chain. It lives HERE, not at the
            // inheritance call, because every placement path (inherit, re-use,
            // the dep-less scan) goes through this predicate — guarding only
            // inheritance let a branch re-use ANOTHER thread's row and push that
            // thread's own next epic off it (code review, req #3669).
            let tail = null;
            for (const bead of laneBeads.get(lane) || []) {
                if (bead.d < d && (tail === null || bead.d > tail.d)) tail = bead;
            }
            const heir = tail === null ? undefined : heirOf.get(tail.id);
            if (heir !== undefined && heir !== r.id && !laneById.has(heir)
                && colOf.get(heir) >= d && !reach(heir).has(r.id)) {
                return false;
            }
            const rReach = reach(r.id);
            for (const { id: sid, d: ds } of laneBeads.get(lane) || []) {
                if (ds >= d || rReach.has(sid)) continue;
                for (const tid of dependentsInBand.get(sid) || []) {
                    if (colOf.get(tid) <= d) continue;
                    return false;
                }
            }
            return true;
        };
        // ONE LANE RULE FOR EVERY EPIC (req #3371). Until the launch grouping
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
        for (const r of epics) {
            const d = colOf.get(r.id);
            let lane = null;
            for (const a of inheritOrder(r)) {
                const al = laneById.get(a.id);
                if (al !== undefined && laneOk(r, d, al)) { lane = al; break; }
            }
            if (lane === null) {
                // Dep-adjacent lane INSERTION (user directive, initiative #6 plan
                // image review): when every anchored lane is occupied or
                // corridor-blocked, a branch epic opens a FRESH lane
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
                const anchors = sameInitiativeDepsOf(r)
                    .map((a) => laneById.get(a.id))
                    .filter((v) => v !== undefined);
                if (anchors.length > 0) {
                    const al = Math.min(...anchors);
                    // ── RE-USE BEFORE YOU INSERT (req #3498) ────────────────
                    // THIS IS THE VERTICAL COMPRESSION THE REQUIREMENT ASKED
                    // FOR, and until now a branch never got it. An epic that
                    // could not inherit one of its dependencies' lanes went
                    // straight to the insertion below and opened a BRAND NEW
                    // lane — every time, whether or not a lane this band had
                    // already opened was standing empty at that column.
                    //
                    // MEASURED on live plan 7's "First Principles Pipeline":
                    // **17 lanes for work that never puts more than 5 epics in
                    // one column**, six of those lanes holding a single card
                    // and still taking their full height across all 40 columns.
                    // The band was 2,827px tall.
                    //
                    // The requirement's own words are *"over time there is an
                    // ability to re-use swim lanes making the parallel threads
                    // of initiatives to have better vertical compression"* — a lane
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
            // epic, so no LATER chain inherits a lane through it. take() never
            // overwrites, so an in-chain bead already in the corridor keeps its
            // identity for later corridorOk checks.
            for (const a of sameInitiativeDepsOf(r)) {
                if (laneById.get(a.id) === lane) {
                    for (let dd = colOf.get(a.id) + 1; dd < d; dd++) {
                        take(dd, lane, reservedFor(a.id));
                    }
                }
            }
        }
        // Ordinal renumber: fractional inserted lanes become whole rows here.
        // Everything downstream — bandUsed (arc-corridor checks), laneReqs,
        // laneY, node positions — speaks the renumbered values, so the
        // fractions never escape this loop.
        const laneVals = [...new Set(epics.map((r) => laneById.get(r.id)))].sort((p, q) => p - q);
        const laneRemap = new Map(laneVals.map((v, i) => [v, i]));
        for (const r of epics) laneById.set(r.id, laneRemap.get(laneById.get(r.id)));
        for (const [dd, cells] of used) {
            const remapped = new Map();
            for (const [lv, occ] of cells) {
                remapped.set(laneRemap.has(lv) ? laneRemap.get(lv) : lv, occ);
            }
            used.set(dd, remapped);
        }
        const sub = Math.max(1, ...epics.map((r) => laneById.get(r.id) + 1));

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
        // each other — an epic label floating above the bead, the bead, the
        // requirement stack below it, a reserved title slot below that, plus a
        // stagger line — and the pitch had to reserve the deepest of each. All
        // of those are now ONE box whose height `cardHeight` already knows, so
        // the pitch is that box plus the gap, and nothing else.
        //
        // PER-LANE, exactly as req #3119 made it: a lane is as tall as ITS OWN
        // tallest card, never as tall as the band's. That is what stops one
        // five-requirement epic setting the pitch for eight single-requirement
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
        for (const r of epics) {
            const lane = laneById.get(r.id);
            const h = cardHeight(reqBlockOf(r), epicLabel, nameLineCount(r), stampHOf(r));
            if (h > (laneCardH.get(lane) || 0)) laneCardH.set(lane, h);
        }
        // THE RESPECTFUL GAP (user directive: *"there has to be a respectful gap
        // / white space but otherwise we want the compression"*). It is charged
        // once per lane, below the card, so two vertically adjacent cards are
        // always `CARD_GAP_Y` apart whatever their heights.
        const lanePitch = (lane) =>
            (laneCardH.get(lane) || cardHeight(0, epicLabel, 1)) + CARD_GAP_Y;
        // Cumulative lane tops, so a lane's y is the SUM of the lanes above it
        // rather than index × a single pitch. `laneY` is exported on the band:
        // every consumer that draws per-lane furniture (the visualizer's lane
        // wires) must use it or the wires detach from the cards.
        // A FOLDED band (req #3650) draws NO lanes, so its height is its
        // header alone. The lanes above are still assigned — the placement is
        // band-local, so assigning it changes nothing outside this band — and
        // the COLUMNS were computed over every row, so folding an initiative never
        // moves another initiative's cards sideways.
        //
        // req #3695 — the fold ANIMATES: a band part-way open lays its lanes
        // out COMPRESSED by its reveal, so the band's height (header + the
        // sentinel below) grows or shrinks smoothly and every band beneath it
        // slides with it. Cards keep their own size, so mid-fold they overlap
        // inside the compressed lanes — the renderer fades them with the same
        // reveal, so what reads is the box opening. `* 1` is exact in floating
        // point, so an open band's lanes are bit-for-bit what they were.
        const rv = band.reveal;
        const drawnSub = rv > 0 ? sub : 0;
        const laneY = [];
        {
            let acc = 0;
            for (let l = 0; l < drawnSub; l++) { laneY.push(acc * rv); acc += lanePitch(l); }
            laneY.push(acc * rv); // sentinel: total lane height
        }
        // Retained for consumers that want a representative pitch; band height
        // comes from laneY, never from sub × pitch.
        const pitch = lanePitch(0);
        // EVERY BAND TAKES THE SAME HEADER, AND NOTHING REACHES INTO IT ANY MORE
        // (req #3498). The header used to absorb the stagger in title mode, and
        // `initiativeLaneH` had to subtract `EPIC_LABEL_RISE` on top of that, because a
        // lane-0 epic label floated ABOVE its bead and reached back up into the
        // header — the "off-by-a-reservation" this constant's own history is made
        // of. A card starts AT its lane's top and nothing is drawn above it, so
        // the header's clear strip is now the header itself.
        //
        // req #3805 — …EXCEPT A FOLDED ONE, whose header is only as tall as its
        // title bar and a tight gap (`BAND_HEADER_FOLDED`). Blended by the
        // band's reveal so the fold animation stays continuous; an open band
        // (`rv` = 1) is exactly `BAND_HEADER`.
        const headerH = rv >= 1 ? BAND_HEADER
            : BAND_HEADER_FOLDED + rv * (BAND_HEADER - BAND_HEADER_FOLDED);
        // The INITIATIVE'S OWN LANE: the part of the header no epic content can reach.
        // That is the whole header now — kept as a named field because the
        // visualizer's floating initiative chip clamps to THIS rather than re-deriving
        // it, and the two must not drift apart again.
        const initiativeLaneH = headerH;
        bands.push({ ...band, epics, sub: drawnSub, pitch, laneY, laneCardH,
            headerH, initiativeLaneH });
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
    const totalH = y + 8 + (bands.length ? INITIATIVE_ADD_RESERVE : 0);

    // ── Node positions: A NODE IS A BOX (req #3498) ─────────────────────────
    // `x`/`y` remain the node's CENTRE, and that is deliberate rather than
    // incidental: the user asked for the epics to be *"linked from their
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
    // the midpoints are what the arcs connect. A one-requirement epic feeding a
    // three-requirement epic in the SAME lane would stop being a straight line
    // and become a cubic, so a chain running along its own lane — *"the primary
    // threads of execution stay in the swim lane"* — would zigzag between every
    // pair of cards for no reason a reader could see.
    //
    // Centred, every card in a lane shares one midpoint y: same-lane links are
    // straight, the lane wire runs exactly through every card it passes, and a
    // curve means what it should mean — a BRANCH into another lane.
    const nodes = new Map();
    bands.forEach((band, bandIndex) => {
        // A folded band (req #3650) places no cards: its epics have no node,
        // so every consumer that walks `nodes` — the arcs below, the labels,
        // the renderer, the focus fits — passes over them as it does any epic
        // with no node, and an arc into or out of the band is not drawn.
        if (!(band.reveal > 0)) return;
        // req #3695 — a band part-way through its fold animation stamps its
        // reveal on each node, so the renderer can fade the card with it.
        const nodeReveal = band.reveal < 1 ? { reveal: band.reveal } : null;
        for (const r of band.epics) {
            const d = colOf.get(r.id);
            const lane = laneById.get(r.id);
            const h = cardHeight(reqBlockOf(r), epicLabel, nameLineCount(r), stampHOf(r));
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
                // The card's TITLE AREA height. Published because the epic name
                // may wrap (req #3498), so it varies per card and the renderer
                // must not re-derive it — the rule under the title and the
                // card's activate region are both placed from this number, and
                // a second derivation is how a divider and the text it divides
                // start disagreeing.
                titleH: cardTitleH(epicLabel, nameLineCount(r)),
                // ── THE FRAME'S OWN BOX (req #3498) ─────────────────────────
                // The rounded rect does NOT start at `left`: the state bar owns
                // the strip before it. Published so every consumer reads one
                // answer — the halo, the hover region and the activate region
                // each re-derived it from `left`/`w` and each was silently a
                // bar's width too wide once the bar moved outside the frame.
                frameLeft: colX[d] - cardW / 2 + CARD_FRAME_X,
                frameW: cardFrameW,
                // req #3676 — the COMPLETE LINE between the epic's open and
                // complete requirements, `{ y, idY }`, or null when the card
                // draws no split. Filled in by the label pass below, which is
                // where the row positions it sits between are walked.
                doneRule: null,
                depth: d,
                lane,
                bandIndex,
                ...nodeReveal,
            });
        }
    });

    // ── Dependency arcs: straight same-lane, cubic cross-lane ───────────────
    // Cross-lane routing is ADAPTIVE (user directive, initiative #6 plan — "less
    // crossover"). The POC bent EARLY: the arc joined the DESTINATION lane's y
    // right after the source column and ran horizontally through every
    // intermediate column at that height — straight through any bead parked on
    // the destination lane (the convergence into a penultimate epic overdrew
    // the whole main chain). Now an arc runs the horizontal on its SOURCE lane
    // and dives just before the destination column (LATE bend) whenever that
    // corridor is clear of unrelated beads and of reservations held for
    // another epic's arc (its own source's are a trunk it forks off, req
    // #3669); if only the
    // destination-lane corridor is clear it bends early as before; if neither
    // is clear, early is the fallback. Corridor-aware PLACEMENT (laneOk above)
    // keeps source corridors clear in the common case, so late is the norm.
    const corridorClear = (bandIndex, lane, dFrom, dTo, aId, rId) => {
        const used = bandUsed[bandIndex];
        if (!used) return true;
        for (let dd = dFrom + 1; dd < dTo; dd++) {
            const o = used.has(dd) ? used.get(dd).get(lane) : undefined;
            if (o === undefined) continue;
            if (isReserved(o)) {
                if (reservedBy(o) === aId) continue;
                return false;
            }
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
            // req #3695 — an arc touching a card mid-fold fades with it.
            const arcReveal = (a.reveal ?? 1) < 1 || (b.reveal ?? 1) < 1
                ? { reveal: Math.min(a.reveal ?? 1, b.reveal ?? 1) } : null;
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
                    ...arcReveal,
                });
                continue;
            }
            // req #3372 gate-delta F1 (2026-08-08) — a cross-initiative dependency
            // edge is LEGAL, not a defect to report. `sameBand` stays a pure
            // boolean routing input: a cross-band arc simply takes the
            // 'early' shape below, same as any other cross-band arc always
            // has. No assertion, no violation, no side-channel field — see
            // "cross-initiative dependency edges stay legal" in
            // `pipelinePlanLayout.test.js` for the positive fixture.
            const sameBand = a.bandIndex === b.bandIndex;
            const late = sameBand
                && corridorClear(a.bandIndex, a.lane, a.depth, b.depth, dId, r.id);
            // The arc carried a `bbox` (the convex hull of its own Bézier
            // control points) from req #3210 until req #3257: its ONLY consumer
            // was the sticky initiative chips' obstacle-avoidance pass, and that pass
            // is gone along with it — an initiative name is pinned to its band's
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
                ...arcReveal,
            });
        }
    }

    // ── Label rectangles — every piece of text the canvas draws, as world
    // boxes, so the zero-overlap invariant is a testable property of THIS
    // module's output rather than a hope about the renderer.
    const labels = [];
    for (const r of safeRows) {
        const n = nodes.get(r.id);
        if (!n) continue;                  // in a folded band (req #3650)
        // The title area (req #3648, #3683, #3742): the collapse head, the
        // count badge and the name on the left, the control column on the
        // right, all placed from its top.
        const nameTop = n.top + CARD_PAD_Y;
        // The control row (see `CARD_CLUSTER_W`): flush against the text
        // column's right edge, on the title line (req #3904).
        const clusterRight = n.right - CARD_PAD_X - CARD_CHECK_W;
        // The first line under the control row — where the name starts when
        // it has no room beside the controls (`nameBelow`).
        const belowClusterTop = nameTop + CARD_CLUSTER_H;
        // ── THE COLLAPSE HEAD (req #3650) — the title line's first control
        //    since req #3648, a chevron the size of the "+" beside the name.
        labels.push({
            kind: 'collapse', epicId: r.id, text: CARD_HEAD_LABEL,
            collapsed: epicFolded(r),
            prose: false,
            x: n.left + CARD_FRAME_X + CARD_PAD_X,
            y: nameTop,
            w: CARD_COLLAPSE_W, h: CARD_TITLE_BTN,
        });
        // ── THE EPIC NAME, IN THE CARD'S TITLE AREA (req #3498) ─────────────
        // It floated 34px ABOVE the bead until now, fitted to a stagger budget
        // assembled from the neighbouring columns. It sits inside the card's own
        // title area instead, fitted to the card, LEFT-ALIGNED rather than
        // centred: a row of centred titles over left-aligned requirement rows
        // reads as two different lists, and the title is the thing a reader
        // scans down a lane. NOT on the requirement rows' own `textLeft`,
        // though — see `titleTextLeft` below for why the name alone is
        // indented past the chevron.
        // The chevron's and the badge's room comes off the left and the
        // column's off the right (`CARD_NAME_RESERVE`, req #3683, #3742) — all
        // drawn beside the name, so a budget that ignored any of them would put
        // the epic name under it.
        const nameLines = nameLinesOf.get(r.id) || [''];
        const label = nameLines.join(' ');
        const lw = Math.max(...nameLines.map((l) => l.length)) * CHW_LABEL;
        const textLeft = n.left + CARD_FRAME_X + CARD_PAD_X;
        // ONLY the name moves for the chevron — the requirement rows below
        // it, and the reserved L3 title-duplicate line, still start at the
        // column's own `textLeft`: the chevron stands on the name's first line
        // alone, and shifting rows that never draw beside it would cost every
        // card width for no reason on any of them.
        // After the chevron and the count badge (req #3742 put the badge back
        // between them) — or, when the controls leave it no room, under the
        // column from the text column's left (`nameBelow`).
        const titleTextLeft = nameBelow ? textLeft
            : textLeft + CARD_NAME_LEFT_RESERVE;
        // Below the cluster = the line under the control row.
        const nameY = nameBelow ? belowClusterTop : nameTop;
        labels.push({
            kind: 'epic', epicId: r.id, text: label,
            // The lines AS DRAWN, so the renderer never re-wraps — the same
            // contract the requirement rows carry.
            lines: nameLines,
            // In `title` mode this label IS the epic's stored name.
            prose: epicLabel === 'title',
            x: titleTextLeft,
            y: nameY,
            w: lw, h: nameLines.length * CARD_LINE_H,
            // req #3580 — the WHOLE room the name may occupy (up to the
            // cluster's gap, req #3683), which is where the in-place editor is
            // drawn. Not `w`: that is the drawn text's own width, and an editor
            // sized to a short name would have no room to type a longer one.
            editW: clusterRight - titleTextLeft
                - (nameBelow ? 0 : CARD_CLUSTER_W + CARD_NAME_CLUSTER_GAP),
        });
        const ids = r.reqIds || [];
        // ── THE REQUIREMENT ROWS, TOP TO BOTTOM, IN ORDER ───────────────────
        // *"the requirements listed top to bottom inside the card in the order"*.
        // `reqIds` order is the order — this module does not re-sort it (that is
        // `sortReqIdsByOrchestration`'s job, run by the caller, req #3676).
        //
        // There is ONE room now, and it is the card's text column. The old code
        // had to compute a per-mark budget out of the column width, the stagger
        // reach, the mark count and — in `horizontal` — the mono spaces gluing
        // the marks together, which is the arithmetic that once put a 3-req
        // epic's row 14.4px outside its own column slab. A row is one line in a
        // fixed-width box; there is nothing left to divide.
        const showTitles = reqLabel === 'title';
        const rowsTop = n.top + cardTitleH(epicLabel, nameLineCount(r))
            + CARD_RULE_BAND;
        // The wrapped lines this epic's rows occupy — derived once at the top of
        // this function, so the box that was measured and the text drawn into it
        // are the same answer.
        // A folded epic's rows are not drawn (req #3650): it reserved no block.
        const rowLines = epicFolded(r) ? [] : (rowLinesOf.get(r.id) || []);
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
            // A prefix too long for the first line (`id  Terminal NN  PORT`
            // is 23 characters; the line is 24 at the narrowest rung and 32 at
            // the base card since req #3693) degrades to the bare id rather than drawing an
            // id string wider than the box the overlap sweep measured.
            const fullPrefix = reqPillPrefix(ids[i], reqPills);
            const prefix = fullPrefix.text.length <= lines[0].length
                ? fullPrefix : { text: String(ids[i]), pills: [] };
            const w = Math.max(...lines.map((l) => l.length)) * CHW_REQ;
            const titleHang = reqHangChars(reqRowMax, String(ids[i]).length + CARD_SEP_CHARS);
            // Joined WITHOUT the hanging indent's padding (req #3575) — the
            // indent is how the row is drawn, not part of what it says.
            const t = lines.map((l, k) => (k ? l.trimStart() : l)).join(' ');
            const thisY = rowY;
            const thisIdY = idRowY;
            // ── THE COMPLETE LINE (req #3676) ────────────────────────────
            // Above the first COMPLETE row, in the middle of the gap that
            // separates it from the last open one. Every row's glyphs are
            // centred in their own line slot, so the middle of the gap is
            // the middle of the visible air, at both packings (`idY` at L1/L2).
            // Only between two groups: with no open rows above it, the line would
            // sit a few pixels under the title rule and read as a double
            // border. An all-complete epic already says so with its ✓.
            if (i > 0 && i === r.reqDoneFrom) {
                n.doneRule = {
                    y: thisY - REQ_ROW_GAP / 2,
                    idY: thisIdY - REQ_ROW_GAP / 2,
                };
            }
            // The next row starts below THIS row's lines plus the between-rows
            // gap — the two quantities `reqBlockHeight` charges, walked in the
            // same order so the boxes and the block height cannot disagree.
            rowY += lines.length * REQ_LINE_H + REQ_ROW_GAP;
            idRowY += REQ_LINE_H + REQ_ROW_GAP;
            labels.push({
                kind: 'req', epicId: r.id, reqId: ids[i], text: t,
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
                // req #3587 — the id CARRIES its pill tokens at L1/L2 too, so a
                // live terminal or dev server is visible at every level the
                // card is drawn, not only once the reader has zoomed to L3.
                idText: prefix.text,
                idW: prefix.text.length * CHW_REQ,
                // The pills' character ranges on the FIRST line, which both
                // texts above begin with (guaranteed by the fallback above).
                pills: prefix.pills,
                // The RENDERER picks this instead of `y` at L1/L2 (`!showTitle`)
                // — see the block comment above `idRowY`.
                idY: thisIdY,
                // req #3661 — WHERE THE TITLE SITS, in characters, so the
                // in-place editor can occupy exactly the room the wrap gives it:
                // continuation lines start at `titleHang` (the hanging indent
                // `wrapReqText` honoured), the first line's title at
                // `titleStart` (after the id, any pills and the separator), and every
                // line of title holds `titleRoom` characters.
                titleHang,
                titleStart: prefix.text.length + CARD_SEP_CHARS,
                titleRoom: reqRowMax - titleHang,
            });
        });
        // ── THE TOTAL REQUIREMENT COUNT, AS A BADGE (req #3503; originally
        // req #3498, "Provide a count") ──────────────────────────────────
        // Between the collapse chevron and the name since req #3742, in the
        // room `CARD_BADGE_W` + `CARD_BADGE_GAP` reserved out of the name's
        // budget — see `CARD_BADGE_W`'s own comment for why the pill replaced
        // the dim "(N)" text this used to draw. Emitted for EVERY card
        // including the empty one — 0 is a fact about the epic, and a count
        // that disappears is a count a reader cannot rely on.
        {
            const countText = String(ids.length);
            // The DRAWN width, not the reserve: `badgeWidthFor` (per-row,
            // real digit count) is almost always narrower than `CARD_BADGE_W`
            // (worst case), and RIGHT-aligning it against the reserve's own
            // right edge — against the gap before the name — is what makes a
            // one-digit badge a circle rather than the reserve's full width
            // stretched into a capsule.
            const badgeW = badgeWidthFor(countText.length);
            const badgeLeft = textLeft + CARD_COLLAPSE_W + CARD_COLLAPSE_GAP;
            labels.push({
                kind: 'badge', epicId: r.id, text: countText,
                // Generated from a row count, never stored user content — so
                // the no-'#' audit governs it (the `prose` note on req marks).
                prose: false,
                x: badgeLeft + CARD_BADGE_W - badgeW,
                // On the FIRST name line, whatever the name wrapped to — the
                // count belongs to the card, not to the last line of its title.
                y: nameTop + CARD_BADGE_TOP,
                w: badgeW, h: CARD_BADGE_H,
            });
        }
        // The "view in table" ↗ (req #3503) and the "+" that filed a
        // requirement into the epic (req #3582) were REMOVED by req #3649 (user
        // directive: "I never use the plus … I never use the arrow"); the title
        // line now carries the run pill and the barrier only (req #3742
        // removed the padlock).
        // ── THE RUN-MODE PILL (req #3580) ────────────────────────────────────
        // The control row's FIRST item (req #3904): left of the barrier, a
        // button gap between them, the pair flush right. Emitted for every card: run mode is a fact about every
        // epic, and the pill is also the control that changes it. The text is
        // the word drawn inside; the renderer draws it as an HTML overlay, the
        // badge's own move, because it is a button.
        {
            labels.push({
                kind: 'run', epicId: r.id,
                text: CARD_RUN_WORDS[r.run === 'manual' ? 'manual' : 'auto'],
                run: r.run === 'manual' ? 'manual' : 'auto',
                prose: false,
                x: clusterRight - CARD_TITLE_BTN - CARD_TITLE_BTN_GAP - CARD_RUN_W,
                y: nameTop + CARD_RUN_TOP,
                w: CARD_RUN_W, h: CARD_RUN_H,
            });
        }
        // ── THE BARRIER GATE (req #3649, #3673) ─────────────────────────────
        // The control row's LAST item (req #3904): rightmost on the title line,
        // flush right so the row's edge lines up down a lane. Emitted for every card: it is
        // a fact about every epic, and the control that changes it (the
        // renderer draws it as an HTML icon button, `on` deciding the picture —
        // req #3673). The padlock that stood beside it went in req #3742; a
        // locked epic is drawn with a red perimeter instead.
        labels.push({
            kind: 'barrier', epicId: r.id, text: 'Barrier', prose: false,
            on: r.checkpoint !== false,
            x: clusterRight - CARD_TITLE_BTN, y: nameTop,
            w: CARD_TITLE_BTN, h: CARD_TITLE_BTN,
        });
        // ── THE EPIC'S OWN TITLE, ON THE L3 LINE ────────────────────────────
        // Skipped when the epic label already IS the title — it would duplicate,
        // which is why `cardTitleH` does not reserve the line in that mode
        // either. The two agree by reading the same condition.
        // It always lands below the one-row control row (req #3904; it sat
        // beside the column's second row before), so it has the text column's
        // full width.
        if (epicLabel !== 'title') {
            const t = truncate(r.title || '', cardChars(CHW_TITLE, 0, cardTextW));
            if (t) {
                labels.push({
                    kind: 'title', epicId: r.id, text: t,
                    // Stored plan content — see the `prose` note on req marks.
                    prose: true,
                    x: textLeft,
                    y: nameY + nameLines.length * CARD_LINE_H,
                    w: t.length * CHW_TITLE, h: 11,
                });
            }
        }
        // ── THE START AND END TIMES (req #3825) ─────────────────────────────
        // On the line `stampHOf` reserved at the card's bottom: START flush
        // left on the text column, END flush right against the card's padding.
        // A time not known yet (no start recorded, or open work left) draws
        // nothing on its side; the line stays reserved either way.
        if (r.stampsReserved) {
            const stampY = n.bottom - CARD_PAD_Y - CARD_STAMP_TEXT_H;
            const startText = formatClock(r.startedAt);
            // `+Nd` when the epic ran past midnight (`formatEndClock`).
            const endText = formatEndClock(r.startedAt, r.endedAt);
            if (startText) {
                labels.push({
                    kind: 'stamp', epicId: r.id, side: 'start', text: startText,
                    at: r.startedAt, prose: false,
                    x: textLeft, y: stampY,
                    w: startText.length * CHW_TITLE, h: CARD_STAMP_TEXT_H,
                });
            }
            if (endText) {
                const w = endText.length * CHW_TITLE;
                labels.push({
                    kind: 'stamp', epicId: r.id, side: 'end', text: endText,
                    at: r.endedAt, prose: false,
                    x: n.right - CARD_PAD_X - w, y: stampY,
                    w, h: CARD_STAMP_TEXT_H,
                });
            }
        }
    }
    // ── Ruler ticks join `labels` (req #3207 constraint) ────────────────────
    // Deliberately NOT a second, separately-checked class of text. The
    // zero-overlap contract is asserted over `layout.labels` in all four
    // reqLayout × epicLabel combinations, and a date strip that carried its own
    // rects would be text on this surface that no invariant covers — which is
    // how an initiative-label collision got shipped once already (against the
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
        // req #3225 — `initiativeLabel` already carries the count suffix when the
        // toggle is on (identical to `band.initiative` when it is off), so this
        // rectangle — the one the zero-overlap contract asserts over — grows
        // to cover it rather than a second, unchecked box drawn beside it.
        const bandText = band.initiativeLabel || band.initiative;
        labels.push({
            kind: 'initiative', initiativeId: band.initiativeId, text: bandText,
            x: 12, y: band.y + 6,
            // req #3226 — the SAME reservation `placeInitiativeChips` measures the
            // floating chip against, grown onto the rect the zero-overlap
            // invariant actually sweeps (req #3225 set this precedent: the
            // count suffix grew both together, never just the chip).
            w: bandText.length * CHW_INITIATIVE + INITIATIVE_PAUSE_BUBBLE_W + INITIATIVE_CHIP_COLLAPSE_W
                + (band.initiativeId != null ? INITIATIVE_LOCK_W : 0), h: 16,
        });
    }
    // req #3695 — every piece of a card mid-fold carries its card's reveal, so
    // the renderer fades the text, the badge and the controls with the frame.
    // Only an animating layout has any to stamp.
    if (foldReveal) {
        for (const l of labels) {
            const rv = l.epicId != null ? nodes.get(l.epicId)?.reveal : undefined;
            if (rv != null) l.reveal = rv;
        }
    }
    return {
        width: totalW,
        height: totalH,
        bands: bands.map(({ epics, ...b }) => ({ ...b, epicIds: epics.map((s) => s.id) })),
        nodes,
        arcs,
        labels,
        colW,
        // The column pitch as ONE NUMBER (req #3503 review) — `colW` above is
        // per-column (an array, uniform today but shaped for a future that
        // is not), so a caller that wants "the" pitch — `epicsAcrossScale`'s
        // `colW` parameter, at every call site that holds a live layout —
        // needs the scalar `COL_W` this was built from, not `colW[0]` typed
        // as a number by accident. `Number.isFinite` on the array silently
        // fails this check without ever calling it wrong (JS coerces an
        // array to NaN on arithmetic, never throws), which is exactly the
        // failure this field exists to make impossible to reach for again.
        colPitch: COL_W,
        // The card's drawn FRAME width (world px) at this plan's Epic Width
        // rung — every node's `frameW`, as one number. req #3620: the
        // Orchestrables box mirrors it, so it needs it without a node.
        cardFrameW,
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
        epicLabel,
        empty: false,
    };
}

// ── Floating initiative chips (req #3119, de-collided #3168, RE-RULED req #3257) ─
// The initiative name rides its band's own rectangle and clamps to the visible
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
//     crosses a bead, an arc or an epic label it draws OVER it, deliberately.
//   · #3210's NEIGHBOUR-ONLY STICKY PASS is GONE, subsumed: clause 2 now applies
//     to EVERY band, so a focused band's neighbours keep their names by the same
//     rule as everything else instead of by a special case. Its guarantee is
//     re-asserted in vitest against the new rule rather than assumed.
//   · CHIP-ON-CHIP OVERLAP was, under #3257 alone, IMPOSSIBLE BY CONSTRUCTION —
//     bands never overlap in world Y, the chip was sized to its band's own initiative
//     lane (`h + 2·CHIP_MARGIN_Y ≤ initiativeLaneH·k ≤ band.height·k`) and clamped
//     inside its band's rectangle, so two chips would have had to share a
//     rectangle to touch. **REQ #3272 ENDS THAT PREMISE** by flooring `h`, and
//     the guarantee is restored by an explicit VERTICAL de-collision pass — see
//     the block below and `placeInitiativeChips`' own stack pass. The sweep asserted
//     it before and asserts it now; what changed is whether the geometry alone
//     is the proof.
//
// ── THE LEGIBILITY FLOOR IS ON THE FONT, NOT ON THE BOX (req #3272) ─────────
//
// The two sentences immediately below this one used to read "below
// `INITIATIVE_CHIP_MIN_H` the chip is DROPPED rather than drawn over the first row of
// epics", and that is exactly what a zoomed-out reader saw: a screenshot of
// production on 2026-08-02 showing the whole plan with NO INITIATIVE NAMES AT ALL,
// and — one zoom step in — names at `15 × 11/24 ≈ 6.9px`. Both were deliberate
// choices, correctly implemented. **THE USER OVERRULED THE CHOICE**: the name
// must not shrink to nothing, it must hold a minimum legible size, and small is
// fine.
//
// So the floor moved to the thing it was always about. `INITIATIVE_CHIP_MIN_FONT` is
// the input and the BOX is derived from it (`INITIATIVE_CHIP_MIN_H` is now a
// consequence, 17.6px, not a constant anybody picks). TWO documented decisions
// are REVERSED here, and both are reversals rather than fixes:
//
//   1. THE DROP IS GONE. A lane too short for the floored chip no longer
//      refuses the name — the chip is drawn over the first row of epic labels.
//      That collision is the one the initiative lane exists to prevent, and paying it
//      is acceptable for two reasons already in this code: the chip draws on a
//      60%-OPAQUE PANEL, and #3257 already ruled that where it crosses a bead,
//      an arc or an epic label IT DRAWS OVER IT. A name present and slightly
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
// the panel edge, and the `INITIATIVE_CHIP_MIN_CHARS` floor — that one is stated in
// CHARACTERS OF THE NAME and is a different rule from this one.
//
// WHAT SURVIVES:
//
//   · THE PER-BAND SCALE SHRINK, now BOUNDED. The chip is a fixed SCREEN height
//     and the initiative lane reserving room for it is WORLD px, so below some k the
//     lane is genuinely shorter on screen than the chip. Shrinking still keeps
//     the name out of lane 0's epic labels for as long as it can — it simply
//     stops at `INITIATIVE_CHIP_MIN_FONT` instead of running to 6.9px and then to
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
// this module already measures as `CHW_INITIATIVE`. Every estimate was ~22% short (the
// fixture's four initiative names came out 33–67px narrow), which is not a cosmetic
// error once a DISPLACEMENT PASS is reading it: an under-measured chip is
// declared clear of an obstacle it in fact overlaps, and the vitest sweep that
// proves the pass works reads the same wrong number, so it cannot notice.
// One constant, one source, and the tests inherit it by default.
export const INITIATIVE_CHIP_H = 24;      // the HTML chip's own height, in SCREEN px
export const INITIATIVE_CHIP_CHAR_W = CHW_INITIATIVE;
export const INITIATIVE_CHIP_PAD_W = 18;  // px + border, both sides
export const INITIATIVE_CHIP_FONT = PLAN_VIZ_FONT.initiative;
// The initiative band's own "open" ↗ control footprint (req #3204) — a
// FLAT, unscaled screen-px reservation, not part of `INITIATIVE_CHIP_PAD_W`
// (review finding, req #3210): the control is a fixed `fontSize: 12` glyph
// plus its own padding and the chip's `gap`, none of which shrinks when the
// chip does, unlike the name text `INITIATIVE_CHIP_PAD_W` already accounts for. A
// natural chip did not use to have this reserved — under #3168 it was checked
// only against the legend and other chips, both comfortably clear at the sizes
// this surface reaches in practice.
//
// req #3257 RESERVES IT ON EVERY CHIP. The measured box is now the thing that
// keeps the name INSIDE ITS OWN RECTANGLE (and clear of the key), not merely
// clear of some other floating chip — so 24 unmeasured px is 24 px of name that
// can hang past the band's right edge or under the key, which is the exact
// under-measurement bug this module's own header comment warns about.
// ── BOTH CHIP LINKS GREW (req #3498, user directive: the epics link is "way
//    too small") ─────────────────────────────────────────────────────────────
// 24px reserved a 12px glyph at 70% opacity — a target under the 24x24 minimum
// every accessibility guideline names, on the one control that leaves this page.
// The glyph is the chip's own font size now (15) and the reservation grew with
// it. BOTH links move together: they are siblings on one chip, and one of them
// growing alone would read as an error rather than as emphasis.
export const INITIATIVE_CHIP_OPEN_LINK_W = 30;
// The "open this initiative's requirements as task cards" control (req #3428) — a
// SECOND link control riding beside the ↗, and the SAME kind of flat, unscaled
// screen-px reservation for the identical reason: a fixed `fontSize: 14` MUI
// glyph plus the chip's own flex `gap`, neither of which shrinks when the chip
// does. It renders under exactly the same condition as the ↗ (`initiativeId != null`)
// and is measured under the same condition, so the two can never drift apart.
//
// UNMEASURED CONTENT IS CONTENT THAT HANGS PAST THE EDGE IT WAS CLAMPED TO —
// this file's own header warning, and since req #3257 the measured box is what
// keeps the name inside its own rectangle and clear of the key, not merely clear
// of another floating chip. 24 px of unreserved glyph is 24 px of name over the
// band's right edge.
export const INITIATIVE_CHIP_CARDS_LINK_W = 30;
// The pause status bubble (req #3226) — a small filled circle immediately left
// of the initiative name, the SAME kind of flat, unscaled reservation as the ↗
// control above and for the identical reason: it is a fixed-diameter dot plus
// the chip's own flex `gap`, neither of which shrinks with the chip.
//
// The requirement calls this out by
// name ("a bubble is width the label did not have before") because, unlike
// the ↗ link, the bubble renders on EVERY band unconditionally (the ↗ link is
// absent for the "No initiative" band; the bubble is not carved out for it because
// pause is meaningful there too — the whole-plan pause suppresses it same as
// any other band).
export const INITIATIVE_PAUSE_BUBBLE_D = 8;    // the dot's own diameter, screen px
const INITIATIVE_PAUSE_BUBBLE_GAP = 4;         // matches the chip's flex `gap`
export const INITIATIVE_PAUSE_BUBBLE_W = INITIATIVE_PAUSE_BUBBLE_D + INITIATIVE_PAUSE_BUBBLE_GAP;
// req #3649 — the chip's padlock, a FLAT control like the bubble: its glyph
// box plus the chip's flex gap, reserved on every band the same way.
export const INITIATIVE_LOCK_D = 12;
export const INITIATIVE_LOCK_W = INITIATIVE_LOCK_D + INITIATIVE_PAUSE_BUBBLE_GAP;
// req #3650 — the chip's COLLAPSE HEAD, which leads it: the TPU 3D head
// (`.tpu3d-head`) at its own 10px. FLAT, like the pause bubble — the TPU head
// never scales — and drawn at exactly `INITIATIVE_CHIP_COLLAPSE_HEAD_W`, so this
// reservation is the box on screen; the rest is the chip's flex `gap`. The
// chevron ALONE since req #3648 (user directive: "the color dot and initiative name,
// remove the epics") — it was chevron + "EPICS", 50px.
export const INITIATIVE_CHIP_COLLAPSE_HEAD_W = 14;
export const INITIATIVE_CHIP_COLLAPSE_W = INITIATIVE_CHIP_COLLAPSE_HEAD_W + INITIATIVE_PAUSE_BUBBLE_GAP;
// ── THE FLOOR (req #3272) ──────────────────────────────────────────────────
// The smallest size the initiative NAME may ever render at. This is the whole of the
// requirement: a floor on the FONT, with the box derived from it, replacing a
// floor on the BOX whose font came out at 6.9px and whose failure mode below
// that was to drop the name entirely.
//
// 11px, and it carries no new magic: it is the number `READABLE_MIN_PX` already
// uses for the plan's smallest REQUIRED text (the requirement ids, which
// `K_READABLE` is derived from), it is the floor MUI itself uses for
// `caption`-class type, and it is the number this file already had in hand —
// the old `INITIATIVE_CHIP_MIN_H`. 11px bold mono is small and legible, which is
// exactly what the user asked for ("it may be small").
export const INITIATIVE_CHIP_MIN_FONT = 11;
// The scale the floor corresponds to. The chip's font is `INITIATIVE_CHIP_FONT ×
// h / labelH`, so a font floor IS a scale floor and the box follows from it.
const INITIATIVE_CHIP_MIN_SCALE = INITIATIVE_CHIP_MIN_FONT / INITIATIVE_CHIP_FONT;   // 11/15
// The shortest box a chip is ever drawn in — 17.6px. **A CONSEQUENCE, NOT AN
// INPUT** (req #3272 reversed which of the two is which). Exported because the
// tests and any future caller need the derived number, never so that somebody
// can pick it: editing it here would silently desync the box from the font it
// is supposed to hold, which is the defect this requirement exists to fix.
// Callers passing a non-default `labelH` get `labelH × INITIATIVE_CHIP_MIN_SCALE`;
// this constant is that value for the default chip.
export const INITIATIVE_CHIP_MIN_H = INITIATIVE_CHIP_H * INITIATIVE_CHIP_MIN_SCALE;
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
// removed the drop below `INITIATIVE_CHIP_MIN_H` — a floor on the chip's HEIGHT,
// which controls how big the name is drawn. This one is a floor on how much of
// the name SURVIVES A CLIP, which is a different question with a different
// answer: a name that is present but too small to read is now refused (the
// font floor), and a box that is present but contains none of the name is
// still refused (this). The requirement says so in as many words.
//
// The floor is applied SCALED, in the same units as the chip's own measured
// width (`INITIATIVE_CHIP_PAD_W * scale + … + n * charW * scale`) — comparing a
// scaled box against an unscaled floor is the units error this module's header
// warns about, just with the operands swapped.
export const INITIATIVE_CHIP_MIN_CHARS = 3;
// Background opacity of the chip (user directive 2026-08-01: 40% transparent,
// i.e. 60% opaque). It was fully opaque, which read as a solid tile punched into
// the plan; at 0.6 the band beneath shows through as tint while the name still
// wins over whatever it crosses.
export const INITIATIVE_CHIP_BG_ALPHA = 0.6;
// ── A FOLDED INITIATIVE IS A FLOATING TITLE BAR (req #3695) ───────────────────────
// User direction: "Let a collapsed initiative not have a display rectangle. it can
// occupy a respectable amount of width as it is an initiative … when collapsed it's
// just a floating title bar so it gives way to the other highlighted initiatives."
// The band draws no rectangle once folded (the renderer's call), so the chip is
// all of the initiative that remains, drawn as a title bar: tinted in the
// initiative's colour and lifted by a shadow, in proportion to how folded it is
// (`bar`, the renderer's).
//
// A FOLDED CHIP KEEPS ITS OPEN WIDTH (req #3862). It used to widen to a flat
// 420px bar, so folding an initiative ELONGATED the very element the reader had
// just asked to shrink. User direction: "the closed epic elongates when it
// should stay the same or become smaller if we're hiding buttons. give it
// respectful white space but apprpriately shrink." Folding hides none of the
// chip's controls, so it stays exactly the size it was — its padding is the
// white space — and the fold changes only its styling.

/**
 * Where every initiative band's name is drawn, in SCREEN px.
 *
 * ONE RULE — see this section's header comment: the top-left corner of the
 * INTERSECTION of the band's rectangle with the visible content area, plus the
 * margin the name would carry from the band's own corner, clamped so the name
 * never escapes its rectangle on the far edge of either axis. A FOLDED band
 * (req #3738) is the exception: its title bar rides its band's own corner and
 * scrolls off under the pinned chrome rather than holding the top.
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
export function placeInitiativeChips({
    bands = [], transform, viewport, worldWidth,
    labelH = INITIATIVE_CHIP_H, charW = INITIATIVE_CHIP_CHAR_W, keepOut = null,
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

    // req #3805 — A RUN OF FOLDED INITIATIVES SHARES ITS ROOM. A folded band is only
    // `BAND_HEADER_FOLDED` tall, so at a plan's landing scale its floored name
    // no longer fits inside it, and the per-band push bound below would DROP
    // it — measured, plan 7 landed with one of its two folded initiatives nameless,
    // and a folded initiative draws no rectangle, so its name IS the initiative (and the
    // control that unfolds it). That bound exists so a pushed name never lands
    // on another initiative's cards; a folded band has none. So a FULLY folded band's
    // name may be pushed down through the folded bands after it, as far as the
    // bottom of the next OPEN band's header — its clear strip, which holds no
    // cards either — and with no open band after it, as far as the panel. One
    // bottom-up pass, in SCREEN px; an open or mid-fold band keeps its own bound.
    const foldedOf = (band) => 1 - (Number.isFinite(band.reveal) ? band.reveal
        : (band.collapsed ? 0 : 1));
    const runCap = new Map();
    {
        let cap = Infinity;
        for (let i = ordered.length - 1; i >= 0; i -= 1) {
            const b = ordered[i];
            if (foldedOf(b) >= 1) { runCap.set(b, cap); continue; }
            cap = t.y + (b.y + (b.initiativeLaneH ?? b.headerH ?? 0)) * t.k;
        }
    }

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

        // SIZE — from the band's own INITIATIVE LANE, unchanged from req #3168. The
        // lane is the reserved strip above lane 0 that no epic content can
        // reach; the fallback keeps this function usable with hand-built bands.
        // Note this is pan-INDEPENDENT (`laneBottom - top` is `initiativeLaneH · k`),
        // so the chip's size is a function of zoom alone — the clamp below moves
        // the name, it never resizes it.
        const laneBottom = t.y + (band.y + (band.initiativeLaneH ?? band.headerH)) * t.k;
        const laneH = Math.max(0, laneBottom - top);
        // THE FLOOR IS ON THE FONT, AND THE BOX IS DERIVED FROM IT (req #3272).
        // The chip shrinks INTO its lane exactly as it always did — and stops at
        // the size below which the name stops being a name. There is no `continue`
        // here any more: a lane too short for the floored chip gets the chip
        // anyway, drawn over the first row of epic labels on its 60%-opaque
        // panel. See this section's header for why that reversal is the
        // requirement rather than a regression.
        const h = Math.max(labelH * INITIATIVE_CHIP_MIN_SCALE,
            Math.min(labelH, laneH - 2 * CHIP_MARGIN_Y));
        // Font and character width track the box, so a scaled chip's WIDTH is
        // measured at the size it is actually drawn.
        const scale = h / labelH;
        // req #3225 — `initiativeLabel` carries the met/total suffix when the toggle
        // is on; band fixtures that predate the field fall back to the plain
        // name, so this stays the identity transform for callers that never set
        // it.
        const bandText = band.initiativeLabel || band.initiative;
        // The FLAT, unscaled reservations: the two link controls — the ↗ to the
        // initiative's epics and the cards control to the initiative's requirements (req
        // #3428) — which render only when there is an initiative to open, and the
        // pause bubble, which renders on every band, "No initiative" included. None of
        // them shrinks with the chip, and all are in the measured box before
        // anything is clamped or clipped against it.
        const wFull = bandText.length * charW * scale + INITIATIVE_CHIP_PAD_W * scale
            + (band.initiativeId != null ? INITIATIVE_CHIP_OPEN_LINK_W + INITIATIVE_CHIP_CARDS_LINK_W : 0)
            + INITIATIVE_PAUSE_BUBBLE_W + INITIATIVE_CHIP_COLLAPSE_W
            + (band.initiativeId != null ? INITIATIVE_LOCK_W : 0);

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
        // a 29-character initiative name on a 900px panel over a 900px-wide world is
        // drawn by the pre-#3272 code at k = 0.25 (its own reachable zoom floor)
        // and REFUSED by the floored one, i.e. the fix re-created the vanishing
        // name on the other axis. So the band's right edge now joins the panel
        // edge and the key as a thing that takes WIDTH off the chip, resolved by
        // the identical clip-or-drop below and by the identical
        // `INITIATIVE_CHIP_MIN_CHARS` floor. That is one rule for width where there
        // were two, and it is the rule #3257 already argued for: the reader
        // cannot tell one right-hand obstacle from another.
        const x = Math.min(ix0 + CHIP_MARGIN_X,
            Math.max(left + CHIP_MARGIN_X, right - CHIP_MARGIN_X - wFull));
        // …and the far-edge term is itself floored at the band's OWN top corner
        // (req #3272). `h` now has a floor, so it can exceed `band.height · k`,
        // and where it does the far-edge term resolves ABOVE the band's top —
        // parking the name over the band BEFORE it, where a reader reads it as
        // that band's name. Reading it as the wrong initiative is a worse failure than
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
        // req #3695 — how far FOLDED the band is drawn: 1 for a folded initiative, 0
        // for an open one, between while its fold animates. Hand-built bands
        // with no `reveal` answer from `collapsed`.
        const folded = foldedOf(band);
        // req #3738 — A FOLDED INITIATIVE DOES NOT HOLD THE TOP. Its title bar is all
        // that is left of it, so it scrolls with its band's own corner and goes
        // off under the ruler like any other row (the overlay's inset clips it),
        // instead of pinning at the content area's top while the open initiative below
        // scrolls up. User direction: "when that top one is collapsed, it doesn't
        // have to hook the top of the screen and hold. scroll it bye bye".
        // Blended by `folded` so the fold animation never jumps the name.
        const ySticky = Math.min(iy0 + CHIP_MARGIN_Y,
            Math.max(top + CHIP_MARGIN_Y, bottom - CHIP_MARGIN_Y - h));
        const yNatural = ySticky + folded * (top + CHIP_MARGIN_Y - ySticky);
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
        // Two initiative names must never overlap each other, and a floored chip can
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
        // unbounded push is misattribution with extra epics: each floored chip
        // consumes `h + CHIP_STACK_GAP` of vertical budget while a band supplies
        // only `band.height · k`, so on a plan of short bands the shortfall
        // ACCUMULATES with nothing to stop it — MEASURED at the reachable zoom
        // floor of a 900px panel, the worst name landed FIVE WHOLE BANDS below
        // the band it names, and the chip is a click target that zooms to its
        // initiative (req #3204), so it also becomes the wrong control sitting over
        // another initiative's beads. That is the same failure the `max` above exists
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
        // (pipeline 2 read 2026-08-02: 139 epics, seven bands of 616/197/4550/
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
            // req #3805 — a folded band's bound is its run's (see `runCap`):
            // the name's whole box stays above the next open band's cards.
            // A NaN cap (a hand-built band below with no `y`) falls back to
            // the band's own bound rather than disabling the check.
            const cap = runCap.get(band);
            const bound = cap !== undefined && !Number.isNaN(cap)
                ? Math.max(yNatural, cap - h)
                : Math.max(yNatural, bottom);
            if (y > bound + 0.01) continue;
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
        // the pause dot + `INITIATIVE_CHIP_MIN_CHARS` of the actual name.
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
            // The collapse head (req #3650) leads the chip, so a cut chip
            // that keeps any of its name keeps the head that folds it.
            const minW = INITIATIVE_CHIP_PAD_W * scale + INITIATIVE_PAUSE_BUBBLE_W
                + INITIATIVE_CHIP_COLLAPSE_W + (band.initiativeId != null ? INITIATIVE_LOCK_W : 0)
                + INITIATIVE_CHIP_MIN_CHARS * charW * scale;
            if (room < minW) continue;
            w = room;
            clipped = true;
        }
        // req #3695 — THE TITLE BAR's styling fraction (`folded`, computed
        // above). It never widens the chip (req #3862): `w` is the name's.
        const bar = !clipped && folded > 0 ? folded : 0;

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
            initiativeId: band.initiativeId,
            text: bandText,
            // req #3580 — `text` split into its two drawn pieces: the NAME (an
            // in-place editor) and the closure COUNT (a zoom control), each its
            // own element. `text` stays the measured whole.
            name: band.initiative,
            countText: band.initiativeCountText ?? null,
            color: band.color,
            // The band itself, so a click can fit it (req #3204). Carried rather
            // than re-looked-up by key: `band.key` is null for the "No initiative"
            // band and a find() on that would be a second place to get the null
            // handling right.
            band,
            x, y, w, h,
            // Whether `w` is a CUT rather than a measurement — the renderer must
            // cap and hide overflow only in that case. Capping unconditionally
            // would hand the drawn box over to an ESTIMATED width (`charW`), and
            // an estimate a hair short would truncate every name on the plan.
            clipped,
            // req #3695 — how much of a TITLE BAR this chip is (0..1): the
            // band's folded fraction. Styling only — the tint and the lift;
            // a folded chip is as wide as an open one (req #3862).
            bar,
            // The renderer must draw at the size this was MEASURED at, or the
            // whole placement is decided against a box that does not exist.
            fontSize: INITIATIVE_CHIP_FONT * scale,
        });
    }

    return out;
}

// Bead visual roles (POC vocabulary): fill/ring/width per state, manual ring,
// eligible-now ring. Kept here so the component and any test agree on one
// mapping. `eligible` wins the ring color (POC behavior); manual and eligible
// both draw the thick ring.
//
// This is the EPIC end of the colour language documented under the palette: the
// fill is derived state, the ring is run mode, the halo is eligibility. Nothing
// here ever encodes a REQUIREMENT-level fact — that is the ids' channel.
//
// `suppressed` (req #3226) does NOT touch the ring: the ring still answers
// "is this epic eligible" and that fact does not change under pause — the
// engine's own `eligibility()` is deliberately independent of `pauseState()`.
// It touches only the outer HALO's colour, because the halo is what a reader
// takes as "about to launch", and that reading IS wrong under pause. Ring
// green + halo red is the "eligible AND suppressed" combination rendered
// side by side, never one replacing the other.
/**
 * The epic colour (req #3742) — see `epicWillRun` in `PLAN_VIZ_PALETTE`.
 * Locked outranks manual outranks barrier: each answers "will it run?"
 * more finally than the next. An epic is a barrier unless its flag is
 * explicitly off (the column defaults to 1).
 */
export function epicColorOf(row) {
    const P = PLAN_VIZ_PALETTE;
    if (row.effectiveLocked) return P.lockedFrame;
    if (row.run === 'manual') return P.epicManual;
    if (row.checkpoint !== false && row.checkpoint !== 0) return P.epicBarrier;
    return P.epicWillRun;
}

export function beadStyle(row, eligible, suppressed = false) {
    const P = PLAN_VIZ_PALETTE;
    const done = row.state === EPIC_DONE;
    const running = row.state === EPIC_RUNNING;
    // req #3742 — the ring and the card's frame are the EPIC COLOUR alone.
    // They used to carry run mode (a magenta manual ring), eligibility (a
    // green ring) and state (done/running/pending tints); eligibility is the
    // dashed halo, so the border is free to say one thing.
    const color = epicColorOf(row);
    // req #3775 — no amber for "running" anywhere on the surface. The card's
    // state `bar` is the frame colour in EVERY state, and the L1 bead's fill
    // is that colour while running; both pulse (`pulse`) — the motion is the
    // running mark, never a hue of its own.
    const fill = done ? P.doneFill : running ? color : P.pendingFill;
    return {
        fill,
        bar: color,
        ring: color,
        ringWidth: BEAD_RING_W_EMPHASIS,
        frame: color,
        frameWidth: row.effectiveLocked ? CARD_LOCKED_FRAME_W : BEAD_RING_W_EMPHASIS,
        pulse: running,
        check: done,
        // Req #3168 — "highlight for next epics". The ring alone carried this,
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

// The next-epic halo (req #3168): a second ring outside the bead's own, so the
// two read as a target rather than as one thickened edge.
//
// The radius is BOUNDED BY THE TEXT, not chosen for impact (review finding). A
// epic label's box ends 14px above the bead centre and the first requirement id
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
// on the semantic level. That put a 2.0× → 1.0× epic one wheel-click wide at the
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
// so the two branches MEET rather than meeting-with-a-epic.
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
//    crossed everything else — the initiative chip's strip at every k below 0.371
//    (which INCLUDES the opening view on a 1200px panel), and the launch-unit
//    box on all four sides through essentially the whole 'out' band. Both
//    found in review, measured, not hypothetical.
//
// THE CEILING MOVED WHEN THE LAUNCH RECTANGLE LEFT, AND THAT WAS A DECISION
// (req #3371). THREE of the seven entries were that rectangle's own edges —
// below (28, the binding one across the whole module), above (40) and to the
// side (31.2) — and deleting it deleted them. The remaining
// entries are unchanged, so the binding constraint simply moved to the next
// one: `initiativeChipStrip` at 31, i.e. `NEXT_HALO_MAX_OUTER` 27 -> 30 and
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
// `epicLabel: 'title'`, which is the mode that reserves no L3 title line. Every
// clearance below is stated against it, because a clearance has to hold for the
// TIGHTEST geometry, not the typical one.
export const MIN_CARD_H = cardHeight(0, 'title');
export const NEXT_HALO_CLEARANCES = {
    // The initiative chip's strip, above a LANE-0 bead — still the binding entry.
    // A LANE's top is the band header's bottom (for lane 0), which is where the
    // chip's strip ends, and every card is CENTRED in its lane — so a lane-0
    // bead sits half a LANE below the strip, and the lane is at least one card
    // tall. The room is therefore `laneCardH/2 >= MIN_CARD_H/2`, and `headerH`
    // cancels, the same way it did when the room was the epic label's rise (req
    // #3498 — the label does not float above the bead any more, so that
    // derivation went with it). NOT `h/2` of this card: a short card in a tall
    // lane sits lower, never higher, so the minimum lane is the binding case.
    // It describes the chip's RESTING position: `placeInitiativeChips` pins a chip
    // down into the band body while its band is partly scrolled off, and in that
    // state the chip overlaps beads and halos alike. Pre-existing sticky
    // behaviour, not something a world clearance can promise about.
    initiativeChipStrip: MIN_CARD_H / 2,
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
 * The magnification applied to the next-epic halo's radius, stroke width and
 * dash pattern (req #3271, made continuous by req #3280).
 *
 * CONTINUOUS IN `k`, AND SHORT-CIRCUITED BY THE LABELS. #3271 took a boolean
 * "does this level draw the labels?" — because the halo may only grow into room
 * the labels are not using — and a BOOLEAN BOUND PRODUCES A EPIC: the mark
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
 * **#3280's SMOOTHNESS IS NOT GIVEN BACK.** The epic it deleted came from the
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
 * @param {boolean} labelsDrawn  `drawsLabelKind('epic', level)` for this
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
// when many neighbouring epics are eligible at once, which is not the common
// case this deep in Overview; a plan where it is stays legible as "a lot is
// eligible here", which is still true.
//
// `ZOOM_MIN_RATIO` is left AT 0.25 (not tightened, not loosened): the
// requirement asked whether it is the right floor "measured against what a
// reader can actually do at the scales it admits", and what a reader can now
// do at the floor is see which epics are eligible, which they could not
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
// floor makes the two branches meet with no epic:
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
 * @param {boolean} labelsDrawn  `drawsLabelKind('epic', level)` for this
 *   frame. **REQUIRED (req #3374 P4)**, for the identical reason
 *   `nextHaloMagnify`'s own argument is — see its docblock. Pass `false`
 *   explicitly for the pre-#3324 bare-`k` answer.
 * @returns {boolean}
 */
// ── ONE MARK PER CLUSTER (req #3498, user directive) ────────────────────────
// *"one mark per cluster"* — the answer to what the deep-zoom-out next-epic DOT
// does when several eligible epics sit close together.
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
// mark at its readable size and tells the truth about how many epics are under
// it — which is the fact a reader zoomed this far out actually wants.
//
// SINGLE-LINKAGE, and deliberately so: A near B near C is ONE blob on screen
// even when A and C do not touch, so it must be one mark. Union-find over
// pairwise distance; the input is the ELIGIBLE epics only, which number in the
// handful, so the O(n²) sweep is free.
//
// The centroid is the plain mean of the members. It is not any member's own
// position, which is correct — the mark stands for the group, and putting it on
// one member would claim that epic in particular.
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

// ── Initiative focus geometry (req #3204) ─────────────────────────────────────────
// Clicking an initiative's name fits that initiative's epics to the viewport. This is pure
// geometry over a layout that is already computed, so it lives beside the
// layout rather than in the component: the component's job is to hand the
// resulting {x, y, k} to the d3-zoom BEHAVIOR, and nothing else.
//
// IT IS NOT A MODE. Nothing here is remembered — the two functions below take
// a band and return a transform, and the caller retains neither.

// Margin left on all four sides, in SCREEN px. Screen, not world: it is
// subtracted from the viewport BEFORE the scale is chosen, so the whitespace is
// the same handful of pixels whether the fit lands at k=0.2 or k=2. A world-space
// pad would shrink to nothing on a wide initiative and swallow the view on a narrow one.
export const FOCUS_PAD = 44;
// The zoom behavior's scale extent, as multiples of kBase (the fit-to-width
// scale). Exported so the component's `scaleExtent` call, the focus clamp and
// the tests all read ONE pair of numbers instead of three copies.
export const ZOOM_MIN_RATIO = 0.25;
export const ZOOM_MAX_RATIO = 8;
// The focus ceiling and floor, in the same units. The ceiling exists because
// "as close as possible" on a one-epic initiative is absurd magnification; 2.6 is
// past SEMANTIC_IN_MIN (1.9), so a small initiative lands on the Detail level, which
// is the level a reader focusing on one initiative wants.
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
// room to render its name. On a large initiative — the `Pipeline` band of pipeline 2
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
// **THIS IS THE FULL CHIP, not the floored one.** `placeInitiativeChips` sizes a chip
// from its band's own initiative lane and floors it at `INITIATIVE_CHIP_MIN_H` (req #3272),
// so the height it actually draws at is somewhere in `[INITIATIVE_CHIP_MIN_H,
// INITIATIVE_CHIP_H]` and depends on a `k` this function has not chosen yet.
// Reserving the maximum is the answer that is right at every scale and needs no
// second pass; the difference is 6.4px.
//
// THE CONSEQUENCE, STATED RATHER THAN HIDDEN: a large initiative is fitted slightly
// smaller than it was. That is the trade the requirement asks for — orientation
// beats maximum magnification — and it is the same trade `FOCUS_MAX_RATIO`
// already makes in the other direction for a one-epic initiative.
export const FOCUS_LABEL_H = INITIATIVE_CHIP_H + 2 * CHIP_MARGIN_Y;

/**
 * Does `band` have another band ABOVE it, BELOW it, or both (req #3274)?
 *
 * The answer decides which sides of the focus get the label reserve, because
 * "an initiative at the very top of the plan" has no name to protect above it and
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
export function initiativeFocusNeighbours(layout, band) {
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
 * The world-space rectangle an initiative band occupies.
 *
 * Vertically: the band's own extent, which the layout already computed
 * (`band.y` → `band.y + band.height`, header strip included — the initiative name
 * lives there and belongs inside its own fit).
 *
 * Horizontally: everything the band's OWN epics DRAW, not the whole plan's
 * width. That is the union of
 *   - the columns those epics occupy (min depth → max depth), and
 *   - the beads and every label belonging to those epics.
 *
 * The second term is not redundant. Since req #3119 an epic label is CENTRED on
 * its column and sized to `staggerBudget()` — its own column plus 40% of the
 * narrower neighbour on each side — so a label in the band's first or last
 * column legitimately draws OUTSIDE the column extent. Fitting to columns alone
 * clips it, and does so worst in the production default view (`vertical` +
 * `title`, PipelineDetail.jsx), where the labels are longest. Measured on the
 * live plan before this was fixed: the rightmost title of one band landed 7px
 * PAST the viewport edge with the pad supposedly reserving 44.
 *
 * Non-contiguous columns are spanned rather than skipped: an initiative with epics at
 * depth 0 and depth 4 wants both on screen, and there is no meaningful fit that
 * omits the middle.
 *
 * Reads only `band.epicIds`, `layout.nodes` and `layout.labels`, so it makes no
 * assumption about the ORDER of `layout.bands` (req #3201 changes that order
 * and introduces per-band horizontal origins).
 *
 * @returns {{x:number,y:number,w:number,h:number}|null} null when the band has
 *   no placed epics or the layout has no columns — the caller must not fit.
 */
export function bandFitRect(layout, band) {
    if (!layout || !band || !layout.nodes || !Array.isArray(layout.colX)) return null;
    if (!(band.height > 0) || !Number.isFinite(band.y)) return null;
    const ids = new Set(band.epicIds || []);
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
        // radius until the epic became a box, and a card is wider than a bead
        // by a factor of twenty).
        span(layout.colX[n.depth] - layout.colW[n.depth] / 2,
             layout.colX[n.depth] + layout.colW[n.depth] / 2);
        span(n.left, n.right);
    }
    if (right <= left) return null;
    // Every label this band's epics draw — epic titles/ids, requirement ids and
    // the reserved title slot all carry `epicId`. The initiative label does not, and
    // must not: it renders as an HTML overlay pinned to the viewport, not in the
    // world, so its world x=12 would drag every band's fit back to the gutter.
    for (const l of (layout.labels || [])) {
        if (l.epicId == null || !ids.has(l.epicId)) continue;
        span(l.x, l.x + (l.w || 0));
    }
    if (!Number.isFinite(left) || !Number.isFinite(right) || right <= left) return null;
    return { x: left, y: band.y, w: right - left, h: band.height };
}

/**
 * The {x, y, k} that fits `band` into a `size.w` × `size.h` viewport with
 * FOCUS_PAD screen px of margin on all four sides — plus, on each vertical side
 * that HAS a neighbouring band, FOCUS_LABEL_H more for that neighbour's own
 * initiative name (req #3274).
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
export function initiativeFocusTransform(layout, band, size, kBase, kFloor) {
    return fitTransform(bandFitRect(layout, band), size, kBase,
        initiativeFocusNeighbours(layout, band), kFloor);
}

/**
 * The world-space rectangle ONE EPIC occupies (req #3253).
 *
 * Exactly `bandFitRect`'s union, narrowed from a band's epics to one:
 *   - the column that epic sits in, and the bead drawn in it, and
 *   - every label belonging to it — the epic's own title, its requirement marks,
 *     and the reserved title slot, all of which carry `epicId`.
 *
 * The second term is what makes the rect right rather than merely centred. A
 * epic's requirement marks stack BELOW its bead (`n.y + 14 + reqDy + i *
 * REQ_LINE_H` — `reqDy` is the swim-lane offset, req #3362) and its title sits
 * ABOVE it, so a fit to the bead alone would centre the bead
 * and push the requirement ids — the thing the reader followed the link to see —
 * off the bottom of a tight viewport. The band case fits vertically to
 * `band.height`, which already contains all of that; a single epic has no such
 * precomputed extent and has to take the union itself.
 *
 * The COLUMN is included for the same reason it is in `bandFitRect`: it keeps a
 * epic whose label happens to be short from being magnified past its neighbours
 * into a view with no context. The `FOCUS_MAX_RATIO` clamp handles the rest.
 *
 * THE RECT IS THE EPIC'S OWN EXTENT AND NOTHING MORE — what keeps a single
 * bead from filling the panel is `epicFocusTransform`'s own framing choice
 * (a stated "N across" scale for one epic, req #3498; `FOCUS_PAD`'s fixed
 * screen margin for a set, req #3503), not anything baked in here. This rect
 * answers "what does the epic occupy", full stop; nothing about framing
 * belongs in it.
 *
 * @returns {{x:number,y:number,w:number,h:number}|null} null when the epic is
 *   not placed on this layout — the caller must not fit.
 */
export function epicFitRect(layout, epicId) {
    if (!layout || !layout.nodes || !Array.isArray(layout.colX)) return null;
    const n = layout.nodes.get(epicId);
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
    // req #3498 — the epic's own extent is its CARD, and the card's box already
    // contains every label that carries this `epicId`, so the label sweep below
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
        if (l.epicId !== epicId) continue;
        span(l.x, l.x + (l.w || 0), l.y, l.y + (l.h || 0));
    }
    if (!(right > left) || !(bottom > top)) return null;
    return { x: left, y: top, w: right - left, h: bottom - top };
}

/**
 * The {x, y, k} that centres ONE EPIC in the viewport (req #3253).
 *
 * The receiving end of the requirement page's "view on plan" link. Shares
 * `initiativeFocusTransform`'s arithmetic verbatim — including the scale clamp, which
 * is load-bearing rather than defensive: `zoom.transform` applies what it is
 * given without calling `constrain`, so a k outside the behaviour's own
 * `scaleExtent` would look correct until the reader's first wheel event snapped
 * it back. A second copy of that clamp that "only had to agree" is the desync
 * this file has already taken two review findings on, so there is one.
 *
 * `kFloor` is REQUIRED here for the same reason it is on the band fit — see the
 * FLOOR block above `bandFitRect`.
 *
 * @returns {{x:number,y:number,k:number}|null} null when the epic is not on this
 *   layout, there is no viewport yet, or no floor was handed in.
 */
export function epicFocusTransform(layout, epicId, size, kBase, kFloor) {
    return epicsFocusTransform(layout, [epicId], size, kBase, kFloor);
}

/**
 * The rect a SET of epics occupies — the union of their own fit rects.
 *
 * Added at req #3365, when the initiative name's second click was re-pointed from
 * "the next launch epic" to "the active and pending work in this initiative" (user
 * directive). Ids that resolve to nothing are SKIPPED rather than failing the
 * whole union: a set is a request to frame what exists, and one unlaid epic
 * must not cost the reader the other nine.
 *
 * @param {Object} layout
 * @param {Iterable<number>} epicIds
 * @returns {?{x:number,y:number,w:number,h:number}}
 */
export function epicsFitRect(layout, epicIds) {
    let left = Infinity;
    let right = -Infinity;
    let top = Infinity;
    let bottom = -Infinity;
    for (const id of (epicIds || [])) {
        const r = epicFitRect(layout, id);
        if (!r) continue;
        if (r.x < left) left = r.x;
        if (r.x + r.w > right) right = r.x + r.w;
        if (r.y < top) top = r.y;
        if (r.y + r.h > bottom) bottom = r.y + r.h;
    }
    if (!(right > left) || !(bottom > top)) return null;
    return { x: left, y: top, w: right - left, h: bottom - top };
}

// ── A SINGLE CARD IS FRAMED BY THE EPICS-ACROSS CONTROL, NOT BY A FIT ──────
// User directive, 2026-08-13: *"when zooming into a single epic card ... the
// viewport will center on the card vertically and horizontally and provide a
// 5 card width viewport ... anytime we click and the zoom is to a single card"*.
//
// WHY A SCALE AND NOT A FIT. Every other focus target answers "how big is this
// thing?" and derives `k` from it, which is right for a band — bands differ in
// size, and the reader wants the whole of whichever one they picked. A CARD is
// the one target on this canvas whose world size is FIXED and UNIFORM (req
// #3498 made it so), so fitting to it re-derives, every time, a number that
// could simply be stated. Stating it is also what makes the answer STABLE: a
// epic with two requirements and an epic with ten are two different rect
// heights, and a vertical fit would land them at two different magnifications
// for no reason the reader can see. Five columns is five columns.
//
// It is the SAME quantity the toolbar's epics-across buttons pick, through the
// same `epicsAcrossScale`, so arriving at a card by link and arriving by button
// put the canvas in states a reader can compare — and since req #3648 made the
// buttons 6 5 4 3, a single-card focus lands exactly where the "5" button does.
//
// This scale, and its clamp, are therefore the WHOLE of the single-card
// path — no `fitTransform` margin ever runs on it (the multi-epic case is a
// tight fit; see `epicsFocusTransform`), and the clamp is the zoom
// behaviour's own extent rather than `FOCUS_MAX_RATIO`. That aesthetic
// ceiling exists to stop a fit magnifying a small target into a view with no
// context; here the context is the request, so the only clamp that may bind
// is the hard one — a `k` outside `scaleExtent` would look right until the
// reader's first wheel event snapped it back.
export const EPIC_FOCUS_EPICS_ACROSS = 5;

/**
 * The camera that frames a SET of epics.
 *
 * ONE EPIC IS THE EXCEPTION, AND IT IS HANDLED HERE rather than in
 * `epicFocusTransform` so that BOTH ways of arriving at a single card take it —
 * the `?epic=` deep link from the requirement editor, and an initiative whose second
 * click resolves to one epic. A rule that lived in the single-id wrapper would
 * have covered the first and silently missed the second.
 *
 * TWO OR MORE EPICS GET A TIGHT FIT, NOT A PADDED ONE (req #3503). This used
 * to inflate the raw rect by a proportional margin (`EPIC_FOCUS_CONTEXT`,
 * inherited from the single-launch-rectangle framing req #3297 drew, then
 * carried across two more subjects it was never re-derived for — see the
 * removed constant's git history) before fitting. Retuning that fraction
 * fixed a fixture in isolation but not the general case: measured on the
 * reported initiative (9 open epics in a single-row sequence, no vertical binding),
 * `k ∝ 1/(1 + 2·C)` regardless of C's value, so ANY proportional-of-content
 * margin scales with the very thing the reader asked to see tightly — 9
 * columns rendered at ~12 card widths at the old 0.25, and would still have
 * rendered at ~11.25 retuned to 0.125. A margin that is a FRACTION OF THE
 * CONTENT cannot converge on "as tight as the viewport allows"; only a margin
 * that is a fraction of the VIEWPORT can.
 *
 * So this is now `fitTransform` on the RAW rect, with no inflation at all —
 * exactly `initiativeFocusTransform`'s own arithmetic, reused rather than
 * reinvented. `fitTransform` already reserves `FOCUS_PAD` fixed screen px on
 * every side and picks whichever axis — width or height — actually needs the
 * tighter scale, so a SET of epics is framed by the same "identify the
 * horizontal and vertical extent, fit both at a small fixed screen margin"
 * rule the whole-initiative view already uses, just over a smaller rect. Measured
 * on the reported initiative (9 open epics, single row): a fixed 44px edge on
 * whatever scale the fit chooses, not a fraction of 9 that grows or shrinks
 * with it — 9.28 columns of viewport on a 1730px panel, a little more on a
 * narrower one, in contrast to the retired proportional margin's 11.6–13.9.
 */
export function epicsFocusTransform(layout, epicIds, size, kBase, kFloor) {
    const rect = epicsFitRect(layout, epicIds);
    if (!rect) return null;
    if (placedEpicCount(layout, epicIds) === 1) {
        // `layout.colPitch` — req #3503 review: without it this framed an epic
        // at the scale-1 pitch regardless of the active Epic Width rung, so
        // "5 across" measured 3.27 at rung 4.
        const t = centreTransform(rect, size,
            epicsAcrossScale(EPIC_FOCUS_EPICS_ACROSS, size?.w, layout?.colPitch), kBase, kFloor);
        // Falls through to the fit only when `size.w` is non-finite (e.g.
        // `Infinity`) — the one input where `epicsAcrossScale` nulls but
        // `fitTransform`'s own `w > 0` guard does not. Not reachable with a
        // real viewport; kept so a degenerate one still gets a transform
        // rather than none at all.
        if (t) return t;
    }
    return fitTransform(rect, size, kBase, null, kFloor);
}

// ── THE INITIATIVE NAME'S WORK STOP SPENDS ITS SLACK ON THE INITIATIVE (req #3685) ─────
// `epicsFocusTransform` picks the scale from whichever axis binds and CENTRES
// the open work on the other one. For an initiative's first click (req #3681) that
// centring is wrong: the spare room on the non-binding axis is filled with
// whatever lies either side of the open epics — measured on plan 10's 'Sunday
// Review' at a 1730×850 panel, the open work is three tall cards in columns
// 9–10, height binds, and the window ran world x 3546..5886 while the initiative's
// cards span 3321..5181: Infra Prio clipped on the left and ~520px of the empty
// Oct 20 / future columns on the right, with the whole initiative fitting at that
// very scale.
//
// So the SCALE is the work fit's, unchanged — the first click is still the
// tightest frame that shows the open work, and the second (the band fit) still
// zooms out from it — and only WHERE the window sits moves: on each axis it is
// centred on the INITIATIVE'S CARDS (`epicsFitRect` over the band's epics — not the
// band, whose name strip would push the cards below centre), then clamped so
// the open work keeps its `FOCUS_PAD` margin, or the pinned ruler's height on
// top where that is taller. On the binding axis there is no slack to spend,
// the clamp interval collapses, and the fit's own answer stands.
//
// ONE OPEN CARD IS LEFT CENTRED. A single card is framed by the stated
// epics-across scale and centred on itself (the 2026-08-13 directive above
// `EPIC_FOCUS_EPICS_ACROSS`: "anytime we click and the zoom is to a single
// card"), and an initiative click that resolves to one card is exactly that case.
function slackCentre(ctx0, ctx1, need0, need1, span, current) {
    const lo = need1 - span / 2;
    const hi = need0 + span / 2;
    if (!(lo <= hi)) return current;
    return Math.min(Math.max((ctx0 + ctx1) / 2, lo), hi);
}

/**
 * The initiative name's WORK stop: frame `epicIds` (the initiative's unfinished epics) at
 * `epicsFocusTransform`'s scale, with the window centred on the band's cards
 * wherever the work leaves room. Falls back to the plain work fit for a single
 * open card, or when the band has no placed cards.
 *
 * @returns {{x:number,y:number,k:number}|null}
 */
export function initiativeWorkFocusTransform(layout, band, epicIds, size, kBase, kFloor) {
    const tr = epicsFocusTransform(layout, epicIds, size, kBase, kFloor);
    if (!tr || placedEpicCount(layout, epicIds) === 1) return tr;
    const work = epicsFitRect(layout, epicIds);
    const initiative = epicsFitRect(layout, band?.epicIds);
    const w = size?.w || 0;
    const h = size?.h || 0;
    if (!work || !initiative || !(w > 0) || !(h > 0)) return tr;
    const { k } = tr;
    const pad = FOCUS_PAD / k;
    // `rulerScreenMag`'s height: RULER_H screen px below k = 1, RULER_H·k above.
    const padTop = Math.max(FOCUS_PAD, RULER_H * Math.max(k, 1)) / k;
    const cx = slackCentre(initiative.x, initiative.x + initiative.w, work.x - pad, work.x + work.w + pad,
        w / k, (w / 2 - tr.x) / k);
    const cy = slackCentre(initiative.y, initiative.y + initiative.h, work.y - padTop, work.y + work.h + pad,
        h / k, (h / 2 - tr.y) / k);
    return { k, x: w / 2 - cx * k, y: h / 2 - cy * k };
}

/**
 * How many of `epicIds` are actually PLACED on this layout (req #3498).
 *
 * The single-card rule turns on the number of epics the reader will SEE, which
 * is not `epicIds.length`: `epicsFitRect` deliberately skips ids that resolve to
 * nothing (req #3365), so a two-id set with one unlaid epic frames exactly one
 * card and must be framed as one. Counting the input instead would give that
 * reader a fit, and the two would differ for a reason invisible on screen.
 *
 * Duplicate ids collapse — a set is a set — so the same id twice is one card.
 */
export function placedEpicCount(layout, epicIds) {
    const seen = new Set();
    for (const id of (epicIds || [])) {
        if (seen.has(id)) continue;
        if (epicFitRect(layout, id)) seen.add(id);
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
 * `scaleExtent` verbatim — see the block above `EPIC_FOCUS_EPICS_ACROSS`.
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
// callers now. `initiativeFocusTransform` hands in which vertical sides have a band
// whose name needs room; `epicFocusTransform` hands in nothing, and with both
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
    // time ruler to the viewport top and req #3257 stops every initiative name just
    // BELOW it (`topInset: rulerScreenBottom(t)` in the visualizer), so a
    // reserve that ignored the ruler would park the neighbour's name underneath
    // it. Charged only when there IS a band above, which is NOT the same claim
    // as "the ruler is pinned" and must not be written as one (review finding):
    // pinning is `t.y ≤ rulerExcessY(k)` (0 at k ≥ 1, req #3648), and a fit whose world origin lands BELOW the panel
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
// plan with many initiative bands the readable floor can sit ABOVE the scale that
// needs, which is exactly the failure mode this function exists to rule out —
// it is deliberately NOT `kDefault`, and legibility is not a concern it weighs
// at all.
//
// **AND SINCE req #3312 IT IS THE LANDING VIEW TOO.** #3216 left the two apart,
// so a plan OPENED at `kDefault` — zoomed in past fit-to-width with the world
// origin at the panel's top-left, i.e. on the top initiative's name — and the reader
// had to click Reset to see the plan they had just opened. There is now ONE
// base view and this function computes it; the component's `resetView` applies
// it for the landing and for the header's Reset alike, so the two cannot
// disagree. THE COST, stated because a reader meets it on open: on a plan too
// tall to fit at `K_READABLE` the landing is below `labelsLegible` and opens as
// bare beads — precisely what Reset has shown on those plans since #3216, and
// what was asked for.
//
// PURE and exported for the same reason `initiativeFocusTransform` is (the comment
// two functions up): this is a fit computation over `layout`/`size`, testable
// with plain numbers, and the canvas component's job is only to draw what it
// returns.
/**
 * The scale at which the WHOLE plan — both axes, not just the width `kFit`
 * already fits — is visible in a `size.w` × `size.h` viewport.
 *
 * The tighter of the two axis fits, exactly `initiativeFocusTransform`'s own
 * "contain" idiom applied to the whole world instead of one band's rect.
 * Floored at `kFloor` — the CALLER's own configured `scaleExtent` minimum,
 * taken as a parameter rather than re-derived here, because
 * `zoom.transform` applies what it is given VERBATIM and does not clamp it
 * (see PipelinePlanVisualizer's `scaleExtent` comment): a k below the floor
 * would look right until the next wheel event snapped it back, the same bug
 * class `initiativeFocusTransform`'s own clamp exists to avoid. A re-derived
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

/**
 * The base view's whole camera (req #3648): `factoryDefaultScale`, with the
 * plan pulled down by the ruler's screen excess at that scale (`rulerExcessY`)
 * so the pinned date strip sits ABOVE the top band instead of over its header.
 * The vertical fit is re-solved with that offset in it, so the whole plan's
 * vertical extent still fits: below k = 1 the plan's bottom is at
 * `RULER_H·(1 − k) + H·k`, which is ≤ h exactly when k ≤ (h − RULER_H)/(H − RULER_H).
 * The thumbnail draws no ruler and keeps `factoryDefaultScale`.
 *
 * @returns {{x:number, y:number, k:number}}
 */
export function factoryDefaultView(layout, size, kFit, kFloor) {
    let k = factoryDefaultScale(layout, size, kFit, kFloor);
    const H = layout?.height;
    if (k > 0 && k < 1 && size?.h > RULER_H && H > RULER_H
        && rulerExcessY(k) + H * k > size.h) {
        k = Math.max(Math.min(k, (size.h - RULER_H) / (H - RULER_H)), kFloor);
    }
    return { x: 0, y: rulerExcessY(k), k };
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
// and calls neither `constrain` nor `scaleExtent` (the `initiativeFocusTransform`
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

// ── A RELAYOUT KEEPS THE READER'S PLACE (req #3688) ─────────────────────────
// Hide closed (req #3686) drops rows from cards, so every card below a shrunk
// one moves up in WORLD space while the camera keeps its world transform — the
// cards the reader was looking at slid away under a camera that never moved.
// The fix anchors on a CARD, not on world coordinates: the card on screen
// nearest the viewport centre keeps its top-left at the same screen pixel, at
// the same scale. Its top, not its centre: a card is centred in its lane, so a
// shrinking card's centre and bottom both move, and the title is what the
// reader recognises.
//
// THE SAME ANCHOR BOTH WAYS. Hiding shrinks the centre card under its pinned
// top, so the viewport centre often falls below it afterwards; picking afresh
// on the expand then holds a DIFFERENT card, which moved by a different amount,
// and hide → expand lands hundreds of px from where it started (review
// finding, measured 174–560px on live plans). The caller hands the previous
// toggle's anchor back as `preferKey` while the camera is still where that
// toggle put it, so a round trip is exact.
//
// NOTHING TO HOLD WHEN EVERYTHING IS ON SCREEN. At the overview (the landing
// and Reset view) every card is visible; anchoring one of them pushes the
// whole plan down the panel. The answer is null and the caller keeps the
// world camera — the plan's top stays put, which is the reader's place there.
//
// A FOLDED BAND places no cards, so where no card is on screen the band
// headers are the anchors (keyed by initiative, pinned at the band's top).
const anchorKeyOfBand = (b) => `band:${b.initiativeId ?? 'none'}`;
const anchorRects = (layout) => {
    const out = new Map();
    for (const [id, n] of (layout?.nodes || [])) {
        if ([n.left, n.right, n.top, n.bottom].every(Number.isFinite)) {
            out.set(`epic:${id}`, { left: n.left, right: n.right, top: n.top, bottom: n.bottom, card: true });
        }
    }
    for (const b of (layout?.bands || [])) {
        if (Number.isFinite(b.y) && Number.isFinite(b.height)) {
            out.set(anchorKeyOfBand(b), { left: 0, right: layout.width || 0,
                top: b.y, bottom: b.y + b.height, card: false });
        }
    }
    return out;
};
/**
 * The camera that holds the on-screen card nearest the viewport centre in
 * `prev` at the same screen position in `next`.
 *
 * @param {Object} prev the layout the camera `t` was showing
 * @param {Object} next the layout about to be drawn
 * @param {{x:number,y:number,k:number}} t
 * @param {{w:number,h:number}} size the viewport, in screen px
 * @param {?string} [preferKey] the anchor a previous call returned — held
 *   again when it is still on screen and still placed
 * @returns {{x:number,y:number,k:number,anchor:string}|null} null when every
 *   card is on screen, or nothing of `prev` still placed in `next` is — the
 *   caller keeps the camera.
 */
export function relayoutAnchorTransform(prev, next, t, size, preferKey = null) {
    if (!prev?.nodes || !next?.nodes || !t || !(t.k > 0)
        || !(size?.w > 0) || !(size?.h > 0)) return null;
    const x0 = -t.x / t.k;
    const y0 = -t.y / t.k;
    const x1 = (size.w - t.x) / t.k;
    const y1 = (size.h - t.y) / t.k;
    const cx = (x0 + x1) / 2;
    const cy = (y0 + y1) / 2;
    const from = anchorRects(prev);
    const to = anchorRects(next);
    const onScreen = (r) => r.right >= x0 && r.left <= x1 && r.bottom >= y0 && r.top <= y1;
    let cards = 0;
    let cardsOn = 0;
    for (const r of from.values()) {
        if (!r.card) continue;
        cards += 1;
        if (r.left >= x0 && r.right <= x1 && r.top >= y0 && r.bottom <= y1) cardsOn += 1;
    }
    if (cards > 0 && cardsOn === cards) return null;
    let key = null;
    if (preferKey && from.has(preferKey) && to.has(preferKey) && onScreen(from.get(preferKey))) {
        key = preferKey;
    } else {
        // Cards first; a band only where no card qualifies.
        for (const wantCard of [true, false]) {
            let best = Infinity;
            for (const [k, r] of from) {
                if (r.card !== wantCard || !to.has(k) || !onScreen(r)) continue;
                const dx = Math.max(r.left - cx, 0, cx - r.right);
                const dy = Math.max(r.top - cy, 0, cy - r.bottom);
                const d = dx * dx + dy * dy;
                if (d < best) { best = d; key = k; }
            }
            if (key) break;
        }
    }
    if (!key) return null;
    const a = from.get(key);
    const b = to.get(key);
    return {
        k: t.k,
        x: t.x - (b.left - a.left) * t.k,
        y: t.y - (b.top - a.top) * t.k,
        anchor: key,
    };
}

/**
 * What the plan canvas does with its camera when it lands (req #3637).
 *
 * `landed` is the `{ landKey, planKey }` it last landed on (null before the
 * first), `next` the one it is rendering now; `landKey` is plan + Epic Width
 * rung, `planKey` the plan alone. `saved` is the stored camera, or null.
 *
 *   'keep'    — same plan, same rung: a resize or a refetch that grew the plan.
 *               Never re-lands; the caller only re-clamps.
 *   'restore' — ARRIVING at a plan (mount or in-place switch) with a camera on
 *               record: every reload, Back/Forward, "Back to Plan" and panel
 *               toggle lands here, which is what "sticky" means.
 *   'reset'   — the base view: a first visit, or this plan's Epic Width
 *               changed (an explicit rescale the old camera does not describe).
 *
 * @returns {'keep'|'restore'|'reset'}
 */
export function planLandingAction(landed, next, saved) {
    if (landed && landed.landKey === next.landKey) return 'keep';
    const arrived = !landed || landed.planKey !== next.planKey;
    return arrived && saved ? 'restore' : 'reset';
}

export { EPIC_DONE, EPIC_RUNNING, EPIC_PENDING };
