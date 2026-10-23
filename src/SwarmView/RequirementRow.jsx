import React, { memo, useEffect, useMemo, useRef } from 'react'
import { useNavigate } from 'react-router-dom';
import { useTheme, darken, lighten, alpha } from '@mui/material/styles';

import { useDarwinDrag, isLiftBlur } from '../dnd';
import { useRequirementActions } from '../hooks/useRequirementActions';
import { elevatorStateFrom } from './detail/requirementSort';

import Box from '@mui/material/Box';
import TextField from '@mui/material/TextField';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import Chip from '@mui/material/Chip';
import DeleteIcon from '@mui/icons-material/Delete';
import SavingsIcon from '@mui/icons-material/Savings';
import RocketLaunchIcon from '@mui/icons-material/RocketLaunch';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import EditNoteIcon from '@mui/icons-material/EditNote';
import TaskAltIcon from '@mui/icons-material/TaskAlt';
import PlayCircleIcon from '@mui/icons-material/PlayCircle';
import PauseCircleIcon from '@mui/icons-material/PauseCircle';
import HourglassTopIcon from '@mui/icons-material/HourglassTop';
import AutoFixHighIcon from '@mui/icons-material/AutoFixHigh';
import BiotechIcon from '@mui/icons-material/Biotech';
import DoNotDisturbOnIcon from '@mui/icons-material/DoNotDisturbOn';
import BlockIcon from '@mui/icons-material/Block';
import DescriptionIcon from '@mui/icons-material/Description';
import BuildIcon from '@mui/icons-material/Build';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import ForumIcon from '@mui/icons-material/Forum';
import RadioButtonUncheckedIcon from '@mui/icons-material/RadioButtonUnchecked';
import PendingIcon from '@mui/icons-material/Pending';
import { coordinationIconColor } from './coordinationChipStyles';
import SyncIcon from '@mui/icons-material/Sync';
import DoneAllIcon from '@mui/icons-material/DoneAll';
import ModelEffortIcon from './ModelEffortIcon';
import { modelEffortGridTemplate } from './modelEffortLayout';
import { useModelEffortDisplayStore } from '../stores/useModelEffortDisplayStore';
import { orchestratedMarkSx } from './orchestratedMarkStyles';
import { useSnackBarStore } from '../stores/useSnackBarStore';
import { watchFocusLoss } from '../utils/focusLossRecorder';
import { copyFocusCapture } from '../utils/focusCapture';


// One row's height (a single-line title) — the size of the slot a lifted
// requirement leaves in a hand-sorted card, however long its title is.
const SLOT_HEIGHT = 40;

/**
 * A requirement row that lifts (req #3663, on the dnd-kit foundation). The
 * WHOLE row is the grip — title text included: a quick click still places the
 * caret, a hold (touch, or a long mouse click) or a 4 px mouse move lifts it.
 * Which list it belongs to and whether that list honours a position come from
 * the caller; the row only renders the drag state.
 *
 * @param {Object} props.drag  { id, type, containerId, policy, sortMode, disabled }
 */
export const SortableRequirementRow = ({ drag, ...props }) => {
    const { ref, style, attributes, listeners, isDragging } = useDarwinDrag({ ...drag, row: props.requirement });
    // The sortable hook re-runs on every pointer move of any drag on the page;
    // the row it feeds only re-renders when something it SHOWS changed.
    const handle = useMemo(() => ({ ref, style, attributes, listeners, isDragging }),
        [ref, style, attributes, listeners, isDragging]);
    return <RequirementRow {...props} drag={handle} honoursPosition={drag.policy.reorderAllowed(drag.sortMode)} />;
};

/**
 * One requirement row. Without `drag` it is a plain row (the template add-row,
 * or an aggregator row while it is carried into a card) and touches no
 * drag-and-drop context at all. `carriedAway`: this row's requirement is being
 * carried into a card elsewhere and this list keeps it (the aggregator) — it
 * shows dimmed in place.
 */
