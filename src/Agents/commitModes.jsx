// A CONSISTENT VISUAL LANGUAGE FOR "WHEN DOES THIS SAVE?" (req #3101, § 1).
//
// THE PROBLEM THIS SOLVES. The document card mixes FIVE distinct commit models on
// one surface, and before this module none of them was distinguishable from any
// other until you interacted with it:
//
//   blur-commit          name, url — click away and it is written
//   blur-then-confirm    location, but only when an agent autoloads the document
//   click-commit         doc_type chips, owner claim, agent bind
//   staged behind Save   the link popover's roles + notes
//   read-only here       agent_documents.sort_order, owned by AgentDetail
//
// Every one of those is individually correct and each has a written reason (see
// DocumentLinkPopover's header for why the Save button exists, and
// DocumentLocationDialog's for why one field gets a dialog). The defect was that
// the reasons are invisible: a user learns which control is which by clicking it.
//
// OPTION (a), NOT OPTION (b). The requirement offered a choice between giving the
// commit types a consistent visual language and REDUCING the number of interaction
// patterns. This is the first. It is the reversible one — every existing control
// keeps working exactly as it did, and nothing a user has already learned changes.
// Collapsing the patterns would change behaviour people already have, and each of
// the five exists to satisfy a constraint that would still be there afterwards
// (no PUT on an id-less junction; a DB-unique ownership key; a field an LLM
// executes). Option (b) stays open and is a design conversation, not a polish pass.
//
// THE MARKER IS DISPLAY ONLY. It renders an icon and a tooltip. It never gates,
// disables, intercepts or defers a write, so a marker that is wrong is a wrong
// caption and not a broken control — which is the property that makes it safe to
// put on nine regions at once (seven on a card, two in the link popover).

import Box from '@mui/material/Box';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import ReportProblemOutlinedIcon from '@mui/icons-material/ReportProblemOutlined';
import TouchAppOutlinedIcon from '@mui/icons-material/TouchAppOutlined';
import SaveOutlinedIcon from '@mui/icons-material/SaveOutlined';
import LockOutlinedIcon from '@mui/icons-material/LockOutlined';

/**
 * The five commit models, as data.
 *
 * `label` is the two-or-three-word name shown in the legend. `description` is the
 * full sentence shown in a marker's tooltip — written to say what will HAPPEN, not
 * to name the mechanism, because "commits on blur" is jargon for the only audience
 * that does not need the marker.
 */
export const COMMIT_MODES = {
    blur: {
        id: 'blur',
        label: 'saves when you click away',
        description: 'Type and click away — the value is written immediately. '
            + 'Press Escape to abandon the edit instead.',
        Icon: EditOutlinedIcon,
    },
    confirm: {
        id: 'confirm',
        label: 'asks before saving',
        description: 'Clicking away opens a confirmation naming what the change '
            + 'affects. Nothing is written until you accept it.',
        Icon: ReportProblemOutlinedIcon,
    },
    click: {
        id: 'click',
        label: 'saves on click',
        description: 'One click writes immediately. There is no Save button and '
            + 'no confirmation — clicking a different value is the undo.',
        Icon: TouchAppOutlinedIcon,
    },
    staged: {
        id: 'staged',
        label: 'staged until you press Save',
        description: 'Changes here are held and written together when you press '
            + 'Save. Cancel or clicking away discards them.',
        Icon: SaveOutlinedIcon,
    },
    readOnly: {
        id: 'readOnly',
        label: 'read-only here',
        description: 'Shown for context and edited on a different page. Nothing '
            + 'here can change it.',
        Icon: LockOutlinedIcon,
    },
};

/** Legend order: increasing ceremony, then the one that is not an edit at all. */
export const COMMIT_MODE_ORDER = ['click', 'blur', 'confirm', 'staged', 'readOnly'];

/**
 * One small muted icon saying how the control beside it commits.
 *
 * `note` is APPENDED to the mode's own description rather than replacing it, so a
 * region with a wrinkle (the agent chips, where adding is a click but removing
 * confirms) can say so without a second copy of the base sentence drifting from
 * this file.
 */
export const CommitModeMarker = ({ mode, note, testId, sx }) => {
    const spec = COMMIT_MODES[mode];
    // An unknown mode renders NOTHING rather than a fallback icon. A marker is a
    // claim about behaviour; a placeholder would be a claim nobody made.
    if (!spec) return null;
    const { Icon, label, description } = spec;
    const title = note ? `${description} ${note}` : description;

    return (
        <Tooltip title={title}>
            {/* A span so the tooltip has a real element to hang off even when the
                icon itself is inside a flex row that would otherwise collapse it.
                `role="img"` is what makes `aria-label` reliable here — on a
                role-less generic element it is weakly supported.
                THE WHOLE SENTENCE GOES IN THE LABEL, not the short name, and there
                is deliberately NO `tabIndex`. Making each marker focusable would
                surface the tooltip to keyboard users, but it puts SEVEN
                non-interactive stops on every card — roughly 580 across the live
                registry — between a keyboard user and the fields they came to
                edit. A screen reader reads this label without any of them, and
                `CommitModeLegend` renders every mode's name as visible text for
                sighted keyboard users, so nothing is only-on-hover. */}
            <Box
                component="span"
                role="img"
                aria-label={`Saving: ${label}. ${title}`}
                sx={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    color: 'text.disabled',
                    flexShrink: 0,
                    cursor: 'help',
                    ...sx,
                }}
                data-testid={testId}
                data-commit-mode={spec.id}
            >
                <Icon sx={{ fontSize: '0.95rem' }} />
            </Box>
        </Tooltip>
    );
};

/**
 * The key, rendered once per page.
 *
 * INLINE SPANS ONLY, and that is a hard constraint rather than a style: this is
 * rendered inside ViewerHeader's `accounting` node, which the header wraps in a
 * `<Typography variant="body2">` — a `<p>`. A `<div>` inside a `<p>` is invalid
 * HTML that React hydrates around by silently closing the paragraph early, so the
 * accounting line and the legend would end up in different blocks.
 */
export const CommitModeLegend = ({ modes = COMMIT_MODE_ORDER, testIdPrefix }) => (
    <Box
        component="span"
        sx={{ display: 'inline-flex', flexWrap: 'wrap', alignItems: 'center',
              columnGap: 1.5, rowGap: 0.25, ml: 0.5 }}
        data-testid={testIdPrefix ? `${testIdPrefix}-commit-legend` : undefined}
    >
        {modes.map(id => {
            const spec = COMMIT_MODES[id];
            if (!spec) return null;
            const { Icon, label, description } = spec;
            return (
                <Tooltip key={id} title={description}>
                    <Box component="span"
                         sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.375,
                               color: 'text.disabled', cursor: 'help' }}
                         data-testid={testIdPrefix ? `${testIdPrefix}-commit-legend-${id}` : undefined}>
                        <Icon sx={{ fontSize: '0.95rem' }} />
                        <Typography component="span" variant="caption">{label}</Typography>
                    </Box>
                </Tooltip>
            );
        })}
    </Box>
);
