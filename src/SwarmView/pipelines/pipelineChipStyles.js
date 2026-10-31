// pipelineChipStyles.js — the plan-table chip vocabulary (req #3114).
//
// Values are carried VERBATIM from the archived POC stylesheet in req #3080 and
// the plan-table UI rules groomed into the first generation's
// memory/swarm-orchestration.md § "UI rules — plan table". That document was
// deleted with the first generation (req #3356) and the chip vocabulary moved
// to no successor, so the list below is its only surviving statement — keep it
// complete:
//
//   Complete  dark-green + check      Running  amber (row tinted, amber left edge)
//   Scheduled neutral                 Manual   magenta        Auto  blue
//   Eligible  green left edge + tint + a "eligible" marker
//
// Two plan-table disciplines travelled with that list and have no other home
// either, so they are stated here:
//
//   - NO DECORATIVE CONCEPTS beyond the vocabulary above — no gates, no glyph
//     codes, nothing that has to be learned before the table can be read.
//   - COMPLETED ROWS RENDER AT FULL BRIGHTNESS. No lowlighting, no fading. A
//     finished epic is part of the plan's record, not visual noise to recede.
//
// Every chip carries BOTH its own background and its own text color, so it reads
// identically in Darwin's light and dark themes (ThemeWrapper supports both) —
// the same call requirementStatusChipProps and coordinationChipStyles make. The
// row tints are low-alpha overlays for the same reason: they modulate whatever
// surface is underneath instead of replacing it.
//
// ITS OWN MODULE with no JSX: mixing non-component exports into a component file
// drops that file out of React Fast Refresh (the instructionSort.js lesson), and
// a pure module can be exercised by vitest without pulling MUI into the test env.

import { EPIC_DONE, EPIC_RUNNING, EPIC_PENDING } from './pipelineModel';
// req #3226 — re-exported from the canvas colour-language module (the same
// swatch the plan visualizer's bubble/halo use) rather than a second literal,
// so the plan TABLE's "held" marker and the plan VISUALIZER's red agree by
// construction. This is the DOM-side home for a colour constant, matching
// `ELIGIBLE_MARKER_COLOR` below.
import { PAUSE_PAUSED_COLOR } from './pipelinePlanLayout';

export { PAUSE_PAUSED_COLOR };

// Derived epic state (rule 1) -> the human label the plan has always used.
// "Complete / Running / Scheduled" is the plan's vocabulary; done/running/pending
// is the engine's. Never show the engine's words to a user.
export const EPIC_STATE_LABEL = {
    [EPIC_DONE]: 'Complete',
    [EPIC_RUNNING]: 'Running',
    [EPIC_PENDING]: 'Scheduled',
};

export const epicStateLabel = (state) => EPIC_STATE_LABEL[state] || 'Scheduled';

const EPIC_STATE_CHIP = {
    [EPIC_DONE]: { bgcolor: '#1b5e20', color: '#a5e5ae' },
    [EPIC_RUNNING]: { bgcolor: '#6b4e00', color: '#ffd769' },
    [EPIC_PENDING]: { bgcolor: '#22314b', color: '#b9cbe4' },
};

// Filled-chip props for a derived epic state. Unknown state falls back to
// Scheduled rather than to MUI's default chip: an unlabelled chip in a plan
// column reads as a rendering fault, and Scheduled is the safe under-claim.
export const epicStateChipProps = (state) => ({
    sx: EPIC_STATE_CHIP[state] || EPIC_STATE_CHIP[EPIC_PENDING],
});

const RUN_CHIP = {
    auto: { bgcolor: '#1c3a52', color: '#8fd0ff' },
    manual: { bgcolor: '#6a1b6a', color: '#ff9bf5' },
};

export const runLabel = (run) => (run === 'manual' ? 'Manual' : 'Auto');

export const runChipProps = (run) => ({ sx: RUN_CHIP[run] || RUN_CHIP.auto });

// Row accents. `borderLeft` is applied to the row's FIRST cell (a <tr> cannot
// carry a border under `border-collapse: collapse` in every engine), matching
// the POC's `tr.active td:first-child` rule.
// A THIRD accent lived here until req #3371: a DASHED teal left edge marking a
// row as a member of a multi-epic launch group, which outranked `running` and
// `eligible` on style while leaving their tint alone. In Pipeline 2.0 the EPIC
// is the launch unit, so there is no membership to mark and every row's edge
// falls through to its own state colour.
export const ROW_ACCENT = {
    running: { tint: 'rgba(255,200,87,0.10)', edge: '3px solid #ffc857' },
    eligible: { tint: 'rgba(126,224,138,0.09)', edge: '3px solid #7ee08a' },
};

