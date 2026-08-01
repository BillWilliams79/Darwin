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
//     first-appearance order over the given rows (callers pass display order, so
//     completed epics surface first exactly as the POC page read).
//   - Dependency-depth columns left-to-right; a step's column is
//     1 + max(dep columns).
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
};

// Epic band palette (POC EPAL) — band index cycles through it.
export const EPIC_PALETTE = ['#7c4dff', '#00897b', '#c2185b', '#f57c00', '#3949ab', '#5d4037'];

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
const CHW_EPIC = 9.15;          // px per mono char at font 15 (epic band label)
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
    label: 16.5, req: 13.75, title: 9.5, epic: 15, batch: 10, check: 9,
};

export const BEAD_RADIUS = BEAD_R;

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

/**
 * Compute the full Plan-mode layout.
 *
 * @param {Object[]} rows      engine PlanRows, DISPLAY order (band order follows
 *                             first appearance, so pass displayOrder output)
 * @param {Object[]} batches   engine LaunchBatch[] (launchBatches output)
 * @param {Object} [opts]
 * @param {('horizontal'|'vertical')} [opts.reqLayout]
 * @param {('id'|'title')} [opts.reqLabel]   what the marks UNDER a bead say
 * @param {(Map|Object)} [opts.reqTitles]    requirement id -> title, for 'title'
 * @param {('id'|'title')} [opts.stepLabel]
 * @param {('compact'|'medium'|'wide')} [opts.stepWidth]
 * @returns {Object} layout — see the shape assembled at the bottom
 */
