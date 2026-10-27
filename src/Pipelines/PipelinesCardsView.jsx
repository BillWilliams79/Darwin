// PipelinesCardsView.jsx — the Cards view of /swarm/pipelines (req #3393),
// EDITED IN PLACE and HAND-SORTED by drag since req #3804.
//
// ── EVERY CARD IS ITS OWN EDITOR (req #3804) ────────────────────────────────
// The plan's title and goal are text on the card that becomes a field when
// clicked; Enter / leaving the field saves, Esc puts the stored text back. The
// card's menu sets the machine, locks and unlocks, closes or reopens the
// plan, and DELETES it (req #3934 — behind a confirmation, refused while the
// plan is locked or a live orchestrator holds it). The plan itself OPENS from its picture — the card body no longer
// navigates, because a click on it is now an edit, and the open buttons that
// stood beside the title and in the menu went in the req #3804 review.
//
// ── WHAT THE CARD SAYS (req #3804 review) ───────────────────────────────────
// Grip, who is orchestrating it, and name, then ONE plain info block — initiatives, epics, requirements
// closed / total (labelled just "requirements"), in large figures — right
// above the whole plan drawn small, then the goal. No badges for those
// figures, no status or machine chips, no "x of y met" line and no progress
// bar restating the block (the bar went in the last review). The chips that remain are states a reader must not
// miss: closed and locked. Who is orchestrating it is a round badge between
// the grip and the title (req #3973) — green the holder, orange any other
// machine, a dashed outline when the holder's claim is stale — carrying only
// the machine's letter, M or W. The goal sits collapsed to a few lines under
// the shared Show more toggle (req #3945).
//
// What is NOT editable here is the lifecycle (`pipeline_status`): its
// transitions carry started_at/completed_at side effects, and the plan is
// started, paused and stopped by the `/pipeline-*` commands.
//
// ── THE ORDER IS THE READER'S (req #3804) ───────────────────────────────────
// The grid is one ReorderList: a card lifts from its GRIP, left of its title
// (a hold, or a 4px mouse move), the cards around it slide aside, and the drop
// writes every moved card's `sort_order`. Everywhere else a mouse press and
// drag PANS the page, as on the map and 3D views (`useGrabScroll`) — so the
// grid is something you take hold of and move through, and a card moves only
// when its grip is what you took hold of. A closed card is shown (when "Closed" is lit) but is not a
// position — it neither lifts nor takes a drop. "+ New pipeline" at the END
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
import CloseIcon from '@mui/icons-material/Close';
import ComputerIcon from '@mui/icons-material/Computer';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import LockIcon from '@mui/icons-material/Lock';
import LockOpenIcon from '@mui/icons-material/LockOpen';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import DragIndicatorIcon from '@mui/icons-material/DragIndicator';
import UnarchiveIcon from '@mui/icons-material/Unarchive';

import { ReorderList, useReorderItem, reorderRowSx, isLiftBlur } from '../dnd';
import { lockedChipProps, lockedLabel } from '../SwarmView/pipelines/pipelineChipStyles';
import { machineTitle, pipelinesEmptyMessage } from '../SwarmView/pipelines/pipelineViewModel';
import { isStale, cardOrchestrationBadges } from '../SwarmView/pipelines/orchestrationHolder';
import { planDetailPath } from '../SwarmView/pipelines/planEra';
import OrchestrationBadges from '../SwarmView/pipelines/OrchestrationBadges';
import CollapseToggle from '../Components/Collapsible/CollapseToggle';
import { useCollapsibleField } from '../Components/Collapsible/useCollapsibleField';
import PipelinePlanThumbnail from './PipelinePlanThumbnail';
import { NewPipelineTile, NewPipelineDraftCard } from './NewPipelineCard';
import { pipelineEditFields } from './PipelineEditDialog';
import { isClosedPipeline } from './pipelinesViewModel';
import useGrabScroll from '../hooks/useGrabScroll';

const EMPTY_SUMMARY = { total: 0, initiatives: 0, initiativeDeps: 0 };
const LIST_ID = 'pipelines-cards';
const CARD_TYPE = 'pipeline-card';
const ANY_MACHINE = '';

