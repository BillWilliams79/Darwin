// PipelinePlanToolbar.jsx — the PLAN mode's own controls on the plan page's
// header row (req #3261, extracted from PipelineDetail.jsx).
//
// WHY IT IS ITS OWN FILE (P8 / S4). Both shipped visualizers keep the active
// mode's controls in a component of their own — `SwarmView.jsx` renders
// `<VisualizerToolbar />` and nothing else for its canvas mode, and this is that
// file's sibling. Inlined, these ~250 lines were a large part of why
// `PipelineDetail.jsx` was 1133 lines, and every one of them is dead in Table
// mode. The extraction is mechanical: same controls, same behaviour, same
// preference plumbing, all of it still owned by the page (this component holds
// no state and reads no storage).
//
// WHY IT RETURNS A FRAGMENT rather than a wrapping Box. The header row is a flex
// container whose group separators are its OWN children (P2), and the display
// group it contributes to also holds the Counts control, which is mode-
// independent and therefore stays on the page. A wrapper would make these
// controls one flex item, so the divider between the display group and the zoom
// group could not sit between them, the row's gap would no longer apply between
// the groups, and the DOM-order assertions PIPE-18 makes about the row's own
// children would be reading a box instead of the controls.
//
// THE VOCABULARY IS THE BUILD VISUALIZER'S (P1 / S6): a small Chip, filled when
// on, outlined when off, from `toolbarChipProps`. That is also what
// `SemanticLevelControl` speaks — the shared control this row cannot restyle
// without changing the Build Visualizer too — so converging on it is the only
// choice that makes the row ONE vocabulary rather than one-plus-the-shared-one.

import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import Stack from '@mui/material/Stack';
import Tooltip from '@mui/material/Tooltip';

import SemanticLevelControl from '../../Components/SemanticLevelControl';
// The group caption's ONE home (req #3261) — the same module
// `SemanticLevelControl` reads its own "Detail:" style from, so the three
// captions on this row cannot drift into three voices.
import { TOOLBAR_CAPTION_SX } from '../../Components/toolbarStyles';
import { PLAN_LEVEL_NUMBER } from './pipelinePlanLayout';
import { toolbarChipProps } from './pipelineChipStyles';

// Req #3168 — column width, the one piece of the plan's geometry a reader could
// not influence. It only ever WIDENS (see STEP_WIDTH_FACTORS): a narrower column
// than the content needs would push requirement marks out of their own slab,
// which is the zero-overlap contract the layout module proves.
// `name` is the ACCESSIBLE name and it starts with the VISIBLE one, which is
// WCAG 2.5.3 "Label in Name" and not a style preference: MUI's Tooltip injects
// its title as the child's `aria-label` unless the child sets its own, so these
// chips would display "S" and announce "Column width — compact" — a speech user
// asking for "S" would not reach the control they can see. MUI spreads the
// child's props LAST, so an `aria-label` here wins over the injected one.
const STEP_WIDTHS = [
    { value: 'compact', label: 'S', tip: 'Column width — compact',
        name: 'S — column width, compact' },
    { value: 'medium', label: 'M', tip: 'Column width — medium',
        name: 'M — column width, medium' },
    { value: 'wide', label: 'L', tip: 'Column width — wide',
        name: 'L — column width, wide' },
];

// ONE TOOLTIP PER CONTROL, never one over the group (P6 / S8). A single Tooltip
// wrapped both of these before, so it could say what the pair was FOR and could
// not say what either one DID — and the width group two positions to its left
// already tooltipped per button, so the row contradicted itself about its own
// rule. The tri-state hint stays on both, because clicking the pressed chip is
// how the third position is reached and that is not discoverable from either
// chip alone.
const COLOR_KEYS = [
    {
        value: 'state',
        label: 'State',
        tip: 'Colour the requirement marks by requirement STATUS — '
            + 'click again for none',
        name: 'State — colour the requirement marks by requirement status',
    },
    {
        value: 'machine',
        label: 'Machine',
        tip: 'Colour the requirement marks by the MACHINE that ran them — '
            + 'click again for none',
        name: 'Machine — colour the requirement marks by the machine that ran them',
    },
];