export function computePlanLayout(rows, batches, {
    reqLayout = 'horizontal', stepLabel = 'id', stepWidth = DEFAULT_STEP_WIDTH,
    reqLabel = 'id', reqTitles = null,
} = {}) {
    const safeRows = Array.isArray(rows) ? rows : [];
    const safeBatches = Array.isArray(batches) ? batches : [];
    const widthFactor = stepWidthFactor(stepWidth);
    if (safeRows.length === 0) {
        return {
            width: MIN_WORLD_W, height: 120, bands: [], nodes: new Map(),
            arcs: [], batchBoxes: [], labels: [], colW: [], colX: [],
            reqLayout, stepLabel, stepWidth, reqLabel, empty: true,
        };
    }

    const byId = new Map(safeRows.map((r) => [r.id, r]));
    const depsOf = (r) => (r.depIds || []).filter((d) => byId.has(d));

    // ── Dependency-depth columns ────────────────────────────────────────────
    const depthMemo = new Map();
    const depth = (r) => {
        if (depthMemo.has(r.id)) return depthMemo.get(r.id);
        depthMemo.set(r.id, 0); // cycle guard — a cycle collapses to column 0
        const v = 1 + Math.max(-1, ...depsOf(r).map((d) => depth(byId.get(d))));
        depthMemo.set(r.id, v);
        return v;
    };
    safeRows.forEach(depth);
    const maxD = Math.max(...safeRows.map((r) => depthMemo.get(r.id)));

    // ── Column widths (the zero-overlap contract, half 1) ───────────────────
    // A column is as wide as the widest thing DRAWN in it: the one-line req-id
    // string (horizontal) or the widest single id (vertical), and the step
    // label — id or truncated title — in either mode.
    const colSteps = [];
    for (const r of safeRows) {
        const d = depthMemo.get(r.id);
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
    for (let d = 0; d <= maxD; d++) {
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
        const right = d < maxD ? colW[d + 1] : RIGHT + 40;
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
        for (let d = 0; d <= maxD; d++) {
            colX.push(acc + colW[d] / 2);
            acc += colW[d];
        }
    }
    const totalW = Math.max(MIN_WORLD_W, colX[maxD] + colW[maxD] / 2 + RIGHT + 40);

    // ── Epic bands (dominant label, first-appearance order) ─────────────────
    const bandKeys = [];
    const bandByKey = new Map();
    for (const r of safeRows) {
        const key = r.epicId != null ? r.epicId : null;
        if (!bandByKey.has(key)) {
            bandByKey.set(key, {
                key, epicId: key, epic: r.epic || 'No epic',
                color: EPIC_PALETTE[bandKeys.length % EPIC_PALETTE.length],
                steps: [],
            });
            bandKeys.push(key);
        }
        bandByKey.get(key).steps.push(r);
    }

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
            (depthMemo.get(a.id) - depthMemo.get(b.id)) ||
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
            for (let dd = depthMemo.get(a.id) + 1; dd < depthMemo.get(r.id); dd++) {
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
                    if (depthMemo.get(tid) <= d) continue;
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
        const batchRunNext = new Map(); // letter -> next lane in this band's run
        for (const r of steps) {
            const d = depthMemo.get(r.id);
            const letter = batchOf.get(r.id);
            let lane = null;
            if (letter !== undefined) {
                if (!batchRunNext.has(letter)) {
                    const n = steps.filter((s) => batchOf.get(s.id) === letter).length;
                    const runOk = (start) => {
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
                    } else {
                        lane = 0;
                        while (!laneOk(r, d, lane)) lane += 1;
                    }
                }
            }
            laneById.set(r.id, lane);
            take(d, lane, r.id);
            // Reserve the corridor of every straight (same-lane) arc into this
            // step, so no LATER chain inherits a lane through it. take() never
            // overwrites, so an in-chain bead already in the corridor keeps its
            // identity for later corridorOk checks.
            for (const a of sameEpicDepsOf(r)) {
                if (laneById.get(a.id) === lane) {
                    for (let dd = depthMemo.get(a.id) + 1; dd < d; dd++) {
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
        // Bands hosting batch members take a taller header: the batch letter
        // lives in a reserved header strip (below the epic label, above lane
        // 0's step label) and the box top must clear the epic label — found in
        // review as an epic-label × batch-label collision on long epic titles.
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
    let y = 8;
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
            const d = depthMemo.get(r.id);
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
                arcs.push({ fromId: dId, toId: r.id, straight: true, route: 'straight', x1, y1, x2, y2 });
                continue;
            }
            const sameBand = a.bandIndex === b.bandIndex;
            const late = sameBand
                && corridorClear(a.bandIndex, a.lane, a.depth, b.depth, dId, r.id);
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
    for (const band of bands) {
        labels.push({
            kind: 'epic', epicId: band.epicId, text: band.epic,
            x: 12, y: band.y + 6, w: band.epic.length * CHW_EPIC, h: 16,
        });
    }
    // Batch letters live in the reserved header strip of a segment's band —
    // below the epic label (ends at band.y+19), above lane 0's step label
    // (starts at band.y + headerH − 16 = band.y + 40 with the extended header)
    // — so the letter can never collide with either, whatever the epic title
    // length. Letters sharing a band stagger rightward.
    //
    // EVERY SEGMENT IS LABELLED, not just the first (req #3188). While a batch
    // could only segment across BANDS — which the engine can no longer produce
    // at all — one letter for the whole batch read as one launch unit stacked
    // vertically. Column segments sit SIDE BY SIDE and are reachable on any plan
    // where mates share only their remaining gate, and an unlabelled dashed box
    // beside a labelled one reads as a second, anonymous batch. Repeating
    // "batch A" is the honest rendering: both boxes ARE batch A. The stagger
    // loop already keeps two letters in one band apart, and segments in
    // different columns start far enough apart that it rarely has to.
    const placedLetters = new Map(); // bandIndex -> [{x, w}]
    for (const box of batchBoxes) {
        const text = `batch ${box.letter}`;
        const w = text.length * 6;
        const band = bands[box.bandIndex];
        let x = box.x + 5;
        const others = placedLetters.get(box.bandIndex) || [];
        let moved = true;
        while (moved) {
            moved = false;
            for (const o of others) {
                if (x < o.x + o.w + 8 && o.x < x + w + 8) {
                    x = o.x + o.w + 8;
                    moved = true;
                }
            }
        }
        others.push({ x, w });
        placedLetters.set(box.bandIndex, others);
        const y = band.y + 26;
        // A box whose top member sits below lane 0 leaves a gap between the
        // header-strip letter and the box; the leader is a dashed drop-line the
        // renderer draws from the letter to the box top so the association
        // stays readable (review finding: a 133px orphaned letter). Clamped
        // into the box's x-range for staggered letters.
        const leader = box.y - (y + 11) > 6
            ? {
                x1: x + 4, y1: y + 12,
                x2: Math.min(Math.max(x + 4, box.x + 6), box.x + box.width - 6),
                y2: box.y,
            }
            : null;
        labels.push({
            kind: 'batch', letter: box.letter, text,
            x, y, w, h: 11, leader,
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
// The floor a scaled chip stops at. Below this the name is not readable anyway,
// and the layout would rather draw a small legible-ish chip inside its own lane
// than a full-size one over the first row of steps.
export const EPIC_CHIP_MIN_H = 11;
// Background opacity of the chip (user directive 2026-08-01: 40% transparent,
// i.e. 60% opaque). It was fully opaque, which read as a solid tile punched into
// the plan; at 0.6 the band beneath shows through as tint while the name still
// wins over whatever it crosses.
export const EPIC_CHIP_BG_ALPHA = 0.6;

export function placeEpicChips({
    bands = [], transform, viewport, worldWidth,
    labelH = EPIC_CHIP_H, charW = EPIC_CHIP_CHAR_W, keepOut = null,
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

    for (const band of bands) {
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
        const w = band.epic.length * charW * scale + EPIC_CHIP_PAD_W * scale;
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

        obstacles.push(placed);
        out.push({
            key: band.key == null ? 'none' : band.key,
            epicId: band.epicId,
            text: band.epic,
            color: band.color,
            x: placed.x, y: placed.y, w, h,
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
export function beadStyle(row, eligible) {
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

export { STEP_DONE, STEP_RUNNING, STEP_PENDING };
