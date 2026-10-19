import React, { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom';
import { lighten } from '@mui/material/styles';

import { useDrag, useDrop } from 'react-dnd';
import { useRequirementActions } from '../hooks/useRequirementActions';
import { elevatorStateFrom } from './detail/requirementSort';

import Box from '@mui/material/Box';
import TextField from '@mui/material/TextField';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import ListSubheader from '@mui/material/ListSubheader';
import Divider from '@mui/material/Divider';
import Check from '@mui/icons-material/Check';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import DeleteIcon from '@mui/icons-material/Delete';
import SavingsIcon from '@mui/icons-material/Savings';
import { orchestratedMarkSx, ORCHESTRATED_GOLD_FILL } from './orchestratedMarkStyles';
import { useSnackBarStore } from '../stores/useSnackBarStore';
import { watchFocusLoss } from '../utils/focusLossRecorder';
import { copyFocusCapture } from '../utils/focusCapture';
import { requirementStatusLabel } from './statusChipStyles';
import { AUTONOMY_ORDER, DEFAULT_PLAN_PALETTE, planPalette } from './pipelines/pipelinePlanLayout';
import { REQ_CARD_MONO, REQ_CARD_THEME as T, requirementKeyColor,
    requirementSpecSummary } from './requirementCardTheme';

// req #3644 — the two editable enums the row's menu sets directly. The status
// window is the one the retired cycle button allowed (authoring/approved/
// swarm_ready); every other status is set by the swarm lifecycle, not here.
const EDITABLE_STATUSES = ['authoring', 'approved', 'swarm_ready'];
// The menu's swatches are the plan's own default palette, so a choice in the
// menu wears the colour the State/Autonomy key will paint it.
const MENU_PALETTE = planPalette(DEFAULT_PLAN_PALETTE);

const Swatch = ({ color }) => (
    <Box component="span" sx={{ width: 12, height: 12, borderRadius: '3px', bgcolor: color,
                                display: 'inline-block', flexShrink: 0 }} />
);


const RequirementRow = ({ requirement, requirementIndex, categoryId, categoryName }) => {

    const navigate = useNavigate();
    const { statusClick, coordinationClick, titleChange, titleKeyDown,
        titleOnBlur, deleteClick, sessionStatusMap,
        // req #3644 — the plan colour key and every scale's view over this
        // card's rows, from the host card's `useRequirementColoring`.
        colorKey, colorViews,
        categoryColorMap, sortMode, setCrossCardInsertIndex,
        requirementsArray, setRequirementsArray,
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

    // Drag rules (req #2417):
    //   - Drag source is enabled for every non-template row, regardless of
    //     sortMode. Cross-card moves are valid in process / reverse modes too;
    //     in those modes the target card simply appends + persists category_fk
    //     without touching sort_order.
    //   - Same-card reorder still requires the target card's sortMode === 'hand'
    //     (gated in CategoryCard.addRequirementToCategory).
    //   - The aggregator card (SwarmStartCard) provides sortMode === 'created'
    //     and a no-op setCrossCardInsertIndex; aggregator rows can still be
    //     drag sources because the underlying requirement lives in some real
    //     CategoryCard, which is what gets re-categorized on drop.
    const isTemplate = requirement.id === '';
    const handSortActive = sortMode === 'hand';
    const [insertIndicator, setInsertIndicator] = useState(null);

    // Keep the latest requirement + index in refs so the drag `item` factory can
    // build a fresh payload at drag-start WITHOUT listing volatile fields in the
    // useDrag dep array. Previously `requirement.title` was a dep, so every
    // keystroke in the title field recreated the drag spec → new `drag`
    // connector → `mergedRef` identity churned → React detached/reattached the
    // row's DOM ref on every character. Reading `.current` at drag time keeps the
    // payload current without that per-keystroke churn (req #2747).
    const requirementRef = useRef(requirement);
    requirementRef.current = requirement;
    const requirementIndexRef = useRef(requirementIndex);
    requirementIndexRef.current = requirementIndex;

    const [{ isDragging }, drag] = useDrag(() => ({
        type: 'requirementRow',
        item: () => {
            // Spread the full requirement so cross-card moves carry every
            // field the target needs to render the row consistently
            // (coordination_type, started_at, deferred_at, completed_at, etc.)
            // until the next server refetch. Without this, the moved row
            // visually loses chips and tooltips for a few frames mid-drop.
            const rect = rowRef.current?.getBoundingClientRect();
            return {
                ...requirementRef.current,
                requirementIndex: requirementIndexRef.current,
                sourceWidth: rect?.width || 300,
                sourceHeight: rect?.height || 40,
            };
        },
        canDrag: () => !isTemplate,
        end: (item, monitor) => {
            // Always release the cross-card insert index — same-card splice
            // already cleared it in addRequirementToCategory; this covers the
            // no-drop / cancelled-drop / aggregator-drop / cross-card paths.
            if (setCrossCardInsertIndex) setCrossCardInsertIndex(null);

            const dropResult = monitor.getDropResult();
            if (!dropResult) return;
            if (!dropResult.crossCard) return;
            if (dropResult.requirement !== item.id) return;
            // Cross-card success: filter the moved row out of the source card's
            // local state — UNLESS the source is the aggregator. The aggregator
            // is filtered by status (e.g. swarm_ready), and the moved row still
            // matches that status, so it should remain visible. The cache
            // write-through in addRequirementToCategory keeps the byStatus
            // slice in sync; an explicit filter here would just cause a flicker
            // before the aggregator's useEffect re-seeds from cache.
            if (sortMode === 'created') return;
            if (setRequirementsArray) {
                setRequirementsArray(prev => prev ? prev.filter(p => p.id !== item.id) : prev);
            }
        },
        collect: (monitor) => ({
            isDragging: !!monitor.isDragging(),
        }),
        // Volatile requirement fields + requirementIndex are intentionally NOT
        // deps — the `item` factory reads them live from refs at drag-start, so
        // the spec/connector only needs to be rebuilt when behaviour-affecting
        // inputs change (canDrag → isTemplate; end → sortMode +
        // the setters).
    }), [isTemplate, sortMode, setCrossCardInsertIndex, setRequirementsArray]);

    // Hover-only drop target — sets the insert indicator above/below this row
    // and writes the splice target into the parent CategoryCard via
    // setCrossCardInsertIndex. canDrop returns false so the actual drop bubbles
    // to the card-level useDrop. The indicator only renders when THIS card is
    // in hand mode — in process / reverse the target card appends to the end,
    // so a positional indicator would lie.
    const [{ isRequirementOver }, requirementDrop] = useDrop(() => ({
        accept: 'requirementRow',
        canDrop: () => false,
        hover: (dragItem, monitor) => {
            if (!handSortActive) return;
            if (isTemplate) return;
            // Hovering over the same row → no indicator.
            if (dragItem.id === requirement.id) return;

            const hoverRect = rowRef.current?.getBoundingClientRect();
            if (!hoverRect) return;
            const clientOffset = monitor.getClientOffset();
            if (!clientOffset) return;
            const hoverClientY = clientOffset.y - hoverRect.top;
            const hoverMiddleY = (hoverRect.bottom - hoverRect.top) / 2;

            if (hoverClientY < hoverMiddleY) {
                setInsertIndicator('above');
                if (setCrossCardInsertIndex) setCrossCardInsertIndex(requirementIndex);
            } else {
                setInsertIndicator('below');
                if (setCrossCardInsertIndex) setCrossCardInsertIndex(requirementIndex + 1);
            }
        },
        collect: (monitor) => ({
            isRequirementOver: monitor.isOver(),
        }),
    }), [handSortActive, isTemplate, requirement.id, requirementIndex,
         setCrossCardInsertIndex]);

    useEffect(() => {
        if (!isRequirementOver) setInsertIndicator(null);
    }, [isRequirementOver]);

    const rowRef = useRef(null);
    const mergedRef = useCallback((node) => {
        rowRef.current = node;
        drag(node);
        requirementDrop(node);
    }, [drag, requirementDrop]);

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

    const sessionStatus = sessionStatusMap && sessionStatusMap[requirement.id];
    const status = requirement.requirement_status;
    const coordType = requirement.coordination_type || null;
    // Status and autonomy share one editable window (req #3054/#3056): before
    // launch. After it, both are history and the menu shows them read-only.
    const isEditable = EDITABLE_STATUSES.includes(status);

    // ── THE COLOUR KEY (req #3644) ─────────────────────────────────────────
    // The active scale's colour IS the text colour of the requirement's id and
    // title (user directive: "what we really want is the req ID and Req Title
    // text to become the color") — no stripe, no outline, no indicator icons,
    // so the title gets the whole width. ONE resolver — the same `reqIdStyle`
    // the plan canvas paints its ids with. 'none' (and the template row) reads
    // in the plan's plain text colour.
    const { color: keyColor, keyed } = requirementKeyColor({
        colorKey, views: colorViews, reqId: requirement.id === '' ? '' : Number(requirement.id) });
    const textColor = keyed ? keyColor : T.text;

    const [menuAnchorEl, setMenuAnchorEl] = useState(null);
    const closeMenu = () => setMenuAnchorEl(null);

    const isAggregatorRow = Boolean(categoryColorMap);
    const rowClassName = `task requirement-row${isAggregatorRow ? ' aggregator-row' : ''}`;

    // Category colour bar (aggregator only) — the category's own colour with a
    // same-hue LIGHTER edge (req #2752's rule), now always the dark-panel branch
    // because the cards are the plan's dark panel in both app themes.
    const barColor = categoryColorMap ? categoryColorMap[requirement.category_fk] : undefined;
    let barBorderColor = null;
    if (barColor) {
        try {
            barBorderColor = lighten(barColor, 0.45);
        } catch {
            // Non-parseable colour value — a neutral edge rather than a crash.
            barBorderColor = 'rgba(128,128,128,0.5)';
        }
    }

    // ── Title box: the plan's dark field, NO outline in any state ───────────
    // User directive (req #3644 review): "Remove all the text box outlines
    // completely" — resting, hover, focus and disabled alike. The colour key
    // lives in the TEXT; the box is the dark field alone. Composed WITH the
    // orchestrated mark: its gold fill (req #3419) still says "plan work", and
    // the no-outline rules are applied after it so its gold focus ring cannot
    // bring an outline back.
    const noOutline = { borderWidth: 0 };
    const markRoot = markSx['& .MuiOutlinedInput-root'] || {};
    const titleSx = {
        ...(status === 'met' && strikethroughMet && { textDecoration: 'line-through' }),
        ...((status === 'deferred' || status === 'wontfix') && { opacity: 0.5 }),
        '& .MuiOutlinedInput-root': {
            backgroundColor: T.field,
            color: textColor,
            borderRadius: `${T.fieldRadius}px`,
            fontSize: '0.95rem',
            lineHeight: 1.45,
            ...markRoot,
            // The gold fill LAYERED over the field, so plan work reads as the
            // dark field tinted gold rather than as the panel showing through.
            ...(isOrchestrated && { backgroundColor: T.field,
                backgroundImage: `linear-gradient(${ORCHESTRATED_GOLD_FILL}, ${ORCHESTRATED_GOLD_FILL})` }),
            '& .MuiOutlinedInput-notchedOutline': noOutline,
            '&:hover .MuiOutlinedInput-notchedOutline': noOutline,
            '&.Mui-focused .MuiOutlinedInput-notchedOutline': noOutline,
            '&.Mui-disabled .MuiOutlinedInput-notchedOutline': noOutline,
        },
        // `WebkitTextFillColor` too: MUI sets it on the input, and it wins over
        // `color` in WebKit/Blink. The caret follows the text.
        '& .MuiInputBase-input': { color: textColor, WebkitTextFillColor: textColor,
                                   caretColor: textColor },
        '& .MuiInputBase-input.Mui-disabled': { WebkitTextFillColor: T.dim },
        '& .MuiInputBase-input::placeholder': { color: T.dim, opacity: 1 },
    };

    // ── Requirement id — mono, in the key colour like its title ────────────
    // Clickable, navigates to detail; the tooltip carries the facts the retired
    // Status/Autonomy/Model/Effort icons used to show.
    const reqIdCell = (
        // Mono on the CELL too, so `ch` is the id face's glyph and every row's
        // title starts at the same x for ids up to five digits.
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-start',
                   fontFamily: REQ_CARD_MONO, fontSize: '0.9rem', minWidth: '5.5ch', pr: 1 }}>
            {requirement.id !== '' ? (
                // testid deliberately does NOT start with `requirement-` to avoid colliding with the
                // E2E prefix selector `[data-testid^="requirement-"]` used in swarm.spec.ts.
                <Tooltip title={requirementSpecSummary(requirement, sessionStatus)}
                         enterDelay={400} enterNextDelay={200}>
                    <Box component="button" type="button"
                         // req #3302 — hand the elevator the order this surface actually
                         // rendered. A category card and the aggregator show different
                         // lists of the same requirements, and only the surface knows which.
                         onClick={() => navigate(`/swarm/requirement/${requirement.id}`,
                                                 { state: elevatorStateFrom(requirementsArray) })}
                         aria-label={`Open requirement ${requirement.id}`}
                         data-testid={`req-id-chip-${requirement.id}`}
                         data-key-color={textColor}
                         sx={{ fontFamily: REQ_CARD_MONO, fontWeight: 600,
                               fontSize: '0.9rem', color: textColor,
                               background: 'transparent', border: 'none', p: 0,
                               cursor: 'pointer', letterSpacing: '0.02em',
                               '&:hover, &:focus-visible': { textDecoration: 'underline', outline: 'none' } }}>
                        {requirement.id}
                    </Box>
                </Tooltip>
            ) : null}
        </Box>
    );

    // ── Actions: one ⋮ menu holds what the indicator buttons used to do ─────
    const renderActions = () => {
        if (requirement.id === '') {
            return (
                <IconButton aria-label="Save requirement"
                            disabled = {categoryId !== '' ? false : categoryName === '' ? true : false}
                            sx = {{maxWidth: "28px", maxHeight: "28px", color: T.dim}}
                >
                    <SavingsIcon fontSize="small" />
                </IconButton>
            );
        }
        const id = requirement.id;
        return (
            <>
                <Tooltip title="Status, autonomy, open, delete" enterDelay={400} enterNextDelay={200}>
                    <IconButton onClick={(e) => setMenuAnchorEl(e.currentTarget)}
                                aria-label={`Requirement ${id} actions`}
                                data-testid={`req-menu-${id}`}
                                sx={{ maxWidth: '28px', maxHeight: '28px', color: T.dim,
                                      '&:hover': { color: T.text } }}>
                        <MoreVertIcon fontSize="small" />
                    </IconButton>
                </Tooltip>
                <Menu anchorEl={menuAnchorEl}
                      open={Boolean(menuAnchorEl)}
                      onClose={closeMenu}
                      anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
                      transformOrigin={{ vertical: 'top', horizontal: 'right' }}
                      slotProps={{ list: { dense: true } }}
                      data-testid={`req-menu-popup-${id}`}>
                    <ListSubheader sx={{ lineHeight: '30px' }}>
                        Status{isEditable ? '' : ` — ${requirementStatusLabel(status)}, locked`}
                    </ListSubheader>
                    {EDITABLE_STATUSES.map((v) => (
                        <MenuItem key={v} disabled={!isEditable}
                                  selected={status === v}
                                  onClick={() => { closeMenu(); if (v !== status) statusClick(requirementIndex, id, v); }}
                                  data-testid={`req-status-${id}-${v}`}>
                            <ListItemIcon><Swatch color={MENU_PALETTE.status[v]} /></ListItemIcon>
                            <ListItemText>{requirementStatusLabel(v)}</ListItemText>
                            {status === v && <Check fontSize="small" sx={{ ml: 1 }} />}
                        </MenuItem>
                    ))}
                    <ListSubheader sx={{ lineHeight: '30px' }}>
                        Autonomy{isEditable ? '' : ' — locked'}
                    </ListSubheader>
                    {AUTONOMY_ORDER.map((v) => (
                        <MenuItem key={v} disabled={!isEditable}
                                  selected={coordType === v}
                                  onClick={() => { closeMenu(); if (v !== coordType) coordinationClick(requirementIndex, id, v); }}
                                  data-testid={`req-autonomy-${id}-${v}`}>
                            <ListItemIcon><Swatch color={MENU_PALETTE.autonomy[v]} /></ListItemIcon>
                            <ListItemText sx={{ textTransform: 'capitalize' }}>{v}</ListItemText>
                            {coordType === v && <Check fontSize="small" sx={{ ml: 1 }} />}
                        </MenuItem>
                    ))}
                    <Divider />
                    <MenuItem onClick={() => { closeMenu();
                                  navigate(`/swarm/requirement/${id}`, { state: elevatorStateFrom(requirementsArray) }); }}
                              data-testid={`req-open-${id}`}>
                        <ListItemIcon><OpenInNewIcon fontSize="small" /></ListItemIcon>
                        <ListItemText>Open details</ListItemText>
                    </MenuItem>
                    <MenuItem onClick={(event) => { closeMenu(); deleteClick(event, id); }}
                              data-testid={`req-delete-${id}`}
                              sx={{ color: 'error.main' }}>
                        <ListItemIcon><DeleteIcon fontSize="small" sx={{ color: 'error.main' }} /></ListItemIcon>
                        <ListItemText>Delete</ListItemText>
                    </MenuItem>
                </Menu>
            </>
        );
    };

    return (
        <Box className={rowClassName}
             data-testid={requirement.id === '' ? 'requirement-template' : `requirement-${requirement.id}`}
             data-key-color={requirement.id === '' ? undefined : keyColor}
             key={`box-${requirement.id}`}
             ref={isTemplate ? null : mergedRef}
             sx={{
                 // The plan's panel shows through: a row is a line on the card,
                 // not a white strip (`.task` paints `--darwin-task-bg`).
                 background: 'transparent',
                 py: '3px',
                 // While dragging, collapse the source row in hand mode (so
                 // the splice preview at the insert indicator is uncluttered).
                 // In process / reverse modes the row instead fades — there's
                 // no in-card splice preview to make room for, but feedback
                 // that THIS row is the one being dragged is still useful.
                 ...(isDragging && handSortActive && {
                     height: 0, minHeight: 0, overflow: 'hidden',
                     padding: 0, margin: 0, opacity: 0,
                 }),
                 ...(isDragging && !handSortActive && { opacity: 0.2 }),
                 ...(!isTemplate && { cursor: 'grab' }),
                 ...(insertIndicator === 'above' && { borderTop: '3px solid', borderTopColor: T.accent }),
                 ...(insertIndicator === 'below' && { borderBottom: '3px solid', borderBottomColor: T.accent }),
             }}
        >
            {/* Col 1 (aggregator only): Category color bar */}
            {isAggregatorRow && (
                <Box
                    data-testid={requirement.id !== '' ? `category-color-bar-${requirement.id}` : undefined}
                    sx={{
                        minWidth: 14,
                        display: 'flex',
                        alignItems: 'stretch',
                        justifyContent: 'flex-start',
                        alignSelf: 'stretch',
                        py: '3px',
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

            {reqIdCell}

            {/* Title */}
            <TextField variant="outlined"
                        value={requirement.title || ''}
                        name='title'
                        onChange = {(event) => titleChange(event, requirementIndex) }
                        onKeyDown = {(event) => titleKeyDown(event, requirementIndex, requirement.id)}
                        onBlur = {(event) => titleOnBlur(event, requirementIndex, requirement.id)}
                        onMouseDown={(e) => e.stopPropagation()}
                        onTouchStart={(e) => e.stopPropagation()}
                        multiline
                        disabled = {categoryId !== '' ? false : categoryName === '' ? true : false}
                        autoComplete ='off'
                        // `req-title-`, NOT `requirement-title-`: `requirement-`
                        // is a ROW-level prefix namespace, selected wholesale by
                        // `[data-testid^="requirement-"]` in swarm.spec.ts and in
                        // req #3428's epic-filter specs. A title testid under it
                        // makes every such selector return two nodes per row —
                        // caught by those specs, and it would have broken E2E.
                        data-testid={requirement.id === '' ? undefined
                            : `req-title-${requirement.id}`}
                        data-orchestrated={requirement.id === '' ? undefined
                            : String(isOrchestrated)}
                        sx = {titleSx}
                        size = 'small'
                        slotProps={{ htmlInput: { maxLength: 256 } }}
                        inputRef={isTemplate ? titleInputRef : undefined}
                        key={`title-${requirement.id}`}
             />

            {/* Actions — the ⋮ menu, or the template row's save icon. */}
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', pl: 0.5 }}>
                {renderActions()}
            </Box>
        </Box>
    )
}

export default RequirementRow