/**
 * @param {Object} props
 * @param {string} props.stepWidth              'compact' | 'medium' | 'wide'
 * @param {function} props.onChangeStepWidth    receives the new width
 * @param {string} props.colorKey               'state' | 'machine' | 'none'
 * @param {function} props.onChangeColorKey     receives 'state'|'machine'|'none'
 * @param {string} props.planLevelPref          'auto' | '1' | '2' | '3'
 * @param {?string} props.effectiveLevel        the canvas's 'out'|'mid'|'in'
 * @param {function} props.onChangeLevelPref    receives 'auto' | '1' | '2' | '3'
 * @param {function} props.onResetView          the Reset click
 */
export default function PipelinePlanToolbar({
    stepWidth,
    onChangeStepWidth,
    colorKey,
    onChangeColorKey,
    planLevelPref,
    effectiveLevel,
    onChangeLevelPref,
    onResetView,
}) {
    return (
        <>
            {/* ── DISPLAY GROUP, continued ────────────────────────────────────
                The Counts chip is the group's first member and lives on the page
                (it renders in BOTH modes). These two join it, so there is no
                divider before them. */}
            {/* P9 — "Width: S | M | L" put the group's NAME inside its first
                option, so the control read as one named by its first value and
                nothing else in Darwin does that. The name is a caption now, in
                the same voice `SemanticLevelControl` uses for "Detail:", and the
                three options are three equal chips. The GROUP keeps
                `pipeline-viz-stepwidth-toggle` so every existing locator finds
                it; the options gain ids of their own, which they needed anyway —
                a chip has no `value` attribute for a test to click by, and
                matching them by accessible name is what made
                `getByRole('button', {name: 'L'})` also match "Column width —
                compact". */}
            <Stack direction="row" spacing={0.5} useFlexGap alignItems="center"
                   sx={{ flexShrink: 0 }}
                   data-testid="pipeline-viz-stepwidth-toggle">
                <Box component="span" sx={TOOLBAR_CAPTION_SX}>Width:</Box>
                {STEP_WIDTHS.map(({ value, label, tip, name }) => (
                    <Tooltip key={value} title={tip}>
                        <Chip
                            label={label}
                            aria-label={name}
                            onClick={() => onChangeStepWidth(value)}
                            {...toolbarChipProps(stepWidth === value)}
                            data-testid={`pipeline-viz-width-${value}`}
                        />
                    </Tooltip>
                ))}
            </Stack>

            {/* The colour key for the REQUIREMENT MARKS, never the beads — the
                bead's fill is derived STEP state and stays that (the
                one-fact-one-channel-one-level rule in pipelinePlanLayout.js).

                THREE POSITIONS FROM TWO CHIPS, unchanged in behaviour by the
                move off `ToggleButtonGroup`. The group used to lean on MUI's
                exclusive-group `onChange(_, null)` to report the third position;
                chips have no group to fire that, so the "click the pressed one
                again" rule is spelled out here instead. `useViewPreference`
                ignores null, which is why 'none' is stored as a string.

                It gains a caption for the same reason Width did: two bare chips
                reading "State" and "Machine" name their own VALUES and leave the
                axis they select unstated, which is P9's defect with no first
                option to hide the name in. */}
            <Stack direction="row" spacing={0.5} useFlexGap alignItems="center"
                   sx={{ flexShrink: 0 }}
                   data-testid="pipeline-viz-colorkey-toggle">
                <Box component="span" sx={TOOLBAR_CAPTION_SX}>Colour:</Box>
                {COLOR_KEYS.map(({ value, label, tip, name }) => {
                    const on = colorKey === value;
                    return (
                        <Tooltip key={value} title={tip}>
                            <Chip
                                label={label}
                                aria-label={name}
                                onClick={() => onChangeColorKey(on ? 'none' : value)}
                                {...toolbarChipProps(on)}
                                data-testid={`pipeline-viz-colorkey-${value}`}
                            />
                        </Tooltip>
                    );
                })}
            </Stack>

            {/* ── ZOOM GROUP ──────────────────────────────────────────────────
                P2 / S5 — the single most legible thing the Build Visualizer
                does, and what makes twelve of its controls readable: groups
                separated by a vertical rule. This one closes the display group
                (what the plan DRAWS) and opens the zoom group (how much of it
                the reader is looking at). */}
            <Divider orientation="vertical" flexItem
                     sx={{ mx: 0.5, flexShrink: 0 }} />

            {/* THE SHARED COMPONENT, not a header-shaped copy of it — req #3168
                extracted it from the Build Visualizer precisely so two canvases
                doing semantic zoom cannot drift, and the Build Visualizer
                renders it in ITS header among chips too. `testIdPrefix` keeps
                every `pipeline-viz-level-*` hook byte-for-byte.

                It sits with Reset rather than beside Width now (req #3261 P2).
                Req #3241 put it next to Width on the reading that it is a layout
                control because the camera does not move across a level change —
                true of the MECHANISM, and the group is about what the READER is
                doing: Level and Reset are the two controls that answer "how much
                of this plan am I seeing", and Width, Colour and Counts are the
                three that answer "what is drawn on it".

                No `data-viz-chrome` here, unlike in the key: that attribute
                exempts a control from the canvas's two gesture filters, and
                those are bound to the canvas container. This row is outside it,
                so a mousedown here was never reachable as a pan gesture. */}
            <Box sx={{ display: 'flex', flexShrink: 0 }}>
                <SemanticLevelControl
                    // The page holds the pref as the CANVAS's vocabulary
                    // ('auto'|'1'|'2'|'3') and the reported level as the
                    // canvas's OTHER vocabulary ('out'|'mid'|'in'); the shared
                    // control speaks `null | 1 | 2 | 3` and is deliberately
                    // ignorant of what a level MEANS. Both translations happen
                    // here, which is the only place that knows both.
                    pinnedLevel={planLevelPref === 'auto'
                        ? null : Number(planLevelPref)}
                    effectiveLevel={PLAN_LEVEL_NUMBER[effectiveLevel] ?? null}
                    onChangePinnedLevel={(lvl) => onChangeLevelPref(
                        lvl == null ? 'auto' : String(lvl))}
                    testIdPrefix="pipeline-viz"
                />
            </Box>

            {/* Req #3216 — Reset, out of the bottom-right corner of the canvas
                it used to float in. FACTORY DEFAULT, not the readable landing
                scale the page opens on: one click always shows the whole plan's
                vertical extent, from any pan or zoom. Width re-centres on every
                change (it rescales every column), and does so onto WHICHEVER of
                the two scales is currently active — see `recenterModeRef` in
                PipelinePlanVisualizer.jsx — so clicking Width right after Reset
                keeps showing the whole plan instead of snapping back to the
                readable scale out from under its own neighbour.

                `pressed: false`: it performs an action and holds no state, so
                the `aria-pressed` every other chip on this row carries would
                announce an on position it does not have. */}
            <Tooltip title={'Reset — fully zoomed out, the whole '
                + "plan's vertical extent visible"}>
                <Chip
                    label="Reset"
                    // EXPLICIT, though the tooltip above happens to start with
                    // the visible word. Relying on that would make the wording
                    // of a tooltip load-bearing for WCAG 2.5.3 with nothing
                    // saying so: rewrite it as "Zoom out to the whole plan" and
                    // this chip silently displays "Reset" while announcing a
                    // sentence that never says it. Every other control on the
                    // row names itself; this one does too.
                    aria-label={'Reset — fully zoomed out, the whole '
                        + "plan's vertical extent visible"}
                    onClick={onResetView}
                    {...toolbarChipProps(false, {
                        pressed: false, sx: { flexShrink: 0 },
                    })}
                    data-testid="pipeline-viz-reset"
                />
            </Tooltip>
        </>
    );
}
