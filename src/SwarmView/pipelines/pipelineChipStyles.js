// pipelineChipStyles.js — the plan-table chip vocabulary (req #3114).
//
// Values are carried VERBATIM from the archived POC stylesheet in req #3080 and
// the groomed rules in memory/swarm-orchestration.md § "UI rules — plan table":
//
//   Complete  dark-green + check      Running  amber (row tinted, amber left edge)
//   Scheduled neutral                 Manual   magenta        Auto  blue
//   Eligible  green left edge + tint + a "eligible" marker
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

import { STEP_DONE, STEP_RUNNING, STEP_PENDING } from './pipelineModel';
// req #3226 — re-exported from the canvas colour-language module (the same
// swatch the plan visualizer's bubble/halo use) rather than a second literal,
// so the plan TABLE's "held" marker and the plan VISUALIZER's red agree by
// construction. This is the DOM-side home for a colour constant, matching
// `ELIGIBLE_MARKER_COLOR` below.
import { PAUSE_PAUSED_COLOR } from './pipelinePlanLayout';

export { PAUSE_PAUSED_COLOR };

// Derived step state (rule 1) -> the human label the plan has always used.
// "Complete / Running / Scheduled" is the plan's vocabulary; done/running/pending
// is the engine's. Never show the engine's words to a user.
export const STEP_STATE_LABEL = {
    [STEP_DONE]: 'Complete',
    [STEP_RUNNING]: 'Running',
    [STEP_PENDING]: 'Scheduled',
};

export const stepStateLabel = (state) => STEP_STATE_LABEL[state] || 'Scheduled';

const STEP_STATE_CHIP = {
    [STEP_DONE]: { bgcolor: '#1b5e20', color: '#a5e5ae' },
    [STEP_RUNNING]: { bgcolor: '#6b4e00', color: '#ffd769' },
    [STEP_PENDING]: { bgcolor: '#22314b', color: '#b9cbe4' },
};

// Filled-chip props for a derived step state. Unknown state falls back to
// Scheduled rather than to MUI's default chip: an unlabelled chip in a plan
// column reads as a rendering fault, and Scheduled is the safe under-claim.
export const stepStateChipProps = (state) => ({
    sx: STEP_STATE_CHIP[state] || STEP_STATE_CHIP[STEP_PENDING],
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
export const ROW_ACCENT = {
    running: { tint: 'rgba(255,200,87,0.10)', edge: '3px solid #ffc857' },
    eligible: { tint: 'rgba(126,224,138,0.09)', edge: '3px solid #7ee08a' },
    // Batch members carry a DASHED edge so a row that is both eligible and a
    // batch member still reads as "in a batch" — the two never fight because a
    // batch member's edge wins on style while the tint stays the eligible one.
    batchMember: { edge: '3px dashed #4ad9c8' },
};

// Launch-batch banner + legend accent (design rule 8).
export const BATCH_ACCENT = {
    color: '#4ad9c8',
    bg: 'rgba(74,217,200,0.07)',
    borderTop: '1px dashed #4ad9c8',
    borderBottom: '1px dashed rgba(74,217,200,0.4)',
    codeColor: '#7fe8da',
    codeBg: '#0d2b28',
};

// The eligible-now marker the POC rendered as `● eligible` beside the Run chip.
export const ELIGIBLE_MARKER_COLOR = '#4caf50';

// pipeline_status is the ONE hand-controlled lifecycle in this feature
// (req #3111): draft|active|paused|completed|aborted. Human/Primary intent about
// the plan as a whole — deliberately NOT derived, unlike a step's state.
export const PIPELINE_STATUS_VALUES = ['draft', 'active', 'paused', 'completed', 'aborted'];

// req #3220 — default-visible statuses for the list page's status filter.
// `paused` stays IN: pausing a plan is a normal, reversible operating state the
// Primary or user can resume any time, not an archival one — unlike `completed`
// and `aborted`, which are what the default is actually trying to get out of
// the way. Excluding `paused` would hide a plan the instant someone pauses it.
export const DEFAULT_PIPELINE_STATUSES = ['draft', 'active', 'paused'];

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

export const pipelineStatusChipProps = (status) => {
    switch (status) {
        case 'draft':     return { sx: { bgcolor: '#546e7a', color: '#fff' } };
        case 'active':    return { sx: { bgcolor: '#6b4e00', color: '#ffd769' } };
        case 'paused':    return { sx: { bgcolor: '#ff9800', color: '#000' } };
        case 'completed': return { sx: { bgcolor: '#1b5e20', color: '#a5e5ae' } };
        case 'aborted':   return { sx: { bgcolor: '#9e9e9e', color: '#fff' } };
        default:          return { color: 'default' };
    }
};
