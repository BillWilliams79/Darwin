import React, { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom';
import { useTheme, darken, lighten } from '@mui/material/styles';

import { useDrag, useDrop } from 'react-dnd';
import { useRequirementActions } from '../hooks/useRequirementActions';

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
import { coordinationIconColor, coordinationChipProps } from './coordinationChipStyles';
import SyncIcon from '@mui/icons-material/Sync';
import DoneAllIcon from '@mui/icons-material/DoneAll';
import ModelEffortChip from './ModelEffortChip';
import { modelEffortGridTemplate } from './modelEffortLayout';
import { useModelEffortDisplayStore } from '../stores/useModelEffortDisplayStore';
import { requirementStatusChipProps, requirementStatusLabel } from './statusChipStyles';
import { swarmStatusChipProps, swarmStatusLabel } from './swarmStatusChipProps';


const RequirementRow = ({ requirement, requirementIndex, categoryId, categoryName }) => {

    const navigate = useNavigate();
    const theme = useTheme();
    const { statusClick, coordinationClick, titleChange, titleKeyDown,
        titleOnBlur, deleteClick, sessionStatusMap,
        categoryColorMap, sortMode, setCrossCardInsertIndex,
        requirementsArray, setRequirementsArray,
        strikethroughMet = true } = useRequirementActions();

    // Model + Effort column preferences (req #3029). The columns always render in
    // the aggregator card; `showOnAllCards` promotes them onto CategoryCard rows
    // too. `displayMode` chooses pill / text / compact rendering.
    const showModelEffortOnAllCards = useModelEffortDisplayStore(s => s.showOnAllCards);
    const modelEffortDisplayMode = useModelEffortDisplayStore(s => s.displayMode);
    const modelEffortColumnOrder = useModelEffortDisplayStore(s => s.columnOrder);

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
        // inputs change (canDrag → isTemplate; end → sortMode + the setters).
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

    // req #2884 — dev-only, OPT-IN diagnostic for the intermittent template-title
    // focus loss (root cause not yet identified; req re-opened when it reproduces).
    // Silent by default so it never spams dev consoles. Enable in DevTools with:
    //     window.__req2884Focus = true   (or localStorage.setItem('req2884Focus','1'))
    // Then reproduce the focus loss and read the last [req2884] line:
    //   • "UNMOUNTED WHILE FOCUSED" → the field REMOUNTED (reconciliation), not a steal.
    //   • "BLURRED … activeElementAfter: X" → focus was STOLEN to element X.
    const titleInputRef = useRef(null);
    useEffect(() => {
        if (!import.meta.env.DEV || !isTemplate) return;
        const enabled = () => {
            try {
                return Boolean(window.__req2884Focus) || localStorage.getItem('req2884Focus') === '1';
            } catch { return false; }
        };
        const el = titleInputRef.current;
        if (!el) return;
        const describe = (n) => {
            if (!n) return String(n);
            if (n === document.body) return 'document.body';
            const testid = n.closest?.('[data-testid]')?.getAttribute('data-testid');
            return `${n.tagName.toLowerCase()}${testid ? `[testid=${testid}]` : ''}${n.name ? `[name=${n.name}]` : ''}`;
        };
        const onBlur = (e) => {
            if (!enabled()) return;
            const related = e.relatedTarget;
            // Defer one tick so document.activeElement settles after the blur.
            setTimeout(() => {
                // eslint-disable-next-line no-console
                console.warn('[req2884] template title BLURRED', {
                    stillInDOM: document.contains(el),
                    relatedTarget: describe(related),
                    activeElementAfter: describe(document.activeElement),
                });
            }, 0);
        };
        el.addEventListener('blur', onBlur);
        return () => {
            el.removeEventListener('blur', onBlur);
            // If this fires while the field is focused, the field REMOUNTED (focus loss
            // by reconciliation), not a steal.
            if (enabled() && document.activeElement === el) {
                // eslint-disable-next-line no-console
                console.warn('[req2884] template title UNMOUNTED WHILE FOCUSED → remount caused the focus loss');
            }
        };
    }, [isTemplate]);

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
        if (sessionStatus === 'waiting')    return <HourglassTopIcon sx={{ fontSize: 18, color: '#ffb74d' }} />;
        if (sessionStatus === 'planning')   return <AutoFixHighIcon sx={{ fontSize: 18, color: '#4fc3f7' }} />;
        if (sessionStatus === 'active')     return <RocketLaunchIcon sx={{ fontSize: 18, color: '#4caf50' }} />;  // implementing
        if (sessionStatus === 'review')     return <BiotechIcon sx={{ fontSize: 18, color: '#ce93d8' }} />;
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

    const isAggregatorRow = Boolean(categoryColorMap);

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
    const showModelEffortColumns = isAggregatorRow || showModelEffortOnAllCards;
    const rowClassName = `task requirement-row${isAggregatorRow ? ' aggregator-row' : ''}${showModelEffortColumns ? ' me-cols' : ''}`;
    const modelEffortGridColumns = showModelEffortColumns
        ? modelEffortGridTemplate({ isAggregatorRow, displayMode: modelEffortDisplayMode, columnOrder: modelEffortColumnOrder })
        : undefined;

    // req #3029 — the display mode actually applied to THIS row's Status /
    // Autonomy / Model / Effort columns. Only the enhanced rows (aggregator, or
    // category cards with the option on) follow the user's pill/text/compact
    // choice; every other row is pinned to 'compact', which reproduces today's
    // icon look exactly, so plain category cards are visually unchanged.
    const effectiveDisplayMode = showModelEffortColumns ? modelEffortDisplayMode : 'compact';

    // Status label + chip color for the pill/text renderings — mirror the icon
    // precedence in getStatusIcon()/getStatusTooltip(): terminal requirement
    // status first, then the live session status, then the requirement's own
    // status. Terminal statuses (met/deferred/wontfix) never carry a session.
    const getStatusChipLabel = () => {
        if (status === 'met')      return requirementStatusLabel('met');
        if (status === 'deferred') return requirementStatusLabel('deferred');
        if (status === 'wontfix')  return requirementStatusLabel('wontfix');
        if (sessionStatus)         return swarmStatusLabel(sessionStatus);
        return requirementStatusLabel(status);
    };
    const getStatusChipStyle = () => {
        if (status === 'met')      return requirementStatusChipProps('met');
        if (status === 'deferred') return requirementStatusChipProps('deferred');
        if (status === 'wontfix')  return requirementStatusChipProps('wontfix');
        if (sessionStatus)         return swarmStatusChipProps(sessionStatus);
        return requirementStatusChipProps(status);
    };
    // Autonomy label for pill/text — simple capitalization of the coordination type.
    const coordChipLabel = coordType ? coordType.charAt(0).toUpperCase() + coordType.slice(1) : '';

    // --- Status cell — icon (compact) / colored pill / plain text --------------
    // Compact preserves today's exact markup (clickable IconButton when the status
    // is cyclable, bare tooltip'd icon otherwise). Pill/text keep the same tooltip
    // and the same `status-toggle-<id>` test id + click-to-cycle on cyclable rows.
    const renderStatusCell = () => {
        if (requirement.id === '') return null;
        if (effectiveDisplayMode === 'compact') {
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
        }
        // pill — colored status chip, still click-to-cycle on cyclable rows.
        const label = getStatusChipLabel();
        const testId = canCycleStatus ? `status-toggle-${requirement.id}` : undefined;
        const onClick = canCycleStatus ? () => statusClick(requirementIndex, requirement.id) : undefined;
        const { sx: chipSx, ...chipRest } = getStatusChipStyle();
        return (
            <Tooltip title={getStatusTooltip()} enterDelay={400} enterNextDelay={200}>
                <Chip label={label} size="small" clickable={canCycleStatus} onClick={onClick}
                      data-testid={testId} {...chipRest}
                      sx={{ ...(chipSx || {}), maxWidth: '100%', textTransform: 'capitalize' }} />
            </Tooltip>
        );
    };

    // --- Autonomy cell — icon (compact) / colored pill / plain text ------------
    // Visible only for swarm_ready + development; editable only for swarm_ready
    // (unchanged from the icon version). Keeps the `coordination-toggle-<id>` test
    // id across all three modes.
    const renderAutonomyCell = () => {
        if (requirement.id === '') return null;
        const showCoord = ['swarm_ready', 'development'].includes(status);
        if (!showCoord) return null;
        const isCoordEditable = status === 'swarm_ready';
        const tooltip = isCoordEditable
            ? (coordTooltip[coordType] || 'No autonomy — click to set')
            : 'Locked — not editable';
        const testId = `coordination-toggle-${requirement.id}`;
        if (effectiveDisplayMode === 'compact') {
            return (
                <Tooltip title={tooltip} enterDelay={400} enterNextDelay={200}>
                    <span>
                        <IconButton
                            onClick={() => coordinationClick(requirementIndex, requirement.id)}
                            disabled={!isCoordEditable}
                            data-testid={testId}
                            sx={{ maxWidth: 28, maxHeight: 28, '&.Mui-disabled': { opacity: 1 } }}
                        >
                            {getCoordinationIcon()}
                        </IconButton>
                    </span>
                </Tooltip>
            );
        }
        // pill — colored autonomy chip, editable only on swarm_ready.
        const onClick = isCoordEditable ? () => coordinationClick(requirementIndex, requirement.id) : undefined;
        const { sx: coordSx, ...coordRest } = coordinationChipProps(coordType);
        return (
            <Tooltip title={tooltip} enterDelay={400} enterNextDelay={200}>
                <Chip label={coordChipLabel} size="small" clickable={isCoordEditable} onClick={onClick}
                      data-testid={testId} {...coordRest}
                      sx={{ ...(coordSx || {}), maxWidth: '100%', textTransform: 'capitalize',
                            ...(!isCoordEditable && { opacity: 0.85 }) }} />
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
    // grid stays aligned), or null when the card isn't showing them. Their
    // position among the value cells is set by columnOrder below; the grid
    // template in modelEffortLayout.js orders the tracks to match.
    const modelEffortCells = showModelEffortColumns ? (
        <>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', px: '2px' }}>
                {requirement.id !== '' && (
                    <ModelEffortChip
                        kind="model"
                        value={requirement.ai_model}
                        mode={modelEffortDisplayMode}
                        data-testid={`model-cell-${requirement.id}`}
                    />
                )}
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', px: '2px' }}>
                {requirement.id !== '' && (
                    <ModelEffortChip
                        kind="effort"
                        value={requirement.effort}
                        mode={modelEffortDisplayMode}
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
                        onClick={() => navigate(`/swarm/requirement/${requirement.id}`)}
                        aria-label={`Open requirement ${requirement.id}`}
                        data-testid={`req-id-chip-${requirement.id}`}
                    />
                </Tooltip>
            ) : null}
        </Box>
    );

    // Status — icon (compact) / pill per display mode. Clickable cycle for
    // authoring/approved/swarm_ready in every mode.
    const statusCell = (
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minWidth: 28,
                   overflow: 'hidden', ...(effectiveDisplayMode !== 'compact' && { px: '2px' }) }}>
            {renderStatusCell()}
        </Box>
    );

    // Autonomy — icon (compact) / pill per display mode. Visible only for
    // swarm_ready and development; editable only for swarm_ready.
    const autonomyCell = (
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minWidth: 28,
                   overflow: 'hidden', ...(effectiveDisplayMode !== 'compact' && { px: '2px' }) }}>
            {renderAutonomyCell()}
        </Box>
    );

    // Arrange the value cells per the column-order option (req #3029). When the
    // card isn't showing Model/Effort, modelEffortCells is null and drops out, so
    // every arrangement collapses to Req# · Status · Autonomy (the base layout).
    let orderedValueCells;
    if (modelEffortColumnOrder === 'meFirst') {
        orderedValueCells = <>{modelEffortCells}{reqIdCell}{statusCell}{autonomyCell}</>;
    } else if (modelEffortColumnOrder === 'meAfterReq') {
        orderedValueCells = <>{reqIdCell}{modelEffortCells}{statusCell}{autonomyCell}</>;
    } else { // 'standard'
        orderedValueCells = <>{reqIdCell}{statusCell}{autonomyCell}{modelEffortCells}</>;
    }

    return (
        <Box className={rowClassName}
             data-testid={requirement.id === '' ? 'requirement-template' : `requirement-${requirement.id}`}
             key={`box-${requirement.id}`}
             ref={isTemplate ? null : mergedRef}
             // req #3029 — inline custom property consumed by the `.me-cols` rules
             // in index.css (see the grid-template comment above). Set via `style`
             // (a real inline custom property) rather than `sx` so it reliably
             // reaches the higher-specificity class selector.
             style={modelEffortGridColumns ? { '--me-grid': modelEffortGridColumns } : undefined}
             sx={{
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
                 ...(insertIndicator === 'above' && { borderTop: '4px solid', borderTopColor: 'primary.main' }),
                 ...(insertIndicator === 'below' && { borderBottom: '4px solid', borderBottomColor: 'primary.main' }),
             }}
        >
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

            {/* Value cells (Req#, Status, Autonomy, Model, Effort) — arranged per
                the column-order option (req #3029). */}
            {orderedValueCells}

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
                        sx = {{...(status === 'met' && strikethroughMet && {textDecoration: 'line-through'}), ...((status === 'deferred' || status === 'wontfix') && {opacity: 0.5}),}}
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
        </Box>
    )
}

export default RequirementRow
