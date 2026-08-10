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
export const EPIC_PALETTE = [
    '#7c4dff', // purple — kept, measured fine
    '#00897b', // teal — kept, measured fine
    '#c2185b', // pink — kept, measured fine
    '#ff9152', // orange — replaces #f57c00 (6.39:1, warm-floor fail); 7.75:1
    '#6979f8', // indigo — replaces #3949ab (2.23:1, "low separation"); 4.68:1
    '#00b8d4', // cyan — replaces brown's slot; 7.25:1, distinct from teal
    '#aa00ff', // magenta (hue 280°) — new 7th slot, closest neighbour ΔE 26.4
               // from purple, entry 0
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
// | outer HALO (dashed)    | eligible now — "next up"                  | STEP        |
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
// questions a plan is opened to answer: what is running (the Running bead
// PULSES) and what runs next (the halo BREATHES). They ride ONE Konva.Animation
// on different curves — 0.45→1.0 at ~480ms, 0.25→1.0 at ~900ms — so a running
// step and a next step never read as the same rhythm. Nothing else moves.
//
// ── What SIZE means: nothing ───────────────────────────────────────────────
// Every bead is one radius. Column width is a reader's own control
// (STEP_WIDTH_FACTORS), lane and band heights are content spacing, and the type
// scale is a reading hierarchy (step label > requirement id > title slot).
// **No mark is sized by data.** Stated because a key that covers colour and
// motion but leaves size unexplained invites the reader to infer an encoding
// that is not there.

// The channel table above, as DATA (req #3374 P3). `PipelinePlanVisualizer`'s
// two `KeyGroup`s read their titles from `KEY_GROUP_TITLES`, derived below
// rather than hand-typed a second time, so the on-screen key cannot drift
// from the set of channels marked `inKey`. `epic` is the one channel with
// `inKey: false` — see the table comment above for why the key omits it.
export const COLOR_CHANNELS = [
    { channel: 'bead FILL', level: 'step', inKey: true },
    { channel: 'bead RING', level: 'step', inKey: true },
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
// MEASURED against the panel (#111b2b), 2026-08-01: contrast 6.13:1 (the lowest,
// `swarm_ready`) to 12.49:1; minimum pairwise CIE76 ΔE 25.9 (`approved` vs
// `wontfix`). Both are asserted in pipelinePlanLayout.test.js, so a "nicer" hue
// that collapses the scale fails rather than ships.
export const REQ_STATUS_COLORS = {
    // Cool ramp = waiting on a human, brightening toward launchable.
    authoring: '#c8a2ff',      // violet — drafted, not agreed. NOT Darwin's
                               // yellow: yellow is Running on this panel.
    approved: '#93b7e0',       // pale blue — agreed, not queued
    swarm_ready: '#4d9bff',    // vivid blue — queued; the actionable one
    // Agreement with the panel's own state hues (see the rule above).
    development: '#ffd769',    // the Running amber — in flight
    met: '#7ee08a',            // the Complete green — done
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

// ── Requirement marks: STACK order under a step (req #3363) ────────────────
// A different ladder from `REQ_STATUS_ORDER` above on purpose — that one is the
// legend's reading order (the pipeline, authoring to wontfix); this is what a
// reader scanning DOWN a step's own requirement stack wants first. `met` leads
// because "is this step actually finished" is the question a multi-requirement
// step exists to answer, and the two statuses nobody returns to (`deferred`,
// `wontfix`) sink to the bottom in the order the user named them — everything
// still in flight runs in ladder order between the two, closest-to-done first.
export const REQ_STEP_SORT_ORDER = {
    met: 0, development: 1, swarm_ready: 2, approved: 3, authoring: 4,
    deferred: 5, wontfix: 6,
};

// One past the last known rank — a status this build does not know (an
// unresolved id, or an enum value shipped ahead of the UI) sinks below every
// recognised one rather than guessing where it belongs.
const REQ_STEP_SORT_UNKNOWN = Object.keys(REQ_STEP_SORT_ORDER).length;

/**
 * Sort a step's linked requirement ids by status for on-canvas display (req
 * #3363). Stable: two requirements sharing a status keep the order the
 * caller gave them, rather than the sort tie-breaking on id or anything else.
 *
 * @param {number[]} reqIds
 * @param {(id: number) => ?string} statusOf  requirement id -> requirement_status
 * @returns {number[]}
 */
export function sortReqIdsByStatus(reqIds, statusOf) {
    const ids = Array.isArray(reqIds) ? reqIds : [];
    const rank = (id) => {
        const status = typeof statusOf === 'function' ? statusOf(id) : null;
        return Object.hasOwn(REQ_STEP_SORT_ORDER, status)
            ? REQ_STEP_SORT_ORDER[status] : REQ_STEP_SORT_UNKNOWN;
    };
    return ids
        .map((id, i) => [id, i])
        .sort(([aId, aI], [bId, bI]) => (rank(aId) - rank(bId)) || (aI - bI))
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
// IT IS AN ORDINAL LADDER, so the palette is a RAMP and not four labels.
//
// A STOPLIGHT, on the user's directive (2026-08-09): the ends carry the
// metaphor — `discuss` STOPS (signal red, a human speaks first) and `deployed`
// GOES (green, full delegation). The obvious stoplight middle is AMBER, and
// amber is Running on this panel, so the two interior rungs are told apart by
// hue instead: a wine red that reads as "nearly stop", then a violet.
//
// THE RAMP SHIFTED DOWN ONE on a second directive the same day: the periwinkle
// blue that held `implemented` was no good on this panel, so every rung moved
// one step toward Go — the old `planned` violet became `implemented`, the old
// `discuss` wine became `planned` — and a NEW, properly RED red took the
// vacated STOP end. The blue is gone from this scale entirely. Two consequences
// worth naming, because neither is a mistake: the ramp is no longer monotonic
// in lightness (`discuss` #ff3b30 is brighter than the wine below it), and
// `discuss`/`planned` sit in the same half of the wheel.
//
// `planned` WAS THEN NUDGED TOWARD THE VIOLET END (third directive, same day —
// "a bit less the same color as Discuss… nothing dramatic"). #db5771 -> #db5795
// is one channel: the red and green stay put and the blue rises 0x71 -> 0x95,
// which rotates the hue 348° -> 332° without touching the family. It buys a lot
// for that: separation from `discuss` goes 43.8 -> 61.4 ΔE, and because the move
// is TOWARD the violet it also smooths the step into `implemented` rather than
// trading one collision for another. Contrast improves as a side effect
// (4.62 -> 4.78).
//
// TWO DELIBERATE COSTS, both measured rather than assumed:
//
//   1. NO RUNG OF THIS SCALE CAN BE A TRUE BURGUNDY, which is the constraint
//      that shaped `planned` and still binds it. A burgundy is a
//      dark-ink-on-white colour: #800020 measures 1.59:1 against this panel —
//      not "dim", but invisible — and #9b1b3a is 2.15:1. The floor for 13.75px
//      type is WCAG AA 4.5:1, so the darkest wine available here is the ~4.6:1
//      band, and `planned` lives in it (4.78:1 — still the LOWEST swatch in the
//      scale). It reads as a wine rose rather than a burgundy, and that is a
//      property of a light mark on a dark panel, not a preference.
//
//   2. `deployed` IS GREEN ON A PANEL WHERE GREEN MEANS COMPLETE. That rule is
//      real and it is why Darwin's own chip palette is not carried wholesale
//      (`CalendarFC/timeSeriesSizes.js` COORDINATION_COLORS also paints
//      `implemented` YELLOW, which would read as Running — that half is still
//      refused). The stoplight was asked for with the collision named, so the
//      green is chosen to sit as far from the Complete green as a green can:
//      #39d353 against `doneRing` #7ee08a is ΔE 26.4, the largest separation
//      any recognisable green achieves here (#00c853 reaches 25.9, every other
//      candidate measured 9-19). The ids are also a DIFFERENT MARK from the
//      beads — monospace type, not a filled circle — and the key names the
//      scale on screen whenever it is on.
//
// MEASURED against the panel (#111b2b), 2026-08-09: contrast 4.78:1 (`planned`,
// the lowest) to 8.73:1 (`deployed`); minimum pairwise CIE76 ΔE 45.9
// (`planned`/`implemented`); nearest RESERVED state hue 26.4 (`deployed` vs
// `doneRing`, above). All three are asserted in pipelinePlanLayout.test.js, so
// a "nicer" hue that collapses the scale — or a greener green — fails rather
// than ships.
//
// THE RAMP'S OWN STEPS, which is what a reader actually walks: 61.4 (discuss ->
// planned), 45.9 (planned -> implemented), 147.6 (implemented -> deployed). The
// first two are deliberately close in size — that is the "nice flow" the third
// directive asked to preserve — and the last is large because it crosses the
// wheel to Go.
//
// `discuss` sits ΔE 19.2 from MACHINE_MAC_COLOR (#FF5F56) and `planned` 31.2
// from PLAN_VIZ_PALETTE.manualRing. The first is a different SCALE and the
// control is exclusive, so the two are never on screen together; the second is a
// different MARK (a bead's ring, not type). Recorded because they are the
// closest this scale comes to anything outside it.
export const AUTONOMY_COLORS = {
    discuss: '#ff3b30',       // signal red — STOP; a human speaks first
    planned: '#db5795',       // wine rose — nearly stop; plans, then waits
    implemented: '#c58cff',   // violet — builds, then stops for review
    deployed: '#39d353',      // green — GO; full delegation, merges and ships
};

// Key order: the ladder, not the alphabet — same rule as REQ_STATUS_ORDER, and
// for the same reason (the on-screen key renders in this order).
export const AUTONOMY_ORDER = ['discuss', 'planned', 'implemented', 'deployed'];

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

// The registry. ORDER IS THE TOOLBAR'S ORDER — the existing two first, so a
// reader's muscle memory for the chip positions survives the addition.
export const REQ_COLOR_SCALES = [
    {
        key: 'state',
        chipLabel: 'State',
        chipTip: 'Colour the requirement marks by requirement STATUS — '
            + 'click again for none',
        chipName: 'State — colour the requirement marks by requirement status',
        keyTitle: 'Requirement id = status',
        build: ({ requirements, presentReqIds }) => buildEnumColorView({
            requirements,
            presentReqIds,
            field: 'requirement_status',
            colors: REQ_STATUS_COLORS,
            order: REQ_STATUS_ORDER,
            paint: reqStatusColor,
            // 'swarm_ready' reads as two words on the key and as one in the
            // database. The key is for a person.
            labelOf: (v) => v.replace('_', '-'),
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
    {
        key: 'autonomy',
        chipLabel: 'Autonomy',
        chipTip: 'Colour the requirement marks by AUTONOMY — the coordination '
            + 'type, discuss through deployed — click again for none',
        chipName: 'Autonomy — colour the requirement marks by coordination type',
        keyTitle: 'Requirement id = autonomy',
        build: ({ requirements, presentReqIds }) => buildEnumColorView({
            requirements,
            presentReqIds,
            field: 'coordination_type',
            colors: AUTONOMY_COLORS,
            order: AUTONOMY_ORDER,
            paint: autonomyColor,
        }),
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
export function buildReqColorViews({ requirements, machines, presentReqIds = null } = {}) {
    return Object.fromEntries(REQ_COLOR_SCALES.map((s) => [
        s.key, s.build({ requirements, machines, presentReqIds }),
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
const CHW_LABEL = 10.05;        // px per mono char at font 16.5 (step label)
const CHW_REQ = 8.4;            // px per mono char at font 13.75 (req ids)
const CHW_TITLE = 5.8;          // px per mono char at font 9.5 (the title slot)
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
const BAND_HEADER = 83;
// How far lane 0's step label reaches back up into the header: 31px above the
// bead, less the 10px the bead sits below the header.
const STEP_LABEL_RISE = 21;
// Where a bead sits inside its lane, measured from the lane's top. Named
// because the NEXT-STEP HALO's ceiling is derived from it (req #3271): the room
// above a LANE-0 bead is the epic chip's strip, and the distance to it is
// `STEP_LABEL_RISE + BEAD_LANE_OFFSET` — headerH cancels, so the bound holds for
// staggered bands identically.
export const BEAD_LANE_OFFSET = 10;
// EVERY BAND NOW TAKES THE SAME HEADER (req #3371). A band hosting launchable
// work used to take 16px more, reserving the launch-unit letter's fallback
// strip and keeping a launch rectangle's top clear of the epic label. With no
// rectangle and no letter there is nothing to reserve, so the plan is 16px
// shorter per band that used to host one and `headerH` is a function of the
// stagger alone.
const BAND_GAP = 8;
const LANE_BASE_H = 62;         // POC 56 + type-scale headroom, before the title slot
// The content floor a column may never shrink below, per requirement layout.
// Named rather than inlined at the `colW` sizing because the NEXT-STEP HALO's
// magnification ceiling is derived from the smaller of the two (req #3271): the
// halo may grow at Overview, and the tightest bead-to-bead pitch it must stop
// short of is this number. Two copies that "only have to agree" is exactly the
// desync this module has already taken review findings on.
const COL_MIN_W_HORIZONTAL = 64;
const COL_MIN_W_VERTICAL = 70;
const TITLE_SLOT = 14;          // deviation 2 — reserved per-lane title line
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
export const REQ_LINE_H = 18.75;
const STEP_LABEL_MAX = 60;      // hard ceiling on a title label above the bead
// ── The 35-character CEILING (user directives 2026-08-01) ──────────────────
// "let's go with all three levels of zoom showing 35 chars", then — decisively —
// **"if 35 is too much, pick a lower number. I do not want any other spacing to
// have to change for this."**
//
// So 35 is a CEILING and THE GEOMETRY IS FROZEN. The first reading of this
// directive was that 35 is a target to solve the column floor for: the budget is
// `colW[d] + 0.8 × min(neighbour widths)`, so 35 characters at `CHW_LABEL` 10.05
// needs ~360px of budget, which on the uniform `vertical` columns works out at
// `TITLE_COL_MIN` ≈ 200 against today's 144 — a ~47% wider world. **That is
// exactly the spacing change the second directive refuses**, so `TITLE_COL_MIN`,
// `staggerBudget`, `STAGGER_REACH`, `LEFT`/`RIGHT`, the lane pitches and the band
// header are all UNTOUCHED, and the text is fitted to the room that already
// exists.
//
// What that yields is a measured fact, not a promise — see the table in
// [[pipeline-plan-visualizer]] and the assertions in pipelinePlanLayout.test.js.
// The ceiling BITES only where the existing budget already exceeded it (the
// `horizontal` step label, which drew 42-50 characters), and is inert where the
// budget is the binding constraint (`vertical`, 24-29).
export const LABEL_MAX_CHARS = 40;
// Staggering (req #3119, the Build Visualizer's version-label pattern —
// `d3LayoutEngine.js` offsets every odd build by `versionLaneGap`). Odd columns
// draw their long text one line further from the bead, so a label and its
// left/right neighbours are never on the same line and each may overflow its own
// column. Only the SAME-PARITY columns (d±2) share a line, and the budget below
// keeps two of those from meeting.
const STAGGER_GAP = 18;
// The shortest a lane can ever be: `lanePitch()` adds a per-lane requirement
// stack on top of this and never subtracts. Named because the next-step halo's
// band-rectangle clearance is derived from it (req #3271).
const MIN_LANE_PITCH = LANE_BASE_H + TITLE_SLOT + STAGGER_GAP;
// Fraction of a neighbouring column a staggered label may reach into, PER SIDE.
// Labels are centred on their column, so the budget must bound the reach into
// the NARROWER neighbour and then apply symmetrically — bounding the sum of both
// neighbours does not work, because a wide left neighbour would buy half-width
// that gets spent on the right. (That was the first version of this, and it
// admits an overlap: with colW = [224, 64, 64, 64, 224] the labels at d=1 and
// d=3 — the only pair that shares a line — overlapped by ~40px. Found in review,
// with the dataset.) Two same-line labels intrude on the shared column d±1 from
// opposite sides, so anything under 0.5 per side cannot meet; 0.4 leaves margin
// for the mono-width estimate itself.
const STAGGER_REACH = 0.4;
// Minimum column width when STEP TITLES are drawn (req #3119, user directive:
// "increase the display of the step name by 50% more characters"). The binding
// constraint on a step name was never STEP_LABEL_MAX — it was the stagger
// budget, which is derived from the column, and a column sized to a 4-digit
// requirement id is ~64px, i.e. ~16 characters after the reach is added. Giving
// the column a floor raises the budget for every title at once; STEP_LABEL_MAX
// is only the ceiling that stops a pathological title from running forever.
// Exported (req #3242) so the header's Width control can show the reader the
// actual pixel width each S/M/L option draws, rather than a bare letter —
// `TITLE_COL_MIN * STEP_WIDTH_FACTORS[width]` is the representative column
// width in vertical/title mode (the only mode the UI offers today), the same
// arithmetic `colW` itself applies at line ~1176.
export const TITLE_COL_MIN = 144;
export const PLAN_VIZ_FONT = {
    label: 16.5, req: 13.75, title: 9.5, epic: 15, check: 9, slot: 13,
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
//
// The stagger budget (`staggerBudget` below) is a linear function of the column
// widths and the label character budget is derived from it, so a uniform scale
// widens the text and the spacing by the SAME factor — the overlap proof is
// scale-invariant, which is why one multiplier is enough and no metric here has
// to move with it.
// Retuned on the user's own arithmetic (2026-08-01), after seeing the first
// scale on the live plan: S stays the anchor at 1.0, L becomes the previous M
// × 0.85, and M adds 40% of what L adds over S. The first set (1 / 1.4 / 1.9)
// spent width faster than the plan could use it.
// Retuned twice by the user against the live plan. First (2026-08-01) from
// 1 / 1.4 / 1.9 to S-as-anchor with L = old M × 0.85; then again, "shift widths
// S/M/L all by 10% higher except L by 20%" — so S is no longer the identity and
// the compact plan is deliberately a little airier than the pre-#3168 one.
export const STEP_WIDTH_FACTORS = { compact: 1.1, medium: 1.1836, wide: 1.428 };
// The narrowest world the user can ask for. Read by the next-step halo's
// ceiling (req #3271), which measures against the TIGHTEST column any setting
// can produce, never against the unmultiplied content floor.
export const MIN_STEP_WIDTH_FACTOR = Math.min(...Object.values(STEP_WIDTH_FACTORS));
export const DEFAULT_STEP_WIDTH = 'compact';
// `Object.hasOwn`, not a truthiness test on the lookup (review finding). The
// value arrives from localStorage, so `"toString"` and `"constructor"` are both
// reachable — and both resolve to an inherited FUNCTION, which is truthy. That
// factor multiplies every column width to NaN and the canvas renders blank with
// no error anywhere.
export const isStepWidth = (v) => Object.hasOwn(STEP_WIDTH_FACTORS, v);
export const stepWidthFactor = (stepWidth) => (isStepWidth(stepWidth)
    ? STEP_WIDTH_FACTORS[stepWidth] : STEP_WIDTH_FACTORS[DEFAULT_STEP_WIDTH]);

// ── The requirement-mark VIEW: one control, three positions (req #3168) ────
// User directive 2026-08-01: "option to display the title of the requirement
// (35 chars)". The natural shape is a sibling of `Step: ID | Title` — but the
// header row is ALREADY carrying the mode switch, three labelled toggle groups,
// the colour key and the level selector, and directive 4 has just merged the two
// bars back into one. A fourth group is a row that wraps.
//
// So it EXTENDS the existing `Reqs:` control instead of standing beside it, and
// the reason that works is a containment fact rather than a layout convenience:
//
// > **Titles are offered in the VERTICAL stack only.** In `horizontal` every
// > requirement of a step shares ONE line inside one column, so N marks split
// > `colW` N ways and pay the (N−1) separators out of the same room — and the
// > geometry is frozen, so the column cannot grow to help. MEASURED on the
// > Substrate fixture at width S: a 2-requirement step gets 7 characters per
// > title and a 3-or-more-requirement step gets 4, which is `reqLabelText`'s own
// > floor (three characters and an ellipsis) and exactly the length of the bare
// > id it would have replaced. That is not a title, it is a stub, and offering
// > it would be shipping a combination that reads as broken.
//
// The three positions are therefore (layout × label) pairs, and the two legacy
// values are two of them — a browser holding `horizontal` or `vertical` from
// before this change normalizes to itself and that reader's plan is unchanged.
export const REQ_VIEWS = {
    horizontal: { reqLayout: 'horizontal', reqLabel: 'id', label: 'Reqs: Horizontal' },
    vertical: { reqLayout: 'vertical', reqLabel: 'id', label: 'Reqs: Vertical' },
    titles: { reqLayout: 'vertical', reqLabel: 'title', label: 'Reqs: Titles' },
};
export const DEFAULT_REQ_VIEW = 'vertical';
// `Object.hasOwn` — the value is read from localStorage (the `isStepWidth` rule).
export const isReqView = (v) => Object.hasOwn(REQ_VIEWS, v);
export const normalizeReqView = (v) => (isReqView(v) ? v : DEFAULT_REQ_VIEW);
export const reqViewOptions = (v) => REQ_VIEWS[normalizeReqView(v)];

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
    if (kind === 'step' || kind === 'req') return level !== 'out';
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
const RULER_LABEL_GAP = 10;
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

// The pinned strip's bottom edge in SCREEN space — req #3254's contract with
// req #3257 (the concurrent epic-name work): "the date header owns the
// topmost strip and the epic names stop just below it" needs ONE readable
// number, not a guessed pixel offset. Scales with zoom because the strip's
// own ticks and text do (deviation 2 — zoom is a pure transform on this
// surface), so a caller reading the SAME transform gets the exact edge the
// ruler is drawn at, pinned or not.
export function rulerScreenBottom(t, rulerH = RULER_H) {
    const k = (t && typeof t.k === 'number' && t.k > 0) ? t.k : 1;
    return stickyRulerY(t) + rulerH * k;
}

const truncate = (s, n) => {
    const str = String(s == null ? '' : s);
    return str.length > n ? `${str.slice(0, n - 1)}…` : str;
};

// The text drawn ABOVE a bead. NO '#' anywhere — ids render bare (production
// directive), titles render verbatim (stored plan content).
export function stepLabelText(row, stepLabel, maxChars = STEP_LABEL_MAX) {
    return stepLabel === 'title'
        ? truncate(row.title || `step ${row.id}`, Math.max(4, Math.min(STEP_LABEL_MAX, maxChars)))
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
    maxChars = LABEL_MAX_CHARS } = {}) {
    if (reqLabel !== 'title') return String(reqId);
    const t = titleLookup(reqTitles, reqId);
    // The id rides ALONGSIDE the title, not instead of it (user directive) — an
    // id-only mark reading "3242" gives no hint what's under it without a
    // hover; "3242 - Pipeline Visualizer Polish" answers that at the same L3
    // glance the title itself was added for. Built BEFORE truncation, same as
    // the bare id below, so the id survives the cut and the title is what
    // gives way on a tight column — the id is the one piece of this string a
    // reader can always resolve to the actual requirement.
    return t ? truncate(`${reqId} - ${t}`, Math.max(4, Math.min(LABEL_MAX_CHARS, maxChars)))
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
 * @param {('horizontal'|'vertical')} [opts.reqLayout]
 * @param {('id'|'title')} [opts.reqLabel]   what the marks UNDER a bead say
 * @param {(Map|Object)} [opts.reqTitles]    requirement id -> title, for 'title'
 * @param {('id'|'title')} [opts.stepLabel]
 * @param {('compact'|'medium'|'wide')} [opts.stepWidth]
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
        reqLayout = 'horizontal', stepLabel = 'id', stepWidth = DEFAULT_STEP_WIDTH,
        reqLabel = 'id', reqTitles = null, timeAxis = null, epicCounts = null,
        pauseInfo = null,
    } = opts || {};
    const safeRows = Array.isArray(rows) ? rows : [];
    const widthFactor = stepWidthFactor(stepWidth);
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
            reqLayout, stepLabel, stepWidth, reqLabel, empty: true,
        };
    }

    const byId = new Map(safeRows.map((r) => [r.id, r]));
    const depsOf = (r) => (r.depIds || []).filter((d) => byId.has(d));

    // ── Time-slot columns, floored by dependency depth (req #3201) ──────────
    const { colOf, maxCol, slotKeys, slotOf, origins: slotOrigins } =
        computeTimeColumns(safeRows, byId, depsOf, timeAxis);

    // ── Column widths (the zero-overlap contract, half 1) ───────────────────
    // A column is as wide as the widest thing DRAWN in it: the one-line req-id
    // string (horizontal) or the widest single id (vertical), and the step
    // label — id or truncated title — in either mode.
    const colSteps = [];
    for (const r of safeRows) {
        const d = colOf.get(r.id);
        (colSteps[d] ||= []).push(r);
    }
    // Title-mode step labels are STAGGERED, so a column no longer has to be as
    // wide as its longest title — the label overflows into the neighbouring
    // columns, which draw on the other line (req #3119). Sizing columns to full
    // titles is what made the world 5800px wide on the live plan; the ids and
    // the layout drive the width now, and the label is fitted to the room it
    // actually has, below.
    const staggerLabels = stepLabel === 'title';
    const colW = [];
    for (let d = 0; d <= maxCol; d++) {
        const steps = colSteps[d] || [];
        const labelW = staggerLabels ? TITLE_COL_MIN
            : Math.max(0, ...steps.map((r) => stepLabelText(r, stepLabel).length * CHW_LABEL + 16));
        let w;
        if (reqLayout === 'horizontal') {
            w = Math.max(COL_MIN_W_HORIZONTAL, labelW,
                ...steps.map((r) => reqStr(r).length * CHW_REQ + 30));
        } else {
            w = Math.max(COL_MIN_W_VERTICAL, labelW,
                ...steps.map((r) => Math.min(reqStr(r).length, 6) * CHW_REQ + 40));
        }
        // The user's width choice (req #3168) applies HERE, after the content
        // minimum has been established — see STEP_WIDTH_FACTORS.
        colW.push(w * widthFactor);
    }
    // How much horizontal room a STAGGERED label at depth d may occupy: its own
    // column plus a bounded reach into each neighbour. Ends have one neighbour.
    // At the ends there is no neighbouring column, but there IS margin: the
    // left gutter the lane wires start after, and the right padding the world
    // width already reserves. Bounding by those keeps a d=0 label out of the
    // gutter instead of letting a wide colW[1] push it off the world.
    const staggerBudget = (d) => {
        const left = d > 0 ? colW[d - 1] : LEFT;
        const right = d < maxCol ? colW[d + 1] : RIGHT + 40;
        return colW[d] + 2 * STAGGER_REACH * Math.min(left, right);
    };
    const staggerOf = (d) => (d % 2) * STAGGER_GAP;

    // ── Requirement titles get their own swim lane per column (user directive
    //    2026-08-01, generalized to requirement COUNT req #3362) ────────────────
    // A requirement TITLE is ~17 characters where an id was 4, and the column is
    // frozen — so a title is boxed by its own slab and there is nothing left to
    // give it. The step label above the bead solved exactly this problem in req
    // #3119 and the answer is reusable: give a column its own line, so a mark and
    // its left/right neighbours are never drawn at the same height, and each may
    // then overflow its own column into the room beside it.
    //
    // req #3119 gave that line to ODD COLUMNS by pure parity, and restricted it
    // to a run of LONE marks (nMarks === 1) — a stack of N occupies N consecutive
    // lines, and a flat one-line offset only clears a neighbour that is itself
    // one line tall. A step with more than one requirement stayed column-bound at
    // whatever colW affords, never the 40-character ceiling a lone mark could
    // reach (req #3362 finding).
    //
    // The fix is the same idea, sized to the actual neighbour instead of a flat
    // line: which column owns line 0 (the "higher" swim lane) is now decided by
    // WHO HAS FEWER REQUIREMENTS, not by parity — the fewer-marks column reaches
    // into its busier neighbour unshifted, and the busier column is pushed down
    // far enough to clear the whole of what reached into it. A tie (equal counts,
    // the original run-of-1 case) still resolves by parity, so a uniform run is
    // byte-identical to the pre-#3362 layout. See the per-band `reqOffsets` sweep
    // (below, in the lane-assignment loop) for the derivation — it needs each
    // lane's final occupant map, which does not exist yet at this point in the
    // module, so the offset itself is band-local and read back through
    // `band.reqOffsets` where the requirement marks are drawn.
    //
    // The reach itself is UNCHANGED: bounded to the immediate neighbour only
    // (`staggerBudget`, `STAGGER_REACH` below), so the pairwise proof the step
    // labels already carry still holds — only SAME-parity columns (d±2) share a
    // line, they intrude on the shared column d±1 from opposite sides, and
    // STAGGER_REACH 0.4 per side cannot meet. Only WHICH line a stack starts on
    // changed, never how far sideways it may reach.
    const staggerReqs = reqLabel === 'title' && reqLayout !== 'horizontal';
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
    bandKeys.forEach((key, i) => {
        bandByKey.get(key).color = EPIC_PALETTE[i % EPIC_PALETTE.length];
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
                    const below = [...lanesUsed]
                        .filter((v) => v > al)
                        .sort((p, q) => p - q)[0];
                    lane = below === undefined ? al + 1 : (al + below) / 2;
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
        const maxReqs = Math.max(1, ...steps.map((r) => (r.reqIds || []).length));

        // ── Requirement-count swim lanes (req #3362) ────────────────────────
        // TITLE mode only. Before this, only a LONE mark (nMarks === 1) ever
        // spent the stagger budget, and only inside a run where both same-lane
        // neighbours were themselves lone marks — a stack of N drew column-bound
        // at whatever colW affords (as low as 18 characters on this fixture),
        // never the 40-character ceiling every other combination can reach. The
        // restriction existed because the OLD offset was a flat one line
        // (`(d % 2) * REQ_LINE_H`): fine for separating two 1-line blocks, not
        // enough to clear a taller neighbour's stack.
        //
        // Generalized: TWO SWEEPS per lane (left-to-right, right-to-left) give
        // every occupied depth the number of lines its OWN stack must start on.
        // A same-lane neighbour with FEWER marks is the one that reaches — it
        // stays unshifted (offset 0, the "higher" swim lane) — while a neighbour
        // with MORE marks costs nothing (it never reaches, so nothing to clear).
        // A tie (equal counts — the run-of-1 case req #3119 already handled)
        // resolves by column parity, exactly as before, so a uniform run is
        // BYTE-IDENTICAL to the old flat scheme. Chained through the previous
        // column's OWN offset (`offL.get(d - 1)`) so a monotonic run (1, 2, 3…)
        // clears every predecessor's full extent, not just its immediate
        // neighbour's raw count — the counterexample that breaks a one-hop-only
        // rule is a 3/2/1 chain, where the middle column is busier than its
        // right neighbour and fewer than its left: a one-hop rule gives it two
        // contradictory offsets, the chained one resolves them consistently.
        //
        // Reach is symmetric and BOUNDED to the immediate neighbour exactly as
        // before (`staggerBudget`, `STAGGER_REACH`) — this only changes WHICH
        // line a stack starts on, never how far sideways it may reach, so the
        // zero-overlap proof for distant (d±2) same-parity columns is untouched.
        // Raw count, deliberately NOT `Math.max(1, …)` (found in review) — a
        // req-less step draws zero requirement marks (`laneReqs` below sizes
        // it that way too), so it must read as zero lines to a neighbour's
        // sweep as well, or a neighbour would be pushed down to clear a line
        // this step never actually occupies.
        const countAt = (lane, d) => {
            const occ = used.get(d)?.get(lane);
            if (occ === undefined || occ === RESERVED) return 0;
            return (byId.get(occ)?.reqIds || []).length;
        };
        const reqOffsets = new Map(); // depth -> Map(lane -> offset, in REQ_LINE_H units)
        if (staggerReqs) {
            for (const lane of new Set(steps.map((r) => laneById.get(r.id)))) {
                const offL = new Map();
                for (let d = 0; d <= maxCol; d++) {
                    const own = countAt(lane, d);
                    if (own === 0) continue;
                    const left = countAt(lane, d - 1);
                    if (left === 0) offL.set(d, 0);
                    else if (left < own) offL.set(d, (offL.get(d - 1) || 0) + left);
                    else if (left > own) offL.set(d, 0);
                    // A TIE still needs to CHAIN like the strictly-fewer case
                    // (found in review, req #3362): parity only decides WHICH
                    // side goes lower, it does not by itself clear a neighbour
                    // that was ITSELF pushed down by a tie further back. A
                    // sequence of equal counts (e.g. 1, 1, 2, 2) needs offsets
                    // 0, 1, 2, 4 — not 0, 1, 0, 2 — or the d=2/d=3 pair (same
                    // count, same un-chained parity value) lands on the same
                    // lines. d and d+1 in a tie have opposite parity, so
                    // exactly one of `offL.get(d - 1)` / this column's own
                    // odd-branch chain is ever non-zero, which is what keeps a
                    // uniform run byte-identical to the pre-#3362 0,1,0,1.
                    else offL.set(d, (d % 2 === 1) ? (offL.get(d - 1) || 0) + left : 0);
                }
                const offR = new Map();
                for (let d = maxCol; d >= 0; d--) {
                    const own = countAt(lane, d);
                    if (own === 0) continue;
                    const right = countAt(lane, d + 1);
                    if (right === 0) offR.set(d, 0);
                    else if (right < own) offR.set(d, (offR.get(d + 1) || 0) + right);
                    else if (right > own) offR.set(d, 0);
                    else offR.set(d, (d % 2 === 1) ? (offR.get(d + 1) || 0) + right : 0);
                }
                for (let d = 0; d <= maxCol; d++) {
                    if (countAt(lane, d) === 0) continue;
                    if (!reqOffsets.has(d)) reqOffsets.set(d, new Map());
                    reqOffsets.get(d).set(lane, Math.max(offL.get(d) || 0, offR.get(d) || 0));
                }
            }
        }

        // Lane pitch (zero-overlap contract, half 2): the vertical envelope of
        // one lane — step label above, bead, req ids below, then the reserved
        // title slot — never reaches the next lane's label.
        //
        // PER-LANE since req #3119. In 'vertical' mode a lane is as tall as ITS
        // OWN deepest requirement stack, not as tall as the band's. One 5-req
        // step used to set the pitch for every lane in its band: in the live
        // Substrate plan that made all nine lanes of "Swarm Substrate Rebuild"
        // 120px tall to accommodate step 1, when eight of them carry a single
        // requirement and need 72 — ~380px of dead vertical space in one band,
        // and the whole plan taller than the panel for no reason. 'horizontal'
        // keeps a constant pitch because its req ids sit on ONE line whatever
        // the count, so there is nothing lane-specific to measure.
        //
        // Includes the swim-lane OFFSET (req #3362), not just the step's own
        // count — a stack pushed down to clear a busier neighbour needs its
        // lane to reserve the room it was pushed INTO, or it runs into the next
        // lane down exactly the way an un-pushed 5-req stack used to.
        const laneReqs = new Map();
        for (const r of steps) {
            const lane = laneById.get(r.id);
            const d = colOf.get(r.id);
            const n = (r.reqIds || []).length + (reqOffsets.get(d)?.get(lane) || 0);
            if (n > (laneReqs.get(lane) || 0)) laneReqs.set(lane, n);
        }
        // The stagger costs one extra line per lane, and it is charged ONCE
        // because the two staggered things are mutually exclusive: in 'title'
        // mode the step label above the bead staggers and the title slot is not
        // drawn at all; in 'id' mode the label is a 4-digit id that never needed
        // the room and the title slot below staggers instead.
        // One extra line when requirement titles stagger: odd columns push their
        // whole block down by REQ_LINE_H, and the lane has to own that line or
        // the deepest stack in an odd column runs into the lane below.
        const lanePitch = (lane) => (reqLayout === 'vertical'
            ? 64 + (Math.max(1, laneReqs.get(lane) || 1) - 1) * REQ_LINE_H
            : LANE_BASE_H) + TITLE_SLOT + STAGGER_GAP
            + (staggerReqs ? REQ_LINE_H : 0);
        // Cumulative lane tops, so a lane's y is the SUM of the lanes above it
        // rather than index × a single pitch. `laneY` is exported on the band:
        // every consumer that draws per-lane furniture (the visualizer's lane
        // wires) must use it or the wires detach from the beads.
        const laneY = [];
        {
            let acc = 0;
            for (let l = 0; l < sub; l++) { laneY.push(acc); acc += lanePitch(l); }
            laneY.push(acc); // sentinel: total lane height
        }
        // Retained for consumers that want a representative pitch; band height
        // now comes from laneY, never from sub × pitch.
        const pitch = lanePitch(0);
        // EVERY BAND TAKES THE SAME HEADER (req #3371). A band hosting launch-
        // unit members used to take 16px more, reserving the letter's fallback
        // strip and keeping a launch rectangle's top clear of the epic label — a
        // collision found in review on long epic titles. No rectangle, no
        // letter, no reservation, so a plan is 16px shorter per band that used
        // to host one.
        // The header still absorbs the stagger, and ONLY in title mode: lane 0's
        // step label is what gets LIFTED on odd columns (req #3119), and without
        // the extra line it rises into the epic label — a collision the overlap
        // invariant caught. In id mode nothing above the bead moves (the title
        // slot staggers DOWNWARD instead), so charging the header there would be
        // 14px of dead space per band in the default view.
        const headerH = BAND_HEADER + (staggerLabels ? STAGGER_GAP : 0);
        // The EPIC'S OWN LANE: the part of the header no step content can reach.
        // Derived, never assumed — see BAND_HEADER. Consumers that place the epic
        // name (the visualizer's floating chip) clamp to THIS, not to headerH.
        const epicLaneH = headerH - STEP_LABEL_RISE - (staggerLabels ? STAGGER_GAP : 0);
        bands.push({ ...band, steps, sub, maxReqs, pitch, laneY, laneReqs,
            headerH, epicLaneH, reqOffsets });
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

    // ── Node positions ──────────────────────────────────────────────────────
    const nodes = new Map();
    bands.forEach((band, bandIndex) => {
        for (const r of band.steps) {
            const d = colOf.get(r.id);
            nodes.set(r.id, {
                id: r.id,
                x: colX[d],
                y: band.y + band.headerH + band.laneY[laneById.get(r.id)]
                    + BEAD_LANE_OFFSET,
                depth: d,
                lane: laneById.get(r.id),
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
            const x1 = a.x + BEAD_R + 1;
            const y1 = a.y;
            const x2 = b.x - BEAD_R - 1;
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
            let path;
            if (late) {
                const bend = Math.min((colW[b.depth] || 110) * 0.9, Math.max(40, x2 - x1));
                const xb = Math.max(x1, x2 - bend);
                path = `M${x1},${y1} L${xb},${y1} C${xb + bend * 0.45},${y1} `
                    + `${xb + bend * 0.55},${y2} ${x2},${y2}`;
            } else {
                const bend = Math.min((colW[a.depth] || 110) * 0.9, Math.max(40, x2 - x1));
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
        // A staggered title label is fitted to its budget (own column + a
        // bounded reach into each neighbour) and lifted one line on odd columns.
        // Fitted to the budget the FROZEN geometry provides, then capped at the
        // 35-character ceiling. Both halves matter: the budget is what stops a
        // label overrunning its neighbours (the zero-overlap proof), the ceiling
        // is the user's number, and neither is allowed to move a column.
        const labelMax = staggerLabels
            ? Math.min(LABEL_MAX_CHARS,
                Math.floor((staggerBudget(n.depth) - 8) / CHW_LABEL))
            : STEP_LABEL_MAX;
        const label = stepLabelText(r, stepLabel, labelMax);
        const lw = label.length * CHW_LABEL;
        labels.push({
            kind: 'step', stepId: r.id, text: label,
            // In `title` mode this label IS the step's stored name.
            prose: staggerLabels,
            x: n.x - lw / 2,
            y: n.y - 31 - (staggerLabels ? staggerOf(n.depth) : 0),
            w: lw, h: 17,
        });
        const ids = r.reqIds || [];
        // THE COLUMN IS NOT RESIZED FOR A TITLE — the geometry is frozen (see
        // LABEL_MAX_CHARS), so the room a requirement mark gets is whatever its
        // column already has, and the text is truncated into it. That is also
        // what keeps the `req labels stay inside their column slab` invariant
        // true by construction rather than by luck. `- 6` is the same hair of
        // margin the id path effectively had from its own `+ 30`/`+ 40` padding.
        //
        // In `horizontal` the whole requirement LIST shares one line, so N marks
        // share the column and each gets 1/N of it. With titles that is unusable
        // past a single requirement, which is why the CONTROL does not offer
        // horizontal + titles (see REQ_VIEWS) — the module still handles the
        // combination correctly rather than trusting every caller not to ask.
        // …and the SEPARATORS are part of that room. In `horizontal` the marks
        // are drawn as `texts.join(' ')`, so N marks also cost (N−1) mono
        // spaces. Dividing the column by N alone budgets the text and forgets
        // the glue: measured on the Substrate fixture, that put a 3-requirement
        // step's title row 14.4px OUTSIDE its own column slab — the exact
        // invariant this module asserts — while the truncation looked correct at
        // every individual mark. The id path was never affected (a column is
        // sized from `reqIds.join(' ')`, spaces included) and `vertical` has no
        // separators at all, so this term is zero everywhere except the
        // combination the CONTROL withholds — which is precisely the branch a
        // "the module handles it anyway" claim has to be true for.
        const nMarks = Math.max(1, ids.length);
        const perReq = reqLayout === 'horizontal' ? nMarks : 1;
        const gaps = reqLayout === 'horizontal' ? (nMarks - 1) * CHW_REQ : 0;
        const band = bands[n.bandIndex];
        // Every staggered title spends the stagger budget now — its own column
        // plus a bounded reach into each neighbour — regardless of stack height
        // (req #3362). Safe because `band.reqOffsets` (computed in the
        // lane-assignment loop above) already placed this stack on the lines
        // its neighbours cannot reach: a busier neighbour was pushed down far
        // enough to clear us if we're the fewer side, or we were if it is.
        const widened = staggerReqs;
        const reqRoom = widened ? staggerBudget(n.depth) : colW[n.depth];
        const reqMax = Math.max(1,
            Math.floor((reqRoom - 6 - gaps) / (CHW_REQ * perReq)));
        const showTitles = reqLabel === 'title';
        const reqDy = (band.reqOffsets.get(n.depth)?.get(n.lane) || 0) * REQ_LINE_H;
        const texts = ids.map((reqId) => reqLabelText(reqId,
            { reqLabel, reqTitles, maxChars: reqMax }));
        if (reqLayout === 'horizontal') {
            const totalReqW = (texts.join(' ').length) * CHW_REQ;
            let rx = n.x - totalReqW / 2;
            texts.forEach((t, i) => {
                const w = t.length * CHW_REQ;
                labels.push({
                    kind: 'req', stepId: r.id, reqId: ids[i], text: t,
                    // A TITLE is stored user content and renders verbatim; an id
                    // is generated. The no-'#' audit keys on this flag rather
                    // than on `kind`, so a mark that switched from generated to
                    // prose cannot silently change which side of that line it is
                    // on (PIPE-07).
                    prose: showTitles,
                    x: rx, y: n.y + 14, w, h: 14,
                });
                rx += w + CHW_REQ; // one mono space between marks
            });
        } else {
            texts.forEach((t, i) => {
                const w = t.length * CHW_REQ;
                labels.push({
                    kind: 'req', stepId: r.id, reqId: ids[i], text: t,
                    prose: showTitles,
                    // Ids keep their historical left-anchored offset so an
                    // existing reader's plan is byte-identical; a title is
                    // CENTRED, because a 17-character mark hung off `n.x - 15`
                    // would leave its own column slab on the right.
                    x: showTitles ? n.x - w / 2 : n.x - 15,
                    y: n.y + 14 + reqDy + i * REQ_LINE_H, w, h: 14,
                    // ── The id, alongside the title (user directive
                    //    2026-08-01: "L3 can have the req titles on by default")
                    // The mark shows the ID at L1/L2 and the TITLE at L3, and
                    // the renderer picks — NOT the layout. Relayouting on a zoom
                    // change would break this module's oldest invariant (a level
                    // change is a pure transform, never a new geometry), and it
                    // would do it visibly: the staggered lane is one line taller
                    // in title mode, so every bead below would jump as you
                    // zoomed. Reserving the TITLE's box at every level and
                    // drawing the shorter id inside it costs nothing — the id is
                    // centred on the same point and is strictly narrower, so it
                    // cannot leave a box the title already fits.
                    idText: String(ids[i]),
                    idW: String(ids[i]).length * CHW_REQ,
                });
            });
        }
        // The reserved title slot (drawn at the 'in' zoom level, and skipped
        // when the step label already IS the title — it would duplicate).
        if (stepLabel !== 'title') {
            // Staggered too, and therefore budgeted the same way: the title may
            // reach into its neighbours because they draw on the other line.
            // Before req #3119 this was capped at the bare column width, which
            // is what cut plan titles to a few characters in narrow columns.
            const maxChars = Math.max(4, Math.floor((staggerBudget(n.depth) - 8) / CHW_TITLE));
            const t = truncate(r.title || '', maxChars);
            if (t) {
                // The slot clears THIS LANE's requirement stack — the same count
                // that sized the lane (req #3119). It used to clear the BAND's
                // deepest stack, which was equivalent only while every lane in a
                // band shared one pitch; with per-lane heights a one-req lane in
                // a five-req band had its title pushed 48px past its own lane
                // and straight onto the next lane's bead. Caught by the
                // label-vs-bead invariant, which is why that test exists.
                const laneN = Math.max(1, band.laneReqs.get(n.lane) || 1);
                // The slot clears the DEEPEST mark on this lane, not its own
                // step's — `laneN` already includes the swim-lane offset (req
                // #3362) of whichever column in this lane was pushed down
                // furthest, never just this column's own.
                //
                // Using `reqDy` here is wrong and was measured wrong: an EVEN
                // column's slot is unshifted while its ODD neighbour's marks are
                // one line lower, and the two land on each other (step 5's slot
                // at y 303–314 against step 6's mark at 301–315). The slot is not
                // staggered against its neighbours the way the marks are, so it
                // has to sit below all of them.
                const slotDy = staggerReqs ? REQ_LINE_H : 0;
                const slotY = (reqLayout === 'vertical'
                    ? n.y + 14 + slotDy + laneN * REQ_LINE_H + 2
                    : n.y + 30) + staggerOf(n.depth);
                labels.push({
                    kind: 'title', stepId: r.id, text: t,
                    // Stored plan content — see the `prose` note on req marks.
                    prose: true,
                    x: n.x - (t.length * CHW_TITLE) / 2, y: slotY,
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
        reqLayout,
        reqLabel,
        stepLabel,
        stepWidth,
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
export const EPIC_CHIP_OPEN_LINK_W = 24;
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
export const EPIC_CHIP_CARDS_LINK_W = 24;
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
// would have kept every measured figure in [[pipeline-plan-visualizer]]
// byte-valid and changed no pixel — at the cost of a constant nothing derives,
// which is exactly the failure the `min()`-over-an-enumerated-list shape was
// built to prevent. The list is exhaustive by construction; a hand-pinned
// number is a fourth wrong ceiling waiting to be discovered.
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
export const NEXT_HALO_CLEARANCES = {
    // The epic chip's strip, above a LANE-0 bead — THE BINDING ENTRY since req
    // #3371 removed the launch-unit box's three. `headerH` cancels out of the
    // derivation, so one number covers staggered bands too.
    // It describes the chip's RESTING position: `placeEpicChips` pins a chip
    // down into the band body while its band is partly scrolled off, and in that
    // state the chip overlaps beads and halos alike. Pre-existing sticky
    // behaviour, not something a world clearance can promise about.
    epicChipStrip: STEP_LABEL_RISE + BEAD_LANE_OFFSET,
    // The time axis's vertical slot rules, drawn at column LEFT EDGES — so half
    // the tightest column, not the whole pitch. Non-binding (35.2 against the
    // chip strip's 31) and listed because it is the next entry that would bind
    // if this list ever loosened again.
    slotRule: COL_MIN_W_HORIZONTAL * MIN_STEP_WIDTH_FACTOR / 2,
    // The BAND rectangle, which is the last piece of world geometry a bead can
    // reach. A lane-0 bead is `headerH + BEAD_LANE_OFFSET` >= 93 below the band
    // top; the deepest lane's bead is `lanePitch - BEAD_LANE_OFFSET` >= 84 above
    // the bottom. Non-binding by a wide margin, listed because a list that
    // silently omits the outermost boundary is not the index it claims to be.
    bandRect: MIN_LANE_PITCH - BEAD_LANE_OFFSET,
    // The nearest other bead's own outer ring. The column pitch is the tightest
    // bead-to-bead distance (the lane pitch is at least
    // `LANE_BASE_H + TITLE_SLOT + STAGGER_GAP` = 94) and `widthFactor` only ever
    // widens, so its floor is the horizontal column floor times the smallest
    // width factor the user can choose.
    neighbourBead: COL_MIN_W_HORIZONTAL * MIN_STEP_WIDTH_FACTOR
        - BEAD_OUTER_RADIUS,
};
// One world pixel of margin, so "clears it" is not "touches it".
export const NEXT_HALO_MAX_OUTER =
    Math.min(...Object.values(NEXT_HALO_CLEARANCES)) - 1;
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
        // The column, and the bead drawn in it.
        span(layout.colX[n.depth] - layout.colW[n.depth] / 2,
             layout.colX[n.depth] + layout.colW[n.depth] / 2);
        span(n.x - BEAD_R, n.x + BEAD_R);
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
 * THE RECT IS THE STEP'S OWN EXTENT AND NOTHING MORE — the crop margin that
 * keeps a single bead from filling the panel is applied by
 * `stepFocusTransform`, not baked in here, because it is a property of the FIT
 * rather than of what the step occupies.
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
    const colW = layout.colW?.[n.depth];
    if (Number.isFinite(layout.colX[n.depth]) && Number.isFinite(colW)) {
        span(layout.colX[n.depth] - colW / 2, layout.colX[n.depth] + colW / 2,
             n.y - BEAD_R, n.y + BEAD_R);
    }
    span(n.x - BEAD_R, n.x + BEAD_R, n.y - BEAD_R, n.y + BEAD_R);
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
    const rect = stepFitRect(layout, stepId);
    if (!rect) return null;
    // The crop margin lives HERE rather than in `stepFitRect` (req #3371): the
    // rect answers "what does this step occupy", which nothing about framing
    // should change, and the inflation answers "how much plan do I want around
    // it". Symmetric, so the centre — and therefore which point lands in the
    // middle of the viewport — is untouched.
    const padX = rect.w * STEP_FOCUS_CONTEXT;
    const padY = rect.h * STEP_FOCUS_CONTEXT;
    return fitTransform(
        { x: rect.x - padX, y: rect.y - padY,
          w: rect.w + 2 * padX, h: rect.h + 2 * padY },
        size, kBase, null, kFloor);
}

// ── THE STEP FIT'S CONTEXT MARGIN (req #3297, re-pointed by req #3371) ─────
// The fraction of the step rect's OWN width and height added on each side
// before the fit. It is the difference between "one bead fills the panel" and
// the framing req #3297 asked for — the launch unit comfortably readable with
// the plan still visible around it.
//
// KEPT BY VALUE (0.25) WHEN ITS SUBJECT CHANGED (req #3371). It used to inflate
// the dashed multi-step launch rectangle; in 2.0 the STEP is the launch unit,
// so the constant follows the unit rather than dying with the drawing. The
// framing argument is identical whatever the unit: "read it IN its plan, not
// extracted from it".
//
// Proportional, and symmetric, for two reasons that are worth keeping straight:
//
//   · SYMMETRIC means it cannot change WHICH POINT ends up at the centre of the
//     viewport. The inflated rect has the same centre as the bare one, so the
//     step stays framed on exactly the same spot whatever this number is. The
//     only thing it can change is `k` — and then, necessarily, the translation
//     that carries that centre at the new scale; the claim is about the framing,
//     not about the two numbers. And it changes `k` only when the fit — rather
//     than the `FOCUS_MAX_RATIO` ceiling — is what binds.
//   · ON A SINGLE STEP THE CEILING USUALLY BINDS AND THIS CONSTANT IS INERT.
//     The generous whitespace around a one-bead fit is `FOCUS_MAX_RATIO`,
//     exactly as it is for a one-step epic, and NOT this number. Do not tune
//     this expecting the ordinary case to move; it will not. That ceiling is
//     why a step small enough to want k=8 still lands at 2.6 x the readable
//     default.
//
// A world-space constant would have been wrong on both counts: a fixed number
// of world px is a different fraction of every rect, and on the smallest rect —
// the one that most wants air — it is the smallest fraction of all.
export const STEP_FOCUS_CONTEXT = 0.25;

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
    // Its height is `RULER_H · k` — a WORLD height, so unlike the two pads
    // above it moves with the scale this function is solving for. That is
    // circular only if you iterate: `rect.h · k ≤ h − padTop(k) − padBottom`
    // with `padTop(k) = FOCUS_PAD + labelTop + RULER_H · k` is linear in k, and
    // rearranges to the closed form below — the ruler simply joins the rect on
    // the fitted side of the inequality.
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
    const kFit = Math.min(availW / rect.w, availH / (rect.h + rulerTop));
    const k = Math.min(Math.max(kFit, kFloor), kBase * FOCUS_MAX_RATIO);
    // The reserve at the scale actually chosen. `k` may be well below `kFit`
    // (the width bound), or above it (the FOCUS_MIN_RATIO floor), so these are
    // re-read from `k` rather than assumed to be what the fit solved for.
    const padTop = FOCUS_PAD + labelTop + rulerTop * k;
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
