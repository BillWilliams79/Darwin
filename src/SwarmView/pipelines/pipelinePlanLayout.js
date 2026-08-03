// pipelinePlanLayout.js — pure geometry for the Plan visualizer (req #3115),
// the product form of the POC viz-generate.py Plan mode archived in req #3080.
//
// PURE LOGIC ONLY: engine PlanRows + LaunchBatches in, world-space geometry out.
// No React, no Konva, no DOM text measurement — widths come from a fixed
// monospace character metric so the zero-overlap guarantee is decidable here and
// testable in vitest without a canvas (the konvaSwarmModel.js separation).
//
// The layout language (POC, kept verbatim unless noted):
//   - Epic bands stacked vertically, one per DOMINANT epic (design rule 10), in
//     DERIVED-START order since req #3201: earliest-starting epic on top,
//     never-started epics last, epic id ascending as the tie-break. (Was
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
//   - Launch-batch dashed boxes around batch-mates (identical epic + remaining
//     gate + run + machines — the engine's launchKey), drawn as ONE SEGMENT PER
//     (BAND, COLUMN). Both axes matter and for different reasons. Since req
//     #3188 the key carries the dominant epic — the same field these bands are
//     keyed on — so an ENGINE-PRODUCED box always sits in exactly one BAND; that
//     segmentation stays as a tested defence, because this module takes rows and
//     batches as arguments and cannot know they were derived together. The
//     COLUMN axis is the live one: #3188 also keys on the REMAINING gate, so a
//     step gated by an already-Complete dep and a gate-less step are one launch
//     unit at different dependency depths. A rect spanning either axis would
//     enclose a non-member, which is the review finding this shape exists for.
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
    batch: '#4ad9c8',
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
// vocabulary with one home and the on-screen key (PipelinePlanVisualizer's
// `PlanKey`) is a rendering of it rather than a second, hand-maintained list.
//
// ── The channels, and the ONE rule that keeps them apart ───────────────────
//
// | Channel                | Encodes                                   | Level       |
// |------------------------|-------------------------------------------|-------------|
// | bead FILL              | derived step state (rule 1)               | STEP        |
// | bead RING              | run mode — magenta = manual               | STEP        |
// | outer HALO (dashed)    | eligible now — "next up"                  | STEP        |
// | requirement-id TEXT    | the ACTIVE colour key: requirement status | REQUIREMENT |
// |                        | · machine pin · nothing                    |             |
// | epic BAND tint/stroke  | which epic — identity, not status         | EPIC        |
// | batch BOX (dashed teal)| one `/swarm-start` launches these         | LAUNCH UNIT |
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

// ── Requirement-id scale 1 of 2: REQUIREMENT STATUS (the 'state' key) ──────
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

// ── Requirement-id scale 2 of 2: MACHINE (the 'machine' key) ───────────────
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

// ── The colour key is TRI-STATE (req #3168, user directive 2026-08-01) ──────
// `state` · `machine` · `none`. The third is not a third BUTTON — MUI's
// exclusive ToggleButtonGroup already fires `onChange(_, null)` when the
// selected button is clicked again, and the old handlers (`v && setPref(v)`)
// swallowed exactly that event. Making the deselection MEAN something is one
// line at the call site and costs the toolbar no width, which matters on a row
// that already carries four toggle groups.
//
// The gesture the directive names: State selected → click Machine → machine
// colouring → click Machine again → NO colouring, every id neutral.
//
// `none` paints `PLAN_VIZ_PALETTE.text` (near-white) and there is no light-mode
// branch, because THIS PANEL HAS NO LIGHT MODE: `PLAN_VIZ_PALETTE` is a fixed
// dark palette and the container's background is `P.panel` (#111b2b) in both app
// themes by design (see PipelinePlanVisualizer's header — "the directive is to
// keep THIS page's look"). A theme branch here could never fire, so writing one
// would be dead code claiming to handle a case that does not exist.
// ── How WIDE the on-screen key may be, and why the cap is on width ─────────
// The key's measured rect is the keep-out `placeEpicChips` resolves the epic
// names against, and the resolution is HORIZONTAL ONLY by design — moving a
// chip vertically would put it on another band's line, which is a wrong label
// rather than a missing one.
//
// SINCE req #3257 that resolution is a CLIP-OR-DROP, not a displacement: an
// epic name is pinned to its own band's rectangle and may not slide sideways
// out of it, so the width that would run under the key is cut off and a chip
// with less than a few characters left is dropped outright.
//
// **THE OLD INVARIANT — "the key's WIDTH is its entire cost; its HEIGHT is
// free" — IS FALSE UNDER THAT RULE AND IS NOT CARRIED FORWARD.** It was a
// property of the displacement pass: a chip that met the key slid sideways and
// still drew, so a taller key only changed WHICH chips moved. With nowhere to
// slide, a taller key exposes more band rows to the keep-out and those chips
// are lost.
//
// **AND THE KEY MOVED.** Req #3255 put it at BOTTOM-CENTER, which changed both
// the magnitude and which axis is steeper. RE-MEASURED 2026-08-02 on the
// Substrate fixture (1500×900 panel) over k ∈ {0.2 … 2} × 4 pans × 29
// x-offsets, 1566 chips drawn with no key, against the CURRENT bottom-center
// geometry:
//
//   at w=470   height    30    60   100   140   180
//              dropped   11    22    44    55    77
//
//   at h=30    width     90   300   420   470   600   900  1100
//              dropped    3     7    10    11    13    19    23
//
// Two consequences, both the reverse of the top-right era:
//
//   1. THE MOVE MADE THE KEY ~17× CHEAPER (187 → 11 dropped at 470×30). A name
//      is pinned to its band's LEFT edge, and a bottom-center box is no longer
//      where those names land.
//   2. HEIGHT IS NOW THE STEEPER AXIS — 66 names across the height range against
//      20 across the width range — because a bottom-anchored box grows UPWARD
//      into more band rows while its width only spans the panel's middle.
//
// So `PLAN_KEY_MAX_W` now caps the CHEAPER dimension. Not a regression — the
// cap predates the move and the key is far cheaper overall — but it is no
// longer the defence it was named for, and a bottom-center key's honest guard
// would be on HEIGHT. Recorded here rather than silently re-asserted; changing
// the cap belongs to req #3255's surface. Every number above is asserted in
// `pipelinePlanLayout.test.js` (monotone in each dimension, height strictly
// steeper than width, and the move strictly cheaper than the top-right key), so
// they are measured rather than remembered — and the inversion fails loudly if
// the key moves again.
//
// RAISED TO 470 on the user's directive (2026-08-01): "make the key wide enough
// to fit the whole row of requirement statuses… the word requirement on one line
// and then all the statuses on the next with their colors". The seven status
// names are 57 mono characters at 10.5px bold — ~359px — plus six 8px gaps and
// the box's own 16px of padding, i.e. ~423px. At 420 that row clips; 470 fits it
// with headroom for a longer status set.
//
// RE-MEASURED before raising it, because the table above was taken on the
// pre-retune world and the 2026-08-01 width retune (+10%/+10%/+20%) made every
// column wider and the world with it. On the CURRENT geometry, over
// k ∈ {0.2…2} × 4 pans × 6 x-offsets: the key costs 9 chips at 420 — and the
// SAME 9 at 440, 460, 480, 500, 540 and 580. The width→loss curve is flat across
// that band now, so this raise costs nothing; it is the SHAPE (tall and narrow,
// one row per channel) that still matters, and a percentage width — the thing
// this constant replaced — would still be the failure.
//
// The cap is enforced in the component's `sx` and swept in
// pipelinePlanLayout.test.js from this constant, so the two cannot drift.
export const PLAN_KEY_MAX_W = 470;