const RequirementRow = memo(({ requirement, requirementIndex, categoryId, categoryName,
                               drag = null, honoursPosition = false, carriedAway = false }) => {

    const { categoryColorMap } = useRequirementActions();
    // Model + Effort column preferences (req #3029). The columns always render in
    // the aggregator card; `showOnAllCards` promotes them onto CategoryCard rows
    // too. Rendering is always a small colored icon in the standard column order
    // (req #3043 removed the display-mode/column-order choices; req #3046 replaced
    // the pill with an icon to match Status/Autonomy).
    const showModelEffortOnAllCards = useModelEffortDisplayStore(s => s.showOnAllCards);

    // req #3029 — whether THIS row renders the Model + Effort columns. Decided at
    // the card level (aggregator always; category cards only when the user opts
    // in) so every row in a card agrees, keeping the shared grid template aligned.
    // The two cells are rendered for the template row too (as empty placeholders)
    // so its Title/delete stay in the same tracks as the data rows above it.
    //
    // The full grid-template is built here (single source of truth in
    // modelEffortLayout.js) and applied via the `--me-grid` CSS custom property +
    // the `me-cols` class. It must go through the class, NOT `sx`: `sx` compiles
    // to a single-class rule (0,1,0) that loses to the base
    // `.task.requirement-row[.aggregator-row]` templates in index.css (0,2,0 /
    // 0,3,0). The `.me-cols` selectors there outrank those, so the injected
    // template actually wins and the track count matches the rendered cells.
    const isAggregatorRow = Boolean(categoryColorMap);
    const showModelEffortColumns = isAggregatorRow || showModelEffortOnAllCards;
    const rowClassName = `task requirement-row${isAggregatorRow ? ' aggregator-row' : ''}${showModelEffortColumns ? ' me-cols' : ''}`;
    const modelEffortGridColumns = showModelEffortColumns
        ? modelEffortGridTemplate({ isAggregatorRow })
        : undefined;

    // The slot this row leaves while it is lifted. Where a position is honoured
    // it travels with the sort, one row tall and tinted — the insert feedback;
    // elsewhere it just dims in place.
    const isLifted = !!drag?.isDragging;

    return (
        <Box className={rowClassName}
             data-testid={requirement.id === '' ? 'requirement-template' : `requirement-${requirement.id}`}
             data-dragging={isLifted ? 'true' : undefined}
             key={`box-${requirement.id}`}
             ref={drag?.ref}
             {...(drag ? { ...drag.attributes, ...drag.listeners } : {})}
             // req #3029 — inline custom property consumed by the `.me-cols` rules
             // in index.css (see the grid-template comment above). Set via `style`
             // (a real inline custom property) rather than `sx` so it reliably
             // reaches the higher-specificity class selector. The drag style
             // (slide transform, press cue) rides the same attribute.
             style={{ ...drag?.style, ...(modelEffortGridColumns && { '--me-grid': modelEffortGridColumns }) }}
             sx={(theme) => ({
                 // Smooth every DnD-driven visual change so drops and reorders
                 // glide instead of snapping. Sibling reflow is the sortable's
                 // own transform transition (inline style).
                 transition: 'opacity 160ms ease, background-color 160ms ease, box-shadow 160ms ease',
                 borderRadius: 1,
                 ...(drag && { cursor: 'grab', '&:focus-visible': { outline: `2px solid ${theme.palette.primary.main}`, outlineOffset: -2 } }),
                 ...(isLifted && honoursPosition && {
                     maxHeight: SLOT_HEIGHT,
                     overflow: 'hidden',
                     alignItems: 'start',
                     backgroundColor: alpha(theme.palette.primary.main, 0.1),
                     boxShadow: `inset 0 0 0 2px ${alpha(theme.palette.primary.main, 0.45)}`,
                     '& > *': { opacity: 0.35 },
                 }),
                 ...(isLifted && !honoursPosition && { opacity: 0.3 }),
                 ...(carriedAway && { opacity: 0.3 }),
             })}
        >
            <RequirementRowContent {...{ requirement, requirementIndex, categoryId, categoryName,
                                         isAggregatorRow, showModelEffortColumns }} />
        </Box>
    );
});