const cardItemId = (p) => `pipeline-card:${p.id}`;
// A closed plan is shown, never a position.
const isOrderable = (p) => !isClosedPipeline(p);
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
    const { expanded, toggle, attachInput, setFocused, collapsedSx } = useCollapsibleField();
    return (
        <Box>
            <CollapseToggle expanded={expanded} onToggle={toggle} testId={`${testId}-toggle`} />
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
    onDelete, refetchInterval }) {
    const { ref, style, isDragging, handleProps, rowProps } =
        useReorderItem(cardItemId(p), p);
    const closed = isClosedPipeline(p);
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
            data-closed={closed ? 'true' : undefined}
            sx={(theme) => ({
                // The card is not the grip — only the lifted gap's look applies.
                ...reorderRowSx(theme, { draggable: false, isDragging }),
                ...(closed && { opacity: 0.6, borderStyle: 'dashed' }),
            })}
        >
            <CardContent sx={{ pb: '16px !important' }}>
                <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 0.5, mb: 0.25 }}>
                    {/* THE GRIP (req #3804) — the one place a card lifts from. A
                        closed card is not a position: its grip is drawn dim and
                        does nothing, so it still keeps its place before the title. */}
                    {/* No touch listener: MUI's touch-hold tooltip fires mid-drag
                        and restores the body's user-select under the lift. */}
                    <Tooltip title={isDragging ? ''
                                 : handleProps ? 'Drag to reorder' : 'Closed — not a position in the order'}
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
                    {/* WHO IS ORCHESTRATING IT (req #3973) — between the grip
                        and the title, centred on the title's first line. */}
                    {badges.length > 0 && (
                        <Box sx={{ display: 'flex', alignItems: 'center', height: 30, mr: 0.5 }}>
                            <OrchestrationBadges badges={badges}
                                                 size={22} fontSize="0.8rem"
                                                 testId={`pipelines-card-holder-${p.id}`}
                                                 badgeTestIdPrefix={`pipelines-card-holder-${p.id}`} />
                        </Box>
                    )}
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
                        <MenuItem onClick={() => { setMenuAnchor(null); onUpdate(p, { closed: closed ? 0 : 1 }); }}
                                  data-testid={`pipelines-card-menu-close-${p.id}`}>
                            <ListItemIcon>
                                {closed ? <UnarchiveIcon fontSize="small" /> : <CloseIcon fontSize="small" />}
                            </ListItemIcon>
                            <ListItemText
                                primary={closed ? 'Reopen pipeline' : 'Close pipeline'}
                                secondary={closed ? 'Shown again; orchestratable again'
                                    : 'Hidden, and no engine launches its work'} />
                        </MenuItem>
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

                {/* THE INFO BLOCK (req #3804 review: "not badges … just a
                    simple info block") — three figures straight under the
                    title, the top-line numbers of the plan, right above the
                    preview. The requirements figure ("197 / 197") is the
                    widest, so its column is never narrower than the figure
                    on one line (req #3946); the columns stay equal thirds
                    whenever that already fits. */}
                <Box sx={{ display: 'grid',
                           gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr) minmax(max-content, 1fr)',
                           columnGap: 2, mt: 0.5, mb: 1.5 }}
                     data-testid={`pipelines-card-info-${p.id}`}>
                    <Stat value={s.initiatives} testId={`pipelines-card-initiatives-${p.id}`}
                          label={s.initiatives === 1 ? 'initiative' : 'initiatives'} />
                    <Stat value={s.total} testId={`pipelines-card-epics-${p.id}`}
                          label={s.total === 1 ? 'epic' : 'epics'} />
                    <Stat value={`${reqs.closed} / ${reqs.total}`}
                          testId={`pipelines-card-requirements-${p.id}`}
                          label="requirements" />
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
                                               refetchInterval={refetchInterval} />
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

                {(closed || locked) && (
                    <Stack direction="row" spacing={1} sx={{ mt: 1.5, flexWrap: 'wrap', rowGap: 1 }}>
                        {closed && (
                            <Tooltip title="Closed — hidden by default, and no engine launches its work. Reopen it from the card menu.">
                                <Chip size="small" label="closed" color="default"
                                      data-testid={`pipelines-card-closed-${p.id}`} />
                            </Tooltip>
                        )}
                        {/* req #3649 — shown only on a locked plan; a click
                            unlocks it in place. Locking is in the card menu. */}
                        {locked && (
                            <Tooltip title="Locked — this plan, its initiatives and epics are frozen as a record. Click to unlock.">
                                <Chip size="small"
                                      {...lockedChipProps(p.locked)}
                                      label={lockedLabel(p.locked)}
                                      clickable
                                      onClick={() => onUpdate(p, { locked: 0 })}
                                      data-testid={`pipelines-card-locked-${p.id}`} />
                            </Tooltip>
                        )}
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
 * @param {(row) => Promise<boolean>} props.onDelete  the menu's confirmed hard delete
 * @param {(title) => Promise<boolean>} props.onCreate  the front card's Enter
 */
export default function PipelinesCardsView({ pipelines, summaries, reqCounts,
    machines, claims = [], onOpen, onUpdate, onDelete, onReorder,
    onCreate, creating = false, hiddenStatusCounts = [], closedHidden = 0,
    refetchInterval, thumbnailRefetchInterval }) {
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
                    {!hiddenStatusCounts.length && closedHidden > 0
                        ? `Every pipeline is closed (${closedHidden}) — light Closed to see them.`
                        : pipelinesEmptyMessage(hiddenStatusCounts)}
                </Typography>
                <Box className="card" ref={surfaceRef} sx={surfaceSx}>{draft}{tile}</Box>
            </>
        );
    }


    return (
        <Box ref={surfaceRef} sx={surfaceSx} data-testid="pipelines-cards-surface">
            <ReorderList id={LIST_ID} type={CARD_TYPE} ids={ids}
                         orientation="grid" sortsOutside isTarget={isOrderable}
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
                        onDelete={onDelete}
                        refetchInterval={thumbnailRefetchInterval ?? refetchInterval}
                    />
                ))}
                {tile}
            </ReorderList>
        </Box>
    );
}