export const COLOR_KEY_LABELS = {
    state: 'Requirement status',
    machine: 'Machine',
    none: 'No colour key — ids neutral',
};
export const DEFAULT_COLOR_KEY = 'state';
// `Object.hasOwn` again, and for the ORIGINAL reason (`isStepWidth`): this value
// is read straight out of localStorage, so "constructor" and "toString" are both
// reachable strings that resolve to inherited functions.
export const isColorKey = (v) => Object.hasOwn(COLOR_KEY_LABELS, v);
export const normalizeColorKey = (v) => (isColorKey(v) ? v : DEFAULT_COLOR_KEY);

/**
 * The requirement-id text style for the active colour key. ONE resolver, so the
 * canvas and the on-screen key can never disagree about what a colour means.
 *
 * Bold in BOTH coloured keys and regular in `none`: weight is the "this channel
 * is carrying a signal" affordance, and it costs the zero-overlap contract
 * nothing because the ids are set in a MONOSPACE face, whose advance width is
 * weight-invariant — which is why `CHW_REQ` stays one number.
 *
 * @param {Object} args
 * @param {('state'|'machine'|'none')} args.colorKey
 * @param {?string} [args.status]        requirement_status, for the 'state' key
 * @param {?string} [args.machineColor]  resolved machine colour, for 'machine'
 * @returns {{fill: string, bold: boolean}}
 */
export function reqIdStyle({ colorKey, status, machineColor } = {}) {
    const key = normalizeColorKey(colorKey);
    if (key === 'machine') return { fill: machineColor || MACHINE_ANY_COLOR, bold: true };
    if (key === 'state') return { fill: reqStatusColor(status), bold: true };
    return { fill: PLAN_VIZ_PALETTE.text, bold: false };
}

/**
 * The key entries for the requirement-id channel under the active colour key.
 *
 * For `state` it lists only the statuses the plan actually contains — the same
 * discipline the machine key already follows, and the reason the key stays
 * compact enough not to steal the viewport middle-bottom (req #3255; was the
 * top-right corner) from the epic chips.
 *
 * @param {Object} args
 * @param {('state'|'machine'|'none')} args.colorKey
 * @param {Iterable<?string>} [args.statuses]  every linked requirement's status
 * @param {Object[]} [args.machineLegend]      buildMachineColorView().legend
 * @returns {{title: string, entries: Object[]}}
 */
