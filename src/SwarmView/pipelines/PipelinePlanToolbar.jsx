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
// container whose group separators are its OWN children (P2), so these controls
// have to BE that row's children: a wrapper would make them one flex item, the
// divider between the view group and the display group could not sit between
// them, the row's own `gap` would stop applying between the groups, and the
// DOM-order assertions PIPE-18 makes about the row's children would be reading a
// box instead of the controls.
//
// THE VOCABULARY IS THE BUILD VISUALIZER'S (P1 / S6): a small Chip, filled when
// on, outlined when off, from `toolbarChipProps`. That is also what
// `SemanticLevelControl` speaks — the shared control this row cannot restyle
// without changing the Build Visualizer too — so converging on it is the only
// choice that makes the row ONE vocabulary rather than one-plus-the-shared-one.
// Reset is the one deliberate exception and it is a COLOUR exception, not a
// widget one (req #3242 user directive — see its own note below).

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
import { PLAN_LEVEL_NUMBER, REQ_COLOR_SCALES } from './pipelinePlanLayout';
import { toolbarChipProps } from './pipelineChipStyles';

// Reset's wording, in ONE place: it is both the tooltip and the accessible name
// (see the chip below for why the two may not drift). It named the level too
// between req #3310 and req #3324, because Reset cleared the pin; #3324 made the
// level fixed until Auto is chosen, so Reset is about the camera and says so.
export const RESET_LABEL = 'Reset — fully zoomed out, the whole plan\'s vertical '
    + 'extent visible';

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

// THE COLOUR CHIPS ARE THE REGISTRY, not a copy of it (req #3422). This array
// used to be written out here, which meant a scale's LABEL lived in the toolbar
// while its COLOURS lived in `pipelinePlanLayout.js` — two files to edit for one
// scale, and nothing to catch a chip that named a scale the canvas could not
// paint. `REQ_COLOR_SCALES` carries both, so the third scale (Autonomy) reached
// this row without an edit to this file's control at all.
//
// ONE TOOLTIP PER CONTROL, never one over the group (P6 / S8), and the strings
// travel with the scale for that rule's own reason: a tooltip has to say what
// THAT chip does. A single Tooltip wrapped the pair before, so it could say what
// they were FOR and could not say what either one DID — and the width group two
// positions to its left already tooltipped per button, so the row contradicted
// itself about its own rule. The deselect hint is on every chip, because
// clicking the pressed one is how the neutral position is reached and that is
// not discoverable from any one chip.

