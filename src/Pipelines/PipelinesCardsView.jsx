// PipelinesCardsView.jsx — the Cards view of /swarm/pipelines (req #3393),
// EDITED IN PLACE and HAND-SORTED by drag since req #3804.
//
// ── EVERY CARD IS ITS OWN EDITOR (req #3804) ────────────────────────────────
// The plan's title and goal are text on the card that becomes a field when
// clicked; Enter / leaving the field saves, Esc puts the stored text back. The
// plan's status is the coloured legend on the info box (req #4144), and a click
// on it opens the seven values to set it from (req #4153). The card's menu sets the machine, locks and unlocks, and
// DELETES the plan (req #3934 — behind a confirmation, refused while the
// plan is locked or a live orchestrator holds it). The plan itself OPENS from its picture — the card body no longer
// navigates, because a click on it is now an edit, and the open buttons that
// stood beside the title and in the menu went in the req #3804 review.
//
// ── WHAT THE CARD SAYS (req #3804 review) ───────────────────────────────────
// Grip, who is orchestrating it, and name, then ONE round-cornered info box —
// initiatives, epics, requirements
// closed / total (labelled just "requirements"), in large figures — with the
// plan's STATUS written in its upper left (req #4144), right
// above the whole plan drawn small, then the goal. No badges for those
// figures, no machine chip, no "x of y met" line and no progress
// bar restating the block (the bar went in the last review). The other chip is a state a reader must not
// miss: locked. Who is orchestrating it is a round badge between
// the grip and the title (req #3973) — green the holder, orange any other
// machine, a dashed outline when the holder's claim is stale — carrying only
// the machine's letter, M or W. The goal sits collapsed to a few lines under
// the shared Show more toggle (req #3945).
//
// ── THE ORDER IS THE READER'S (req #3804) ───────────────────────────────────
// The grid is one ReorderList: a card lifts from its GRIP, left of its title
// (a hold, or a 4px mouse move), the cards around it slide aside, and the drop
// writes every moved card's `sort_order`. Everywhere else a mouse press and
// drag PANS the page, as on the map and 3D views (`useGrabScroll`) — so the
// grid is something you take hold of and move through, and a card moves only
// when its grip is what you took hold of. "+ New pipeline" at the END
// of the grid puts an unsaved card at the FRONT, where the plan it makes will
// stand.
//
// ── COMPLETENESS IS MEASURED ON REQUIREMENTS, NOT ON EPICS (req #3365) ──────
// An epic has no state (req #3750); a requirement's status is stored, so the
// card counts CLOSED requirements (met, deferred, wontfix — req #3804) — a
// join, not a derivation.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';

import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Chip from '@mui/material/Chip';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogTitle from '@mui/material/DialogTitle';
import IconButton from '@mui/material/IconButton';
import InputBase from '@mui/material/InputBase';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Divider from '@mui/material/Divider';
import Stack from '@mui/material/Stack';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import Check from '@mui/icons-material/Check';
import ComputerIcon from '@mui/icons-material/Computer';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import LockIcon from '@mui/icons-material/Lock';
import LockOpenIcon from '@mui/icons-material/LockOpen';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import DragIndicatorIcon from '@mui/icons-material/DragIndicator';

import { ReorderList, useReorderItem, reorderRowSx, isLiftBlur } from '../dnd';
import { lockedChipProps, lockedLabel, pipelineStatusChipProps, pipelineStatusLabel } from '../SwarmView/pipelines/pipelineChipStyles';
import { machineTitle, pipelinesEmptyMessage } from '../SwarmView/pipelines/pipelineViewModel';
import { isStale, cardOrchestrationBadges } from '../SwarmView/pipelines/orchestrationHolder';
import { planDetailPath } from '../SwarmView/pipelines/planEra';
import OrchestrationBadges from '../SwarmView/pipelines/OrchestrationBadges';
import { PipelineStatusMenu } from './PipelineStatusChip';
import CollapseToggle from '../Components/Collapsible/CollapseToggle';
import { useCollapsibleField } from '../Components/Collapsible/useCollapsibleField';
import PipelinePlanThumbnail from './PipelinePlanThumbnail';
import { NewPipelineTile, NewPipelineDraftCard } from './NewPipelineCard';
import { pipelineEditFields } from './PipelineEditDialog';
import useGrabScroll from '../hooks/useGrabScroll';