export function reqIdKeyEntries({ colorKey, statuses = [], machineLegend = [] } = {}) {
    const key = normalizeColorKey(colorKey);
    if (key === 'machine') {
        return { title: 'Requirement id = machine', entries: machineLegend };
    }
    if (key === 'none') {
        return {
            title: 'Requirement id',
            entries: [{ key: 'none', color: PLAN_VIZ_PALETTE.text, label: 'no colour key' }],
        };
    }
    const present = new Set();
    let unknown = false;
    for (const s of statuses) {
        if (Object.hasOwn(REQ_STATUS_COLORS, s)) present.add(s);
        else unknown = true;
    }
    const entries = REQ_STATUS_ORDER.filter((s) => present.has(s))
        .map((s) => ({ key: s, color: REQ_STATUS_COLORS[s], label: s.replace('_', '-') }));
    if (unknown) {
        entries.push({ key: 'unknown', color: REQ_STATUS_UNKNOWN_COLOR, label: 'unknown' });
    }
    return { title: 'Requirement id = status', entries };
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
// 34-step fixture at 1280x720 that is k = 0.354-0.373, i.e. BELOW 0.39. What
// makes the collision unreachable there is a DIFFERENT fact, and it is stated
// rather than left implied: below `K_READABLE` no step label is drawn at all,
// so there is nothing for the epic name to overlap. **That makes `K_READABLE`
// load-bearing for this reservation** — lowering it would put drawn step labels
// under a chip at the very scale a plan opens in. The scaling below is what
// keeps the guarantee absolute either way: under the threshold — deep zoom-out,
// where the strip is genuinely shorter on screen than the chip —
// `placeEpicChips` SCALES the chip down to its lane rather than overflowing it
// or dropping it, so it holds at every k rather than over a range.
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
// batch-hosting and staggered bands identically.
export const BEAD_LANE_OFFSET = 10;
const BATCH_HEADER_EXTRA = 16;  // extra header for bands hosting batch members:
                                // reserves the letter strip + keeps box tops
                                // below the epic label (review finding)
// The batch letter's own rect (req #3256). How far above its box the letter may
// be displaced looking for clear space is NOT a constant — see the search
// itself: the room above a box is one lane pitch, and a lane pitch grows with
// the requirement stack its lane carries (req #3119), so any fixed window is
// beaten by a lane with one more requirement than the number it was tuned
// against. Measured: a 96px window held to 3 requirements and fell back to the
// header strip — a 455px leader — at 4.
const BATCH_LETTER_H = 11;
const BATCH_LETTER_GAP = 3;
// Under this the letter is the box's caption and a drop-line would be noise;
// over it something else sits between the two and the line is what keeps them
// one thing.
const BATCH_LETTER_LEADER_MIN = 20;
// The launch-unit box's own geometry, relative to the beads it encloses: how
// far it insets from its column, its width floor, and how far above/below a
// bead centre its edges sit. Named because the NEXT-STEP HALO's ceiling is the
// SMALLEST of these clearances (req #3271) — a halo that grew past one would
// leave the box that says "one /swarm-start launches these", at exactly the
// zoom level a launch unit is read at.
const BATCH_BOX_INSET = 8;
const BATCH_BOX_MIN_W = 56;
const BATCH_BOX_RISE = 40;      // above the bead centre
const BATCH_BOX_DROP_V = 28;    // below it, 'vertical' reqs — the TIGHTEST edge
const BATCH_BOX_DROP_H = 30;    // below it, 'horizontal' reqs
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
// staggered-column vertical offset (`reqStaggerOf`), which is what was
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
// stack on top of this and never subtracts. Named because two separate proofs
// read it — the batch-letter sweep's band-scoping argument, and the next-step
// halo's band-rectangle clearance (req #3271).
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
    label: 16.5, req: 13.75, title: 9.5, epic: 15, batch: 10, check: 9, slot: 13,
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
 * reader could actually use them. A kind is drawn only when both agree.
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
 * THE LEVEL LADDER, AS ONE PREDICATE — is this label kind drawn (req #3221,
 * absolute half added by req #3280)?
 *
 * IT LIVES HERE RATHER THAN IN THE RENDERER because the halo's whole guarantee
 * is a relationship between this answer and `nextHaloMagnify`'s: a magnified
 * halo reaches past the 14-world-px box a step label and the first requirement
 * id sit in, so it may only grow where they are not drawn. While the predicate
 * was three lines inside the component and the magnification was a function in
 * this module, NOTHING COULD ASSERT THE PAIR — the component's own test would
 * have had to rasterise a canvas to see it, which is precisely why the
 * component publishes `data-drawn` at all. With both here, one sweep over
 * (kind × level × k) proves it, and deleting the legibility condition reddens
 * that sweep instead of shipping.
 *
 * Two conditions, and a kind is drawn only when both hold:
 *   · the LEVEL — what this view is for. 'out' carries no per-step detail;
 *     the title slot is 'in' only.
 *   · LEGIBILITY — whether the reader could use it (`labelsLegible`). ONE
 *     threshold for all three kinds, not one per font: `K_READABLE` is derived
 *     from the SMALLEST of them, so a scale that keeps the requirement ids
 *     legible keeps the step name and the title slot legible too — and three
 *     per-font thresholds would be three scales at which the halo's
 *     magnification has to stop, where it can only stop at one.
 *
 * `true` for everything else, and that fallback is load-bearing rather than a
 * default nobody reaches: the ruler's slot ticks, the launch-unit letters and
 * the epic band names are drawn at every level and are not gated at all.
 *
 * This is DRAW-ONLY. `computePlanLayout` reserves every label's rect at every
 * level regardless — the zero-overlap invariant is asserted against it
 * unconditionally — so a kind going dark never moves anything else.
 */
export function drawsLabelKind(kind, level, k) {
    if (kind === 'step' || kind === 'req') return level !== 'out' && labelsLegible(k);
    if (kind === 'title') return level === 'in' && labelsLegible(k);
    return true;
}

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
 * @param {Object[]} batches   engine LaunchBatch[] (launchBatches output)
 * @param {Object} [opts]
 * @param {('horizontal'|'vertical')} [opts.reqLayout]
 * @param {('id'|'title')} [opts.reqLabel]   what the marks UNDER a bead say
 * @param {(Map|Object)} [opts.reqTitles]    requirement id -> title, for 'title'
 * @param {('id'|'title')} [opts.stepLabel]
 * @param {('compact'|'medium'|'wide')} [opts.stepWidth]
 * @param {?Object} [opts.timeAxis]  planTimeAxis() output (req #3201). Omitted,
 *                             the axis degenerates to pure dependency depth and
 *                             bands stack by epic id — see computeTimeColumns.
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
export function computePlanLayout(rows, batches, {
    reqLayout = 'horizontal', stepLabel = 'id', stepWidth = DEFAULT_STEP_WIDTH,
    reqLabel = 'id', reqTitles = null, timeAxis = null, epicCounts = null,
    pauseInfo = null,
} = {}) {
    const safeRows = Array.isArray(rows) ? rows : [];
    const safeBatches = Array.isArray(batches) ? batches : [];
    const widthFactor = stepWidthFactor(stepWidth);
    if (safeRows.length === 0) {
        return {
            width: MIN_WORLD_W, height: 120, bands: [], nodes: new Map(),
            arcs: [], batchBoxes: [], labels: [], colW: [], colX: [],
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
    //    2026-08-01) ──────────────────────────────────────────────────────────
    // A requirement TITLE is ~17 characters where an id was 4, and the column is
    // frozen — so a title is boxed by its own slab and there is nothing left to
    // give it. The step label above the bead solved exactly this problem in req
    // #3119 and the answer is reusable: give ODD COLUMNS their own line, so a
    // mark and its left/right neighbours are never drawn at the same height, and
    // each may then overflow its own column into the room beside it.
    //
    // The user's phrasing — "separate the titles vertically by nearest
    // neighbours, then alternate heights in sequences of 1 req per step" — names
    // both halves of what makes this sound:
    //
    //   · SEPARATE BY NEAREST NEIGHBOUR. The offset is applied to EVERY req block
    //     in this mode, not only the widened ones. Offsetting just the wide ones
    //     leaves a widened single title on line 0 beside a stacked block that
    //     also starts on line 0, and the reach lands straight on it.
    //   · ALTERNATE IN SEQUENCES OF 1 REQ PER STEP. Only a step with exactly ONE
    //     requirement is widened. A stack of N marks occupies N consecutive
    //     lines, so two adjacent stacks overlap on N−1 of them however they are
    //     offset — parity separates a stack from a stack for one line only. A
    //     1-mark block is the only one whose parity offset is a complete
    //     separation, so it is the only one allowed to spend the extra room.
    //
    // What that leaves is the same pairwise proof the step labels already carry:
    // only SAME-parity columns (d±2) share a line, they intrude on the shared
    // column d±1 from opposite sides, and STAGGER_REACH 0.4 per side cannot meet.
    // A widened mark beside a column-contained one is safe for the same reason —
    // the contained one never leaves its slab and the reach is under half of it.
    const staggerReqs = reqLabel === 'title' && reqLayout !== 'horizontal';
    const reqStaggerOf = (d) => (staggerReqs ? (d % 2) * REQ_LINE_H : 0);
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

    // ── Epic bands (dominant label), stacked by DERIVED START (req #3201) ───
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

    const bandKeys = [];
    const bandByKey = new Map();
    for (const r of safeRows) {
        const key = r.epicId != null ? r.epicId : null;
        if (!bandByKey.has(key)) {
            const epic = r.epic || 'No epic';
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

    // Batch letters, for adjacency inside a band (a box must never enclose a
    // non-member — POC sorted batch-mates together within the band).
    const batchOf = new Map();
    for (const b of safeBatches) {
        for (const id of b.stepIds || []) batchOf.set(id, b.letter);
    }

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
        const steps = [...band.steps].sort((a, b) =>
            (colOf.get(a.id) - colOf.get(b.id)) ||
            ((batchOf.has(a.id) ? 0 : 1) - (batchOf.has(b.id) ? 0 : 1)) ||
            String(batchOf.get(a.id) || '').localeCompare(String(batchOf.get(b.id) || '')));
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
        // A batch RUN, as a raw-lane interval at one column — the box invariant's
        // half of the bookkeeping (req #3229). `batchBoxes` draws one rect per
        // (band, column) segment spanning its members' lanes, so the rect
        // encloses a FOREIGN bead the moment any non-member's lane falls
        // strictly between two mates' lanes at that column. Contiguity at
        // allocation time does NOT establish that, because `start + k` is
        // integer arithmetic over a lane space that is FRACTIONAL until the
        // ordinal renumber at band close: the dep-adjacent insertion path mints
        // `(al + below) / 2`, batched steps sort ahead of unbatched ones within
        // a column, and `{0, 0.5, 1}` renumbers to `{0, 1, 2}` — a non-member
        // ordinally between two mates that were adjacent when allocated. Five
        // steps reproduce it, so this was never a fuzz-only shape.
        //
        // This half stops a LATER step entering a published run. The other half
        // — stopping a run being allocated AROUND a bead already sitting inside
        // it — is `interiorClear` at the allocation site, and BOTH are needed.
        const runIntervals = new Map(); // depth -> [{letter, lo, hi}]
        // The run (of ANOTHER letter) that `lane` falls strictly inside, if any.
        const enclosingRun = (d, lane, letter) =>
            (runIntervals.get(d) || []).find((x) =>
                x.letter !== letter && lane > x.lo && lane < x.hi);
        // …AT ANY COLUMN — because a run's interval is a claim on the BAND'S
        // LANE VALUES, not only on its own column's cells (req #3256).
        //
        // The per-column form above answers the CELL question: is a foreign bead
        // about to land between two mates in the column the box is drawn in. That
        // is what req #3229 needed and it is not the whole box. The ordinal
        // renumber at band close sorts every value the BAND assigned, so a value
        // taken at ANY column that falls strictly inside a published interval
        // becomes a whole lane row between two mates. The box then encloses no
        // foreign bead — the occupant is a column away — and still spans a DEAD
        // ROW, which is precisely the shape req #3256 was filed against: measured
        // on the live plan, batch A on lanes 7/9/10/11 with an empty row at 8
        // whose only occupant, step 120, sat one column to the left. Measured on
        // the 400-plan corpus with the per-column claim alone: 1084 of 3848 boxes
        // spanned a row no member occupies, all of them this case.
        const enclosingRunAnyColumn = (lane, letter) => {
            for (const list of runIntervals.values()) {
                const hit = list.find((x) =>
                    x.letter !== letter && lane > x.lo && lane < x.hi);
                if (hit) return hit;
            }
            return undefined;
        };
        // A lane is usable only if (1) the cell is free, (2) it is not inside
        // another batch's run at this column (req #3229 — `runIntervals` above;
        // own-letter mates are exempt, they ARE the run), (3) every same-lane
        // dependency arc into it crosses only in-chain beads, and (4) — the
        // corridor-aware rule (user directive, epic #6 plan) — no shallower
        // bead already on the lane still owes an arc PAST this column to a
        // deeper same-band dependent: parking here would sit this bead on that
        // arc's horizontal run (the 50-under-49 spaghetti). Exempt when the
        // shallower bead is one of r's own deps (r continues that chain — the
        // arc anchors elsewhere or reroutes) or when r is in-chain between the
        // two ends.
        const laneOk = (r, d, lane) => {
            if (!free(d, lane)) return false;
            if (enclosingRunAnyColumn(lane, batchOf.get(r.id))) return false;
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
        // Same-band batch-mates take a CONTIGUOUS RUN of lanes, allocated when
        // the first mate places: the lowest run of members.length lanes that
        // all pass laneOk (dep-anchored candidates first, so a gate on this
        // band's lane keeps its straight arc when possible). (Review found the
        // earlier next-free-lane packing letting mates spread around an occupied
        // lane, boxing unrelated steps in ~15% of multi-batch plans.)
        //
        // A CONTIGUOUS RUN IS NOT ON ITS OWN THE BOX INVARIANT, and this comment
        // used to claim it was — "a batch box therefore encloses exactly its
        // members" was here, in the present tense, through two review rounds
        // while being measurably false. Contiguity holds in RAW lane values; the
        // box is drawn from ORDINALS. Making the box invariant true takes the
        // run plus `runIntervals` plus `interiorClear`, all three, each for a
        // different way a foreign bead gets between two mates.
        //
        // THE RUN IS PER (BAND, COLUMN), NOT PER BAND — req #3229, and the
        // difference is a bead drawn on top of another bead. The run used to be
        // allocated once per letter per band and handed out to every mate
        // wherever it landed, on two safety arguments that req #3188 falsified
        // when it regrouped batches on the REMAINING gate instead of a shared
        // dep set, so mates legitimately sit at different DEPTHS:
        //
        //   1. "the pre-check holds for every mate" — it ran `laneOk` at the
        //      FIRST mate's column. A mate two columns deeper consumed a lane
        //      nothing had checked there.
        //   2. "the sort keeps mates consecutive" — the sort is COLUMN first,
        //      so mates of one letter are consecutive only WITHIN a column. A
        //      whole second batch's run was allocated in between.
        //
        // Measured (fuzz seed 115, `timedFuzzPlans.js`): batch A's four-lane run
        // was allocated at column 0, batch B's two-lane run at column 0 starting
        // one lane below it, and at column 2 A's mate 13 and B's mate 11 both
        // resolved to lane 3. `take()` is a deliberate no-op on an occupied
        // cell, so the second bead was swallowed in silence. Reproduced with AND
        // without a time axis — the axis changes which plans reach this, never
        // whether the path is sound.
        //
        // Keying the run on `letter|column` makes BOTH arguments true as
        // written: the pre-check runs at the column the lanes are consumed in,
        // it checks each ACTUAL mate rather than assuming a shared dep set, and
        // within one column same-letter mates ARE consecutive in the sort, so
        // nothing places between the check and the last mate.
        //
        // THAT IS THE CELL INVARIANT ONLY. The BOX invariant needs `runIntervals`
        // above and does not follow from per-column allocation — allocating
        // `start + k` leaves the run contiguous in RAW values, and the ordinal
        // renumber at band close can still slide a later fractional lane between
        // two mates. Reviewing this change measured it going the wrong way: 38
        // enclosed non-members over the corpus before, 32 after, with new
        // instances at seeds 212 and 363 where a fractional dep-anchored `start`
        // (which per-column allocation reaches far more often, deep columns
        // being where fractional lanes live) bracketed an unrelated bead.
        // With `runIntervals` AND `interiorClear`: 0 enclosed non-members over
        // 40,000 layouts (20,000 generator seeds × axis on/off). `runIntervals`
        // alone was 0 over the 400-plan corpus but still 7 at that scale — the
        // scope on a measurement is part of the measurement.
        const batchRunNext = new Map(); // `letter|column` -> next lane in that run
        for (const r of steps) {
            const d = colOf.get(r.id);
            const letter = batchOf.get(r.id);
            let lane = null;
            if (letter !== undefined) {
                const runKey = `${letter}|${d}`;
                if (!batchRunNext.has(runKey)) {
                    // This column's mates, in the order they will place — the
                    // sort above is stable and column-major, so `steps` filtered
                    // this way IS that order.
                    const mates = steps.filter((s) => batchOf.get(s.id) === letter
                        && colOf.get(s.id) === d);
                    const mateIds = new Set(mates.map((m) => m.id));
                    // THE RUN'S INTERIOR, not just its n lanes. `runIntervals`
                    // stops a later step entering a published run; this stops a
                    // run being allocated AROUND a bead that is already there,
                    // which is the same box defect approached from the other
                    // side. Checking `start + k` alone cannot see it: with an
                    // INTEGER start the interior integers are the mates' own
                    // lanes and nothing foreign can sit between them, but a
                    // dep-anchored `start` is routinely FRACTIONAL, and then an
                    // occupant at some other fraction inside `(start, hi)` is
                    // examined by nothing — `free()` only ever looks at the
                    // endpoints, and `enclosingRun` cannot help because the
                    // interval does not exist yet. Nine steps reproduce it
                    // (see the box tests); measured, it also survived at 7
                    // cases per 40,000 layouts, none inside the 400-plan
                    // corpus. Reserved corridor cells are NOT occupants here —
                    // an arc running through the box crosses no bead.
                    //
                    // WHICH COLUMN THE OCCUPANT SITS IN DOES NOT MATTER (req
                    // #3256). Asking `occupant(d, v)` asks the CELL question —
                    // would this box enclose a foreign bead — and a value used
                    // one column over answers "no" while still becoming a lane
                    // ROW between two mates at the band-wide renumber. That
                    // leaves the box enclosing nothing and spanning a dead row,
                    // and it is the commonest shape of this defect: measured on
                    // the 400-plan corpus, 1084 of 3848 boxes. So a value
                    // strictly inside the run that is not one of the run's own
                    // lanes disqualifies `start`, whatever column assigned it.
                    const mateLanes = (start) =>
                        new Set(mates.map((_, k) => start + k));
                    const interiorClear = (start) => {
                        const hi = start + mates.length - 1;
                        const own = mateLanes(start);
                        for (const v of lanesUsed) {
                            if (!(v > start && v < hi)) continue;
                            if (!own.has(v)) return false;
                            const o = occupant(d, v);
                            if (o !== undefined && o !== RESERVED && !mateIds.has(o)) {
                                return false;
                            }
                        }
                        return true;
                    };
                    const runOk = (start) => interiorClear(start)
                        && mates.every((m, k) => laneOk(m, d, start + k));
                    let start = null;
                    for (const a of sameEpicDepsOf(r)) {
                        const al = laneById.get(a.id);
                        if (al !== undefined && runOk(al)) { start = al; break; }
                    }
                    if (start === null) {
                        start = 0;
                        while (!runOk(start)) start += 1;
                    }
                    batchRunNext.set(runKey, start);
                    // Publish the interval so nothing else lands inside it —
                    // see `runIntervals`. A one-mate segment spans no gap.
                    if (mates.length > 1) {
                        if (!runIntervals.has(d)) runIntervals.set(d, []);
                        runIntervals.get(d).push(
                            { letter, lo: start, hi: start + mates.length - 1 });
                    }
                }
                lane = batchRunNext.get(runKey);
                batchRunNext.set(runKey, lane + 1);
            } else {
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
                    // corpus reaches it, before or after the batch-run fix
                    // above, so it is hardening rather than a measured repro.
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
                    // This is the ONE path that bypasses `laneOk`, so it also
                    // has to honour `runIntervals` itself. A midpoint can only
                    // fall inside a run when the ANCHOR does — nothing is used
                    // strictly between `al` and `below`, so a run bracketing the
                    // midpoint must have `lo <= al`. Re-anchoring below that
                    // run's last mate and retrying therefore terminates: the
                    // anchor moves strictly upward through distinct run ends,
                    // and there are finitely many runs in this band.
                    //
                    // It honours them at EVERY column (req #3256), because this
                    // is the path that opens a fresh FRACTIONAL value and the
                    // renumber that turns one into a lane row is band-wide. A
                    // step here is a non-member by construction, so no interval
                    // is exempt.
                    const anchors = sameEpicDepsOf(r)
                        .map((a) => laneById.get(a.id))
                        .filter((v) => v !== undefined);
                    if (anchors.length > 0) {
                        let al = Math.min(...anchors);
                        for (;;) {
                            const below = [...lanesUsed]
                                .filter((v) => v > al)
                                .sort((p, q) => p - q)[0];
                            lane = below === undefined ? al + 1 : (al + below) / 2;
                            const run = enclosingRunAnyColumn(lane, letter);
                            if (!run) break;
                            al = run.hi;
                        }
                    } else {
                        lane = 0;
                        while (!laneOk(r, d, lane)) lane += 1;
                    }
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
        const laneReqs = new Map();
        for (const r of steps) {
            const lane = laneById.get(r.id);
            const n = (r.reqIds || []).length;
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
        // Bands hosting batch members take a taller header: it reserves the
        // batch-letter strip (below the epic label, above lane 0's step label)
        // and keeps the box top clear of the epic label — found in review as an
        // epic-label × batch-label collision on long epic titles. Since req
        // #3256 the letter normally rides its own box and the strip is its
        // FALLBACK, but a lane-0 box's top still lands inside this header and
        // the strip is still what guarantees the fallback somewhere legal to
        // go, so the reservation is unchanged.
        // The header also absorbs the stagger, but ONLY in title mode: lane 0's
        // step label is what gets LIFTED on odd columns (req #3119), and without
        // the extra line it rises into the epic label — and, in a band hosting a
        // batch, into the batch letter strip. Both collisions were caught by the
        // overlap invariant. In id mode nothing above the bead moves (the title
        // slot staggers DOWNWARD instead), so charging the header there would be
        // 14px of dead space per band in the default view.
        const headerH = BAND_HEADER + (staggerLabels ? STAGGER_GAP : 0)
            + (steps.some((r) => batchOf.has(r.id)) ? BATCH_HEADER_EXTRA : 0);
        // The EPIC'S OWN LANE: the part of the header no step content can reach.
        // Derived, never assumed — see BAND_HEADER. Consumers that place the epic
        // name (the visualizer's floating chip) clamp to THIS, not to headerH.
        const epicLaneH = headerH - STEP_LABEL_RISE - (staggerLabels ? STAGGER_GAP : 0);
        bands.push({ ...band, steps, sub, maxReqs, pitch, laneY, laneReqs,
            headerH, epicLaneH });
        bandUsed.push(used);
    }
    // The ruler's reservation, charged ONCE and unconditionally (see RULER_H).
    // Every band, node, arc and batch box is derived from this y, so the whole
    // plan shifts by one constant and nothing below has to know about the strip.
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
            const sameBand = a.bandIndex === b.bandIndex;
            const late = sameBand
                && corridorClear(a.bandIndex, a.lane, a.depth, b.depth, dId, r.id);
            // The arc carried a `bbox` (the convex hull of its own Bézier
            // control points) from req #3210 until req #3257: its ONLY consumer
            // was `collectWorldObstacles`, feeding the sticky epic chips'
            // avoidance pass, and both are gone — an epic name is pinned to its
            // band's rectangle now and draws OVER whatever it crosses. Computed
            // on every arc of every layout, it was dead weight the moment that
            // pass was, so it goes with it rather than waiting to be rediscovered
            // as a field nobody reads.
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

    // ── Launch-batch boxes ─────────────────────────────────────────────────
    // One box SEGMENT per (epic band, column) the batch touches, not one rect:
    // a single rect spanning either axis also encloses whatever unrelated band
    // or column lies between two members (review finding) — a user would read a
    // non-member as launching in the batch. Segments share the letter and the
    // hover payload, so the launch unit stays one visible thing.
    //
    // Since req #3188 an engine-produced batch cannot span BANDS (the launch key
    // and the band key are both the dominant epic); that half is kept as a
    // DEFENCE on an argument this module does not derive — see the module
    // header. The COLUMN half is live and reachable: #3188 keys on the remaining
    // gate, so batch-mates legitimately sit at different dependency depths.
    const batchBoxes = [];
    for (const b of safeBatches) {
        const members = (b.stepIds || []).map((id) => nodes.get(id)).filter(Boolean);
        if (members.length < 2) continue;
        // ONE SEGMENT PER (BAND, COLUMN) — req #3188 made the column half of that
        // load-bearing, and getting it wrong is the SAME defect the band half was
        // built for, on the other axis. Until #3188 batch-mates shared a raw dep
        // set, so they shared a depth, so one column and one x/width for the
        // whole batch was sound. Now they share the REMAINING gate: a step gated
        // by an already-Complete dep and a step with no gate at all are one
        // launch unit at DIFFERENT depths. Measured on the corpus's own
        // `batch-groups-on-remaining-gate` case — batch A is [3, 5, 2] with 3
        // and 5 at depth 0 and 2 at depth 1 — a single-column box left member 2
        // outside it and enclosed the unrelated Complete step 1.
        const byCell = new Map();
        for (const n of members) {
            const cell = `${n.bandIndex}|${n.depth}`;
            if (!byCell.has(cell)) byCell.set(cell, []);
            byCell.get(cell).push(n);
        }
        // Band first, then column: the letter goes on the FIRST segment, and the
        // plan reads top-to-bottom before left-to-right.
        const cells = [...byCell.keys()].sort((p, q) => {
            const [pb, pd] = p.split('|').map(Number);
            const [qb, qd] = q.split('|').map(Number);
            return (pb - qb) || (pd - qd);
        });
        for (const cell of cells) {
            const ms = byCell.get(cell);
            const [bandIndex, depth] = cell.split('|').map(Number);
            const w = Math.max((colW[depth] || 110) - BATCH_BOX_INSET,
                BATCH_BOX_MIN_W);
            const yTop = Math.min(...ms.map((n) => n.y)) - BATCH_BOX_RISE;
            const yBot = Math.max(...ms.map((n) => {
                const row = byId.get(n.id);
                const nReqs = (row.reqIds || []).length;
                // The box must enclose the marks it is drawn around, and in
                // titles mode an odd column's stack starts a line lower.
                return n.y + reqStaggerOf(n.depth) + (reqLayout === 'vertical'
                    ? BATCH_BOX_DROP_V + Math.max(0, nReqs - 1) * REQ_LINE_H
                    : BATCH_BOX_DROP_H);
            }));
            batchBoxes.push({
                letter: b.letter, stepIds: ms.map((n) => n.id),
                batchStepIds: b.stepIds, x: ms[0].x - w / 2, y: yTop,
                width: w, height: yBot - yTop,
                // `(bandIndex, depth)` identifies the segment — the renderer's
                // React key, since `letter` alone stopped being unique per box
                // when a batch acquired more than one segment (req #3188).
                bandIndex, depth,
            });
        }
    }

    // ── Label rectangles — every piece of text the canvas draws, as world
    // boxes, so the zero-overlap invariant is a testable property of THIS
    // module's output rather than a hope about the renderer.
    // How many requirement marks the step occupying (band, lane, depth) draws.
    // An empty cell, or one holding only a reserved arc corridor, is 0 — nothing
    // is drawn there, so nothing can be collided with. Reads the SAME cell map
    // the lane placement built, so "who is my neighbour on this lane" has one
    // answer in this module rather than a second index that can drift from it.
    const laneNeighbourMarks = (bandIndex, lane, d) => {
        const occ = bandUsed[bandIndex]?.get(d)?.get(lane);
        if (occ === undefined || occ === RESERVED) return 0;
        return (byId.get(occ)?.reqIds || []).length;
    };

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
        // A SINGLE staggered title spends the stagger budget — its own column
        // plus a bounded reach into each neighbour. Everything else is bounded by
        // its own column exactly as before, so no id anywhere and no stacked
        // block moves by a pixel.
        //
        // AND ONLY INSIDE A RUN OF SINGLE-REQUIREMENT STEPS — which is what "in
        // sequences of 1 req per step" buys, and it is load-bearing rather than
        // decorative. The parity offset moves a block by ONE line, so it clears a
        // neighbour only while that neighbour is one line tall. Measured on the
        // Substrate fixture the moment the run condition was missing: step 1 is a
        // 5-requirement stack at d=0 occupying lines 0–4, and its 1-requirement
        // neighbour step 3 at d=1 — offset by exactly one line — landed on line 1
        // OF THAT STACK, 14px of overlap, at two separate places in the plan.
        //
        // So a title may only spend the extra room when the steps on the same
        // lane to its left and right are themselves at most one mark tall. That
        // is a run of 1-req steps, and inside such a run the alternation is a
        // complete separation.
        const widened = staggerReqs && nMarks === 1
            && laneNeighbourMarks(n.bandIndex, n.lane, n.depth - 1) <= 1
            && laneNeighbourMarks(n.bandIndex, n.lane, n.depth + 1) <= 1;
        const reqRoom = widened ? staggerBudget(n.depth) : colW[n.depth];
        const reqMax = Math.max(1,
            Math.floor((reqRoom - 6 - gaps) / (CHW_REQ * perReq)));
        const showTitles = reqLabel === 'title';
        const reqDy = reqStaggerOf(n.depth);
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
            const band = bands[n.bandIndex];
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
                // step's — so in titles mode it drops by the MAXIMUM parity
                // offset any column can take, never by this column's own.
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
    // how the epic label × batch letter collision got shipped once already.
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
    // ── Batch letters ───────────────────────────────────────────────────────
    // THE LETTER RIDES ITS BOX (req #3256). It used to live in the band's
    // reserved header strip whatever lane the box sat on, with a dashed LEADER
    // dropped from the letter to the box top so the two still read as one
    // thing. That is right for a box on lane 0 and absurd for a box far down a
    // tall band: the reporting screenshot's batch A dropped 689px down an
    // otherwise empty band, and re-measured on the live plan 2026-08-02 batch B
    // still dropped 407px. A hairline crossing several hundred pixels of
    // nothing reads as an empty vertical corridor, not as an association.
    // Anchored a letter-height above its own box top, inside the box's own
    // x-range, it usually needs no line at all.
    //
    // Each of the box's TWO ends is tried, and each is DISPLACED UPWARD past
    // everything already on the canvas in its x-range — labels AND beads, see
    // both below. What is in the way is its own member's step label, which
    // `title` mode LIFTS above the box top on odd columns, and whatever the
    // lane above left in this column: a staggered title slot can sit as little
    // as 6px above a box top. A search rather than a tuned constant because the
    // vertical neighbourhood of a box top is genuinely different in each of the
    // four layout combinations, and a constant clearing all four today is one
    // type-scale change away from being wrong in silence. `labels` already
    // holds every step, requirement, title, ruler and epic rect at this point,
    // and each earlier batch letter as it is pushed — so letters displace off
    // each other too and need no separate stagger.
    //
    // WHERE IT ENDS UP IS BOUNDED BY THE BAND, not by a distance: the ceiling
    // is the band's own reserved letter strip. A box whose column is congested
    // the whole way there falls back to that strip, which the search reaches by
    // itself — see the `best === null` note below for why nothing can actually
    // get there. The strip is free by construction (BATCH_HEADER_EXTRA buys it,
    // below the epic label and above lane 0's step label), so the two review
    // findings it was built for stand untouched.
    //
    // WHAT THIS DOES NOT CLAIM. The worst case is still a long drop-line: 1 of
    // 3848 fuzzed boxes climbs 245px, against the 689px the header placement
    // drew on the live plan and against 0px for every box on the live plan now.
    // The corridor is not abolished — it stops being the normal case.
    //
    // EVERY SEGMENT IS LABELLED, not just the first (req #3188). While a batch
    // could only segment across BANDS — which the engine can no longer produce
    // at all — one letter for the whole batch read as one launch unit stacked
    // vertically. Column segments sit SIDE BY SIDE and are reachable on any plan
    // where mates share only their remaining gate, and an unlabelled dashed box
    // beside a labelled one reads as a second, anonymous batch. Repeating
    // "batch A" is the honest rendering: both boxes ARE batch A.
    // Beads as rects covering EVERYTHING A BEAD OWNS, PER BAND — the sweep
    // below is band-scoped and the memo is what makes that cheap. Scoping is
    // sound because a letter cannot leave its own band (its ceiling is inside
    // it) and the nearest foreign bead is ~103px away: the previous band's
    // deepest bead sits at least `lanePitch − BEAD_LANE_OFFSET` above its band
    // bottom, and `lanePitch` is at least MIN_LANE_PITCH = 94, comfortably more
    // than the bead's own reach plus BEAD_LANE_OFFSET. That inequality is the
    // dependency; if a lane could ever be shorter than a bead, this filter
    // would have to go. THE NUMBER TO BEAT IS 37, NOT 25 — req #3271 widened
    // the rects from the hit circle (15) to the halo's reach (27), so the
    // margin here narrowed from 69 to 57 while the conclusion held.
    const bandBeadRects = new Map();
    const beadRectsOf = (bandIndex) => {
        if (!bandBeadRects.has(bandIndex)) {
            // THE HIT CIRCLE IS NO LONGER THE OUTERMOST THING A BEAD OWNS
            // (req #3271). The next-step halo magnifies at Overview and reaches
            // NEXT_HALO_MAX_OUTER — further than BEAD_HIT_RADIUS — so a search
            // that cleared only the hit circle left the letter inside the ring:
            // measured over the fuzz corpus, 4 letters in 467 sliced by a
            // NEIGHBOURING column's halo. A per-bead entry in
            // NEXT_HALO_CLEARANCES cannot bound that, because the letter belongs
            // to a different column's box — the clearance model that has to
            // widen is this one. `max()` rather than the halo constant alone, so
            // the hit circle still governs if it ever grows past the halo.
            //
            // Read at CALL time, not at module init: `computePlanLayout` runs
            // long after this module is evaluated, so the forward reference to a
            // constant declared below is not a TDZ hazard.
            const reach = Math.max(BEAD_HIT_RADIUS, NEXT_HALO_MAX_OUTER);
            bandBeadRects.set(bandIndex, [...nodes.values()]
                .filter((n) => n.bandIndex === bandIndex)
                .map((n) => ({
                    x: n.x - reach, y: n.y - reach, w: 2 * reach, h: 2 * reach,
                })));
        }
        return bandBeadRects.get(bandIndex);
    };
    for (const box of batchBoxes) {
        const text = `batch ${box.letter}`;
        const w = text.length * 6;
        const band = bands[box.bandIndex];
        // TWO ANCHORS, NEAREST WINS. A column's furniture is centred on the
        // bead — step label, requirement marks, title slot, the bead itself —
        // so the two ends of a box have DIFFERENT vertical profiles, and the
        // letter climbing 300px at one end can often sit 14px above the box at
        // the other. Measured over 3848 fuzzed boxes: with the left end alone,
        // two climbed 245px and 326px — the corridor this requirement exists to
        // remove, just shorter; with both, one climbs 245px and nothing else
        // exceeds 75px, and the right end wins on ~7% of boxes. Both keep the
        // letter inside the box's own x-range, so neither costs the association.
        //
        // Clamped into the box, and de-duplicated: `batchLetter` runs past 'Z'
        // to 'AA' and beyond, so on a minimum-width column the two ends can meet
        // or cross, and an unclamped right anchor would hang off the left of the
        // very box it names.
        const anchorAt = (xx) => Math.max(box.x, Math.min(xx, box.x + box.width - w));
        const anchors = [...new Set([
            anchorAt(box.x + 5), anchorAt(box.x + box.width - 5 - w),
        ])];
        // THE CEILING IS THE BAND'S OWN LETTER STRIP, and nothing narrower. The
        // room above a box is one lane pitch, a lane pitch grows with the
        // requirement stack its lane carries (req #3119), and the marks in that
        // stack can leave no 11px gap at all — so any tighter ceiling is a
        // constant that some plan beats, and beating it means falling back to
        // the band header and the several-hundred-pixel leader this requirement
        // exists to remove. Climbing costs a drop-line; giving up costs the
        // defect back.
        const ceiling = band.y + 26;
        // WHAT THE LETTER MUST CLEAR IS EVERY MARK, NOT EVERY LABEL. A bead is
        // not a label, and leaving it out of this test is not a near-miss: a
        // requirement mark sits `n.y + 14` under its bead, so displacing off one
        // lands the letter's top edge exactly on the bead's CENTRE — measured in
        // review on every congested column, breaking the no-label-on-bead and
        // hit-circle invariants at once and putting the letter's own hover rect
        // over a step's. Beads join the sweep as rects covering the bead's full
        // reach (`BEAD_MARK_RADIUS` — the halo, not just the hit circle, since
        // req #3271), so the search displaces off them exactly as off a label.
        const beadRects = beadRectsOf(box.bandIndex);
        const hits = (r, xx, yy) => r.x < xx + w && xx < r.x + r.w
            && r.y < yy + BATCH_LETTER_H && yy < r.y + r.h;
        const clash = (xx, yy) => labels.find((l) => hits(l, xx, yy))
            || beadRects.find((b) => hits(b, xx, yy));
        let best = null;
        for (const x of anchors) {
            // Strictly decreasing: a clashing rect's own top is always above
            // `y + BATCH_LETTER_H`, so the next candidate is above this one, and
            // `ceiling` bounds the walk. It therefore exits either clear or
            // below the ceiling — never clear-but-untested, which is why the
            // rejection below tests only the ceiling.
            let y = box.y - BATCH_LETTER_H - BATCH_LETTER_GAP;
            for (let hit = clash(x, y); hit && y >= ceiling; hit = clash(x, y)) {
                y = hit.y - BATCH_LETTER_H - BATCH_LETTER_GAP;
            }
            if (y < ceiling) continue;
            // Largest y = smallest climb. Strict, so the left end keeps a tie.
            if (best === null || y > best.y) best = { x, y };
        }
        if (best === null) {
            // THE LAST RESORT, AND IT IS STRUCTURALLY UNREACHABLE. Getting here
            // needs a rect topped above `ceiling + 14` and bottomed below
            // `ceiling` — inside the strip BATCH_HEADER_EXTRA reserves. Every
            // band reaching this loop hosts a batch member, so it carries that
            // extra; the epic label and the ruler ticks end ABOVE the ceiling,
            // and the lowest-topped thing under them is lane 0's step label at
            // `band.y + 78`, identically in both stagger modes (the `+18` in
            // `headerH` cancels the `−18` lift). Measured at review over 1592
            // batch-hosting bands: zero rects in that window, the nearest
            // topping at `band.y + 55` against the 40 required — measured when
            // the bead rects were the hit circle. RE-MEASURED at req #3271's
            // wider rects over the fuzz corpus: still zero fallbacks and an
            // unchanged max climb of 85, with the first fallback appearing only
            // at a rect radius of 60 against the 27 shipped. Kept anyway,
            // because a `best` of null would otherwise be a crash and because
            // the strip is the one place whose freedom is a construction rather
            // than a measurement.
            best = { x: anchors[0], y: ceiling };
        }
        // A leader is drawn only when the letter ended up far enough above its
        // box that something ELSE is between the two — under that it reads as
        // the box's caption and a line would be noise. So the leader stops being
        // the normal case and becomes what it was always for. Its own path is
        // NOT swept: a drop-line may cross a mark the letter climbed past. That
        // is deliberate — a leader that dodged would stop reading as a join —
        // and it is the one piece of geometry here no invariant covers.
        const leaderTo = (lx, ly) => ({
            x1: lx + 4, y1: ly + BATCH_LETTER_H + 1,
            x2: Math.min(Math.max(lx + 4, box.x + 6), box.x + box.width - 6),
            y2: box.y,
        });
        const leader = box.y - (best.y + BATCH_LETTER_H) > BATCH_LETTER_LEADER_MIN
            ? leaderTo(best.x, best.y) : null;
        labels.push({
            kind: 'batch', letter: box.letter, text,
            x: best.x, y: best.y, w, h: BATCH_LETTER_H, leader,
        });
    }

    return {
        width: totalW,
        height: totalH,
        bands: bands.map(({ steps, ...b }) => ({ ...b, stepIds: steps.map((s) => s.id) })),
        nodes,
        arcs,
        batchBoxes,
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
//     chip the panel edge alone would have dropped. See `PLAN_KEY_MAX_W` for what
//     the key costs, re-measured: "the key's height is free" was a property of
//     the displacement pass and is FALSE under clip-or-drop.
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
        // The two FLAT, unscaled reservations: the ↗ control (only rendered when
        // there is an epic to open) and the pause bubble (rendered on every
        // band, "No epic" included). Neither shrinks with the chip, and both are
        // in the measured box before anything is clamped or clipped against it.
        const wFull = bandText.length * charW * scale + EPIC_CHIP_PAD_W * scale
            + (band.epicId != null ? EPIC_CHIP_OPEN_LINK_W : 0)
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
// stronger statement, and the reason it holds on every plan size. `m` is a
// function of `k` ALONE, continuous on each of its three pieces and at both
// joins (`m(0.4) = 2` from either side; `m(K_READABLE) = 1` from either side),
// so where the level ladder happens to put L1/L2 is irrelevant to it. The
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
//    launch-unit box, which is the clearance that actually binds at 28. Kept
//    with its refutation corrected rather than deleted, because this list exists
//    so a future reader does not re-derive a ceiling that was already tried.
//  - "NEVER REACHES ANOTHER BEAD" was the second (3.76×). It cleared beads and
//    crossed everything else — the epic chip's strip at every k below 0.371
//    (which INCLUDES the opening view on a 1200px panel), and its own launch
//    -unit box on all four sides through essentially the whole 'out' band. Both
//    found in review, measured, not hypothetical.
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
// AND ONE PIECE OF FURNITURE IS NOT BOUNDABLE HERE AT ALL: the launch-unit
// LETTER. The letter a halo crosses belongs to a NEIGHBOURING column's box, so
// no per-bead clearance reaches it. It is handled where the stale model was —
// `beadRectsOf` sizes its rects on `max(BEAD_HIT_RADIUS, NEXT_HALO_MAX_OUTER)`.
// Named here because this list advertises itself as the index.
//
// The test for this lives in the halo's own describe block and measures against
// the layout's OUTPUT — batch boxes, chip strips, letters, bead pairs — not
// against the constants below, because measuring against the constants is
// exactly what let two wrong ceilings through review.
export const NEXT_HALO_CLEARANCES = {
    // The launch-unit box, whose four edges are the tightest things a bead has
    // near it. `DROP_V` (28) is the binding one across the whole module.
    batchBoxBelow: BATCH_BOX_DROP_V,
    batchBoxAbove: BATCH_BOX_RISE,
    batchBoxSide: (COL_MIN_W_HORIZONTAL * MIN_STEP_WIDTH_FACTOR
        - BATCH_BOX_INSET) / 2,
    // The epic chip's strip, above a LANE-0 bead. `headerH` cancels out of the
    // derivation, so one number covers batch-hosting and staggered bands too.
    // It describes the chip's RESTING position: `placeEpicChips` pins a chip
    // down into the band body while its band is partly scrolled off, and in that
    // state the chip overlaps beads and halos alike. Pre-existing sticky
    // behaviour, not something a world clearance can promise about.
    epicChipStrip: STEP_LABEL_RISE + BEAD_LANE_OFFSET,
    // The time axis's vertical slot rules, drawn at column LEFT EDGES — so half
    // the tightest column, not the whole pitch. Non-binding today (35.2 against
    // the batch box's 28) and listed because it would bind before the
    // neighbouring bead if this list ever loosened.
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
 * A PURE FUNCTION OF `k`, and that is the fix rather than a tidy-up. #3271 took
 * a second argument — "does this level draw the labels?" — because the halo may
 * only grow into room the labels are not using, and a BOOLEAN bound produces a
 * STEP: the mark halved in one wheel-click at whatever absolute scale the level
 * ladder happened to put the boundary at. Since `labelsLegible` gates the labels
 * on `K_READABLE` and this stops magnifying at `K_READABLE`, the two can no
 * longer disagree, so the argument had nothing left to say. **Labels drawn ⇒
 * `m === 1`** is now an arithmetic consequence, not a contract between two
 * modules — which is what protects the 14-world-px text bound that fixes
 * `NEXT_HALO_RADIUS` in the first place.
 *
 * It is 1 at and above `K_READABLE`, so zooming IN never changes the mark and
 * the halo at 'in' — and across the top half of 'mid' — is byte-identical to
 * what it was before either requirement existed.
 *
 * @param {number} k  the world→screen scale actually being drawn at
 * @returns {number} a factor in [1, NEXT_HALO_MAX_MAGNIFY], monotone
 *   non-increasing in `k` and continuous everywhere
 */
export function nextHaloMagnify(k) {
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
// `NEXT_HALO_SCREEN_RADIUS` already follow). On the live plan this floor is
// k = 0.3 — matching the measured split in
// `pipelinePlanLayout.test.js` ("cannot reach the deep zoom-out band, and
// says where it stops").
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
 * @param {number} k  the world→screen scale actually being drawn at
 * @returns {boolean}
 */
export function nextMarkIsDot(k) {
    return Number.isFinite(k) && k > 0 && k < NEXT_MARK_FLOOR_K;
}

/**
 * The deep-zoom-out dot's WORLD radius for this frame — the value that,
 * multiplied by the camera's own `k`, always renders at
 * `NEXT_MARK_SCREEN_RADIUS` screen px regardless of how small `k` gets.
 *
 * Only meaningful where `nextMarkIsDot(k)` is true; the caller picks the
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
 * Batch boxes are deliberately not consulted: `computePlanLayout` sizes them at
 * `colW[depth] - 8`, so they can never exceed the column extent already taken.
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
 * step's requirement marks stack BELOW its bead (`n.y + 14 + i * REQ_LINE_H`)
 * and its title sits ABOVE it, so a fit to the bead alone would centre the bead
 * and push the requirement ids — the thing the reader followed the link to see —
 * off the bottom of a tight viewport. The band case fits vertically to
 * `band.height`, which already contains all of that; a single step has no such
 * precomputed extent and has to take the union itself.
 *
 * The COLUMN is included for the same reason it is in `bandFitRect`: it keeps a
 * step whose label happens to be short from being magnified past its neighbours
 * into a view with no context. The `FOCUS_MAX_RATIO` clamp handles the rest.
 *
 * THE BATCH BOX IS OMITTED, and NOT for `bandFitRect`'s reason (code review).
 * That one argues the box can never exceed the column extent, which is a
 * HORIZONTAL argument resting on a band's vertical fit already being
 * `band.height`; a single step has no such precomputed extent. It is omitted
 * because a batch box spans every step in its segment, and fitting one step to
 * a rectangle drawn around its SIBLINGS is the zoomed-out view this function
 * exists to replace. So the box may legitimately clip top and bottom — the
 * reader asked for one step, and its own bead, label and requirement marks are
 * all inside the rect.
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
    return fitTransform(stepFitRect(layout, stepId), size, kBase, null, kFloor);
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
