// SemanticLevelControl.jsx — the shared "Detail: Auto | L1 | L2 | L3" selector
// (extracted by req #3168 from BuildVisualizerControls.jsx, where req #2864
// built it).
//
// WHY IT WAS EXTRACTED RATHER THAN COPIED. The user asked the Plan visualizer
// for "the L1, L2, L3 and Auto selector used elsewhere" — i.e. the one they
// already know. Two canvases in this app now do semantic zoom (the Konva Build
// Visualizer and the Plan visualizer), both auto-select a level from the zoom
// ratio, and both need the same escape hatch. A visually identical second copy
// would be the same control with two places to change it, and the first
// divergence would be invisible on either page alone.
//
// The three behaviours are the ones the Build Visualizer settled on, kept
// verbatim because they are what the user has learned:
//
//   · Auto is a POSITION, not the absence of one — it is a chip you can click
//     back to, and it is pressed while nothing is pinned.
//   · Clicking the CURRENTLY PINNED level unpins it (back to Auto). A pinned
//     control with no way out except a second control is a trap.
//   · While on Auto, the level the canvas is actually rendering is SOFTLY marked
//     (outlined in the primary colour, not filled), so the control reports the
//     derived answer without claiming it was chosen.
//
// WHAT A CANVAS OWES THIS CONTROL (req #3324, the user's ruling — and it binds
// every consumer, present and future):
//
//   · FOUR MODES, NO FIFTH. Auto runs the resolution algorithm; L1/L2/L3 are
//     each a fixed rule set for what is displayed.
//   · A PIN IS ABSOLUTE. The chosen level applies regardless of the viewport's
//     size and regardless of the zoom, and stays until Auto is chosen. A canvas
//     that suppresses, demotes or "corrects" a pinned level has not implemented
//     this control — that was the req #3280/#3310 defect in the Plan visualizer,
//     twice reported and fixed in #3324.
//   · A PIN MOVES NOTHING BUT PIXELS. It is not a zoom button; the camera is the
//     reader's.
//   · RESET IS NOT ONE OF THE MODES. A neighbouring Reset restores the view and
//     leaves the level pinned.
//
// The pattern doc is `memory/semantic-zoom-control.md` (Frontend Architect),
// which is where a NEW visualizer should start rather than from either canvas.
//
// The control is deliberately ignorant of what a "level" MEANS. It speaks
// `null | 1 | 2 | 3`; each canvas maps that to its own vocabulary — the Build
// Visualizer's `autoLevel()` returns 1|2|3 directly, the Plan visualizer's
// `semanticLevel()` returns 'out'|'mid'|'in' and is mapped in
// `pipelinePlanLayout.js` (`PLAN_LEVEL_BY_PREF` / `PLAN_LEVEL_NUMBER`).
//
// `testIdPrefix` exists so the Build Visualizer keeps its `bv-level-*` test ids
// byte-for-byte through the extraction: a shared component that renames the
// hooks its existing callers are found by is a refactor with a blast radius,
// which is precisely what extracting it was meant to avoid.

import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Stack from '@mui/material/Stack';

// req #3261 — the caption's style moved to a pure module so the plan page's
// Width and Colour captions are literally the same three properties rather than
// a second copy of them. Two places to change one voice is the drift S9 exists
// to prevent, and it would be invisible on either surface alone.
import { TOOLBAR_CAPTION_SX } from './toolbarStyles';

/**
 * @param {Object} props
 * @param {?number} props.pinnedLevel        null = auto-by-zoom; 1|2|3 = pinned
 * @param {?number} props.effectiveLevel     the level actually being rendered
 * @param {function} props.onChangePinnedLevel  receives null | 1 | 2 | 3
 * @param {string} [props.testIdPrefix]      'bv' keeps the Build Visualizer's ids
 * @param {string} [props.label]             the leading caption
 * @param {React.ReactNode} [props.leadingChildren]  controls inside the group,
 *        BEFORE the Auto chip (req #3242 — Reset reads "View: Reset Auto L1…").
 *        Unlike Auto/L1/L2/L3 these are not part of the pinned-level state —
 *        the caller owns whatever they do.
 * @param {React.ReactNode} [props.children] trailing controls inside the group
 */
export default function SemanticLevelControl({
    pinnedLevel = null,
    effectiveLevel = null,
    onChangePinnedLevel,
    testIdPrefix = 'semantic',
    label = 'Detail:',
    leadingChildren = null,
    children = null,
}) {
    if (!onChangePinnedLevel) return null;
    return (
        <Stack direction="row" spacing={0.5} useFlexGap alignItems="center"
               data-testid={`${testIdPrefix}-level-control`}>
            {label != null && (
                // Omissible (req #3168): inside the Plan visualizer's key every
                // section already carries its own uppercase caption, so the
                // control's built-in "Detail:" would be a second label in a
                // different typographic voice on the same row.
                <Box component="span" sx={TOOLBAR_CAPTION_SX}>
                    {label}
                </Box>
            )}
            {leadingChildren}
            <Chip
                label="Auto"
                size="small"
                onClick={() => onChangePinnedLevel(null)}
                // The hover/focus re-assertion is NOT decoration (req #3261 code
                // review): MUI's `clickable` variant emits `&:hover` and
                // `&.Mui-focusVisible` background rules into the same emotion
                // class as these declarations, at (0,2,0) specificity against
                // their (0,1,0) — so without it a pressed chip drops to
                // near-white-on-white the moment the pointer lands on it, and
                // the reader loses the pressed state exactly while pointing at
                // the control. Same defect, same fix, in
                // `pipelineChipStyles.toolbarChipProps`.
                {...(pinnedLevel == null
                    ? { sx: { bgcolor: 'primary.main', color: 'primary.contrastText', cursor: 'pointer',
                        '&:hover, &.Mui-focusVisible': { bgcolor: 'primary.dark' } } }
                    : { variant: 'outlined', sx: { cursor: 'pointer' } })}
                aria-pressed={pinnedLevel == null ? 'true' : 'false'}
                data-testid={`${testIdPrefix}-level-auto`}
            />
            {[1, 2, 3].map((lvl) => {
                const pinned = pinnedLevel === lvl;
                // When on Auto, softly mark the level the zoom is currently at.
                const isAutoActive = pinnedLevel == null && effectiveLevel === lvl;
                return (
                    <Chip
                        key={lvl}
                        label={`L${lvl}`}
                        size="small"
                        onClick={() => onChangePinnedLevel(pinned ? null : lvl)}
                        // `text.secondary` on hover, not a `.dark` shade —
                        // `text.primary` is a text colour and has none. It reads
                        // as a slight lift in the light theme and a slight dim in
                        // the dark one, i.e. feedback in both, and the chip stays
                        // unmistakably filled either way.
                        {...(pinned
                            ? { sx: { bgcolor: 'text.primary', color: 'background.paper', cursor: 'pointer',
                                '&:hover, &.Mui-focusVisible': { bgcolor: 'text.secondary' } } }
                            : {
                                variant: 'outlined',
                                sx: {
                                    cursor: 'pointer',
                                    ...(isAutoActive && {
                                        borderColor: 'primary.main',
                                        color: 'primary.main',
                                        fontWeight: 600,
                                    }),
                                },
                            })}
                        aria-pressed={pinned ? 'true' : 'false'}
                        data-testid={`${testIdPrefix}-level-${lvl}`}
                    />
                );
            })}
            {children}
        </Stack>
    );
}