const EMPTY_SUMMARY = { total: 0, initiatives: 0, initiativeDeps: 0 };
const LIST_ID = 'pipelines-cards';
const CARD_TYPE = 'pipeline-card';
const ANY_MACHINE = '';

const cardItemId = (p) => `pipeline-card:${p.id}`;
const isLocked = (p) => Boolean(Number(p?.locked ?? 0));

// req #3804 review — "feels too fast especially corner to corner … smooth".
// dnd-kit's own 250ms `ease` is tuned for a list row moving one slot; in a
// card grid a sibling can travel a whole row and back, and at that speed a
// pass across the grid reads as frenetic. Longer, with an ease-out that
// spends most of its time decelerating, the cards glide into place.
//
// And a second review: *"the longer reach transitions the cards are hauling
// ass"* — so a slide's time now grows with its distance: 360ms for no
// distance, +0.6ms a pixel, at most 1100ms. A card stepping one slot aside
// (~420px) takes ~610ms; one crossing the grid corner to corner (~1000px+)
// takes ~1s instead of covering it in the same 420ms.
const CARD_MOTION = Object.freeze({
    duration: 360, perPx: 0.6, maxDuration: 1100,
    easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
});

// The lifted card: the card itself on paper with a light shadow, as every
// ReorderList row lifts (ROW_LIFT_SX), rounded to the card's corners.
const CARD_LIFT_SX = { bgcolor: 'background.paper', boxShadow: 6, opacity: 0.9, borderRadius: 1 };

/**
 * Text on the card that is a field when clicked. Saves on Enter (Ctrl/Cmd +
 * Enter in a multi-line field) or on leaving it; Esc restores the stored text.
 * While it has focus a refetch never overwrites what is being typed.
 *
 * `onCommit(text)` resolves true when the save landed; false puts the stored
 * text back.
 */