/**
 * What a row SHOWS, memoized apart from how it MOVES (req #3663, as TaskEdit):
 * while a drag passes, a sorting row's position style changes many times, and
 * re-rendering the auto-sizing title field each time forces a layout read per
 * row per shift.
 */
const RequirementRowContent = memo(({ requirement, requirementIndex, categoryId, categoryName,
                                      isAggregatorRow, showModelEffortColumns }) => {

    const navigate = useNavigate();
    const theme = useTheme();
    const { statusClick, coordinationClick, titleChange, titleKeyDown,
        titleOnBlur, deleteClick, sessionStatusMap,
        categoryColorMap,
        requirementsArray,
        // req #3419 — the set the visibility toggle hides by, so a row that IS
        // on screen can still be MARKED as plan work. Same set, never a second
        // derivation.
        orchestratedIds,
        strikethroughMet = true } = useRequirementActions();

    // req #3419 — MARK the plan work. The toggle in the header hides it; when the
    // reader turns the toggle OFF, orchestrated and unplanned rows sit side by
    // side with nothing to tell them apart, and that is the state the reader is
    // in precisely when the distinction matters.
    //
    // THE SAME SET, not a second answer. `orchestratedIds` comes from the host
    // card's `useRequirementVisibility()` — the one hook that decides what the
    // toggle hides — so a row can never be gold and visible-under-hiding, nor
    // plain and hidden. Marking and hiding are one predicate (req #3419's whole
    // point); computing "is this orchestrated" here would be the sixth copy.
    //
    // The template add-row is never marked: its id is '', and `Number('')` is 0,
    // which is not a requirement id. Guarded explicitly anyway rather than relying
    // on that — the same guard `pipelineMembership` makes.
    // Absent context (a host that predates this) → undefined → no marking, which
    // degrades to the previous appearance rather than throwing.
    const isOrchestrated = requirement.id !== ''
        && !!orchestratedIds?.has(Number(requirement.id));

    // ONE fixed appearance — there is nothing to configure. Memoized anyway
    // because `sx` identity drives MUI's style recomputation and this row
    // re-renders on every keystroke in its own title field.
    const markSx = React.useMemo(
        () => orchestratedMarkSx({ isOrchestrated }),
        [isOrchestrated]);

    // Drag (req #3663): the row lifts from anywhere on it — see
    // SortableRequirementRow. The template add-row never drags (its host renders
    // it without one); only a card whose sort mode honours a position shows its
    // rows sliding aside, and elsewhere the card highlights as a whole.
    const isTemplate = requirement.id === '';

    // req #3632 — ALWAYS-ON capture of the intermittent template-title focus
    // loss (req #2884's opt-in logger recorded nothing in four months: nobody
    // has DevTools open when it surprises them). Inert until the template title
    // is focused; when focus is taken WITHOUT the reader asking, it names the
    // culprit in the snackbar and keeps the full report in
    // `window.__darwinFocusLoss`. Req #3652: the alert's "Copy for Claude"
    // button puts the whole capture on the clipboard, so the reader pastes it
    // instead of working out what to say. See `utils/focusLossRecorder.js`
    // for what counts as a loss, `utils/focusCapture.js` for the capture.
    const titleInputRef = useRef(null);
    const showMessage = useSnackBarStore(s => s.showMessage);
    const focusLossLabel = isTemplate ? `template title (${categoryName || 'category'})` : null;
    useEffect(() => {
        if (!isTemplate) return;
        return watchFocusLoss(titleInputRef.current, {
            label: focusLossLabel,
            onLoss: (report) => showMessage(
                `Focus taken from ${report.label} — ${report.cause}: ${report.culprit}.`,
                {
                    duration: 30000,
                    action: {
                        label: 'Copy for Claude',
                        onClick: () => copyFocusCapture({ reason: 'focus-loss alert', report }),
                    },
                }),
        });
    }, [isTemplate, focusLossLabel, showMessage]);

    // Determine status for indicator
    const sessionStatus = sessionStatusMap && sessionStatusMap[requirement.id];
    const status = requirement.requirement_status;
    const canCycleStatus = ['authoring', 'approved', 'swarm_ready'].includes(status);

    const getStatusIcon = () => {
        if (requirement.id === '') return null;
        if (status === 'met')          return <CheckCircleIcon sx={{ fontSize: 18, color: 'success.main' }} />;
        if (status === 'deferred')     return <DoNotDisturbOnIcon sx={{ fontSize: 18, color: '#ff9800' }} />;
        if (status === 'wontfix')      return <BlockIcon sx={{ fontSize: 18, color: '#9e9e9e' }} />;
        // Session-status icons (req #2332). Rocket = active/implementing; each other
        // status gets its own glyph, colored to match its chip.
        if (sessionStatus === 'starting')   return <PendingIcon sx={{ fontSize: 18, color: 'info.main' }} />;
        if (sessionStatus === 'waiting')    return <HourglassTopIcon sx={{ fontSize: 18, color: '#ff3b30' }} />;  // attention red, same as review (req #3656)
        if (sessionStatus === 'planning')   return <AutoFixHighIcon sx={{ fontSize: 18, color: '#4fc3f7' }} />;
        if (sessionStatus === 'active')     return <RocketLaunchIcon sx={{ fontSize: 18, color: '#4caf50' }} />;  // implementing
        if (sessionStatus === 'review')     return <BiotechIcon sx={{ fontSize: 18, color: '#ff3b30' }} />;  // attention red (req #3636)
        if (sessionStatus === 'paused')     return <PauseCircleIcon sx={{ fontSize: 18, color: '#f0d000' }} />;
        if (sessionStatus === 'completing') return <SyncIcon sx={{ fontSize: 18, color: 'info.main' }} />;
        if (sessionStatus === 'completed')  return <DoneAllIcon sx={{ fontSize: 18, color: 'success.main' }} />;
        if (sessionStatus)               return <RocketLaunchIcon sx={{ fontSize: 18, color: '#4caf50' }} />;  // unknown → in-flight
        if (status === 'development')  return <RocketLaunchIcon sx={{ fontSize: 18, color: '#4caf50' }} />;
        if (status === 'swarm_ready')  return <PlayCircleIcon sx={{ fontSize: 18, color: 'primary.main' }} />; // Swarm-Start
        if (status === 'approved')     return <TaskAltIcon sx={{ fontSize: 18, color: '#90caf9' }} />; // lighter blue
        return <EditNoteIcon sx={{ fontSize: 18, color: '#fbc02d' }} />; // authoring yellow
    };

    const statusTooltip = {
        met: 'Met', deferred: 'Deferred', wontfix: "Won't Fix", development: 'Development',
        swarm_ready: 'Swarm-Start — click to cycle', approved: 'Approved — click to cycle',
        authoring: 'Authoring — click to cycle',
    };

    // Session-status tooltip labels (req #2843). One entry per session-status glyph in
    // getStatusIcon() so the hover text always names the icon actually shown. `active`
    // reads as "Implementing" to match the rocket glyph's implementing semantics.
    const sessionStatusTooltip = {
        starting: 'Starting', waiting: 'Waiting for input', planning: 'Planning',
        active: 'Implementing', review: 'Review', paused: 'Paused',
        completing: 'Completing', completed: 'Completed',
    };

    // Tooltip for the status icon. Mirrors getStatusIcon() precedence EXACTLY so the
    // popup text can never disagree with the glyph (req #2843 — fixes a planning
    // session showing the wand glyph but a "Development" tooltip, because the old
    // tooltip read requirement_status before sessionStatus while the icon does the
    // reverse): terminal requirement statuses first, then live sessionStatus, then
    // the requirement's own status.
    const getStatusTooltip = () => {
        if (status === 'met')      return statusTooltip.met;
        if (status === 'deferred') return statusTooltip.deferred;
        if (status === 'wontfix')  return statusTooltip.wontfix;
        if (sessionStatus)         return sessionStatusTooltip[sessionStatus] || sessionStatus;
        return statusTooltip[status] || status;
    };

    const coordType = requirement.coordination_type || null;
    const getCoordinationIcon = () => {
        if (requirement.id === '') return null;
        // Autonomy-progression colors — pink → purple → blue → green (req #2866).
        if (coordType === 'discuss')     return <ForumIcon sx={{ fontSize: 18, color: coordinationIconColor('discuss') }} />; // pink
        if (coordType === 'planned')     return <DescriptionIcon sx={{ fontSize: 18, color: coordinationIconColor('planned') }} />; // purple
        if (coordType === 'implemented') return <BuildIcon sx={{ fontSize: 18, color: coordinationIconColor('implemented') }} />; // blue
        if (coordType === 'deployed')    return <CloudUploadIcon sx={{ fontSize: 18, color: coordinationIconColor('deployed') }} />; // green
        return <RadioButtonUncheckedIcon sx={{ fontSize: 16, color: 'text.disabled' }} />;
    };

    const coordTooltip = {
        discuss: 'Discuss Req — click to cycle',
        planned: 'Planned — click to cycle', implemented: 'Implemented — click to cycle',
        deployed: 'Deployed — click to cycle',
    };

    // --- Status cell — small icon --------------------------------------------
    // Status, Autonomy, Model and Effort all render as small icons, on every card
    // including the aggregator (req #3046). Model/Effort are icons via
    // ModelEffortIcon (a colored glyph, not a pill) — the #3029/#3043 pill
    // rendering was the regression this req fixes. Clickable IconButton when the
    // status is cyclable, bare tooltip'd icon otherwise; keeps the
    // `status-toggle-<id>` test id.
    const renderStatusCell = () => {
        if (requirement.id === '') return null;
        return canCycleStatus ? (
            <Tooltip title={statusTooltip[status] || status} enterDelay={400} enterNextDelay={200}>
                <IconButton
                    onClick={() => statusClick(requirementIndex, requirement.id)}
                    data-testid={`status-toggle-${requirement.id}`}
                    sx={{ maxWidth: 28, maxHeight: 28 }}
                >
                    {getStatusIcon()}
                </IconButton>
            </Tooltip>
        ) : (
            <Tooltip title={getStatusTooltip()} enterDelay={400} enterNextDelay={200}>
                {getStatusIcon()}
            </Tooltip>
        );
    };

    // --- Autonomy cell — small icon ------------------------------------------
    // Always visible, for every status — including authoring/approved and the
    // terminal met/wontfix/deferred — so every card shows which autonomy mode
    // a requirement is set to or shipped under (req #3056). Editable window
    // matches RequirementDetail's coordination_type editor (req #3054):
    // authoring/approved/swarm_ready; locked everywhere else. Keeps the
    // `coordination-toggle-<id>` test id.
    const renderAutonomyCell = () => {
        if (requirement.id === '') return null;
        const isCoordEditable = ['authoring', 'approved', 'swarm_ready'].includes(status);
        const tooltip = isCoordEditable
            ? (coordTooltip[coordType] || 'No autonomy — click to set')
            : 'Locked — not editable';
        const testId = `coordination-toggle-${requirement.id}`;
        return (
            <Tooltip title={tooltip} enterDelay={400} enterNextDelay={200}>
                <span>
                    <IconButton
                        onClick={() => coordinationClick(requirementIndex, requirement.id)}
                        disabled={!isCoordEditable}
                        aria-label={tooltip}
                        data-testid={testId}
                        sx={{ maxWidth: 28, maxHeight: 28, '&.Mui-disabled': { opacity: 1 } }}
                    >
                        {getCoordinationIcon()}
                    </IconButton>
                </span>
            </Tooltip>
        );
    };

    // Category color bar fill + delineating edge (req #2752).
    // Verified root cause: the bar already renders the exact category color
    // (DOM bgcolor === the category hex), so the fill is correct. The failure
    // is pure luminance contrast — a pale color like DarwinUI #f2e982 sits at
    // ~1.25:1 against the white light-mode card and reads as invisible; the
    // symmetric case is a very dark color against the dark-mode charcoal card.
    // Fix: keep the true category color as the fill and outline the bar with a
    // SAME-HUE shade of that color — darkened in light mode, lightened in dark
    // — so the stripe always has a visible edge and still reads as its own
    // category color (not washed to gray, which the prior attempt did and which
    // hid the hue identity).
    const barColor = categoryColorMap ? categoryColorMap[requirement.category_fk] : undefined;
    let barBorderColor = null;
    if (barColor) {
        try {
            barBorderColor = theme.palette.mode === 'dark'
                ? lighten(barColor, 0.45)
                : darken(barColor, 0.4);
        } catch {
            // Non-parseable color value — fall back to a neutral divider edge
            // rather than crashing the row render.
            barBorderColor = 'rgba(128,128,128,0.5)';
        }
    }

    // The two Model/Effort cells (empty placeholders on the template row so the
    // grid stays aligned), or null when the card isn't showing them. They always
    // sit at the end of the value cells (standard order — req #3043 removed the
    // column-order choice); the grid template in modelEffortLayout.js matches.
    // Rendered as small colored icons (req #3046), matching Status/Autonomy.
    const modelEffortCells = showModelEffortColumns ? (
        <>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', px: '2px' }}>
                {requirement.id !== '' && (
                    <ModelEffortIcon
                        kind="model"
                        value={requirement.ai_model}
                        data-testid={`model-cell-${requirement.id}`}
                    />
                )}
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', px: '2px' }}>
                {requirement.id !== '' && (
                    <ModelEffortIcon
                        kind="effort"
                        value={requirement.effort}
                        data-testid={`effort-cell-${requirement.id}`}
                    />
                )}
            </Box>
        </>
    ) : null;

    // Requirement # chip — clickable, navigates to detail.
    const reqIdCell = (
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minWidth: 44, pr: '2px' }}>
            {requirement.id !== '' ? (
                // testid deliberately does NOT start with `requirement-` to avoid colliding with the
                // E2E prefix selector `[data-testid^="requirement-"]` used in swarm.spec.ts.
                <Tooltip title="Open requirement details" enterDelay={400} enterNextDelay={200}>
                    <Chip
                        label={requirement.id}
                        size="small"
                        variant="outlined"
                        clickable
                        // req #3302 — hand the elevator the order this surface actually
                        // rendered. A category card and the aggregator show different
                        // lists of the same requirements, and only the surface knows which.
                        onClick={() => navigate(`/swarm/requirement/${requirement.id}`,
                                                { state: elevatorStateFrom(requirementsArray) })}
                        aria-label={`Open requirement ${requirement.id}`}
                        data-testid={`req-id-chip-${requirement.id}`}
                    />
                </Tooltip>
            ) : null}
        </Box>
    );

    // Status — small icon. Clickable cycle for authoring/approved/swarm_ready.
    const statusCell = (
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minWidth: 28,
                   overflow: 'hidden' }}>
            {renderStatusCell()}
        </Box>
    );

    // Autonomy — small icon, always visible; editable only for swarm_ready
    // (req #3056).
    const autonomyCell = (
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minWidth: 28,
                   overflow: 'hidden' }}>
            {renderAutonomyCell()}
        </Box>
    );

    // Value cells in the standard order (req #3029; req #3043 removed the
    // column-order choice, so this is the only arrangement now). When the card
    // isn't showing Model/Effort, modelEffortCells is null and drops out,
    // collapsing to Req# · Status · Autonomy.
    const orderedValueCells = <>{reqIdCell}{statusCell}{autonomyCell}{modelEffortCells}</>;

    return (
        <>
            {/* Col 1 (aggregator only): Category color bar */}
            {isAggregatorRow && (
                <Box
                    data-testid={requirement.id !== '' ? `category-color-bar-${requirement.id}` : undefined}
                    sx={{
                        minWidth: 24,
                        display: 'flex',
                        alignItems: 'stretch',
                        justifyContent: 'center',
                    }}
                >
                    {requirement.id !== '' && (
                        <Box sx={{
                            width: 6,
                            alignSelf: 'stretch',
                            minHeight: 24,
                            bgcolor: barColor || 'transparent',
                            ...(barColor && {
                                border: '1px solid',
                                borderColor: barBorderColor,
                            }),
                            borderRadius: '3px',
                        }} />
                    )}
                </Box>
            )}

            {/* Value cells (Req#, Status, Autonomy, Model, Effort) — standard
                order (req #3029). */}
            {orderedValueCells}

            {/* Title */}
            <TextField variant="outlined"
                        value={requirement.title || ''}
                        name='title'
                        onChange = {(event) => titleChange(event, requirementIndex) }
                        onKeyDown = {(event) => titleKeyDown(event, requirementIndex, requirement.id)}
                        // A blur caused by the lift itself is not an edit ending
                        // (the press focused the field, then the row lifted).
                        onBlur = {(event) => { if (!isLiftBlur(event)) titleOnBlur(event, requirementIndex, requirement.id); }}
                        multiline
                        disabled = {categoryId !== '' ? false : categoryName === '' ? true : false}
                        autoComplete ='off'
                        // `req-title-`, NOT `requirement-title-`: `requirement-`
                        // is a ROW-level prefix namespace, selected wholesale by
                        // `[data-testid^="requirement-"]` in swarm.spec.ts and in
                        // req #3428's initiative-filter specs. A title testid under it
                        // makes every such selector return two nodes per row —
                        // caught by those specs, and it would have broken E2E.
                        data-testid={requirement.id === '' ? undefined
                            : `req-title-${requirement.id}`}
                        data-orchestrated={requirement.id === '' ? undefined
                            : String(isOrchestrated)}
                        sx = {{...(status === 'met' && strikethroughMet && {textDecoration: 'line-through'}), ...((status === 'deferred' || status === 'wontfix') && {opacity: 0.5}),
                               // req #3419 — the gold ORCHESTRATED mark. The row
                               // renders it; it does not DECIDE it. Both halves
                               // live elsewhere on purpose: whether this row is
                               // orchestrated comes from the one visibility hook,
                               // and what the mark looks like from the one pure
                               // `orchestratedMarkSx`. An empty object here means
                               // an unmarked row is byte-identical to before.
                               ...markSx,
                        }}
                        size = 'small'
                        slotProps={{ htmlInput: { maxLength: 256 } }}
                        inputRef={isTemplate ? titleInputRef : undefined}
                        key={`title-${requirement.id}`}
             />

            {/* Col 6: Delete / Savings — padded so the icon sits between the title editor edge and the card edge,
                biased slightly toward the title editor. */}
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', pl: 1, pr: 1.25 }}>
            { requirement.id === '' ?
                    <IconButton key={`savings-${requirement.id}`}
                                aria-label="Save requirement"
                                disabled = {categoryId !== '' ? false : categoryName === '' ? true : false}
                                sx = {{maxWidth: "25px",
                                       maxHeight: "25px",
                                }}
                    >
                        <SavingsIcon key={`savings1-${requirement.id}`}/>
                    </IconButton>
                :
                    <Tooltip title="Delete requirement" enterDelay={400} enterNextDelay={200}>
                        <IconButton onClick={(event) => deleteClick(event, requirement.id)}
                                    key={`delete-${requirement.id}`}
                                    sx = {{maxWidth: "25px",
                                           maxHeight: "25px",
                                    }}
                        >
                            <DeleteIcon key={`delete1-${requirement.id}`} />
                        </IconButton>
                    </Tooltip>
            }
            </Box>
        </>
    )
});

export default RequirementRow