/**
 * @param {Object} props
 * @param {string} props.stepWidth              'compact' | 'medium' | 'wide'
 * @param {function} props.onChangeStepWidth    receives the new width
 * @param {string} props.colorKey               a REQ_COLOR_KEYS value
 * @param {function} props.onChangeColorKey     receives a REQ_COLOR_KEYS value
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
            {/* ── VIEW GROUP — how much of the plan the reader is looking at ──
                LEADS the control set, and the order is req #3242's user
                directive, not a preference: Reset sits immediately LEFT of the
                level selector "ahead of the whole zoom/layout control cluster
                rather than trailing it". Req #3261 P2 named the groups in the
                opposite order, against a row that also still had a Counts
                toggle; #3242 removed that toggle and fixed this position, and it
                is the later and more specific instruction. What P2 asked for —
                that there BE groups, and that a rule separate them — is what is
                applied here.

                THE SHARED COMPONENT, not a header-shaped copy of it — req #3168
                extracted it from the Build Visualizer precisely so two canvases
                doing semantic zoom cannot drift, and the Build Visualizer
                renders it in ITS header among chips too. `testIdPrefix` keeps
                every `pipeline-viz-level-*` hook byte-for-byte.

                Reset rides INSIDE it as `leadingChildren` (req #3242) so the
                group reads "View: Reset Auto L1 L2 L3" as one control set. It is
                deliberately NOT in this file's chip vocabulary: the user asked
                for its own colour, as border + label only, "so this is a
                different KIND of control" is legible at a glance — it performs
                an action and is never part of the pinned-level state. That is a
                later and explicit instruction than S6, and S6's point (one
                widget TYPE, so the row reads as one control set) is unaffected
                by it — it is still a small Chip.

                Reset's behaviour: FACTORY DEFAULT — one click always shows the
                whole plan's vertical extent, from any pan or zoom. Since req
                #3312 that is ALSO the view the page opens on, so Reset means
                "back to where this plan started" rather than a second base view
                the landing had to be told about: it and Width's recentre apply
                one expression (`kFactoryDefault` in PipelinePlanVisualizer.jsx),
                and the ref that used to pick between two scales is gone. What
                the control still adds over the landing is the INTENT — it ends
                any `?epic=` re-fit, exactly as a drag does.

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
                    // req #3242 user directive — "Detail:" -> "View"
                    label="View"
                    leadingChildren={(
                        // RESET TOUCHES NO CHIP IN THIS GROUP (req #3324). Between
                        // req #3310 and #3324 it cleared the pinned level, and the
                        // label had to say so — a control that silently un-pins a
                        // chip immediately to its right is a surprise however right
                        // the behaviour is. The level is fixed until Auto is chosen
                        // now, so Reset is exactly what Width and Colour already
                        // were to it: unrelated. Its label says camera and nothing
                        // else.
                        <Tooltip title={RESET_LABEL}>
                            <Chip
                                label="Reset"
                                size="small"
                                variant="outlined"
                                // EXPLICIT, though the tooltip happens to start
                                // with the visible word. Relying on that would
                                // make the wording of a tooltip load-bearing for
                                // WCAG 2.5.3 with nothing saying so: rewrite it
                                // as "Zoom out to the whole plan" and this chip
                                // silently displays "Reset" while announcing a
                                // sentence that never says it. ONE constant now,
                                // so the visible and announced wordings cannot
                                // drift apart the next time either is edited.
                                aria-label={RESET_LABEL}
                                onClick={onResetView}
                                sx={{
                                    borderColor: 'secondary.main',
                                    color: 'secondary.main',
                                    cursor: 'pointer',
                                }}
                                data-testid="pipeline-viz-reset"
                            />
                        </Tooltip>
                    )}
                    testIdPrefix="pipeline-viz"
                />
            </Box>

            {/* ── GROUP SEPARATOR (req #3261 P2, S5) ──────────────────────────
                The single most legible thing the Build Visualizer does, and what
                makes twelve of its controls readable. This one closes the view
                group (how much of the plan the reader is looking at) and opens
                the display group (what is drawn on it). */}
            <Divider orientation="vertical" flexItem
                     sx={{ mx: 0.5, flexShrink: 0 }} />

            {/* ── DISPLAY GROUP — what the plan DRAWS ─────────────────────────
                P9 — "Width: S | M | L" put the group's NAME inside its first
                option, so the control read as one named by its first value and
                nothing else in Darwin does that. The name is a caption now, in
                the same voice `SemanticLevelControl` uses for its own label, and
                the three options are three equal chips. The GROUP keeps
                `pipeline-viz-stepwidth-toggle` so every existing locator finds
                it; the options gain ids of their own, which they needed anyway —
                a chip has no `value` attribute for a test to click by, and
                matching them by accessible name is what made
                `getByRole('button', {name: 'L'})` also match "Column width —
                compact".

                Req #3168 — column width is the one piece of the plan's geometry
                a reader could not influence. It only ever WIDENS (see
                STEP_WIDTH_FACTORS): a narrower column than the content needs
                would push requirement marks out of their own slab, which is the
                zero-overlap contract the layout module proves.

                The labels stay PLAIN (req #3242 user correction) — a same-turn
                attempt put the actual pixel widths in the button text and
                enlarged the buttons 25%, and both were reverted. Moving the
                group's name out to a caption makes them plainer still, which is
                the same direction. */}
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

                N+1 POSITIONS FROM N CHIPS, unchanged in behaviour by the move
                off `ToggleButtonGroup` and unchanged again by the third scale
                (req #3422). The group used to lean on MUI's exclusive-group
                `onChange(_, null)` to report the neutral position; chips have no
                group to fire that, so the "click the pressed one again" rule is
                spelled out here instead. `useViewPreference` ignores null, which
                is why 'none' is stored as a string.

                It gains a caption for the same reason Width did: bare chips
                reading "State", "Machine" and "Autonomy" name their own VALUES
                and leave the axis they select unstated, which is P9's defect
                with no first option to hide the name in. */}
            <Stack direction="row" spacing={0.5} useFlexGap alignItems="center"
                   sx={{ flexShrink: 0 }}
                   data-testid="pipeline-viz-colorkey-toggle">
                <Box component="span" sx={TOOLBAR_CAPTION_SX}>Colour:</Box>
                {REQ_COLOR_SCALES.map(({ key, chipLabel, chipTip, chipName }) => {
                    const on = colorKey === key;
                    return (
                        <Tooltip key={key} title={chipTip}>
                            <Chip
                                label={chipLabel}
                                aria-label={chipName}
                                onClick={() => onChangeColorKey(on ? 'none' : key)}
                                {...toolbarChipProps(on)}
                                data-testid={`pipeline-viz-colorkey-${key}`}
                            />
                        </Tooltip>
                    );
                })}
            </Stack>
        </>
    );
}