function InlineText({ value, onCommit, readOnly = false, multiline = false, placeholder,
    testId, sx, maxLength, maxRows, inputRef, onFocusChange, collapsed }) {
    const stored = value ?? '';
    const [draft, setDraft] = useState(stored);
    // `editing` spans the focus AND the save that follows it, so neither a
    // poll nor the optimistic patch repaints the field until the write settles.
    const [editing, setEditing] = useState(false);
    const cancelRef = useRef(false);
    // What the field held when it was focused. Leaving it UNCHANGED writes
    // nothing, even if a poll has since brought newer stored text — comparing
    // against `stored` there would write the stale draft back over it.
    const atFocusRef = useRef(stored);

    useEffect(() => { if (!editing) setDraft(stored); }, [stored, editing]);

    const finish = async (event) => {
        const lift = isLiftBlur(event);
        if (cancelRef.current || lift || draft.trim() === atFocusRef.current.trim()) {
            cancelRef.current = false;
            setEditing(false);
            setDraft(stored);
            return;
        }
        const ok = await onCommit(draft);
        if (!ok) setDraft(stored);
        setEditing(false);
    };

    return (
        <InputBase
            value={draft}
            readOnly={readOnly}
            multiline={multiline}
            fullWidth
            placeholder={readOnly ? undefined : placeholder}
            maxRows={maxRows}
            inputRef={inputRef}
            onFocus={() => { atFocusRef.current = draft; setEditing(true); onFocusChange?.(true); }}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={(e) => { onFocusChange?.(false); finish(e); }}
            onKeyDown={(e) => {
                if (e.key === 'Escape') {
                    e.preventDefault();
                    cancelRef.current = true;
                    e.target.blur?.();
                } else if (e.key === 'Enter' && (!multiline || e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    e.target.blur?.();
                }
            }}
            inputProps={{ 'data-testid': testId, maxLength,
                ...(collapsed !== undefined && { 'data-collapsed': collapsed ? 'true' : 'false' }) }}
            sx={[{
                borderRadius: 0.5,
                px: 0.5,
                mx: -0.5,
                ...(!readOnly && { '&:hover': { bgcolor: 'action.hover' } }),
                '&.Mui-focused': { bgcolor: 'action.selected' },
            }, ...(Array.isArray(sx) ? sx : [sx])]}
        />
    );
}

// req #3945 — the goal sits COLLAPSED to this many lines, so more plans fit on
// a screen and every card still shows what its plan is for.
const GOAL_COLLAPSED_ROWS = 3;

/**
 * The plan's goal, collapsed the way every editable long text in Darwin is
 * (req #3572's CollapsibleGhostField, req #3945): the shared Show more / Show
 * less toggle above it pins it open for reading, and clicking in expands it for
 * as long as it is being edited.
 */
function GoalText({ testId, ...textProps }) {
    const { expanded, showToggle, toggle, attachInput, setFocused, collapsedSx } =
        useCollapsibleField({ deps: [textProps.value] });
    return (
        <Box>
            {/* Only when the collapsed goal hides text (req #4144). */}
            {showToggle && (
                <CollapseToggle expanded={expanded} onToggle={toggle} testId={`${testId}-toggle`} />
            )}
            <InlineText {...textProps} multiline testId={testId}
                        maxRows={expanded ? undefined : GOAL_COLLAPSED_ROWS}
                        collapsed={!expanded}
                        inputRef={attachInput} onFocusChange={setFocused}
                        sx={[textProps.sx, collapsedSx]} />
        </Box>
    );
}

const count = (n, noun) => `${n} ${noun}${n === 1 ? '' : 's'}`;

/**
 * The hard delete's confirmation (req #3934): what goes, what stays.
 * `onConfirm` resolves true when the plan is gone.
 */
function DeletePipelineDialog({ p, summary, counts, open, onClose, onConfirm }) {
    const [deleting, setDeleting] = useState(false);
    const confirm = async () => {
        setDeleting(true);
        const done = await onConfirm();
        setDeleting(false);
        if (done) onClose();
    };
    return (
        <Dialog open={open} onClose={deleting ? undefined : onClose}
                data-testid={`pipelines-card-delete-dialog-${p.id}`}>
            <DialogTitle>Delete pipeline</DialogTitle>
            <DialogContent>
                <DialogContentText>
                    Delete &ldquo;{p.title}&rdquo; with its {count(summary.initiatives, 'initiative')},{' '}
                    {count(summary.total, 'epic')} and every dependency between them?
                </DialogContentText>
                <DialogContentText sx={{ mt: 2 }}>
                    {counts.total
                        ? `Its ${count(counts.total, 'requirement')} ${counts.total === 1
                            ? 'is kept — it comes' : 'are kept — they come'} out unseated, in no plan.`
                        : 'It seats no requirements.'}
                    {' '}Past sessions keep their history. This cannot be undone.
                </DialogContentText>
            </DialogContent>
            <DialogActions>
                <Button onClick={confirm} variant="outlined" color="error" disabled={deleting}
                        data-testid={`pipelines-card-delete-confirm-${p.id}`}>
                    {deleting ? 'Deleting…' : 'Delete'}
                </Button>
                <Button onClick={onClose} variant="outlined" autoFocus disabled={deleting}
                        data-testid={`pipelines-card-delete-cancel-${p.id}`}>
                    Cancel
                </Button>
            </DialogActions>
        </Dialog>
    );
}

/** One figure of the card's info block: the number over its name. */
function Stat({ value, label, testId }) {
    return (
        <Box sx={{ minWidth: 0 }}>
            {/* The plan's top-line numbers — sized to POP (req #3804 review:
                "make the numbers quite a bit larger keeping the text the same"). */}
            <Typography sx={{ fontSize: 30, fontWeight: 700, lineHeight: 1.1,
                              letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums',
                              whiteSpace: 'nowrap' }}
                        data-testid={testId}>
                {value}
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1.2 }}>
                {label}
            </Typography>
        </Box>
    );
}