// The `/swarm-start` command's own code chip on an epic row (design rule 8).
// Teal, deliberately: it is the LAUNCH channel, distinct from the state hues
// (amber = in flight, green = done) the rest of this vocabulary reserves. The
// full-width banner these two colours were introduced for is gone; the command
// they style is not.
export const LAUNCH_ACCENT = {
    codeColor: '#7fe8da',
    codeBg: '#0d2b28',
};

// The eligible-now marker the POC rendered as `● eligible` beside the Run chip.
export const ELIGIBLE_MARKER_COLOR = '#4caf50';

// pipeline_status is the ONE hand-controlled lifecycle in this feature. Since
// req #3965 its seven values MIRROR the requirement statuses, in the
// requirement order, each wearing its mirror's chip colours
// (`requirementStatusChipProps`, statusChipStyles.js). The two orchestration
// values wear short labels — Ready and Running — so they fit the title bar
// (req #4105); the stored values are unchanged:
//
//   authoring           Authoring            ~ authoring
//   authorized          Authorized           ~ approved
//   orchestration_ready Ready                ~ swarm_ready
//   orchestrating       Running              ~ development
//   met                 Met                  ~ met
//   wontfix             Won't Fix            ~ wontfix
//   deferred            Deferred             ~ deferred
//
// Only `orchestrating` launches (the server derivation suppresses every epic of
// a plan in any other status). Every pipeline editor offers all seven, freely,
// as the requirement editors do — no transition table; the gateway derives
// started_at/completed_at from the value written. A NEW plan is `authoring`.
// There is no plan-level pause and no `closed` flag any more — the Pipelines
// page hides finished plans with its status pills.
export const PIPELINE_STATUS_VALUES = Object.freeze([
    'authoring', 'authorized', 'orchestration_ready', 'orchestrating', 'met', 'wontfix', 'deferred',
]);

/** The status a new plan is born with. */
export const NEW_PIPELINE_STATUS = 'authoring';

/** The one status under which a plan's epics launch. */
export const ORCHESTRATING_STATUS = 'orchestrating';

/** A finished plan: met, won't fix or deferred. */
export const TERMINAL_PIPELINE_STATUSES = Object.freeze(['met', 'wontfix', 'deferred']);
const TERMINAL_SET = new Set(TERMINAL_PIPELINE_STATUSES);
export const isTerminalPipelineStatus = (status) => TERMINAL_SET.has(status);

// The Pipelines page's status pills select the four non-terminal values by
// default, so a finished plan is put away until its pill is lit (req #3965 —
// this is what replaced the `closed` flag).
export const DEFAULT_PIPELINE_STATUSES = Object.freeze(
    PIPELINE_STATUS_VALUES.filter((s) => !TERMINAL_SET.has(s)));

const PIPELINE_STATUS_LABEL = {
    authoring: 'Authoring',
    authorized: 'Authorized',
    orchestration_ready: 'Ready',
    orchestrating: 'Running',
    met: 'Met',
    wontfix: "Won't Fix",
    deferred: 'Deferred',
};

/** The human label; an unknown stored value is shown as itself, never hidden. */
export const pipelineStatusLabel = (status) => PIPELINE_STATUS_LABEL[status] || String(status ?? '—');

const PIPELINE_STATUS_CHIP = {
    authoring: { bgcolor: '#fbc02d', color: '#000' },
    authorized: { bgcolor: '#90caf9', color: '#000' },
    orchestration_ready: { bgcolor: '#1976d2', color: '#fff' },
    orchestrating: { bgcolor: '#81c784', color: '#000' },
    met: { bgcolor: '#2e7d32', color: '#fff' },
    wontfix: { bgcolor: '#9e9e9e', color: '#fff' },
    deferred: { bgcolor: '#ff9800', color: '#fff' },
};

/** The chip's colours as `{bg, fg}` — for surfaces that are not MUI chips. */
export const pipelineStatusColors = (status) => {
    const c = PIPELINE_STATUS_CHIP[status];
    return c ? { bg: c.bgcolor, fg: c.color } : null;
};

