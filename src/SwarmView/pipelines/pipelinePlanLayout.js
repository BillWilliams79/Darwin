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
// ── How WIDE the on-screen key may be, and why that is the only limit ──────
// The key's measured rect is the keep-out `placeEpicChips` displaces the
// floating epic names around, and that displacement is HORIZONTAL ONLY by
// design — moving a chip vertically would put it on another band's line, which
// is a wrong label rather than a missing one. So the key's WIDTH is its entire
// cost to the epic labels and its HEIGHT is free.
//
// MEASURED on the Substrate fixture (3000×1592 world, 4 bands) over
// k ∈ {0.2 … 2} × 4 pans × 6 x-offsets, 233 chips drawn, against the ~420×30
// bead legend this key replaces:
//
//   width  300 340 380 420 | 500 600 700
//   lost     0   0   0   0 |   1   8-10  15-20     (at EVERY height 30…180)
//
// Zero chips lost at any height up to 180px while the width stays ≤ 420. That
// is why the complete key is laid out as one row per CHANNEL stacked
// vertically rather than as one long wrapping line: the shape that costs
// nothing is TALL AND NARROW, and the shape the old legend had (`maxWidth:
// '70%'`, i.e. up to ~1050px) is the one that drops epic names.
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
 * compact enough not to steal the top-right corner from the epic chips.
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
// nothing else is ever placed in it. That moves the fit threshold to k ≈ 0.39,
// well below the 0.8 default and below fit-to-width on every real plan. Under
// that — deep zoom-out, where the strip is genuinely shorter on screen than the
// chip — `placeEpicChips` SCALES the chip down to its lane rather than
// overflowing it or dropping it, so the guarantee holds at every k rather than
// over a range.
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
const BAND_GAP = 8;
const LANE_BASE_H = 62;         // POC 56 + type-scale headroom, before the title slot
const TITLE_SLOT = 14;          // deviation 2 — reserved per-lane title line
// One requirement mark per line at font 13.75. EXPORTED since the swim-lane
// directive: it is the exact vertical cost a lane pays when titles stagger, and
// a test that re-typed the number could agree with a changed layout by accident.
export const REQ_LINE_H = 15;
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
export const LABEL_MAX_CHARS = 35;
// Staggering (req #3119, the Build Visualizer's version-label pattern —
// `d3LayoutEngine.js` offsets every odd build by `versionLaneGap`). Odd columns
// draw their long text one line further from the bead, so a label and its
// left/right neighbours are never on the same line and each may overflow its own
// column. Only the SAME-PARITY columns (d±2) share a line, and the budget below
// keeps two of those from meeting.
const STAGGER_GAP = 18;
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
const TITLE_COL_MIN = 144;
export const PLAN_VIZ_FONT = {
    label: 16.5, req: 13.75, title: 9.5, epic: 15, batch: 10, check: 9, slot: 13,
};