function PipelineCard({ p, summary, counts, machines, badges, heldLive, onOpen, onUpdate,
    onSetStatus, onDelete, refetchInterval, previewColor }) {
    const { ref, style, isDragging, handleProps, rowProps } =
        useReorderItem(cardItemId(p), p);
    const locked = isLocked(p);
    const s = summary || EMPTY_SUMMARY;
    const reqs = counts || { closed: 0, total: 0 };

    const [menuAnchor, setMenuAnchor] = useState(null);
    const [machineAnchor, setMachineAnchor] = useState(null);
    const [deleteOpen, setDeleteOpen] = useState(false);
    // req #3934 — deleting cascades the plan's claims away from under a running
    // engine, so a LIVE one (whole-plan or initiative-scoped) is stopped first;
    // a stale claim just goes with it. `deletePipeline` re-checks before writing.
    const deleteBlock = locked ? 'Locked — unlock it first'
        : heldLive ? 'Being orchestrated — /pipeline-stop it first' : null;
    const menuButtonRef = useRef(null);

    // req #4153 — the info box's status legend is the status control: a click
    // opens the seven values, as the requirement page's Category opens its
    // list, and the legend keeps its own shape. A status write is lock-free.
    const [statusAnchor, setStatusAnchor] = useState(null);
    const [statusSaving, setStatusSaving] = useState(false);
    const statusLabel = pipelineStatusLabel(p.pipeline_status);
    const statusColours = pipelineStatusChipProps(p.pipeline_status).sx;
    const openStatus = (e) => {
        e.stopPropagation();
        if (!statusSaving && onSetStatus) setStatusAnchor(e.currentTarget);
    };
    const pickStatus = async (next) => {
        setStatusAnchor(null);
        if (next === p.pipeline_status) return;
        setStatusSaving(true);
        try {
            await onSetStatus(p, next);
        } finally {
            setStatusSaving(false);
        }
    };

    // The title, goal and machine go through the plan editor's own rule: only
    // what changed is sent, a blank title is refused, `NULL` is never typed.
    const save = (form) => {
        const { fields, problem } = pipelineEditFields(p, {
            title: p.title,
            description: p.description ?? '',
            machineFk: p.machine_fk ?? ANY_MACHINE,
            ...form,
        });
        if (problem) return onUpdate(p, null, problem);
        if (!Object.keys(fields).length) return Promise.resolve(true);
        return onUpdate(p, fields);
    };

    const machineOptions = machines.filter((m) => !m.closed || m.id === p.machine_fk);

    return (
        <Card
            ref={ref}
            style={style}
            {...rowProps}
            variant="outlined"
            data-testid={`pipelines-card-${p.id}`}
            data-status={p.pipeline_status ?? ''}
            sx={(theme) => ({
                // The card is not the grip — only the lifted gap's look applies.
                ...reorderRowSx(theme, { draggable: false, isDragging }),
            })}
        >
            <CardContent sx={{ pb: '16px !important' }}>
                <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 0.5, mb: 0.25 }}>
                    {/* THE GRIP (req #3804) — the one place a card lifts from. */}
                    {/* No touch listener: MUI's touch-hold tooltip fires mid-drag
                        and restores the body's user-select under the lift. */}
                    <Tooltip title={isDragging ? '' : 'Drag to reorder'}
                             placement="top" disableTouchListener>
                        <Box
                            {...(handleProps || {})}
                            data-drag-handle="true"
                            data-testid={`pipelines-card-grip-${p.id}`}
                            sx={(theme) => ({
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                width: 22, height: 30, ml: -1, flexShrink: 0, borderRadius: 1,
                                color: 'text.disabled',
                                ...(handleProps ? {
                                    cursor: 'grab',
                                    '&:hover': { color: 'text.secondary', bgcolor: 'action.hover' },
                                    '&:focus-visible': {
                                        outline: `2px solid ${theme.palette.primary.main}`,
                                        outlineOffset: -2,
                                    },
                                } : { opacity: 0.4 }),
                            })}
                        >
                            <DragIndicatorIcon fontSize="small" />
                        </Box>
                    </Tooltip>
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Tooltip title={locked ? 'Locked — unlock to rename' : ''} placement="top-start">
                            <span>
                                <InlineText
                                    value={p.title}
                                    readOnly={locked}
                                    maxLength={256}
                                    testId={`pipelines-card-title-${p.id}`}
                                    onCommit={(title) => save({ title })}
                                    sx={{ fontSize: 18, fontWeight: 600 }}
                                />
                            </span>
                        </Tooltip>
                    </Box>
                    <IconButton size="small" ref={menuButtonRef}
                                onClick={(e) => setMenuAnchor(e.currentTarget)}
                                aria-label="Pipeline card menu"
                                data-testid={`pipelines-card-menu-${p.id}`}>
                        <MoreVertIcon fontSize="small" />
                    </IconButton>
                    <Menu anchorEl={menuAnchor} open={!!menuAnchor}
                          onClose={() => setMenuAnchor(null)}
                          anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
                          transformOrigin={{ vertical: 'top', horizontal: 'right' }}>
                        {/* The machine lives here since the card stopped
                            carrying it as a chip (req #3804 review). */}
                        <MenuItem disabled={locked}
                                  onClick={() => { setMenuAnchor(null); setMachineAnchor(menuButtonRef.current); }}
                                  data-testid={`pipelines-card-menu-machine-${p.id}`}>
                            <ListItemIcon><ComputerIcon fontSize="small" /></ListItemIcon>
                            <ListItemText primary="Machine"
                                          secondary={machineTitle(p.machine_fk, machines)} />
                        </MenuItem>
                        <MenuItem onClick={() => { setMenuAnchor(null); onUpdate(p, { locked: locked ? 0 : 1 }); }}
                                  data-testid={`pipelines-card-menu-lock-${p.id}`}>
                            <ListItemIcon>
                                {locked ? <LockOpenIcon fontSize="small" /> : <LockIcon fontSize="small" />}
                            </ListItemIcon>
                            <ListItemText>{locked ? 'Unlock' : 'Lock'}</ListItemText>
                        </MenuItem>
                        <Divider />
                        <MenuItem disabled={Boolean(deleteBlock)}
                                  onClick={() => { setMenuAnchor(null); setDeleteOpen(true); }}
                                  sx={{ color: 'error.main' }}
                                  data-testid={`pipelines-card-menu-delete-${p.id}`}>
                            <ListItemIcon><DeleteOutlineIcon fontSize="small" color="error" /></ListItemIcon>
                            <ListItemText
                                primary="Delete pipeline"
                                secondary={deleteBlock || 'Its initiatives and epics too; requirements are kept'} />
                        </MenuItem>
                    </Menu>
                    <DeletePipelineDialog p={p} summary={s} counts={reqs} open={deleteOpen}
                                          onClose={() => setDeleteOpen(false)}
                                          onConfirm={() => onDelete(p)} />
                    <Menu anchorEl={machineAnchor} open={!!machineAnchor}
                          onClose={() => setMachineAnchor(null)}
                          anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
                          transformOrigin={{ vertical: 'top', horizontal: 'right' }}>
                        {[{ id: ANY_MACHINE, title: 'Any' }, ...machineOptions].map((m) => {
                            const selected = (p.machine_fk ?? ANY_MACHINE) === m.id;
                            return (
                                <MenuItem key={m.id === ANY_MACHINE ? 'any' : m.id}
                                          selected={selected}
                                          onClick={() => { setMachineAnchor(null); save({ machineFk: m.id }); }}
                                          data-testid={`pipelines-card-machine-option-${p.id}-${m.id === ANY_MACHINE ? 'any' : m.id}`}>
                                    <ListItemText>{m.title || `Machine ${m.id}`}</ListItemText>
                                    {selected && <Check fontSize="small" sx={{ ml: 1 }} />}
                                </MenuItem>
                            );
                        })}
                    </Menu>
                </Box>

                {/* THE INFO BOX (req #4144) — a round-cornered rectangle around
                    the three figures, the plan's STATUS written in its upper
                    left like a fieldset legend. The old chip that set it from
                    the card was "too much" (req #4144); the legend keeps its
                    shape and a click on it opens the status menu (req #4153). The
                    requirements figure ("197 / 197") is the widest, so its
                    column is never narrower than the figure on one line (req
                    #3946); the columns stay equal thirds whenever that already
                    fits. */}
                <Box sx={{ position: 'relative', mt: 1.75, mb: 1.5, px: 1.5, pt: 1.75, pb: 1,
                           border: 1, borderColor: 'divider', borderRadius: 2 }}
                     data-testid={`pipelines-card-info-${p.id}`}>
                    {/* req #4169 — the status legend and, just right of it, the
                        orchestration badges (machine-coloured). */}
                    <Box sx={{ position: 'absolute', top: 0, left: 12, transform: 'translateY(-50%)',
                               display: 'flex', alignItems: 'center', gap: 0.75 }}>
                    <Tooltip title={statusAnchor || !onSetStatus || statusSaving ? '' : `Status: ${statusLabel} — click to change`}
                             placement="top" enterDelay={400}>
                        <Typography component="span" variant="caption"
                                    {...(onSetStatus && {
                                        role: 'button', tabIndex: 0, 'aria-haspopup': 'menu',
                                        'aria-expanded': statusAnchor ? 'true' : 'false',
                                        'aria-disabled': statusSaving ? 'true' : undefined,
                                    })}
                                    aria-label={`Pipeline status: ${statusLabel}`}
                                    onClick={openStatus}
                                    // As a native button: Enter opens on keydown, Space on
                                    // KEYUP — opened on keydown, the Space keyup lands on the
                                    // menu's focused item and picks it, closing the menu at once.
                                    onKeyDown={(e) => {
                                        if (e.key === ' ') e.preventDefault();
                                        if (e.key === 'Enter' && !e.repeat) { e.preventDefault(); openStatus(e); }
                                    }}
                                    onKeyUp={(e) => {
                                        if (e.key === ' ') { e.preventDefault(); openStatus(e); }
                                    }}
                                    sx={{ px: 1, borderRadius: 1, lineHeight: 1.6, fontWeight: 600,
                                          bgcolor: 'background.paper',
                                          ...statusColours,
                                          cursor: !onSetStatus ? 'default' : statusSaving ? 'progress' : 'pointer',
                                          userSelect: 'none', outline: 'none',
                                          opacity: statusSaving ? 0.6 : 1,
                                          transition: 'filter 120ms, box-shadow 120ms',
                                          // The same rectangle, lit when it is pointed at or focused.
                                          '&:hover': { filter: 'brightness(1.15)' },
                                          '&:focus-visible': { boxShadow: (t) => `0 0 0 2px ${t.palette.primary.main}` },
                                          ...(statusAnchor && { filter: 'brightness(1.15)' }) }}
                                    data-status={p.pipeline_status ?? ''}
                                    data-testid={`pipelines-card-status-${p.id}`}>
                            {statusLabel}
                        </Typography>
                    </Tooltip>
                    {badges.length > 0 && (
                        <OrchestrationBadges badges={badges}
                                             size={18} fontSize="0.7rem"
                                             testId={`pipelines-card-holder-${p.id}`}
                                             badgeTestIdPrefix={`pipelines-card-holder-${p.id}`} />
                    )}
                    </Box>
                    <PipelineStatusMenu anchorEl={statusAnchor} status={p.pipeline_status}
                                        onPick={pickStatus} onClose={() => setStatusAnchor(null)}
                                        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
                                        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
                                        testId={`pipelines-card-status-${p.id}`} />
                    <Box sx={{ display: 'grid',
                               gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr) minmax(max-content, 1fr)',
                               columnGap: 2 }}>
                        <Stat value={s.initiatives} testId={`pipelines-card-initiatives-${p.id}`}
                              label={s.initiatives === 1 ? 'initiative' : 'initiatives'} />
                        <Stat value={s.total} testId={`pipelines-card-epics-${p.id}`}
                              label={s.total === 1 ? 'epic' : 'epics'} />
                        <Stat value={`${reqs.closed} / ${reqs.total}`}
                              testId={`pipelines-card-requirements-${p.id}`}
                              label="requirements" />
                    </Box>
                </Box>

                {/* THE WHOLE PLAN, SMALL (req #3804) — and the way in: a click
                    on the picture opens the plan it draws. It is a REAL LINK
                    (req #4027), so a right-click offers the browser's own "Open
                    link in new tab" and a cmd/ctrl or middle click opens one;
                    only a plain left click is taken over by the router. It
                    stays a grab surface (`data-grab-through`), and is not
                    natively draggable, so a pan can still start on it. */}
                <Tooltip title="Open the plan" placement="top" enterDelay={600}>
                    <Box component={RouterLink} to={planDetailPath(p.id) ?? ''}
                         draggable={false} data-grab-through="true"
                         onClick={(e) => {
                             if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
                             e.preventDefault();
                             onOpen(p.id);
                         }}
                         sx={{ display: 'block', cursor: 'pointer', color: 'inherit', textDecoration: 'none' }}
                         data-testid={`pipelines-card-thumbnail-${p.id}`}>
                        <PipelinePlanThumbnail pipelineId={p.id} machines={machines}
                                               refetchInterval={refetchInterval}
                                               colorMode={previewColor} />
                    </Box>
                </Tooltip>

                <GoalText
                    value={p.description}
                    readOnly={locked}
                    placeholder="Add a goal…"
                    testId={`pipelines-card-description-${p.id}`}
                    onCommit={(description) => save({ description })}
                    sx={{ fontSize: 14, color: 'text.secondary' }}
                />

                {locked && (
                    <Stack direction="row" spacing={1} sx={{ mt: 1.5, flexWrap: 'wrap', rowGap: 1 }}>
                        {/* req #3649 — shown only on a locked plan; a click
                            unlocks it in place. Locking is in the card menu. */}
                        <Tooltip title="Locked — this plan, its initiatives and epics are frozen as a record. Click to unlock.">
                            <Chip size="small"
                                  {...lockedChipProps(p.locked)}
                                  label={lockedLabel(p.locked)}
                                  clickable
                                  onClick={() => onUpdate(p, { locked: 0 })}
                                  data-testid={`pipelines-card-locked-${p.id}`} />
                        </Tooltip>
                    </Stack>
                )}
            </CardContent>
        </Card>
    );
}