// ── THE CANVAS TOOLBAR'S ONE CONTROL VOCABULARY (req #3261, S6 + S7) ────────
// The plan page's header row spoke SIX widget vocabularies — ToggleButtonGroup,
// Button, the shared level control's chips, Chip, IconButton and Typography —
// while the Build Visualizer expresses strictly MORE controls in one: a small
// Chip, filled when on and outlined when off. That is the vocabulary this
// returns, and it is the one `SemanticLevelControl` already speaks, so the row
// reads as a single control set including the shared component it cannot change.
//
// ONE HELPER RATHER THAN A CONVENTION because S7 has two halves — the VARIANT a
// sighted reader sees and the `aria-pressed` a screen reader hears — and every
// control that shipped with only the first half (the Counts and Time/Tokens
// toggles) is what P5 was filed about. Returning both together makes applying
// one without the other take deliberate effort.
//
// `pressed: false` is for the controls that are NOT toggles: Reset performs an
// action rather than holding a state, and the description button's fill reports
// whether there is prose behind it, which is a property of the DATA and not of
// the button. `aria-pressed` on either would tell a screen reader the control
// has an on position it does not have.
//
// A FILLED CHIP MUST RE-ASSERT ITS FILL ON HOVER AND ON FOCUS, and this is the
// whole reason the ON state is a constant rather than two lines at each call
// site (req #3261 code review — measured, not inferred). MUI's `clickable` Chip
// variant emits `&:hover { background-color: rgba(0,0,0,0.12) }` and
// `&.Mui-focusVisible { … 0.2 }` into the SAME emotion class as the `sx`
// declarations, and a pseudo-class selector is specificity (0,2,0) against the
// bare declaration's (0,1,0) — so hover wins whatever the source order. A chip
// styled `bgcolor: primary.main; color: primary.contrastText` therefore drops to
// near-white-on-white the instant the pointer lands on it, and the reader loses
// the ON state exactly while pointing at the control. `Button variant="contained"`
// and `.cal-toggle-btn.Mui-selected`, which this vocabulary replaced, both carry
// their own hover, so nothing about this was visible before.
const TOOLBAR_CHIP_ON_SX = {
    bgcolor: 'primary.main',
    color: 'primary.contrastText',
    '&:hover, &.Mui-focusVisible': { bgcolor: 'primary.dark' },
};

export const toolbarChipProps = (on, { pressed = true, sx } = {}) => ({
    size: 'small',
    ...(pressed ? { 'aria-pressed': on ? 'true' : 'false' } : {}),
    ...(on ? {} : { variant: 'outlined' }),
    // No `cursor: 'pointer'` — MUI's own `clickable` variant already emits it,
    // and every caller of this helper passes an `onClick`.
    sx: { ...(on ? TOOLBAR_CHIP_ON_SX : {}), ...sx },
});

export const pipelineStatusChipProps = (status) => (PIPELINE_STATUS_CHIP[status]
    ? { sx: { ...PIPELINE_STATUS_CHIP[status] } }
    : { color: 'default' });

// ---------------------------------------------------------------------------
// Pipeline 2.0 plan-layer editor chips (req #3393), added to this SHARED file
// rather than a separate one — req #3463's `PipelinesPage.jsx` already
// imports `pipelineStatusChipProps` straight from here for the identical
// `pipeline_status` vocabulary, which is the precedent this follows: the two
// eras share a vocabulary, they share the one function that colors it.
// ---------------------------------------------------------------------------

// initiative_status — active|paused (req #3393/#3336). NEW: no equivalent editable
// control exists in 1.0 at all, only a derived bubble. Amber-for-paused — since
// req #3965 the only pause there is (a plan no longer pauses).
const INITIATIVE_STATUS_CHIP = {
    active: { bgcolor: '#1c3a52', color: '#8fd0ff' },
    paused: { bgcolor: '#ff9800', color: '#000' },
};

export const initiativeStatus2Label = (status) => (status === 'paused' ? 'Paused' : 'Active');

export const initiativeStatus2ChipProps = (status) => ({
    sx: INITIATIVE_STATUS_CHIP[status] || INITIATIVE_STATUS_CHIP.active,
});

// ---------------------------------------------------------------------------
// req #3649 — the epic BARRIER flag and the plan-layer LOCKED flag.
// ---------------------------------------------------------------------------

// epics.checkpoint — 1 (the column default) HOLDS every epic
// downstream of this one until it is done; 0 makes it a launch PRIORITY only
// (its work goes out first, nothing waits on it). Amber for a hold — a
// deliberately warmer hue than the run chip's blue/magenta — and a quiet grey
// for priority. `undefined`/`null`
// reads as a barrier, because that is the column default.
const BARRIER_CHIP = {
    on: { bgcolor: '#5c3d00', color: '#ffcf70' },
    off: { bgcolor: '#33393f', color: '#c3cbd3' },
};

const isBarrier = (flag) => flag == null || Boolean(Number(flag));

export const barrierLabel = (flag) => (isBarrier(flag) ? 'Barrier' : 'Priority');

export const barrierChipProps = (flag) => ({
    sx: isBarrier(flag) ? BARRIER_CHIP.on : BARRIER_CHIP.off,
});

// locked — 1 freezes the row (and, cascading, everything under it) as a relic
// in time; enforcement is the gateway's (HTTP 423), these chips only show it.
// Locked is a dim grey FILL; Open is a plain outlined chip, so an unlocked row
// reads as the ordinary case.
export const lockedLabel = (flag) => (Number(flag) ? 'Locked' : 'Open');

export const lockedChipProps = (flag) => (Number(flag)
    ? { sx: { bgcolor: '#3a3f47', color: '#d7dde5' } }
    : { variant: 'outlined', sx: { bgcolor: 'transparent', color: '#9fb0c4', borderColor: '#4a5868' } });