export const BEAD_RADIUS = BEAD_R;

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
//   · the STRIP says WHICH day a column is. It is world text at the top of the
//     plan, so it scrolls off when you pan down — which is exactly why it is
//     not the only mark.
//   · the SEPARATORS say WHERE a day begins. Full-height rules at slot origins,
//     readable at any vertical pan.
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
    return t ? truncate(t, Math.max(4, Math.min(LABEL_MAX_CHARS, maxChars))) : String(reqId);
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
            w = Math.max(64, labelW, ...steps.map((r) => reqStr(r).length * CHW_REQ + 30));
        } else {
            w = Math.max(70, labelW,
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
    // than at render time in every consumer of `band` (the natural chip loop,
    // the sticky pass, and any future one), the same reasoning `bandStartOf`
    // below is memoized for.
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
        // Same-band batch-mates take a CONTIGUOUS RUN of lanes, allocated when
        // the first mate places: the lowest run of members.length lanes that
        // all pass laneOk (dep-anchored candidates first, so a gate on this
        // band's lane keeps its straight arc when possible). Mates share one
        // dep set, so laneOk is member-independent and the pre-check holds for
        // every mate; the sort keeps mates consecutive, so nothing else places
        // between the pre-check and the last mate. A batch box therefore
        // encloses exactly its members — never a foreign bead. (Review found
        // the earlier next-free-lane packing letting mates spread around an
        // occupied lane, boxing unrelated steps in ~15% of multi-batch plans.)
        //
        // THE RUN IS RESERVED, NOT MERELY ALLOCATED (req #3256). Mates place in
        // DEPTH order like everything else, so a batch spanning two columns —
        // which req #3188's remaining-gate key made routine — has its deeper
        // mates placed after every shallower non-member. Anything that takes a
        // lane VALUE inside the run in that window splits it, because the
        // ordinal renumber below preserves ORDER, not distance. Measured on the
        // live plan: batch A on lanes 7/9/10/11 with an empty row at 8, whose
        // only occupant sat one column to the left — the doubled first-to-second
        // gap in the reported screenshot. `batchRunSpan` is what the two paths
        // that can do it consult: another batch's run allocation, and the
        // dep-adjacent fractional insertion below.
        const batchRunNext = new Map(); // letter -> next lane in this band's run
        const batchRunSpan = new Map(); // letter -> [first, last] lane of the run
        // EVERY lane value handed out in this band, fractions included — the
        // renumber sorts exactly this set, so it is what says whether a run of
        // integers is really contiguous. It is NOT read off `laneBeads`, which
        // today holds the same values but only through an argument about
        // `take()`'s no-op-on-occupied behaviour, ascending-column placement and
        // mates sorting before non-members. The contiguity guard should not
        // depend on that argument staying true.
        const assignedLanes = new Set();
        // The end of the run `v` falls in, or null when it falls in none.
        // Inclusive of both ends: a run lane a mate has not reached yet is free
        // in `used` and must still not be handed out.
        const runEndAt = (v) => {
            for (const [s, e] of batchRunSpan.values()) if (v >= s && v <= e) return e;
            return null;
        };
        // The first fresh lane value below every run `v` sits in. Fresh in the
        // same sense the insertion path already relies on: a value absent from
        // `laneBeads` carries no cells and no corridors (a corridor is only ever
        // reserved between two beads on one lane), so it always places.
        //
        // Each pass leaves `out` strictly ABOVE the end of the run it was in, so
        // the run ends visited strictly increase and there are at most as many
        // of them as there are runs — the bound below IS that termination proof,
        // not a safety net. Falling out of it would return a value still inside
        // a run, which is the dead lane row this whole guard exists to prevent.
        const belowBatchRuns = (v) => {
            let out = v;
            for (let guard = 0; guard <= batchRunSpan.size; guard++) {
                const end = runEndAt(out);
                if (end === null) return out;
                const nx = [...laneBeads.keys()]
                    .filter((k) => k > end).sort((p, q) => p - q)[0];
                out = nx === undefined ? end + 1 : (end + nx) / 2;
            }
            return out;
        };
        for (const r of steps) {
            const d = colOf.get(r.id);
            const letter = batchOf.get(r.id);
            let lane = null;
            if (letter !== undefined) {
                if (!batchRunNext.has(letter)) {
                    const n = steps.filter((s) => batchOf.get(s.id) === letter).length;
                    const runOk = (start) => {
                        // Never overlap a run already reserved in this band:
                        // `laneOk` reads `used`, which says nothing about a lane
                        // a deeper mate has yet to occupy, so two batches would
                        // interleave and both boxes would enclose the other's
                        // members.
                        const last = start + n - 1;
                        for (const [s, e] of batchRunSpan.values()) {
                            if (start <= e && s <= last) return false;
                        }
                        // …and never STRADDLE a lane already handed out (req
                        // #3256). The run is allocated at the FIRST mate, which
                        // — depth order again — can be deeper than non-members
                        // that already opened inserted lanes, and the anchored
                        // candidate below can itself be one of those fractional
                        // lanes. Contiguity is a property of the SORTED values
                        // the renumber sees, not of the arithmetic: a run is
                        // contiguous only if nothing that is not one of its own
                        // lanes sits between its ends. Measured in fuzz: 56 of
                        // 3848 boxes still spanned a dead lane with only the
                        // insertion side guarded, every one of them this case.
                        const mine = new Set();
                        for (let k = 0; k < n; k++) mine.add(start + k);
                        for (const v of assignedLanes) {
                            if (v > start && v < last && !mine.has(v)) return false;
                        }
                        for (let k = 0; k < n; k++) {
                            if (!laneOk(r, d, start + k)) return false;
                        }
                        return true;
                    };
                    let start = null;
                    for (const a of sameEpicDepsOf(r)) {
                        const al = laneById.get(a.id);
                        if (al !== undefined && runOk(al)) { start = al; break; }
                    }
                    if (start === null) {
                        start = 0;
                        while (!runOk(start)) start += 1;
                    }
                    batchRunNext.set(letter, start);
                    batchRunSpan.set(letter, [start, start + n - 1]);
                }
                lane = batchRunNext.get(letter);
                batchRunNext.set(letter, lane + 1);
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
                    const anchors = sameEpicDepsOf(r)
                        .map((a) => laneById.get(a.id))
                        .filter((v) => v !== undefined);
                    if (anchors.length > 0) {
                        const al = Math.min(...anchors);
                        const below = [...laneBeads.keys()]
                            .filter((v) => v > al)
                            .sort((p, q) => p - q)[0];
                        lane = below === undefined ? al + 1 : (al + below) / 2;
                        // …and never inside a batch's reserved run: a fractional
                        // value between two mates becomes a WHOLE lane row at
                        // the renumber below, and the batch box then spans a
                        // lane no member occupies (req #3256). Stepping past the
                        // whole run keeps the value fresh, so everything this
                        // path assumes about a fresh lane still holds.
                        lane = belowBatchRuns(lane);
                    } else {
                        lane = 0;
                        while (!laneOk(r, d, lane)) lane += 1;
                    }
                }
            }
            laneById.set(r.id, lane);
            assignedLanes.add(lane);
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
                y: band.y + band.headerH + band.laneY[laneById.get(r.id)] + 10,
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
                // A 1px-tall AABB — see `bbox` below — so a degenerate straight
                // arc still has SOME height for the sticky-chip avoidance check
                // (req #3210) to test against, rather than a zero-height rect
                // that can only ever collide by exact-Y coincidence.
                arcs.push({
                    fromId: dId, toId: r.id, straight: true, route: 'straight', x1, y1, x2, y2,
                    bbox: { x: Math.min(x1, x2), y: y1 - 1, w: Math.abs(x2 - x1), h: 2 },
                });
                continue;
            }
            const sameBand = a.bandIndex === b.bandIndex;
            const late = sameBand
                && corridorClear(a.bandIndex, a.lane, a.depth, b.depth, dId, r.id);
            let path;
            // `pts` is every X/Y pair the SVG path string below is built from —
            // start, both cubic controls, and end. A cubic Bézier always lies
            // within the convex hull of its control points (never bulges past
            // them), so min/max over this exact set is a CONSERVATIVE but
            // never-too-small bounding box (req #3210's `bbox`, below) — no
            // curve sampling required, and it can only over- rather than
            // under-estimate what the arc occupies on screen.
            let pts;
            if (late) {
                const bend = Math.min((colW[b.depth] || 110) * 0.9, Math.max(40, x2 - x1));
                const xb = Math.max(x1, x2 - bend);
                path = `M${x1},${y1} L${xb},${y1} C${xb + bend * 0.45},${y1} `
                    + `${xb + bend * 0.55},${y2} ${x2},${y2}`;
                pts = [[x1, y1], [xb, y1], [xb + bend * 0.45, y1], [xb + bend * 0.55, y2], [x2, y2]];
            } else {
                const bend = Math.min((colW[a.depth] || 110) * 0.9, Math.max(40, x2 - x1));
                path = `M${x1},${y1} C${x1 + bend * 0.45},${y1} ${x1 + bend * 0.55},${y2} `
                    + `${x1 + bend},${y2} L${Math.max(x2, x1 + bend)},${y2}`;
                pts = [[x1, y1], [x1 + bend * 0.45, y1], [x1 + bend * 0.55, y2],
                    [x1 + bend, y2], [Math.max(x2, x1 + bend), y2]];
            }
            const xs = pts.map((p) => p[0]);
            const ys = pts.map((p) => p[1]);
            const bbox = {
                x: Math.min(...xs), y: Math.min(...ys),
                w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys),
            };
            arcs.push({
                fromId: dId, toId: r.id, straight: false,
                route: late ? 'late' : 'early', x1, y1, x2, y2, path, bbox,
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
            const w = Math.max((colW[depth] || 110) - 8, 56);
            const yTop = Math.min(...ms.map((n) => n.y)) - 40;
            const yBot = Math.max(...ms.map((n) => {
                const row = byId.get(n.id);
                const nReqs = (row.reqIds || []).length;
                // The box must enclose the marks it is drawn around, and in
                // titles mode an odd column's stack starts a line lower.
                return n.y + reqStaggerOf(n.depth) + (reqLayout === 'vertical'
                    ? 28 + Math.max(0, nReqs - 1) * REQ_LINE_H : 30);
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
    // Beads as rects covering their hit circle, PER BAND — the sweep below is
    // band-scoped and the memo is what makes that cheap. Scoping is sound
    // because a letter cannot leave its own band (its ceiling is inside it) and
    // the nearest foreign bead is ~103px away: the previous band's deepest bead
    // sits at least `lanePitch − 10` above its band bottom, and `lanePitch` is
    // at least LANE_BASE_H + TITLE_SLOT + STAGGER_GAP = 94, comfortably more
    // than BEAD_HIT_RADIUS + 10. That inequality is the dependency; if a lane
    // could ever be shorter than a bead, this filter would have to go.
    const bandBeadRects = new Map();
    const beadRectsOf = (bandIndex) => {
        if (!bandBeadRects.has(bandIndex)) {
            bandBeadRects.set(bandIndex, [...nodes.values()]
                .filter((n) => n.bandIndex === bandIndex)
                .map((n) => ({
                    x: n.x - BEAD_HIT_RADIUS, y: n.y - BEAD_HIT_RADIUS,
                    w: 2 * BEAD_HIT_RADIUS, h: 2 * BEAD_HIT_RADIUS,
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
        // over a step's. Beads join the sweep as rects covering the hit circle,
        // so the search displaces off them exactly as it does off a label.
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
            // topping at `band.y + 55` against the 40 required. Kept anyway,
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

// ── Floating epic chips (req #3119, de-collided req #3168) ─────────────────
// The epic name rides its band's header strip and clamps to the top of the
// viewport while any part of the band is on screen. This function is the whole
// placement decision, in SCREEN space, as a pure function of the world transform
// — it lives here rather than in the component for the same reason every other
// rectangle in this module does: overlap is a geometric property and it should be
// decidable in vitest without mounting a canvas.
//
// THE COLLISIONS req #3168 NAMES, and which of them was actually measured:
//
//   · CHIP UNDER THE LEGEND — real on the live band geometry. The chip clamps
//     into the part of its band that is on screen, and the legend floats over the
//     panel's top-right corner; a right-panned or narrow-on-screen band puts the
//     two in the same place. Measured under the pre-#3168 rule: 280 hits over
//     k ∈ [0.05, 2.5] × four pans against a 420px legend.
//   · CHIP ON CHIP — reachable, but NOT on the Substrate fixture. The chip is
//     sized in SCREEN px while the header strip reserving room for it is WORLD
//     px, so below some k the strip is shorter than the chip and it hangs past
//     its own band onto the next band's. The fixture never gets there: its bands
//     are 160–604 world px tall and 294+ apart, and by the k where that spacing
//     falls under 24px the chips are already suppressed for want of width. A plan
//     of MANY SHORT bands — one-lane steps, ~150px each — does get there; that
//     shape collides 70 times over k ∈ [0.05, 0.5] under the old rule, and it is
//     the case the vitest sweep constructs.
//
// The fix is a placement pass, not a taller header: the header is world geometry
// and making it big enough for a screen-sized chip at every k means making it
// absurd at k=1. Obstacles (already-placed chips, plus the legend's measured
// rect) are avoided by HORIZONTAL displacement — the chip stays on its own band's
// line, which is the only line that identifies it correctly — and a chip with
// nowhere left to go is DROPPED rather than drawn wrong. Dropping is honest here:
// the band it belongs to is on its way off-screen or squeezed to nothing in every
// case that reaches it, and a mislabelled band is worse than an unlabelled one.
const CHIP_PAD = 8;

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
// natural chip has never needed this reserved — it is checked only against
// the legend and other chips, both comfortably clear at the sizes this
// surface reaches in practice — but a STICKY chip (`placeEpicChips`, below)
// is checked against beads, arcs and labels it can end up flush against, so
// leaving the control unmeasured there is the exact under-measurement bug
// this module's own header comment warns about, just for a different mark.
export const EPIC_CHIP_OPEN_LINK_W = 24;
// The pause status bubble (req #3226) — a small filled circle immediately left
// of the epic name, the SAME kind of flat, unscaled reservation as the ↗
// control above and for the identical reason: it is a fixed-diameter dot plus
// the chip's own flex `gap`, neither of which shrinks with the chip.
//
// UNLIKE the ↗ control, this one IS added to the natural (non-sticky) chip's
// measured width, not only the sticky one — the requirement calls this out by
// name ("a bubble is width the label did not have before") because, unlike
// the ↗ link, the bubble renders on EVERY band unconditionally (the ↗ link is
// absent for the "No epic" band; the bubble is not carved out for it because
// pause is meaningful there too — the whole-plan pause suppresses it same as
// any other band).
export const EPIC_PAUSE_BUBBLE_D = 8;    // the dot's own diameter, screen px
const EPIC_PAUSE_BUBBLE_GAP = 4;         // matches the chip's flex `gap`
export const EPIC_PAUSE_BUBBLE_W = EPIC_PAUSE_BUBBLE_D + EPIC_PAUSE_BUBBLE_GAP;
// The floor a scaled chip stops at. Below this the name is not readable anyway,
// and the layout would rather draw a small legible-ish chip inside its own lane
// than a full-size one over the first row of steps.
export const EPIC_CHIP_MIN_H = 11;
// Background opacity of the chip (user directive 2026-08-01: 40% transparent,
// i.e. 60% opaque). It was fully opaque, which read as a solid tile punched into
// the plan; at 0.6 the band beneath shows through as tint while the name still
// wins over whatever it crosses.
export const EPIC_CHIP_BG_ALPHA = 0.6;

/**
 * Every world-space rect currently DRAWN on this surface — bead footprints
 * (widened to the eligible-step halo where the engine says a step is
 * launchable now), batch-box outlines, every dependency arc's `bbox`, and
 * whichever labels the caller's OWN `drawsKind` says the current semantic
 * level actually draws (req #3210's `placeEpicChips` sticky chips are the
 * consumer — see that function's own comment for why this assembly cannot
 * live inside it).
 *
 * PURE and exported rather than inlined in the component, so the level gate
 * — otherwise only provable by rendering `PipelinePlanVisualizer.jsx` — is a
 * testable property of plain data instead. `drawsKind` defaults to "draw
 * everything", the conservative superset a caller with no notion of semantic
 * level (a test, a hand-built probe) should get rather than a silent
 * under-count; `eligibleStepIds` defaults to none, since a caller that omits
 * it has no eligibility concept to widen the footprint for.
 *
 * `kind: 'epic'` labels are excluded outright, unconditionally: they are
 * NEVER drawn in the world at all (an HTML overlay draws the name instead —
 * see the `kind === 'epic'` no-op in the component's own world-node loop), so
 * including them would avoid a mark that is not actually there.
 *
 * @param {Object} layout `computePlanLayout`'s own return value
 * @param {Object} [args]
 * @param {(kind: string) => boolean} [args.drawsKind]
 * @param {?Set<number>} [args.eligibleStepIds]
 * @returns {{x:number,y:number,w:number,h:number}[]}
 */
export function collectWorldObstacles(layout, { drawsKind = () => true, eligibleStepIds = null } = {}) {
    const out = [];
    for (const n of (layout?.nodes || new Map()).values()) {
        const r = eligibleStepIds?.has(n.id) ? NEXT_HALO_RADIUS + NEXT_HALO_STROKE / 2 : BEAD_R;
        out.push({ x: n.x - r, y: n.y - r, w: 2 * r, h: 2 * r });
    }
    for (const l of layout?.labels || []) {
        if (l.kind === 'epic' || !drawsKind(l.kind)) continue;
        out.push({ x: l.x, y: l.y, w: l.w, h: l.h });
    }
    for (const a of layout?.arcs || []) {
        if (a.bbox) out.push(a.bbox);
    }
    // Batch boxes carry `width`/`height`, not `w`/`h` (`computePlanLayout`'s
    // own field names for them) — normalized here to the one obstacle shape
    // this function promises.
    for (const b of layout?.batchBoxes || []) {
        out.push({ x: b.x, y: b.y, w: b.width, h: b.height });
    }
    return out;
}

export function placeEpicChips({
    bands = [], transform, viewport, worldWidth,
    labelH = EPIC_CHIP_H, charW = EPIC_CHIP_CHAR_W, keepOut = null,
    worldObstacles = [],
} = {}) {
    const t = transform || { x: 0, y: 0, k: 1 };
    const vw = viewport?.w || 0;
    const vh = viewport?.h || 0;
    if (!(t.k > 0) || vw <= 0 || vh <= 0) return [];

    // Obstacles accumulate as chips place, so band order (top to bottom) is also
    // priority order: an upper band keeps its natural position and a lower one
    // moves. Deterministic, and it matches how the plan reads.
    const obstacles = keepOut ? [{ ...keepOut }] : [];
    const hits = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w
        && a.y < b.y + b.h && b.y < a.y + a.h;
    const out = [];
    // Which bands actually got their OWN chip drawn (req #3210) — the sticky
    // pass below reads this rather than re-deriving "visible" from scratch; see
    // that section's own comment for why a geometric visibility test isn't the
    // same question.
    const placedAt = new Array(bands.length).fill(false);

    for (let bi = 0; bi < bands.length; bi++) {
        const band = bands[bi];
        const top = t.y + band.y * t.k;
        const bottom = t.y + (band.y + band.height) * t.k;
        // The EPIC LANE's bottom, not the header's: a lane-0 step label reaches
        // back up into the header, so `headerH` overstates the clear strip by
        // `STEP_LABEL_RISE` (+ the stagger). `epicLaneH` is the derived clear
        // height; the fallback keeps this function usable with hand-built bands.
        const laneBottom = t.y + (band.y + (band.epicLaneH ?? band.headerH)) * t.k;
        const left = t.x + 2 * t.k;
        const right = t.x + (worldWidth - 2) * t.k;
        // Off-screen on EITHER axis means no chip. Vertical alone was not
        // enough: panning far right leaves a band's rectangle entirely to the
        // left of the panel, and clamping x into a rectangle that is off-screen
        // puts the chip off-screen with it.
        if (bottom < 0 || top > vh) continue;
        if (right < 0 || left > vw) continue;

        // VERTICAL: confined to the band's own EPIC LANE — the reserved strip
        // above lane 0, which by construction holds no step content.
        //
        // THE CHIP IS SCALED TO THE LANE, not merely clamped into it (req #3168,
        // user directive: the epic must never ride in the top steps' lane). The
        // lane is world geometry and the chip is screen geometry, so below
        // k ≈ labelH/BAND_HEADER the lane is genuinely shorter on screen than the
        // chip and no clamp can help: pinning to the strip's top puts the
        // overflow onto lane 0's step labels, which is the collision. Shrinking
        // is the only move that keeps the guarantee at EVERY k, and it degrades
        // honestly — the name stays where it belongs and gets smaller, which is
        // what zooming out means everywhere else on this surface.
        const laneH = Math.max(0, laneBottom - top);
        const h = Math.max(EPIC_CHIP_MIN_H, Math.min(labelH, laneH - 4));
        // Font and character width track the box, so a scaled chip's WIDTH is
        // measured at the size it is actually drawn — otherwise the shrink would
        // silently re-introduce the over-measurement the width metric fixed.
        const scale = h / labelH;
        // req #3225 — `epicLabel` carries the count suffix when the toggle is
        // on; hand-built band fixtures that predate the field fall back to
        // the plain name, so this stays the identity transform for callers
        // that never set it.
        const bandText = band.epicLabel || band.epic;
        // req #3226 — the pause bubble's flat footprint, added BEFORE anything
        // is checked against beads/arcs/labels, matching the ↗ control's own
        // discipline at the sticky site below (this chip always carries it,
        // unlike the ↗, which is absent for the "No epic" band).
        const w = bandText.length * charW * scale + EPIC_CHIP_PAD_W * scale
            + EPIC_PAUSE_BUBBLE_W;
        const minY = top + 2;
        const maxY = Math.max(minY, laneBottom - h - 2);
        const y = Math.min(Math.max(2, minY), maxY);
        // WHOLLY on screen, and wholly inside its own lane, or not at all.
        if (y < 0 || y + h > vh) continue;
        if (y + h > laneBottom + 0.01) continue;
        // Confine to the part of the band that is BOTH inside the rectangle and
        // on screen: clamping to the rectangle alone hangs the chip off the panel
        // edge, clamping to the panel alone puts it outside the rectangle.
        const minX = Math.max(0, left) + 6;
        const maxX = Math.min(right, vw) - 6 - w;
        if (maxX < minX) continue;
        const x0 = Math.min(Math.max(minX, left + 6), maxX);

        // Candidate positions, nearest-first: the natural one, then flush right
        // of each obstacle, then flush left of each. Displacement is horizontal
        // only — the vertical clamp above is what makes the chip mean its own
        // band, and moving it off that line would be a wrong label rather than a
        // missing one.
        const candidates = [x0];
        for (const o of obstacles) {
            candidates.push(o.x + o.w + CHIP_PAD, o.x - CHIP_PAD - w);
        }
        let placed = null;
        for (const cx of candidates.sort((a, b) => Math.abs(a - x0) - Math.abs(b - x0))) {
            if (cx < minX || cx > maxX) continue;
            const rect = { x: cx, y, w, h };
            if (obstacles.some((o) => hits(rect, o))) continue;
            placed = rect;
            break;
        }
        if (!placed) continue;   // nowhere honest left — see the header comment

        placedAt[bi] = true;
        obstacles.push(placed);
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
            x: placed.x, y: placed.y, w, h,
            // The renderer must draw at the size this was MEASURED at, or the
            // whole placement is decided against a box that does not exist.
            fontSize: EPIC_CHIP_FONT * scale,
        });
    }

    // ── Sticky prev/next epic names (req #3210) ─────────────────────────────
    // A focused epic (req #3204's `epicFocusTransform`, FOCUS_PAD margin on
    // every side) fills the viewport with its own chip — the epics immediately
    // above and below it in the stack can end up with no name on screen at
    // all, and the reader loses any reference to — or one-click path to — a
    // neighbour. "Always at least three epic names" is the focused band's own
    // chip plus these two.
    //
    // `bands` is already ordered top-to-bottom in world-Y (req #3201's
    // DERIVED-START sort — see the module header), so "the epic above/below"
    // is simply the previous/next array entry relative to whichever bands
    // currently carry their OWN chip — `placedAt`, from the loop above.
    //
    // PLACED, NOT MERELY ON SCREEN — the first of two review findings this
    // block fixes. `FOCUS_PAD` is 44 SCREEN px while the gap between bands
    // (`BAND_GAP`) is 8 WORLD px, so at every k `epicFocusTransform` can
    // actually reach, the neighbour band's own trailing content sliver
    // projects to fewer screen px than the margin — its RECTANGLE still
    // technically intersects the viewport even though its NAME (confined to
    // its own epic lane, up near ITS top) is nowhere close to on screen. A
    // geometric "does the rect intersect" test therefore counted that
    // neighbour as already visible and never engaged. Whether its chip was
    // actually PLACED is the test that agrees with what the reader can see.
    //
    // BUT "nothing renders above the first CHIPPED band" is FALSE, and that is
    // the second finding: `placedAt[i]` can be false for a band whose CONTENT
    // is still genuinely on screen — the same tail-sliver case above, one step
    // short of fully scrolling off, or simply too little epic-lane room left
    // for its own chip while its beads and labels are still visible. Skipping
    // straight to the next-chipped band's boundary would let the sticky box
    // land on top of that real, drawn content (measured in review — a sticky
    // chip overlapping a live step label, and separately a live bead). So the
    // "swim lane" this reuses is not assumed empty; it is KEPT empty exactly
    // like every other chip on this surface — routed through the same
    // `obstacles`/`candidates` horizontal-displacement pass, now widened to
    // also carry `worldObstacles`.
    //
    // `worldObstacles` is the CALLER's job to assemble, deliberately: this
    // module has no notion of `drawsKind`/semantic LEVEL (`PipelinePlanVisualizer.jsx`'s
    // own gate on which labels are actually drawn at the current zoom), so it
    // cannot tell a currently-hidden label from a currently-drawn one — and
    // the epic label rects `layout.labels` itself carries are NEVER drawn in
    // the world at all (an HTML overlay draws the name instead; see the
    // `kind === 'epic'` no-op in the component's world-node loop). Handing
    // this module the FULL unfiltered `layout.labels`/`layout.nodes`/`layout.arcs`
    // would make it avoid marks that are not actually on screen (dropping a
    // sticky that had genuine room) while still missing marks it has no
    // vocabulary for (bead footprints are not labels or arcs at all — a
    // second review finding: a sticky chip landed on a live bead in the first
    // cut of this fix). The caller already computes exactly what is currently
    // drawn for its own rendering, so it is the one source that cannot drift
    // from what the reader actually sees.
    if (bands.length > 1) {
        let firstVisible = -1;
        let lastVisible = -1;
        for (let i = 0; i < placedAt.length; i++) {
            if (!placedAt[i]) continue;
            if (firstVisible === -1) firstVisible = i;
            lastVisible = i;
        }
        const left = t.x + 2 * t.k;
        const right = t.x + (worldWidth - 2) * t.k;
        if (firstVisible !== -1 && right >= 0 && left <= vw) {
            const minX = Math.max(0, left) + 6;
            const maxXCap = Math.min(right, vw) - 6;

            // Places one sticky chip, or draws nothing if there is no honest
            // room — the same refusal the natural loop makes when a candidate
            // can't be found, rather than shrinking past legibility or
            // overlapping something.
            const placeSticky = (targetBand, room, atTop) => {
                if (room < EPIC_CHIP_MIN_H) return;
                const h = Math.min(labelH, room);
                const scale = h / labelH;
                const bandText = targetBand.epicLabel || targetBand.epic;
                // The ↗ control renders whenever `epicId != null` (mirrors
                // the component's own condition) — its flat footprint has to
                // be in `w` before anything is checked against beads/arcs/
                // labels, or the collision math clears a box the reader
                // cannot actually see the edge of.
                // req #3226 — the pause bubble, unconditional (unlike the ↗
                // link above): it renders on every band, "No epic" included.
                const w = bandText.length * charW * scale + EPIC_CHIP_PAD_W * scale
                    + (targetBand.epicId != null ? EPIC_CHIP_OPEN_LINK_W : 0)
                    + EPIC_PAUSE_BUBBLE_W;
                const maxX = maxXCap - w;
                if (maxX < minX) return;
                const y = atTop ? 2 : (vh - h - 2);
                const rectObstacles = [...obstacles];
                // Only marks whose screen box actually reaches this chip's own
                // row are relevant — filtered here, not carried as a permanent
                // obstacle, because the top and bottom sticky slots occupy
                // disjoint rows and a mark relevant to one is almost never
                // relevant to the other.
                for (const r of worldObstacles) {
                    const box = {
                        x: t.x + r.x * t.k, y: t.y + r.y * t.k,
                        w: r.w * t.k, h: r.h * t.k,
                    };
                    if (box.y < y + h && y < box.y + box.h) rectObstacles.push(box);
                }
                const x0 = minX;
                const candidates = [x0];
                for (const o of rectObstacles) {
                    candidates.push(o.x + o.w + CHIP_PAD, o.x - CHIP_PAD - w);
                }
                let placed = null;
                for (const cx of candidates.sort((a, b) =>
                    Math.abs(a - x0) - Math.abs(b - x0))) {
                    if (cx < minX || cx > maxX) continue;
                    const rect = { x: cx, y, w, h };
                    if (rectObstacles.some((o) => hits(rect, o))) continue;
                    placed = rect;
                    break;
                }
                if (!placed) return;   // nowhere honest left
                obstacles.push(placed);
                out.push({
                    key: `${targetBand.key == null ? 'none' : targetBand.key}`
                        + `-stick-${atTop ? 'top' : 'bottom'}`,
                    epicId: targetBand.epicId,
                    text: bandText,
                    color: targetBand.color,
                    band: targetBand,
                    sticky: atTop ? 'top' : 'bottom',
                    x: placed.x, y: placed.y, w, h,
                    fontSize: EPIC_CHIP_FONT * scale,
                });
            };

            if (firstVisible > 0) {
                const topOfFirst = t.y + bands[firstVisible].y * t.k;
                placeSticky(bands[firstVisible - 1], topOfFirst - 4, true);
            }
            if (lastVisible < bands.length - 1) {
                const bottomOfLast = t.y
                    + (bands[lastVisible].y + bands[lastVisible].height) * t.k;
                placeSticky(bands[lastVisible + 1], vh - bottomOfLast - 4, false);
            }
        }
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
        ringWidth: row.run === 'manual' || eligible ? 2.5 : 1.5,
        pulse: running,
        check: done,
        // Req #3168 — "highlight for next steps". The ring alone carried this,
        // at the same weight as the magenta manual ring and drawn in a palette
        // neighbouring the Complete green, so the one question the plan exists to
        // answer was the hardest mark on it to find. `next` drives an animated
        // OUTER halo the renderer draws at every zoom level, including Overview,
        // where "what runs next" is asked most and a 1px ring reads as nothing.
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
 * The {x, y, k} that centres `band` in a `size.w` × `size.h` viewport with
 * FOCUS_PAD screen px of margin on all four sides.
 *
 * The scale is the tighter of the two axis fits, clamped into the behavior's
 * scale extent; the translation then centres the rect, which spends the slack
 * on the non-binding axis as equal margin rather than piling it on one side.
 *
 * @returns {{x:number,y:number,k:number}|null} null when there is nothing
 *   sensible to fit (no viewport yet, no columns, degenerate band).
 */
export function epicFocusTransform(layout, band, size, kBase) {
    const rect = bandFitRect(layout, band);
    if (!rect) return null;
    const w = size?.w || 0;
    const h = size?.h || 0;
    if (!(w > 0) || !(h > 0) || !(kBase > 0)) return null;
    // A viewport narrower than twice the pad has no room for the margin at all.
    // `max(half, minus-the-pad)` rather than a conditional: the conditional has
    // a cliff at exactly 2 × FOCUS_PAD where one pixel of growth changes the
    // available width from 88 to 1 and zooms out ~88×. Never reachable in
    // production (the panel has `minHeight: 480`), but a discontinuity that
    // sharp is a trap for the next caller, not a saved branch.
    const availW = Math.max(w * 0.5, w - 2 * FOCUS_PAD);
    const availH = Math.max(h * 0.5, h - 2 * FOCUS_PAD);
    const kFit = Math.min(availW / rect.w, availH / rect.h);
    const k = Math.min(Math.max(kFit, kBase * FOCUS_MIN_RATIO), kBase * FOCUS_MAX_RATIO);
    return {
        x: w / 2 - (rect.x + rect.w / 2) * k,
        y: h / 2 - (rect.y + rect.h / 2) * k,
        k,
    };
}

// ── Reset = FACTORY DEFAULT (req #3216 D1) ──────────────────────────────────
// "Reset" used to mean "back to `kDefault`", the READABLE landing scale (req
// #3168, `K_READABLE` above) — fit-to-width floored at a legible text size.
// The requirement redefines what the control returns to: fully zoomed out so
// the whole plan's VERTICAL extent is visible, one click, from any pan or
// zoom. "reset that lands somewhere the user still has to zoom out from is
// not reset." On a plan with many epic bands the readable floor can sit
// ABOVE the scale that needs, which is exactly the failure mode this
// function exists to rule out — it is deliberately NOT `kDefault`, and
// legibility is not a concern it weighs at all.
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

export { STEP_DONE, STEP_RUNNING, STEP_PENDING };