/**
 * @param {Object}   props
 * @param {Object[]} props.pipelines   the cards to draw, in display order
 * @param {(fromId, toId) => void} props.onReorder   a card dropped on another's place
 * @param {(row, fields, problem?) => Promise<boolean>} props.onUpdate  an in-place edit
 * @param {(row, next) => Promise<boolean>} props.onSetStatus  the status legend's pick (req #4153)
 * @param {(row) => Promise<boolean>} props.onDelete  the menu's confirmed hard delete
 * @param {(title) => Promise<boolean>} props.onCreate  the front card's Enter
 */
export default function PipelinesCardsView({ pipelines, summaries, reqCounts,
    machines, claims = [], onOpen, onUpdate, onSetStatus, onDelete, onReorder,
    onCreate, creating = false, hiddenStatusCounts = [],
    refetchInterval, thumbnailRefetchInterval, previewColor }) {
    const [drafting, setDrafting] = useState(false);
    const gridRef = useRef(null);
    const { ref: grabRef, grabbing } = useGrabScroll();
    const surfaceRef = useCallback((el) => { gridRef.current = el; grabRef(el); }, [grabRef]);
    const surfaceSx = { cursor: grabbing ? 'grabbing' : 'grab' };

    const add = () => {
        setDrafting(true);
        // The new card appears at the FRONT — bring it into view.
        gridRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
    };
    const create = async (title) => {
        const done = await onCreate(title);
        if (done) setDrafting(false);
        return done;
    };

    const draft = drafting && (
        <NewPipelineDraftCard onCreate={create} onCancel={() => setDrafting(false)}
                              creating={creating} />
    );
    const tile = <NewPipelineTile onAdd={add} disabled={drafting} />;

    // Stable between renders: a fresh array tells dnd-kit the items changed,
    // and a card stepping aside in that frame would jump, not slide.
    const ids = useMemo(() => pipelines.map(cardItemId), [pipelines]);

    if (!pipelines.length) {
        return (
            <>
                <Typography variant="body2" color="text.secondary" sx={{ px: 1, py: 3 }}
                            data-testid="pipelines-cards-empty">
                    {pipelinesEmptyMessage(hiddenStatusCounts)}
                </Typography>
                <Box className="card" ref={surfaceRef} sx={surfaceSx}>{draft}{tile}</Box>
            </>
        );
    }


    return (
        <Box ref={surfaceRef} sx={surfaceSx} data-testid="pipelines-cards-surface">
            <ReorderList id={LIST_ID} type={CARD_TYPE} ids={ids}
                         orientation="grid" sortsOutside
                         liftSx={CARD_LIFT_SX} motion={CARD_MOTION} handle
                         onReorder={(from, to) => onReorder(pipelines[from].id, pipelines[to].id)}
                         className="card"
                         data-testid="pipelines-cards-view">
                {draft}
                {pipelines.map((p) => (
                    <PipelineCard
                        key={p.id}
                        p={p}
                        summary={summaries.get(p.id)}
                        counts={reqCounts?.get(p.id)}
                        machines={machines}
                        badges={cardOrchestrationBadges(claims, p.id, machines)}
                        heldLive={claims.some((c) => c.pipeline_fk === p.id && !isStale(c))}
                        onOpen={onOpen}
                        onUpdate={onUpdate}
                        onSetStatus={onSetStatus}
                        onDelete={onDelete}
                        refetchInterval={thumbnailRefetchInterval ?? refetchInterval}
                        previewColor={previewColor}
                    />
                ))}
                {tile}
            </ReorderList>
        </Box>
    );
}
